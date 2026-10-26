"""The reference sheet: unit facts (1 km = 1000 m), and any conversion
written out as calculator lines — the way you'd do it by hand:

    9 km/h → m/s       9 × 1000     = 9000   meters per hour
                       Ans ÷ 60     = 150    meters per minute
                       Ans ÷ 60     = 2.5    meters per second

Each line is one fact on the way (km → m, then per hour → per minute → per
second), named with what the number is now — so it can go straight into
the calculator's history, labels and all. Exact throughout: 250 ÷ 60 is
25/6, not 4.1666667."""

from collections import deque

import re

import sympy
from sympy import Rational

from .parsing import MathInputError


# the calculator's own units — one library for both
from .units import LIBRARY, PREFIXES, UNITS  # noqa: E402

# more ways to write a few (and units that are others put together)
ALIASES = {"sec": "s", "secs": "s", "hr": "h", "hrs": "h", "lbs": "lb", "metre": "m", "metres": "m", "ml": "mL", "l": "L"}
COMBINED = {"mph": [("mi", 1), ("h", -1)], "kph": [("km", 1), ("h", -1)]}

# the facts, neighbour to neighbour — every conversion walks these
CHAINS = {
    "length": [["km", "m", "cm", "mm"], ["mi", "yd", "ft", "in"]],
    "time": [["wk", "day", "h", "min", "s"]],
    "angle": [["rev", "deg", "arcmin", "arcsec"]],
    "information": [["B", "bit"], ["TiB", "GiB", "MiB", "KiB", "B"]],
    "mass": [["kg", "g", "mg"], ["lb", "oz"]],
    "volume": [["L", "mL"], ["gal", "qt", "pt", "cup", "tbsp", "tsp"]],
}
# where the metric and US chains meet (and the year, which isn't a whole
# number of weeks)
BRIDGES = {
    "length": [("in", "cm"), ("mi", "km")],
    "time": [("yr", "day")],
    "mass": [("lb", "kg")],
    "volume": [("gal", "L")],
    # an amp-hour is an amp for an hour; a watt-hour, a watt for an hour
    "charge": [("Ah", "C")],
    "energy": [("Wh", "J"), ("cal", "J"), ("Cal", "kcal"), ("BTU", "J"), ("eV", "J")],
    "angle": [("rad", "deg"), ("grad", "deg")],
    "pressure": [("atm", "kPa"), ("bar", "kPa"), ("psi", "kPa"), ("mmHg", "Pa"), ("torr", "mmHg")],
    "power": [("hp", "W")],
    "force": [("lbf", "N"), ("kgf", "N")],
    "area": [("acre", "ha")],
    "speed": [("mph", "kph"), ("kn", "kph")],
}
BRIDGES["length"] += [("nmi", "m"), ("mil", "in"), ("angstrom", "nm"), ("au", "km"), ("ly", "km")]
BRIDGES["mass"] += [("t", "kg"), ("ton", "lb")]
BRIDGES["time"] += [("decade", "yr"), ("century", "decade")]


def _prefixed() -> dict[str, list[tuple[str, str]]]:
    """each metric unit and its base, by kind: kA–A, mA–A, µA–A (one fact
    each: a prefix is a size — kilo is 1000)"""
    out: dict[str, list] = {}
    for u in LIBRARY:
        for p in sorted(PREFIXES, key=len, reverse=True):
            base = UNITS.get(u.symbol[len(p) :]) if u.symbol.startswith(p) else None
            # nmi is a nautical mile, not a nano-mile: the size has to fit
            if base and base.kind == u.kind and base is not u and sympy.simplify(u.size - base.size * PREFIXES[p][3]) == 0:
                out.setdefault(u.kind, []).append((u.symbol, base.symbol))
                break
    return out


_PREFIX_LINKS = _prefixed()
KINDS = [*CHAINS, *[k for k in _PREFIX_LINKS if k not in CHAINS]]

POPULAR = [("km/h", "m/s"), ("mph", "km/h"), ("in", "mm"), ("mi", "km"), ("ft", "m"), ("lb", "kg"), ("gal", "L"), ("h", "s"), ("A/dm^2", "A/m^2"), ("mA", "A"), ("kWh", "J")]

