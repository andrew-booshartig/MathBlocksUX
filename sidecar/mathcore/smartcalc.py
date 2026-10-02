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

from .lang.ast import Const, Group, Mul, Num, Sym
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


def _typed(latex: str) -> str:
    """The line as typed, with the field's spacing commands as plain spaces
    (a space key types \\, — so 2 1/3 stays the mixed number 2⅓)."""
    return re.sub(r"\\[,;:! ]", " ", latex).strip()


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


_WORDS = {"pi", "E", "e", "oo", "sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "root"}


def _calls(text: str, functions) -> str:
    """'f*(3)' → 'f(3)' for the functions there are (otherwise it's f times 3)."""
    for name in functions:
        text = re.sub(rf"\b{re.escape(name)}\*\(", f"{name}(", text)
    return text


def _names(text: str) -> list[str]:
    """Every name a line uses — letters, variables and functions."""
    return sorted(set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text)) - _WORDS)


def _function_def(node):
    """f(x) = … → (f, x, the body) — or None."""
    if not (isinstance(node, lang.Rel) and node.ops == ["="]):
        return None
    left = node.parts[0]
    if isinstance(left, Mul) and len(left.factors) == 2 and isinstance(left.factors[0], Sym):
        arg = left.factors[1]
        if isinstance(arg, Group) and isinstance(arg.inner, Sym):
            return left.factors[0].name, arg.inner.name, node.parts[1]
        if isinstance(arg, Group) and isinstance(arg.inner, lang.Alts) and all(isinstance(i, Sym) for i in arg.inner.items):
            raise MathInputError(f"functions take one input for now — like {left.factors[0].name}(x) = …")
    return None


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
    """[{name, latex, params?}] → {name: {plain, latex, decimal, params?} or {error}}.
    A variable is a value; with `params` it's a function (f(x) = x² + 1).
    They may use each other in any order (d = 2r before r = 4 is fine);
    something that depends on itself is reported, not looped on."""
    out: dict[str, dict] = {}
    texts: dict[str, str] = {}
    params_of: dict[str, list[str]] = {}
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
            texts[name] = _calls(_plain(_mark_names(item["latex"], [n for n in names if _NAME.match(n)])), [i["name"] for i in items if i.get("params")])
            if item.get("params"):
                params_of[name] = list(item["params"])
        except Exception:  # noqa: BLE001 — half-typed or unreadable
            out[name] = {"error": "can't read this value yet"}
    known: dict[str, str] = {}
    pending = dict(texts)
    while pending:
        progress = False
        for name, text in list(pending.items()):
            params = params_of.get(name, [])
            waiting = {n for n in set(pending) - {name} if re.search(rf"\b{re.escape(n)}\b", text)}
            if waiting:
                continue  # waits for another variable (or function) first
            try:
                value = parse(text, build_scope(known, keep_symbolic=params))
            except Exception:  # noqa: BLE001
                out[name] = {"error": "can't read this value yet"}
                del pending[name]
                continue
            free = {str(s) for s in value.free_symbols} - set(params)
            del pending[name]
            progress = True
            if free:
                out[name] = {"error": f"{', '.join(sorted(free))} has no value"}
                continue
            if params:
                # a function: its body, with the variables' values filled in
                body = sympy.simplify(value)
                known[f"{name}({','.join(params)})"] = str(body)
                out[name] = {"plain": str(body), "latex": tex(body), "decimal": None, "params": params}
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


def op_smart(req: dict) -> dict:
    latex = _typed(req.get("latex") or "")
    if not latex:
        raise MathInputError("")
    ans = req.get("ans")
    if _ANS.search(latex):
        if not ans:
            raise MathInputError("there's no answer yet to use as Ans")
        latex = _ANS.sub(lambda _: f"\\left({ans}\\right)", latex)
    vars_ = req.get("vars") or {}
    functions = [k.split("(")[0] for k in vars_ if "(" in k]
    saving = _NEW_NAME.match(latex)
    latex = _mark_names(latex, [*(k.split("(")[0] for k in vars_), *([saving.group(1)] if saving else [])])
    try:
        node = lang.parse(latex, "latex")
    except lang.Incomplete:
        raise MathInputError("") from None
    input_latex = lang.latex(node)
    # f(x) = …: a new function (like r = 4 saves a variable). One that
    # exists already is solved for instead: f(x) = 10 → x = ±3
    defined = _function_def(node)
    if defined and defined[0] not in functions:
        fname, param, body = defined
        body_latex = lang.latex(body)
        return {
            "kind": "assign",
            "name": fname,
            "params": [param],
            "value_latex": body_latex,
            "input_latex": input_latex,
            "names": _names(lang.write(body, "plain", PLAIN)),
            "result_latex": f"{fname}({param}) = {body_latex}",
            "decimal": None,
            "ans": None,
        }
    text = _calls(lang.write(node, "plain", PLAIN), functions)
    relation = isinstance(node, lang.Rel)
    names = _names(text)  # every name used (for live updates)
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
    # it can go on to the Work tab, with the variables' values filled in
    # (so its checks agree with this answer)
    handoff = {"work": len(letters) == 1}
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


