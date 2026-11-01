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

# what can be drawn (the rest of geometry's words make points, numbers or one of these)
SHAPES = (
    "segment", "line", "ray", "vector", "circle", "polygon", "angle", "perpendicular", "parallel", "arc", "sector", "points", "group", "locus",
    "list", "histogram", "boxplot", "dotplot",
)
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
    from . import stats

    if name in stats.WORDS:
        return stats.build(name, args)
    more = build_more(name, args)
    if more is not None:
        return more
    if name in ("midpoint", "distance", "segment", "line", "ray", "vector"):
        if len(args) != 2:
            raise MathInputError(f"{name}( ) takes two points: {name}(A, B)")
        a, b = (_point(p, name) for p in args)
        if name == "midpoint":
            return Tuple((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if name == "distance":
            return sympy.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
    elif name == "circle" and len(args) == 3:
        # through three points: its center is where their perpendicular bisectors meet
        a, b, c = (_point(p, name) for p in args)
        d = _exact(2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])))
        if d == 0:
            raise MathInputError("those three points are in a line — no circle goes through them")
        s = [p[0] ** 2 + p[1] ** 2 for p in (a, b, c)]
        ux = (s[0] * (b[1] - c[1]) + s[1] * (c[1] - a[1]) + s[2] * (a[1] - b[1])) / d
        uy = (s[0] * (c[0] - b[0]) + s[1] * (a[0] - c[0]) + s[2] * (b[0] - a[0])) / d
        return sympy.Function("circle")(_pt(ux, uy), a)
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
    elif name == "polygon" and len(args) == 3 and not isinstance(args[2], Tuple):
        return _regular(_point(args[0], name), _point(args[1], name), args[2])
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
    # a fraction like 4330127/200000 came from decimals — it says nothing the decimal doesn't
    clumsy = any(r.q > 1000 for r in v.atoms(sympy.Rational))
    if len(exact) > 36 or v.has(sympy.Float) or clumsy:
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
    if len(_tex(m)) + len(_tex(c)) > 40:
        # radicals within radicals say less than decimals: y ≈ 0.12x − 3.4
        mf, cf = float(sympy.N(m)), float(sympy.N(c))
        return f"y\\approx{mf:.4g}x{'-' if cf < 0 else '+'}{abs(cf):.4g}", m * X + c
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


