"""Endless practice: seeded problem generators for every Algebra 1 topic,
and a forgiving answer checker (accepts 'x = 3', '3', '-2 < x ≤ 5',
'(2, -1)', '3.2 × 10^5', equivalent forms, rounded decimals...).

Every problem carries a `show` request, so a wrong answer can be followed
by the full worked solution from the transform/solve/line/... engines."""

import random
import re

import sympy
from sympy import Integer, Rational, Symbol, sqrt

from .parsing import MathInputError, X, Y, build_scope, num, parse, prep, ptex, tex
from .solve import op_solve

A_, B_, C_ = Symbol("a"), Symbol("b"), Symbol("c")


def _nz(r, lo, hi):
    """Random nonzero int in [lo, hi]."""
    while True:
        v = r.randint(lo, hi)
        if v:
            return v


def _lin(a, b, v=X):
    return ptex(a * v + b)


def _t(expr) -> str:
    return ptex(expr)


def _typed(expr) -> str:
    """Plain typed form of an expression, for `show` requests."""
    return str(expr).replace("**", "^")


# ------------------------------------------------------------------ generators
# Each returns dict(prompt, latex, kind, answer, answer_latex, show, [extra]).


def g_order_of_operations(r):
    a, b, c, d, e = r.randint(2, 9), r.randint(2, 6), r.randint(2, 9), r.randint(1, 5), r.randint(2, 4)
    forms = [
        (f"{a} + {b}({c} - {d})^{e if e < 4 else 2}", None),
        (f"{a * b} ÷ {b} + {c} * {d} - {e}", None),
        (f"({a} + {c})^2 - {b} * {d}", None),
        (f"{a} - {b}^2 + {c}({d} - {a})", None),
        (f"-{b}^2 + ({c} - {a})^2 ÷ {1}", None),
    ]
    text, _ = r.choice(forms)
    value = parse(text)
    return dict(prompt="Evaluate using the order of operations.", latex=tex(parse(text, evaluate_expr=False), keep_order=True),
                kind="value", answer=str(value), answer_latex=tex(value),
                show={"op": "transform", "mode": "evaluate", "expr": text})


def g_evaluate_expression(r):
    a, b, c = _nz(r, -5, 5), _nz(r, -9, 9), r.randint(-9, 9)
    xv = _nz(r, -4, 4)
    expr = a * X**2 + b * X + c if r.random() < 0.6 else a * X + b
    value = expr.subs(X, xv)
    return dict(prompt=f"Evaluate when $x = {xv}$.", latex=_t(expr), kind="value", answer=str(value), answer_latex=tex(value),
                show={"op": "transform", "mode": "evaluate", "expr": f"{_typed(expr)}, x = {xv}"})


def g_simplify(r):
    a, b, c, d, e = _nz(r, 2, 6), _nz(r, -8, 8), _nz(r, -7, 7), _nz(r, -9, 9), _nz(r, -5, 5)
    forms = [
        f"{a}({_typed(b * X + c)}) + {d}x",
        f"{a}x + {d} - {_typed(e)}({_typed(X + c)})",
        f"{a}({_typed(X + b)}) - {abs(e)}({_typed(2 * X + c)})",
        f"{a}x^2 + {d}x - {abs(b)}x^2 + {e}x",
    ]
    text = r.choice(forms).replace("+ -", "- ").replace("- -", "+ ")
    value = sympy.expand(parse(text))
    return dict(prompt="Simplify. Distribute, then combine like terms.", latex=tex(parse(text, evaluate_expr=False), keep_order=True),
                kind="simplified", answer=str(value), answer_latex=_t(value),
                show={"op": "transform", "mode": "simplify", "expr": text})


def _equation_problem(lhs, rhs, prompt="Solve for $x$.", method="auto", var=X):
    eq_text = f"{_typed(lhs)} = {_typed(rhs)}"
    sols = sympy.solve(sympy.Eq(lhs, rhs), var)
    return dict(prompt=prompt, latex=f"{_t(lhs)} = {_t(rhs)}", kind="solutions",
                answer=[str(s) for s in sols], answer_latex=", ".join(f"{tex(var)} = {tex(s)}" for s in sols),
                show={"op": "solve", "expr": eq_text, "method": method})


def g_one_step(r):
    sol = r.randint(-12, 12)
    a = _nz(r, -9, 9)
    kind = r.choice(["add", "mul", "div"])
    if kind == "add":
        lhs, rhs = X + a, sol + a
    elif kind == "mul":
        lhs, rhs = a * X, a * sol
    else:
        a = abs(a) + 1
        sol = a * r.randint(-6, 6)
        lhs, rhs = X / a, sol // a
    return _equation_problem(lhs, rhs)


def g_two_step(r):
    sol, a, b = r.randint(-10, 10), _nz(r, -9, 9), _nz(r, -15, 15)
    if a == 1:
        a = 3
    return _equation_problem(a * X + b, a * sol + b)


