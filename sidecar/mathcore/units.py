"""Units — a library of them, and numbers that carry them.

The library: each unit's symbol, its name (and plural), its kind (length,
time, mass, volume, speed) and its exact size in that kind's base unit
(1 in = 0.0254 m, exactly). It's data, so more can join it — your own units,
currency rates — without changing how the rest works.

A unit is written after a number with a space — 5 m, 10 s, 3 km/h — and is
always shown upright, as in a textbook (5 m is five meters; 5m, with no
space, is still 5 times m). Inside, a unit is a symbol, unit_m: so units
multiply, divide and cancel the way factors do (m/s · s = m), and only like
kinds add (5 m + 20 cm = 5.2 m; m + s is a mistake)."""

import re
from dataclasses import dataclass

import sympy
from sympy import Rational, Symbol

from .parsing import MathInputError

# a kind is powers of these: speed is length¹ · time⁻¹
BASE = ("length", "time", "mass")


@dataclass(frozen=True)
class Unit:
    symbol: str
    name: str
    plural: str
    kind: str
    dim: tuple
    #: its size in the kind's base unit (km: 1000, in meters)
    size: Rational


_KINDS = {
    "length": ((1, 0, 0), "m"),
    "area": ((2, 0, 0), "m²"),
    "volume": ((3, 0, 0), "m³"),
    "time": ((0, 1, 0), "s"),
    "mass": ((0, 0, 1), "kg"),
    "speed": ((1, -1, 0), "m/s"),
}


def _u(symbol, name, plural, kind, size):
    return Unit(symbol, name, plural, kind, _KINDS[kind][0], Rational(size))


LIBRARY = [
    _u("mm", "millimeter", "millimeters", "length", "1/1000"),
    _u("cm", "centimeter", "centimeters", "length", "1/100"),
    _u("m", "meter", "meters", "length", "1"),
    _u("km", "kilometer", "kilometers", "length", "1000"),
    _u("in", "inch", "inches", "length", "0.0254"),
    _u("ft", "foot", "feet", "length", "0.3048"),
    _u("yd", "yard", "yards", "length", "0.9144"),
    _u("mi", "mile", "miles", "length", "1609.344"),
    _u("s", "second", "seconds", "time", "1"),
    _u("min", "minute", "minutes", "time", "60"),
    _u("h", "hour", "hours", "time", "3600"),
    _u("day", "day", "days", "time", "86400"),
    _u("wk", "week", "weeks", "time", "604800"),
    # a year is 365 or 366 days; this is the average, 365.25 (science's year)
    _u("yr", "year", "years", "time", "31557600"),
    _u("mg", "milligram", "milligrams", "mass", "1/1000000"),
    _u("g", "gram", "grams", "mass", "1/1000"),
    _u("kg", "kilogram", "kilograms", "mass", "1"),
    _u("oz", "ounce", "ounces", "mass", "0.028349523125"),
    _u("lb", "pound", "pounds", "mass", "0.45359237"),
    _u("mL", "milliliter", "milliliters", "volume", "1/1000000"),
    _u("L", "liter", "liters", "volume", "1/1000"),
    _u("tsp", "teaspoon", "teaspoons", "volume", "0.00000492892159375"),
    _u("tbsp", "tablespoon", "tablespoons", "volume", "0.00001478676478125"),
    _u("cup", "cup", "cups", "volume", "0.0002365882365"),
    _u("pt", "pint", "pints", "volume", "0.000473176473"),
    _u("qt", "quart", "quarts", "volume", "0.000946352946"),
    _u("gal", "gallon", "gallons", "volume", "0.003785411784"),
    _u("mph", "mile per hour", "miles per hour", "speed", f"{Rational('1609.344') / 3600}"),
]
UNITS = {u.symbol: u for u in LIBRARY}
# more ways to write a few
ALIASES = {"sec": "s", "hr": "h", "hrs": "h", "lbs": "lb", "days": "day", "y": "yr", "ml": "mL", "l": "L"}

