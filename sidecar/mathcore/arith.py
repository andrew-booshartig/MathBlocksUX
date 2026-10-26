"""Arithmetic worked the way it's done by hand, one move per step, in
order of operations — and with fractions the way a class does them:

    dividing by a fraction is multiplying by its reciprocal
    multiply the tops and the bottoms
    a common denominator, then add the tops
    simplify: divide the top and bottom by what they share

It reads an expression as typed (sympy, unevaluated — where a ÷ b is
a·b⁻¹), keeps what each part is (a fraction stays a fraction), and gives
back the steps with the expression after each. Only numbers: anything with
a letter, a root or a function is left to the other steppers."""

import math

import sympy
from sympy import Float, Integer, Rational

# the pieces: ("n", value) a number; ("f", top, bottom, hold) a fraction as
# written — hold: rewritten over a common denominator, not to simplify yet;
# ("neg", x); ("add", [..]); ("mul", [..]); ("div", a, b); ("pow", base, k)

MAX_STEPS = 30


def _build(e):
    """The expression as pieces, or None if it isn't plain arithmetic."""
    if e.is_Integer:
        return ("n", Integer(e))
    if e.is_Rational:
        return ("f", int(e.p), int(e.q), False)
    if e.is_Float:
        return ("n", Float(e))
    if e.is_Add:
        terms = [_build(a) for a in e.args]
        return None if any(t is None for t in terms) else ("add", terms)
    if e.is_Mul:
        args = list(e.args)
        negative = False
        # the sign out front: −11/(11/4) is −(11 ÷ 11/4), not (−11) ÷ …
        for i, a in enumerate(args):
            if a.is_Number and a < 0:
                negative = not negative
                args[i] = -a
        args = [a for a in args if a != 1] or [Integer(1)]
        tops = [a for a in args if not (a.is_Pow and a.exp == -1)]
        bottoms = [a.base for a in args if a.is_Pow and a.exp == -1]
        top = _product(tops)
        node = top
        if bottoms:
            bottom = _product(bottoms)
            if top is None or bottom is None:
                return None
            # a whole number over a whole number is a fraction as written
            if top[0] == "n" and bottom[0] == "n" and top[1].is_Integer and bottom[1].is_Integer and bottom[1] > 0:
                node = ("f", int(top[1]), int(bottom[1]), False)
            else:
                node = ("div", top, bottom)
        if node is None:
            return None
        return ("neg", node) if negative else node
    if e.is_Pow and e.exp == -1:
        base = _build(e.base)
        return None if base is None else ("div", ("n", Integer(1)), base)
    if e.is_Pow and e.exp.is_Integer and e.exp > 1:
        base = _build(e.base)
        return None if base is None else ("pow", base, int(e.exp))
    return None


def _product(factors):
    if not factors:
        return ("n", Integer(1))
    parts = [_build(f) for f in factors]
    if any(p is None for p in parts):
        return None
    return parts[0] if len(parts) == 1 else ("mul", parts)


# ---------------------------------------------------------------- values


def _is_value(t) -> bool:
    if t[0] == "n":
        return True
    if t[0] == "f":
        _, p, q, hold = t
        return hold or (q > 1 and math.gcd(p, q) == 1)
    return False


def _value(t):
    return t[1] if t[0] == "n" else Rational(t[1], t[2])


def _parts(t) -> tuple[int, int]:
    """(top, bottom) as written — 8/12 is 8 over 12, a whole number is n/1"""
    return (t[1], t[2]) if t[0] == "f" else (int(t[1]), 1)


def _number(v):
    """A worked-out value as a piece: a whole number, or a fraction."""
    if isinstance(v, Float) or (hasattr(v, "is_Float") and v.is_Float):
        return ("n", Float(v))
    v = Rational(v)
    return ("n", Integer(v)) if v.q == 1 else ("f", int(v.p), int(v.q), False)


def _fold(t):
    """−(a value) is just a value: −4, −11/4."""
    kind = t[0]
    if kind == "neg":
        inner = _fold(t[1])
        if inner[0] == "n":
            return ("n", -inner[1])
        if inner[0] == "f":
            return ("f", -inner[1], inner[2], inner[3])
        return ("neg", inner)
    if kind in ("add", "mul"):
        parts = [_fold(x) for x in t[1]]
        return parts[0] if len(parts) == 1 else (kind, parts)
    if kind == "div":
        return ("div", _fold(t[1]), _fold(t[2]))
    if kind == "pow":
        return ("pow", _fold(t[1]), t[2])
    return t