def g_multi_step(r):
    sol = r.randint(-8, 8)
    a, b, c, d = _nz(r, 2, 6), _nz(r, -9, 9), _nz(r, -7, 7), _nz(r, -9, 9)
    form = r.randint(0, 2)
    if form == 0:
        lhs = a * (X + b)
        rhs_c = _nz(r, -5, 5)
        if rhs_c == a:
            rhs_c += 1
        rhs = rhs_c * X + (lhs.subs(X, sol) - rhs_c * sol)
        text = f"{a}({_typed(X + b)}) = {_typed(rhs)}"
        lhs_tex = f"{a}\\left({_t(X + b)}\\right)"
    elif form == 1:
        c2 = c if c != a else c + 1
        lhs, rhs = a * X + b, c2 * X + (a * sol + b - c2 * sol)
        text, lhs_tex = f"{_typed(lhs)} = {_typed(rhs)}", _t(lhs)
    else:
        den = r.choice([2, 3, 4, 5])
        sol = den * r.randint(-4, 4)
        lhs, rhs = X / den + b, sol / den + b
        text, lhs_tex = f"x/{den} + {b} = {rhs}".replace("+ -", "- "), _t(lhs)
    sols = sympy.solve(sympy.Eq(parse(text.split("=")[0]), parse(text.split("=")[1])), X)
    return dict(prompt="Solve for $x$.", latex=f"{lhs_tex} = {_t(parse(text.split('=')[1]))}", kind="solutions",
                answer=[str(s) for s in sols], answer_latex=", ".join(f"x = {tex(s)}" for s in sols),
                show={"op": "solve", "expr": text})


LITERAL = [
    ("A = l*w", "w"), ("P = 2l + 2w", "l"), ("y = m*x + b", "x"), ("d = r*t", "t"), ("I = P*r*t", "r"),
    ("2x + 3y = 12", "y"), ("A = (1/2)*b*h", "h"), ("C = 2*pi*r", "r"), ("F = (9/5)*C + 32", "C"),
    ("a*x + b = c", "x"), ("5x - 2y = 10", "y"), ("V = l*w*h", "h"),
]


def g_literal(r):
    text, target = r.choice(LITERAL)
    lhs, rhs = text.split("=")
    scope = build_scope()
    sols = sympy.solve(sympy.Eq(parse(lhs, scope), parse(rhs, scope)), Symbol(target))
    return dict(prompt=f"Solve for ${target}$.", latex=f"{tex(parse(lhs, scope))} = {tex(parse(rhs, scope))}", kind="literal",
                answer=[str(sols[0])], target=target, answer_latex=f"{target} = {tex(sols[0])}",
                show={"op": "solve", "expr": text, "for": target})


def g_inequality(r):
    sol, a, b = r.randint(-8, 8), _nz(r, -6, 6), _nz(r, -12, 12)
    op = r.choice(["<", ">", "<=", ">="])
    lhs, rhs = a * X + b, a * sol + b
    rel_tex = {"<": "<", ">": ">", "<=": "\\le", ">=": "\\ge"}[op]
    text = f"{_typed(lhs)} {op} {_typed(rhs)}"
    res = op_solve({"expr": text})
    return dict(prompt="Solve the inequality." + (" Watch the sign when you divide!" if a < 0 else ""),
                latex=f"{_t(lhs)} {rel_tex} {tex(rhs)}", kind="inequality", answer=text, answer_latex=res["solution_latex"],
                show={"op": "solve", "expr": text})


def g_compound_inequality(r):
    lo, hi = sorted(r.sample(range(-8, 9), 2))
    a, b = r.choice([2, 3, -2, 4]), _nz(r, -6, 6)
    e_lo, e_hi = a * lo + b, a * hi + b
    if a < 0:
        e_lo, e_hi = e_hi, e_lo
    op1, op2 = r.choice(["<", "<="]), r.choice(["<", "<="])
    text = f"{e_lo} {op1} {_typed(a * X + b)} {op2} {e_hi}"
    t = {"<": "<", "<=": "\\le"}
    res = op_solve({"expr": text})
    return dict(prompt="Solve the compound inequality.", latex=f"{e_lo} {t[op1]} {_t(a * X + b)} {t[op2]} {e_hi}",
                kind="inequality", answer=text, answer_latex=res["solution_latex"], show={"op": "solve", "expr": text})


def g_absolute_value(r):
    a, b = r.choice([1, 2, 3]), _nz(r, -9, 9)
    c = r.randint(1, 12)
    if r.random() < 0.15:
        c = -c
    text = f"|{_typed(a * X + b)}| = {c}"
    sols = sorted({Rational(c - b, a), Rational(-c - b, a)}) if c >= 0 else []
    return dict(prompt="Solve the absolute value equation.", latex=f"\\left|{_t(a * X + b)}\\right| = {c}", kind="solutions",
                answer=[str(s) for s in sols], answer_latex=", ".join(f"x = {tex(s)}" for s in sols) or "\\text{no solution}",
                show={"op": "solve", "expr": text})


def _two_points(r):
    while True:
        p = (r.randint(-8, 8), r.randint(-8, 8))
        q = (r.randint(-8, 8), r.randint(-8, 8))
        if p[0] != q[0]:
            return p, q


def g_slope(r):
    p, q = _two_points(r)
    m = Rational(q[1] - p[1], q[0] - p[0])
    return dict(prompt=f"Find the slope of the line through $({p[0]}, {p[1]})$ and $({q[0]}, {q[1]})$.", latex="m = \\frac{y_2 - y_1}{x_2 - x_1}",
                kind="value", answer=str(m), answer_latex=f"m = {tex(m)}",
                show={"op": "line", "mode": "points", "p1": f"({p[0]}, {p[1]})", "p2": f"({q[0]}, {q[1]})"})


