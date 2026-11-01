"""Statistics on the xy graph, the way a stats class (and Desmos) does it:
lists — [1, 2, 3], or L = [4, 8, 15] on a row of its own — and their
numbers (mean, median, stdev, stdevp, var, total, count, quantile); the
distributions (normalpdf, normalcdf, binompdf, binomcdf), as functions of x
to graph or as numbers; and pictures of data: histogram, boxplot, dotplot,
scatter."""

from __future__ import annotations

import math

import sympy
from sympy import Tuple

from .parsing import MathInputError

NUMBERS = ("mean", "median", "stdev", "stdevp", "var", "total", "count", "quantile")
DISTRIBUTIONS = ("normalpdf", "normalcdf", "binompdf", "binomcdf")
PLOTS = ("histogram", "boxplot", "dotplot", "scatter")
WORDS = NUMBERS + DISTRIBUTIONS + PLOTS
F = sympy.Function


def is_list(e) -> bool:
    return getattr(getattr(e, "func", None), "__name__", None) == "list"


def numbers(args, name) -> list:
    """the numbers a list (or several, or plain numbers) hold — exact"""
    out = []
    for a in args:
        items = list(a.args) if is_list(a) else [a]
        for v in items:
            v = sympy.nsimplify(v, rational=True) if isinstance(v, sympy.Float) else sympy.sympify(v)
            if v.free_symbols:
                raise MathInputError(f"{name}( ) needs numbers — give {', '.join(sorted(map(str, v.free_symbols)))} a value")
            out.append(v)
    if not out:
        raise MathInputError(f"{name}( ) needs a list: {name}([1, 2, 3])")
    return out


def _sorted(vals):
    return sorted(vals, key=lambda v: float(v))


def _quantile(vals, p):
    """the p quantile, between the two nearest (as most calculators do)"""
    s = _sorted(vals)
    pos = (len(s) - 1) * p
    lo = int(math.floor(float(pos)))
    hi = min(lo + 1, len(s) - 1)
    frac = sympy.nsimplify(pos - lo)
    return s[lo] + (s[hi] - s[lo]) * frac


def _median(vals):
    return _quantile(vals, sympy.Rational(1, 2))


def build(name: str, args: list):
    """a statistics word, as read → a number, a function of x, or something to draw — None when it isn't one"""
    if name == "list":
        return F("list")(*args)
    if name in NUMBERS:
        if name == "quantile":
            if len(args) != 2:
                raise MathInputError("quantile( ) takes a list and how far up it: quantile(L, 0.25)")
            return _quantile(numbers(args[:1], name), sympy.nsimplify(args[1]))
        vals = numbers(args, name)
        n = len(vals)
        mean = sum(vals) / n
        if name == "mean":
            return mean
        if name == "median":
            return _median(vals)
        if name == "total":
            return sum(vals)
        if name == "count":
            return sympy.Integer(n)
        squares = sum((v - mean) ** 2 for v in vals)
        if name == "stdevp":
            return sympy.sqrt(squares / n)
        if n < 2:
            raise MathInputError(f"{name}( ) needs two numbers or more")
        return sympy.sqrt(squares / (n - 1)) if name == "stdev" else squares / (n - 1)
    if name == "normalpdf":
        x, mu, sd = (list(args) + [0, 1])[:3] if len(args) == 1 else (args + [1])[:3] if len(args) == 2 else args[:3]
        return sympy.exp(-((x - mu) ** 2) / (2 * sd**2)) / (sd * sympy.sqrt(2 * sympy.pi))
    if name == "normalcdf":
        # normalcdf(x): below x; normalcdf(a, b, μ, σ): between a and b
        phi = lambda v, mu, sd: (1 + sympy.erf((v - mu) / (sd * sympy.sqrt(2)))) / 2  # noqa: E731
        if len(args) == 1:
            return phi(args[0], 0, 1)
        a, b, mu, sd = (list(args) + [0, 1])[:4]
        return phi(b, mu, sd) - phi(a, mu, sd)
    if name in ("binompdf", "binomcdf"):
        if len(args) != 3:
            raise MathInputError(f"{name}( ) takes the trials, the chance, and how many: {name}(10, 0.5, 3)")
        n, p, k = args
        term = lambda i: sympy.binomial(n, i) * p**i * (1 - p) ** (n - i)  # noqa: E731
        if name == "binompdf":
            return term(k)
        return sum(term(i) for i in range(int(k) + 1))
    if name in PLOTS:
        if name == "scatter":
            if len(args) != 2:
                raise MathInputError("scatter( ) takes two lists, x and y: scatter(X, Y)")
            xs, ys = numbers(args[:1], name), numbers(args[1:], name)
            if len(xs) != len(ys):
                raise MathInputError(f"the lists aren't the same length ({len(xs)} and {len(ys)})")
            return F("points")(*[Tuple(a, b) for a, b in zip(xs, ys)])
        return F(name)(*args)
    return None


