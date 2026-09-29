"""Explainers for the objects of Algebra 1: lines, quadratics, sequences,
and one/two-variable statistics. Each returns worked steps plus the facts
a student is asked to find."""

import math
import re
import statistics

import sympy
from sympy import Integer, Rational, Symbol, sqrt

from .graphing import _POINT, real_roots
from .parsing import (
    MathInputError, X, Y, build_scope, num, parse, prep, pretty_number, ptex, split_equation, step,
    strip_function_label, tex,
)

N = Symbol("n")


def _sig(value) -> str:
    """'+ 3' / '- 3' for gluing a number onto a formula."""
    text = tex(value)
    return f"- {text[1:].lstrip()}" if text.startswith("-") else f"+ {text}"


def _point(text, scope):
    m = _POINT.fullmatch(prep(text).strip())
    if not m:
        raise MathInputError(f"write points like (2, 3) — got “{text}”")
    return sympy.nsimplify(parse(m.group(1), scope)), sympy.nsimplify(parse(m.group(2), scope))


def _ptex(p) -> str:
    return f"\\left({tex(p[0])}, {tex(p[1])}\\right)"


def _paren_if_neg(v) -> str:
    t = tex(v)
    return f"\\left({t}\\right)" if t.startswith("-") else t


def _base(v) -> str:
    """A number about to be raised to a power: (-3)^n, (1/2)^n."""
    t = tex(v)
    return f"\\left({t}\\right)" if t.startswith("-") or "\\frac" in t else t


# ------------------------------------------------------------------ lines


def _standard_form(m, b):
    """y = mx + b → Ax + By = C with integers and A ≥ 0."""
    # -m x + y = b, scaled to clear fractions
    coeffs = [-m, Integer(1), b]
    lcm = sympy.ilcm(*[sympy.fraction(sympy.nsimplify(c))[1] for c in coeffs])
    A, B, C = (sympy.nsimplify(c) * lcm for c in coeffs)
    g = sympy.igcd(*(int(v) for v in (A, B, C) if v != 0)) or 1
    A, B, C = A / g, B / g, C / g
    if A < 0 or (A == 0 and B < 0):
        A, B, C = -A, -B, -C
    return A, B, C


def _std_tex(A, B, C) -> str:
    left = ptex(A * X + B * Y)
    return f"{left} = {tex(C)}"


def _line_facts(m, b, steps):
    if m is None:
        return None
    slope_int = f"y = {ptex(m * X + b)}"
    A, B, C = _standard_form(m, b)
    facts = {
        "slope_latex": tex(m),
        "y_intercept_latex": _ptex((0, b)),
        "x_intercept_latex": _ptex((-b / m, 0)) if m != 0 else ("\\text{none}" if b != 0 else "\\text{every point}"),
        "slope_intercept": slope_int,
        "standard": _std_tex(A, B, C),
        "parallel_slope": tex(m),
        "perpendicular_slope": tex(-1 / m) if m != 0 else "\\text{undefined (vertical)}",
        "direction": "rising" if m > 0 else "falling" if m < 0 else "horizontal",
        "plot_expr": str(m * X + b),
    }
    return facts