def g_line_equation(r):
    m, b = Rational(_nz(r, -6, 6), r.choice([1, 1, 1, 2, 3])), r.randint(-8, 8)
    x1 = r.randint(-4, 4)
    x2 = x1 + r.choice([1, 2, 3]) * sympy.fraction(m)[1]
    p, q = (x1, m * x1 + b), (x2, m * x2 + b)
    line = m * X + b
    return dict(prompt=f"Write the equation of the line through $({tex(p[0])}, {tex(p[1])})$ and $({tex(q[0])}, {tex(q[1])})$ in slope-intercept form.",
                latex="y = mx + b", kind="line", answer=f"y = {_typed(line)}", answer_latex=f"y = {_t(line)}",
                show={"op": "line", "mode": "points", "p1": f"({p[0]}, {p[1]})", "p2": f"({q[0]}, {q[1]})"})


def g_slope_from_equation(r):
    a, b = _nz(r, -6, 6), _nz(r, -5, 5)
    c = r.randint(-12, 12)
    eq = f"{_typed(a * X + b * Y)} = {c}"
    m = Rational(-a, b)
    return dict(prompt="Find the slope of the line.", latex=f"{_t(a * X + b * Y)} = {c}", kind="value", answer=str(m),
                answer_latex=f"m = {tex(m)}", show={"op": "line", "mode": "equation", "equation": eq})


def g_system(r):
    xs, ys = r.randint(-6, 6), r.randint(-6, 6)
    while True:
        a1, b1, a2, b2 = (_nz(r, -5, 5) for _ in range(4))
        if a1 * b2 - a2 * b1 != 0:
            break
    if r.random() < 0.4:  # substitution-friendly
        a1, b1 = -a1, 1
        e1 = f"y = {_typed(-a1 * X + (a1 * xs + ys))}"
        e1_tex = f"y = {_t(-a1 * X + (a1 * xs + ys))}"
    else:
        e1 = f"{_typed(a1 * X + b1 * Y)} = {a1 * xs + b1 * ys}"
        e1_tex = f"{_t(a1 * X + b1 * Y)} = {a1 * xs + b1 * ys}"
    e2 = f"{_typed(a2 * X + b2 * Y)} = {a2 * xs + b2 * ys}"
    return dict(prompt="Solve the system. Give the answer as a point $(x, y)$.",
                latex=f"\\begin{{cases}} {e1_tex} \\\\ {_t(a2 * X + b2 * Y)} = {a2 * xs + b2 * ys} \\end{{cases}}",
                kind="point", answer=f"({xs}, {ys})", answer_latex=f"\\left({xs}, {ys}\\right)",
                show={"op": "solve", "expr": f"{e1}\n{e2}"})


def g_exponent_rules(r):
    a, m, n, k = r.randint(2, 5), r.randint(2, 5), r.randint(1, 4), r.randint(2, 3)
    forms = [
        (f"({a}x^{m})({a + 1}x^{n})", f"\\left({a}x^{{{m}}}\\right)\\left({a + 1}x^{{{n}}}\\right)"),
        (f"(x^{m})^{k}", f"\\left(x^{{{m}}}\\right)^{{{k}}}"),
        (f"({a}x^{m}y)^{k}", f"\\left({a}x^{{{m}}}y\\right)^{{{k}}}"),
        (f"({a * 6}x^{m + n}) / ({a * 2}x^{n})", f"\\frac{{{a * 6}x^{{{m + n}}}}}{{{a * 2}x^{{{n}}}}}"),
        (f"x^{m} * x^(-{n + m})", f"x^{{{m}}} \\cdot x^{{-{n + m}}}"),
        (f"({a}x^{m}y^{n})^0", f"\\left({a}x^{{{m}}}y^{{{n}}}\\right)^{{0}}"),
    ]
    text, latex = r.choice(forms)
    value = sympy.powsimp(parse(text))
    numer, denom = sympy.fraction(value)
    answer = str(value) if denom == 1 else f"({numer})/({denom})"
    return dict(prompt="Simplify. Use only positive exponents.", latex=latex,
                kind="power", answer=answer, answer_latex=tex(value), show={"op": "transform", "mode": "simplify", "expr": text})


def g_scientific(r):
    mant = Rational(r.randint(11, 99), 10)
    power = _nz(r, -6, 8)
    value = mant * Integer(10) ** power
    decimal = f"{float(value):.10f}".rstrip("0").rstrip(".") if power < 0 else str(int(value))
    if r.random() < 0.5:
        return dict(prompt="Write in scientific notation.", latex=decimal, kind="scientific", answer=str(value),
                    answer_latex=f"{tex(mant)} \\times 10^{{{power}}}".replace(".", "."), show={"op": "transform", "mode": "scientific", "expr": decimal})
    shown = f"{float(mant):g} \\times 10^{{{power}}}"
    return dict(prompt="Write in standard (decimal) form.", latex=shown, kind="value", answer=str(value), answer_latex=decimal,
                show={"op": "transform", "mode": "scientific", "expr": f"{float(mant):g}*10^{power}"})


def g_multiply_polynomials(r):
    a, b, c, d = r.choice([1, 1, 2, 3]), _nz(r, -7, 7), r.choice([1, 1, 2]), _nz(r, -7, 7)
    forms = [
        (f"({_typed(a * X + b)})({_typed(c * X + d)})", f"\\left({_t(a * X + b)}\\right)\\left({_t(c * X + d)}\\right)"),
        (f"({_typed(X + b)})^2", f"\\left({_t(X + b)}\\right)^{{2}}"),
        (f"({_typed(X + b)})({_typed(X - b)})", f"\\left({_t(X + b)}\\right)\\left({_t(X - b)}\\right)"),
        (f"{_typed(a * X)}({_typed(X**2 + b * X + d)})", f"{_t(a * X)}\\left({_t(X**2 + b * X + d)}\\right)"),
    ]
    text, latex = r.choice(forms)
    value = sympy.expand(parse(text))
    return dict(prompt="Multiply and simplify.", latex=latex, kind="simplified", answer=str(value), answer_latex=_t(value),
                show={"op": "transform", "mode": "expand", "expr": text})


