"""Graph (many curves, inequalities, points, key points) and function
tables (with the differences/ratios that reveal linear vs quadratic vs
exponential)."""

import math
import re

import sympy
from sympy import S, Symbol

from .parsing import (
    EQUALS, INEQUALITY, MathInputError, X, Y, build_scope, num, parse, prep, pretty_number,
    strip_function_label, tex, ptex,
)
from .solve import FLIP

SAMPLES = 800
_POINT = re.compile(r"\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)")


def _fmt(value) -> str:
    if value is None:
        return "?"
    rounded = round(value, 2)
    if abs(rounded - round(rounded)) < 1e-9:
        return str(int(round(rounded)))
    return f"{rounded:g}"


def _label(x, y) -> str:
    return f"({_fmt(x)}, {_fmt(y)})"


def _sample(expr, lo, hi, n=SAMPLES):
    f = sympy.lambdify(X, expr, modules=["math"])
    xs, ys = [], []
    step = (hi - lo) / (n - 1)
    for i in range(n):
        xv = lo + i * step
        xs.append(xv)
        try:
            yv = f(xv)
            if isinstance(yv, complex) or yv != yv or abs(yv) > 1e7:
                yv = None
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            yv = None
        ys.append(float(yv) if yv is not None else None)
    return xs, ys


def _break_asymptotes(ys, span):
    """1/x shouldn't draw a vertical line joining -∞ to +∞ — gap there."""
    out = list(ys)
    for i in range(1, len(ys)):
        a, b = ys[i - 1], ys[i]
        if a is not None and b is not None and (a > 0) != (b > 0) and abs(a - b) > 4 * span:
            out[i - 1] = None
    return out


def _numeric_roots(expr, lo, hi, n=2000):
    f = sympy.lambdify(X, expr, modules=["math"])

    def val(xv):
        try:
            v = f(xv)
            return None if isinstance(v, complex) or v != v else float(v)
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            return None

    roots = []
    step = (hi - lo) / n
    prev_x, prev_v = lo, val(lo)
    for i in range(1, n + 1):
        xv = lo + i * step
        v = val(xv)
        if prev_v is not None and v is not None:
            if prev_v == 0:
                roots.append(prev_x)
            elif (prev_v < 0) != (v < 0) and abs(prev_v - v) < 1e3:
                a, b, fa = prev_x, xv, prev_v
                for _ in range(60):
                    m = (a + b) / 2
                    fm = val(m)
                    if fm is None:
                        break
                    if (fa < 0) == (fm < 0):
                        a, fa = m, fm
                    else:
                        b = m
                roots.append((a + b) / 2)
        prev_x, prev_v = xv, v
    deduped = []
    for r in sorted(roots):
        if not deduped or abs(r - deduped[-1]) > 1e-6:
            deduped.append(r)
    return deduped


def real_roots(expr, lo, hi):
    """x-values in [lo, hi] where expr = 0 — exact when sympy can, else numeric."""
    expr = sympy.simplify(expr)
    if expr == 0:
        return []
    numer = sympy.fraction(sympy.together(expr))[0]
    if numer.is_polynomial(X) and numer.has(X):
        roots = []
        for r in sympy.Poly(numer, X).real_roots():
            v = num(r)
            if v is not None and lo - 1e-9 <= v <= hi + 1e-9 and num(expr.subs(X, r)) is not None:
                roots.append(v)
        return sorted(set(round(r, 12) for r in roots))
    return _numeric_roots(expr, lo, hi)


# ------------------------------------------------------------------ lines


def _parse_points(text, scope):
    matches = list(_POINT.finditer(text))
    leftover = _POINT.sub("", text).replace(",", "").strip()
    if not matches or leftover:
        return None
    pts = []
    for m in matches:
        px, py = num(parse(m.group(1), scope)), num(parse(m.group(2), scope))
        if px is None or py is None:
            raise MathInputError(f"can't plot the point {m.group(0)}")
        pts.append((px, py))
    return pts


def _solve_for_y(expr):
    """expr (= 0) → y as a function of x, if it's linear in y."""
    e = sympy.expand(expr)
    if not e.has(Y):
        return None, None
    cy = e.coeff(Y, 1)
    if sympy.expand(e - cy * Y).has(Y) or cy == 0:
        return None, None
    return sympy.simplify(-(e - cy * Y) / cy), cy