def op_line(req: dict) -> dict:
    mode = req.get("mode", "points")
    vars_ = req.get("vars") or {}
    scope = build_scope(vars_, keep_symbolic={"x", "y"})
    steps = []
    m = b = None
    vertical_x = None
    point_slope = None

    if mode == "points":
        p1, p2 = _point(req.get("p1", ""), scope), _point(req.get("p2", ""), scope)
        if p1 == p2:
            raise MathInputError("pick two different points")
        (x1, y1), (x2, y2) = p1, p2
        steps.append(step("Slope formula: rise over run", "m = \\frac{y_2 - y_1}{x_2 - x_1}"))
        rise, run = y2 - y1, x2 - x1
        steps.append(step(
            "Substitute the two points",
            f"m = \\frac{{{tex(y2)} - {_paren_if_neg(y1)}}}{{{tex(x2)} - {_paren_if_neg(x1)}}} = \\frac{{{tex(rise)}}}{{{tex(run)}}}",
        ))
        if run == 0:
            steps.append(step("The run is $0$ — you can't divide by zero, so the slope is **undefined** and the line is vertical", f"x = {tex(x1)}"))
            vertical_x = x1
        else:
            m = sympy.nsimplify(rise / run)
            if sympy.fraction(rise / run) != (rise, run) or tex(m) != f"\\frac{{{tex(rise)}}}{{{tex(run)}}}":
                steps.append(step("Simplify", f"m = {tex(m)}"))
            if m == 0:
                steps.append(step("The rise is $0$ — a slope of zero means a **horizontal** line", f"y = {tex(y1)}"))
            point_slope = (x1, y1)
    elif mode in ("point-slope", "slope-point"):
        x1, y1 = _point(req.get("p1", ""), scope)
        m = sympy.nsimplify(parse(str(req.get("slope", "")), scope))
        point_slope = (x1, y1)
    elif mode == "slope-intercept":
        m = sympy.nsimplify(parse(str(req.get("slope", "")), scope))
        b = sympy.nsimplify(parse(str(req.get("intercept", "")), scope))
        steps.append(step("Put $m$ and $b$ into $y = mx + b$", f"y = {ptex(m * X + b)}"))
    elif mode == "equation":
        text = prep(req.get("equation", ""))
        parts = split_equation(text)
        if not parts:
            raise MathInputError("type an equation like 2x + 3y = 6")
        lhs, rhs = parse(parts[0], scope), parse(parts[1], scope)
        e = sympy.expand(lhs - rhs)
        cx, cy = e.coeff(X, 1), e.coeff(Y, 1)
        const = sympy.expand(e - cx * X - cy * Y)
        if const.free_symbols or sympy.expand(e).as_poly(X, Y) is None or sympy.Poly(e, X, Y).total_degree() > 1:
            raise MathInputError("that isn't a line — a line's equation has only x and y to the first power")
        steps.append(step("Start", f"{tex(lhs)} = {tex(rhs)}"))
        if cy == 0:
            if cx == 0:
                raise MathInputError("there's no x or y in that equation")
            vertical_x = sympy.nsimplify(-const / cx)
            steps.append(step("There's no $y$ — solve for $x$. It's a **vertical** line with undefined slope", f"x = {tex(vertical_x)}"))
        else:
            if lhs != Y:
                if cx != 0:
                    steps.append(step(f"Get the $y$ term alone", f"{tex(cy * Y)} = {ptex(-cx * X - const)}"))
                if cy != 1:
                    steps.append(step(f"Divide every term by ${tex(cy)}$", f"y = {ptex(sympy.expand((-cx * X - const) / cy))}"))
            m, b = sympy.nsimplify(-cx / cy), sympy.nsimplify(-const / cy)
            steps.append(step(f"Read off slope $m = {tex(m)}$ and $y$-intercept $b = {tex(b)}$", f"y = {ptex(m * X + b)}"))
    elif mode in ("parallel", "perpendicular"):
        x1, y1 = _point(req.get("p1", ""), scope)
        base = op_line({"mode": "equation", "equation": req.get("equation", ""), "vars": vars_})
        if base.get("vertical"):
            if mode == "parallel":
                vertical_x = x1
                steps.append(step("A line parallel to a vertical line is vertical", f"x = {tex(x1)}"))
            else:
                m = Integer(0)
                steps.append(step("A line perpendicular to a vertical line is horizontal: slope $0$", f"y = {tex(y1)}"))
                point_slope = (x1, y1)
        else:
            m0 = base["_m"]
            steps.extend(base["steps"])
            if mode == "parallel":
                m = m0
                steps.append(step(f"Parallel lines have the **same** slope", f"m = {tex(m)}"))
            else:
                if m0 == 0:
                    vertical_x = x1
                    steps.append(step("Perpendicular to a horizontal line is a vertical line", f"x = {tex(x1)}"))
                else:
                    m = sympy.nsimplify(-1 / m0)
                    steps.append(step(f"Perpendicular slopes are **opposite reciprocals**: flip ${tex(m0)}$ and change the sign", f"m = {tex(m)}"))
            if m is not None:
                point_slope = (x1, y1)
    else:
        raise MathInputError(f"unknown line mode “{mode}”")

    if point_slope is not None and m is not None:
        x1, y1 = point_slope
        ps = f"y - {_paren_if_neg(y1)} = {tex(m)}\\left(x - {_paren_if_neg(x1)}\\right)"
        steps.append(step("Point-slope form $y - y_1 = m(x - x_1)$", ps))
        b = sympy.nsimplify(y1 - m * x1)
        steps.append(step("Distribute and add $y_1$ to both sides to get slope-intercept form", f"y = {ptex(m * X + b)}"))
        point_slope_tex = ps
    else:
        point_slope_tex = None

    result = {"steps": steps, "mode": mode}
    if vertical_x is not None:
        result.update({
            "vertical": True,
            "slope_latex": "\\text{undefined}",
            "slope_intercept": None,
            "standard": f"x = {tex(vertical_x)}",
            "x_intercept_latex": _ptex((vertical_x, 0)),
            "y_intercept_latex": "\\text{none}" if vertical_x != 0 else "\\text{every point}",
            "perpendicular_slope": "0",
            "parallel_slope": "\\text{undefined}",
            "direction": "vertical",
            "vertical_x": num(vertical_x),
            "_m": None,
        })
    else:
        result.update(_line_facts(m, b, steps))
        result["_m"] = m
        if point_slope_tex:
            result["point_slope"] = point_slope_tex
    return result