_PREFIX = "unit_"


def find(symbol: str) -> Unit | None:
    return UNITS.get(ALIASES.get(symbol, symbol))


def symbol(unit: Unit) -> Symbol:
    return Symbol(_PREFIX + unit.symbol)


def is_unit(s) -> bool:
    return isinstance(s, Symbol) and s.name.startswith(_PREFIX) and s.name[len(_PREFIX):] in UNITS


def of(s) -> Unit:
    return UNITS[s.name[len(_PREFIX):]]


def has_units(expr) -> bool:
    return any(is_unit(s) for s in getattr(expr, "free_symbols", ()))


def without_units(symbols) -> set:
    """free symbols that are letters, not units"""
    return {s for s in symbols if not is_unit(s)}


# ------------------------------------------------------------- recognizing


_RUN = r"[A-Za-z]+"
# after a number (a digit, or the end of a typed fraction), a space, then a
# unit: m · m^2 · m/s · \frac{m}{s}
_AFTER_NUMBER = re.compile(
    rf"(?<=[\d}}])(\s*\\,\s*|\s+)(?:\\frac\{{({_RUN})\}}\{{({_RUN})\}}|({_RUN})(?:\s*/\s*({_RUN}))?)"
)


def mark(latex: str) -> str:
    """A unit written after a number (5\\,m, 10\\,s, 5\\,\\frac{m}{s}) made
    explicit — \\mathrm{m} — so it's read as a unit, not a letter. Letters
    that aren't a unit in the library are left alone (5\\,x is 5x)."""

    def swap(m: re.Match) -> str:
        top, bottom = (m.group(2), m.group(3)) if m.group(2) else (m.group(4), m.group(5))
        found = [find(top), find(bottom) if bottom else None]
        if not found[0] or (bottom and not found[1]):
            return m.group(0)
        if bottom:
            return f"\\,\\frac{{\\mathrm{{{found[0].symbol}}}}}{{\\mathrm{{{found[1].symbol}}}}}"
        return f"\\,\\mathrm{{{found[0].symbol}}}"

    # the math field turns the letters min and sec into the functions \min
    # and \sec (minimum, secant) — as units (no brackets after) they're letters
    latex = re.sub(r"\\(min|sec)(?![A-Za-z])(?!\s*(?:\(|\\left))", r"\1", latex)
    return _AFTER_NUMBER.sub(swap, latex)


# ------------------------------------------------------------- quantities


def split(term):
    """a product as (its number part, its unit part)"""
    number, units = [], []
    for f in sympy.Mul.make_args(term):
        base = f.base if f.is_Pow else f
        (units if is_unit(base) else number).append(f)
    return sympy.Mul(*number), sympy.Mul(*units)


def dimension(unit_part) -> tuple:
    dim = [0] * len(BASE)
    for f in sympy.Mul.make_args(unit_part):
        base, power = (f.base, f.exp) if f.is_Pow else (f, 1)
        if is_unit(base):
            for i, d in enumerate(of(base).dim):
                dim[i] += d * power
    return tuple(dim)


def size(unit_part):
    """how big a product of units is, in base units"""
    total = sympy.Integer(1)
    for f in sympy.Mul.make_args(unit_part):
        base, power = (f.base, f.exp) if f.is_Pow else (f, 1)
        if is_unit(base):
            total *= of(base).size ** power
    return total


def kind_name(unit_part) -> str:
    dim = dimension(unit_part)
    for name, (d, _) in _KINDS.items():
        if d == dim:
            return name
    return "units"


