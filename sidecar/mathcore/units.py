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

# a kind is powers of these: speed is length¹ · time⁻¹, a volt is
# kg·m²·s⁻³·A⁻¹ (what a volt is made of, so V·A can be seen to be W). Angle
# and information are their own (SI calls them pure numbers — here 30° stays
# 30°, not 0.52…)
BASE = ("length", "time", "mass", "current", "temperature", "amount", "angle", "information")


@dataclass(frozen=True)
class Unit:
    symbol: str
    name: str
    plural: str
    kind: str
    dim: tuple
    #: its size in the kind's base unit (km: 1000, in meters; ° is π/180 rad)
    size: object
    #: how it's shown, when that isn't how it's typed (ohm → Ω, uA → µA)
    shown: str = ""
    tex: str = ""
    #: where its zero sits, in the base unit (°C: 273.15 K) — only a plain
    #: temperature conversion uses it; a change of 5 °C is 5 K
    offset: object = 0

    @property
    def display(self) -> str:
        return self.shown or self.symbol

    @property
    def latex(self) -> str:
        return self.tex or f"\\mathrm{{{self.symbol}}}"


def _d(**powers) -> tuple:
    return tuple(powers.get(b.split()[0], 0) for b in BASE)


#        kind                     made of                           in SI
_KINDS = {
    "length": (_d(length=1), "m"),
    "area": (_d(length=2), "m²"),
    "volume": (_d(length=3), "m³"),
    "time": (_d(time=1), "s"),
    "mass": (_d(mass=1), "kg"),
    "speed": (_d(length=1, time=-1), "m/s"),
    "acceleration": (_d(length=1, time=-2), "m/s²"),
    "frequency": (_d(time=-1), "Hz"),
    "force": (_d(length=1, time=-2, mass=1), "N"),
    "pressure": (_d(length=-1, time=-2, mass=1), "Pa"),
    "energy": (_d(length=2, time=-2, mass=1), "J"),
    "power": (_d(length=2, time=-3, mass=1), "W"),
    "current": (_d(current=1), "A"),
    "charge": (_d(time=1, current=1), "C"),
    "voltage": (_d(length=2, time=-3, mass=1, current=-1), "V"),
    "resistance": (_d(length=2, time=-3, mass=1, current=-2), "Ω"),
    "conductance": (_d(length=-2, time=3, mass=-1, current=2), "S"),
    "capacitance": (_d(length=-2, time=4, mass=-1, current=2), "F"),
    "inductance": (_d(length=2, time=-2, mass=1, current=-2), "H"),
    "magnetic flux": (_d(length=2, time=-2, mass=1, current=-1), "Wb"),
    "magnetic field": (_d(time=-2, mass=1, current=-1), "T"),
    "current density": (_d(length=-2, current=1), "A/m²"),
    "temperature": (_d(temperature=1), "K"),
    "amount": (_d(amount=1), "mol"),
    "angle": (_d(angle=1), "rad"),
    "angular speed": (_d(angle=1, time=-1), "rad/s"),
    "information": (_d(information=1), "bit"),
    "data rate": (_d(information=1, time=-1), "bit/s"),
}


def _size(size):
    return Rational(size) if isinstance(size, str) else sympy.nsimplify(size) if isinstance(size, float) else size


def _u(symbol, name, plural, kind, size, shown="", tex="", offset=0):
    return Unit(symbol, name, plural, kind, _KINDS[kind][0], _size(size), shown, tex, _size(offset) if offset else 0)


# the metric prefixes: typed (u for micro), shown (µ), LaTeX, name, size
PREFIXES = {
    "T": ("T", "\\mathrm{T}", "tera", Rational(10) ** 12),
    "G": ("G", "\\mathrm{G}", "giga", Rational(10) ** 9),
    "M": ("M", "\\mathrm{M}", "mega", Rational(10) ** 6),
    "k": ("k", "\\mathrm{k}", "kilo", Rational(1000)),
    "h": ("h", "\\mathrm{h}", "hecto", Rational(100)),
    "da": ("da", "\\mathrm{da}", "deca", Rational(10)),
    "d": ("d", "\\mathrm{d}", "deci", Rational(1, 10)),
    "c": ("c", "\\mathrm{c}", "centi", Rational(1, 100)),
    "m": ("m", "\\mathrm{m}", "milli", Rational(1, 1000)),
    "u": ("µ", "\\mu", "micro", Rational(1, 10**6)),
    "n": ("n", "\\mathrm{n}", "nano", Rational(1, 10**9)),
    "p": ("p", "\\mathrm{p}", "pico", Rational(1, 10**12)),
}