# how electrical units are made of each other — the facts behind V = I·R
# and P = V·I (any of these converts too: V·A → W)
RELATIONS = [
    ("1 W = 1 V·A", "V·A", "W", "power = voltage × current"),
    ("1 V = 1 A·Ω", "A·ohm", "V", "Ohm's law: V = I·R"),
    ("1 J = 1 W·s", "W·s", "J", "energy = power × time"),
    ("1 C = 1 A·s", "A·s", "C", "charge = current × time"),
    ("1 kWh = 3.6 MJ", "kWh", "MJ", "a kilowatt for an hour"),
    ("1 S = 1/Ω", "1/ohm", "S", "conductance is 1 ÷ resistance"),
    ("1 Hz = 1/s", "1/s", "Hz", "once per second"),
    ("1 F = 1 C/V", "C/V", "F", "charge stored per volt"),
    ("°F = °C × 9/5 + 32", "degC", "degF", "Celsius to Fahrenheit"),
    ("K = °C + 273.15", "degC", "K", "Celsius to kelvin"),
    ("1 rev = 2π rad", "rev", "rad", "a full turn"),
    ("1 Pa = 1 N/m²", "N/m^2", "Pa", "pressure = force ÷ area"),
]


def _links(kind: str | None = None) -> list[tuple[str, str]]:
    out = []
    for k in KINDS if kind is None else [kind]:
        for chain in CHAINS.get(k, []):
            out += list(zip(chain, chain[1:]))
        out += BRIDGES.get(k, [])
        out += [link for link in _PREFIX_LINKS.get(k, []) if link not in out and link[::-1] not in out]
    return out


def _how_many(a: str, b: str):
    """how many b in one a (km, m → 1000)"""
    return UNITS[a].size / UNITS[b].size


def _path(a: str, b: str) -> list[str]:
    """the shortest walk from a to b, fact by fact"""
    graph: dict[str, set] = {}
    for x, y in _links():
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
    # no chain between them (atm and psi): one step, by their sizes
    return [a, b]


def _terminates(value) -> bool:
    """a fraction that's a finite decimal (its bottom only 2s and 5s)"""
    value = sympy.nsimplify(value)
    if not value.is_Rational:
        return False  # π/180 never ends
    q = Rational(value).q
    for p in (2, 5):
        while q % p == 0:
            q //= p
    return q == 1


def _decimal(value) -> str:
    """exact digits: 1609.344, 0.0254 (only for ones that end)"""
    value = Rational(value)
    places = 0
    while not (value * 10**places).is_Integer:
        places += 1
    digits = str(abs(int(value * 10**places))).rjust(places + 1, "0")
    whole, frac = digits[: len(digits) - places], digits[len(digits) - places :]
    return ("-" if value < 0 else "") + whole + (f".{frac}" if places else "")


def _number(value) -> dict:
    """{latex, text, exact, approx?}: exact (2.5, 25/6 as a fraction, 180/π)
    — ≈ when it doesn't end"""
    value = sympy.nsimplify(value)
    if not value.is_Rational:
        return {"latex": sympy.latex(value), "text": sympy.sstr(value).replace("pi", "π").replace("*", ""), "exact": str(value), "approx": f"{float(value):.6g}"}
    value = Rational(value)
    if _terminates(value):
        return {"latex": _decimal(value), "text": _decimal(value), "exact": str(value)}
    if value.q > 10000:
        # 1290320000000/8896443230521 says nothing — its decimal does
        decimal = f"{float(value):.10g}"
        return {"latex": decimal, "text": f"≈ {float(value):.6g}", "exact": str(value), "approx": f"{float(value):.6g}"}
    sign = "-" if value < 0 else ""
    return {"latex": f"{sign}\\frac{{{abs(value.p)}}}{{{value.q}}}", "text": f"{value.p}/{value.q}", "exact": str(value), "approx": f"{float(value):.6g}"}


def _lookup(word: str):
    w = word.strip()
    from .units import find  # the calculator's own names for every unit (kΩ, amps, µA)

    if find(w):
        return find(w)
    if w in ALIASES:
        return UNITS[ALIASES[w]]
    low = w.lower().rstrip(".")
    for u in LIBRARY:
        if low in (u.symbol.lower(), u.name, u.plural):
            return u
    if low in ALIASES:
        return UNITS[ALIASES[low]]
    raise MathInputError(f"“{w}” isn't a unit on the sheet")


_SUP = {"²": 2, "³": 3}