# ---------------------------------------------------------------- writing


def _num_tex(v) -> str:
    if isinstance(v, Float) or v.is_Float:
        text = f"{float(v):.10g}"
        return text
    return str(int(v)) if v.q == 1 else f"{'-' if v < 0 else ''}\\frac{{{abs(v.p)}}}{{{v.q}}}"


def _negative(t) -> bool:
    return (t[0] == "n" and t[1] < 0) or (t[0] == "f" and t[1] < 0) or t[0] == "neg"


def render(t) -> str:
    kind = t[0]
    if kind == "n":
        return _num_tex(t[1])
    if kind == "f":
        _, p, q, _ = t
        return f"{'-' if p < 0 else ''}\\frac{{{abs(p)}}}{{{q}}}"
    if kind == "neg":
        inner = render(t[1])
        return f"-\\left({inner}\\right)" if t[1][0] == "add" else f"-{inner}"
    if kind == "add":
        out = render(t[1][0])
        for term in t[1][1:]:
            if term[0] == "neg":
                out += f" - {render(term[1]) if term[1][0] != 'add' else '\\left(' + render(term[1]) + '\\right)'}"
            elif _negative(term):
                out += f" - {render(_fold(('neg', term)))}"
            else:
                out += f" + {render(term)}"
        return out
    if kind == "mul":
        parts = []
        for i, f in enumerate(t[1]):
            text = render(f)
            if f[0] == "add" or (i > 0 and _negative(f)):
                text = f"\\left({text}\\right)"
            parts.append(text)
        return " \\cdot ".join(parts)
    if kind == "div":
        if _negative(t[1]) and t[1][0] in ("n", "f"):
            return f"-\\frac{{{render(_fold(('neg', t[1])))}}}{{{render(t[2])}}}"
        return f"\\frac{{{render(t[1])}}}{{{render(t[2])}}}"
    if kind == "pow":
        base = render(t[1])
        if not (t[1][0] == "n" and t[1][1] >= 0):
            base = f"\\left({base}\\right)"
        return f"{base}^{{{t[2]}}}"
    raise ValueError(kind)


# ---------------------------------------------------------------- moves


def _fraction(v) -> bool:
    """a fraction (not a whole number, not a decimal)"""
    return not (isinstance(v, Float) or v.is_Float) and Rational(v).q != 1


def _decimal(*values) -> bool:
    return any(isinstance(v, Float) or v.is_Float for v in values)