def g_factor(r):
    kind = r.choice(["gcf", "trinomial", "trinomial", "ac", "squares"])
    p, q = _nz(r, -9, 9), _nz(r, -9, 9)
    if kind == "gcf":
        g = r.randint(2, 6)
        expr = sympy.expand(g * X * (r.randint(1, 5) * X + _nz(r, -9, 9)))
    elif kind == "trinomial":
        expr = sympy.expand((X + p) * (X + q))
    elif kind == "ac":
        a = r.choice([2, 3, 5])
        expr = sympy.expand((a * X + p) * (X + q))
        if sympy.gcd_list(sympy.Poly(expr, X).all_coeffs()) != 1:
            expr = sympy.expand((a * X + 1) * (X + q))
    else:
        k = r.choice([1, 1, 2, 3])
        expr = sympy.expand((k * X) ** 2 - abs(p) ** 2)
    factored = sympy.factor(expr)
    return dict(prompt="Factor completely.", latex=_t(expr), kind="factored", answer=str(factored), answer_latex=tex(factored),
                show={"op": "transform", "mode": "factor", "expr": _typed(expr)})


def g_quadratic_factoring(r):
    p, q = r.randint(-9, 9), r.randint(-9, 9)
    a = r.choice([1, 1, 1, 2])
    expr = sympy.expand((a * X - p) * (X - q)) if a == 1 else sympy.expand((2 * X - (2 * p + 1)) * (X - q))
    const = r.choice([0, 0, r.randint(-5, 5)])
    lhs, rhs = expr + const, Integer(const)
    lhs = sympy.expand(lhs)
    text = f"{_typed(lhs)} = {const}"
    sols = sympy.solve(expr, X)
    return dict(prompt="Solve by factoring.", latex=f"{_t(lhs)} = {const}", kind="solutions", answer=[str(s) for s in sols],
                answer_latex=", ".join(f"x = {tex(s)}" for s in sols), show={"op": "solve", "expr": text, "method": "factor"})


def g_quadratic_formula(r):
    while True:
        a, b, c = _nz(r, -4, 4), r.randint(-9, 9), r.randint(-9, 9)
        if b * b - 4 * a * c > 0 and not sympy.sqrt(b * b - 4 * a * c).is_Integer:
            break
    expr = a * X**2 + b * X + c
    sols = sympy.solve(expr, X)
    return dict(prompt="Solve with the quadratic formula. Exact or decimal (2 places) is fine.", latex=f"{_t(expr)} = 0", kind="solutions",
                answer=[str(s) for s in sols], answer_latex=", ".join(f"x = {tex(s)}" for s in sols),
                show={"op": "solve", "expr": f"{_typed(expr)} = 0", "method": "formula"})


def g_square_root(r):
    k, a = r.randint(1, 12), r.choice([1, 1, 2, 3])
    h = r.choice([0, 0, _nz(r, -6, 6)])
    if h:
        lhs, rhs_v = (X - h) ** 2, k * k
        latex = f"\\left({_t(X - h)}\\right)^{{2}} = {k * k}"
        text = f"({_typed(X - h)})^2 = {k * k}"
    else:
        lhs, rhs_v = a * X**2, a * k * k
        latex = f"{_t(lhs)} = {rhs_v}"
        text = f"{_typed(lhs)} = {rhs_v}"
    sols = sympy.solve(sympy.Eq(lhs, rhs_v), X)
    return dict(prompt="Solve using square roots.", latex=latex, kind="solutions", answer=[str(s) for s in sols],
                answer_latex=", ".join(f"x = {tex(s)}" for s in sols), show={"op": "solve", "expr": text, "method": "sqrt"})


def g_discriminant(r):
    a, b, c = _nz(r, -3, 3), r.randint(-8, 8), r.randint(-8, 8)
    disc = b * b - 4 * a * c
    count = 2 if disc > 0 else 1 if disc == 0 else 0
    return dict(prompt="Use the discriminant: how many real solutions?", latex=f"{_t(a * X**2 + b * X + c)} = 0", kind="value",
                answer=str(count), answer_latex=f"b^2 - 4ac = {disc} \\Rightarrow {count}",
                show={"op": "quadratic", "expr": _typed(a * X**2 + b * X + c)})


def g_vertex(r):
    a, h, k = _nz(r, -3, 3), r.randint(-5, 5), r.randint(-8, 8)
    expr = sympy.expand(a * (X - h) ** 2 + k)
    return dict(prompt="Find the vertex. Answer as a point $(h, k)$.", latex=f"y = {_t(expr)}", kind="point",
                answer=f"({h}, {k})", answer_latex=f"\\left({h}, {k}\\right)", show={"op": "quadratic", "expr": _typed(expr)})