def read_units(text: str) -> list[tuple[str, int]]:
    """km/h, kilometers per hour, mph, ft^2, m² → [(km, 1), (h, -1)]. Top
    and bottom stay apart: cm³/cm² is cm³ per cm², not cm."""
    text = re.sub(r"\s+per\s+", "/", text.strip(), flags=re.I)
    if not text:
        raise MathInputError("which units?")
    out: dict[tuple[str, int], int] = {}
    for k, piece in enumerate(text.split("/")):
        sign = 1 if k == 0 else -1
        for token in re.split(r"[*·×\s]+", piece.strip()):
            if not token or token == "1":
                continue  # 1/s: nothing on top
            m = re.fullmatch(r"(.+?)(?:\^(\d)|([²³]))?", token)
            word, power = m.group(1), int(m.group(2) or _SUP.get(m.group(3) or "", 1))
            if word.lower() in COMBINED:
                for sym, p in COMBINED[word.lower()]:
                    side = sign * (1 if p > 0 else -1)
                    out[(sym, side)] = out.get((sym, side), 0) + sign * p * power
                continue
            sym = _lookup(word).symbol
            out[(sym, sign)] = out.get((sym, sign), 0) + sign * power
    return [(s, p) for (s, _), p in out.items() if p]


_POWER_WORD = {2: "square ", 3: "cubic "}


def describe(us: list[tuple[str, int]], amount=None) -> str:
    """meters per hour · square feet · kilometer (one)"""
    one = amount is not None and sympy.nsimplify(amount) == 1
    top = [f"{_POWER_WORD.get(p, '')}{UNITS[s].name if one else UNITS[s].plural}" for s, p in us if p > 0]
    bottom = [f"{_POWER_WORD.get(-p, '')}{UNITS[s].name}" for s, p in us if p < 0]
    return " ".join(top or ["1"]) + "".join(f" per {b}" for b in bottom)


def _symbols(us: list[tuple[str, int]]) -> str:
    def one(s, p):
        return UNITS[s].display + ("" if abs(p) == 1 else {2: "²", 3: "³"}.get(abs(p), f"^{abs(p)}"))

    top = "·".join(one(s, p) for s, p in us if p > 0) or "1"
    bottom = "·".join(one(s, p) for s, p in us if p < 0)
    return f"{top}/{bottom}" if bottom else top


def _fact(a: str, b: str) -> tuple[str, str]:
    """the link's fact, the way it's defined — the big unit first (1 h =
    60 min), unless that number never ends (1 lb = 0.45359237 kg, not
    1 kg = 2.2046… lb)"""
    big, small = (a, b) if UNITS[a].size > UNITS[b].size else (b, a)
    if not _terminates(_how_many(big, small)):
        if not _terminates(_how_many(small, big)):
            return a, b  # neither ends: the way the link is written (1 psi ≈ 6.89 kPa)
        big, small = small, big
    return big, small


_SUPS = {2: "²", 3: "³"}


def _dims(us: list[tuple[str, int]]) -> tuple:
    """what a list of units is made of (length, time, mass, current)"""
    total = [0] * len(UNITS["m"].dim)
    for s, p in us:
        for i, d in enumerate(UNITS[s].dim):
            total[i] += d * p
    return tuple(total)


def _size(us: list[tuple[str, int]]):
    out = Rational(1)
    for s, p in us:
        out *= UNITS[s].size ** p
    return out


def _amount(text: str):
    try:
        return Rational(text)
    except (TypeError, ValueError):
        value = sympy.sympify(text.replace("π", "pi"))
        if not value.is_number:
            raise ValueError(text) from None
        return value


