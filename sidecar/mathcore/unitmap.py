"""The unit map: each kind of unit as chains of links — km ×1000 m ×100 cm
×10 mm; h ×60 min ×60 s — every link a 1 : N relationship (1 km = 1000 m),
with bridges between systems (1 in = 2.54 cm, exact by definition), and
your own units linked to the one they're defined by (1 bag = 50 lb).

A conversion walks the map: 9 km/h → m/s goes km → m (× 1000) on the length
chain and h → min → s on the time chain — where, because hours are on the
bottom of km/h, each step divides (÷ 60 ÷ 60). Multiplying along the path
is the whole conversion: 9 × 1000 ÷ 60 ÷ 60 = 2.5."""

from collections import deque

import sympy

from . import lang, units
from .lang import Incomplete
from .parsing import MathInputError, tex

# per kind: chains, biggest unit first; and bridges between them
MAP = {
    "length": {"chains": [["km", "m", "cm", "mm"], ["mi", "yd", "ft", "in"]], "bridges": [("in", "cm"), ("mi", "km")]},
    "time": {"chains": [["wk", "day", "h", "min", "s"]], "bridges": []},
    "mass": {"chains": [["kg", "g", "mg"], ["lb", "oz"]], "bridges": [("lb", "kg")]},
    "volume": {"chains": [["L", "mL"], ["gal", "qt", "pt", "cup", "tbsp", "tsp"]], "bridges": [("gal", "L")]},
}
# units that are other units put together: 1 mph is 1 mi per 1 h
DERIVED = {"mph": [("mi", 1), ("h", -1)]}


def _n(a: str, b: str):
    """how many b in one a (1 km = 1000 m → 1000)"""
    return sympy.nsimplify(units.UNITS[a].size / units.UNITS[b].size)


def _terminates(value) -> bool:
    """a fraction that's a finite decimal (its bottom only 2s and 5s)"""
    q = sympy.Rational(value).q
    for p in (2, 5):
        while q % p == 0:
            q //= p
    return q == 1


def _nice(value) -> str:
    """exactly, as a decimal, when it is one (3.785411784); else ≈ 6 digits"""
    value = sympy.nsimplify(value)
    if value.is_Rational and _terminates(value):
        text = f"{float(value):.12f}".rstrip("0").rstrip(".")
        if sympy.Rational(text) == value:
            return text
    return f"≈ {float(value):.6g}"


def _step(by) -> tuple[str, object]:
    """multiplying by `by`, written the exact way round: × 1000, ÷ 60 (not
    × 1/60), × 0.45359237, ÷ 2.54 (not × 0.3937…)"""
    inv = sympy.nsimplify(1 / by)
    mul_exact, div_exact = _terminates(by), _terminates(inv)
    if by >= 1 and mul_exact:
        return "×", by
    if div_exact and (inv.is_Integer or not mul_exact):
        return "÷", inv
    return "×", by


def links() -> list[tuple[str, str]]:
    """every link on the map: chain neighbours, bridges, and your own units"""
    out = []
    for kind in MAP.values():
        for chain in kind["chains"]:
            out += list(zip(chain, chain[1:]))
        out += kind["bridges"]
    out += [(u.symbol, u.defined_by) for u in units.LIBRARY if getattr(u, "defined_by", None)]
    return [(a, b) for a, b in out if a in units.UNITS and b in units.UNITS]


def _path(a: str, b: str) -> list[str] | None:
    """the shortest walk on the map from a to b"""
    graph: dict[str, set] = {}
    for x, y in links():
        graph.setdefault(x, set()).add(y)
        graph.setdefault(y, set()).add(x)
    seen, queue = {a: None}, deque([a])
    while queue:
        here = queue.popleft()
        if here == b:
            path = [b]
            while seen[path[-1]] is not None:
                path.append(seen[path[-1]])
            return path[::-1]
        for nxt in sorted(graph.get(here, ())):
            if nxt not in seen:
                seen[nxt] = here
                queue.append(nxt)
    return None


def _units_list(unit_part) -> list[tuple[str, int]]:
    """km/h → [(km, 1), (h, -1)] — derived units (mph) taken apart"""
    out = []
    for f in sympy.Mul.make_args(unit_part):
        base, power = (f.base, int(f.exp)) if f.is_Pow else (f, 1)
        if not units.is_unit(base):
            continue
        sym = units.of(base).symbol
        if sym in DERIVED:
            out += [(s, p * power) for s, p in DERIVED[sym]]
        else:
            out.append((sym, power))
    return out