def _family(symbol, name, plural, kind, size, prefixes, shown="", tex=""):
    """a unit and its metric relatives: V, then kV, mV, µV …"""
    base = _u(symbol, name, plural, kind, size, shown, tex)
    out = [base]
    for p in prefixes:
        p_shown, p_tex, p_name, factor = PREFIXES[p]
        out.append(
            _u(
                p + symbol,
                p_name + name,
                p_name + plural,
                kind,
                base.size * factor,
                p_shown + base.display if (shown or p != p_shown) else "",
                p_tex + (tex or f"\\mathrm{{{symbol}}}") if (tex or p != p_shown) else "",
            )
        )
    return out


_EVERYDAY = ["k", "h", "da", "d", "c", "m", "u"]
_PI = sympy.pi
LIBRARY = [
    # metric, every prefix a class meets (km … µm, nm)
    *_family("m", "meter", "meters", "length", "1", [*_EVERYDAY, "n"]),
    *_family("g", "gram", "grams", "mass", "1/1000", _EVERYDAY),
    *_family("L", "liter", "liters", "volume", "1/1000", _EVERYDAY),
    *_family("s", "second", "seconds", "time", "1", ["m", "u", "n", "p"]),
    # length, more
    _u("in", "inch", "inches", "length", "0.0254"),
    _u("ft", "foot", "feet", "length", "0.3048"),
    _u("yd", "yard", "yards", "length", "0.9144"),
    _u("mi", "mile", "miles", "length", "1609.344"),
    _u("mil", "mil", "mils", "length", "0.0000254"),  # a thousandth of an inch (wire, circuit boards)
    _u("nmi", "nautical mile", "nautical miles", "length", "1852"),
    _u("angstrom", "angstrom", "angstroms", "length", "1/10000000000", shown="Å", tex="\\text{Å}"),
    _u("au", "astronomical unit", "astronomical units", "length", "149597870700"),
    _u("ly", "light-year", "light-years", "length", "9460730472580800"),
    # area
    _u("ha", "hectare", "hectares", "area", "10000"),
    _u("acre", "acre", "acres", "area", "4046.8564224"),
    # volume, more
    _u("tsp", "teaspoon", "teaspoons", "volume", "0.00000492892159375"),
    _u("tbsp", "tablespoon", "tablespoons", "volume", "0.00001478676478125"),
    _u("floz", "fluid ounce", "fluid ounces", "volume", "0.0000295735295625", shown="fl oz", tex="\\mathrm{fl\\,oz}"),
    _u("cup", "cup", "cups", "volume", "0.0002365882365"),
    _u("pt", "pint", "pints", "volume", "0.000473176473"),
    _u("qt", "quart", "quarts", "volume", "0.000946352946"),
    _u("gal", "gallon", "gallons", "volume", "0.003785411784"),
    # mass, more
    _u("oz", "ounce", "ounces", "mass", "0.028349523125"),
    _u("lb", "pound", "pounds", "mass", "0.45359237"),
    _u("t", "tonne", "tonnes", "mass", "1000"),
    _u("ton", "ton", "tons", "mass", "907.18474"),  # US short ton, 2000 lb
    # time beyond seconds
    _u("min", "minute", "minutes", "time", "60"),
    _u("h", "hour", "hours", "time", "3600"),
    _u("day", "day", "days", "time", "86400"),
    _u("wk", "week", "weeks", "time", "604800"),
    # a year is 365 or 366 days; this is the average, 365.25 (science's year)
    _u("yr", "year", "years", "time", "31557600"),
    _u("decade", "decade", "decades", "time", "315576000"),
    _u("century", "century", "centuries", "time", "3155760000"),
    # speed
    _u("mph", "mile per hour", "miles per hour", "speed", f"{Rational('1609.344') / 3600}"),
    _u("kph", "kilometer per hour", "kilometers per hour", "speed", "5/18"),
    _u("kn", "knot", "knots", "speed", f"{Rational(1852, 3600)}"),
    # force, pressure, energy, power — beyond SI
    _u("lbf", "pound-force", "pounds-force", "force", "4.4482216152605"),
    _u("kgf", "kilogram-force", "kilograms-force", "force", "9.80665"),
    *_family("Pa", "pascal", "pascals", "pressure", "1", ["h", "k", "M", "G"]),
    *_family("bar", "bar", "bars", "pressure", "100000", ["m"]),
    _u("atm", "atmosphere", "atmospheres", "pressure", "101325"),
    _u("psi", "pound per square inch", "pounds per square inch", "pressure", f"{Rational('4.4482216152605') / Rational('0.0254') ** 2}"),
    _u("mmHg", "millimeter of mercury", "millimeters of mercury", "pressure", "133.322387415"),
    _u("torr", "torr", "torr", "pressure", f"{Rational(101325, 760)}"),
    *_family("cal", "calorie", "calories", "energy", "4.184", ["k"]),
    _u("Cal", "food Calorie", "food Calories", "energy", "4184"),
    *_family("eV", "electronvolt", "electronvolts", "energy", "1.602176634e-19", ["k", "M", "G"]),
    _u("BTU", "British thermal unit", "British thermal units", "energy", "1055.05585262"),
    _u("hp", "horsepower", "horsepower", "power", "745.69987158227022"),
    # electrical engineering: what flows, what pushes it, what resists it,
    # what's stored, and how fast it changes
    *_family("A", "ampere", "amperes", "current", "1", ["k", "m", "u", "n", "p"]),
    *_family("V", "volt", "volts", "voltage", "1", ["M", "k", "m", "u"]),
    *_family("ohm", "ohm", "ohms", "resistance", "1", ["G", "M", "k", "m"], shown="Ω", tex="\\Omega"),
    *_family("S", "siemens", "siemens", "conductance", "1", ["m", "u"]),
    *_family("W", "watt", "watts", "power", "1", ["G", "M", "k", "m", "u"]),
    *_family("J", "joule", "joules", "energy", "1", ["G", "M", "k"]),
    *_family("Wh", "watt-hour", "watt-hours", "energy", "3600", ["k", "M", "G"]),
    *_family("C", "coulomb", "coulombs", "charge", "1", ["m", "u", "n"]),
    *_family("Ah", "amp-hour", "amp-hours", "charge", "3600", ["m"]),
    *_family("F", "farad", "farads", "capacitance", "1", ["m", "u", "n", "p"]),
    *_family("H", "henry", "henries", "inductance", "1", ["m", "u", "n"]),
    *_family("Hz", "hertz", "hertz", "frequency", "1", ["k", "M", "G"]),
    *_family("Wb", "weber", "webers", "magnetic flux", "1", ["m"]),
    *_family("T", "tesla", "teslas", "magnetic field", "1", ["m", "u"]),
    _u("G", "gauss", "gauss", "magnetic field", "1/10000"),
    *_family("N", "newton", "newtons", "force", "1", ["k"]),
    # temperature: kelvin from absolute zero; °C and °F have their own zeros
    *_family("K", "kelvin", "kelvins", "temperature", "1", ["m"]),
    _u("degC", "degree Celsius", "degrees Celsius", "temperature", "1", shown="°C", tex="\\text{°C}", offset="273.15"),
    _u("degF", "degree Fahrenheit", "degrees Fahrenheit", "temperature", "5/9", shown="°F", tex="\\text{°F}", offset=f"{Rational('459.67') * Rational(5, 9)}"),
    # amount of substance (chemistry)
    *_family("mol", "mole", "moles", "amount", "1", ["k", "m", "u", "n"]),
    # angles: a full turn is 360° or 2π radians
    _u("rad", "radian", "radians", "angle", 1),
    _u("mrad", "milliradian", "milliradians", "angle", Rational(1, 1000)),
    _u("deg", "degree", "degrees", "angle", _PI / 180, shown="°", tex="\\text{°}"),
    _u("arcmin", "arcminute", "arcminutes", "angle", _PI / 10800, shown="′", tex="\\text{′}"),
    _u("arcsec", "arcsecond", "arcseconds", "angle", _PI / 648000, shown="″", tex="\\text{″}"),
    _u("rev", "revolution", "revolutions", "angle", 2 * _PI),
    _u("grad", "gradian", "gradians", "angle", _PI / 200),
    _u("rpm", "revolution per minute", "revolutions per minute", "angular speed", 2 * _PI / 60),
    # data: a byte is 8 bits; kB is 1000 bytes, KiB is 1024
    *_family("bit", "bit", "bits", "information", "1", ["k", "M", "G", "T"]),
    *_family("B", "byte", "bytes", "information", "8", ["k", "M", "G", "T"]),
    _u("KiB", "kibibyte", "kibibytes", "information", 8 * 1024),
    _u("MiB", "mebibyte", "mebibytes", "information", 8 * 1024**2),
    _u("GiB", "gibibyte", "gibibytes", "information", 8 * 1024**3),
    _u("TiB", "tebibyte", "tebibytes", "information", 8 * 1024**4),
    *_family("bps", "bit per second", "bits per second", "data rate", "1", ["k", "M", "G"]),
]
UNITS = {u.symbol: u for u in LIBRARY}
# more ways to write them: words (amps, ohms, kilometers), the shown form
# (Ω, kΩ, µA), and a few short ones
ALIASES = {
    "sec": "s", "hr": "h", "hrs": "h", "lbs": "lb", "days": "day", "y": "yr", "ml": "mL", "l": "L",
    "amp": "A", "amps": "A", "Ω": "ohm", "µ": "u", "mcg": "ug", "cc": "mL", "°": "deg", "degrees": "deg",
    "°C": "degC", "°F": "degF", "Celsius": "degC", "Fahrenheit": "degF", "celsius": "degC", "fahrenheit": "degF",
    "turn": "rev", "turns": "rev", "revs": "rev", "rps": "Hz", "knots": "kn", "kt": "kn", "Å": "angstrom",
    "tonne": "t", "metric ton": "t", "byte": "B", "bytes": "B",
}
for _unit in LIBRARY:
    for _word in (_unit.name, _unit.plural, _unit.display):
        if _word not in UNITS and " " not in _word:
            ALIASES.setdefault(_word, _unit.symbol)
    if _unit.symbol.endswith("ohm"):  # kohm, kilohm
        ALIASES.setdefault(_unit.symbol[: -3] + "Ω", _unit.symbol)

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
_POW = r"(?:\^\{?\d\}?)?"
_AFTER_NUMBER = re.compile(
    rf"(?:(?<=[\d}}])|(?<=\\pi))(\s*\\,\s*|\s+)(?:\\frac\{{({_RUN}){_POW}\}}\{{({_RUN})({_POW})\}}|({_RUN})(?:\s*/\s*({_RUN}))?)"
)