def _temperature(amount, a: str, b: str) -> dict:
    """°C → °F: × 9/5, then + 32 — the way it's taught (and °F → °C: − 32,
    then × 5/9): every temperature measured from its own zero"""
    ua, ub = UNITS[a], UNITS[b]
    scale = ua.size / ub.size
    # b = (a·size_a + offset_a − offset_b) / size_b, written whichever way
    # round has the plain number to add (32, not 160/9)
    after = (ua.offset - ub.offset) / ub.size  # multiply, then add this
    before = (ua.offset - ub.offset) / ua.size  # or add this, then multiply
    value = amount * scale + after
    steps = []
    if _terminates(after) or not _terminates(before):
        order = [("×", scale), ("+", after)]
    else:
        order = [("+", before), ("×", scale)]
    current = amount
    for op, by in order:
        if op == "×" and by == 1 or op == "+" and by == 0:
            continue
        if op == "+":
            current = current + by
            sign, shown = ("+", by) if by >= 0 else ("−", -by)
            latex_op = "+" if by >= 0 else "-"
        else:
            current = current * by
            sign, shown, latex_op = "×", by, "\\times"
        steps.append((sign, shown, latex_op, current))
    fact = f"{ua.display} → {ub.display}: " + ", then ".join(f"{s} {_number(n)['text']}" for s, n, _, _ in steps)
    lines = []
    for i, (sign, shown, latex_op, current) in enumerate(steps):
        lines.append(
            {
                "latex": f"{_number(amount)['latex'] if i == 0 else '\\mathrm{Ans}'} {latex_op} {_number(shown)['latex']}",
                "op": sign,
                "by": _number(shown)["text"],
                "by_latex": _number(shown)["latex"],
                "result": _number(current),
                "label": describe([(b, 1)], current) if i == len(steps) - 1 else "",
                "units": ub.display if i == len(steps) - 1 else "",
                "why": fact if i == 0 else ("then " + f"{sign} {_number(shown)['text']}"),
            }
        )
    one = _number(amount)["latex"]
    for sign, shown, latex_op, _ in steps:
        one = f"({one} {latex_op} {_number(shown)['latex']})" if latex_op != "\\times" else f"{one} {latex_op} {_number(shown)['latex']}"
    return {
        "from": {"amount": _number(amount), "label": describe([(a, 1)], amount), "units": ua.display},
        "to": {"amount": _number(value), "label": describe([(b, 1)], value), "units": ub.display},
        "lines": lines,
        "one_line": one,
        "factor": None,
    }


def _direct(amount, start: list, goal: list) -> dict:
    """units built differently but the same kind of thing (V·A → W, kWh →
    J): one step, by what each is made of"""
    by = _size(start) / _size(goal)
    if by >= 1 and _terminates(by) or not _terminates(1 / by):
        op, shown = "×", by
    else:
        op, shown = "÷", 1 / by
    value = amount * by
    relation = next((why for text, a, b, why in RELATIONS if {_symbols(read_units(a)), _symbols(read_units(b))} == {_symbols(start), _symbols(goal)}), None)
    fact = f"1 {_symbols(start)} = {_number(by)['text']} {_symbols(goal)}".replace("= ≈", "≈") + (f" ({relation})" if relation else "")
    line = {
        "latex": f"{_number(amount)['latex']} {_TEX[op]} {_number(shown)['latex']}",
        "op": op,
        "by": _number(shown)["text"],
        "by_latex": _number(shown)["latex"],
        "result": _number(value),
        "label": describe(goal, value),
        "units": _symbols(goal),
        "why": f"{fact}: {op} {_number(shown)['text']}" if shown != 1 else fact,
    }
    return {
        "from": {"amount": _number(amount), "label": describe(start, amount), "units": _symbols(start)},
        "to": {"amount": _number(value), "label": describe(goal, value), "units": _symbols(goal)},
        "lines": [line],
        "one_line": f"{_number(amount)['latex']} {_TEX[op]} {_number(shown)['latex']}",
        "factor": _number(value / amount) if amount else None,
    }
_TEX = {"×": "\\times", "÷": "\\div", "+": "+", "−": "-"}


