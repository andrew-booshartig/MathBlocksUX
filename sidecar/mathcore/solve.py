"""Equations, inequalities and systems — with the steps a teacher would
write on the board, and a check at the end."""

import re

import sympy
from sympy import Abs, Add, Interval, Mul, Pow, Rational, S, Symbol, Union

from .parsing import (
    EQUALS, INEQUALITY, MathInputError, X, Y, build_scope, no_eval, num, parse, prep,
    pretty_number, sign_word, step, tex,
)

REL_TEX = {"=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge"}
FLIP = {"<": ">", ">": "<", "<=": ">=", ">=": "<=", "=": "="}


def _same(a: str, b: str) -> bool:
    return a.replace(" ", "") == b.replace(" ", "")


def rel_tex(lhs, rhs, rel: str = "=", keep_order: bool = False) -> str:
    return f"{tex(lhs, keep_order=keep_order)} {REL_TEX[rel]} {tex(rhs, keep_order=keep_order)}"


def relational(lhs, rhs, rel):
    return {"=": sympy.Eq, "<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge}[rel](lhs, rhs)


def solutions_tex(v, values) -> str:
    if not values:
        return "\\text{no solution}"
    return " \\quad\\text{or}\\quad ".join(f"{tex(v)} = {pretty_number(s)}" for s in values)


def _push(steps, note, latex):
    if not steps or not _same(latex, steps[-1]["latex"]):
        steps.append(step(note, latex))


def _needs_simplifying(raw, expanded) -> bool:
    """True if a side has parentheses to distribute or like terms to
    combine — not merely a different term order."""
    def nested(e):
        return (e.is_Mul or e.is_Pow) and any(a.is_Add for a in e.args) or any(nested(a) for a in e.args)
    return nested(raw) or len(Add.make_args(raw)) != len(Add.make_args(expanded))


def set_relational_tex(v, s) -> str:
    """x < -3, -2 < x ≤ 3, x ≤ -2 or x ≥ 1 — the way a textbook writes it."""
    if s is S.EmptySet:
        return "\\text{no solution}"
    if s is S.Reals:
        return "\\text{all real numbers}"
    if isinstance(s, Union):
        return " \\quad\\text{or}\\quad ".join(set_relational_tex(v, part) for part in s.args)
    if s.is_FiniteSet:
        return " \\text{ or } ".join(f"{tex(v)} = {tex(p)}" for p in s)
    if isinstance(s, Interval):
        lo = None if s.start == -sympy.oo else s.start
        hi = None if s.end == sympy.oo else s.end
        lo_rel = "<" if s.left_open else "\\le"
        hi_rel = "<" if s.right_open else "\\le"
        if lo is None and hi is None:
            return "\\text{all real numbers}"
        if lo is None:
            return f"{tex(v)} {hi_rel} {tex(hi)}"
        if hi is None:
            return f"{tex(v)} {'>' if s.left_open else '\\ge'} {tex(lo)}"
        return f"{tex(lo)} {lo_rel} {tex(v)} {hi_rel} {tex(hi)}"
    return tex(s)


# ------------------------------------------------------------- targeting


def _parse_sides(text, vars_, target):
    parts = EQUALS.split(prep(text))
    if len(parts) != 2:
        raise MathInputError("an equation needs exactly one “=”")
    keep = {target} if target else {"x"}
    scope = build_scope(vars_, keep_symbolic=keep)
    lhs_raw = parse(parts[0], scope, evaluate_expr=False)
    rhs_raw = parse(parts[1], scope, evaluate_expr=False)
    lhs, rhs = parse(parts[0], scope), parse(parts[1], scope)
    return lhs_raw, rhs_raw, lhs, rhs


def _pick_variable(expr, target):
    """`expr` may be a tuple of sides: in 2x+1 = 2x+5 the variable cancels
    out of lhs − rhs, but it's still the variable being solved for."""
    exprs = expr if isinstance(expr, (tuple, list)) else (expr,)
    unknowns = sorted(set().union(*[e.free_symbols for e in exprs]), key=str)
    if target:
        v = Symbol(target)
        if v not in unknowns:
            raise MathInputError(f"{target} doesn't appear in the equation")
        return v
    if len(unknowns) == 1:
        return unknowns[0]
    if not unknowns:
        raise MathInputError("there's no variable to solve for")
    names = ", ".join(str(u) for u in unknowns)
    raise MathInputError(f"several unknowns ({names}) — set “solve for” to pick one")


# ---------------------------------------------------------------- linear


def linear_steps(lhs_raw, rhs_raw, lhs, rhs, v, rel="=", start=True):
    """ax + b (rel) cx + d → v (rel) value, one move per step. Returns
    (steps, final_rel, value) — value is None for no solution / identity,
    with final_rel set to 'none' or 'all'."""
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, rel, keep_order=True))] if start else []
    L, R = sympy.expand(lhs), sympy.expand(rhs)
    if _needs_simplifying(lhs_raw, L) or _needs_simplifying(rhs_raw, R):
        _push(steps, "Simplify each side — distribute and combine like terms", rel_tex(L, R, rel))

    denominators = [sympy.fraction(sympy.together(t))[1] for t in Add.make_args(L) + Add.make_args(R)]
    if all(d.is_Integer for d in denominators):
        lcd = sympy.ilcm(*[int(d) for d in denominators]) if denominators else 1
        if lcd > 1:
            L, R = sympy.expand(L * lcd), sympy.expand(R * lcd)
            _push(steps, f"Multiply both sides by ${lcd}$ (the least common denominator) to clear the fractions", rel_tex(L, R, rel))

    a_l, a_r = L.coeff(v, 1), R.coeff(v, 1)
    if a_l == 0 and a_r != 0:
        L, R, rel = R, L, FLIP[rel]
        a_l, a_r = a_r, 0
        _push(steps, f"Swap the sides so ${tex(v)}$ is on the left" + (" (the inequality sign turns around with them)" if rel != "=" else ""), rel_tex(L, R, rel))
    if a_r != 0:
        word, amount = sign_word(a_r * v, "Subtract", "Add")
        L, R = sympy.expand(L - a_r * v), sympy.expand(R - a_r * v)
        _push(steps, f"{word} ${tex(amount)}$ {'from' if word == 'Subtract' else 'to'} both sides", rel_tex(L, R, rel))
    c_l = sympy.expand(L - L.coeff(v, 1) * v)
    if c_l != 0:
        word, amount = sign_word(c_l, "Subtract", "Add")
        L, R = sympy.expand(L - c_l), sympy.expand(R - c_l)
        _push(steps, f"{word} ${tex(amount)}$ {'from' if word == 'Subtract' else 'to'} both sides", rel_tex(L, R, rel))

    A = sympy.expand(L.coeff(v, 1))
    if A == 0:
        truth = relational(0, R, rel)
        if truth is S.true:
            _push(steps, f"The ${tex(v)}$-terms cancel and what's left is always true", f"0 {REL_TEX[rel]} {tex(R)}")
            steps.append(step("Every real number is a solution (an identity)", "\\text{all real numbers}"))
            return steps, "all", None
        _push(steps, f"The ${tex(v)}$-terms cancel and what's left is false", f"0 {REL_TEX[rel]} {tex(R)}")
        steps.append(step("No value makes this true", "\\text{no solution}"))
        return steps, "none", None
    if A != 1:
        negative = A.is_number and A < 0
        flip = rel != "=" and negative
        new_rel = FLIP[rel] if flip else rel
        value = sympy.simplify(R / A)
        if A == -1:
            note = "Multiply both sides by $-1$"
        else:
            note = f"Divide both sides by ${tex(A)}$"
        if flip:
            note += " — dividing or multiplying by a negative **flips the inequality sign**"
        rel = new_rel
        _push(steps, note, rel_tex(v, value, rel))
        return steps, rel, value
    return steps, rel, sympy.simplify(R)


