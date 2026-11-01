"""The xy graph's engine: each typed line (LaTeX) is read for what it is
and drawn the way it needs —

  y = f(x), f(x) = …   a function (and a name other lines can use)
  x = g(y)             a function of y (a sideways parabola)
  x² + y² = 25         any equation in x and y: traced as a contour
  y < 2x + 1           shaded above or below its boundary
  x² + y² ≤ 9, 0<y<x   any region: shaded where it's true
  x = 3                a vertical line
  r = 1 + cos θ        polar, θ from 0 to 2π (or as restricted)
  (cos t, sin t)       parametric, t from 0 to 2π (or as restricted)
  dy/dx = x − y        a slope field
  (1, 2), (3, 4)       points
  … {0 ≤ x ≤ 2}        only where the restriction holds

and the points worth knowing are marked: intercepts, maximums and minimums,
holes, where curves cross; asymptotes are drawn dashed. Per line, on
request: the derivative's graph, a tangent line, the area under it."""

from __future__ import annotations

import math

import numpy as np
import sympy
from sympy import Symbol  # noqa: F401 — also a point's sliding letter

from . import geometry, graphtex
from .graphtex import DYDX, THETA, T, X, Y
from .graphing import _label, real_roots
from .parsing import MathInputError, build_scope, parse

R = Symbol("r")
FAR = 1e5
BOUND = {"x", "y"}


# ------------------------------------------------------------------ numbers


def _numeric(expr, *syms):
    f = sympy.lambdify(syms, expr, modules=["numpy"])

    def call(*arrays):
        with np.errstate(all="ignore"):
            try:
                v = f(*arrays)
            except (ZeroDivisionError, ValueError, TypeError, OverflowError):
                return np.full(np.shape(arrays[0]), np.nan)
            v = np.asarray(v)
            if np.iscomplexobj(v):
                v = np.where(np.abs(v.imag) < 1e-9, v.real, np.nan)
            v = np.broadcast_to(v.astype(float), np.shape(arrays[0])).copy()
        v[~np.isfinite(v)] = np.nan
        return v

    return call


def _lists(*arrays):
    """numpy → JSON lists, NaN as a gap (null)"""
    return [[None if (v is None or v != v) else round(float(v), 6) for v in a] for a in arrays]


def _degrees(expr):
    """trig in degrees: sin(30) is ½, arcsin(½) is 30"""
    rad = sympy.pi / 180
    for fn in (sympy.sin, sympy.cos, sympy.tan, sympy.sec, sympy.csc, sympy.cot):
        expr = expr.replace(fn, lambda a, fn=fn: fn(a * rad))
    for fn in (sympy.asin, sympy.acos, sympy.atan, sympy.asec, sympy.acsc, sympy.acot):
        expr = expr.replace(fn, lambda a, fn=fn: fn(a) / rad)
    return expr


# ------------------------------------------------------------------ shapes


# log axes, for this request: sample in powers of ten along them
_LOG = {"x": False, "y": False}


def _function_series(expr, conds, xr, yr):
    xs = np.geomspace(xr[0], xr[1], 1800) if _LOG["x"] and xr[0] > 0 else np.linspace(xr[0], xr[1], 1800)
    ys = _numeric(expr, X)(xs)
    ys = _mask(ys, conds, xs, ys)
    span = yr[1] - yr[0]
    # a jump across the window between two samples is an asymptote, not a line
    jump = np.abs(np.diff(ys)) > 3 * span
    ys[:-1][jump & (np.sign(ys[:-1]) != np.sign(ys[1:]))] = np.nan
    ys[np.abs(ys) > (1e15 if _LOG["y"] else 1e6)] = np.nan
    return xs, ys


def _mask(values, conds, xs, ys):
    for c in conds:
        ok = _numeric(sympy.Piecewise((1, c), (0, True)), X, Y)(xs, ys) > 0.5
        values = np.where(ok, values, np.nan)
    return values