def mark(latex: str) -> str:
    """A unit written after a number (5\\,m, 10\\,s, 5\\,\\frac{m}{s}) made
    explicit — \\mathrm{m} — so it's read as a unit, not a letter. Letters
    that aren't a unit in the library are left alone (5\\,x is 5x)."""

    def swap(m: re.Match) -> str:
        typed_frac = m.group(2) is not None
        top, bottom = (m.group(2), m.group(3)) if typed_frac else (m.group(5), m.group(6))
        found = [find(top), find(bottom) if bottom else None]
        if not found[0] or (bottom and not found[1]):
            return m.group(0)
        if bottom:
            # A over dm²: the powers stay where they were typed
            top_pow = re.search(r"\^\{?\d\}?", m.group(0)[: m.group(0).index("}{")]) if typed_frac else None
            bottom_pow = m.group(4) if typed_frac else ""
            return f"\\,\\frac{{\\mathrm{{{found[0].symbol}}}{top_pow.group(0) if top_pow else ''}}}{{\\mathrm{{{found[1].symbol}}}{bottom_pow}}}"
        return f"\\,\\mathrm{{{found[0].symbol}}}"

    # the math field turns the letters min and sec into the functions \min
    # and \sec (minimum, secant) — as units (no brackets after) they're letters
    latex = re.sub(r"\\(min|sec)(?![A-Za-z])(?!\s*(?:\(|\\left))", r"\1", latex)
    # 5 kΩ and 3 µA, typed with the symbols: their letters (kohm, uA)
    latex = re.sub(r"([A-Za-z]?)\s*\\Omega(?![A-Za-z])", r"\1ohm", latex)
    latex = re.sub(r"\\mu\s*(?=[A-Za-z])", "u", latex)
    latex = _AFTER_NUMBER.sub(swap, latex)

    # 12 V/4 kΩ, typed: the math field puts just the V over the bar —
    # 12\\,\\frac{V}{4\\,kohm}. A unit alone on top, right after a number,
    # is a unit too (the bottom's units were found above)
    def over(m: re.Match) -> str:
        unit = find(m.group(2))
        return f"{m.group(1)}\\frac{{\\mathrm{{{unit.symbol}}}{m.group(3)}}}{{" if unit else m.group(0)

    return re.sub(rf"(?<=[\d}}])(\s*\\,\s*|\s+)\\frac\{{({_RUN})({_POW})\}}\{{", over, latex)


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
        # a rate in two units of one kind (50 mm³ per cm²): kept as written —
        # it's only made one unit when it cancels away (h and min in
        # km/h · 30 min) or sits all on one side (km · m)
        if len({p > 0 for _, p in found}) > 1 and sum(p for _, p in found) != 0:
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
    return {symbol(u): u.latex for u in LIBRARY}