def _one_unit_per_kind(term):
    """m/s · min → the minutes as seconds, so they cancel: within a term,
    each kind (by its base) is written in one unit — the one below the bar
    if there is one (so it cancels), else the bigger."""
    number, units = split(term)
    by_kind: dict = {}
    for f in sympy.Mul.make_args(units):
        base, power = (f.base, f.exp) if f.is_Pow else (f, 1)
        if is_unit(base):
            by_kind.setdefault(of(base).dim, []).append((base, power))
    for dim, found in by_kind.items():
        if len({b for b, _ in found}) < 2 or sum(1 for d in dim if d) != 1:
            continue
        below = [b for b, p in found if p < 0]
        keep = below[0] if below else max((b for b, _ in found), key=lambda b: of(b).size)
        for b, _ in found:
            if b != keep:
                term = term.subs(b, of(b).size / of(keep).size * keep)
    return sympy.simplify(term) if term.is_Mul else term


def normalize(expr):
    """Units made to agree: in each term one unit per kind (so they
    cancel), and a sum in one unit — 5 m + 20 cm → 5.2 m (the bigger unit);
    unlike kinds can't be added (meters and seconds)."""
    expr = sympy.expand(expr)
    terms = [_one_unit_per_kind(t) for t in sympy.Add.make_args(expr)]
    parts = [split(t) for t in terms]
    unitful = [u for _, u in parts if u != 1]
    if unitful and len(unitful) < len(parts):
        plain = next(n for n, u in parts if u == 1)
        raise MathInputError(f"a number with no unit can't be added to {_plural(unitful[0])} — give it a unit too (like ${sympy.latex(plain)}\\ \\mathrm{{{_first(unitful[0])}}}$)")
    if len({dimension(u) for u in unitful}) > 1:
        a, b = unitful[0], next(u for u in unitful if dimension(u) != dimension(unitful[0]))
        raise MathInputError(f"{_plural(a)} and {_plural(b)} can't be added — they're different kinds ({kind_name(a)}, {kind_name(b)})")
    if len({u for u in unitful}) > 1:
        target = max(unitful, key=size)
        terms = [n * size(u) / size(target) * target for n, u in parts]
    return sympy.Add(*terms)


def _first(unit_part) -> str:
    for f in sympy.Mul.make_args(unit_part):
        base = f.base if f.is_Pow else f
        if is_unit(base):
            return of(base).symbol
    return ""


def _plural(unit_part) -> str:
    names = [of(f.base if f.is_Pow else f).plural for f in sympy.Mul.make_args(unit_part) if is_unit(f.base if f.is_Pow else f)]
    return " per ".join(names) if names else "units"


# ------------------------------------------------------------- writing


def names() -> dict:
    """each unit symbol's LaTeX (upright)"""
    return {symbol(u): f"\\mathrm{{{u.symbol}}}" for u in LIBRARY}


def latex(expr, number_tex=None) -> str:
    """5 m/s as a textbook writes it: the number, a thin space, the units
    (upright, a fraction when some are below: 5\\,\\frac{m}{s})."""
    number_tex = number_tex or (lambda n: sympy.latex(n))
    out = []
    for term in sympy.Add.make_args(expr):
        number, units = split(term)
        if units == 1:
            out.append(number_tex(number))
            continue
        unit_tex = sympy.latex(units, symbol_names=names())
        coefficient = "" if number == 1 else "-" if number == -1 else number_tex(number)
        out.append(f"{coefficient}\\,{unit_tex}" if coefficient not in ("", "-") else f"{coefficient}{unit_tex}")
    return " + ".join(out).replace("+ -", "- ")


# what each kind is compared to in the library's list — an everyday unit
_REFERENCE = {"length": "m", "time": "s", "mass": "g", "volume": "mL", "speed": "m/s"}


def _nice(value) -> str:
    """exact when it's short (0.0254, 1609.344), else about (≈ 4.92892)"""
    value = Rational(value)
    if value.q == 1:
        return f"{int(value):,}"
    text = f"{float(value):.10f}".rstrip("0").rstrip(".")
    if Rational(text) == value and len(text.split(".")[-1]) <= 6:
        return text
    return f"≈ {float(value):.6g}"