def _contours(F, xs, ys):
    """where F = 0 on a grid: little segments, gaps between (marching squares)"""
    ny, nx = F.shape
    out_x: list = []
    out_y: list = []
    finite = np.isfinite(F)
    pos = F > 0
    # how big a step F takes between neighbors, to tell a crossing from a pole
    steps = np.concatenate([np.abs(np.diff(F, axis=0)).ravel(), np.abs(np.diff(F, axis=1)).ravel()])
    steps = steps[np.isfinite(steps)]
    typical = float(np.median(steps)) if steps.size else 1.0
    corners = (pos[:-1, :-1], pos[:-1, 1:], pos[1:, 1:], pos[1:, :-1])
    ok = finite[:-1, :-1] & finite[:-1, 1:] & finite[1:, 1:] & finite[1:, :-1]
    mixed = ok & ~((corners[0] == corners[1]) & (corners[1] == corners[2]) & (corners[2] == corners[3]))
    for j, i in np.argwhere(mixed):
        pts = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
        vals = [F[b, a] for a, b in pts]
        crossings = []
        for k in range(4):
            (a0, b0), (a1, b1) = pts[k], pts[(k + 1) % 4]
            v0, v1 = vals[k], vals[(k + 1) % 4]
            if (v0 > 0) != (v1 > 0):
                if min(abs(v0), abs(v1)) > 25 * typical:
                    crossings = []  # jumps across a pole, not a crossing
                    break
                f = v0 / (v0 - v1)
                crossings.append((xs[a0] + f * (xs[a1] - xs[a0]), ys[b0] + f * (ys[b1] - ys[b0])))
        if len(crossings) == 2:
            pairs = [crossings]
        elif len(crossings) == 4:
            center = sum(vals) / 4
            pairs = [[crossings[0], crossings[1]], [crossings[2], crossings[3]]] if (center > 0) == (vals[0] > 0) else [[crossings[0], crossings[3]], [crossings[1], crossings[2]]]
        else:
            continue
        for (xa, ya), (xb, yb) in pairs:
            out_x += [xa, xb, None]
            out_y += [ya, yb, None]
    return out_x, out_y


def _grid(window, cells=260):
    (x0, x1), (y0, y1) = window
    w, h = x1 - x0, y1 - y0
    nx = cells
    ny = int(max(60, min(500, cells * h / w)))
    pad_x, pad_y = w * 0.15, h * 0.15
    xs = np.geomspace(x0 / 1.5, x1 * 1.5, nx) if _LOG["x"] and x0 > 0 else np.linspace(x0 - pad_x, x1 + pad_x, nx)
    ys = np.geomspace(y0 / 1.5, y1 * 1.5, ny) if _LOG["y"] and y0 > 0 else np.linspace(y0 - pad_y, y1 + pad_y, ny)
    return xs, ys, np.meshgrid(xs, ys)


def _implicit(F_expr, conds, window):
    xs, ys, (gx, gy) = _grid(window)
    F = _numeric(F_expr, X, Y)(gx, gy)
    F = _mask(F, conds, gx, gy)
    cx, cy = _contours(F, xs, ys)
    if not cx:
        raise MathInputError("nothing to draw here — no point in view makes it true")
    return {"kind": "curve", "x": [None if v is None else round(float(v), 6) for v in cx], "y": [None if v is None else round(float(v), 6) for v in cy]}


