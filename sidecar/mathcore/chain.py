"""Units worked the way a chemistry, physics or nursing class does it —
dimensional analysis (factor-label): the problem as one chain of
fractions, a conversion fraction put in wherever a unit has to become
another to cancel (1 lb / 0.45359237 kg is worth 1, so it changes the
units and never the amount), the units crossed out, then the tops
multiplied and divided by the bottoms.

    72.7 kg × 1 lb/0.45359237 kg × 5 mg/1 lb × 1 g/1000 mg × 1 mL/0.9 g
"""

from __future__ import annotations

import dataclasses

import sympy
from sympy import Integer, Rational

from . import units
from .lang.ast import Div, Group, Mul, Neg, Num, Pow, Sym
from .parsing import step
from .reference import _decimal, _terminates


@dataclasses.dataclass
class Q:
    """an amount: a number and its units — 0.9 g, 1 lb, 5"""

    number: object = Integer(1)
    units: list = dataclasses.field(default_factory=list)  # [(symbol, power)]

    def times(self, other: Q) -> Q:
        return Q(self.number * other.number, self.units + other.units)

    def plain_one(self) -> bool:
        return self.number == 1 and not self.units


@dataclasses.dataclass
class Link:
    """one fraction in the chain: top over bottom (to a power, for m² → cm²)"""

    top: Q
    bottom: Q = dataclasses.field(default_factory=Q)
    power: int = 1
    flipped: bool = False  # a ÷ turned into × its flip
    conversion: bool = False


# ------------------------------------------------------------- reading


def _amount(node):
    """a number or a unit on its own, as an amount — else None"""
    if isinstance(node, Num):
        return Q(Rational(node.text))
    if isinstance(node, Neg):
        inner = _amount(node.arg)
        return inner and Q(-inner.number, inner.units)
    if isinstance(node, Sym) and units.is_unit(sympy.Symbol(node.name)):
        return Q(Integer(1), [(sympy.Symbol(node.name), 1)])
    if isinstance(node, Pow) and isinstance(node.base, Sym) and isinstance(node.exp, Num) and units.is_unit(sympy.Symbol(node.base.name)):
        return Q(Integer(1), [(sympy.Symbol(node.base.name), int(node.exp.text))])
    return None


def _per(node):
    """units over units with no numbers (mg/lb) — (top, bottom) or None"""
    if isinstance(node, Div) and node.style == "frac":
        top, bottom = _amount(node.num), _amount(node.den)
        if top and bottom and top.number == 1 and bottom.number == 1 and top.units and bottom.units:
            return top, bottom
    return None


def _flip(link: Link) -> Link:
    return Link(link.bottom, link.top, link.power, flipped=not link.top.plain_one())


def _chain(node) -> list[Link] | None:
    """what's typed, as a chain of fractions — None when it isn't only
    numbers and units multiplied and divided"""
    if isinstance(node, Group):
        return _chain(node.inner)
    if isinstance(node, Mul):
        out: list[Link] = []
        current: Link | None = None
        for f in node.factors:
            amount = _amount(f)
            if amount:
                # 72.7 then kg: one amount; a new number after units starts
                # the next one (60 mi/h · 45 min)
                if current is not None and isinstance(f, (Num, Neg)) and (current.top.units or current.bottom.units):
                    out.append(current)
                    current = None
                current = Link(amount) if current is None else Link(current.top.times(amount), current.bottom)
                continue
            per = _per(f)
            if per and current is not None:  # 5 then mg/lb: a rate
                current = Link(current.top.times(per[0]), current.bottom.times(per[1]))
                continue
            if current is not None:
                out.append(current)
                current = None
            inner = _chain(f)
            if inner is None:
                return None
            out += inner
        if current is not None:
            out.append(current)
        return out
    if isinstance(node, Div):
        top, bottom = _chain(node.num), _chain(node.den)
        if top is None or bottom is None:
            return None
        # a rate as written: 5 mg over 1 lb
        if len(top) == 1 and len(bottom) == 1 and top[0].bottom.plain_one() and bottom[0].bottom.plain_one():
            return [Link(top[0].top, bottom[0].top)]
        out = top + [_flip(b) for b in bottom]
        # (72.7 kg · 5 mg)/lb: the lb goes under the 5 mg, not on its own
        merged: list[Link] = []
        for link in out:
            lone = link.top.plain_one() and link.bottom.number == 1 and len(merged) > 1 and merged[-1].bottom.plain_one()
            if lone:
                merged[-1] = Link(merged[-1].top, link.bottom)
            else:
                merged.append(link)
        return merged
    amount = _amount(node)
    return [Link(amount)] if amount else None


# ------------------------------------------------------------- working


def _net(chain: list[Link]) -> dict:
    net: dict = {}
    for link in chain:
        for u, p in link.top.units:
            net[u] = net.get(u, 0) + p * link.power
        for u, p in link.bottom.units:
            net[u] = net.get(u, 0) - p * link.power
    return net


def _conversion(a, b) -> Link:
    """a as b, written as a fraction worth 1 — the way a textbook would:
    1 lb / 0.45359237 kg, 1 g / 1000 mg, 2.54 cm / 1 in"""
    rate = sympy.nsimplify(units.of(a).size / units.of(b).size)  # 1 a = rate b
    forward = Link(Q(rate, [(b, 1)]), Q(Integer(1), [(a, 1)]), conversion=True)
    backward = Link(Q(Integer(1), [(b, 1)]), Q(1 / rate, [(a, 1)]), conversion=True)
    ends = lambda n: n.is_Rational and _terminates(n)  # noqa: E731
    if ends(rate) and rate >= 1:
        return forward
    if ends(1 / rate):
        return backward
    if ends(rate):
        return forward
    return forward if rate >= 1 else backward