def _check_step(lhs, rhs, v, value):
    left = sympy.simplify(lhs.subs(v, value))
    right = sympy.simplify(rhs.subs(v, value))
    ok = sympy.simplify(left - right) == 0
    mark = "\\;\\checkmark" if ok else "\\;\\times"
    return step(f"Check: put ${tex(v)} = {tex(value)}$ back into the original", f"{tex(left)} = {tex(right)}{mark}"), ok


# ------------------------------------------------------------- quadratic


def quadratic_steps(lhs_raw, rhs_raw, lhs, rhs, v, method="auto", start=True):
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))] if start else []
    moved = sympy.expand(lhs - rhs)
    a, b, c = sympy.Poly(moved, v).all_coeffs()
    D = sympy.expand(b**2 - 4 * a * c)
    numeric = all(k.is_number for k in (a, b, c))
    if not numeric:
        sols = sympy.solve(moved, v)
        steps.append(step("Solve for " + tex(v), solutions_tex(v, sols)))
        return steps, sols, None
    rational_roots = D >= 0 and sympy.sqrt(D).is_Rational
    if method == "auto":
        method = "sqrt" if b == 0 else ("factor" if rational_roots else "formula")
    if method != "sqrt" or b != 0:  # the square-root method isolates x² directly instead
        _push(steps, "Move every term to one side (standard form $ax^2 + bx + c = 0$)", f"{tex(moved)} = 0")
    if method == "factor" and not rational_roots:
        steps.append(step("This doesn't factor over the integers — using the quadratic formula instead", tex(moved) + " = 0"))
        method = "formula"

    if method == "sqrt":
        if b != 0:
            method = "complete"
        else:
            rhs_val = sympy.simplify(-c / a)
            _push(steps, f"Isolate ${tex(v**2)}$", f"{tex(v**2)} = {tex(rhs_val)}")
            if rhs_val < 0:
                steps.append(step("A square can't be negative — no real solution", "\\text{no real solution}"))
                return steps, [], D
            root = sympy.sqrt(rhs_val)
            steps.append(step("Take the square root of both sides — remember the $\\pm$", f"{tex(v)} = \\pm {tex(root)}"))
            sols = sorted({-root, root}, key=lambda s: float(s))
            return steps, sols, D

    if method == "factor":
        factored = sympy.factor(moved)
        steps.append(step("Factor the left side", f"{tex(factored)} = 0"))
        factors = [f for f in Mul.make_args(factored) if f.has(v)]
        factors = [f.base if f.is_Pow else f for f in factors]
        steps.append(step("Zero product property: if a product is 0, one of the factors is 0", " \\quad\\text{or}\\quad ".join(f"{tex(f)} = 0" for f in factors)))
        sols = sorted({sympy.solve(f, v)[0] for f in factors}, key=lambda s: float(s))
        steps.append(step("Solve each one", solutions_tex(v, sols)))
        return steps, sols, D

    if method == "complete":
        p, q = sympy.simplify(b / a), sympy.simplify(-c / a)
        if a != 1:
            _push(steps, f"Divide every term by ${tex(a)}$ so the $x^2$ coefficient is 1", f"{tex(sympy.expand(moved / a))} = 0")
        _push(steps, "Move the constant to the right side", f"{tex(v**2 + p * v)} = {tex(q)}")
        half = p / 2
        steps.append(step(f"Half of ${tex(p)}$ is ${tex(half)}$; add $({tex(half)})^2 = {tex(half**2)}$ to both sides", f"{tex(v**2 + p * v + half**2)} = {tex(q + half**2)}"))
        rhs_val = sympy.simplify(q + half**2)
        steps.append(step("The left side is now a perfect square", f"\\left({tex(v + half)}\\right)^2 = {tex(rhs_val)}"))
        if rhs_val < 0:
            steps.append(step("A square can't be negative — no real solution", "\\text{no real solution}"))
            return steps, [], D
        root = sympy.sqrt(rhs_val)
        steps.append(step("Take the square root of both sides", f"{tex(v + half)} = \\pm {tex(root)}"))
        sols = sorted({sympy.simplify(-half + root), sympy.simplify(-half - root)}, key=lambda s: float(s))
        steps.append(step(f"Subtract ${tex(half)}$" if half > 0 else f"Add ${tex(-half)}$", solutions_tex(v, sols)))
        return steps, sols, D

    # quadratic formula
    steps.append(step("Identify the coefficients", f"a = {tex(a)},\\; b = {tex(b)},\\; c = {tex(c)}"))
    steps.append(step("Quadratic formula", f"{tex(v)} = \\frac{{-b \\pm \\sqrt{{b^2 - 4ac}}}}{{2a}}"))
    steps.append(step(
        "Substitute the coefficients",
        f"{tex(v)} = \\frac{{-\\left({tex(b)}\\right) \\pm \\sqrt{{\\left({tex(b)}\\right)^2 - 4\\left({tex(a)}\\right)\\left({tex(c)}\\right)}}}}{{2\\left({tex(a)}\\right)}}",
    ))
    steps.append(step(f"Simplify — the discriminant is $b^2 - 4ac = {tex(D)}$", f"{tex(v)} = \\frac{{{tex(-b)} \\pm \\sqrt{{{tex(D)}}}}}{{{tex(2 * a)}}}"))
    if D < 0:
        steps.append(step("The discriminant is negative, so there are no real solutions (the parabola never touches the x-axis)", "\\text{no real solution}"))
        return steps, [], D
    if D == 0:
        sol = sympy.simplify(-b / (2 * a))
        steps.append(step("The discriminant is 0, so there's exactly one solution", f"{tex(v)} = {tex(sol)}"))
        return steps, [sol], D
    root = sympy.sqrt(D)
    if not _same(tex(root), f"\\sqrt{{{tex(D)}}}"):
        steps.append(step(f"Simplify the radical: $\\sqrt{{{tex(D)}}} = {tex(root)}$", f"{tex(v)} = \\frac{{{tex(-b)} \\pm {tex(root)}}}{{{tex(2 * a)}}}"))
    sols = sorted({sympy.simplify((-b + root) / (2 * a)), sympy.simplify((-b - root) / (2 * a))}, key=lambda s: float(s))
    steps.append(step("Split the $\\pm$ into two solutions", solutions_tex(v, sols)))
    return steps, sols, D