def _region(sides, ops, conds, window):
    xs, ys, (gx, gy) = _grid(window, cells=180)
    ok = np.ones(gx.shape, dtype=bool)
    for k, op in enumerate(ops):
        a = _numeric(sides[k], X, Y)(gx, gy)
        b = _numeric(sides[k + 1], X, Y)(gx, gy)
        with np.errstate(invalid="ignore"):
            ok &= {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
    for c in conds:
        ok &= _numeric(sympy.Piecewise((1, c), (0, True)), X, Y)(gx, gy) > 0.5
    # its edges: each boundary, drawn where it borders the region
    bx: list = []
    by: list = []
    fx, fy, (hx, hy) = _grid(window)
    for k in range(len(ops)):
        F = _numeric(sides[k] - sides[k + 1], X, Y)(hx, hy)
        others = np.ones(hx.shape, dtype=bool)
        for m, op in enumerate(ops):
            if m == k:
                continue
            a = _numeric(sides[m], X, Y)(hx, hy)
            b = _numeric(sides[m + 1], X, Y)(hx, hy)
            with np.errstate(invalid="ignore"):
                others &= {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
        F = np.where(others, F, np.nan)
        cx, cy = _contours(F, fx, fy)
        bx += cx
        by += cy
    if not ok.any():
        raise MathInputError("nothing to shade here — no point in view makes it true")
    return {
        "kind": "region",
        "gx": [round(float(v), 6) for v in xs],
        "gy": [round(float(v), 6) for v in ys],
        "z": ok.astype(int).tolist(),
        "x": [None if v is None else round(float(v), 6) for v in bx],
        "y": [None if v is None else round(float(v), 6) for v in by],
        "strict": all(op in ("<", ">") for op in ops),
    }


def _range(var, conds, default):
    """t (or θ) from a restriction like {0 ≤ t ≤ 4π}, else the default"""
    lo, hi = default
    rest = []
    for c in conds:
        parts = c.args if isinstance(c, sympy.And) else (c,)
        for p in parts:
            if isinstance(p, sympy.core.relational.Relational) and p.free_symbols == {var}:
                side = p.lhs if p.lhs != var else p.rhs
                value = float(side)
                if (p.lhs == var) == isinstance(p, (sympy.Lt, sympy.Le)):
                    hi = value
                else:
                    lo = value
            else:
                rest.append(p)
    return lo, hi, rest


def _slope_field(f, window):
    (x0, x1), (y0, y1) = window
    cols = 22
    step = (x1 - x0) / cols
    rows = max(8, int((y1 - y0) / step))
    xs = x0 + step * (np.arange(cols) + 0.5)
    ys = y0 + (y1 - y0) / rows * (np.arange(rows) + 0.5)
    gx, gy = np.meshgrid(xs, ys)
    m = _numeric(f, X, Y)(gx, gy)
    half = step * 0.36
    d = np.sqrt(1 + m**2)
    dx, dy = half / d, half * m / d
    out_x: list = []
    out_y: list = []
    for cx, cy, ex, ey in zip(gx.ravel(), gy.ravel(), dx.ravel(), dy.ravel()):
        if np.isfinite(ex) and np.isfinite(ey):
            out_x += [cx - ex, cx + ex, None]
            out_y += [cy - ey, cy + ey, None]
        else:  # undefined slope: a short vertical mark
            out_x += [cx, cx, None]
            out_y += [cy - half, cy + half, None]
    return {"kind": "field", "x": [None if v is None else round(float(v), 6) for v in out_x], "y": [None if v is None else round(float(v), 6) for v in out_y]}


# ------------------------------------------------------------------ marks


def _function_markers(i, expr, window, features):
    marks = []
    lo, hi = window[0]
    f = _numeric(expr, X)
    value = lambda v: float(f(np.array([v]))[0])  # noqa: E731
    if "intercepts" in features:
        try:
            for r in real_roots(expr, lo, hi):
                marks.append({"x": float(r), "y": 0.0, "kind": "x-intercept", "series": i, "label": _label(float(r), 0)})
        except Exception:  # noqa: BLE001
            pass
        if lo <= 0 <= hi:
            y0 = value(0.0)
            if y0 == y0:
                marks.append({"x": 0.0, "y": y0, "kind": "y-intercept", "series": i, "label": _label(0, y0)})
    if "vertices" in features:
        try:
            d = sympy.diff(expr, X)
            quadratic = expr.is_polynomial(X) and sympy.degree(expr, X) == 2
            for r in real_roots(d, lo, hi)[:40]:
                r = float(r)
                yv = value(r)
                if yv != yv:
                    continue
                h = max(1e-4, (hi - lo) * 1e-4)
                left, right = value(r - h), value(r + h)
                if left != left or right != right:
                    continue
                if left < yv and right < yv:
                    kind = "max"
                elif left > yv and right > yv:
                    kind = "min"
                else:
                    continue
                marks.append({"x": r, "y": yv, "kind": "vertex" if quadratic else kind, "series": i, "label": _label(r, yv)})
        except Exception:  # noqa: BLE001
            pass
    # holes: where a factor cancels (x²−1)/(x−1) has one at x = 1
    try:
        if expr.is_rational_function(X):
            num, den = sympy.fraction(sympy.together(expr))
            reduced = sympy.cancel(expr)
            rden = sympy.fraction(sympy.together(reduced))[1]
            for r in real_roots(den, lo, hi):
                if abs(float(sympy.N(rden.subs(X, r)))) > 1e-12:
                    yv = float(sympy.N(reduced.subs(X, r)))
                    marks.append({"x": float(r), "y": yv, "kind": "hole", "series": i, "label": _label(float(r), yv)})
    except Exception:  # noqa: BLE001
        pass
    return marks


def _asymptotes(expr, window):
    """vertical asymptotes of a rational function (where it blows up)"""
    try:
        if not expr.is_rational_function(X):
            return []
        reduced = sympy.cancel(expr)
        den = sympy.fraction(sympy.together(reduced))[1]
        if not den.has(X):
            return []
        return [round(float(r), 9) for r in real_roots(den, window[0][0] - 1e-9, window[0][1] + 1e-9)]
    except Exception:  # noqa: BLE001
        return []


# ------------------------------------------------------------------ a line


def _values(vars_: dict) -> dict:
    """slider and variable values (as typed) → numbers to put in"""
    scope = build_scope({})
    out = {}
    for name, text in (vars_ or {}).items():
        if "(" in name:
            continue
        try:
            value = parse(str(text), scope)
            # a slider's 10.978 is a measurement, not the fraction 5489/500
            if "." in str(text) and getattr(value, "is_Rational", False) and not value.is_Integer:
                value = sympy.Float(value)
            out[Symbol(name)] = value
        except Exception:  # noqa: BLE001
            continue
    return out


def _letters(*exprs, bound=()):
    names = set()
    for e in exprs:
        names |= {str(s) for s in getattr(e, "free_symbols", set())}
    return sorted(names - set(bound) - {"DYDX"})


def graph_line(i, p: graphtex.Parsed, values: dict, xr, window, degrees: bool):
    """a read line → what to draw (a series), and its function (for marks)"""
    fix = (lambda e: _degrees(e)) if degrees else (lambda e: e)
    # a locus keeps its moving letter free (it runs over it), whatever the slider says
    if p.sides and geometry.is_shape(p.sides[0]) and p.sides[0].func.__name__ == "locus":
        values = {k: v for k, v in values.items() if k != p.sides[0].args[1]}
    sides = [fix(s.subs(values)) if hasattr(s, "subs") else s for s in p.sides]
    conds = [c.subs(values) for c in p.conditions]

    def need(*exprs, bound=BOUND):
        missing = _letters(*exprs, *conds, bound=bound)
        if missing:
            err = MathInputError(f"give {', '.join(missing)} a value to graph this")
            err.missing = missing  # type: ignore[attr-defined]
            raise err

    yr = window[1]
    if p.tuples is not None:
        items = [sympy.Tuple(*[fix(c.subs(values)) for c in tup]) for tup in p.tuples]
        if any(len(t) != 2 for t in items):
            raise MathInputError("a point is (x, y)")
        free = set().union(*[t.free_symbols for t in items])
        if not free:
            pts = [(float(t[0]), float(t[1])) for t in items]
            out = {"kind": "points", "x": [a for a, _ in pts], "y": [b for _, b in pts], "latex": ", ".join(_label(a, b) for a, b in pts)}
            if p.name:
                out["name"] = p.name
            if p.computed:
                out["facts"] = [geometry.point_tex(t) for t in items]
            if p.glide and len(p.tuples) == 1:
                out.update(_glide_path(p.tuples[0], p.glide, values, window))
            return out, None
        if len(items) == 1 and T in free:
            need(*items[0], bound={"t"})
            trig = items[0].has(sympy.sin, sympy.cos, sympy.tan)
            lo, hi, rest = _range(T, conds, (0, 2 * math.pi) if trig else (-10, 10))
            ts = np.linspace(lo, hi, 2400)
            xs, ys = _numeric(items[0][0], T)(ts), _numeric(items[0][1], T)(ts)
            for c in rest:
                ok = _numeric(sympy.Piecewise((1, c), (0, True)), T)(ts) > 0.5
                xs, ys = np.where(ok, xs, np.nan), np.where(ok, ys, np.nan)
            ax, ay = _lists(xs, ys)
            return {"kind": "curve", "x": ax, "y": ay, "parametric": [lo, hi]}, None
        need(*items[0], bound={"t"})
        raise MathInputError("a point needs numbers — or use t for a parametric curve: (cos t, sin t)")

    if not p.ops and geometry.is_shape(sides[0]):
        locus = sides[0].func.__name__ == "locus"
        need(sides[0], bound=BOUND | ({str(sides[0].args[1])} if locus else set()))
        return geometry.draw(sides[0], window)

    if not p.ops:
        e = sides[0]
        if not e.has(X, Y):
            # just a number — distance(A, B), 3 + 4: its value, nothing to draw
            need(e)
            v = sympy.N(e)
            if not v.is_real:
                raise MathInputError("that's not a real number")
            return {"kind": "value", "value": float(v), "facts": [f"={geometry.number_tex(e)}"]}, None
        if e.has(Y):
            raise MathInputError("add = or < to make it an equation in x and y")
        need(e)
        xs, ys = _function_series(e, conds, xr, yr)
        ax, ay = _lists(xs, ys)
        return {"kind": "function", "x": ax, "y": ay}, (e if not conds else None)

    if p.ops == ["="]:
        L, Rr = sides
        if p.define:
            _, params = p.define
            body = Rr.subs(params[0], X) if params else Rr
            need(body)
            xs, ys = _function_series(body, conds, xr, yr)
            ax, ay = _lists(xs, ys)
            return {"kind": "function", "x": ax, "y": ay}, (body if not conds else None)
        if L == R and not Rr.has(X, Y):
            need(Rr, bound={"theta"})
            lo, hi, rest = _range(THETA, conds, (0, 2 * math.pi))
            th = np.linspace(lo, hi, 2400)
            r = _numeric(Rr, THETA)(th)
            for c in rest:
                r = np.where(_numeric(sympy.Piecewise((1, c), (0, True)), THETA)(th) > 0.5, r, np.nan)
            ax, ay = _lists(r * np.cos(th), r * np.sin(th))
            return {"kind": "curve", "x": ax, "y": ay, "polar": [lo, hi]}, None
        if L == DYDX:
            need(Rr)
            return _slope_field(Rr, window), None
        if L == Y and not Rr.has(Y):
            need(Rr)
            xs, ys = _function_series(Rr, conds, xr, yr)
            ax, ay = _lists(xs, ys)
            return {"kind": "function", "x": ax, "y": ay}, (Rr if not conds else None)
        if Rr == Y and not L.has(Y):
            need(L)
            xs, ys = _function_series(L, conds, xr, yr)
            ax, ay = _lists(xs, ys)
            return {"kind": "function", "x": ax, "y": ay}, (L if not conds else None)
        F = sympy.expand(L - Rr)
        need(F)
        if L == X and not Rr.has(X) and Rr.has(Y):
            # x = g(y): a function of y, drawn sideways
            span = yr[1] - yr[0]
            ys = np.linspace(yr[0] - span, yr[1] + span, 1800)
            xs = _numeric(Rr, Y)(ys)
            xs = _mask(xs, conds, xs, ys)
            ax, ay = _lists(xs, ys)
            return {"kind": "curve", "x": ax, "y": ay}, None
        if not F.has(Y):
            if not F.has(X):
                raise MathInputError("that's always true or always false — there's nothing to draw")
            roots = real_roots(F, window[0][0] - (window[0][1] - window[0][0]), window[0][1] + (window[0][1] - window[0][0]))
            if not roots:
                raise MathInputError("no x makes that true")
            if len(roots) == 1:
                return {"kind": "vline", "x0": float(roots[0])}, None
            cx, cy = [], []
            for r in roots:
                cx += [float(r), float(r), None]
                cy += [-FAR, FAR, None]
            return {"kind": "curve", "x": cx, "y": cy}, None
        # linear in y: y = … exactly (2x + 3y = 6)
        if F.is_polynomial(Y) and sympy.degree(F, Y) == 1:
            a = F.coeff(Y, 1)
            if not a.has(X, Y) and a != 0:
                expr = sympy.simplify(-(F - a * Y) / a)
                xs, ys = _function_series(expr, conds, xr, yr)
                ax, ay = _lists(xs, ys)
                return {"kind": "function", "x": ax, "y": ay}, (expr if not conds else None)
        return _implicit(F, conds, window), None

    if "!=" in p.ops:
        raise MathInputError("≠ can't be shaded — use < or >")
    need(*sides)
    # y < f(x) (one side just y): shaded above or below, like a textbook
    if len(p.ops) == 1:
        L, Rr = sides
        op = p.ops[0]
        flip = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}
        boundary = None
        if L == Y and not Rr.has(Y):
            boundary, rel = Rr, op
        elif Rr == Y and not L.has(Y):
            boundary, rel = L, flip[op]
        if boundary is not None and not conds:
            xs, ys = _function_series(boundary, [], xr, yr)
            ax, ay = _lists(xs, ys)
            return {"kind": "inequality", "x": ax, "y": ay, "shade": "above" if rel in (">", ">=") else "below", "strict": rel in ("<", ">")}, None
        if not L.has(Y) and not Rr.has(Y) and not conds:
            roots = real_roots(sympy.expand(L - Rr), window[0][0] - 50, window[0][1] + 50)
            if len(roots) == 1:
                k = float(roots[0])
                test = float((L - Rr).subs(X, k + 1))
                bigger = test > 0 if op in (">", ">=") else test < 0
                return {"kind": "inequality", "vertical": True, "x0": k, "shade": "right" if bigger else "left", "strict": op in ("<", ">")}, None
    return _region(sides, p.ops, conds, window), None


# ------------------------------------------------------------------ the op


def _context(lines: list[str], consts: set) -> tuple[dict, dict]:
    """functions defined on any line (f(x) = …), and points and shapes named
    on one (A = (1, 2)), can be used on every line — in any order"""
    functions: dict = {}
    points: dict = {}
    for _ in range(4):
        for text in lines:
            try:
                if graphtex.definition(text):
                    p = graphtex.read_line(text, functions, consts, points)
                    name, params = p.define
                    functions[name] = (params, p.sides[1])
                elif graphtex.naming(text):
                    p = graphtex.read_line(text, functions, consts, points)
                    if p.name:
                        points[p.name] = p.sides[0]
            except Exception:  # noqa: BLE001 — reported with its line in the graph
                pass
    return functions, points


def _said(v) -> str:
    """a table's number, as it'd be written: 7, -3/4, 2.449"""
    if v.is_Integer:
        return str(v)
    if v.is_Rational and v.q <= 1000:
        return f"{v.p}/{v.q}"
    return f"{float(v):.6g}"


def op_values(req: dict) -> dict:
    """a table of values for one row (y = …, or f(x) = …): its y at each x, exact where it can be"""
    lines = [str(s) for s in req.get("exprs") or []]
    index = int(req.get("index", 0))
    values = _values(req.get("vars") or {})
    consts = {str(s) for s in values}
    functions, points = _context(lines, consts)
    p = graphtex.read_line(lines[index], functions, consts, points)
    if p.define:
        params = p.define[1]
        expr = p.sides[1].subs(params[0], X) if params else p.sides[1]
    elif p.ops == ["="] and p.sides[0] == Y and not p.sides[1].has(Y):
        expr = p.sides[1]
    elif not p.ops and not p.sides[0].has(Y) and not isinstance(p.sides[0], sympy.Tuple):
        expr = p.sides[0]
    else:
        raise MathInputError("a table of values needs y = … or f(x) = …")
    expr = expr.subs(values)
    if req.get("degrees"):
        expr = _degrees(expr)
    out = []
    for x in req.get("xs") or []:
        try:
            v = sympy.simplify(expr.subs(X, sympy.nsimplify(str(x))))
            f = float(sympy.N(v))
            out.append({"y": f, "text": _said(v)} if math.isfinite(f) and v.is_real is not False else {"y": None, "text": "undefined"})
        except Exception:  # noqa: BLE001 — undefined there (÷0, √ of a negative)
            out.append({"y": None, "text": "undefined"})
    return {"rows": out}


def op_graph2d(req: dict) -> dict:
    lines = [str(s) for s in req.get("exprs") or []]
    xr = [float(v) for v in req.get("xrange") or [-30, 30]]
    yr = [float(v) for v in req.get("yrange") or [-10, 10]]
    if req.get("window"):
        w = req["window"]
        window = ((float(w["xmin"]), float(w["xmax"])), (float(w["ymin"]), float(w["ymax"])))
    else:
        third = (xr[1] - xr[0]) / 3
        window = ((xr[0] + third, xr[1] - third), (yr[0], yr[1]))
    features = set(req.get("features") or ["intercepts", "vertices", "intersections"])
    log = req.get("log") or {}
    _LOG.update(x=bool(log.get("x")), y=bool(log.get("y")))
    extras = req.get("extras") or []
    degrees = bool(req.get("degrees"))
    values = _values(req.get("vars") or {})
    consts = {str(s) for s in values}

    functions, points = _context(lines, consts)

    series, marks, graphed = [], [], []
    for i, text in enumerate(lines):
        if not text.strip():
            continue
        letters: list = []
        try:
            p = graphtex.read_line(text, functions, consts, points)
            letters = _letters(*p.sides, *p.conditions, *(p.tuples or []), bound={"x", "y", "t", "theta", "r"})
            s, expr = graph_line(i, p, values, xr, window, degrees)
            # a straight line (y = 2x + 1, x = 3): two points on it, to build from
            through = _through(expr) if s["kind"] == "function" and expr is not None else _through_vertical(s)
            if through:
                s["through"] = through
            if expr is not None:
                graphed.append((i, expr))
                if s["kind"] == "function" or s.get("shape"):
                    asym = _asymptotes(expr, window)
                    if asym:
                        s["asymptotes"] = asym
                    marks += _function_markers(i, expr, window, features)
            s["index"] = i
            series.append(s)
            # per line, on request: the derivative, a tangent line, the area under it
            extra = extras[i] if i < len(extras) and extras[i] else {}
            if expr is not None and extra:
                series += _extras(i, expr, extra, xr, window)
                marks += _extra_marks(i, expr, extra)
        except MathInputError as exc:
            s = {"kind": "error", "error": str(exc), "index": i}
            if getattr(exc, "missing", None):
                s["missing"] = exc.missing  # type: ignore[attr-defined]
            series.append(s)
        except Exception as exc:  # noqa: BLE001 — a bad line shouldn't blank the graph
            s = {"kind": "error", "error": f"can't graph that: {exc}", "index": i}
            series.append(s)
        if letters:
            series[-1]["letters"] = sorted(set(letters) - {str(v) for v in []})

    if "intersections" in features and len(graphed) <= 12:
        lo, hi = window[0]
        for a in range(len(graphed)):
            for b in range(a + 1, len(graphed)):
                (ia, fa), (ib, fb) = graphed[a], graphed[b]
                try:
                    for r in real_roots(fa - fb, lo, hi)[:30]:
                        yv = float(sympy.N(fa.subs(X, r)))
                        if math.isfinite(yv):
                            marks.append({"x": float(r), "y": yv, "kind": "intersection", "series": [ia, ib], "label": _label(float(r), yv)})
                except Exception:  # noqa: BLE001
                    continue
    return {"series": series, "markers": marks, "xrange": xr, "yrange": yr}


def _extras(i, expr, extra, xr, window):
    out = []
    if extra.get("derivative"):
        d = sympy.diff(expr, X)
        xs, ys = _function_series(d, [], xr, window[1])
        ax, ay = _lists(xs, ys)
        out.append({"kind": "function", "role": "derivative", "x": ax, "y": ay, "index": i, "facts": [f"y'={_short_tex(sympy.simplify(d))}"]})
    if extra.get("tangent") is not None:
        a = float(extra["tangent"])
        fa = float(sympy.N(expr.subs(X, a)))
        m = float(sympy.N(sympy.diff(expr, X).subs(X, a)))
        if math.isfinite(fa) and math.isfinite(m):
            xs = np.array([xr[0], xr[1]])
            ax, ay = _lists(xs, fa + m * (xs - a))
            at = sympy.nsimplify(extra["tangent"], [sympy.pi], rational=False)
            try:
                equation, _ = geometry.line_tex((at, expr.subs(X, at)), (at + 1, expr.subs(X, at) + sympy.diff(expr, X).subs(X, at)))
            except Exception:  # noqa: BLE001
                equation = f"y={m:.4g}x{(fa - m * a):+.4g}"
            out.append({"kind": "function", "role": "tangent", "x": ax, "y": ay, "index": i, "slope": round(m, 6), "facts": [f"\\text{{tangent at }}x={sympy.latex(at)}:\\ {equation}"]})
    if extra.get("area"):
        lo, hi = (float(v) for v in extra["area"])
        if lo > hi:
            lo, hi = hi, lo
        xs = np.linspace(lo, hi, 400)
        ys = _numeric(expr, X)(xs)
        a, b = (sympy.nsimplify(v, [sympy.pi], rational=False) for v in (lo, hi))
        said = None
        try:
            # exactly, when it's quick to (a polynomial, sin x …), else by adding up thin strips
            exact = sympy.integrate(expr, (X, a, b)) if sympy.count_ops(expr) <= 24 else None
            if exact is not None and not exact.has(sympy.Integral) and exact.is_real:
                value = float(sympy.N(exact))
                said = geometry.number_tex(exact)
            else:
                raise ValueError
        except Exception:  # noqa: BLE001
            fine = np.linspace(lo, hi, 4001)
            value = float(np.trapezoid(np.nan_to_num(_numeric(expr, X)(fine)), fine))
        ax, ay = _lists(xs, ys)
        said = said or f"{value:.6g}"
        out.append({"kind": "area", "x": ax, "y": ay, "index": i, "value": round(value, 6), "from": lo, "to": hi, "facts": [f"\\int_{{{sympy.latex(a)}}}^{{{sympy.latex(b)}}}y\\,dx={said}"]})
    return out


def _glide_path(raw, letter, values, window=None):
    """a point slid along a shape by a letter: the path it can take, with that
    letter's value at each step — so a drag can find the letter that puts it there"""
    var = Symbol(letter)
    rest = {k: v for k, v in values.items() if k != var}
    px, py = (sympy.sympify(c).subs(rest) for c in raw)
    try:
        straight = all(sympy.Poly(c, var).degree() <= 1 for c in (px, py) if c.has(var))
    except Exception:  # noqa: BLE001 — not a polynomial: a circle, a polygon…
        straight = False
    if straight:
        # along a line: far enough each way to cross the view, from where it is now
        try:
            step = math.hypot(*(float(sympy.N(c.subs(var, 1) - c.subs(var, 0))) for c in (px, py))) or 1.0
            now = float(sympy.N(values.get(var, 0)))
        except Exception:  # noqa: BLE001
            step, now = 1.0, 0.0
        reach = 2 * math.hypot(window[0][1] - window[0][0], window[1][1] - window[1][0]) / step if window else 4
        ts = np.linspace(now - reach, now + reach, 2001)
    else:
        ts = np.linspace(0, 1, 721)
    try:
        xs = np.broadcast_to(np.asarray(_numeric(px, var)(ts), dtype=float), ts.shape)
        ys = np.broadcast_to(np.asarray(_numeric(py, var)(ts), dtype=float), ts.shape)
    except Exception:  # noqa: BLE001
        return {"glide": letter}
    ok = np.isfinite(xs) & np.isfinite(ys)
    return {"glide": letter, "path": {"x": xs[ok].round(6).tolist(), "y": ys[ok].round(6).tolist(), "t": ts[ok].round(6).tolist()}}


def _through(expr):
    """y = mx + b: (0, b) and (1, m + b), as math — None when it isn't straight"""
    try:
        if expr.free_symbols - {X} or not expr.is_polynomial(X) or sympy.degree(expr, X) > 1:
            return None
        return [f"\\left(0,{sympy.latex(expr.subs(X, 0))}\\right)", f"\\left(1,{sympy.latex(expr.subs(X, 1))}\\right)"]
    except Exception:  # noqa: BLE001
        return None


def _through_vertical(s):
    if s.get("kind") != "vline" or s.get("x0") is None:
        return None
    c = sympy.latex(sympy.nsimplify(s["x0"], rational=True))
    return [f"\\left({c},0\\right)", f"\\left({c},1\\right)"]


def _short_tex(e) -> str:
    tex = sympy.latex(e)
    return tex if len(tex) <= 60 else "\\dots"


def _extra_marks(i, expr, extra):
    marks = []
    if extra.get("tangent") is not None:
        a = float(extra["tangent"])
        fa = float(sympy.N(expr.subs(X, a)))
        m = float(sympy.N(sympy.diff(expr, X).subs(X, a)))
        if math.isfinite(fa) and math.isfinite(m):
            marks.append({"x": a, "y": fa, "kind": "tangent", "series": i, "label": f"{_label(a, fa)} slope {round(m, 3):g}"})
    return marks


# ------------------------------------------------------------------ data


MODELS = ("linear", "quadratic", "cubic", "exponential", "logarithmic", "power")


def op_regress(req: dict) -> dict:
    """the best curve of a kind through data points (least squares), its
    equation (to graph) and r²"""
    pts = [(float(a), float(b)) for a, b in req.get("points") or []]
    model = req.get("model", "linear")
    if model not in MODELS:
        raise MathInputError(f"unknown model “{model}”")
    need = {"linear": 2, "quadratic": 3, "cubic": 4}.get(model, 2)
    if len(pts) < need:
        raise MathInputError(f"needs at least {need} points")
    x = np.array([p[0] for p in pts])
    y = np.array([p[1] for p in pts])
    n = lambda v: f"{v:.4g}"  # noqa: E731
    if model in ("linear", "quadratic", "cubic"):
        deg = {"linear": 1, "quadratic": 2, "cubic": 3}[model]
        c = np.polyfit(x, y, deg)
        fit = np.polyval(c, x)
        terms = []
        for k, v in enumerate(c):
            p = deg - k
            if abs(v) < 1e-12:
                continue
            body = n(abs(v)) + ("" if p == 0 else "x" if p == 1 else f"x^{{{p}}}")
            terms.append(("-" if v < 0 else "+") + body)
        latex = "y=" + ("".join(terms).lstrip("+") or "0")
    elif model == "exponential":
        if (y <= 0).any():
            raise MathInputError("exponential needs every y above 0")
        k, b = np.polyfit(x, np.log(y), 1)
        a, base = math.exp(b), math.exp(k)
        fit = a * base**x
        latex = f"y={n(a)}\\cdot{n(base)}^{{x}}"
    elif model == "logarithmic":
        if (x <= 0).any():
            raise MathInputError("logarithmic needs every x above 0")
        b, a = np.polyfit(np.log(x), y, 1)
        fit = a + b * np.log(x)
        latex = f"y={n(a)}{'+' if b >= 0 else '-'}{n(abs(b))}\\ln(x)"
    else:
        if (x <= 0).any() or (y <= 0).any():
            raise MathInputError("power needs every x and y above 0")
        b, la = np.polyfit(np.log(x), np.log(y), 1)
        a = math.exp(la)
        fit = a * x**b
        latex = f"y={n(a)}x^{{{n(b)}}}"
    total = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - float(((y - fit) ** 2).sum()) / total if total else 1.0
    return {"latex": latex.replace("+-", "-"), "r2": round(r2, 4)}
