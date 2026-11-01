"""Geometry on the xy graph: points by name (A = (1, 2)) and what's built
from them — segment(A, B), line(A, B), ray(A, B) (from A, through B),
vector(A, B), circle(A, r) or circle(A, B) (center A, through B),
polygon(A, B, C, …), perpendicular(…, C) and parallel(…, C) — plus
midpoint(A, B), a point, and distance(A, B), a number.

A shape stays name(points…) until it's drawn, so moving A moves everything
built on it. Each comes with what's true about it, exact where it can be:
a line's equation, a segment's length, a polygon's area."""

from __future__ import annotations

import math

import numpy as np
import sympy
from sympy import Tuple
from sympy.core.function import AppliedUndef

from .graphtex import GEOMETRY, X
from .parsing import MathInputError

SHAPES = tuple(n for n in GEOMETRY if n not in ("midpoint", "distance"))
STRAIGHT = ("segment", "line", "ray", "vector", "perpendicular", "parallel")
FAR = 1e5


def is_shape(e) -> bool:
    return isinstance(e, AppliedUndef) and e.func.__name__ in SHAPES


def _point(p, name):
    if not isinstance(p, Tuple) or len(p) != 2:
        raise MathInputError(f"{name}( ) takes points — A, B or (1, 2)")
    return p