def plain(unit_part) -> str:
    """units as plain text: m/s, m², kg·m/s²"""
    sup = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")

    def one(base, power):
        return of(base).symbol + ("" if power == 1 else str(power).translate(sup))

    found = [((f.base, f.exp) if f.is_Pow else (f, 1)) for f in sympy.Mul.make_args(unit_part)]
    top = "·".join(one(b, p) for b, p in found if is_unit(b) and p > 0) or "1"
    bottom = "·".join(one(b, -p) for b, p in found if is_unit(b) and p < 0)
    return f"{top}/{bottom}" if bottom else top


def library() -> list[dict]:
    """The library, by kind, for the Units panel: each unit's size in an
    everyday unit of its kind (1 ft = 0.3048 m, 1 cup ≈ 236.588 mL)."""
    out = []
    for kind, (_, base) in _KINDS.items():
        units = [u for u in LIBRARY if u.kind == kind]
        if not units:
            continue
        ref = _REFERENCE.get(kind)
        ref_size = UNITS[ref].size if ref in UNITS else (Rational(1) if ref == "m/s" else None)
        out.append(
            {
                "kind": kind,
                "base": base,
                "reference": ref,
                "units": [
                    {
                        "symbol": u.symbol,
                        "name": u.name,
                        "plural": u.plural,
                        "size_decimal": float(u.size),
                        "in_reference": None if u.symbol == ref or ref_size is None else _nice(u.size / ref_size),
                    }
                    for u in units
                ],
            }
        )
    return out


def op_units(req: dict) -> dict:
    return {"kinds": library(), "aliases": ALIASES}


# ------------------------------------------------------------- steps


def _factors(expr, power=1):
    """a product as (thing, power) pairs — through fractions (a/b is a·b⁻¹)"""
    if expr.is_Mul:
        return [p for f in expr.args for p in _factors(f, power)]
    if expr.is_Pow and expr.exp.is_Integer and expr.exp < 0 or expr.is_Pow and expr.exp == -1:
        return _factors(expr.base, power * expr.exp)
    if expr.is_Pow and expr.exp.is_Integer and is_unit(expr.base):
        return [(expr.base, power * expr.exp)]
    return [(expr, power)]


def _unit_tex(found, crossed=()) -> str:
    """units over units, the ones that cancel crossed out"""

    def one(base, power):
        text = f"\\mathrm{{{of(base).symbol}}}"
        text = f"\\cancel{{{text}}}" if base in crossed else text
        return text if power == 1 else f"{text}^{{{power}}}"

    top = [one(b, p) for b, p in found if p > 0]
    bottom = [one(b, -p) for b, p in found if p < 0]
    above = "\\,".join(top) or "1"
    return f"\\frac{{{above}}}{{{'\\,'.join(bottom)}}}" if bottom else above