def op_refconvert(req: dict) -> dict:
    """{amount, from, to} → the calculator lines that convert it, each with
    why, and the number it gives (named: meters per hour)."""
    amount_text = str(req.get("amount") or "1").strip().replace(",", "")
    try:
        mixed = re.fullmatch(r"(-?)(\d+)\s+(\d+/\d+)", amount_text)  # 3 3/8
        amount = (-1 if mixed.group(1) else 1) * (Rational(mixed.group(2)) + Rational(mixed.group(3))) if mixed else _amount(amount_text)
    except (TypeError, ValueError, SyntaxError) as exc:
        raise MathInputError("the amount is a number — like 9, 3.5 or 3 3/8") from exc
    start, goal = read_units(str(req.get("from") or "")), read_units(str(req.get("to") or ""))

    def kinds(us):
        out: dict[str, list] = {}
        for s, p in us:
            out.setdefault(UNITS[s].kind, []).append((s, p))
        return out

    # °C ↔ °F ↔ K: each has its own zero, so it's not just a multiply
    if len(start) == 1 == len(goal) and start[0][1] == 1 == goal[0][1] and UNITS[start[0][0]].kind == "temperature" == UNITS[goal[0][0]].kind and (UNITS[start[0][0]].offset or UNITS[goal[0][0]].offset):
        return _temperature(amount, start[0][0], goal[0][0])
    # the same kind of thing? — by what each unit is made of (V·A is W)
    if _dims(start) != _dims(goal):
        raise MathInputError(f"{_symbols(start)} is {describe(start)}, {_symbols(goal)} is {describe(goal)} — they measure different things")
    # each unit and the one it becomes: same kind, same power — mm³ → cm³
    # and cm² → cm², even with two lengths in one rate
    partner: dict[int, str] = {}
    left = list(goal)
    for i, (sym, p) in enumerate(start):
        match = next(((s2, p2) for s2, p2 in left if UNITS[s2].kind == UNITS[sym].kind and p2 == p), None)
        if match is None:
            return _direct(amount, start, goal)
        left.remove(match)
        partner[i] = match[0]
    if left:
        return _direct(amount, start, goal)

    current = [list(sp) for sp in start]
    value = amount
    lines = []
    # the top units first (km → m), then the bottom ones (per h → per s)
    for i, (sym, p) in sorted(enumerate(start), key=lambda e: -e[1][1]):
        target = partner[i]
        if target == sym:
            continue
        path = _path(sym, target)
        for here, there in zip(path, path[1:]):
            n = _how_many(here, there)  # there's in one here
            # squared: 1 ft = 12 in, so 1 ft² = 12² = 144 in²
            by = n**p
            # the exact way round: × 1000, ÷ 60 (not × 1/60), ÷ 2.54
            if by >= 1 and _terminates(by) or not _terminates(1 / by):
                op, shown = "×", by
            else:
                op, shown = "÷", 1 / by
            value = value * by
            current[i][0] = there
            us = sorted(((u, q) for u, q in current), key=lambda sp: -sp[1])
            # 1 km = 1000 m: kilometers → meters, × 1000
            # 1 h = 60 min: per hour → per minute, ÷ 60
            big, small = _fact(here, there)
            B, Sm = UNITS[big].display, UNITS[small].display
            fact = f"1 {B} = {_number(_how_many(big, small))['text']} {Sm}".replace("= ≈", "≈")
            if abs(p) > 1:
                fact += f", so 1 {B}{_SUPS[abs(p)]} = {_number(_how_many(big, small) ** abs(p))['text']} {Sm}{_SUPS[abs(p)]}"
            change = f"{describe([(here, p)])} → {describe([(there, p)])}" if p > 0 else f"per {describe([(here, -p)], 1)} → per {describe([(there, -p)], 1)}"
            why = f"{fact}: {change}, {op} {_number(shown)['text']}"
            left = _number(amount)["latex"] if not lines else "\\mathrm{Ans}"
            lines.append(
                {
                    "latex": f"{left} {_TEX[op]} {_number(shown)['latex']}",
                    "op": op,
                    "by": _number(shown)["text"],
                    "by_latex": _number(shown)["latex"],
                    "result": _number(value),
                    "label": describe(us, value),
                    "units": _symbols(us),
                    "why": why,
                }
            )
    one_line = _number(amount)["latex"] + "".join(f" {_TEX[line['op']]} {line['by_latex']}" for line in lines)
    return {
        "from": {"amount": _number(amount), "label": describe(start, amount), "units": _symbols(start)},
        "to": {"amount": _number(value), "label": describe(goal, value), "units": _symbols(goal)},
        "lines": lines,
        "one_line": one_line,
        # the same thing as one number: 9 × (1000 ÷ 3600)
        "factor": _number(value / amount) if amount else None,
    }


def op_reference(req: dict) -> dict:
    """the sheet: each kind's units and facts, and some conversions people
    look up most"""
    kinds = []
    for kind in KINDS:
        facts = []
        for a, b in _links(kind):
            big, small = _fact(a, b)
            n = _number(_how_many(big, small))
            facts.append({"big": big, "small": small, "n": n, "text": f"1 {UNITS[big].display} = {n['text']} {UNITS[small].display}".replace("= ≈", "≈"), "names": f"{UNITS[big].name} · {UNITS[small].plural}"})
        kinds.append(
            {
                "kind": kind,
                "units": [{"symbol": u.symbol, "shown": u.display, "name": u.name, "plural": u.plural} for u in LIBRARY if u.kind == kind],
                "facts": facts,
            }
        )
    relations = [{"text": text, "from": a, "to": b, "why": why} for text, a, b, why in RELATIONS]
    return {"kinds": kinds, "relations": relations, "popular": [{"from": a, "to": b} for a, b in POPULAR], "combined": sorted(COMBINED)}
