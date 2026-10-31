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
from .parsing import MathInputError, build_scope, parse, step, tex
from . import chain, units
from .arith import arithmetic_steps
from .solve import interval_tex, op_solve, set_relational_tex, set_to_segments, solve_system
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


_GLUED = re.compile(r"\\(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|log|ln|exp)\s*(?:\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}|([A-Za-z][A-Za-z0-9]*))")


def _unglue(latex: str, names) -> str:
    """The math field turns a word starting with a function's name into the
    function: cost → cos t, login → log in. Back into one word only when it's
    a name: in quotes ("cost"), or a variable there is already (cost). A
    space typed after it (cos\\,t) always means the function."""
    def join(m: re.Match) -> str:
        return m.group(1) + (m.group(2) or m.group(3))

    latex = re.sub(r'"[^"]*"', lambda q: _GLUED.sub(join, q.group(0)), latex)
    known = set(names)
    return _GLUED.sub(lambda m: join(m) if join(m) in known else m.group(0), latex)


_QUOTED = re.compile(r'"([^"]*)"|\\text\{([^{}]*)\}')


def _unquote(latex: str) -> tuple[str, list[str]]:
    """A word in quotes is a name: "price" = 10 saves price (one name, not
    p·r·i·c·e), and price is that name from then on. → the line without the
    quotes, and the names that were quoted. (\\text{ or } stays a word.)"""
    names: list[str] = []

    def one(m: re.Match) -> str:
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        if m.group(1) is None and raw.strip() in ("or", "and"):
            return m.group(0)
        word = re.sub(r"\\[,;:! ]|\s+", " ", raw).strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", word):
            raise MathInputError('a name is one word, starting with a letter: "price", "toyPrice"')
        names.append(word)
        return word

    return _QUOTED.sub(one, latex), names


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


_WORDS = {"pi", "E", "e", "oo", "sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "root", "or", "and"}


def _calls(text: str, functions) -> str:
    """'f*(3)' → 'f(3)' for the functions there are (otherwise it's f times 3)."""
    for name in functions:
        text = re.sub(rf"\b{re.escape(name)}\*\(", f"{name}(", text)
    return text


def _names(text: str) -> list[str]:
    """Every name a line uses — letters, variables and functions."""
    return sorted({n for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text) if not n.startswith("unit_")} - _WORDS)


def _dims(text: str, vars_: dict) -> dict | None:
    """How each variable sits in an answer — d/f → {d: 1, f: -1}, 9k →
    {k: 1}, k + 500 → {k: 1} — so the names on variables (kilometers,
    liters) can follow the math: the calculator cancels them like units.
    None: no variables, or a mix that isn't one kind of thing (k + f)."""
    used = [n for n in _names(text) if n in vars_]
    if not used:
        return None
    try:
        tags = {sympy.Symbol(n): sympy.Symbol(f"dim_{n}", positive=True) for n in used}
        values = {s: parse(vars_[s.name], build_scope(vars_)) for s in tags}
        # each variable whole (trip, not t·r·i·p), to tag with its name
        scope = {**build_scope(vars_, keep_symbolic=used), **{s.name: s for s in tags}}
        expr = parse(text, scope).xreplace({s: values[s] * tags[s] for s in tags})
        found = None
        for term in sympy.Add.make_args(sympy.expand(sympy.powsimp(expr))):
            powers = {t: e for t, e in term.as_powers_dict().items() if t in tags.values()}
            if any(not e.is_Integer for e in powers.values()) or (term.free_symbols & set(tags.values())) - set(powers):
                return None  # √k, sin(k): no name for that
            if not powers:
                continue  # k + 500: the 500 is more of the same
            if found is not None and powers != found:
                return None
            found = powers
    except Exception:  # noqa: BLE001 — then no names
        return None
    return {t.name[4:]: int(e) for t, e in (found or {}).items() if e}


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