def _dims_of(pts, closed):
    """drafting labels: each side's length at its middle (turned along it), and —
    closed — each corner's inside angle, set just inside it"""
    n = len(pts)
    out = []
    for i in range(n if closed else n - 1):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
        length = math.hypot(bx - ax, by - ay)
        if length < 1e-12:
            continue
        out.append({"x": (ax + bx) / 2, "y": (ay + by) / 2, "text": f"{length:.4g}", "deg": math.degrees(math.atan2(by - ay, bx - ax)), "side": True})
    if closed and n >= 3:
        area2 = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
        turn = 1 if area2 > 0 else -1
        for i in range(n):
            (px, py), (vx, vy), (qx, qy) = pts[i - 1], pts[i], pts[(i + 1) % n]
            u, w = (px - vx, py - vy), (qx - vx, qy - vy)
            lu, lw = math.hypot(*u), math.hypot(*w)
            if lu < 1e-12 or lw < 1e-12:
                continue
            inside = math.atan2(turn * (w[0] * u[1] - w[1] * u[0]), w[0] * u[0] + w[1] * u[1]) % (2 * math.pi)
            d = (u[0] / lu + w[0] / lw, u[1] / lu + w[1] / lw)
            ld = math.hypot(*d)
            d = (d[0] / ld, d[1] / ld) if ld > 1e-9 else (-turn * u[1] / lu, turn * u[0] / lu)
            if inside > math.pi:
                d = (-d[0], -d[1])
            k = 0.22 * min(lu, lw)
            deg = math.degrees(inside)
            out.append({"x": vx + d[0] * k, "y": vy + d[1] * k, "text": f"{round(deg)}°" if abs(deg - round(deg)) < 0.05 else f"{deg:.1f}°"})
    return out


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
    if kind in ("arc", "sector"):
        return _arc_draw(shape, num), None
    if kind in ("list", "histogram", "boxplot", "dotplot"):
        from . import stats

        return stats.draw(shape), None
    if kind == "locus":
        p, var, lo, hi = shape.args
        free = (p[0].free_symbols | p[1].free_symbols) - {var}
        if free:
            raise MathInputError(f"give {', '.join(sorted(str(f) for f in free))} a value first")
        ts = np.linspace(num(lo), num(hi), 900)
        fx, fy = (sympy.lambdify(var, c, modules=["numpy"]) for c in p)
        xs = np.broadcast_to(np.asarray(fx(ts), dtype=float), ts.shape)
        ys = np.broadcast_to(np.asarray(fy(ts), dtype=float), ts.shape)
        return {"kind": "curve", "x": [float(v) if np.isfinite(v) else None for v in xs], "y": [float(v) if np.isfinite(v) else None for v in ys], "shape": kind}, None
    if kind == "points":
        pts = list(shape.args)
        return {"kind": "points", "x": [num(p[0]) for p in pts], "y": [num(p[1]) for p in pts], "shape": kind, "facts": [point_tex(p) for p in pts]}, None
    if kind == "group":
        xs, ys, facts = [], [], []
        for part in shape.args:
            s, _ = draw(part, window)
            if xs:
                xs.append(None)
                ys.append(None)
            xs += s["x"]
            ys += s["y"]
            facts += s.get("facts", [])
        return {"kind": "curve", "x": xs, "y": ys, "shape": kind, "facts": facts}, None
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
        return {"kind": "polygon", "x": [*xs, xs[0]], "y": [*ys, ys[0]], "shape": kind, "facts": facts, "dims": _dims_of(list(zip(xs, ys)), True)}, None

    a, b = _through(shape)
    ax, ay, bx, by = num(a[0]), num(a[1]), num(b[0]), num(b[1])
    if abs(ax - bx) < 1e-12 and abs(ay - by) < 1e-12:
        raise MathInputError("its two points are the same point — move one")
    equation, fx = line_tex(a, b)
    s = {"kind": "curve", "shape": kind, "equation": equation, "anchor": [ax, ay, bx, by]}
    vertical = fx is None
    var = "y" if vertical else "x"
    lo, hi = (a[1], b[1]) if vertical else (a[0], b[0])
    if kind in ("segment", "vector"):
        s["x"], s["y"] = [ax, bx], [ay, by]
        s["dims"] = _dims_of([(ax, ay), (bx, by)], False)
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


# ------------------------------------------------------------------ more constructions
# (GeoGebra's toolbox, as words: intersection, the four transformations,
# circles through three points, arcs and sectors, bisectors, regular
# polygons, tangents — and measuring: length, area, perimeter, slope)

F = sympy.Function


def _pt(x, y):
    return Tuple(_exact(x), _exact(y))


def _num_or_none(v):
    try:
        f = float(sympy.N(v))
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _circle_parts(c):
    center, second = c.args
    r = sympy.sqrt((second[0] - center[0]) ** 2 + (second[1] - center[1]) ** 2) if isinstance(second, Tuple) else second
    return center, r


def _pieces(o):
    """an object as straight pieces (a point, a second point, how far it runs) and circles"""
    if isinstance(o, Tuple):
        raise MathInputError("a point doesn't cross anything — use lines, segments, rays, circles or polygons")
    if not is_shape(o):
        raise MathInputError("intersection( ) takes two lines, segments, rays, circles or polygons")
    kind = o.func.__name__
    if kind in STRAIGHT:
        a, b = _through(o)
        return [("line", a, b, {"segment": (0, 1), "vector": (0, 1), "ray": (0, None)}.get(kind, (None, None)))]
    if kind == "circle":
        c, r = _circle_parts(o)
        return [("circle", c, r)]
    if kind == "polygon":
        pts = list(o.args)
        return [("line", pts[i], pts[(i + 1) % len(pts)], (0, 1)) for i in range(len(pts))]
    if kind == "group":
        return [p for part in o.args for p in _pieces(part)]
    raise MathInputError(f"can't find where a {kind} crosses — lines, segments, rays, circles and polygons work")


def _inside(t, lim):
    lo, hi = lim
    v = _num_or_none(t)
    if v is None:
        return True
    return (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)


def _cross(p, q):
    return p[0] * q[1] - p[1] * q[0]