def steps(raw, number_tex) -> list[dict] | None:
    """A product with units, worked by hand: units of one kind made one
    unit (minutes into hours), the numbers multiplied, then the units —
    what's on top and below cancels, crossed out. A sum: each part written
    in one unit, then added. None when there's nothing to show."""
    from .parsing import step  # here: parsing reads units

    if raw.is_Add:
        terms = [t for t in sympy.Add.make_args(raw)]
        evaluated = [split(sympy.simplify(t)) for t in terms]
        found = [u for _, u in evaluated if u != 1]
        if len({u for u in found}) < 2 or len({dimension(u) for u in found}) > 1:
            return None
        target = max(found, key=size)
        out = []
        for n, u in evaluated:
            if u != target:
                converted = sympy.nsimplify(n * size(u) / size(target))
                out.append(step(f"Write ${number_tex(n)}\\,{_unit_tex(_factors(u))}$ in {of(_factors(target)[0][0]).plural}", f"{number_tex(n)}\\,{_unit_tex(_factors(u))} = {number_tex(converted)}\\,{_unit_tex(_factors(target))}"))
        total = normalize(raw)
        out.append(step("Add — now they're in the same unit", latex(total, number_tex)))
        return out

    pairs = _factors(raw)
    numbers = [(f, p) for f, p in pairs if not is_unit(f)]
    found = [(f, p) for f, p in pairs if is_unit(f)]
    if not found or len(pairs) < 3:
        return None
    out = []

    def shown(nums):
        """the numbers, with the 1s of 1 km, 1 h left out"""
        kept = [(f, p) for f, p in nums if sympy.simplify(f) != 1] or [(sympy.Integer(1), 1)]
        return " \\cdot ".join(number_tex(f) if p == 1 else f"\\frac{{1}}{{{number_tex(f)}}}" for f, p in kept)

    out.append(step("Numbers together, units together", f"{shown(numbers)} \\cdot {_unit_tex(found)}"))
    number = sympy.Integer(1)
    for f, p in numbers:
        number *= sympy.simplify(f) ** p
    if len([f for f, _ in numbers if sympy.simplify(f) != 1]) > 1:
        out.append(step(f"Multiply the numbers: ${shown(numbers)} = {number_tex(number)}$", f"{number_tex(number)} \\cdot {_unit_tex(found)}"))
    # the units: the same unit on top and below cancels
    power: dict = {}
    for b, p in found:
        power[b] = power.get(b, 0) + p
    crossed = {b for b, _ in found if any(p > 0 for bb, p in found if bb == b) and any(p < 0 for bb, p in found if bb == b)}
    if crossed:
        names_ = ", ".join(f"$\\mathrm{{{of(b).symbol}}}$" for b in sorted(crossed, key=str))
        out.append(step(f"The units: {names_} on top and below cancel", f"{number_tex(number)} \\cdot {_unit_tex(found, crossed)}"))
    left = {b: p for b, p in power.items() if p}
    # what's left with two units of one kind (mi/h · min): one written in
    # the other, so they cancel too
    by_kind: dict = {}
    for b in left:
        by_kind.setdefault(of(b).dim, []).append(b)
    for dim, bases in by_kind.items():
        if len(bases) < 2 or sum(1 for d in dim if d) != 1:
            continue
        below = [b for b in bases if left[b] < 0]
        keep = below[0] if below else max(bases, key=lambda b: of(b).size)
        for b in bases:
            if b == keep:
                continue
            rate = of(b).size / of(keep).size
            number *= rate ** left[b]
            left[keep] = left.get(keep, 0) + left.pop(b)
            remaining = number * sympy.Mul(*[u ** p for u, p in left.items() if p])
            out.append(step(f"Write {of(b).plural} in {of(keep).plural} ($1\\,\\mathrm{{{of(b).symbol}}} = {number_tex(rate)}\\,\\mathrm{{{of(keep).symbol}}}$), so they cancel", latex(remaining, number_tex)))
    # the same unit more than once on top: m · m is m²
    for b, total in left.items():
        if total > 1 and sum(1 for bb, p in found if bb == b and p > 0) > 1:
            symbol_ = f"\\mathrm{{{of(b).symbol}}}"
            out.append(step(f"The units: ${' \\cdot '.join([symbol_] * total)} = {symbol_}^{{{total}}}$", latex(number * b**total, number_tex)))
    # the answer itself (worked out on its own, so this always agrees)
    out.append(step("So", latex(normalize(sympy.simplify(raw)), number_tex)))
    return out


def crossed_tex(raw) -> str | None:
    """A line that multiplies by conversion fractions, with what cancels
    crossed out: 9000 · 1/60 · m·h/(h·min). None when nothing cancels."""
    pairs = _factors(raw)
    found = [(f, p) for f, p in pairs if is_unit(f)]
    crossed = {b for b, _ in found if any(p > 0 for bb, p in found if bb == b) and any(p < 0 for bb, p in found if bb == b)}
    if not crossed:
        return None
    from .parsing import tex  # here: parsing reads units

    numbers = [(f, p) for f, p in pairs if not is_unit(f) and sympy.simplify(f) != 1]
    shown = " \\cdot ".join(tex(f) if p == 1 else f"\\frac{{1}}{{{tex(f)}}}" for f, p in numbers)
    return f"{shown} \\cdot {_unit_tex(found, crossed)}" if shown else _unit_tex(found, crossed)