def discriminant_note(D) -> str:
    if D is None:
        return ""
    if D > 0:
        return f"Discriminant ${tex(D)} > 0$: two real solutions"
    if D == 0:
        return "Discriminant $= 0$: one repeated real solution"
    return f"Discriminant ${tex(D)} < 0$: no real solutions"


# ------------------------------------------------------ special families


def abs_steps(lhs_raw, rhs_raw, lhs, rhs, v):
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))]
    moved = sympy.expand(lhs - rhs)
    nodes = [n for n in moved.atoms(Abs) if n.has(v)]
    if len(nodes) != 1:
        solved = sympy.solveset(sympy.Eq(lhs, rhs), v, S.Reals)
        sols = sorted(solved, key=float) if solved.is_FiniteSet else []
        steps.append(step("Solve", solutions_tex(v, sols)))
        return steps, sols
    node = nodes[0]
    inner = node.args[0]
    u = Symbol("__u")
    lin = moved.xreplace({node: u})
    k, m = lin.coeff(u, 1), sympy.expand(lin - lin.coeff(u, 1) * u)
    K = sympy.simplify(-m / k)
    _push(steps, "Isolate the absolute value", f"{tex(node)} = {tex(K)}")
    if K.is_number and K < 0:
        steps.append(step("An absolute value is a distance, so it can't be negative — no solution", "\\text{no solution}"))
        return steps, []
    if K == 0:
        sols = sympy.solve(inner, v)
        steps.append(step("Only one case: the inside equals 0", f"{tex(inner)} = 0"))
        steps.append(step("Solve", solutions_tex(v, sols)))
        return steps, sols
    steps.append(step(f"Split into two cases: the inside is ${tex(K)}$ or ${tex(-K)}$", f"{tex(inner)} = {tex(K)} \\quad\\text{{or}}\\quad {tex(inner)} = {tex(-K)}"))
    candidates = sympy.solve(inner - K, v) + sympy.solve(inner + K, v)
    sols = sorted({s for s in candidates if sympy.simplify(lhs.subs(v, s) - rhs.subs(v, s)) == 0}, key=lambda s: float(s))
    steps.append(step("Solve each case", solutions_tex(v, sols)))
    return steps, sols