def _unit_steps(node, vars_: dict) -> list[dict] | None:
    """Numbers with units worked by hand — the values put in (d = r·t →
    5 m/s · 10 s), the numbers multiplied, the units cancelled."""
    used = [n for n in _names(lang.write(node, "plain", PLAIN)) if n in vars_]
    try:
        if used:
            # a value with units as it's written: 5 m/s, not (5 m)/s
            values = {n: lang.parse(tex(sympy.sympify(vars_[n])), "latex") for n in used}
            node = _fill_in(node, values)
        # a chain of fractions, the way a class works units (factor-label);
        # else numbers together, units together
        worked = chain.steps(node) or units.steps(lang.to_sympy(node, evaluate=False), lambda n: tex(n, keep_order=True))
    except Exception:  # noqa: BLE001 — then just the answer
        return None
    if not worked:
        return None
    start = [step("Put in the values", lang.latex(node))] if used else [step("Start", lang.latex(node))]
    return start + worked


def _plain(latex: str) -> str:
    return lang.write(lang.parse(latex, "latex"), "plain", PLAIN)


def _letters(text: str, vars_: dict | None = None, names: list | None = None) -> list[str]:
    """The letters a line still needs (x and y first, then alphabetical) —
    anything the variables define has a value and doesn't count. With
    `names`, nothing is filled in: every name used, multi-letter ones whole."""
    scope = {**build_scope({}), **{n: sympy.Symbol(n) for n in names}} if names is not None else build_scope(vars_ or {})
    names: set[str] = set()
    # x < -2 or x > 5: the words split the parts too
    for side in re.split(r"<=|>=|<|>|=|\bor\b|\band\b", text):
        if side.strip():
            names |= {str(s) for s in units.without_units(parse(side, scope).free_symbols)}
    return sorted(names, key=lambda n: (n not in ("x", "y"), n != "x", n))


# ------------------------------------------------------------- variables


def _key_name(key: str) -> str:
    """'f(x)' → 'f' (a function's key in a vars map), 'r' → 'r'."""
    return key.split("(")[0].strip()


def resolve_variables(items: list[dict], context: dict | None = None) -> dict:
    """[{name, latex | value, params?}] → {name: {plain, latex, decimal, params?} or {error}}.
    A variable is a value; with `params` it's a function (f(x) = x² + 1).
    `latex` is pretty math as typed; `value` is plain text (2, 2*r — rows
    from before the console, or nudged by an Increment block). They may use
    each other in any order (d = 2r before r = 4 is fine), and `context`
    (plain values from elsewhere on the canvas) — something that depends
    on itself is reported, not looped on."""
    context = context or {}
    out: dict[str, dict] = {}
    texts: dict[str, str] = {}
    params_of: dict[str, list[str]] = {}
    names = [(i.get("name") or "").strip() for i in items]
    marked_names = [n for n in [*names, *map(_key_name, context)] if _NAME.match(n)]
    functions = [i["name"] for i in items if i.get("params")] + [_key_name(k) for k in context if "(" in k]
    for item in items:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        if not _NAME.match(name):
            out[name] = {"error": "a name is letters (and digits after the first letter)"}
            continue
        typed = (item.get("latex") or "").strip()
        if not typed and not str(item.get("value") or "").strip():
            out[name] = {"error": "no value yet"}
            continue
        try:
            texts[name] = _calls(_plain(_mark_names(typed, marked_names)) if typed else str(item["value"]).strip(), functions)
            if item.get("params"):
                params_of[name] = list(item["params"])
        except Exception:  # noqa: BLE001 — half-typed or unreadable
            out[name] = {"error": "can't read this value yet"}
    # this list's own names win over the canvas's
    known: dict[str, str] = {k: v for k, v in context.items() if _key_name(k) not in texts}
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
            free = {str(s) for s in units.without_units(value.free_symbols)} - set(params)
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
            if units.has_units(value):  # 5 m/s: a value with its units
                try:
                    q = op_calc({"expr": str(value)})
                except MathInputError as exc:
                    out[name] = {"error": str(exc)}
                    continue
                known[name] = q["exact_plain"]
                out[name] = {"plain": q["exact_plain"], "latex": q["exact_latex"], "decimal": q["decimal"] if q["exact_differs"] else None}
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
    # a plain value (2*r) shown the way it reads: 2r
    for item in items:
        name = (item.get("name") or "").strip()
        if name in out and not (item.get("latex") or "").strip() and str(item.get("value") or "").strip():
            try:
                out[name]["input_latex"] = lang.latex(lang.parse(str(item["value"]), "value", _VALUE_READER))
            except Exception:  # noqa: BLE001
                out[name]["input_latex"] = str(item["value"])
    return out