# ------------------------------------------------------------- relationships

# the facts conversions are built from: (bigger, smaller) — each "1 bigger =
# n smaller", n from the library's sizes (so they're exact)
RELATIONS = [
    ("km", "m"), ("m", "cm"), ("cm", "mm"), ("in", "cm"), ("ft", "in"), ("yd", "ft"), ("mi", "ft"), ("mi", "km"),
    ("min", "s"), ("h", "min"), ("h", "s"), ("day", "h"), ("wk", "day"),
    ("kg", "g"), ("g", "mg"), ("lb", "oz"), ("lb", "kg"),
    ("L", "mL"), ("gal", "qt"), ("qt", "pt"), ("pt", "cup"), ("cup", "tbsp"), ("tbsp", "tsp"), ("gal", "L"),
]


def relations() -> list[dict]:
    out = []
    pairs = list(RELATIONS) + [(u.symbol, u.defined_by) for u in LIBRARY if getattr(u, "defined_by", None)]
    for a, b in pairs:
        if a not in UNITS or b not in UNITS:
            continue
        ratio = sympy.nsimplify(UNITS[a].size / UNITS[b].size)
        from .parsing import tex as _tex  # here: parsing reads units

        # a short decimal stays one (2.54, not 127/50) — no thousands
        # commas: these go into lines as typed math
        def tex(r, _tex=_tex):
            nice = _nice(r)
            return _tex(r) if nice.startswith("≈") else nice.replace(",", "")

        out.append(
            {
                "a": a,
                "b": b,
                "kind": UNITS[a].kind,
                "n_latex": tex(ratio),
                # the two fractions, each worth 1
                "over_a": f"\\frac{{{tex(ratio)}\\,\\mathrm{{{b}}}}}{{1\\,\\mathrm{{{a}}}}}",
                "over_b": f"\\frac{{1\\,\\mathrm{{{a}}}}}{{{tex(ratio)}\\,\\mathrm{{{b}}}}}",
                "fact": f"1\\,\\mathrm{{{a}}} = {tex(ratio)}\\,\\mathrm{{{b}}}",
                "custom": bool(getattr(UNITS[a], "defined_by", None)),
            }
        )
    return out


# ------------------------------------------------------------- your own units


@dataclass(frozen=True)
class CustomUnit(Unit):
    #: the unit it's defined by (1 bag = 50 lb → lb)
    defined_by: str = ""


class extra:
    """Your own units for one request: [{symbol, name?, plural?, equals}]
    — 1 bag = 50 lb is {symbol: "bag", equals: "50\\,lb"}. Each is a size of
    a library unit, so it converts and cancels like the rest."""

    def __init__(self, defs):
        self.defs = defs or []
        self.added: list[str] = []

    def __enter__(self):
        from . import lang  # here: lang reads units

        for d in self.defs:
            sym = str(d.get("symbol") or "").strip()
            if not sym or not sym.isalpha() or sym in UNITS:
                continue
            try:
                value = sympy.simplify(lang.to_sympy(lang.parse(str(d.get("equals") or ""), "latex")))
            except Exception:  # noqa: BLE001 — a definition that doesn't read is skipped
                continue
            number, unit_part = split(value)
            if unit_part == 1 or not number.is_number or number <= 0:
                continue
            base = _first(unit_part)
            dim = dimension(unit_part)
            kind = next((k for k, (dd, _) in _KINDS.items() if dd == dim), None)
            if kind is None:
                continue
            name = str(d.get("name") or sym).strip()
            unit = CustomUnit(sym, name, str(d.get("plural") or name + "s").strip(), kind, dim, sympy.nsimplify(number) * size(unit_part), base)
            UNITS[sym] = unit
            LIBRARY.append(unit)
            self.added.append(sym)
        return self

    def __exit__(self, *_):
        for sym in self.added:
            unit = UNITS.pop(sym, None)
            if unit in LIBRARY:
                LIBRARY.remove(unit)
        return False