def _move(t):
    """One step on a piece whose parts are all values: (new piece, note)."""
    kind = t[0]
    if kind == "f":  # a fraction to simplify
        _, p, q, _ = t
        g = math.gcd(p, q)
        if q // g == 1:
            return ("n", Integer(p // q)), f"Divide: ${p} \\div {q} = {p // q}$"
        return ("f", p // g, q // g, False), f"Simplify ${render(('f', p, q, False))}$: divide the top and bottom by ${g}$"
    if kind == "pow":
        v = _value(t[1]) ** t[2]
        return _number(v), f"Exponent: ${render(t)} = {render(_number(v))}$"
    if kind == "div":
        a, b = _value(t[1]), _value(t[2])
        if b == 0:
            return None
        if _decimal(a, b):
            v = a / b
            return _number(v), f"Divide: ${render(t[1])} \\div {render(t[2])} = {render(_number(v))}$"
        b = Rational(b)
        if _fraction(b):
            flipped = ("f", int(b.q) * (1 if b.p > 0 else -1), abs(int(b.p)), True)
            return ("mul", [t[1], flipped]), (
                f"Dividing by a fraction is multiplying by its reciprocal: $\\div {render(t[2])}$ becomes $\\cdot {render(flipped)}$"
            )
        if _fraction(Rational(a)):
            flipped = ("f", 1 if b > 0 else -1, abs(int(b)), True)
            return ("mul", [t[1], flipped]), f"Dividing by ${int(b)}$ is multiplying by $\\frac{{1}}{{{abs(int(b))}}}$"
        a = int(a)
        return ("f", a, int(b), False), f"Write ${a} \\div {int(b)}$ as a fraction"
    if kind == "mul":
        values = [_value(x) for x in t[1]]
        if _decimal(*values) or not any(_fraction(Rational(v)) for v in values):
            v = sympy.Mul(*values)
            word = "Multiply"
            return _number(v), f"{word}: ${render(t)} = {render(_number(v))}$"
        written = [_parts(x) for x in t[1]]
        tops = math.prod(p for p, _ in written)
        bottoms = math.prod(q for _, q in written)
        top_text = " \\cdot ".join(_paren(p) for p, _ in written)
        bottom_text = " \\cdot ".join(str(q) for _, q in written)
        return ("f", tops, bottoms, False), (
            f"Multiply the tops and the bottoms: $\\frac{{{top_text}}}{{{bottom_text}}} = \\frac{{{tops}}}{{{bottoms}}}$"
        )
    if kind == "add":
        values = [_value(x) for x in t[1]]
        if _decimal(*values) or not any(_fraction(Rational(v)) for v in values):
            v = sympy.Add(*values)
            word = "Add and subtract" if any(v < 0 for v in values[1:]) and len(values) > 2 else ("Subtract" if any(v < 0 for v in values[1:]) else "Add")
            return _number(v), f"{word}: ${render(t)} = {render(_number(v))}$"
        written = [_parts(x) for x in t[1]]
        bottoms = {q for _, q in written}
        if len(bottoms) > 1:
            lcd = math.lcm(*bottoms)
            rewritten = [("f", p * (lcd // q), lcd, True) for p, q in written]
            return ("add", rewritten), f"Common denominator ${lcd}$: rewrite each part over ${lcd}$"
        bottom = bottoms.pop()
        top = sum(p for p, _ in written)
        sums = " ".join(f"{'+ ' if i and p >= 0 else '- ' if i else ''}{abs(p) if i else p}" for i, (p, _) in enumerate(written))
        negatives = sum(p < 0 for p, _ in written[1:])
        word = "Add" if not negatives else "Subtract" if len(written) == 2 else "Add and subtract"
        return ("f", top, bottom, False), f"{word} the tops (the bottom stays ${bottom}$): ${sums} = {top}$"
    return None


def _paren(n: int) -> str:
    return f"({n})" if n < 0 else str(n)


def _step(t):
    """The first piece ready to work out (its parts all values), in order of
    operations — innermost first, left to right — worked one move."""
    if _is_value(t):
        return None
    kind = t[0]
    children = [t[1]] if kind in ("neg", "pow") else t[1] if kind in ("add", "mul") else [t[1], t[2]] if kind == "div" else []
    for i, child in enumerate(children):
        done = _step(child)
        if done is not None:
            new_child, note = done
            if kind in ("add", "mul"):
                parts = list(t[1])
                parts[i] = new_child
                return (kind, parts), note
            if kind == "div":
                return (("div", new_child, t[2]) if i == 0 else ("div", t[1], new_child)), note
            if kind == "neg":
                return ("neg", new_child), note
            if kind == "pow":
                return ("pow", new_child, t[2]), note
    if kind == "f" or all(_is_value(c) for c in children):
        moved = _move(t)
        return moved
    return None


def arithmetic_steps(expr) -> list[tuple[str, str]] | None:
    """[(what was done, the expression after it)] for plain arithmetic —
    None when it isn't plain arithmetic (or there's nothing to do). The
    first entry's expression is the start, as written."""
    if getattr(expr, "free_symbols", None):
        return None
    tree = _build(expr)
    if tree is None:
        return None
    tree = _fold(tree)
    start = render(tree)
    steps = []
    for _ in range(MAX_STEPS):
        if _is_value(tree):
            break
        moved = _step(tree)
        if moved is None:
            return None
        tree, note = moved
        tree = _fold(tree)
        steps.append((note, render(tree)))
    if not steps or not _is_value(tree) or (tree[0] == "f" and tree[3]):
        return None
    # the arithmetic must land where sympy does
    try:
        if sympy.simplify(_value(tree) - sympy.nsimplify(expr.doit() if hasattr(expr, "doit") else expr)) != 0:
            return None
    except Exception:  # noqa: BLE001
        return None
    return [("Start", start), *steps]


def written(expr) -> str | None:
    """Plain arithmetic as it was typed (a fraction stays a fraction), or
    None when it isn't plain arithmetic."""
    tree = _build(expr) if not getattr(expr, "free_symbols", None) else None
    return None if tree is None else render(_fold(tree))