def _number(n) -> str:
    n = sympy.nsimplify(n)
    if n.is_Rational and _terminates(n):
        return _decimal(n)
    return f"{float(n):.10g}"


def _approx(n) -> str:
    """= 363.5, or ≈ 0.8904225812 when it doesn't end"""
    n = sympy.nsimplify(n)
    return "=" if n.is_Rational and _terminates(n) else "\\approx"


def _units_tex(found, crossed=frozenset()) -> str:
    out = []
    for u, p in found:
        text = units.of(u).latex
        text = f"\\cancel{{{text}}}" if u in crossed else text
        out.append(text if p == 1 else f"{text}^{{{p}}}")
    return "\\,".join(out)


def _amount_tex(q: Q, crossed) -> str:
    unit = _units_tex(q.units, crossed)
    return f"{_number(q.number)}\\,{unit}" if unit else _number(q.number)


def _link_tex(link: Link, crossed=frozenset()) -> str:
    if link.bottom.plain_one():
        text = _amount_tex(link.top, crossed)
    else:
        text = f"\\frac{{{_amount_tex(link.top, crossed)}}}{{{_amount_tex(link.bottom, crossed)}}}"
    return f"\\left({text}\\right)^{{{link.power}}}" if link.power != 1 else text


def _chain_tex(chain, crossed=frozenset()) -> str:
    return " \\times ".join(_link_tex(link, crossed) for link in chain)


def _left_tex(net: dict) -> str:
    found = [(u, p) for u, p in net.items() if p]
    top = [(u, p) for u, p in found if p > 0]
    bottom = [(u, -p) for u, p in found if p < 0]
    if not bottom:
        return _units_tex(top)
    return f"\\frac{{{_units_tex(top) or '1'}}}{{{_units_tex(bottom)}}}"


def steps(node) -> list[dict] | None:
    """the chain, worked — None when it isn't a chain worth showing (one
    amount, letters in it, or nothing to convert, cancel or flip)"""
    chain = _chain(node)
    if not chain or len(chain) < 2:
        return None
    flipped = [link for link in chain if link.flipped]

    # what has to change to cancel: a unit on top (net) against one of its
    # kind below — kg against lb — gets a conversion fraction right after it
    worked = list(chain)
    net = _net(worked)
    added = []
    for a in [u for u, p in net.items() if p > 0]:
        for b in [u for u, p in net.items() if p < 0]:
            if net[a] <= 0 or net[b] >= 0 or units.of(a).dim != units.of(b).dim:
                continue
            k = min(net[a], -net[b])
            factor = _conversion(a, b)
            factor.power = k
            where = max(i for i, link in enumerate(worked) if any(u == a for u, _ in link.top.units))
            worked.insert(where + 1, factor)
            added.append(factor)
            net[a] -= k
            net[b] += k
    net = _net(worked)
    on_top = {u for link in worked for u, _ in link.top.units}
    below = {u for link in worked for u, _ in link.bottom.units}
    crossed = frozenset(u for u in on_top & below if net.get(u, 0) == 0)
    if not (flipped or added or crossed):
        return None

    out = []
    if flipped:
        f = flipped[0]
        was = Link(f.bottom, f.top)
        out.append(step(f"Divide by ${_link_tex(was)}$ by multiplying by its flip — now it's one chain of fractions", _chain_tex(chain)))
    else:
        out.append(step("Write it as one chain of fractions", _chain_tex(chain)))
    for i, factor in enumerate(added):
        a = factor.bottom.units[0][0]
        b = factor.top.units[0][0]
        so_far = {id(f) for f in added[: i + 1]}
        shown = [link for link in worked if not link.conversion or id(link) in so_far]
        same = f"{_number(factor.top.number)}\\,{units.of(b).latex} = {_number(factor.bottom.number)}\\,{units.of(a).latex}"
        out.append(step(f"${same}$, so ${_link_tex(Link(factor.top, factor.bottom))}$ equals 1 — multiply by it to turn {units.of(a).plural} into {units.of(b).plural}", _chain_tex(shown)))
    if crossed:
        names = ", ".join(f"${units.of(u).latex}$" for u in sorted(crossed, key=str))
        out.append(step(f"Cancel the units on top and bottom: {names}", _chain_tex(worked, crossed)))

    tops = [link.top.number ** link.power for link in worked if link.top.number != 1]
    bottoms = [link.bottom.number ** link.power for link in worked if link.bottom.number != 1]
    top = sympy.Mul(*tops)
    bottom = sympy.Mul(*bottoms)
    left = _left_tex(net)
    unit = f"\\,{left}" if left else ""
    answer = top / bottom
    if bottoms:
        product = lambda ns: " \\times ".join(_number(n) for n in ns) or "1"  # noqa: E731
        multiplied = f"\\frac{{{product(tops)}}}{{{product(bottoms)}}}{unit}"
        if len(tops) > 1 or len(bottoms) > 1:
            multiplied += f" = \\frac{{{_number(top)}}}{{{_number(bottom)}}}{unit}"
        out.append(step("Multiply the tops, multiply the bottoms", multiplied))
        out.append(step("Divide", f"\\frac{{{_number(top)}}}{{{_number(bottom)}}}{unit} {_approx(answer)} {_number(answer)}{unit}"))
    else:
        product = " \\times ".join(_number(n) for n in tops) or "1"
        if unit and len(tops) > 1:
            product = f"\\left({product}\\right)"
        out.append(step("Multiply", f"{product}{unit} {_approx(answer)} {_number(answer)}{unit}"))
    return out