def radical_steps(lhs_raw, rhs_raw, lhs, rhs, v):
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))]
    moved = sympy.expand(lhs - rhs)
    radicals = [p for p in moved.atoms(Pow) if p.exp == Rational(1, 2) and p.has(v)]
    if len(radicals) != 1:
        sols = sympy.solve(sympy.Eq(lhs, rhs), v)
        steps.append(step("Solve", solutions_tex(v, sols)))
        return steps, sols
    rad = radicals[0]
    u = Symbol("__u")
    lin = moved.xreplace({rad: u})
    p, q = lin.coeff(u, 1), sympy.expand(lin - lin.coeff(u, 1) * u)
    other = sympy.simplify(-q / p)
    _push(steps, "Isolate the square root", f"{tex(rad)} = {tex(other)}")
    squared = sympy.expand(other**2)
    steps.append(step("Square both sides", f"{tex(rad.base)} = {tex(squared)}"))
    candidates = sympy.solve(sympy.expand(rad.base - squared), v)
    candidates = [c for c in candidates if c.is_real]
    good, bad = [], []
    for c in candidates:
        (good if abs(float(sympy.N(lhs.subs(v, c) - rhs.subs(v, c)))) < 1e-9 else bad).append(c)
    steps.append(step("Solve", solutions_tex(v, candidates)))
    if bad:
        steps.append(step(
            "Check each in the original — squaring can create **extraneous** solutions: " + ", ".join(f"${tex(v)} = {tex(c)}$ doesn't work" for c in bad),
            solutions_tex(v, good),
        ))
    else:
        steps.append(step("Check each in the original equation — all of them work", solutions_tex(v, good)))
    return steps, sorted(good, key=float)


def rational_steps(lhs_raw, rhs_raw, lhs, rhs, v):
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))]
    together = sympy.together(lhs - rhs)
    numer, denom = sympy.fraction(together)
    excluded = [e for e in sympy.solve(denom, v) if e.is_real]
    if excluded:
        steps.append(step("Note the values that would make a denominator 0 — they can't be solutions", ", ".join(f"{tex(v)} \\ne {tex(e)}" for e in excluded)))
    ln, ld = sympy.fraction(sympy.together(lhs))
    rn, rd = sympy.fraction(sympy.together(rhs))

    def times(a, b):
        wrap = lambda e: f"\\left({tex(e)}\\right)" if e.is_Add else tex(e)  # noqa: E731
        if b == 1:
            return tex(a)
        if a == 1:
            return tex(b)
        return f"{wrap(a)}{wrap(b)}" if not (a.is_Number and b.is_Number) else f"{tex(a)} \\cdot {tex(b)}"

    if len(Add.make_args(lhs)) == 1 and len(Add.make_args(rhs)) == 1:
        # a proportion: one fraction on each side
        new_l, new_r = sympy.expand(ln * rd), sympy.expand(rn * ld)
        steps.append(step("Cross-multiply", f"{times(ln, rd)} = {times(rn, ld)}"))
    else:
        lcd = sympy.factor(denom)
        new_l, new_r = sympy.expand(sympy.cancel(lhs * denom)), sympy.expand(sympy.cancel(rhs * denom))
        steps.append(step(f"Multiply every term by the least common denominator ${tex(lcd)}$ — the fractions cancel", f"{tex(new_l)} = {tex(new_r)}"))

    poly = sympy.expand(new_l - new_r)
    if poly.is_polynomial(v) and poly.free_symbols and sympy.Poly(poly, v).degree() == 2:
        more, candidates, _ = quadratic_steps(new_l, new_r, new_l, new_r, v, start=False)
    elif poly.is_polynomial(v):
        more, rel, value = linear_steps(new_l, new_r, new_l, new_r, v, start=False)
        candidates = [] if value is None else [value]
    else:
        candidates = [c for c in sympy.solve(poly, v) if c.is_real]
        more = [step("Solve", solutions_tex(v, candidates))]
    steps += more
    good = [c for c in candidates if all(sympy.simplify(c - e) != 0 for e in excluded)]
    if len(good) != len(candidates):
        bad = [c for c in candidates if c not in good]
        steps.append(step(
            "Throw out " + ", ".join(f"${tex(v)} = {tex(c)}$" for c in bad) + " — it makes a denominator 0 (an **extraneous** solution)",
            solutions_tex(v, good),
        ))
    return steps, sorted(good, key=float)


# -------------------------------------------------------------- equation


def solve_equation(text, vars_, target, method):
    lhs_raw, rhs_raw, lhs, rhs = _parse_sides(text, vars_, target)
    v = _pick_variable((lhs, rhs), target)
    moved = sympy.expand(lhs - rhs)
    result = {"kind": "equation", "variable": str(v)}

    if moved.has(Abs):
        steps, sols = abs_steps(lhs_raw, rhs_raw, lhs, rhs, v)
    elif any(p.exp == Rational(1, 2) and p.has(v) for p in moved.atoms(Pow)):
        steps, sols = radical_steps(lhs_raw, rhs_raw, lhs, rhs, v)
    elif sympy.fraction(sympy.together(moved))[1].has(v):
        steps, sols = rational_steps(lhs_raw, rhs_raw, lhs, rhs, v)
    elif moved.is_polynomial(v):
        degree = sympy.Poly(moved, v).degree()
        if degree <= 1:
            steps, rel, value = linear_steps(lhs_raw, rhs_raw, lhs, rhs, v)
            if rel == "all":
                result.update(steps=steps, solution_latex="\\text{all real numbers}", solutions=[], identity=True)
                return result
            sols = [] if value is None else [value]
            if value is not None and not value.free_symbols:
                check, _ = _check_step(lhs, rhs, v, value)
                steps.append(check)
        elif degree == 2:
            steps, sols, D = quadratic_steps(lhs_raw, rhs_raw, lhs, rhs, v, method)
            result["discriminant"] = discriminant_note(D)
        else:
            steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))]
            _push(steps, "Move every term to one side", f"{tex(moved)} = 0")
            factored = sympy.factor(moved)
            if factored != moved:
                steps.append(step("Factor", f"{tex(factored)} = 0"))
                steps.append(step("Zero product property: set each factor to 0", " \\quad\\text{or}\\quad ".join(
                    f"{tex(f.base if f.is_Pow else f)} = 0" for f in Mul.make_args(factored) if f.has(v))))
            sols = sorted({s for s in sympy.solve(moved, v) if s.is_real}, key=float)
            steps.append(step("Solve", solutions_tex(v, sols)))
    else:
        steps = [step("Start", rel_tex(lhs_raw, rhs_raw, keep_order=True))]
        solved = sympy.solveset(sympy.Eq(lhs, rhs), v, S.Reals)
        sols = sorted(solved, key=float) if solved.is_FiniteSet else []
        steps.append(step("Solve", solutions_tex(v, sols) if solved.is_FiniteSet else tex(solved)))

    result.update(steps=steps, solution_latex=solutions_tex(v, sols), solutions=[num(s) for s in sols])
    return result