_ARROW = re.compile(r"\\(?:longrightarrow|rightarrow|to)(?![A-Za-z])|->|→")


def _units_text(latex: str) -> str:
    """the units after → as plain text: \\frac{cm^{3}}{cm^{2}} → cm^3/cm^2"""
    t = re.sub(r"\\(?:mathrm|operatorname|text|textrm)\{([^{}]*)\}", r"\1", latex)
    t = re.sub(r"\^\{(\d)\}", r"^\1", t)
    for _ in range(3):
        t = re.sub(r"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", t)
    t = re.sub(r"\\left|\\right|\\cdot|\\times", lambda m: "*" if m.group(0) in ("\\cdot", "\\times") else "", t)
    t = re.sub(r"\\[,;: ]|~", " ", t)
    return re.sub(r"[{}()]", "", t).strip()


def _units_latex(us: list[tuple[str, int]]) -> str:
    """units as written, top over bottom — cm³/cm² stays that (sympy would
    make it cm)"""

    def one(s, p):
        return units.UNITS[s].latex + (f"^{{{abs(p)}}}" if abs(p) != 1 else "")

    top = "\\,".join(one(s, p) for s, p in us if p > 0) or "1"
    bottom = "\\,".join(one(s, p) for s, p in us if p < 0)
    return f"\\frac{{{top}}}{{{bottom}}}" if bottom else top


def _convert_line(req: dict, left: str, right: str) -> dict:
    """amount → units: the amount worked out as usual, then converted one
    fact at a time (the Reference sheet's way) — each step's amount shown"""
    from .reference import _number, op_refconvert, read_units

    worked = op_smart({**req, "latex": left, "ans": None})
    if worked.get("kind") != "value":
        # 3kg: a unit written right against its number reads as letters
        stuck = next((m for m in re.finditer(r"(\d)([A-Za-z]+)", left) if units.find(m.group(2))), None)
        if stuck:
            raise MathInputError(f"put a space between the number and the unit: {stuck.group(1)} {stuck.group(2)} (without it, {stuck.group(0)} is letters multiplied)")
        raise MathInputError("→ converts an amount — like 50 mm³ → cm³")
    vars_ = req.get("vars") or {}
    text = lang.write(lang.parse(_mark_names(left, list(vars_)), "latex"), "plain", PLAIN)
    value = sympy.sympify(op_calc({"expr": text, "vars": vars_})["exact_plain"])
    if not units.has_units(value):
        raise MathInputError("that's a plain number — give it units (900 km) to convert")
    number, unit_part = units.split(value)
    target_text = _units_text(right)
    target = sympy.Mul(*[units.symbol(units.UNITS[s]) ** p for s, p in read_units(target_text)])  # for its plain text
    out = op_refconvert({"amount": str(number), "from": units.plain(unit_part), "to": target_text})
    result = sympy.sympify(out["to"]["amount"]["exact"])
    def shown(n, us) -> str:
        # exact: 0.05 when it ends, 25/6 when it doesn't
        number_tex = _number(n)["latex"]
        return f"{number_tex}\\,{_units_latex(read_units(us))}"

    # the work that got it here (the chain), then the conversion
    steps = worked.get("steps") or [step("Start", worked["result_latex"])]
    steps += [step(line["why"], shown(sympy.sympify(line["result"]["exact"]), line["units"] or out["to"]["units"])) for line in out["lines"]]
    result_latex = shown(result, target_text)
    decimal = None if (result.is_Rational and out["to"]["amount"].get("approx") is None) else f"{float(result):.6g} {units.plain(target)}"
    return {
        "input_latex": f"{worked['input_latex']} \\to {_units_latex(read_units(target_text))}",
        "names": worked.get("names", []),
        "kind": "value",
        "result_latex": result_latex,
        "decimal": decimal,
        # the ≈ answer, ready to calculate on with: 160.276 lb
        "decimal_latex": decimal and f"{float(result):.10g}\\,{_units_latex(read_units(target_text))}",
        "ans": result_latex,
        "steps": steps if len(steps) > 1 else None,
    }


