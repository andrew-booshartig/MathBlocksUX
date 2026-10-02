"""The smart calculator: one line of pretty math in, the obvious thing out.

  just numbers      → the value, exact and decimal (3/4 + 1 → 7/4 ≈ 1.75)
  name = value      → saves a variable (r = 4, then πr² is a number)
  one letter        → an expression is simplified; an equation or
                      inequality is solved for that letter
  several letters   → it asks what to do: solve for which letter, or
                      simplify / expand / factor

Variables are the calculator's own named values: their values are LaTeX
(as typed), may use each other (d = 2r), and are substituted into every
line. Input is LaTeX (from the visual math field). It's read with the
shared language layer and handed to the same engines the Transform and
Solve blocks use, so answers and worked steps match everywhere."""

import re

import sympy

from . import lang
import dataclasses

from .lang.ast import Const, Group, Num, Sym
from .calculator import _fmt_decimal, op_calc
from .parsing import MathInputError, build_scope, parse, tex
from .solve import op_solve
from .transform import op_transform

# how the engines above read text: 2*x, x^2, one "=" for equals
PLAIN = [{"id": "plain", "name": "Plain", "power": ["^"], "equals": ["="], "implicit_multiplication": False}]

_ANS = re.compile(r"\\(?:mathrm|operatorname|text)\{Ans\}|\bAns\b")
_RELATION = re.compile(r"<=|>=|<|>|=")
_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

EXPRESSION_ACTIONS = [
    {"kind": "simplify", "label": "Simplify"},
    {"kind": "expand", "label": "Expand"},
    {"kind": "factor", "label": "Factor"},
]


_NEW_NAME = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_]{2,}|[A-Za-z][0-9_][A-Za-z0-9_]*)\s*=(?!=)")


def _mark_names(latex: str, names) -> str:
    """Typed math reads "rate" as r·a·t·e. A multi-letter name that's a
    variable (or being saved as one: "rate = 0.07") is one name — mark it."""
    for name in sorted((n for n in names if len(n) > 1), key=len, reverse=True):
        latex = re.sub(rf"(?<!\\mathrm\{{)(?<!\\operatorname\{{)(?<![\\A-Za-z]){re.escape(name)}(?![A-Za-z])", rf"\\mathrm{{{name}}}", latex)
    return latex


# reading a resolved value back (sympy writes powers as **)
_VALUE_READER = [{"id": "value", "name": "Value", "power": ["^", "**"], "equals": ["="], "implicit_multiplication": False}]


def _fill_in(node, values: dict):
    """The line with each variable's value in place of its name (bracketed
    unless it's a plain number) — what the Work tab practises on."""
    if isinstance(node, Sym) and node.name in values:
        value = values[node.name]
        return value if isinstance(value, (Num, Const, Sym)) else Group(value)
    if not dataclasses.is_dataclass(node):
        return node
    changes = {}
    for f in dataclasses.fields(node):
        v = getattr(node, f.name)
        if isinstance(v, list):
            changes[f.name] = [(x[0], _fill_in(x[1], values)) if isinstance(x, tuple) else _fill_in(x, values) for x in v]
        elif dataclasses.is_dataclass(v):
            changes[f.name] = _fill_in(v, values)
    return dataclasses.replace(node, **changes)


def _plain(latex: str) -> str:
    return lang.write(lang.parse(latex, "latex"), "plain", PLAIN)


def _letters(text: str, vars_: dict | None = None, names: list | None = None) -> list[str]:
    """The letters a line still needs (x and y first, then alphabetical) —
    anything the variables define has a value and doesn't count. With
    `names`, nothing is filled in: every name used, multi-letter ones whole."""
    scope = {**build_scope({}), **{n: sympy.Symbol(n) for n in names}} if names is not None else build_scope(vars_ or {})
    names: set[str] = set()
    for side in _RELATION.split(text):
        if side.strip():
            names |= {str(s) for s in parse(side, scope).free_symbols}
    return sorted(names, key=lambda n: (n not in ("x", "y"), n != "x", n))


# ------------------------------------------------------------- variables