def _meet(P, Q):
    out = []
    if P[0] == "line" and Q[0] == "line":
        _, a1, b1, l1 = P
        _, a2, b2, l2 = Q
        d1, d2 = (b1[0] - a1[0], b1[1] - a1[1]), (b2[0] - a2[0], b2[1] - a2[1])
        det = _exact(_cross(d1, d2))
        if det == 0:
            return []
        w = (a2[0] - a1[0], a2[1] - a1[1])
        t, s = _exact(_cross(w, d2) / det), _exact(_cross(w, d1) / det)
        if _inside(t, l1) and _inside(s, l2):
            out.append(_pt(a1[0] + t * d1[0], a1[1] + t * d1[1]))
        return out
    if P[0] == "circle" and Q[0] == "line":
        P, Q = Q, P
    if P[0] == "line" and Q[0] == "circle":
        _, a, b, lim = P
        _, c, r = Q
        d = (b[0] - a[0], b[1] - a[1])
        f = (a[0] - c[0], a[1] - c[1])
        A, B, C = d[0] ** 2 + d[1] ** 2, 2 * (f[0] * d[0] + f[1] * d[1]), f[0] ** 2 + f[1] ** 2 - r**2
        disc = _exact(B**2 - 4 * A * C)
        dv = _num_or_none(disc)
        if dv is not None and dv < -1e-12:
            return []
        roots = [(-B) / (2 * A)] if dv is not None and abs(dv) < 1e-12 else [(-B - sympy.sqrt(disc)) / (2 * A), (-B + sympy.sqrt(disc)) / (2 * A)]
        return [_pt(a[0] + t * d[0], a[1] + t * d[1]) for t in roots if _inside(t, lim)]
    # two circles: the line through their crossings, then that line and one circle
    _, c1, r1 = P
    _, c2, r2 = Q
    dx, dy = c2[0] - c1[0], c2[1] - c1[1]
    d2 = _exact(dx**2 + dy**2)
    if d2 == 0:
        return []
    a = (r1**2 - r2**2 + d2) / (2 * sympy.sqrt(d2))
    h2 = _exact(r1**2 - a**2)
    hv = _num_or_none(h2)
    if hv is not None and hv < -1e-12:
        return []
    d = sympy.sqrt(d2)
    mx, my = c1[0] + a * dx / d, c1[1] + a * dy / d
    if hv is not None and abs(hv) < 1e-12:
        return [_pt(mx, my)]
    h = sympy.sqrt(h2)
    return [_pt(mx - h * dy / d, my + h * dx / d), _pt(mx + h * dy / d, my - h * dx / d)]


def intersections(a, b) -> list:
    pts: list = []
    for P in _pieces(a):
        for Q in _pieces(b):
            for p in _meet(P, Q):
                key = (_num_or_none(p[0]), _num_or_none(p[1]))
                if all(k is not None for k in key) and any(abs(key[0] - _num_or_none(q[0])) < 1e-9 and abs(key[1] - _num_or_none(q[1])) < 1e-9 for q in pts):
                    continue
                pts.append(p)
    return sorted(pts, key=lambda p: (_num_or_none(p[0]) or 0, _num_or_none(p[1]) or 0))


def _map(obj, f, flip=False, scale=1):
    """a point or a shape, moved point by point (a reflection turns arcs around)"""
    if isinstance(obj, Tuple) and len(obj) == 2:
        return f(obj)
    if not is_shape(obj):
        raise MathInputError("this moves points and shapes — A, segment(A, B), polygon(…), circle(…)…")
    kind = obj.func.__name__
    if kind == "circle":
        c, second = obj.args
        return F("circle")(f(c), f(second) if isinstance(second, Tuple) else second * scale)
    if kind in ("arc", "sector") and flip:
        o, p, q = obj.args
        return F(kind)(f(o), f(q), f(p))
    return F(kind)(*[_map(x, f, flip, scale) if isinstance(x, Tuple) or is_shape(x) else x for x in obj.args])


def _degrees_or_radians(angle):
    """rotate(A, 90): degrees, the way geometry says it — but π means radians"""
    return angle if angle.has(sympy.pi) else angle * sympy.pi / 180