def g_radicals(r):
    sq, free = r.choice([4, 9, 16, 25, 36]), r.choice([2, 3, 5, 6, 7])
    form = r.randint(0, 2)
    if form == 0:
        text = f"sqrt({sq * free})"
        latex = f"\\sqrt{{{sq * free}}}"
    elif form == 1:
        c = r.randint(2, 5)
        text = f"{c}*sqrt({sq * free})"
        latex = f"{c}\\sqrt{{{sq * free}}}"
    else:
        sq2 = r.choice([4, 9, 16])
        text = f"sqrt({sq * free}) + sqrt({sq2 * free})"
        latex = f"\\sqrt{{{sq * free}}} + \\sqrt{{{sq2 * free}}}"
    value = parse(text)
    return dict(prompt="Simplify the radical.", latex=latex, kind="radical", answer=str(value), answer_latex=tex(value),
                show={"op": "transform", "mode": "simplify", "expr": text})


def g_function_notation(r):
    a, b, c = _nz(r, -4, 4), r.randint(-9, 9), r.randint(-9, 9)
    xv = r.randint(-5, 5)
    expr = a * X**2 + b * X + c if r.random() < 0.5 else a * X + c
    value = expr.subs(X, xv)
    return dict(prompt=f"Find $f({xv})$.", latex=f"f(x) = {_t(expr)}", kind="value", answer=str(value), answer_latex=f"f({xv}) = {value}",
                show={"op": "transform", "mode": "evaluate", "expr": f"{_typed(expr)}, x = {xv}"})


def g_sequence(r):
    if r.random() < 0.5:
        a1, d = r.randint(-10, 10), _nz(r, -7, 7)
        terms = [a1 + d * k for k in range(4)]
        n = r.randint(8, 25)
        ans = a1 + d * (n - 1)
    else:
        a1, ratio = r.choice([1, 2, 3, 5]), r.choice([2, 3, -2])
        terms = [a1 * ratio**k for k in range(4)]
        n = r.randint(6, 9)
        ans = a1 * ratio ** (n - 1)
    listed = ", ".join(map(str, terms))
    return dict(prompt=f"Find term $a_{{{n}}}$ of the sequence.", latex=listed + ", \\ldots", kind="value", answer=str(ans),
                answer_latex=f"a_{{{n}}} = {ans}", show={"op": "sequence", "terms": listed, "n": n})