def resolve_variables(items: list[dict]) -> dict:
    """[{name, latex}] → {name: {plain, latex, decimal} or {error}}.
    Values may use each other in any order (d = 2r before r = 4 is fine);
    something that depends on itself is reported, not looped on."""
    out: dict[str, dict] = {}
    texts: dict[str, str] = {}
    for item in items:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        if not _NAME.match(name):
            out[name] = {"error": "a name is letters (and digits after the first letter)"}
            continue
        if not (item.get("latex") or "").strip():
            out[name] = {"error": "no value yet"}
            continue
        try:
            names = [(i.get("name") or "").strip() for i in items]
            texts[name] = _plain(_mark_names(item["latex"], [n for n in names if _NAME.match(n)]))
        except Exception:  # noqa: BLE001 — half-typed or unreadable
            out[name] = {"error": "can't read this value yet"}
    known: dict[str, str] = {}
    pending = dict(texts)
    while pending:
        progress = False
        for name, text in list(pending.items()):
            try:
                value = parse(text, build_scope(known))
            except Exception:  # noqa: BLE001
                out[name] = {"error": "can't read this value yet"}
                del pending[name]
                continue
            free = {str(s) for s in value.free_symbols}
            if free & (set(pending) - {name}):
                continue  # waits for another variable first
            del pending[name]
            progress = True
            if free:
                out[name] = {"error": f"{', '.join(sorted(free))} has no value"}
                continue
            exact = sympy.nsimplify(value) if value.is_Float else sympy.simplify(value)
            numeric = complex(sympy.N(exact, 15))
            known[name] = str(exact)
            out[name] = {
                "plain": str(exact),
                "latex": tex(exact),
                "decimal": _fmt_decimal(numeric.real) if abs(numeric.imag) < 1e-12 else None,
            }
        if not progress:
            for name in pending:
                out[name] = {"error": "depends on itself (through other variables)"}
            break
    return out


def op_smart_vars(req: dict) -> dict:
    return {"values": resolve_variables(req.get("vars") or [])}


# ---------------------------------------------------------------- a line


def _graph_lines(node, text: str, letters: list[str]) -> list[str]:
    """What the Graph tab would draw for this line (empty: nothing sensible)."""
    if set(letters) == {"x"}:
        if isinstance(node, lang.Rel) and len(node.ops) == 1:
            # each side as a line: where they cross is the solution
            return [f"y = {lang.write(side, 'plain', PLAIN)}" for side in node.parts]
        if not isinstance(node, lang.Rel):
            return [f"y = {text}"]
    if set(letters) == {"x", "y"}:
        return [text]
    return []


def _graph_window(text: str, vars_: dict) -> dict | None:
    """A window that shows where the two sides of an equation in x meet."""
    sides = _RELATION.split(text)
    if len(sides) != 2:
        return None
    scope = build_scope(vars_)
    x = sympy.Symbol("x")
    left, right = parse(sides[0], scope), parse(sides[1], scope)
    found = [s for s in sympy.solve(sympy.Eq(left, right), x) if s.is_real]
    if len(found) != 1:
        return None
    sx, sy = float(found[0]), float(left.subs(x, found[0]))
    pad = max(5.0, abs(sx) * 0.4, abs(sy) * 0.4)
    return {
        "xmin": round(min(-10.0, sx - pad), 3),
        "xmax": round(max(10.0, sx + pad), 3),
        "ymin": round(min(-10.0, sy - pad), 3),
        "ymax": round(max(10.0, sy + pad), 3),
    }