_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def unknown_names(text, vars_):
    """Letters a line uses that have no value yet (not x or y) — a graph
    turns each into a slider. 'mx' counts as m·x; the f in 'f(x) =' doesn't."""
    scope = build_scope(vars_, keep_symbolic={"x", "y"})
    text = prep(text)
    names = set()
    for m in _IDENT.finditer(text):
        token = m.group(0)
        if len(token) == 1 and re.match(r"\s*\(\s*x\s*\)", text[m.end():]):
            continue  # a function's name: f(x) = …
        try:
            value = parse(token, scope)
        except Exception:
            continue
        names |= {str(s) for s in getattr(value, "free_symbols", set())}
    return sorted(names - {"x", "y"})


_KNOWN_NAMES = {"sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "pi", "ln", "log", "exp"}


def _graph_spec():
    from .lang.specs import normalize

    # how graph lines are typed: 2x means 2·x, ^ (or **) is a power
    return normalize({"name": "Graph", "power": ["^", "**"], "equals": ["=", "=="], "implicit_multiplication": True}, "graph")


def display_latex(text):
    """The line as the student wrote it — letters and shape kept (y = mx + b,
    not y = 2x + 3 with the slider values filled in, and not reordered)."""
    from . import lang
    from .lang.text import TextReader

    spec = _graph_spec()
    # mx is m·x on a graph (as the grapher reads it), unless it's a function name
    text = re.sub(r"[A-Za-z]{2,}", lambda m: m.group(0) if m.group(0) in _KNOWN_NAMES else " ".join(m.group(0)), text)
    show = lambda part: lang.latex(TextReader(part, spec).parse())  # noqa: E731
    pts = _POINT.findall(text)
    if pts and not _POINT.sub("", text).replace(",", "").strip():
        return ",\\ ".join(f"\\left({show(a)}, {show(b)}\\right)" for a, b in pts)
    label = re.match(r"\s*([a-zA-Z])\s*\(\s*x\s*\)\s*=", text)
    if label:
        return f"{label.group(1)}(x) = " + show(text[label.end():])
    return show(text)


def graph_line(text, vars_, xr, yr):
    scope = build_scope(vars_, keep_symbolic={"x", "y"})
    text = prep(text)
    span = yr[1] - yr[0]

    pts = _parse_points(text, scope)
    if pts is not None:
        return {"kind": "points", "x": [p[0] for p in pts], "y": [p[1] for p in pts], "latex": ", ".join(_label(*p) for p in pts)}

    ops = INEQUALITY.findall(text)
    if ops:
        if len(ops) != 1:
            raise MathInputError("graph one inequality per line")
        rel = ops[0]
        lhs_t, rhs_t = INEQUALITY.split(text)
        lhs, rhs = parse(lhs_t, scope), parse(rhs_t, scope)
        e = sympy.expand(lhs - rhs)
        strict = rel in ("<", ">")
        if not e.has(Y):
            xs_sol = sympy.solve(e, X)
            if len(xs_sol) != 1 or not xs_sol[0].is_number:
                raise MathInputError("couldn't graph this inequality")
            k = num(xs_sol[0])
            cx = e.coeff(X, 1)
            direction = rel if cx > 0 else FLIP[rel]
            shade = "right" if direction in (">", ">=") else "left"
            return {"kind": "inequality", "vertical": True, "x0": k, "shade": shade, "strict": strict,
                    "latex": f"x {'>' if shade == 'right' else '<'}{'' if strict else '='} {tex(xs_sol[0])}".replace(">=", "\\ge").replace("<=", "\\le")}
        boundary, cy = _solve_for_y(e)
        if boundary is None:
            raise MathInputError("couldn't graph this inequality — try the form y < ...")
        direction = rel if cy > 0 else FLIP[rel]  # e REL 0 with e = cy·y + rest
        shade = "above" if direction in (">", ">=") else "below"
        xs, ys = _sample(boundary, xr[0], xr[1])
        rel_out = {"above": ">", "below": "<"}[shade] + ("" if strict else "=")
        return {"kind": "inequality", "x": xs, "y": _break_asymptotes(ys, span), "shade": shade, "strict": strict,
                "latex": f"y {'>' if shade == 'above' else '<'}{'' if strict else '='} {ptex(boundary)}".replace(">=", "\\ge").replace("<=", "\\le"),
                "_expr": boundary, "_rel": rel_out}

    parts = EQUALS.split(text)
    if len(parts) == 2:
        lhs, rhs = parse(parts[0], scope), parse(parts[1], scope)
        e = sympy.expand(lhs - rhs)
        if not e.has(Y):
            if re.fullmatch(r"\s*(?:[a-zA-Z]\s*\(\s*x\s*\))\s*", parts[0]):
                expr = rhs
            else:
                xs_sol = [s for s in sympy.solve(e, X) if s.is_real]
                if len(xs_sol) == 1 and xs_sol[0].is_number:
                    return {"kind": "vline", "x0": num(xs_sol[0]), "latex": f"x = {tex(xs_sol[0])}"}
                raise MathInputError("couldn't graph this equation")
        else:
            expr, _ = _solve_for_y(e)
            if expr is None:
                raise MathInputError("only y = … curves can be graphed here (not circles or other implicit curves)")
    else:
        expr = parse(text, scope)

    if expr.free_symbols - {X}:
        names = ", ".join(sorted(str(s) for s in expr.free_symbols - {X}))
        raise MathInputError(f"give {names} a value (Variable or Slider block) to graph this")
    xs, ys = _sample(expr, xr[0], xr[1])
    return {"kind": "function", "x": xs, "y": _break_asymptotes(ys, span), "latex": f"y = {ptex(expr)}", "_expr": expr}


def _function_markers(i, expr, xr):
    markers = []
    for r in real_roots(expr, xr[0], xr[1]):
        markers.append({"x": r, "y": 0.0, "kind": "x-intercept", "series": i, "label": _label(r, 0)})
    if xr[0] <= 0 <= xr[1]:
        y0 = num(expr.subs(X, 0))
        if y0 is not None:
            markers.append({"x": 0.0, "y": y0, "kind": "y-intercept", "series": i, "label": _label(0, y0)})
    if expr.is_polynomial(X) and sympy.Poly(expr, X).degree() == 2:
        a, b, _ = sympy.Poly(expr, X).all_coeffs()
        h = -b / (2 * a)
        k = expr.subs(X, h)
        hv, kv = num(h), num(k)
        if hv is not None and kv is not None:
            markers.append({"x": hv, "y": kv, "kind": "vertex", "series": i, "label": _label(hv, kv)})
    return markers


def op_graph(req: dict) -> dict:
    lines = req.get("exprs")
    if lines is None:
        lines = [req.get("expr", "")]
    vars_ = dict(req.get("vars") or {})
    vars_.setdefault("e", "exp(1)")  # e is Euler's number on a graph, unless something defines it
    xr = [float(v) for v in (req.get("xrange") or [-10, 10])]
    yr = [float(v) for v in (req.get("yrange") or [-10, 10])]
    if xr[0] >= xr[1] or yr[0] >= yr[1]:
        raise MathInputError("the window's min must be less than its max")
    features = set(req.get("features") or ["intercepts", "vertices", "intersections"])

    series, functions = [], []
    for i, line in enumerate(lines):
        if not str(line).strip():
            continue
        missing = unknown_names(str(line), vars_)
        try:
            if missing:
                raise MathInputError(f"give {', '.join(missing)} a value to graph this")
            s = graph_line(str(line), vars_, xr, yr)
        except MathInputError as exc:
            s = {"kind": "error", "error": str(exc)}
            if missing:
                s["missing"] = missing
        except Exception as exc:  # a bad line shouldn't blank the whole graph
            s = {"kind": "error", "error": f"{type(exc).__name__}: {exc}"}
        s["index"] = i
        if s["kind"] != "error":
            try:
                s["display"] = display_latex(str(line))
            except Exception:  # noqa: BLE001 — fall back to the graphed form
                pass
        series.append(s)
        if "_expr" in s:
            functions.append((i, s["_expr"], s["kind"]))

    markers = []
    for i, expr, kind in functions:
        if kind != "function":
            continue
        for m in _function_markers(i, expr, xr):
            if (m["kind"] == "vertex" and "vertices" in features) or (m["kind"] != "vertex" and "intercepts" in features):
                markers.append(m)
    if "intersections" in features:
        curves = [(i, e) for i, e, _ in functions]
        for a in range(len(curves)):
            for b in range(a + 1, len(curves)):
                (ia, fa), (ib, fb) = curves[a], curves[b]
                for r in real_roots(fa - fb, xr[0], xr[1]):
                    yv = num(fa.subs(X, r)) if not isinstance(r, float) else num(fa.subs(X, sympy.Float(r)))
                    if yv is not None:
                        markers.append({"x": r, "y": yv, "kind": "intersection", "series": [ia, ib], "label": _label(r, yv)})

    for s in series:
        s.pop("_expr", None)
        s.pop("_rel", None)
    return {"series": series, "markers": markers, "xrange": xr, "yrange": yr}


# ------------------------------------------------------------------ table


def _parse_values(text, scope):
    values = []
    for piece in re.split(r"[,\s]+", prep(text).strip()):
        if piece:
            values.append(parse(piece, scope))
    return values


def op_table(req: dict) -> dict:
    vars_ = req.get("vars") or {}
    scope = build_scope(vars_, keep_symbolic={"x"})
    text = strip_function_label(req.get("expr", ""))
    expr = parse(text, scope)
    extra = expr.free_symbols - {X}
    if extra:
        raise MathInputError(f"give {', '.join(sorted(map(str, extra)))} a value to make a table")

    if req.get("xs"):
        xs = _parse_values(req["xs"], scope)
    else:
        start = parse(str(req.get("start", -3)), scope)
        end = parse(str(req.get("end", 3)), scope)
        step_size = parse(str(req.get("step", 1)), scope)
        if step_size <= 0:
            raise MathInputError("the step must be positive")
        count = int(sympy.floor((end - start) / step_size)) + 1
        if count > 60:
            raise MathInputError("that's more than 60 rows — use a bigger step")
        xs = [start + k * step_size for k in range(max(count, 0))]

    rows = []
    for xv in xs:
        try:
            yv = sympy.simplify(expr.subs(X, xv))
            real = num(yv) is not None
        except Exception:
            yv, real = None, False
        rows.append({
            "x_latex": tex(xv), "x": num(xv),
            "y_latex": pretty_number(yv) if real else "\\text{undefined}", "y": num(yv) if real else None,
        })

    ys = [sympy.nsimplify(expr.subs(X, xv)) for xv in xs]
    equally_spaced = len(xs) >= 3 and len({sympy.simplify(b - a) for a, b in zip(xs, xs[1:])}) == 1
    first = [sympy.simplify(b - a) for a, b in zip(ys, ys[1:])] if equally_spaced else []
    second = [sympy.simplify(b - a) for a, b in zip(first, first[1:])] if len(first) >= 2 else []
    ratios = [sympy.simplify(b / a) for a, b in zip(ys, ys[1:])] if equally_spaced and all(y != 0 for y in ys) else []

    pattern = ""
    if first and all(num(d) is not None for d in first):
        if len(set(first)) == 1:
            pattern = f"First differences are all ${tex(first[0])}$ — constant, so the function is **linear** (slope ${tex(first[0] / sympy.simplify(xs[1] - xs[0]))}$)"
        elif second and len(set(second)) == 1:
            pattern = f"Second differences are all ${tex(second[0])}$ — constant, so the function is **quadratic**"
        elif ratios and len(set(ratios)) == 1:
            pattern = f"Each output is ${tex(ratios[0])}$ times the last — a constant ratio, so the function is **exponential**"

    def column(values):
        return [pretty_number(v) if num(v) is not None else "\\text{—}" for v in values]

    return {
        "expr_latex": ptex(expr),
        "rows": rows,
        "first_differences": column(first),
        "second_differences": column(second),
        "ratios": column(ratios),
        "pattern": pattern,
    }


# ------------------------------------------------------------------ fitting


def _exact_points(lines, vars_):
    """Every plotted point in the lines, kept exact: (1/2, 3) stays 1/2."""
    scope = build_scope(vars_ or {})
    points = []
    for line in lines:
        text = prep(str(line))
        matches = list(_POINT.finditer(text))
        if not matches or _POINT.sub("", text).replace(",", "").strip():
            continue
        for m in matches:
            try:
                px, py = sympy.nsimplify(parse(m.group(1), scope)), sympy.nsimplify(parse(m.group(2), scope))
            except Exception:  # noqa: BLE001 — a half-typed point: skip it
                continue
            if not px.free_symbols and not py.free_symbols:
                points.append((px, py))
    return points


def _graph_text(expr) -> str:
    """An expression as a graph line types it (x^2, not x**2)."""
    return str(expr).replace("**", "^")


def _signed(value) -> str:
    return f"+ {value}" if value >= 0 else f"- {-value}"


def op_fit(req: dict) -> dict:
    """A line or parabola through the plotted points: exact when they fit
    exactly (three points → the one parabola through them), otherwise the
    least-squares best fit, with r²."""
    points = _exact_points(req.get("exprs") or [], req.get("vars"))
    kind = req.get("kind", "line")
    xs = {p[0] for p in points}
    need = {"line": 2, "parabola": 3, "vertex": 2}.get(kind)
    if need is None:
        raise MathInputError(f"unknown fit “{kind}”")
    if len(points) < need:
        raise MathInputError(f"plot at least {need} points first")

    if kind == "vertex":
        # the first point is the vertex (h, k); the second sets how wide
        (h, k), (x2, y2) = points[0], points[1]
        if x2 == h:
            raise MathInputError("the second point needs a different x than the vertex")
        a = sympy.nsimplify((y2 - k) / (x2 - h) ** 2)
        coef = "" if a == 1 else "-" if a == -1 else (f"({a})" if not a.is_Integer else str(a))
        inside = "x" if h == 0 else f"(x {_signed(-h)})"
        text = f"y = {coef}{inside}^2" + (f" {_signed(k)}" if k != 0 else "")
        expr = a * (X - h) ** 2 + k
        return {"line": text, "latex": f"y = {ptex(expr)}", "exact": True, "r2": None,
                "note": f"vertex $({tex(h)}, {tex(k)})$, through $({tex(x2)}, {tex(y2)})$"}

    degree = 1 if kind == "line" else 2
    if len(xs) < degree + 1:
        if kind == "line" and len(xs) == 1:
            x0 = next(iter(xs))
            return {"line": f"x = {x0}", "latex": f"x = {tex(x0)}", "exact": True, "r2": None, "note": "every point has the same x — a vertical line"}
        raise MathInputError(f"needs {degree + 1} points with different x values")

    # least squares (exact arithmetic): A c = y, solved through AᵀA c = Aᵀy
    A = sympy.Matrix([[p[0] ** d for d in range(degree, -1, -1)] for p in points])
    yv = sympy.Matrix([p[1] for p in points])
    coeffs = (A.T * A).LUsolve(A.T * yv)
    residual = A * coeffs - yv
    exact = all(sympy.simplify(r) == 0 for r in residual)
    expr = sum(c * X ** (degree - i) for i, c in enumerate(coeffs))
    r2 = None
    if not exact:
        mean = sum(yv) / len(yv)
        total = sum((y - mean) ** 2 for y in yv)
        r2 = round(float(1 - sum(r**2 for r in residual) / total), 4) if total else None
    shape = "line" if degree == 1 else "parabola"
    note = (f"the {shape} through all {len(points)} points" if exact
            else f"best-fit {shape} for {len(points)} points (r² = {r2})")
    if exact:
        expr = sympy.expand(expr)
        return {"line": f"y = {_graph_text(expr)}", "latex": f"y = {ptex(expr)}", "exact": True, "r2": None, "note": note}
    # a best fit: plain decimals, rounded (never "simplified" into other numbers)
    text = _decimal_polynomial([float(c) for c in coeffs])
    return {"line": f"y = {text}", "latex": f"y = {text.replace('*', '')}", "exact": False, "r2": r2, "note": note}


def _decimal_polynomial(coeffs: list[float]) -> str:
    """[0.99, 0.05] → '0.99*x + 0.05' (highest power first, 4 decimals)."""
    degree = len(coeffs) - 1
    terms = []
    for i, c in enumerate(coeffs):
        c = round(c, 4)
        if c == 0:
            continue
        power = degree - i
        size = f"{abs(c):.4f}".rstrip("0").rstrip(".")
        body = size if power == 0 else ("" if size == "1" else f"{size}*") + ("x" if power == 1 else f"x^{power}")
        terms.append(("- " if c < 0 else "+ ") + body)
    if not terms:
        return "0"
    text = " ".join(terms)
    return text[2:] if text.startswith("+ ") else "-" + text[2:]