def op_line_public(req: dict) -> dict:
    result = op_line(req)
    result.pop("_m", None)
    return result


# ------------------------------------------------------------------ quadratics


def _plug(expr, value) -> str:
    """ax² + bx + c with (value) written in place of x."""
    slot = Symbol("PLUGSLOT")
    return ptex(expr.subs(X, slot)).replace("PLUGSLOT", f"\\left({tex(value)}\\right)")


def op_quadratic(req: dict) -> dict:
    vars_ = req.get("vars") or {}
    scope = build_scope(vars_, keep_symbolic={"x"})
    expr = sympy.expand(parse(strip_function_label(req.get("expr", "")), scope))
    if expr.free_symbols - {X}:
        raise MathInputError(f"give {', '.join(sorted(map(str, expr.free_symbols - {X})))} a value first")
    if not expr.is_polynomial(X) or sympy.Poly(expr, X).degree() != 2:
        raise MathInputError("that isn't a quadratic — it needs an x² term (and nothing higher)")
    a, b, c = (sympy.nsimplify(k) for k in sympy.Poly(expr, X).all_coeffs())
    h = sympy.nsimplify(-b / (2 * a))
    k = sympy.nsimplify(expr.subs(X, h))
    steps = [step("Standard form $y = ax^2 + bx + c$", f"y = {ptex(expr)} \\qquad a = {tex(a)},\\ b = {tex(b)},\\ c = {tex(c)}")]
    steps.append(step(
        "Axis of symmetry: $x = -\\dfrac{b}{2a}$",
        f"x = -\\frac{{{tex(b)}}}{{2 \\cdot {_paren_if_neg(a)}}} = {tex(h)}",
    ))
    steps.append(step(
        "Plug that $x$ back in to get the vertex's $y$",
        f"y = {_plug(expr, h)} = {tex(k)}",
    ))
    vertex_form = f"y = {tex(a) if a not in (1, -1) else ('-' if a == -1 else '')}\\left(x {_sig(-h)}\\right)^{{2}} {_sig(k)}" if h != 0 else f"y = {ptex(a * X**2 + k)}"
    if k == 0 and h != 0:
        vertex_form = f"y = {tex(a) if a not in (1, -1) else ('-' if a == -1 else '')}\\left(x {_sig(-h)}\\right)^{{2}}"
    steps.append(step(f"Vertex form $y = a(x - h)^2 + k$ with vertex $({tex(h)}, {tex(k)})$", vertex_form))

    disc = sympy.nsimplify(b**2 - 4 * a * c)
    roots = sympy.solve(expr, X)
    real = [r for r in roots if r.is_real]
    if disc > 0:
        disc_note = f"Discriminant $b^2 - 4ac = {tex(disc)} > 0$: **two** real roots (the parabola crosses the $x$-axis twice)"
    elif disc == 0:
        disc_note = f"Discriminant $b^2 - 4ac = 0$: **one** real root (the vertex sits on the $x$-axis)"
    else:
        disc_note = f"Discriminant $b^2 - 4ac = {tex(disc)} < 0$: **no** real roots (the parabola never touches the $x$-axis)"
    steps.append(step(disc_note, f"b^2 - 4ac = {_paren_if_neg(b)}^2 - 4 \\cdot {_paren_if_neg(a)} \\cdot {_paren_if_neg(c)} = {tex(disc)}"))

    factored = sympy.factor(expr)
    factored_tex = tex(factored) if factored != expr else None
    opens = "up" if a > 0 else "down"
    return {
        "steps": steps,
        "a": tex(a), "b": tex(b), "c": tex(c),
        "standard": f"y = {ptex(expr)}",
        "vertex_form": vertex_form,
        "factored": f"y = {factored_tex}" if factored_tex else None,
        "vertex_latex": f"\\left({tex(h)}, {tex(k)}\\right)",
        "vertex": [num(h), num(k)],
        "axis": f"x = {tex(h)}",
        "opens": opens,
        "extremum": f"{'minimum' if a > 0 else 'maximum'} value {tex(k)}",
        "extremum_latex": f"\\text{{{'min' if a > 0 else 'max'}}} = {tex(k)}",
        "y_intercept_latex": f"\\left(0, {tex(c)}\\right)",
        "discriminant_latex": tex(disc),
        "roots_latex": [pretty_number(r) for r in sorted(real, key=lambda r: num(r))] if real else [],
        "roots": [num(r) for r in sorted(real, key=lambda r: num(r))],
        "domain": "\\text{all real numbers}",
        "range": f"y \\ge {tex(k)}" if a > 0 else f"y \\le {tex(k)}",
        "plot_expr": str(expr),
    }