def _plugged_in(node, right: str, vars_: dict) -> dict:
    """V = A·h/3 with its variables' numbers in place — V = 53000·150/3 —
    to start Show work with, so the arithmetic is yours to do."""
    used = [n for n in _names(right) if n in vars_]
    if not used:
        return {}
    try:
        values = {n: lang.parse(vars_[n], "value", _VALUE_READER) for n in used}
        return {"work_latex": lang.latex(dataclasses.replace(node, parts=[node.parts[0], _fill_in(node.parts[1], values)]))}
    except Exception:  # noqa: BLE001 — then Work gets the answer instead
        return {}


def op_formula(req: dict) -> dict:
    """An equation to load (V = A·h/3): the letter it works out (V) and the
    letters it needs a number for (A, h), in the order they're written."""
    known = [k.split("(")[0] for k in req.get("vars") or {}]
    latex, quoted = _unquote(_typed(_unglue(req.get("latex") or "", known)))
    if not latex:
        raise MathInputError("")
    # price · n: price is one name when it's a variable (or "quoted")
    saving = _NEW_NAME.match(latex)  # cost = …: one name on the left
    latex = _mark_names(latex, [*known, *quoted, *([saving.group(1)] if saving else [])])
    node = lang.parse(latex, "latex")
    if not (isinstance(node, lang.Rel) and node.ops == ["="] and isinstance(node.parts[0], Sym)):
        raise MathInputError("an equation with one letter on the left: V = A·h/3")
    target = node.parts[0].name
    right = lang.write(node.parts[1], "plain", PLAIN)
    needed = set(_letters(right, names=_names(right)))
    if target in needed:
        raise MathInputError(f"{target} is on both sides — put it alone on the left")
    order = [n for n in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", right) if n in needed]
    return {"target": target, "letters": list(dict.fromkeys(order)), "input_latex": lang.latex(node)}


def op_smart_vars(req: dict) -> dict:
    return {"values": resolve_variables(req.get("vars") or [], req.get("context") or {})}


# ---------------------------------------------------------------- a line


_DECIMAL = re.compile(r"(-?[\d.]+(?: \\times 10\^\{-?\d+\})?)(?: (.+))?")


def _decimal_latex(decimal: str) -> str | None:
    """the ≈ answer as math to go on with: "320.552 lb" → 320.552\\,\\mathrm{lb}"""
    m = _DECIMAL.fullmatch(decimal.strip())
    if not m:
        return None
    if not m.group(2):
        return m.group(1)
    from .reference import read_units

    try:
        return f"{m.group(1)}\\,{_units_latex(read_units(m.group(2)))}"
    except MathInputError:
        return None


def op_smart(req: dict) -> dict:
    out = _smart(req)
    if out.get("decimal") and not out.get("decimal_latex"):
        out["decimal_latex"] = _decimal_latex(out["decimal"])
    # Ans is worked with exact (√8 squared is 8, not 8.000000001), but the
    # line shows it as the decimal it is — 801.38/900, not (40069/50)/900
    ans = req.get("ans")
    if ans and _ANS.search(req.get("latex") or "") and "input_latex" in out:
        try:
            shown = _smart({"latex": ans}).get("decimal")
            shown = shown and _decimal_latex(shown)
            if shown:
                out["input_latex"] = _smart({**req, "ans": shown})["input_latex"]
        except MathInputError:
            pass
    return out


def _smart(req: dict) -> dict:
    known = [k.split("(")[0] for k in req.get("vars") or {}]
    # (before the spaces go: cos t with a space typed — cos\,t — is cosine)
    latex, quoted = _unquote(_typed(_unglue(req.get("latex") or "", known)))
    if not latex:
        raise MathInputError("")
    ans = req.get("ans")
    if _ANS.search(latex):
        if not ans:
            raise MathInputError("there's no answer yet to use as Ans")
        latex = _ANS.sub(lambda _: f"\\left({ans}\\right)", latex)
    # 50 mm³/cm² → cm³/cm²: worked out, then put in the new units
    arrow = _ARROW.split(latex)
    if len(arrow) > 2:
        raise MathInputError("one → per line")
    if len(arrow) == 2:
        return _convert_line(req, arrow[0], arrow[1])
    # two equations at once — 2x + y = 7, x − y = 2 — a system: solved
    # together, by substitution or by elimination
    parts = _system_parts(latex)
    if parts:
        return _system_line(req, parts)
    vars_ = req.get("vars") or {}
    functions = [k.split("(")[0] for k in vars_ if "(" in k]
    saving = _NEW_NAME.match(latex)
    latex = _mark_names(latex, [*(k.split("(")[0] for k in vars_), *([saving.group(1)] if saving else []), *quoted])
    try:
        node = lang.parse(latex, "latex")
    except lang.Incomplete as unfinished:  # said only on Enter (the preview stays quiet)
        raise MathInputError(str(unfinished)) from None
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
    # an equation or inequality — or several joined by or / and
    # (2x - 3 < -7 or 2x - 3 > 7, x + 1 < 3 and 2x > -8), solved together
    relation = isinstance(node, (lang.Rel, lang.Alts))
    names = _names(text)  # every name used (for live updates)
    letters = _letters(text, vars_)  # the ones that are still unknown
    base = {"input_latex": input_latex, "names": names}

    # name = value: save a variable (r = 4, d = 2r) — when the right side
    # has nothing unknown
    if isinstance(node, lang.Rel) and node.ops == ["="] and isinstance(node.parts[0], Sym):
        name = node.parts[0].name
        right = lang.write(node.parts[1], "plain", PLAIN)
        if name not in _letters(right) and not _letters(right, vars_):
            value = op_calc({"expr": right, "angle": req.get("angle", "deg"), "vars": vars_})
            worked = _unit_steps(node.parts[1], vars_) if units.has_units(sympy.sympify(value["exact_plain"])) else None
            return {
                **({"steps": worked} if worked else {}),
                **base,
                "kind": "assign",
                "name": name,
                "value_latex": lang.latex(node.parts[1]),
                # a word name upright, as one name (price, not p·r·i·c·e)
                "result_latex": f"{rf'\mathrm{{{name}}}' if len(name) > 1 else tex(sympy.Symbol(name))} = {value['exact_latex']}",
                "decimal": value["decimal"] if value["exact_differs"] else None,
                "ans": value["exact_latex"],
                # r = d/f: r is kilometers per liter, if d and f are named
                "dims": _dims(right, vars_),
                **_plugged_in(node, right, vars_),
            }

    # just numbers (or every letter has a value): work it out
    if not letters:
        if isinstance(node, lang.Alts):
            parts = [op_smart({**req, "latex": lang.latex(item), "action": None})["result_latex"] == "\\text{true}" for item in node.items]
            truth = all(parts) if node.word == "and" else any(parts)
            return {**base, "kind": "truth", "result_latex": "\\text{true}" if truth else "\\text{false}"}
        if relation:
            scope = build_scope(vars_)
            sides = [parse(part, scope) for part in _RELATION.split(text)]
            op = _RELATION.search(text).group(0)
            check = {"=": sympy.Eq, "<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge}[op]
            truth = bool(check(sympy.simplify(sides[0] - sides[1]), 0))
            return {**base, "kind": "truth", "result_latex": "\\text{true}" if truth else "\\text{false}"}
        value = op_calc({"expr": text, "angle": req.get("angle", "deg"), "vars": vars_})
        if units.has_units(sympy.sympify(value["exact_plain"])):
            # numbers with units: the numbers, then the units (cancelling)
            out = {**base, "kind": "value", "result_latex": value["exact_latex"], "decimal": value["decimal"] if value["exact_differs"] else None, "ans": value["exact_latex"]}
            worked = _unit_steps(node, vars_)
            if worked:
                out["steps"] = worked
            return out
        out = {
            **base,
            "kind": "value",
            "result_latex": value["exact_latex"],
            "decimal": value["decimal"] if value["exact_differs"] else None,
            # Ans is this answer, exact, as math (2√2, not 2.828…)
            "ans": value["exact_latex"],
            "dims": _dims(text, vars_),
        }
        # plain arithmetic worked by hand — fractions the way a class does
        # them — when there's more than one move to it: its steps, and Show
        # work (decimals typed stay decimals: not turned into fractions here)
        if not re.search(r"\d\.\d", latex):
            try:
                worked = arithmetic_steps(lang.to_sympy(node, evaluate=False))
            except Exception:  # noqa: BLE001 — then just the answer
                worked = None
            fractions = worked and any("frac" in note or "Simplify" in note for note, _ in worked[1:])
            if worked and (len(worked) > 2 or fractions):
                out["steps"] = [step(note, shown) for note, shown in worked]
                out["work"] = True
        return out

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

    numberline = None
    if action["kind"] == "solve":
        out = op_solve({"expr": text, "for": action["var"], "vars": vars_})
        result, steps = out.get("solution_latex", ""), out.get("steps", [])
        # an inequality's answer, drawn on a number line
        if out.get("kind") == "inequality" and out.get("numberline"):
            numberline = out["numberline"]
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
        "numberline": numberline,
        "action": action,
        # a simplified expression can be used again as Ans; a solution can't
        "ans": result if action["kind"] != "solve" else None,
        # the other things this line could do, offered as one-tap chips
        "others": [a for a in actions if a != action],
    }


_ORDERING = re.compile(r"\\(le|ge|lt|gt|leq|geq|neq?)(?![a-zA-Z])|[<>]")


def _system_parts(latex: str) -> list[str] | None:
    """equations side by side — split at a comma, ;, "and" or a new line
    that isn't inside brackets — when there are two or more, each with one =
    (a point like (2, 5) isn't two equations)"""
    text = re.sub(r"\\text\{\s*and\s*\}", "\x00", latex)
    text = re.sub(r"\\\\", "\x00", text)
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif depth == 0 and ch in ",;\x00":
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    parts = [p.strip().strip("\\,").strip() for p in parts if p.strip()]
    if len(parts) < 2 or any(p.count("=") != 1 or _ORDERING.search(p) for p in parts):
        return None
    return parts


def _system_line(req: dict, parts: list[str]) -> dict:
    vars_ = req.get("vars") or {}
    nodes = [lang.parse(p, "latex") for p in parts]
    want = (req.get("action") or {}).get("method", "auto")
    out = solve_system([lang.write(n, "plain", PLAIN) for n in nodes], vars_, want)
    steps = out.get("steps", [])
    used = "elimination" if any("Add the equations" in s.get("note", "") for s in steps) else "substitution"
    # the other way to solve it, one tap away (a 2×2 with one answer)
    two_by_two = len(parts) == 2 and len(out.get("variables", [])) == 2 and len(out.get("points") or []) == 1
    method = lambda m: {"kind": "system", "method": m, "label": f"By {m}"}  # noqa: E731
    lines = [lang.latex(n) for n in nodes]
    return {
        "kind": "result",
        "input_latex": "\\begin{cases} " + " \\\\ ".join(lines) + " \\end{cases}",
        "result_latex": out.get("solution_latex", ""),
        "steps": steps,
        "action": method(used),
        "others": [method(m) for m in ("substitution", "elimination") if m != used] if two_by_two else [],
        "ans": None,
        "system_lines": lines,
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
    context = req.get("vars") or {}  # the rest of the canvas's variables (plain)
    names = [i["name"] for i in items] + [_key_name(k) for k in context]
    functions = [i["name"] for i in items if i.get("params")] + [_key_name(k) for k in context if "(" in k]
    saving = _NEW_NAME.match(latex)
    marked = _mark_names(latex, [*names, *([saving.group(1)] if saving else [])])
    try:
        node = lang.parse(marked, "latex")
    except lang.Incomplete as unfinished:  # said only on Enter (the preview stays quiet)
        raise MathInputError(str(unfinished)) from None

    def resolved_with(item):
        values = resolve_variables([*[i for i in items if i["name"] != item["name"]], item], context)
        return values.get(item["name"], {})

    def plain(body) -> str:
        """the body as plain text, unresolved (2*r stays 2*r: when r changes,
        everything using this follows) — what the rest of the canvas reads"""
        return _calls(lang.write(body, "plain", PLAIN), functions)

    defined = _function_def(node)
    if defined:
        fname, param, body = defined
        item = {"name": fname, "latex": lang.latex(body), "params": [param]}
        mine = resolved_with(item)
        return {"kind": "assign", **item, "plain": plain(body), "input_latex": lang.latex(node), "result_latex": f"{fname}({param}) = {item['latex']}", "decimal": None, "error": mine.get("error")}

    # name = …: always saves (like a REPL), even if what it uses isn't there yet
    if isinstance(node, lang.Rel) and node.ops == ["="] and isinstance(node.parts[0], Sym):
        item = {"name": node.parts[0].name, "latex": lang.latex(node.parts[1])}
        mine = resolved_with(item)
        return {
            "kind": "assign",
            **item,
            "plain": plain(node.parts[1]),
            "input_latex": lang.latex(node),
            "result_latex": mine.get("latex"),
            "decimal": mine.get("decimal"),
            "error": mine.get("error"),
        }

    # anything else: worked out with the variables, like the Calculate line
    values = resolve_variables(items, context)
    own = {(f"{n}({','.join(v['params'])})" if v.get("params") else n): v["plain"] for n, v in values.items() if "plain" in v}
    vars_ = {**{k: v for k, v in context.items() if _key_name(k) not in values}, **own}
    result = op_smart({"latex": latex, "vars": vars_, "angle": req.get("angle", "deg")})
    if result["kind"] == "choose":
        if isinstance(node, lang.Rel):
            raise MathInputError("that's an equation with several unknowns — solve it in a Calculator")
        result = op_smart({"latex": latex, "vars": vars_, "angle": req.get("angle", "deg"), "action": EXPRESSION_ACTIONS[0]})
    return {
        "kind": "value",
        "input_latex": result["input_latex"],
        "result_latex": result.get("result_latex"),
        "decimal": result.get("decimal"),
    }


# ------------------------------------------------------- the Graph tab


def op_numberline(req: dict) -> dict:
    """The Graph tab's number line for what's typed — x < -2 or x > 5,
    -2 ≤ x < 3, x > 4 and x < 9, x = 4 — drawn only when Graph is pressed
    (simplifying is the student's job; whatever's typed, its solutions are
    what's shaded)."""
    from .worklines import Line  # here: worklines reads through lang too

    latex = _typed(req.get("latex") or "")
    if not latex:
        raise MathInputError("type what to graph — like x < 3")
    from .worklines import conclusion

    claim = conclusion(latex)
    if claim:  # an empty line, or the whole line shaded
        everything = claim == "all"
        return {
            "variable": "x",
            "latex": latex,
            "solution_latex": "\\text{all real numbers}" if everything else "\\text{no solution}",
            "interval_latex": "(-\\infty, \\infty)" if everything else "\\varnothing",
            "segments": [{"lo": None, "hi": None, "loClosed": False, "hiClosed": False}] if everything else [],
        }
    try:
        line = Line(latex)
    except lang.Incomplete as unfinished:
        raise MathInputError(str(unfinished) or "finish typing it first") from None
    if line.kind == "expression":
        raise MathInputError("a number line shows an inequality (or an equation) — like x < 3")
    letters = line.symbols
    if len(letters) != 1:
        raise MathInputError("a number line shows one letter — like x < 3" if letters else "there's no letter to graph — like x < 3")
    v = letters[0]
    try:
        solutions = line.solution_set(v)
    except Exception:  # noqa: BLE001
        raise MathInputError("I can't draw that one on a number line") from None
    # the solution set, as a textbook graphs it: an "or" is everything
    # either part allows (z < 4 or z ≥ −6 is the whole line — no dot at 4,
    # which is a solution), an "and" (or a chain) the overlap
    segments = set_to_segments(solutions)
    out = {
        "variable": str(v),
        "latex": line.latex(),
        "solution_latex": set_relational_tex(v, solutions),
        "interval_latex": interval_tex(solutions),
        "segments": segments,
    }
    # a compound whose answer hides its parts — an "or" whose parts overlap
    # (x ≤ 4 or x > 9/4 is every number: where did 4 and 9/4 go?), an "and"
    # whose parts never meet (no solution): each part is drawn too, on its
    # own row above the line, as it's done on paper (staggered)
    if line.alts:
        parts = [(part, set_to_segments(part.solution_set(v))) for part in line.alts]
        ends = lambda segs: {e for s in segs for e in (s["lo"], s["hi"]) if e is not None}  # noqa: E731
        hidden = set().union(*(ends(segs) for _, segs in parts)) - ends(segments)
        if not segments or hidden:
            out["parts"] = [{"label": _readable(part.node), "latex": lang.latex(part.node), "segments": segs} for part, segs in parts]
    return out


def _readable(node) -> str:
    """A part as a person would write it, for a label on a picture:
    3y + 7 < 2y, x ≥ −6 (no LaTeX, no * between a number and a letter)."""
    text = lang.write(node, "plain", PLAIN)
    text = re.sub(r"(?<=[\d)])\*(?=[A-Za-z(])", "", text).replace("*", "·").replace("**", "^")
    for ascii_, sign in (("<=", "≤"), (">=", "≥"), ("!=", "≠"), ("-", "−")):
        text = text.replace(ascii_, sign)
    return text


# ------------------------------------------------------- the unit linter


def op_smart_lint(req: dict) -> dict:
    """While you type: the units the line is reading (kg — kilograms), and
    letters that spell a unit but are being read as letters (m·L with no
    number before it) — so you see it register before you press Enter."""
    known = [k.split("(")[0] for k in req.get("vars") or {}]
    try:
        latex, _ = _unquote(_typed(_unglue(req.get("latex") or "", known)))
        node = lang.parse(latex, "latex")
    except Exception:  # noqa: BLE001 — half typed: nothing to say yet
        return {"units": [], "letters": []}
    seen: list = []
    letters: list = []

    def walk(n):
        if isinstance(n, Sym) and units.is_unit(sympy.Symbol(n.name)) and n.name not in seen:
            seen.append(n.name)
        if isinstance(n, Mul):
            run: list = []
            for i, f in enumerate([*n.factors, None]):
                joined = i > 0 and i < len(n.factors) and n.ops[i - 1] == "implicit"
                plain = isinstance(f, Sym) and len(f.name) == 1 and f.name not in known
                if plain and (joined or not run):
                    run.append(f.name)
                    continue
                word = "".join(run)
                if len(run) > 1 and units.find(word):
                    letters.append({"text": "·".join(run), "unit": units.find(word).display, "name": units.find(word).plural})
                run = [f.name] if plain else []
        for field in dataclasses.fields(n) if dataclasses.is_dataclass(n) else []:
            value = getattr(n, field.name)
            for child in value if isinstance(value, list) else [value]:
                if isinstance(child, tuple):
                    child = child[-1]
                if dataclasses.is_dataclass(child):
                    walk(child)

    walk(node)
    found = [units.of(sympy.Symbol(s)) for s in seen]
    return {"units": [{"symbol": u.display, "typed": u.symbol, "name": u.plural} for u in found], "letters": letters}