def g_mean_median(r):
    data = [r.randint(1, 30) for _ in range(r.choice([5, 6, 7]))]
    which = r.choice(["mean", "median", "range"])
    s = sorted(data)
    if which == "mean":
        ans = Rational(sum(data), len(data))
    elif which == "median":
        ans = Rational(s[len(s) // 2]) if len(s) % 2 else Rational(s[len(s) // 2 - 1] + s[len(s) // 2], 2)
    else:
        ans = Integer(s[-1] - s[0])
    return dict(prompt=f"Find the **{which}**." + (" (Round to 2 decimals if needed.)" if which == "mean" else ""),
                latex=",\\ ".join(map(str, data)), kind="value", answer=str(ans), answer_latex=pretty_or(ans),
                show={"op": "stats", "data": ", ".join(map(str, data))})


def pretty_or(v):
    return tex(v) if v.is_Integer else f"{tex(v)} \\approx {float(v):.2f}"


def g_exponential(r):
    start, rate, t = r.choice([100, 200, 500, 1000, 50]), r.choice([2, 3]), r.randint(2, 6)
    grow = r.random() < 0.7
    if grow:
        ans = start * rate**t
        prompt = f"A quantity starts at ${start}$ and gets multiplied by ${rate}$ every year. How much after ${t}$ years?"
        latex = f"y = {start} \\cdot {rate}^{{t}}"
    else:
        ans = Rational(start * 2**0, 2**t) * 1
        ans = Rational(start, 2**t)
        prompt = f"A ${start}$ mg sample halves every hour. How much is left after ${t}$ hours?"
        latex = f"y = {start} \\cdot \\left(\\tfrac{{1}}{{2}}\\right)^{{t}}"
    return dict(prompt=prompt, latex=latex, kind="value", answer=str(ans), answer_latex=tex(ans),
                show={"op": "transform", "mode": "evaluate", "expr": (f"{start}*{rate}^t, t = {t}" if grow else f"{start}*(1/2)^t, t = {t}")})


# ---- how many solutions? (0, 1 or infinitely many)


def _signed(n, first=False) -> str:
    """'+ 4' / '- 4' between terms, or '4' / '-4' up front."""
    if first:
        return str(n)
    return f"+ {n}" if n >= 0 else f"- {-n}"


def _linear_text(r, p, q, style):
    """p·x + q written one of several ways, so the like terms and the
    distributing still have to be done before the answer shows."""
    x = lambda c, first=False: (("" if c == 1 else "-" if c == -1 else str(c)) + "x") if first else (  # noqa: E731
        f"+ {'' if c == 1 else c}x" if c > 0 else f"- {'' if c == -1 else -c}x")
    if style == 1 and abs(p) >= 2:  # a(x + b) + c
        b = _nz(r, -6, 6)
        c = q - p * b
        return f"{p}(x {_signed(b)})" + (f" {_signed(c)}" if c else "")
    if style == 2:  # mx + nx + q  (like terms to combine)
        m = _nz(r, -6, 9)
        while p - m == 0:
            m = _nz(r, -6, 9)
        n = p - m
        return f"{x(m, True)} {x(n)}" + (f" {_signed(q)}" if q else "")
    if style == 3 and abs(p) >= 1:  # a(x + b) + cx + d
        a = r.choice([2, 3, 4, -2, -3])
        c = p - a
        b = _nz(r, -5, 5)
        d = q - a * b
        return f"{a}(x {_signed(b)})" + (f" {x(c)}" if c else "") + (f" {_signed(d)}" if d else "")
    # plain px + q
    if p == 0:
        return str(q)
    return x(p, True) + (f" {_signed(q)}" if q else "")


def _side_tex(text):
    return tex(parse(text, evaluate_expr=False), keep_order=True)


def _count_equation(r, count):
    """A linear equation with variables on both sides and exactly `count`
    ('0', '1' or 'inf') solutions, written so it has to be simplified first."""
    p, q = _nz(r, -7, 9), r.randint(-12, 12)
    if count == "inf":
        p2, q2 = p, q
    elif count == "0":
        p2, q2 = p, q + _nz(r, -9, 9)
    else:
        p2, q2 = p + _nz(r, -4, 4), r.randint(-12, 12)
        if p2 == p:
            p2 += 1
    styles = r.sample([0, 1, 2, 3], 2)
    left, right = _linear_text(r, p, q, styles[0]), _linear_text(r, p2, q2, styles[1])
    if left.replace(" ", "") == right.replace(" ", ""):
        right = _linear_text(r, p2, q2, 2)
    if r.random() < 0.5:
        left, right = right, left
    return left, right


COUNT_CHOICES = [
    {"label": "No solution", "value": "0"},
    {"label": "Exactly one solution", "value": "1"},
    {"label": "Infinitely many solutions", "value": "inf"},
]
COUNT_TEX = {"0": "\\text{no solution}", "1": "\\text{exactly one solution}", "inf": "\\text{infinitely many solutions}"}


def g_num_solutions(r):
    count = r.choice(["0", "1", "inf"])
    left, right = _count_equation(r, count)
    return dict(prompt="How many solutions does this equation have?", latex=f"{_side_tex(left)} = {_side_tex(right)}",
                kind="count", answer=count, answer_latex=COUNT_TEX[count], choices=COUNT_CHOICES,
                show={"op": "solve", "expr": f"{left} = {right}"})


def g_num_solutions_make(r):
    """Fill the box so the equation has a given number of solutions."""
    p, q = _nz(r, -6, 8), r.randint(-10, 10)
    if p == 1:
        p = 2
    right = _linear_text(r, p, q, r.choice([1, 2, 3]))
    form = r.choice(["constant-inf", "coef-none", "coef-inf"])
    if form == "constant-inf":
        # px + [ ] = (something equal to px + q)  →  [ ] = q
        latex = f"{_t(p * X)} + \\square = {_side_tex(right)}"
        prompt, answer, done = "What number goes in the box so the equation has **infinitely many** solutions?", q, f"{_typed(p * X)} + {q} = {right}"
    elif form == "coef-none":
        # [ ]x + k = right, with k ≠ q  →  [ ] = p
        k = q + _nz(r, -8, 8)
        latex = f"\\square x {_signed(k)} = {_side_tex(right)}"
        prompt, answer, done = "What number goes in the box so the equation has **no solution**?", p, f"{p}x {_signed(k)} = {right}"
    else:
        latex = f"\\square x {_signed(q)} = {_side_tex(right)}"
        prompt, answer, done = "What number goes in the box so the equation has **infinitely many** solutions?", p, f"{p}x {_signed(q)} = {right}"
    return dict(prompt=prompt, latex=latex, kind="value", answer=str(answer), answer_latex=f"\\square = {answer}",
                show={"op": "solve", "expr": done})


TOPICS = {
    "order-of-operations": ("Order of operations", g_order_of_operations),
    "evaluate": ("Evaluate expressions", g_evaluate_expression),
    "simplify": ("Simplify expressions", g_simplify),
    "one-step": ("One-step equations", g_one_step),
    "two-step": ("Two-step equations", g_two_step),
    "multi-step": ("Multi-step equations", g_multi_step),
    "literal": ("Literal equations", g_literal),
    "inequality": ("Inequalities", g_inequality),
    "compound": ("Compound inequalities", g_compound_inequality),
    "absolute-value": ("Absolute value equations", g_absolute_value),
    "num-solutions": ("Number of solutions", g_num_solutions),
    "num-solutions-make": ("Number of solutions: fill the box", g_num_solutions_make),
    "function-notation": ("Function notation", g_function_notation),
    "slope": ("Slope from two points", g_slope),
    "slope-from-equation": ("Slope from an equation", g_slope_from_equation),
    "line-equation": ("Equation of a line", g_line_equation),
    "systems": ("Systems of equations", g_system),
    "exponent-rules": ("Exponent rules", g_exponent_rules),
    "scientific": ("Scientific notation", g_scientific),
    "exponential": ("Exponential growth & decay", g_exponential),
    "multiply-polynomials": ("Multiplying polynomials", g_multiply_polynomials),
    "factoring": ("Factoring", g_factor),
    "quadratic-factoring": ("Quadratics by factoring", g_quadratic_factoring),
    "square-roots": ("Quadratics by square roots", g_square_root),
    "quadratic-formula": ("Quadratic formula", g_quadratic_formula),
    "discriminant": ("The discriminant", g_discriminant),
    "vertex": ("Vertex of a parabola", g_vertex),
    "radicals": ("Simplifying radicals", g_radicals),
    "sequences": ("Sequences", g_sequence),
    "statistics": ("Mean, median, range", g_mean_median),
}


def op_practice(req: dict) -> dict:
    topic = req.get("topic") or "two-step"
    if topic == "mixed":
        topic = random.Random(req.get("seed")).choice(list(TOPICS))
    if topic not in TOPICS:
        raise MathInputError(f"unknown topic “{topic}”")
    seed = req.get("seed")
    rng = random.Random(f"{topic}:{seed}")
    title, gen = TOPICS[topic]
    for _ in range(20):
        try:
            problem = gen(rng)
            break
        except (ZeroDivisionError, KeyError, IndexError):
            continue
    else:
        raise MathInputError("couldn't make a problem — try again")
    problem.update({"topic": topic, "title": title, "seed": seed})
    return problem


def op_topics(req: dict) -> dict:
    return {"topics": [{"id": k, "title": v[0]} for k, v in TOPICS.items()]}


# ------------------------------------------------------------------ checking

_NONE = re.compile(r"^\s*(no\s*(real\s*)?solutions?|none|∅|\{\s*\}|empty)\s*$", re.I)
_ALL = re.compile(r"^\s*(all\s*real(\s*numbers)?|infinite(ly many)?(\s*solutions)?|identity|every\s*real\s*number|R|ℝ)\s*$", re.I)


def _count(text):
    """'0' / '1' / 'inf' from how a student says how many solutions."""
    t = re.sub(r"[\s.!]", "", text.lower())
    if t in ("0", "zero", "none", "nosolution", "nosolutions", "∅") or _NONE.match(text):
        return "0"
    if t in ("1", "one", "exactlyone", "onesolution", "exactlyonesolution", "justone"):
        return "1"
    if t in ("inf", "∞", "infinite", "infinitely", "infinitelymany", "infinitelymanysolutions", "infinitesolutions", "many") or _ALL.match(text):
        return "inf"
    return None


def _close(a, b, loose) -> bool:
    try:
        if sympy.simplify(a - b) == 0:
            return True
    except Exception:
        pass
    av, bv = num(a), num(b)
    if av is None or bv is None:
        return False
    return abs(av - bv) <= (0.0051 if loose else 1e-9)


def _values(text):
    """'x = 3 or x = -2', '3, -2', 'x = ±4' → sympy values (+ whether decimals were typed)."""
    text = re.sub(r"\b(or|and)\b|;", ",", prep(text)).replace("+-", "±")
    out = []
    for piece in text.split(","):
        piece = re.sub(r"^\s*[a-zA-Z]\s*=", "", piece).strip()
        if not piece:
            continue
        if piece.startswith("±"):
            v = parse(piece[1:])
            out += [v, -v]
        else:
            out.append(parse(piece))
    return out, "." in text


def check_solutions(answer, response):
    expected = [parse(a) for a in answer]
    if _NONE.match(response):
        return not expected, None
    if _ALL.match(response):
        return False, None
    got, loose = _values(response)
    if not expected:
        return False, "there **is no solution** here"
    if len(got) != len(expected):
        return False, f"there {'is' if len(expected) == 1 else 'are'} **{len(expected)}** solution{'s' if len(expected) != 1 else ''}"
    remaining = list(expected)
    for g in got:
        match = next((e for e in remaining if _close(g, e, loose)), None)
        if match is None:
            return False, None
        remaining.remove(match)
    return True, None


def _interval_set(text):
    text = text.replace("∞", "oo").replace("inf", "oo").replace("infinity", "oo")
    total = sympy.S.EmptySet
    for chunk in re.split(r"\s*(?:U|∪)\s*", text):
        m = re.fullmatch(r"\s*([\(\[])\s*(.+?)\s*,\s*(.+?)\s*([\)\]])\s*", chunk)
        if not m:
            return None
        lo, hi = parse(m.group(2)), parse(m.group(3))
        total = total | sympy.Interval(lo, hi, m.group(1) == "(", m.group(4) == ")")
    return total


def inequality_set(text, var=X):
    text = prep(text)
    interval = _interval_set(text) if text[:1] in "([" else None
    if interval is not None:
        return interval
    if _ALL.match(text):
        return sympy.S.Reals
    if _NONE.match(text):
        return sympy.S.EmptySet
    total = sympy.S.EmptySet
    for alt in re.split(r"\bor\b", text):
        part = sympy.S.Reals
        for conj in re.split(r"\band\b|,", alt):
            tokens = re.split(r"(<=|>=|<|>)", conj)
            if len(tokens) < 3:
                raise MathInputError("write an inequality like x > 3 or -2 < x ≤ 5")
            for i in range(0, len(tokens) - 2, 2):
                lhs, op, rhs = parse(tokens[i]), tokens[i + 1], parse(tokens[i + 2])
                rel = {"<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge}[op](lhs, rhs)
                part = part & sympy.solve_univariate_inequality(rel, var, relational=False)
        total = total | part
    return total


def _factor_count(expr):
    _, factors = sympy.factor_list(expr)
    return sum(k for f, k in factors if f.free_symbols)


def _has_negative_exponent(expr) -> bool:
    return any(p.exp.is_negative for p in expr.atoms(sympy.Pow) if p.exp.is_number)


def _unsimplified_radical(expr) -> bool:
    for p in expr.atoms(sympy.Pow):
        if p.exp == Rational(1, 2) and p.base.is_Integer:
            n = int(p.base)
            if any(n % (k * k) == 0 for k in range(2, int(n**0.5) + 1)):
                return True
    return False


def _line_expr(text):
    parts = re.split(r"(?<![<>!=])=(?!=)", prep(text))
    if len(parts) != 2:
        raise MathInputError("write the line as an equation, like y = 2x + 1")
    return sympy.expand(parse(parts[0]) - parse(parts[1]))


def op_check(req: dict) -> dict:
    kind = req.get("kind", "value")
    answer = req.get("answer")
    response = (req.get("response") or "").strip()
    if not response:
        raise MathInputError("type an answer first")
    feedback = None
    try:
        if kind == "solutions":
            correct, feedback = check_solutions(answer, response)
        elif kind == "count":
            correct = _count(response) == answer
            if not correct and _count(response) is None:
                raise MathInputError("answer no solution, one, or infinitely many")
        elif kind == "value":
            got, loose = _values(response)
            correct = len(got) == 1 and _close(got[0], parse(answer), loose)
        elif kind == "literal":
            target = Symbol(req.get("target") or "x")
            body = re.sub(rf"^\s*{target}\s*=", "", prep(response))
            correct = bool(answer) and sympy.simplify(parse(body) - parse(answer[0])) == 0
        elif kind in ("simplified", "power", "radical", "factored"):
            body = re.sub(r"^\s*[a-zA-Z]\s*=", "", prep(response))
            got = parse(body)
            exp = parse(answer)
            equivalent = sympy.simplify(got - exp) == 0
            correct = equivalent
            if equivalent and kind == "simplified":
                raw = parse(body, evaluate_expr=False)
                has_parens = any(a.is_Add for m in raw.atoms(sympy.Mul) for a in m.args) or any(p.base.is_Add for p in raw.atoms(sympy.Pow))
                terms = len(sympy.Add.make_args(sympy.expand(exp)))
                if has_parens or len(sympy.Add.make_args(raw)) != terms:
                    correct, feedback = False, "that's equivalent, but not fully simplified — distribute and combine like terms"
            elif equivalent and kind == "power":
                bases = [a for a in got.atoms(sympy.Symbol)]
                raw = parse(body, evaluate_expr=False)
                repeats = sum(1 for s in bases if len([f for f in sympy.Mul.make_args(raw) if f.has(s)]) > 1)
                if re.search(r"(\^|\*\*)\s*\(?\s*-", body) or repeats or any(p.exp == 0 for p in raw.atoms(sympy.Pow)):
                    correct, feedback = False, "equivalent, but write each variable once with a positive exponent"
            elif equivalent and kind == "radical":
                raw = parse(body, evaluate_expr=False)
                if _unsimplified_radical(raw):
                    correct, feedback = False, "equivalent, but there's still a perfect square hiding under a root"
            elif equivalent and kind == "factored":
                if got.is_Add or _factor_count(got) < _factor_count(exp) or (not got.is_Mul and not got.is_Pow):
                    correct, feedback = False, "equivalent, but it isn't factored completely"
                else:
                    # every factor must itself be irreducible
                    for f in sympy.Mul.make_args(parse(body, evaluate_expr=False)):
                        base = f.base if f.is_Pow else f
                        if base.free_symbols and (_factor_count(base) > 1 or abs(sympy.factor_list(base)[0]) != 1):
                            correct, feedback = False, "close — one of those factors can still be factored"
                            break
                    content, _ = sympy.factor_list(got)
                    exp_content, _ = sympy.factor_list(exp)
                    if correct and abs(content) != abs(exp_content):
                        correct, feedback = False, "don't forget to factor out the greatest common factor"
        elif kind == "point":
            m = re.fullmatch(r"\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)\s*", prep(response))
            if not m:
                m2 = re.fullmatch(r"\s*x\s*=\s*(.+?)\s*[,;]?\s*(?:and\s*)?y\s*=\s*(.+?)\s*", prep(response))
                m = m2
            if not m:
                raise MathInputError("write the answer as a point, like (3, -2)")
            em = re.fullmatch(r"\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)\s*", answer)
            loose = "." in response
            correct = _close(parse(m.group(1)), parse(em.group(1)), loose) and _close(parse(m.group(2)), parse(em.group(2)), loose)
        elif kind == "inequality":
            got = inequality_set(response)
            exp = inequality_set(answer)
            correct = got == exp
            if not correct and (sympy.S.Reals - got).closure == exp.closure:
                feedback = "that's exactly the opposite region — did the inequality need to flip?"
            elif not correct and isinstance(got, sympy.Interval) and isinstance(exp, sympy.Interval) and got.inf == exp.inf and got.sup == exp.sup:
                feedback = "right boundary, wrong endpoint — check $<$ versus $\\le$"
        elif kind == "line":
            e1, e2 = _line_expr(response), _line_expr(answer)
            c1, c2 = e1.coeff(Y, 1) or e1.coeff(X, 1), e2.coeff(Y, 1) or e2.coeff(X, 1)
            correct = c1 != 0 and sympy.expand(e1 * c2 - e2 * c1) == 0
        elif kind == "scientific":
            text = prep(response)
            text = re.sub(r"\s*(?:x|\*|×)\s*10\s*\^\s*", "*10^", text)
            text = re.sub(r"(\d)[eE]([-+]?\d+)", r"\1*10^\2", text)
            m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*\*\s*10\^\s*\(?\s*([-+]?\d+)\s*\)?\s*", text)
            if not m:
                raise MathInputError("write it like 3.2 × 10^5 (or 3.2*10^5)")
            mant, power = sympy.Rational(m.group(1)), int(m.group(2))
            correct = sympy.simplify(mant * Integer(10) ** power - parse(answer)) == 0
            if correct and not (1 <= abs(mant) < 10):
                correct, feedback = False, "equal value, but the first number must be at least 1 and less than 10"
        else:
            raise MathInputError(f"unknown answer kind “{kind}”")
    except MathInputError:
        raise
    except Exception as exc:
        raise MathInputError(f"couldn't read that answer ({type(exc).__name__})") from exc
    return {"correct": bool(correct), "feedback": feedback}