def _regular(a, b, n):
    n = int(n)
    if n < 3 or n > 200:
        raise MathInputError("a regular polygon has 3 sides or more")
    t = 2 * sympy.pi / n
    pts = [a, b]
    while len(pts) < n:
        p, q = pts[-2], pts[-1]
        d = (q[0] - p[0], q[1] - p[1])
        pts.append(_pt(q[0] + d[0] * sympy.cos(t) - d[1] * sympy.sin(t), q[1] + d[0] * sympy.sin(t) + d[1] * sympy.cos(t)))
    return F("polygon")(*pts)


def _on(obj, t):
    """point(shape, t): where t (0 to 1) puts a point along it — around a circle
    from its right, along a polygon's sides from its first corner, an arc from
    its start; along a line, t = 0 and 1 are the two points it's drawn through"""
    if not is_shape(obj):
        raise MathInputError("point( ) puts a point on a shape: point(circle(A, 3), t)")
    kind = obj.func.__name__
    if kind in STRAIGHT:
        a, b = _through(obj)
        return Tuple(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
    if kind == "circle":
        c, r = _circle_parts(obj)
        return Tuple(c[0] + r * sympy.cos(2 * sympy.pi * t), c[1] + r * sympy.sin(2 * sympy.pi * t))
    if kind == "arc":
        o, a, b = obj.args
        n = lambda v: float(sympy.N(v))  # noqa: E731
        start = math.atan2(n(a[1] - o[1]), n(a[0] - o[0]))
        sweep = (math.atan2(n(b[1] - o[1]), n(b[0] - o[0])) - start) % (2 * math.pi) or 2 * math.pi
        r = sympy.sqrt((a[0] - o[0]) ** 2 + (a[1] - o[1]) ** 2)
        return Tuple(o[0] + r * sympy.cos(start + t * sweep), o[1] + r * sympy.sin(start + t * sweep))
    if kind == "polygon":
        # along the sides, by how far around: t = 0.5 is halfway round
        pts = list(obj.args)
        n = len(pts)
        lengths = [float(sympy.N(sympy.sqrt((pts[(i + 1) % n][0] - pts[i][0]) ** 2 + (pts[(i + 1) % n][1] - pts[i][1]) ** 2))) for i in range(n)]
        total = sum(lengths)
        s = sympy.Mod(t, 1) * total
        pieces, done = [], 0.0
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % n]
            k = (s - done) / lengths[i] if lengths[i] else 0
            pieces.append(((p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])), s <= done + lengths[i]))
            done += lengths[i]
        return Tuple(*(sympy.Piecewise(*[(c[j], cond) for c, cond in pieces[:-1]], (pieces[-1][0][j], True)) for j in (0, 1)))
    raise MathInputError(f"point( ) works on segments, lines, circles, arcs and polygons — not a {kind}")