def latex(expr, number_tex=None, *, amount: bool = False) -> str:
    """5 m/s as a textbook writes it: the number, a thin space, the units
    (upright, a fraction when some are below: 5\\,\\frac{m}{s}). amount:
    it's an answer, so 1 m² keeps its 1 (units alone, m², don't)."""
    number_tex = number_tex or (lambda n: sympy.latex(n))
    out = []
    for term in sympy.Add.make_args(expr):
        number, units = split(term)
        if units == 1:
            out.append(number_tex(number))
            continue
        unit_tex = sympy.latex(units, symbol_names=names(), mul_symbol="dot")
        coefficient = "" if number == 1 and not amount else "-" if number == -1 and not amount else number_tex(number)
        out.append(f"{coefficient}\\,{unit_tex}" if coefficient not in ("", "-") else f"{coefficient}{unit_tex}")
    return " + ".join(out).replace("+ -", "- ")


def plain(unit_part) -> str:
    """units as plain text: m/s, m², kg·m/s²"""
    sup = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")

    def one(base, power):
        return of(base).display + ("" if power == 1 else str(power).translate(sup))

    found = [((f.base, f.exp) if f.is_Pow else (f, 1)) for f in sympy.Mul.make_args(unit_part)]
    top = "·".join(one(b, p) for b, p in found if is_unit(b) and p > 0) or "1"
    bottom = "·".join(one(b, -p) for b, p in found if is_unit(b) and p < 0)
    return f"{top}/{bottom}" if bottom else top


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
        text = of(base).latex
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
        names_ = ", ".join(f"${of(b).latex}$" for b in sorted(crossed, key=str))
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
            out.append(step(f"Write {of(b).plural} in {of(keep).plural} ($1\\,{of(b).latex} = {number_tex(rate)}\\,{of(keep).latex}$), so they cancel", latex(remaining, number_tex)))
    # the same unit more than once on top: m · m is m²
    for b, total in left.items():
        if total > 1 and sum(1 for bb, p in found if bb == b and p > 0) > 1:
            symbol_ = of(b).latex
            out.append(step(f"The units: ${' \\cdot '.join([symbol_] * total)} = {symbol_}^{{{total}}}$", latex(number * b**total, number_tex)))
    # the answer itself (worked out on its own, so this always agrees)
    out.append(step("So", latex(normalize(sympy.simplify(raw)), number_tex)))
    return out