_DELETE = re.compile(r"^del([A-Za-z][A-Za-z0-9_]*)$")


def _command(latex: str) -> str:
    """The line's letters with the math markup stripped (del y → dely)."""
    # MathLive turns a typed "del" into ∂ — read it back as the command
    flat = re.sub(r"\\partial(?![A-Za-z])", "del", latex)
    flat = re.sub(r"\\(?:mathrm|operatorname|text|textrm|mathit)\{([^{}]*)\}", r"\1", flat)
    flat = re.sub(r"\\left|\\right|\\[ ,;:!]|~|\s", "", flat)
    return flat


def op_smart_console(req: dict) -> dict:
    """One line typed in the Variables console (pretty math, LaTeX). It
    changes nothing itself — it says what the line means, and the
    calculator applies it:
      y = 5 · area = πr²     → set (or redefine) a variable, even before
                                what it uses exists (it fills in later)
      f(x) = x² + 1          → a function, usable everywhere as f(3)
      del y · clear          → remove one · remove them all
      anything else          → worked out, like the Calculate line"""
    latex = _typed(req.get("latex") or "")
    if not latex:
        raise MathInputError("")
    command = _command(latex)
    if re.fullmatch(r"clear(\(\))?", command, re.I):
        return {"kind": "clear"}
    gone = _DELETE.match(command)
    if gone:
        return {"kind": "delete", "name": gone.group(1)}

    items = [i for i in (req.get("items") or []) if (i.get("name") or "").strip()]
    names = [i["name"] for i in items]
    saving = _NEW_NAME.match(latex)
    marked = _mark_names(latex, [*names, *([saving.group(1)] if saving else [])])
    try:
        node = lang.parse(marked, "latex")
    except lang.Incomplete:
        raise MathInputError("") from None

    def resolved_with(item):
        values = resolve_variables([*[i for i in items if i["name"] != item["name"]], item])
        return values.get(item["name"], {})

    defined = _function_def(node)
    if defined:
        fname, param, body = defined
        item = {"name": fname, "latex": lang.latex(body), "params": [param]}
        mine = resolved_with(item)
        return {"kind": "assign", **item, "input_latex": lang.latex(node), "result_latex": f"{fname}({param}) = {item['latex']}", "decimal": None, "error": mine.get("error")}

    # name = …: always saves (like a REPL), even if what it uses isn't there yet
    if isinstance(node, lang.Rel) and node.ops == ["="] and isinstance(node.parts[0], Sym):
        item = {"name": node.parts[0].name, "latex": lang.latex(node.parts[1])}
        mine = resolved_with(item)
        return {
            "kind": "assign",
            **item,
            "input_latex": lang.latex(node),
            "result_latex": mine.get("latex"),
            "decimal": mine.get("decimal"),
            "error": mine.get("error"),
        }

    # anything else: worked out with the variables, like the Calculate line
    values = resolve_variables(items)
    vars_ = {(f"{n}({','.join(v['params'])})" if v.get("params") else n): v["plain"] for n, v in values.items() if "plain" in v}
    result = op_smart({"latex": latex, "vars": vars_, "angle": req.get("angle", "deg")})
    if result["kind"] == "choose":
        if isinstance(node, lang.Rel):
            raise MathInputError("that's an equation with several unknowns — solve it on the Calculate tab")
        result = op_smart({"latex": latex, "vars": vars_, "angle": req.get("angle", "deg"), "action": EXPRESSION_ACTIONS[0]})
    return {
        "kind": "value",
        "input_latex": result["input_latex"],
        "result_latex": result.get("result_latex"),
        "decimal": result.get("decimal"),
    }