# ------------------------------------------------------------------ sequences


def op_sequence(req: dict) -> dict:
    vars_ = req.get("vars") or {}
    scope = build_scope(vars_)
    raw = [t for t in re.split(r"[,\s]+", prep(req.get("terms", ""))) if t and t not in ("...", "…")]
    if len(raw) < 3:
        raise MathInputError("type at least three terms, like 3, 7, 11")
    terms = [sympy.nsimplify(parse(t, scope)) for t in raw]
    diffs = [sympy.nsimplify(b - a) for a, b in zip(terms, terms[1:])]
    ratios = [sympy.nsimplify(b / a) for a, b in zip(terms, terms[1:])] if all(t != 0 for t in terms) else []
    a1 = terms[0]
    want = int(req.get("n") or len(terms) + 1)
    steps = []
    listed = ", ".join(tex(t) for t in terms)

    if len(set(diffs)) == 1:
        d = diffs[0]
        kind = "arithmetic"
        steps.append(step(f"Subtract each term from the next: the difference is always ${tex(d)}$ — an **arithmetic** sequence", " ,\\ ".join(f"{tex(b)} - {_paren_if_neg(a)} = {tex(d)}" for a, b in zip(terms[:3], terms[1:3]))))
        explicit = sympy.expand(a1 + (N - 1) * d)
        steps.append(step("Explicit formula $a_n = a_1 + (n-1)d$", f"a_n = {tex(a1)} + (n - 1) \\cdot {_paren_if_neg(d)} = {ptex(explicit)}"))
        recursive = f"a_1 = {tex(a1)},\\quad a_n = a_{{n-1}} {_sig(d)}"
        nth = explicit.subs(N, want)
        steps.append(step(f"Term ${want}$", f"a_{{{want}}} = {tex(a1)} + ({want} - 1) \\cdot {_paren_if_neg(d)} = {tex(nth)}"))
    elif ratios and len(set(ratios)) == 1:
        r = ratios[0]
        kind = "geometric"
        steps.append(step(f"Divide each term by the one before: the ratio is always ${tex(r)}$ — a **geometric** sequence", " ,\\ ".join(f"\\frac{{{tex(b)}}}{{{tex(a)}}} = {tex(r)}" for a, b in zip(terms[:3], terms[1:3]))))
        explicit = a1 * r ** (N - 1)
        steps.append(step("Explicit formula $a_n = a_1 \\cdot r^{n-1}$", f"a_n = {tex(a1)} \\cdot {_base(r)}^{{n - 1}}"))
        recursive = f"a_1 = {tex(a1)},\\quad a_n = {tex(r)} \\cdot a_{{n-1}}"
        nth = sympy.nsimplify(explicit.subs(N, want))
        steps.append(step(f"Term ${want}$", f"a_{{{want}}} = {tex(a1)} \\cdot {_base(r)}^{{{want - 1}}} = {tex(nth)}"))
    else:
        second = [sympy.nsimplify(b - a) for a, b in zip(diffs, diffs[1:])]
        if len(second) >= 1 and len(set(second)) == 1 and len(terms) >= 3:
            kind = "quadratic"
            ns = list(range(1, len(terms) + 1))
            poly = sympy.expand(sympy.interpolate(list(zip(ns[:3], terms[:3])), N))
            steps.append(step(f"Differences ${', '.join(tex(d) for d in diffs)}$ aren't constant, but the second differences are all ${tex(second[0])}$ — a **quadratic** pattern", f"a_n = {ptex(poly)}"))
            explicit = poly
            recursive = None
            nth = poly.subs(N, want)
            steps.append(step(f"Term ${want}$", f"a_{{{want}}} = {tex(nth)}"))
        else:
            raise MathInputError("no common difference or ratio — this isn't arithmetic or geometric")

    upcoming = [sympy.nsimplify(explicit.subs(N, k)) for k in range(len(terms) + 1, len(terms) + 4)]
    return {
        "kind": kind,
        "steps": steps,
        "terms_latex": listed,
        "explicit": f"a_n = {ptex(explicit) if kind != 'geometric' else tex(a1) + ' \\cdot ' + _base(ratios[0]) + '^{n - 1}'}",
        "recursive": recursive,
        "next_latex": ", ".join(tex(t) for t in upcoming),
        "n": want,
        "nth_latex": tex(nth),
        "points": [[k + 1, num(t)] for k, t in enumerate(terms + upcoming)],
        "common": tex(diffs[0]) if kind == "arithmetic" else tex(ratios[0]) if kind == "geometric" else None,
    }


