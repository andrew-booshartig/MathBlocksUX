"""Geometry on the xy graph: points by name (A = (1, 2)) and what's built
from them — segment(A, B), line(A, B), ray(A, B) (from A, through B),
vector(A, B), circle(A, r) or circle(A, B) (center A, through B),
polygon(A, B, C, …), angle(A, B, C) (at B), perpendicular(…, C) and
parallel(…, C) — plus midpoint(A, B), a point, and distance(A, B), a number.

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
    elif name == "angle":
        if len(args) != 3:
            raise MathInputError("angle( ) takes three points, the corner in the middle: angle(A, B, C)")
        for p in args:
            _point(p, name)
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


def _angle(shape, window, num):
    """the angle at B between BA and BC: an arc (a square corner at 90°) and its size"""
    a, b, c = shape.args
    u = (a[0] - b[0], a[1] - b[1])
    v = (c[0] - b[0], c[1] - b[1])
    nu, nv = sympy.sqrt(u[0] ** 2 + u[1] ** 2), sympy.sqrt(v[0] ** 2 + v[1] ** 2)
    if num(nu) < 1e-12 or num(nv) < 1e-12:
        raise MathInputError("an angle needs three different points, the corner in the middle")
    degrees = _exact(sympy.acos(_exact((u[0] * v[0] + u[1] * v[1]) / (nu * nv))) * 180 / sympy.pi)
    d = num(degrees)
    whole = abs(d - round(d)) < 1e-9
    if whole:
        fact = f"\\angle={int(round(d))}^{{\\circ}}"
        part = sympy.Rational(int(round(d)), 180)
        if part != 0 and part.q <= 12:
            fact += f"={_tex(part * sympy.pi)}"
    else:
        fact = f"\\angle\\approx{d:.4g}^{{\\circ}}"
    bx, by = num(b[0]), num(b[1])
    ux, uy, vx, vy = num(u[0]), num(u[1]), num(v[0]), num(v[1])
    r = 0.3 * min(math.hypot(ux, uy), math.hypot(vx, vy))
    if window:
        r = min(r, 0.06 * (window[0][1] - window[0][0]))
    t1, t2 = math.atan2(uy, ux), math.atan2(vy, vx)
    sweep = (t2 - t1 + math.pi) % (2 * math.pi) - math.pi
    if whole and round(d) == 90:
        # a right angle: the little square
        e1 = (ux / math.hypot(ux, uy) * r * 0.75, uy / math.hypot(ux, uy) * r * 0.75)
        e2 = (vx / math.hypot(vx, vy) * r * 0.75, vy / math.hypot(vx, vy) * r * 0.75)
        xs = [bx + e1[0], bx + e1[0] + e2[0], bx + e2[0]]
        ys = [by + e1[1], by + e1[1] + e2[1], by + e2[1]]
    else:
        ts = np.linspace(t1, t1 + sweep, 48)
        xs, ys = (bx + r * np.cos(ts)).tolist(), (by + r * np.sin(ts)).tolist()
    mid = t1 + sweep / 2
    text = f"{int(round(d))}°" if whole else f"{d:.1f}°"
    label = {"x": bx + 1.9 * r * math.cos(mid), "y": by + 1.9 * r * math.sin(mid), "text": text}
    return {"kind": "curve", "x": xs, "y": ys, "shape": "angle", "facts": [fact], "label": label}


def draw(shape, window=None):
    """a shape (its letters all known) → a series to draw, and y as a function
    of x for a whole line (so its intercepts and crossings get marked)"""
    kind = shape.func.__name__
    num = lambda v: float(sympy.N(v))  # noqa: E731
    if kind == "angle":
        return _angle(shape, window, num), None
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