# ------------------------------------------------------------ inequality


def point_label(v) -> str:
    """An endpoint as it's written under a number line: −7, 4/3, √2 —
    exact, never 1.33."""
    if v.is_Float:
        v = sympy.nsimplify(v)
    if v.is_Integer:
        return str(v)
    if v.is_Rational:
        return f"{v.p}/{v.q}"
    pretty = sympy.pretty(v, use_unicode=True)
    return pretty if "\n" not in pretty else str(v)


def set_to_segments(s) -> list[dict]:
    """A sympy set as number-line pieces: {lo, hi, loClosed, hiClosed}
    with None for ±∞; single points have lo == hi. Each end also comes
    exact, as it's written (loLabel, hiLabel)."""
    if s is S.EmptySet:
        return []
    if s is S.Reals:
        return [{"lo": None, "hi": None, "loClosed": False, "hiClosed": False}]
    if isinstance(s, Union):
        return [seg for part in s.args for seg in set_to_segments(part)]
    if isinstance(s, Interval):
        lo = None if s.start == -sympy.oo else num(s.start)
        hi = None if s.end == sympy.oo else num(s.end)
        seg = {"lo": lo, "hi": hi, "loClosed": not s.left_open and lo is not None, "hiClosed": not s.right_open and hi is not None}
        if lo is not None:
            seg["loLabel"] = point_label(s.start)
        if hi is not None:
            seg["hiLabel"] = point_label(s.end)
        return [seg]
    if s.is_FiniteSet:
        return [{"lo": num(p), "hi": num(p), "loClosed": True, "hiClosed": True, "loLabel": point_label(p), "hiLabel": point_label(p)} for p in s]
    return []


def interval_tex(s) -> str:
    """A solution set in interval notation: (2, ∞), (−∞, 1) ∪ (5, ∞), ∅ —
    or, for single values, set notation {4}."""
    if s is S.Reals:
        return "(-\\infty, \\infty)"
    if s is S.EmptySet:
        return "\\varnothing"
    return tex(s)


def _finish_inequality(result, v, solset, steps):
    interval = interval_tex(solset)
    answer = set_relational_tex(v, solset)
    steps.append(step("Solution in interval notation", interval))
    result.update(steps=steps, solution_latex=answer, interval_latex=interval, numberline=set_to_segments(solset))
    return result


def _parse_inequality(text, vars_, target):
    text = prep(text)
    ops = INEQUALITY.findall(text)
    parts = INEQUALITY.split(text)
    keep = {target} if target else {"x"}
    scope = build_scope(vars_, keep_symbolic=keep)
    raws = [parse(p, scope, evaluate_expr=False) for p in parts]
    vals = [parse(p, scope) for p in parts]
    return ops, raws, vals


def solve_inequality(text, vars_, target):
    ops, raws, vals = _parse_inequality(text, vars_, target)
    v = _pick_variable(tuple(vals), target)
    result = {"kind": "inequality", "variable": str(v)}

    if len(ops) == 2:
        return _double_inequality(result, ops, raws, vals, v)

    rel = ops[0]
    lhs_raw, rhs_raw = raws
    lhs, rhs = vals
    moved = sympy.expand(lhs - rhs)

    if moved.has(Abs):
        return _abs_inequality(result, rel, lhs_raw, rhs_raw, lhs, rhs, v)

    if moved.is_polynomial(v) and sympy.Poly(moved, v).degree() <= 1:
        steps, final_rel, value = linear_steps(lhs_raw, rhs_raw, lhs, rhs, v, rel)
        if final_rel == "all":
            solset = S.Reals
        elif final_rel == "none":
            solset = S.EmptySet
        else:
            solset = sympy.solveset(relational(v, value, final_rel), v, S.Reals)
        return _finish_inequality(result, v, solset, steps)

    # nonlinear (usually quadratic): boundary points + test intervals
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, rel, keep_order=True))]
    _push(steps, "Move every term to one side", f"{tex(moved)} {REL_TEX[rel]} 0")
    roots = sorted({r for r in sympy.solve(moved, v) if r.is_real}, key=float)
    steps.append(step("Find the boundary points (where the two sides are equal)", solutions_tex(v, roots)))
    edges = [-sympy.oo, *roots, sympy.oo]
    tests = []
    for lo, hi in zip(edges, edges[1:]):
        if lo == -sympy.oo and hi == sympy.oo:
            t = 0
        elif lo == -sympy.oo:
            t = sympy.floor(hi) - 1
        elif hi == sympy.oo:
            t = sympy.ceiling(lo) + 1
        else:
            t = (lo + hi) / 2
        value = moved.subs(v, t)
        ok = bool(relational(value, 0, rel))
        tests.append(f"{tex(v)} = {tex(t)}: {tex(value)} {'\\;\\checkmark' if ok else '\\;\\times'}")
    steps.append(step("Test one value from each interval in the inequality", " \\\\ ".join(tests) if len(tests) < 2 else "\\begin{aligned}" + " \\\\ ".join(tests) + "\\end{aligned}"))
    solset = sympy.solveset(relational(moved, 0, rel), v, S.Reals)
    return _finish_inequality(result, v, solset, steps)