def build(name: str, args: list):
    """name(args…), as read → a point (midpoint), a number (distance), or a shape"""
    if name in ("midpoint", "distance", "segment", "line", "ray", "vector"):
        if len(args) != 2:
            raise MathInputError(f"{name}( ) takes two points: {name}(A, B)")
        a, b = (_point(p, name) for p in args)
        if name == "midpoint":
            return Tuple((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if name == "distance":
            return sympy.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
    elif name == "circle":
        if len(args) != 2:
            raise MathInputError("circle( ) takes its center and its radius — circle(A, 3) — or a point on it: circle(A, B)")
        _point(args[0], name)
        if isinstance(args[1], Tuple):
            _point(args[1], name)
    elif name == "polygon":
        if len(args) < 3:
            raise MathInputError("a polygon needs three points or more: polygon(A, B, C)")
        for p in args:
            _point(p, name)
    elif name in ("perpendicular", "parallel"):
        if len(args) != 2 or not (is_shape(args[0]) and args[0].func.__name__ in STRAIGHT):
            raise MathInputError(f"{name}( ) takes a line (or a segment or ray) and a point: {name}(line(A, B), C)")
        _point(args[1], name)
    return sympy.Function(name)(*args)


def _through(shape):
    """a straight shape's first point, and a second one along it"""
    kind = shape.func.__name__
    if kind in ("perpendicular", "parallel"):
        base, p = shape.args
        a, b = _through(base)
        dx, dy = b[0] - a[0], b[1] - a[1]
        if kind == "perpendicular":
            dx, dy = -dy, dx
        return p, Tuple(p[0] + dx, p[1] + dy)
    return shape.args[0], shape.args[1]


# ------------------------------------------------------------------ said exactly


def _exact(v):
    v = sympy.sympify(v)
    if v.has(sympy.Float):
        v = sympy.nsimplify(v, rational=True)
    try:
        return sympy.radsimp(sympy.simplify(v))
    except Exception:  # noqa: BLE001
        return v


def _tex(v) -> str:
    return sympy.latex(v).replace(" ", "")


def _approx(v) -> str:
    f = float(sympy.N(v))
    return f"{f:.4g}".replace("e+0", "e").replace("e-0", "e-")


def number_tex(v) -> str:
    """√13 ≈ 3.606 — exact, and about, unless it's a whole number"""
    v = _exact(v)
    if v.is_Integer:
        return _tex(v)
    exact = _tex(v)
    if len(exact) > 36 or v.has(sympy.Float):
        return _approx(v)
    return f"{exact}\\approx{_approx(v)}"


def _times_x(m) -> str:
    if m == 1:
        return "x"
    if m == -1:
        return "-x"
    tex = _tex(m)
    return f"\\left({tex}\\right)x" if isinstance(m, sympy.Add) else f"{tex}x"


def _plus(c) -> str:
    if c == 0:
        return ""
    return f"-{_tex(-c)}" if c.is_negative else f"+{_tex(c)}"


def line_tex(a, b) -> tuple[str, object | None]:
    """the equation of the line through a and b, and y as a function of x (None when it's x = c)"""
    dx, dy = _exact(b[0] - a[0]), _exact(b[1] - a[1])
    if dx == 0:
        return f"x={_tex(_exact(a[0]))}", None
    m = _exact(dy / dx)
    c = _exact(a[1] - m * a[0])
    if m == 0:
        return f"y={_tex(c)}", c
    return f"y={_times_x(m)}{_plus(c)}", m * X + c


def _between(var: str, lo, hi) -> str:
    lo, hi = sorted((_exact(lo), _exact(hi)), key=lambda v: float(sympy.N(v)))
    return f"\\left\\{{{_tex(lo)}\\le {var}\\le{_tex(hi)}\\right\\}}"


def _from(var: str, start, toward) -> str:
    up = float(sympy.N(toward)) > float(sympy.N(start))
    return f"\\left\\{{{var}\\{'ge' if up else 'le'} {_tex(_exact(start))}\\right\\}}"


def _square(var: str, h) -> str:
    if h == 0:
        return f"{var}^{{2}}"
    return f"\\left({var}{_plus(-h)}\\right)^{{2}}"


# ------------------------------------------------------------------ drawn


def draw(shape):
    """a shape (its letters all known) → a series to draw, and y as a function
    of x for a whole line (so its intercepts and crossings get marked)"""
    kind = shape.func.__name__
    num = lambda v: float(sympy.N(v))  # noqa: E731
    if kind == "circle":
        c, second = shape.args
        r = sympy.sqrt((second[0] - c[0]) ** 2 + (second[1] - c[1]) ** 2) if isinstance(second, Tuple) else second
        r = _exact(r)
        rf = num(r)
        if not (math.isfinite(rf) and rf > 0):
            raise MathInputError("a circle needs a radius bigger than 0")
        cx, cy = num(c[0]), num(c[1])
        th = np.linspace(0, 2 * np.pi, 721)
        h, k = _exact(c[0]), _exact(c[1])
        facts = [
            f"{_square('x', h)}+{_square('y', k)}={_tex(_exact(r**2))}",
            f"r={number_tex(r)}",
            f"\\text{{area }}{number_tex(sympy.pi * r**2)}",
        ]
        return {"kind": "curve", "x": (cx + rf * np.cos(th)).tolist(), "y": (cy + rf * np.sin(th)).tolist(), "shape": kind, "facts": facts, "equation": facts[0]}, None
    if kind == "polygon":
        pts = list(shape.args)
        xs = [num(p[0]) for p in pts]
        ys = [num(p[1]) for p in pts]
        n = len(pts)
        area = abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2
        perimeter = sum(sympy.sqrt((pts[(i + 1) % n][0] - pts[i][0]) ** 2 + (pts[(i + 1) % n][1] - pts[i][1]) ** 2) for i in range(n))
        facts = [f"\\text{{area }}{number_tex(area)}", f"\\text{{perimeter }}{number_tex(perimeter)}"]
        return {"kind": "polygon", "x": [*xs, xs[0]], "y": [*ys, ys[0]], "shape": kind, "facts": facts}, None

    a, b = _through(shape)
    ax, ay, bx, by = num(a[0]), num(a[1]), num(b[0]), num(b[1])
    if abs(ax - bx) < 1e-12 and abs(ay - by) < 1e-12:
        raise MathInputError("its two points are the same point — move one")
    equation, fx = line_tex(a, b)
    s = {"kind": "curve", "shape": kind, "equation": equation}
    vertical = fx is None
    var = "y" if vertical else "x"
    lo, hi = (a[1], b[1]) if vertical else (a[0], b[0])
    if kind in ("segment", "vector"):
        s["x"], s["y"] = [ax, bx], [ay, by]
        length = number_tex(sympy.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2))
        if kind == "vector":
            s["arrow"] = True
            s["facts"] = [f"\\left\\langle{_tex(_exact(b[0] - a[0]))},{_tex(_exact(b[1] - a[1]))}\\right\\rangle", f"\\text{{length }}{length}"]
        else:
            s["facts"] = [f"\\text{{length }}{length}", f"{equation}\\ {_between(var, lo, hi)}"]
        return s, None
    # a ray from a through b, a whole line both ways: out to far off the graph
    d = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / d, (by - ay) / d
    if kind == "ray":
        s["x"], s["y"] = [ax, ax + ux * FAR], [ay, ay + uy * FAR]
        s["facts"] = [f"{equation}\\ {_from(var, lo, hi)}"]
        return s, None
    s["x"], s["y"] = [ax - ux * FAR, ax + ux * FAR], [ay - uy * FAR, ay + uy * FAR]
    s["facts"] = [equation]
    return s, fx