def op_smart(req: dict) -> dict:
    latex = (req.get("latex") or "").strip()
    if not latex:
        raise MathInputError("")
    ans = req.get("ans")
    if _ANS.search(latex):
        if not ans:
            raise MathInputError("there's no answer yet to use as Ans")
        latex = _ANS.sub(lambda _: f"\\left({ans}\\right)", latex)
    vars_ = req.get("vars") or {}
    saving = _NEW_NAME.match(latex)
    latex = _mark_names(latex, [*vars_, *([saving.group(1)] if saving else [])])
    try:
        node = lang.parse(latex, "latex")
    except lang.Incomplete:
        raise MathInputError("") from None
    text = lang.write(node, "plain", PLAIN)
    input_latex = lang.latex(node)
    relation = isinstance(node, lang.Rel)
    names = _letters(text, names=[*vars_, *([saving.group(1)] if saving else [])])  # every name used (for live updates)
    letters = _letters(text, vars_)  # the ones that are still unknown
    base = {"input_latex": input_latex, "names": names}

    # name = value: save a variable (r = 4, d = 2r) — when the right side
    # has nothing unknown
    if relation and node.ops == ["="] and isinstance(node.parts[0], Sym):
        name = node.parts[0].name
        right = lang.write(node.parts[1], "plain", PLAIN)
        if name not in _letters(right) and not _letters(right, vars_):
            value = op_calc({"expr": right, "angle": req.get("angle", "deg"), "vars": vars_})
            return {
                **base,
                "kind": "assign",
                "name": name,
                "value_latex": lang.latex(node.parts[1]),
                "result_latex": f"{tex(sympy.Symbol(name))} = {value['exact_latex']}",
                "decimal": value["decimal"] if value["exact_differs"] else None,
                "ans": value["exact_latex"],
            }

    # just numbers (or every letter has a value): work it out
    if not letters:
        if relation:
            scope = build_scope(vars_)
            sides = [parse(part, scope) for part in _RELATION.split(text)]
            op = _RELATION.search(text).group(0)
            check = {"=": sympy.Eq, "<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge}[op]
            truth = bool(check(sympy.simplify(sides[0] - sides[1]), 0))
            return {**base, "kind": "truth", "result_latex": "\\text{true}" if truth else "\\text{false}"}
        value = op_calc({"expr": text, "angle": req.get("angle", "deg"), "vars": vars_})
        return {
            **base,
            "kind": "value",
            "result_latex": value["exact_latex"],
            "decimal": value["decimal"] if value["exact_differs"] else None,
            # Ans is this answer, exact, as math (2√2, not 2.828…)
            "ans": value["exact_latex"],
        }

    actions = (
        [{"kind": "solve", "var": v, "label": f"Solve for {v}"} for v in letters] if relation else EXPRESSION_ACTIONS
    )
    # where else this line can go: the Work and Graph tabs (Work gets the
    # variables' values filled in, so its checks agree with this answer)
    handoff = {"work": len(letters) == 1, "graph": _graph_lines(node, text, letters)}
    if handoff["graph"] and relation and set(letters) == {"x"}:
        try:
            window = _graph_window(text, vars_)
            if window:
                handoff["graph_window"] = window
        except Exception:  # noqa: BLE001 — the default window, then
            pass
    used = [n for n in names if n in vars_]
    if handoff["work"] and used:
        try:
            values = {n: lang.parse(vars_[n], "value", _VALUE_READER) for n in used}
            handoff["work_latex"] = lang.latex(_fill_in(node, values))
        except Exception:  # noqa: BLE001 — then Work just gets the line as typed
            pass
    action = req.get("action")
    if not action:
        if len(letters) > 1:
            # several letters: there's no one obvious thing to do — ask
            return {**base, **handoff, "kind": "choose", "letters": letters, "choices": actions}
        action = actions[0]

    if action["kind"] == "solve":
        out = op_solve({"expr": text, "for": action["var"], "vars": vars_})
        result, steps = out.get("solution_latex", ""), out.get("steps", [])
    elif action["kind"] in ("simplify", "expand", "factor"):
        if relation:
            raise MathInputError("that's an equation — solve it instead")
        out = op_transform({"expr": text, "mode": action["kind"], "vars": vars_})
        result, steps = out.get("result_latex", ""), out.get("steps", [])
    else:
        raise MathInputError(f"unknown action “{action.get('kind')}”")

    return {
        **base,
        **handoff,
        "kind": "result",
        "result_latex": result,
        "steps": steps,
        "action": action,
        # a simplified expression can be used again as Ans; a solution can't
        "ans": result if action["kind"] != "solve" else None,
        # the other things this line could do, offered as one-tap chips
        "others": [a for a in actions if a != action],
    }


# ------------------------------------------------- the Variables console


# typed like Python (2*r, r**2) — or the everyday way (2r, r^2)
CONSOLE = [{"id": "console", "name": "Console", "power": ["**", "^"], "equals": ["=", "=="], "implicit_multiplication": True}]
_DELETE = re.compile(r"^\s*del\s+([A-Za-z][A-Za-z0-9_]*)\s*$")
_CLEAR = re.compile(r"^\s*clear\s*(\(\s*\))?\s*$", re.I)


def op_smart_console(req: dict) -> dict:
    """One line typed in the Variables console. It changes nothing itself —
    it says what the line means, and the calculator applies it:
      y = 5 / y = 2x + 1   → set (or redefine) a variable
      del y                → remove one       clear → remove them all
      y, 2*y + x           → show a value"""
    text = (req.get("text") or "").strip()
    if not text:
        raise MathInputError("")
    if _CLEAR.match(text):
        return {"kind": "clear"}
    gone = _DELETE.match(text)
    if gone:
        return {"kind": "delete", "name": gone.group(1)}
    try:
        node = lang.parse(text, "console", CONSOLE)
    except lang.Incomplete:
        raise MathInputError("") from None
    items = [v for v in (req.get("vars") or []) if (v.get("name") or "").strip()]
    if isinstance(node, lang.Rel):
        if node.ops != ["="] or not isinstance(node.parts[0], Sym):
            raise MathInputError("to save a value, put a name on the left: y = 5")
        name = node.parts[0].name
        value_latex = lang.latex(node.parts[1])
        # what it works out to, with this new value in place
        values = resolve_variables([*[v for v in items if v["name"] != name], {"name": name, "latex": value_latex}])
        mine = values.get(name, {})
        return {
            "kind": "assign",
            "name": name,
            "latex": value_latex,
            "input_latex": lang.latex(node),
            "result_latex": mine.get("latex"),
            "decimal": mine.get("decimal"),
            "error": mine.get("error"),
        }
    # just a value: work it out with the variables
    values = resolve_variables(items)
    plain = {n: v["plain"] for n, v in values.items() if "plain" in v}
    text_plain = lang.write(node, "plain", PLAIN)
    missing = _letters(text_plain, plain)
    if missing:
        raise MathInputError(f"{', '.join(missing)} {'has' if len(missing) == 1 else 'have'} no value yet — give it one: {missing[0]} = …")
    value = op_calc({"expr": text_plain, "angle": req.get("angle", "deg"), "vars": plain})
    return {
        "kind": "value",
        "input_latex": lang.latex(node),
        "result_latex": value["exact_latex"],
        "decimal": value["decimal"] if value["exact_differs"] else None,
    }