def _double_inequality(result, ops, raws, vals, v):
    lo_raw, mid_raw, hi_raw = raws
    lo, mid, hi = vals
    r1, r2 = ops
    steps = [step("Start — a compound (“and”) inequality", f"{tex(lo_raw, keep_order=True)} {REL_TEX[r1]} {tex(mid_raw, keep_order=True)} {REL_TEX[r2]} {tex(hi_raw, keep_order=True)}")]
    M = sympy.expand(mid)
    if not (M.is_polynomial(v) and sympy.Poly(M, v).degree() == 1) or lo.has(v) or hi.has(v):
        solset = sympy.solveset(relational(lo, mid, r1), v, S.Reals).intersect(sympy.solveset(relational(mid, hi, r2), v, S.Reals))
        return _finish_inequality(result, v, solset, steps)
    A, c = M.coeff(v, 1), sympy.expand(M - M.coeff(v, 1) * v)
    if c != 0:
        word, amount = sign_word(c, "Subtract", "Add")
        lo, hi, M = lo - c, hi - c, M - c
        steps.append(step(f"{word} ${tex(amount)}$ {'from' if word == 'Subtract' else 'to'} all three parts", f"{tex(lo)} {REL_TEX[r1]} {tex(M)} {REL_TEX[r2]} {tex(hi)}"))
    if A != 1:
        lo, hi = sympy.simplify(lo / A), sympy.simplify(hi / A)
        if A < 0:
            # dividing by a negative flips both signs; reading the result
            # right-to-left (to put the smaller number first) flips them
            # back, so the net effect is just swapping ends and signs
            lo, hi, r1, r2 = hi, lo, r2, r1
            steps.append(step(f"Divide all three parts by ${tex(A)}$ — negative, so both signs flip (then rewrite smallest-to-largest)", f"{tex(lo)} {REL_TEX[r1]} {tex(v)} {REL_TEX[r2]} {tex(hi)}"))
        else:
            steps.append(step(f"Divide all three parts by ${tex(A)}$", f"{tex(lo)} {REL_TEX[r1]} {tex(v)} {REL_TEX[r2]} {tex(hi)}"))
    solset = sympy.solveset(relational(lo, v, r1), v, S.Reals).intersect(sympy.solveset(relational(v, hi, r2), v, S.Reals))
    return _finish_inequality(result, v, solset, steps)


def _abs_inequality(result, rel, lhs_raw, rhs_raw, lhs, rhs, v):
    steps = [step("Start", rel_tex(lhs_raw, rhs_raw, rel, keep_order=True))]
    moved = sympy.expand(lhs - rhs)
    node = next(n for n in moved.atoms(Abs) if n.has(v))
    inner = node.args[0]
    u = Symbol("__u")
    lin = moved.xreplace({node: u})
    k, m = lin.coeff(u, 1), sympy.expand(lin - lin.coeff(u, 1) * u)
    K = sympy.simplify(-m / k)
    if k < 0:
        rel = FLIP[rel]
    _push(steps, "Isolate the absolute value", f"{tex(node)} {REL_TEX[rel]} {tex(K)}")
    if rel in ("<", "<="):
        if K < 0 or (K == 0 and rel == "<"):
            steps.append(step("An absolute value is never negative, so it can't be less than this — no solution", "\\text{no solution}"))
            return _finish_inequality(result, v, S.EmptySet, steps)
        steps.append(step(f"“Less than” means within ${tex(K)}$ of 0: write it as a compound (“and”) inequality", f"{tex(-K)} {REL_TEX[rel]} {tex(inner)} {REL_TEX[rel]} {tex(K)}"))
        solset = sympy.solveset(relational(-K, inner, rel), v, S.Reals).intersect(sympy.solveset(relational(inner, K, rel), v, S.Reals))
    else:
        if K < 0 or (K == 0 and rel == ">="):
            steps.append(step("An absolute value is always at least 0, so this is true for every $x$", "\\text{all real numbers}"))
            return _finish_inequality(result, v, S.Reals, steps)
        steps.append(step(f"“Greater than” means farther than ${tex(K)}$ from 0: split into an “or” inequality", f"{tex(inner)} {REL_TEX[FLIP[rel]]} {tex(-K)} \\quad\\text{{or}}\\quad {tex(inner)} {REL_TEX[rel]} {tex(K)}"))
        solset = sympy.solveset(relational(inner, -K, FLIP[rel]), v, S.Reals).union(sympy.solveset(relational(inner, K, rel), v, S.Reals))
    steps.append(step("Solve each part", set_relational_tex(v, solset)))
    return _finish_inequality(result, v, solset, steps)