def draw(shape):
    """a list (said, not drawn), a histogram, a box plot or a dot plot → a series"""
    kind = shape.func.__name__
    from .geometry import number_tex

    if kind == "list":
        vals = numbers([shape], "the list")
        n = len(vals)
        facts = [f"n={n}", f"\\text{{mean }}{number_tex(sum(vals) / n)}"]
        return {"kind": "value", "value": float(sum(vals) / n), "facts": facts}
    vals = [float(v) for v in numbers(shape.args[:1], kind)]
    if kind == "histogram":
        width = float(shape.args[1]) if len(shape.args) > 1 else None
        lo, hi = min(vals), max(vals)
        if not width:
            # about √n bars, on a round width
            raw = (hi - lo) / max(1, round(math.sqrt(len(vals)))) or 1
            step = 10 ** math.floor(math.log10(raw))
            width = min((m * step for m in (1, 2, 5, 10)), key=lambda w: abs(math.log(w / raw)))
        start = math.floor(lo / width) * width
        bins = max(1, math.ceil((hi - start) / width + 1e-9))
        counts = [0] * bins
        for v in vals:
            counts[min(bins - 1, int((v - start) // width))] += 1
        xs, ys = [], []
        for i, c in enumerate(counts):
            a = start + i * width
            if xs:
                xs.append(None)
                ys.append(None)
            xs += [a, a, a + width, a + width, a]
            ys += [0, c, c, 0, 0]
        return {"kind": "polygon", "x": xs, "y": ys, "shape": kind, "facts": [f"n={len(vals)}", f"\\text{{bars }}{width:g}\\text{{ wide}}", f"\\text{{tallest }}{max(counts)}"]}
    if kind == "boxplot":
        y0 = float(shape.args[1]) if len(shape.args) > 1 else 1.0
        exact = numbers(shape.args[:1], kind)
        q = [float(_quantile(exact, p)) for p in (0, sympy.Rational(1, 4), sympy.Rational(1, 2), sympy.Rational(3, 4), 1)]
        lo, q1, med, q3, hi = q
        h = 0.4
        xs = [q1, q3, q3, q1, q1, None, med, med, None, lo, q1, None, q3, hi, None, lo, lo, None, hi, hi]
        ys = [y0 - h, y0 - h, y0 + h, y0 + h, y0 - h, None, y0 - h, y0 + h, None, y0, y0, None, y0, y0, None, y0 - h / 2, y0 + h / 2, None, y0 - h / 2, y0 + h / 2]
        said = ", ".join(f"{v:g}" for v in q)
        return {"kind": "curve", "x": xs, "y": ys, "shape": kind, "facts": [f"\\text{{min, Q1, median, Q3, max: }}{said}", f"\\text{{IQR }}{q3 - q1:g}"]}
    if kind == "dotplot":
        seen: dict = {}
        xs, ys = [], []
        for v in sorted(vals):
            seen[v] = seen.get(v, 0) + 1
            xs.append(v)
            ys.append(seen[v])
        return {"kind": "points", "x": xs, "y": ys, "shape": kind, "facts": [f"n={len(vals)}"]}
    raise MathInputError(f"can't draw {kind}")