def op_unitmap(req: dict) -> dict:
    """The map, for drawing: each kind's chains (with the N on each link),
    its bridges, and your own units hung on the unit they're defined by."""
    kinds = []
    for kind, spec in MAP.items():
        chains = []
        for chain in spec["chains"]:
            present = [u for u in chain if u in units.UNITS]
            chains.append({"units": present, "links": [_nice(_n(a, b)) for a, b in zip(present, present[1:])]})
        bridges = [{"a": a, "b": b, "n": _nice(_n(a, b))} for a, b in spec["bridges"] if a in units.UNITS and b in units.UNITS]
        mine = [{"a": u.symbol, "b": u.defined_by, "n": _nice(_n(u.symbol, u.defined_by))} for u in units.LIBRARY if getattr(u, "defined_by", None) and u.kind == kind]
        names = {u.symbol: u.name for u in units.LIBRARY if u.kind == kind}
        kinds.append({"kind": kind, "chains": chains, "bridges": bridges, "mine": mine, "names": names})
    return {"kinds": kinds}


def op_unitpath(req: dict) -> dict:
    """An amount into other units, by walking the map: each kind's path,
    the step on each link (× or ÷ its N), and the arithmetic, start to end."""
    start_text, target_text = (req.get("from") or "").strip(), (req.get("to") or "").strip()
    if not start_text or not target_text:
        raise MathInputError("")
    try:
        start = sympy.simplify(lang.to_sympy(lang.parse(start_text, "latex")))
        target = sympy.simplify(lang.to_sympy(lang.parse(f"1\\,{target_text}", "latex")))
    except Incomplete:
        raise MathInputError("") from None
    number, from_units = units.split(start)
    _, to_units = units.split(target)
    if from_units == 1:
        raise MathInputError("give the amount a unit — a space after the number: 9 km/h")
    if to_units == 1:
        raise MathInputError("the units to go into — like m/s")
    if units.dimension(from_units) != units.dimension(to_units):
        raise MathInputError(f"a {units.kind_name(from_units)} can't become a {units.kind_name(to_units)} — they measure different things")

    have, want = _units_list(from_units), _units_list(to_units)
    parts = []
    factors = []  # (n, ×/÷) along every path, in order
    for sym, power in have:
        dim = units.UNITS[sym].dim
        match = next((i for i, (s, p) in enumerate(want) if units.UNITS[s].dim == dim and p == power), None)
        if match is None:
            raise MathInputError("those units don't line up kind by kind — try them one kind at a time")
        to_sym = want.pop(match)[0]
        path = _path(sym, to_sym) or []
        if not path:
            raise MathInputError(f"there's no path on the map from {sym} to {to_sym} yet")
        steps = []
        for a, b in zip(path, path[1:]):
            n = _n(a, b) if (a, b) in links() else 1 / _n(b, a)
            # a count of a, as a count of b: × n — on the bottom, ÷ n
            by = n if power > 0 else 1 / n
            for _ in range(abs(power)):
                op, shown = _step(sympy.nsimplify(by))
                steps.append({"a": a, "b": b, "op": op, "n": _nice(shown)})
                factors.append((op, shown))
        parts.append(
            {
                "kind": units.UNITS[sym].kind,
                "path": path,
                "on_bottom": power < 0,
                "steps": steps,
            }
        )
    value = number
    for op, n in factors:
        value = value * n if op == "×" else value / n
    value = sympy.nsimplify(value)
    arithmetic = " ".join([tex(number)] + [f"{'\\times' if op == '×' else '\\div'} {_nice(n)}" for op, n in factors]) if factors else tex(number)
    # an answer that's a finite decimal is shown as one, exactly (85.725)
    finite = value.is_Rational and _terminates(value)
    shown = _nice(value) if finite else tex(value)
    parts = [p for p in parts if p["steps"]]  # a unit that stays (h → h) has nothing to show
    return {
        "from_latex": units.latex(start),
        "to_latex": units.latex(to_units),
        "result_latex": f"{shown}\\,{units.latex(to_units)}" if finite else units.latex(value * to_units),
        "exact": bool(finite),
        "decimal": None if finite else f"{float(value):.10g}",
        "arithmetic": f"{arithmetic} = {shown}",
        "parts": parts,
        "path_units": sorted({u for p in parts for u in p["path"]}),
        "path_links": [[s["a"], s["b"]] for p in parts for s in p["steps"]],
    }