def solve_compound_words(text, vars_, target):
    """'2x + 1 < 5 or x - 3 > 4' / '... and ...'"""
    joiner = "or" if re.search(r"\bor\b", text) else "and"
    pieces = [p.strip() for p in re.split(rf"\b{joiner}\b", text) if p.strip()]
    steps, sets, variable = [], [], None
    for i, piece in enumerate(pieces, 1):
        part = solve_inequality(piece, vars_, target)
        variable = part["variable"]
        for s in part["steps"][:-1]:
            steps.append(step(f"Part {i}: {s['note']}", s["latex"]))
        v = Symbol(variable)
        sets.append(sympy.solveset(_segments_relational(part, v), v, S.Reals))
    combined = sets[0]
    for s in sets[1:]:
        combined = combined.union(s) if joiner == "or" else combined.intersect(s)
    steps.append(step(f"Combine — “{joiner}” means {'either part (union)' if joiner == 'or' else 'both parts at once (overlap)'}", set_relational_tex(Symbol(variable), combined)))
    return _finish_inequality({"kind": "inequality", "variable": variable}, Symbol(variable), combined, steps)


def _segments_relational(part, v):
    pieces = []
    for seg in part["numberline"]:
        lo, hi = seg["lo"], seg["hi"]
        conds = []
        if lo is not None:
            conds.append(v >= sympy.nsimplify(lo) if seg["loClosed"] else v > sympy.nsimplify(lo))
        if hi is not None:
            conds.append(v <= sympy.nsimplify(hi) if seg["hiClosed"] else v < sympy.nsimplify(hi))
        pieces.append(sympy.And(*conds) if conds else S.true)
    return sympy.Or(*pieces) if pieces else S.false


# ---------------------------------------------------------------- system


def _cases(lines) -> str:
    return "\\begin{cases} " + " \\\\ ".join(lines) + " \\end{cases}"


def _with_parens(side, var, value) -> str:
    """LaTeX for `side` with `var` shown replaced by (value) — the way you'd
    write a substitution by hand, before simplifying."""
    slot = Symbol("SUBSTSLOT")
    text = tex(side.subs(var, slot))
    inner = tex(value)
    return text.replace("SUBSTSLOT", inner if text.strip() == "SUBSTSLOT" else f"\\left({inner}\\right)")