def build_more(name: str, args: list):
    """the constructions past the basic ones — None when the name isn't one of them"""
    if name == "point":
        if len(args) != 2:
            raise MathInputError("point( ) takes a shape and how far along it: point(circle(A, 3), t)")
        return _on(args[0], args[1])
    if name == "locus":
        # the path a point takes as one letter runs (0 to 1, unless said)
        if len(args) not in (2, 4) or not isinstance(args[0], Tuple) or not isinstance(args[1], sympy.Symbol):
            raise MathInputError("locus( ) takes a point and the letter that moves it: locus(P, t) — or locus(P, t, 0, 5)")
        lo, hi = (args[2], args[3]) if len(args) == 4 else (0, 1)
        return F("locus")(args[0], args[1], lo, hi)
    if name == "intersection":
        if len(args) not in (2, 3):
            raise MathInputError("intersection( ) takes two things — and which crossing: intersection(a, b, 2)")
        pts = intersections(args[0], args[1])
        if len(args) == 3:
            k = int(args[2])
            if not 1 <= k <= len(pts):
                raise MathInputError(f"they cross {len(pts)} time{'s' if len(pts) != 1 else ''}, not {k}")
            return pts[k - 1]
        if not pts:
            raise MathInputError("they don't cross")
        return pts[0] if len(pts) == 1 else F("points")(*pts)
    if name == "reflect":
        if len(args) != 2:
            raise MathInputError("reflect( ) takes what to reflect and a line or point: reflect(A, line(B, C))")
        obj, m = args
        if isinstance(m, Tuple):
            return _map(obj, lambda p: _pt(2 * m[0] - p[0], 2 * m[1] - p[1]))
        if is_shape(m) and m.func.__name__ in STRAIGHT:
            a, b = _through(m)
            d = (b[0] - a[0], b[1] - a[1])
            dd = d[0] ** 2 + d[1] ** 2

            def mirror(p):
                k = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / dd
                return _pt(2 * (a[0] + k * d[0]) - p[0], 2 * (a[1] + k * d[1]) - p[1])

            return _map(obj, mirror, flip=True)
        raise MathInputError("reflect over a line (segment, ray) or a point")
    if name == "rotate":
        if len(args) not in (2, 3):
            raise MathInputError("rotate( ) takes what to turn, the angle (degrees), and the center: rotate(A, 90, B)")
        obj, angle = args[0], _degrees_or_radians(sympy.sympify(args[1]))
        c = _point(args[2], name) if len(args) == 3 else Tuple(0, 0)
        cs, sn = sympy.cos(angle), sympy.sin(angle)
        return _map(obj, lambda p: _pt(c[0] + (p[0] - c[0]) * cs - (p[1] - c[1]) * sn, c[1] + (p[0] - c[0]) * sn + (p[1] - c[1]) * cs))
    if name == "translate":
        if len(args) != 2:
            raise MathInputError("translate( ) takes what to move and how far: translate(A, vector(B, C)) or translate(A, (2, 3))")
        obj, v = args
        if is_shape(v) and v.func.__name__ in STRAIGHT:
            a, b = _through(v)
            d = (b[0] - a[0], b[1] - a[1])
        else:
            d = _point(v, name)
        return _map(obj, lambda p: _pt(p[0] + d[0], p[1] + d[1]))
    if name == "dilate":
        if len(args) not in (2, 3):
            raise MathInputError("dilate( ) takes what to scale, the factor, and the center: dilate(A, 2, B)")
        obj, k = args[0], args[1]
        c = _point(args[2], name) if len(args) == 3 else Tuple(0, 0)
        return _map(obj, lambda p: _pt(c[0] + k * (p[0] - c[0]), c[1] + k * (p[1] - c[1])), scale=sympy.Abs(k))
    if name in ("arc", "sector"):
        if len(args) != 3:
            raise MathInputError(f"{name}( ) takes its center, then where it starts and ends (counterclockwise): {name}(O, A, B)")
        return F(name)(*[_point(p, name) for p in args])
    if name == "semicircle":
        if len(args) != 2:
            raise MathInputError("semicircle( ) takes the two ends: semicircle(A, B)")
        a, b = (_point(p, name) for p in args)
        return F("arc")(_pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), a, b)
    if name == "bisector":
        if len(args) == 2:
            a, b = (_point(p, name) for p in args)
            return F("perpendicular")(F("segment")(a, b), _pt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
        if len(args) == 3:
            a, b, c = (_point(p, name) for p in args)
            ua = sympy.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
            uc = sympy.sqrt((c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2)
            d = ((a[0] - b[0]) / ua + (c[0] - b[0]) / uc, (a[1] - b[1]) / ua + (c[1] - b[1]) / uc)
            if _exact(d[0]) == 0 and _exact(d[1]) == 0:
                d = (-(a[1] - b[1]), a[0] - b[0])
            return F("line")(b, _pt(b[0] + d[0], b[1] + d[1]))
        raise MathInputError("bisector(A, B) halves a segment; bisector(A, B, C) halves the angle at B")
    if name == "tangent":
        if len(args) not in (2, 3) or not (is_shape(args[1]) and args[1].func.__name__ == "circle"):
            raise MathInputError("tangent( ) takes a point and a circle: tangent(P, circle(O, 3))")
        p = _point(args[0], name)
        c, r = _circle_parts(args[1])
        v = (p[0] - c[0], p[1] - c[1])
        d2 = _exact(v[0] ** 2 + v[1] ** 2)
        gap = _num_or_none(d2 - r**2)
        if gap is not None and gap < -1e-12:
            raise MathInputError("that point is inside the circle — no tangent passes through it")
        if gap is not None and abs(gap) < 1e-12:
            return F("perpendicular")(F("segment")(c, p), p)
        k, h = r**2 / d2, r * sympy.sqrt(d2 - r**2) / d2
        touch = [_pt(c[0] + k * v[0] - h * v[1], c[1] + k * v[1] + h * v[0]), _pt(c[0] + k * v[0] + h * v[1], c[1] + k * v[1] - h * v[0])]
        lines = [F("line")(p, t) for t in touch]
        if len(args) == 3:
            return lines[int(args[2]) - 1]
        return F("group")(*lines)
    if name == "length" and len(args) == 1 and is_shape(args[0]) and args[0].func.__name__ == "list":
        return sympy.Integer(len(args[0].args))
    if name == "triangulate":
        # where two sightings meet: from A on one compass bearing, from B on
        # another (degrees clockwise from north, as on a map)
        if len(args) != 4:
            raise MathInputError("triangulate( ) takes a point and its bearing, then another: triangulate(A, 40, B, 310)")
        a, b = _point(args[0], name), _point(args[2], name)
        da = (sympy.sin(args[1] * sympy.pi / 180), sympy.cos(args[1] * sympy.pi / 180))
        db = (sympy.sin(args[3] * sympy.pi / 180), sympy.cos(args[3] * sympy.pi / 180))
        det = _exact(_cross(da, db))
        if det == 0:
            raise MathInputError("those bearings run side by side — they never meet")
        w = (b[0] - a[0], b[1] - a[1])
        t, s = _exact(_cross(w, db) / det), _exact(_cross(w, da) / det)
        if (_num_or_none(t) or 0) < -1e-9 or (_num_or_none(s) or 0) < -1e-9:
            raise MathInputError("those sightings meet behind one of the points — check the bearings")
        return _pt(a[0] + t * da[0], a[1] + t * da[1])
    if name in ("length", "area", "perimeter", "slope"):
        if len(args) != 1 or not is_shape(args[0]):
            raise MathInputError(f"{name}( ) takes one shape: {name}(segment(A, B))")
        o = args[0]
        kind = o.func.__name__
        if name == "slope":
            if kind not in STRAIGHT:
                raise MathInputError("slope( ) takes a line, segment or ray")
            a, b = _through(o)
            dx = _exact(b[0] - a[0])
            if dx == 0:
                raise MathInputError("it's straight up and down — its slope is undefined")
            return _exact((b[1] - a[1]) / dx)
        if kind == "circle":
            _, r = _circle_parts(o)
            return sympy.pi * r**2 if name == "area" else 2 * sympy.pi * r
        if kind in ("segment", "vector") and name == "length":
            a, b = o.args
            return sympy.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)
        if kind == "polygon":
            pts, n = list(o.args), len(o.args)
            if name == "area":
                return sympy.Abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2
            return sum(sympy.sqrt((pts[(i + 1) % n][0] - pts[i][0]) ** 2 + (pts[(i + 1) % n][1] - pts[i][1]) ** 2) for i in range(n))
        raise MathInputError(f"can't take the {name} of a {kind}")
    return None


def _arc_draw(shape, num):
    kind = shape.func.__name__
    o, a, b = shape.args
    ox, oy, ax, ay, bx, by = (num(v) for v in (o[0], o[1], a[0], a[1], b[0], b[1]))
    r = math.hypot(ax - ox, ay - oy)
    if r < 1e-12:
        raise MathInputError("its start is its center — move one")
    t1, t2 = math.atan2(ay - oy, ax - ox), math.atan2(by - oy, bx - ox)
    sweep = (t2 - t1) % (2 * math.pi) or 2 * math.pi
    ts = np.linspace(t1, t1 + sweep, max(24, int(240 * sweep / (2 * math.pi))))
    xs, ys = (ox + r * np.cos(ts)).tolist(), (oy + r * np.sin(ts)).tolist()
    deg = math.degrees(sweep)
    said = f"{round(deg)}" if abs(deg - round(deg)) < 1e-6 else f"{deg:.4g}"
    facts = [f"{said}^{{\\circ}}", f"\\text{{arc length }}\\approx{r * sweep:.4g}"]
    if kind == "sector":
        facts.append(f"\\text{{area }}\\approx{r * r * sweep / 2:.4g}")
        return {"kind": "polygon", "x": [ox, *xs, ox], "y": [oy, *ys, oy], "shape": kind, "facts": facts}
    return {"kind": "curve", "x": xs, "y": ys, "shape": kind, "facts": facts}


def point_tex(p) -> str:
    """(1 + √2, 3/2) — a computed point, said exactly"""
    return f"\\left({number_tex(p[0])},{number_tex(p[1])}\\right)".replace("\\approx", "≈")
