"""The shared form every input language is read into, and written out of.

It keeps the *shape* of what was typed — ¼·s stays a fraction times s, a
bracket stays a bracket — so translating between languages changes only
the spelling, never the structure. The checker turns it into sympy."""

from dataclasses import dataclass, field


class Node:
    pass


@dataclass
class Num(Node):
    text: str  # as typed: "12", "0.5"


@dataclass
class Sym(Node):
    name: str  # "x", "x_1", "rate"


@dataclass
class Const(Node):
    name: str  # "pi", "e", "oo"


@dataclass
class Neg(Node):
    arg: Node


@dataclass
class Add(Node):
    terms: list  # [(sign, node)], sign in "+", "-", "±"


@dataclass
class Mul(Node):
    factors: list
    # between factors[i] and factors[i+1]: "implicit" (2x), "*" (code),
    # "·" (\cdot), "×" (\times)
    ops: list = field(default_factory=list)


@dataclass
class Div(Node):
    num: Node
    den: Node
    style: str = "frac"  # "frac" (a bar), "slash" (a/b typed), "div" (÷)


@dataclass
class Mixed(Node):
    """A mixed number, read the way paper does: 2⅓ is 2 + ⅓ (= 7/3), and
    −2⅓ is −(2 + ⅓). Only a whole number against a fraction of numbers —
    2x, 2(⅓), 2·⅓ and 2·x/3 still multiply."""
    whole: Num
    frac: Div


@dataclass
class Pow(Node):
    base: Node
    exp: Node


@dataclass
class Func(Node):
    name: str  # canonical: sqrt, root (x, n), abs, sin, cos, tan, asin, acos, atan, ln, log, exp
    args: list


@dataclass
class Group(Node):
    inner: Node  # brackets the author typed


@dataclass
class Rel(Node):
    parts: list
    ops: list  # "=", "<", ">", "<=", ">=", "!="


@dataclass
class Alts(Node):
    items: list  # "x = 2 or x = 3"
    # "or": any of them (x < -2 or x > 5); "and": all at once (x > -4 and x < 2)
    word: str = "or"


PRECEDENCE = {Alts: 0, Rel: 1, Add: 2, Mul: 3, Div: 3, Neg: 4, Pow: 5}
ATOMS = (Num, Sym, Const, Func, Group)


def prec(node: Node) -> int:
    return PRECEDENCE.get(type(node), 6)


def strip_group(node: Node) -> Node:
    return node.inner if isinstance(node, Group) else node


def expand_pm(node: Node) -> Node:
    """x = ±4 → x = 4 or x = −4 (the checker, and languages without ±)."""
    variants = _pm_variants(node)
    if len(variants) == 1:
        return variants[0]
    return Alts(variants)


def _pm_variants(node: Node) -> list:
    if isinstance(node, Alts):
        out = []
        for item in node.items:
            v = expand_pm(item)
            out += v.items if isinstance(v, Alts) else [v]
        return [Alts(out, node.word)]
    if isinstance(node, Add):
        combos = [[]]
        for sign, term in node.terms:
            options = _pm_variants(term)
            signs = ["+", "-"] if sign == "±" else [sign]
            combos = [c + [(s, t)] for c in combos for s in signs for t in options]
        return [Add(c) for c in combos]
    if isinstance(node, (Neg, Group)):
        key = "arg" if isinstance(node, Neg) else "inner"
        return [type(node)(v) for v in _pm_variants(getattr(node, key))]
    if isinstance(node, Pow):
        return [Pow(b, e) for b in _pm_variants(node.base) for e in _pm_variants(node.exp)]
    if isinstance(node, Div):
        return [Div(n, d, node.style) for n in _pm_variants(node.num) for d in _pm_variants(node.den)]
    if isinstance(node, (Mul, Rel, Func)):
        children = node.factors if isinstance(node, Mul) else node.parts if isinstance(node, Rel) else node.args
        combos = [[]]
        for child in children:
            combos = [c + [v] for c in combos for v in _pm_variants(child)]
        if isinstance(node, Mul):
            return [Mul(c, list(node.ops)) for c in combos]
        if isinstance(node, Rel):
            return [Rel(c, list(node.ops)) for c in combos]
        return [Func(node.name, c) for c in combos]
    return [node]