def solve_system(lines, vars_, method):
    scope = build_scope(vars_, keep_symbolic={"x", "y"})
    eqs, raw_lines = [], []
    for line in lines:
        parts = EQUALS.split(prep(line))
        if len(parts) != 2:
            raise MathInputError(f"“{line}” isn't an equation — each line of a system needs one “=”")
        raw_lines.append(rel_tex(parse(parts[0], scope, evaluate_expr=False), parse(parts[1], scope, evaluate_expr=False), keep_order=True))
        eqs.append((parse(parts[0], scope), parse(parts[1], scope)))
    unknowns = sorted(set().union(*[(l - r).free_symbols for l, r in eqs]), key=lambda s: (str(s) not in ("x", "y"), str(s)))
    result = {"kind": "system", "variables": [str(u) for u in unknowns]}
    steps = [step("Start", _cases(raw_lines))]

    linear = all(sympy.expand(l - r).is_polynomial(*unknowns) and sympy.Poly(sympy.expand(l - r), *unknowns).total_degree() <= 1 for l, r in eqs)
    if not (len(eqs) == 2 and len(unknowns) == 2 and linear):
        sols = sympy.solve([sympy.Eq(l, r) for l, r in eqs], unknowns, dict=True)
        sols = [s for s in sols if all(val.is_real for val in s.values())]
        if not sols:
            steps.append(step("Solve", "\\text{no real solution}"))
            result.update(steps=steps, solution_latex="\\text{no real solution}", points=[])
            return result
        if len(eqs) == 2 and len(unknowns) == 2:
            # nonlinear 2×2 (line & parabola): substitute
            (l1, r1), (l2, r2) = eqs
            for (la, ra), (lb, rb) in (((l1, r1), (l2, r2)), ((l2, r2), (l1, r1))):
                for u in unknowns:
                    iso = sympy.solve(sympy.Eq(la, ra), u)
                    if len(iso) == 1 and sympy.expand(la - ra).is_polynomial(u) and sympy.Poly(sympy.expand(la - ra), u).degree() == 1:
                        steps.append(step(f"Solve one equation for ${tex(u)}$", f"{tex(u)} = {tex(iso[0])}"))
                        substituted = sympy.expand((lb - rb).subs(u, iso[0]))
                        steps.append(step("Substitute into the other equation", f"{tex(substituted)} = 0"))
                        break
                else:
                    continue
                break
        pts = [tuple(s[u] for u in unknowns) for s in sols]
        latex = " \\quad\\text{or}\\quad ".join("\\left(" + ", ".join(pretty_number(c) for c in p) + "\\right)" for p in pts)
        steps.append(step("Solve", latex))
        result.update(steps=steps, solution_latex=latex, points=[[num(c) for c in p] for p in pts])
        return result

    u, w = unknowns
    std = []
    for l, r in eqs:
        e = sympy.expand(l - r)
        a, b = e.coeff(u, 1), e.coeff(w, 1)
        c = -sympy.expand(e - a * u - b * w)
        std.append((a, b, c))
    std_lines = [f"{tex(a * u + b * w)} = {tex(c)}" for a, b, c in std]
    (a1, b1, c1), (a2, b2, c2) = std
    det = a1 * b2 - a2 * b1

    if det == 0:
        consistent = sympy.simplify(a1 * c2 - a2 * c1) == 0 and sympy.simplify(b1 * c2 - b2 * c1) == 0
        if consistent:
            steps.append(step("One equation is a multiple of the other — they're the same line", "\\text{infinitely many solutions}"))
            result.update(steps=steps, solution_latex="\\text{infinitely many solutions (the same line)}", points=[], infinite=True)
        else:
            steps.append(step("Same slope but different intercepts — the lines are parallel and never meet", "\\text{no solution}"))
            result.update(steps=steps, solution_latex="\\text{no solution (parallel lines)}", points=[])
        return result

    already_solved = [(i, s) for i, (l, r) in enumerate(eqs) for s in (u, w) if l == s and not r.has(s)]
    unit_coeff = [(i, s) for i, (a, b, c) in enumerate(std) for s, k in ((u, a), (w, b)) if k in (1, -1)]
    if method == "auto":
        method = "substitution" if already_solved or unit_coeff else "elimination"

    if method == "substitution":
        i, var = (already_solved or unit_coeff or [(0, u)])[0]
        j = 1 - i
        other = w if var == u else u
        expr = sympy.solve(sympy.Eq(*eqs[i]), var)[0]
        if not (eqs[i][0] == var):
            steps.append(step(f"Solve equation ({i + 1}) for ${tex(var)}$", f"{tex(var)} = {tex(expr)}"))
        lj, rj = eqs[j]
        steps.append(step(
            f"Substitute ${tex(expr)}$ for ${tex(var)}$ in equation ({j + 1})",
            f"{_with_parens(lj, var, expr)} = {_with_parens(rj, var, expr)}",
        ))
        sub_l, sub_r = lj.subs(var, expr), rj.subs(var, expr)
        more, rel, value = linear_steps(sub_l, sub_r, sub_l, sub_r, other, start=False)
        steps += more
        back = sympy.simplify(expr.subs(other, value))
        steps.append(step(f"Put ${tex(other)} = {tex(value)}$ back into ${tex(var)} = {tex(expr)}$", f"{tex(var)} = {tex(back)}"))
        sol = {other: value, var: back}
    else:
        # eliminate the variable that needs the smaller multipliers
        def cost(k1, k2):
            return sympy.ilcm(int(abs(k1)), int(abs(k2))) if k1.is_Integer and k2.is_Integer else 10**6

        elim, keep = (w, u) if cost(b1, b2) <= cost(a1, a2) else (u, w)
        k1, k2 = (b1, b2) if elim == w else (a1, a2)
        L = cost(k1, k2) if cost(k1, k2) < 10**6 else abs(k1 * k2)
        m1, m2 = sympy.Rational(L, abs(k1)), sympy.Rational(L, abs(k2))
        if (k1 > 0) == (k2 > 0):
            m2 = -m2
        if not all(_same(s, r) for s, r in zip(std_lines, raw_lines)):
            steps.append(step("Line up the variables: write both equations as $ax + by = c$", _cases(std_lines)))
        new = [tuple(m * x for x in row) for m, row in ((m1, std[0]), (m2, std[1]))]
        notes = []
        if m1 != 1:
            notes.append(f"equation (1) by ${tex(m1)}$")
        if m2 != 1:
            notes.append(f"equation (2) by ${tex(m2)}$")
        if notes:
            steps.append(step(f"Multiply {' and '.join(notes)} so the ${tex(elim)}$-terms are opposites", _cases([f"{tex(a * u + b * w)} = {tex(c)}" for a, b, c in new])))
        sa, sb, sc = (new[0][k] + new[1][k] for k in range(3))
        summed = sa * u + sb * w
        steps.append(step(f"Add the equations — the ${tex(elim)}$-terms cancel", f"{tex(summed)} = {tex(sc)}"))
        coef = summed.coeff(keep, 1)
        value = sympy.simplify(sc / coef)
        if coef != 1:
            steps.append(step(f"Divide both sides by ${tex(coef)}$", f"{tex(keep)} = {tex(value)}"))
        l1, r1 = eqs[0]
        back = sympy.solve(sympy.Eq(l1.subs(keep, value), r1.subs(keep, value)), elim)[0]
        steps.append(step(
            f"Substitute ${tex(keep)} = {tex(value)}$ into equation (1)",
            f"{_with_parens(l1, keep, value)} = {_with_parens(r1, keep, value)}",
        ))
        steps.append(step(f"Solve for ${tex(elim)}$", f"{tex(elim)} = {tex(back)}"))
        sol = {keep: value, elim: back}

    point = (sol[u], sol[w])
    checks = []
    for (l, r) in eqs:
        lv, rv = sympy.simplify(l.subs(sol)), sympy.simplify(r.subs(sol))
        checks.append(f"{tex(lv)} = {tex(rv)}" + ("\\;\\checkmark" if sympy.simplify(lv - rv) == 0 else "\\;\\times"))
    steps.append(step(f"Check $({tex(point[0])}, {tex(point[1])})$ in both original equations", _cases(checks)))
    latex = f"({tex(u)}, {tex(w)}) = \\left({pretty_number(point[0])}, {pretty_number(point[1])}\\right)"
    result.update(steps=steps, solution_latex=latex, points=[[num(point[0]), num(point[1])]])
    return result


# -------------------------------------------------------------------- op


def op_solve(req: dict) -> dict:
    text = prep(req.get("expr", ""))
    vars_ = req.get("vars") or {}
    target = (req.get("for") or "").strip() or None
    method = req.get("method") or "auto"
    lines = [line.strip() for line in re.split(r"[\n;]", text) if line.strip()]
    if not lines:
        raise MathInputError("type an equation, inequality, or a system (one equation per line)")
    if len(lines) >= 2:
        return solve_system(lines, vars_, method)
    line = lines[0]
    if INEQUALITY.search(line):
        if re.search(r"\b(or|and)\b", line):
            return solve_compound_words(line, vars_, target)
        return solve_inequality(line, vars_, target)
    if re.search(r"\band\b", line) and EQUALS.search(line):
        return solve_system([p for p in re.split(r"\band\b", line)], vars_, method)
    return solve_equation(line, vars_, target, method)
