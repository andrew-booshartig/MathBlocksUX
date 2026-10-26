"""The unit map: each kind of unit as chains of links — km ×1000 m ×100 cm
×10 mm; h ×60 min ×60 s — every link a 1 : N relationship (1 km = 1000 m),
with bridges between systems (1 in = 2.54 cm, exact by definition), and
your own units linked to the one they're defined by (1 bag = 50 lb).

A conversion walks the map: 9 km/h → m/s goes km → m (× 1000) on the length
chain and h → min → s on the time chain — where, because hours are on the
bottom of km/h, each step divides (÷ 60 ÷ 60). Multiplying along the path
is the whole conversion: 9 × 1000 ÷ 60 ÷ 60 = 2.5."""

import re
from collections import deque

import sympy

from . import lang, units
from .lang import Incomplete
from .parsing import MathInputError, tex

# per kind: chains, biggest unit first; and bridges between them
MAP = {
    "length": {"chains": [["km", "m", "cm", "mm"], ["mi", "yd", "ft", "in"]], "bridges": [("in", "cm"), ("mi", "km")]},
    "time": {"chains": [["wk", "day", "h", "min", "s"]], "bridges": [("yr", "day")]},
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
    """exactly, as a decimal, when it is one (3.785411784, 160934.4); else
    ≈ 6 digits"""
    value = sympy.nsimplify(value)
    if value.is_Rational and _terminates(value):
        for places in range(0, 25):
            scaled = value * 10**places
            if scaled.is_Integer:
                digits = str(abs(int(scaled))).rjust(places + 1, "0")
                whole, frac = digits[: len(digits) - places], digits[len(digits) - places :]
                return ("-" if value < 0 else "") + whole + (f".{frac}" if places else "")
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
    return convert(start, units.split(target)[1])


def _amount_tex(value) -> str:
    return _nice(value) if value.is_Rational and _terminates(value) else tex(value)


def convert(start, to_units, typed_number: str | None = None) -> dict:
    """start (a number with units) into to_units, walked on the map — with,
    for each step, the amount it gives (9 km/h → 9000 m/h → 150 m/min → …)."""
    number, from_units = units.split(start)
    if from_units == 1:
        raise MathInputError("give the amount a unit — 9 km/h")
    if to_units == 1:
        raise MathInputError("the units to go into — like m/s")
    if units.dimension(from_units) != units.dimension(to_units):
        raise MathInputError(f"a {units.kind_name(from_units)} can't become a {units.kind_name(to_units)} — they measure different things")

    have, want = _units_list(from_units), _units_list(to_units)
    parts = []
    factors = []  # (n, ×/÷) along every path, in order
    # the walk: the amount after each step, in the units it's in by then
    value = number
    now: dict = {}
    for sym, power in have:
        now[sym] = now.get(sym, 0) + power
    walk = [{"note": "Start", "latex": f"{typed_number or _amount_tex(number)}\\,{units.latex(from_units)}"}]
    derived = [units.of(f.base if f.is_Pow else f).symbol for f in sympy.Mul.make_args(from_units) if units.is_unit(f.base if f.is_Pow else f) and units.of(f.base if f.is_Pow else f).symbol in DERIVED]
    if derived:
        spelled = sympy.Mul(*[units.symbol(units.UNITS[u]) ** p for u, p in now.items() if p])
        walk.append({"note": ", ".join(f"{d} means " + " per ".join(s for s, _ in DERIVED[d]) for d in derived), "latex": f"{_amount_tex(number)}\\,{units.latex(spelled)}"})
    years = False
    for sym, power in have:
        dim = units.UNITS[sym].dim
        match = next((i for i, (s, p) in enumerate(want) if units.UNITS[s].dim == dim and p == power), None)
        if match is None:
            raise MathInputError("those units don't line up kind by kind — try them one kind at a time")
        to_sym = want.pop(match)[0]
        years = years or "yr" in (sym, to_sym)
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
                value = value * shown if op == "×" else value / shown
                one = 1 if power > 0 else -1
                now[a] = now.get(a, 0) - one
                now[b] = now.get(b, 0) + one
                fact = f"1 {a} = {_nice(n)} {b}" if (a, b) in links() else f"1 {b} = {_nice(1 / n)} {a}"
                why = f" — {a} is on the bottom (per {a}), so it divides" if power < 0 and op == "÷" else ""
                current = sympy.Mul(*[units.symbol(units.UNITS[u]) ** p for u, p in now.items() if p])
                walk.append({"note": f"{a} → {b}: {op} {_nice(shown)}   ({fact}){why}", "latex": f"{_amount_tex(sympy.nsimplify(value))}\\,{units.latex(current)}"})
        parts.append({"kind": units.UNITS[sym].kind, "path": path, "on_bottom": power < 0, "steps": steps})
    value = sympy.nsimplify(value)
    arithmetic = " ".join([tex(number)] + [f"{'\\times' if op == '×' else '\\div'} {_nice(n)}" for op, n in factors]) if factors else tex(number)
    # an answer that's a finite decimal is shown as one, exactly (85.725)
    finite = value.is_Rational and _terminates(value)
    shown = _amount_tex(value)
    parts = [p for p in parts if p["steps"]]  # a unit that stays (h → h) has nothing to show
    out = {
        # as typed (3 3/8 in, not 27/8 in)
        "from_latex": f"{typed_number}\\,{units.latex(from_units)}" if typed_number else units.latex(start),
        "to_latex": units.latex(to_units),
        "result_latex": f"{shown}\\,{units.latex(to_units)}" if finite else units.latex(value * to_units),
        "exact": bool(finite),
        "decimal": None if finite else f"{float(value):.10g}",
        "arithmetic": f"{arithmetic} = {shown}",
        "parts": parts,
        "walk": walk,
        "path_units": sorted({u for p in parts for u in p["path"]}),
        "path_links": [[s["a"], s["b"]] for p in parts for s in p["steps"]],
    }
    if years:
        out["note"] = (
            "A year isn't one fixed length: 365 days, or 366 in a leap year. This uses 365.25 days, the average "
            "(what science uses). For 10 calendar years: 3,650 days plus one per leap day — 2 or 3 of them."
        )
    return out


# ------------------------------------------------------------- asking


def _lookup(word: str):
    """a unit by its symbol (km), name (kilometer) or plural (kilometers)"""
    word = word.strip()
    found = units.find(word)
    if found:
        return found
    low = word.lower().rstrip(".")
    for u in units.LIBRARY:
        if low in (u.name.lower(), u.plural.lower(), u.symbol.lower()):
            return u
    extra = {"metre": "m", "metres": "m", "foot": "ft", "feet": "ft", "inch": "in", "inches": "in", "hour": "h", "hours": "h", "minute": "min", "minutes": "min", "second": "s", "seconds": "s", "secs": "s", "mins": "min"}
    return units.UNITS.get(extra.get(low, ""))


_SUP = {"²": 2, "³": 3}


def _unit_text(text: str):
    """km/h, m/s^2, ft², miles per hour → the units, as a product"""
    text = re.sub(r"\s+per\s+", "/", text.strip())
    expr = sympy.Integer(1)
    pieces = text.split("/")
    for k, piece in enumerate(pieces):
        for token in re.split(r"[*·×\s]+", piece.strip()):
            if not token:
                continue
            m = re.fullmatch(r"([A-Za-z]+)(?:\^\{?(-?\d+)\}?|([²³]))?", token)
            unit = _lookup(m.group(1)) if m else None
            if not unit:
                raise MathInputError(f"“{token}” isn't a unit I know — the Map lists them, or add your own: 1 {token} = 50 lb")
            power = int(m.group(2)) if m.group(2) else _SUP.get(m.group(3) or "", 1)
            expr *= units.symbol(unit) ** (power if k == 0 else -power)
    if expr == 1:
        raise MathInputError("which units? — like m/s")
    return expr


_NUMBER = r"(?:-?\d+(?:\.\d+)?(?:\s+\d+/\d+)?|-?\d+/\d+|-?\.\d+|an?|one)"


def _amount_text(text: str):
    """3 3/8 in, 9 km/h, a mile, 10 years → the amount"""
    m = re.fullmatch(rf"\s*({_NUMBER})\s*(.+?)\s*", text, re.I)
    if not m:
        raise MathInputError("an amount with its unit — like 9 km/h or 3 3/8 in")
    raw = m.group(1).lower()
    if raw in ("a", "an", "one"):
        number = sympy.Integer(1)
    elif " " in raw.strip():
        whole, frac = raw.split()
        number = sympy.Integer(whole) + sympy.Rational(frac) * (-1 if whole.startswith("-") else 1)
    else:
        number = sympy.nsimplify(sympy.Rational(raw))
    return number * _unit_text(m.group(2))


def _typed(text: str) -> str | None:
    """the number as it was typed, as LaTeX: 3 3/8 → 3\\frac{3}{8}"""
    m = re.match(r"\s*(-?)(\d+)\s+(\d+)/(\d+)\b", text) or re.match(r"\s*(-?)()(\d+)/(\d+)\b", text)
    if not m:
        return None
    sign, whole, top, bottom = m.groups()
    return f"{sign}{whole}\\frac{{{top}}}{{{bottom}}}"


def op_unitask(req: dict) -> dict:
    """A question in plain words: 9 km/h to m/s · 3 3/8 in to mm · mm in a
    mile · how many seconds in 10 weeks — or a unit of your own: 1 k = 1000 m."""
    text = " ".join((req.get("text") or "").split())
    if not text:
        raise MathInputError("")
    # your own unit: 1 k = 1000 m
    define = re.fullmatch(r"1\s*([A-Za-z]+)\s*=\s*(.+)", text)
    if define:
        symbol, amount = define.group(1), define.group(2)
        if units.find(symbol):
            raise MathInputError(f"{symbol} is already a unit ({units.find(symbol).name}) — pick another name")
        value = _amount_text(amount)
        number, unit_part = units.split(value)
        return {
            "kind": "define",
            "symbol": symbol,
            "equals": f"{_amount_tex(number)}\\,{units.of(unit_part).symbol}" if unit_part.is_Symbol else None,
            "latex": f"1\\,\\mathrm{{{symbol}}} = {units.latex(value)}",
        }
    # how many X in Y · X in Y (X with no number: the units wanted)
    asking = re.fullmatch(r"(?:how\s+many\s+)?(.+?)\s+(?:are\s+)?in\s+(.+?)\??", text, re.I)
    if asking and not re.match(rf"\s*{_NUMBER}\s", asking.group(1) + " ", re.I):
        try:
            return {"kind": "convert", **convert(_amount_text(asking.group(2)), _unit_text(asking.group(1)), _typed(asking.group(2)))}
        except MathInputError:
            pass
    # A to B (or in / → / as) — split at each place it could be, first that reads
    # (the space after the word is looked at, not taken: "3 3/8 in to mm"
    # tries "in" and then "to")
    for m in re.finditer(r"\s+(?:to|into|in|as|→|->)(?=\s)", text, re.I):
        left, right = text[: m.start()], text[m.end() :].strip()
        try:
            start, target = _amount_text(left), _unit_text(right)
        except MathInputError:
            continue
        return {"kind": "convert", **convert(start, target, _typed(left))}
    raise MathInputError("try: 9 km/h to m/s · 3 3/8 in to mm · mm in a mile · 1 k = 1000 m")


_WORDS = {"to", "into", "in", "as", "how", "many", "much", "are", "is", "a", "an", "one", "per", "=", "→", "->", "?"}


def op_unitlint(req: dict) -> dict:
    """What the line says so far, as you type: each unit it recognizes (and
    its name), words it doesn't know, and what kind of amount it is → what
    it's going into. Nothing here raises — half a question is fine."""
    text = " ".join((req.get("text") or "").split())
    define = re.fullmatch(r"1\s*([A-Za-z]+)\s*=\s*(.*)", text)
    pieces = []
    seen: set = set()
    tokens = re.findall(r"[A-Za-z]+(?:\^\{?-?\d+\}?|[²³])?|\d+(?:\.\d+)?(?:/\d+)?|[=→?]|->", text)
    for i, token in enumerate(tokens):
        word = re.sub(r"\^.*|[²³]$", "", token)
        if re.fullmatch(r"\d.*", token):
            continue
        after_number = i > 0 and re.fullmatch(r"\d.*", tokens[i - 1]) is not None
        # "in" right after a number is inches (3 3/8 in); elsewhere it's the word
        if word.lower() in _WORDS and not (word == "in" and after_number):
            continue
        if define and i == 1:  # 1 k = …: the unit being made
            pieces.append({"text": word, "new": True})
            continue
        unit = _lookup(word)
        if unit:
            if unit.symbol not in seen:
                seen.add(unit.symbol)
                pieces.append({"text": word, "unit": unit.symbol, "name": unit.name, "kind": unit.kind, "mine": bool(getattr(unit, "defined_by", None))})
        else:
            pieces.append({"text": word, "unknown": True})
    out: dict = {"pieces": pieces}
    if define:
        try:
            amount = _amount_text(define.group(2))
            out["define"] = {"name": define.group(1), "latex": units.latex(amount), "kind": units.kind_name(units.split(amount)[1])}
        except Exception:  # noqa: BLE001 — not there yet
            pass
        return out
    # the question's shape, when it has one: an amount (its kind) → units (theirs)
    reverse = re.fullmatch(r"(?:how\s+many\s+)?([A-Za-z][^\d]*?)\s+(?:are\s+)?in\s+(.+?)\??", text, re.I)
    if reverse:
        amount_text, target_text = reverse.group(2), reverse.group(1)
    else:
        halves = re.split(r"\s+(?:to|into|as|→|->)\s+", text, maxsplit=1, flags=re.I)
        amount_text, target_text = halves[0], halves[1] if len(halves) > 1 else ""
    amount_text = re.sub(r"\s+(?:to|into|as|in)\s*$", "", amount_text, flags=re.I)  # "9 km/h to" — still typing
    try:
        amount = _amount_text(amount_text)
        out["from_kind"] = units.kind_name(units.split(amount)[1])
        out["from_latex"] = units.latex(amount)
    except Exception:  # noqa: BLE001 — not there yet
        pass
    if target_text.strip():
        try:
            target = _unit_text(target_text)
            out["to_kind"] = units.kind_name(target)
            out["to_latex"] = units.latex(target)
        except Exception:  # noqa: BLE001
            pass
    if out.get("from_kind") and out.get("to_kind"):
        out["fits"] = out["from_kind"] == out["to_kind"]
    return out
