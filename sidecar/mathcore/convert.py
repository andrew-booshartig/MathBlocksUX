"""Converting a quantity — 9 km/h into m/s — the student's way, checked a
step at a time. Every line is the same amount as the start, written in other
units (9000 m/h, 150 m/min, 2.5 m/s) or the start times conversion fractions
(9 km/h · 1000 m/1 km). A line that's a different amount says exactly where
it slipped (9000 m/h is 150 m/min — 9000 ÷ 60 = 150); one that's right says
what changed (km → m: × 1000). Done when it's in the units asked for.

And the relationships the conversions are built from: the library's facts
(1 km = 1000 m, 1 h = 60 min), shown as fractions that are each 1."""

import sympy

from . import lang, units
from .lang import Incomplete
from .calculator import _fmt_decimal
from .parsing import MathInputError, tex


def _quantity(latex: str):
    """a quantity as typed — the same units cancelled, nothing converted"""
    expr = lang.to_sympy(lang.parse(latex, "latex"))
    letters = units.without_units(expr.free_symbols)
    if letters:
        raise MathInputError(f"{', '.join(sorted(map(str, letters)))} isn't a unit here — a unit goes after a number with a space: 9 km/h")
    return sympy.simplify(expr)


def _units_of(expr):
    number, unit_part = units.split(expr)
    return number, unit_part


def _amount(number, unit_part):
    return number * units.size(unit_part)


def _same(a, b) -> bool:
    try:
        return abs(float(a) - float(b)) <= 1e-9 * max(1.0, abs(float(a)))
    except TypeError:
        return False


def _q(number, unit_part) -> str:
    return units.latex(number * unit_part, lambda n: tex(n))


def _by(factor) -> str:
    """× 1000, ÷ 60 — what the number is multiplied by"""
    factor = sympy.nsimplify(factor)
    if factor == 1:
        return ""
    if factor > 1 and factor.is_Integer:
        return f"\\times {tex(factor)}"
    if factor < 1 and (1 / factor).is_Integer:
        return f"\\div {tex(1 / factor)}"
    return f"\\times {tex(factor)}"


def _changes(prev_units, line_units) -> str:
    """km → m, h → min: which unit became which"""
    def parts(u):
        found = []
        for f in sympy.Mul.make_args(u):
            base, power = (f.base, f.exp) if f.is_Pow else (f, 1)
            if units.is_unit(base):
                found.append((base, power))
        return found

    before, after = parts(prev_units), parts(line_units)
    out = []
    for b, p in before:
        if (b, p) in after:
            continue
        match = next((a for a, q in after if q == p and units.of(a).dim == units.of(b).dim and (a, q) not in before), None)
        if match is not None:
            out.append(f"\\mathrm{{{units.of(b).symbol}}} \\to \\mathrm{{{units.of(match).symbol}}}")
    return ",\\ ".join(out)


def op_convertlines(req: dict) -> dict:
    start_text = (req.get("from") or "").strip()
    target_text = (req.get("to") or "").strip()
    if not start_text:
        raise MathInputError("type the amount to convert — like 9 km/h")
    try:
        start = _quantity(start_text)
    except Incomplete:
        raise MathInputError("finish typing the amount — like 9 km/h") from None
    s_number, s_units = _units_of(start)
    if s_units == 1:
        raise MathInputError("give the amount a unit — a space after the number, then the unit: 9 km/h")
    out = {"start_latex": _q(s_number, s_units), "kind": units.kind_name(s_units), "units_now": units.latex(s_units)}
    target = None
    if target_text:
        try:
            t_number, target = _units_of(_quantity(f"1\\,{target_text}"))
        except Incomplete:
            target = None
        if target is not None:
            if target == 1:
                raise MathInputError("the units to convert into — like m/s")
            if units.dimension(target) != units.dimension(s_units):
                raise MathInputError(f"a {units.kind_name(s_units)} can't become a {units.kind_name(target)} — they measure different things")
            out["target_latex"] = units.latex(target)
            out["answer_latex"] = _q(sympy.nsimplify(_amount(s_number, s_units) / units.size(target)), target)
    whole = _amount(s_number, s_units)
    prev_number, prev_units = s_number, s_units
    lines = []
    for raw in req.get("lines") or []:
        if not raw.strip():
            lines.append({"status": "empty"})
            continue
        try:
            unevaluated = lang.to_sympy(lang.parse(raw, "latex"), evaluate=False)
            q = _quantity(raw)
        except Incomplete:
            lines.append({"status": "empty"})
            continue
        except MathInputError as exc:
            lines.append({"status": "error", "message": str(exc)})
            continue
        if q.is_Add:
            try:
                q = units.normalize(q)
            except MathInputError as exc:
                lines.append({"status": "error", "message": str(exc)})
                continue
        number, unit_part = _units_of(q)
        entry = {"latex": lang.latex(lang.parse(raw, "latex")), "units_latex": units.latex(unit_part) if unit_part != 1 else ""}
        crossed = units.crossed_tex(unevaluated)
        if crossed:
            entry["crossed_latex"] = crossed
        if unit_part == 1:
            entry.update(status="wrong", message=f"This has no units — the amount is a {units.kind_name(s_units)}, so its units stay with it (like ${_q(prev_number, prev_units)}$)")
        elif units.dimension(unit_part) != units.dimension(s_units):
            entry.update(
                status="wrong",
                message=f"This is a {units.kind_name(unit_part)} — the amount is a {units.kind_name(s_units)} (${units.latex(s_units)}$): every unit stays, just written another way",
            )
        elif _same(_amount(number, unit_part), whole):
            entry["status"] = "ok"
            what = _changes(prev_units, unit_part)
            by = _by(units.size(prev_units) / units.size(unit_part))
            if what or by:
                entry["what"] = f"${what}{':' if what and by else ''}\\ {by}$" if by else f"${what}$"
            if target is not None and sympy.simplify(unit_part / target) == 1:
                exact = sympy.nsimplify(number)
                decimal = "" if exact.is_Integer else f" $= {_fmt_decimal(float(exact))}\\,{units.latex(unit_part)}$"
                entry["done"] = f"That's it: ${_q(exact, unit_part)}${decimal}"
            prev_number, prev_units = number, unit_part
        else:
            right = sympy.nsimplify(whole / units.size(unit_part))
            factor = units.size(prev_units) / units.size(unit_part)
            by = _by(factor)
            arithmetic = f" — ${tex(prev_number)} {by} = {tex(right)}$" if by else ""
            entry.update(status="wrong", message=f"${_q(prev_number, prev_units)}$ is ${_q(right, unit_part)}${arithmetic}")
        lines.append(entry)
    out["lines"] = lines
    out["units_now"] = units.latex(prev_units)
    out["solved"] = any(l.get("done") for l in lines)
    return out


def op_relations(req: dict) -> dict:
    """The facts conversions are built from — each a pair of equal amounts,
    so either way up it's a fraction worth 1."""
    return {"relations": units.relations()}