# ------------------------------------------------------------------ statistics


def _numbers(text, scope):
    out = []
    for piece in re.split(r"[,\s;]+", prep(text or "")):
        if piece:
            v = num(parse(piece, scope))
            if v is None:
                raise MathInputError(f"“{piece}” isn't a number")
            out.append(v)
    return out


def _f(v, places=4) -> str:
    if v is None:
        return "—"
    r = round(v, places)
    return str(int(r)) if r == int(r) else f"{r:.{places}f}".rstrip("0").rstrip(".")


def _median(sorted_vals):
    n = len(sorted_vals)
    mid = n // 2
    return sorted_vals[mid] if n % 2 else (sorted_vals[mid - 1] + sorted_vals[mid]) / 2


def op_stats(req: dict) -> dict:
    scope = build_scope(req.get("vars") or {})
    xs = _numbers(req.get("data", ""), scope)
    ys = _numbers(req.get("ydata", ""), scope) if (req.get("ydata") or "").strip() else []
    if not xs:
        raise MathInputError("type some numbers, separated by commas or spaces")
    steps = []
    s = sorted(xs)
    n = len(xs)
    total = sum(xs)
    mean = total / n
    steps.append(step("**Order** the data", ",\\ ".join(_f(v) for v in s)))
    steps.append(step(f"**Mean**: add them up and divide by how many there are (${n}$)", f"\\bar{{x}} = \\frac{{{_f(total)}}}{{{n}}} = {_f(mean)}"))
    med = _median(s)
    if n % 2:
        steps.append(step(f"**Median**: the middle value (position ${(n + 1) // 2}$ of ${n}$)", f"\\text{{median}} = {_f(med)}"))
    else:
        steps.append(step(f"**Median**: an even count, so average the two middle values", f"\\frac{{{_f(s[n // 2 - 1])} + {_f(s[n // 2])}}}{{2}} = {_f(med)}"))
    counts = {}
    for v in xs:
        counts[v] = counts.get(v, 0) + 1
    top = max(counts.values())
    modes = sorted(v for v, c in counts.items() if c == top) if top > 1 else []
    mode_tex = ",\\ ".join(_f(v) for v in modes) if modes else "\\text{none}"
    steps.append(step("**Mode**: the value that appears most" + ("" if modes else " — every value appears once, so there's no mode"), f"\\text{{mode}} = {mode_tex}"))
    rng = s[-1] - s[0]
    steps.append(step("**Range**: largest minus smallest", f"{_f(s[-1])} - {_f(s[0])} = {_f(rng)}"))

    lower, upper = s[: n // 2], s[(n + 1) // 2:]
    q1 = _median(lower) if lower else s[0]
    q3 = _median(upper) if upper else s[-1]
    iqr = q3 - q1
    steps.append(step("**Quartiles**: the medians of the lower and upper halves", f"Q_1 = {_f(q1)},\\quad Q_3 = {_f(q3)},\\quad \\text{{IQR}} = {_f(q3)} - {_f(q1)} = {_f(iqr)}"))
    lo_fence, hi_fence = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = [v for v in s if v < lo_fence or v > hi_fence]
    steps.append(step(
        "**Outliers** fall more than $1.5 \\times \\text{IQR}$ beyond the quartiles" + ("" if outliers else " — none here"),
        f"\\text{{fences}}: {_f(lo_fence)} \\text{{ and }} {_f(hi_fence)}" + (f"\\quad \\text{{outliers}}: {', '.join(_f(v) for v in outliers)}" if outliers else ""),
    ))
    mad = sum(abs(v - mean) for v in xs) / n
    steps.append(step("**Mean absolute deviation**: the average distance from the mean", f"\\text{{MAD}} = \\frac{{\\sum |x - \\bar{{x}}|}}{{n}} = {_f(mad)}"))
    pop_sd = statistics.pstdev(xs)
    sample_sd = statistics.stdev(xs) if n > 1 else None
    steps.append(step("**Standard deviation** (population $\\sigma$, sample $s$)", f"\\sigma = {_f(pop_sd)}" + (f",\\quad s = {_f(sample_sd)}" if sample_sd is not None else "")))

    result = {
        "steps": steps,
        "n": n, "sum": _f(total), "mean": _f(mean), "median": _f(med), "mode": mode_tex, "range": _f(rng),
        "min": _f(s[0]), "max": _f(s[-1]), "q1": _f(q1), "q3": _f(q3), "iqr": _f(iqr), "mad": _f(mad),
        "sd_population": _f(pop_sd), "sd_sample": _f(sample_sd), "outliers": [_f(v) for v in outliers],
        "five_number": [s[0], q1, med, q3, s[-1]],
        "values": xs,
    }

    if ys:
        if len(ys) != n:
            raise MathInputError(f"x has {n} values but y has {len(ys)} — they need to pair up")
        if n < 2 or len(set(xs)) == 1:
            raise MathInputError("need at least two different x values for a line of best fit")
        my = sum(ys) / n
        sxx = sum((x - mean) ** 2 for x in xs)
        sxy = sum((x - mean) * (y - my) for x, y in zip(xs, ys))
        syy = sum((y - my) ** 2 for y in ys)
        slope = sxy / sxx
        intercept = my - slope * mean
        r = sxy / math.sqrt(sxx * syy) if syy else 0.0
        strength = "strong" if abs(r) >= 0.8 else "moderate" if abs(r) >= 0.5 else "weak"
        direction = "positive" if r > 0 else "negative" if r < 0 else "no"
        residuals = [y - (slope * x + intercept) for x, y in zip(xs, ys)]
        result["regression"] = {
            "equation": f"y = {_f(slope)}x {'+' if intercept >= 0 else '-'} {_f(abs(intercept))}",
            "slope": slope, "intercept": intercept, "r": _f(r), "r2": _f(r * r),
            "description": f"{strength} {direction} correlation" if direction != "no" else "no correlation",
            "residuals": [_f(v) for v in residuals],
            "points": [[x, y] for x, y in zip(xs, ys)],
        }
        result["steps"].append(step(
            f"**Line of best fit** (least squares). $r = {_f(r)}$ — a {strength} {direction} correlation; $r^2 = {_f(r * r)}$, so about {round(r * r * 100)}% of the variation in $y$ is explained by $x$",
            result["regression"]["equation"],
        ))
    return result
