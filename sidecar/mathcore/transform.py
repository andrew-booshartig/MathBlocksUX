"""Simplify / expand / factor / evaluate / scientific notation — each with
the intermediate steps a teacher would write, not just the final answer."""

import math
import re
from functools import reduce

import sympy
from sympy import Add, Integer, Mul, Pow, Rational, Symbol

from .parsing import (
    MathInputError, build_scope, no_eval, num, parse, prep, pretty_number, step,
    strip_function_label, tex,
)

MAX_STEPS = 30

# ---------------------------------------------------------------- helpers


def rewrite_first(expr, rule):
    """Apply `rule` to the first node (preorder) it matches, rebuilding the
    ancestors without evaluation so the rest stays exactly as typed."""
    replaced = rule(expr)
    if replaced is not None:
        return replaced, True
    if not expr.args:
        return expr, False
    args = list(expr.args)
    for i, arg in enumerate(args):
        new, done = rewrite_first(arg, rule)
        if done:
            args[i] = new
            with no_eval():
                return expr.func(*args), True
    return expr, False


def rewrite_all(expr, rule):
    """Apply `rule` everywhere it matches (bottom-up), without evaluation."""
    if expr.args:
        args = [rewrite_all(a, rule) for a in expr.args]
        with no_eval():
            expr = expr.func(*args)
    replaced = rule(expr)
    return replaced if replaced is not None else expr


def full_eval(expr):
    """Evaluate an unevaluated tree completely."""
    if not expr.args:
        return expr
    return expr.func(*[full_eval(a) for a in expr.args])


def largest_square_factor(n: int) -> int:
    k = 1
    i = 2
    while i * i <= n:
        while n % (i * i) == 0:
            n //= i * i
            k *= i
        i += 1
    return k


def split_assignments(text: str) -> tuple[str, dict]:
    """'3x^2 - 2x, x = 4' / '3x^2 - 2x when x = 4' → ('3x^2 - 2x', {'x': '4'})."""
    text = prep(text)
    match = re.split(r"\b(?:when|where|at|for|with)\b", text, maxsplit=1)
    head, tail = (match[0], match[1]) if len(match) == 2 else (text, "")
    parts = [p.strip() for p in re.split(r"[,;]", head)]
    expr_parts, assigns = [], {}
    for part in parts + [p.strip() for p in re.split(r"[,;]| and ", tail) if p.strip()]:
        m = re.fullmatch(r"([A-Za-z_]\w*)\s*=\s*(.+)", part)
        if m:
            assigns[m.group(1)] = m.group(2)
        elif part:
            expr_parts.append(part)
    return ", ".join(expr_parts), assigns


# ------------------------------------------------- order of operations


def _is_value(e) -> bool:
    if e.is_Number:
        return True
    if e.is_Mul and len(e.args) == 2 and any(a == -1 for a in e.args) and all(a.is_Number for a in e.args):
        return True  # -n
    if e.is_Pow and e.exp == -1 and e.base.is_Number:
        return True  # part of a/b notation
    if e.is_Pow and e.exp == Rational(1, 2) and e.base.is_Integer and e.base > 0 and largest_square_factor(int(e.base)) == 1:
        return True  # irreducible radical like √2
    if e.is_Mul and len(e.args) == 2 and any(a.is_Number for a in e.args) and all(_is_value(a) for a in e.args) and any(
        a.is_Pow and a.exp == Rational(1, 2) for a in e.args
    ):
        return True  # 5√2
    return False


def _tidy_negatives(tree):
    """(-1)·9 → -9 after a step, so '-3²' reads '-9', not '(-1) 9'."""

    def rule(e):
        if e.is_Mul and len(e.args) == 2 and any(a == -1 for a in e.args):
            other = e.args[0] if e.args[1] == -1 else e.args[1]
            if other.is_Number and other > 0:
                return -other
        return None

    return rewrite_all(tree, rule)


def _reducible(e) -> bool:
    return bool(e.args) and not _is_value(e) and all(_is_value(a) for a in e.args)


def _pemdas_candidates(e, depth=0, grouped=False, path=()):
    """Yield (priority_key, path, node) for every node ready to compute."""
    if not e.args:
        return
    if _reducible(e):
        rank = {Pow: 0, sympy.Abs: 0, Mul: 1, Add: 2}.get(e.func, 1)
        yield (0 if grouped else 1, -depth, rank, path), e
    for i, arg in enumerate(e.args):
        child_grouped = arg.is_Add and e.func in (Mul, Pow, sympy.Abs)
        yield from _pemdas_candidates(arg, depth + 1, child_grouped or grouped and not arg.is_Atom, path + (i,))


def _describe(node, result, grouped: bool) -> str:
    calc = f"${tex(node, keep_order=True)} = {tex(result)}$"
    if node.func is sympy.Abs:
        kind = "Absolute value"
    elif node.is_Pow:
        kind = "Square root" if node.exp == Rational(1, 2) else "Exponent"
    elif node.is_Mul:
        kind = "Divide" if any(a.is_Pow and a.exp == -1 for a in node.args) else "Multiply"
    elif node.is_Add:
        has_neg = any(a.could_extract_minus_sign() for a in node.args)
        kind = "Add and subtract" if has_neg and len(node.args) > 2 else ("Subtract" if has_neg else "Add")
    else:
        kind = "Compute"
    return f"{'Inside parentheses — ' if grouped else ''}{kind}: {calc}"


def pemdas_steps(tree) -> tuple[list[dict], object]:
    """Numeric expression → one step per operation, in order-of-operations
    order (innermost grouping, then exponents, ×÷, +−)."""
    steps = []
    radical = _simplify_radicals(tree)
    if radical is not None:
        tree, note = radical
        steps.append(step(note, tex(tree, keep_order=True)))
    for _ in range(MAX_STEPS):
        candidates = sorted(_pemdas_candidates(tree), key=lambda item: item[0])
        if not candidates:
            break
        (grouped_flag, *_), node = candidates[0]
        result = full_eval(node)
        with no_eval():
            new_tree = tree.xreplace({node: result})
        new_tree = _tidy_negatives(new_tree)
        if tex(new_tree, keep_order=True) == tex(tree, keep_order=True):
            tree = full_eval(tree)
            break
        tree = new_tree
        steps.append(step(_describe(node, result, grouped_flag == 0), tex(tree, keep_order=True)))
    value = full_eval(tree)
    if steps and tex(value) != steps[-1]["latex"] and value.atoms(Pow):
        steps.append(step("Combine like radicals", tex(value)))
    return steps, value


def _simplify_radicals(tree):
    """√72 → 6√2 everywhere, as one step. None if nothing to simplify."""
    notes = []

    def rule(e):
        if e.is_Pow and e.exp == Rational(1, 2) and e.base.is_Integer and e.base > 1:
            n = int(e.base)
            k = largest_square_factor(n)
            if k > 1:
                rest = n // (k * k)
                notes.append(f"$\\sqrt{{{n}}} = \\sqrt{{{k * k}}}\\cdot\\sqrt{{{rest}}} = {tex(k * sympy.sqrt(rest))}$")
                with no_eval():
                    return Integer(k) if rest == 1 else Mul(Integer(k), Pow(Integer(rest), Rational(1, 2)))
        return None

    new = rewrite_all(tree, rule)
    if not notes:
        return None
    return new, "Simplify the radical" + ("s" if len(notes) > 1 else "") + " (pull out perfect squares): " + ", ".join(notes)


# ------------------------------------------------------ exponent rules


def _has_add(e) -> bool:
    return e.is_Add or any(_has_add(a) for a in e.args)


def _base_exp(f):
    """(base, exponent) of a factor, reading x^-m from a/b notation too."""
    if f.is_Pow:
        base, exp = f.args
        if base.is_Pow and exp == -1:
            return base.args[0], -base.args[1]
        return base, exp
    return f, Integer(1)


def _exponent_rule(e):
    if e.is_Pow and e.exp == 0 and not e.base.is_Number:
        with no_eval():
            return Integer(1), f"Zero exponent: ${tex(e)} = 1$"
    if e.is_Pow and e.base.is_Pow and e.exp != -1 and e.exp.is_Number:
        b, m = e.base.args
        product = full_eval(m) * e.exp  # computed outside no_eval, so it's a real number
        with no_eval():
            return Pow(b, product), f"Power of a power — multiply the exponents: ${tex(m)} \\cdot {tex(e.exp)} = {tex(product)}$"
    if e.is_Pow and e.base.is_Mul and e.exp.is_Number:
        n = e.exp
        with no_eval():
            factors = [Pow(f, n) for f in e.base.args]
            if n == -1:
                return Mul(*factors), "Split the denominator into its factors"
            return Mul(*factors), "Power of a product — raise every factor to the power"
    if e.is_Mul:
        groups: dict = {}
        for f in e.args:
            if f.is_Number:
                continue
            base, exp = _base_exp(f)
            groups.setdefault(base, []).append(exp)
        for base, exps in groups.items():
            if len(exps) > 1 and not base.is_Number:
                exps = [full_eval(x) for x in exps]
                total = sum(exps)
                keep = [f for f in e.args if f.is_Number or _base_exp(f)[0] != base]
                quotient = any(x.could_extract_minus_sign() for x in exps)
                rule = "Quotient rule — subtract exponents" if quotient else "Product rule — add exponents"
                with no_eval():
                    combined = Integer(1) if total == 0 else (base if total == 1 else Pow(base, total))
                    return Mul(*keep, combined) if keep else combined, f"{rule}: ${' + '.join(tex(x) for x in exps).replace('+ -', '- ')} = {tex(total)}$ for ${tex(base)}$"
        numbers = [f for f in e.args if f.is_Number or (f.is_Pow and f.base.is_Number and f.exp.is_Number)]
        if len(numbers) > 1:
            product = full_eval(Mul(*numbers))
            rest = [f for f in e.args if f not in numbers]
            dividing = any(f.is_Pow and f.exp.is_negative for f in numbers)
            note = f"Divide the coefficients: ${tex(Mul(*numbers, evaluate=False), keep_order=True)} = {tex(product)}$" if dividing else "Multiply the coefficients"
            with no_eval():
                if not rest:
                    return product, note
                return (Mul(*rest) if product == 1 else Mul(product, *rest)), note
    if e.is_Pow and e.base.is_Number and e.exp.is_Integer and e.exp > 1:
        return full_eval(e), f"Evaluate ${tex(e, keep_order=True)} = {tex(full_eval(e))}$"
    return None


def _flatten_muls(tree):
    def rule(e):
        if e.is_Mul and any(a.is_Mul for a in e.args):
            flat = []
            for a in e.args:
                flat.extend(a.args if a.is_Mul else [a])
            with no_eval():
                return Mul(*flat)
        return None

    return rewrite_all(tree, rule)


def exponent_steps(raw, val) -> tuple[list[dict], object]:
    steps = []
    tree = _flatten_muls(raw)
    for _ in range(15):
        found = {}

        def rule(e):
            result = _exponent_rule(e)
            if result is None:
                return None
            found["note"] = result[1]
            return result[0]

        new, done = rewrite_first(tree, rule)
        if not done:
            break
        new = _flatten_muls(new)
        visible = tex(new, keep_order=True) != tex(tree, keep_order=True)
        tree = new
        if visible:  # some rewrites (splitting a denominator) only restructure
            steps.append(step(found["note"], tex(tree, keep_order=True)))
    # the answer comes from the original expression, not the illustrative
    # rewrites above, so it's right even if a rule took a shortcut
    final = sympy.powsimp(val, force=True)
    if not steps or tex(final) != steps[-1]["latex"]:
        has_neg = any(p.exp.is_negative for p in full_eval(tree).atoms(Pow) if p.exp.is_Number and not p.base.is_Number)
        steps.append(step("Write with positive exponents" if has_neg else "Simplify", tex(final)))
    return steps, final


# ------------------------------------------------------------- simplify


def simplify_steps(raw, val) -> tuple[list[dict], object]:
    steps = [step("Start", tex(raw, keep_order=True))]
    syms = val.free_symbols
    if not syms:
        more, value = pemdas_steps(raw)
        return steps + more, value

    radical = _simplify_radicals(raw)
    if radical is not None:
        raw, note = radical
        steps.append(step(note, tex(raw, keep_order=True)))
        val = full_eval(raw)

    if not _has_add(raw) and raw.atoms(Pow):
        more, value = exponent_steps(raw, val)
        return steps + more, value

    if val.is_polynomial(*syms):
        distributed = _distribute_terms(raw)
        if distributed is not None and tex(distributed, keep_order=True) != steps[-1]["latex"]:
            steps.append(step("Distribute (multiply out the parentheses)", tex(distributed, keep_order=True)))
        result = sympy.expand(val)
        if tex(result) != steps[-1]["latex"]:
            steps.append(step("Combine like terms", tex(result)))
        return steps, result

    together = sympy.cancel(sympy.together(val))
    if together.is_rational_function(*syms):
        numer, denom = sympy.fraction(sympy.factor(together))
        factored = sympy.factor(sympy.together(val))
        if tex(factored) != steps[-1]["latex"]:
            steps.append(step("Factor, then cancel common factors", tex(factored)))
        return steps, factored

    result = sympy.simplify(val)
    if tex(result) != steps[-1]["latex"]:
        steps.append(step("Simplify", tex(result)))
    return steps, result


def _distribute_terms(raw):
    """Multiply out each top-level term separately, *without* combining
    like terms, so 'distribute' and 'combine' can be separate steps."""
    pieces = []
    for term in Add.make_args(raw):
        expanded = sympy.expand(full_eval(term))
        syms = sorted(expanded.free_symbols, key=str)
        pieces.extend(_degree_sorted(list(Add.make_args(expanded)), syms) if syms else [expanded])
    if len(pieces) <= 1:
        return None
    with no_eval():
        return Add(*pieces)


# --------------------------------------------------------------- expand


def expand_steps(raw, val) -> tuple[list[dict], object]:
    steps = [step("Start", tex(raw, keep_order=True))]
    tree = raw

    def power_rule(e):
        if e.is_Pow and e.base.is_Add and e.exp.is_Integer and 1 < e.exp <= 4:
            with no_eval():
                return Mul(*([e.base] * int(e.exp)))
        return None

    powered = rewrite_all(tree, power_rule)
    if tex(powered, keep_order=True) != tex(tree, keep_order=True):
        note = "Write the power as repeated multiplication"
        for p in tree.atoms(Pow):
            if p.base.is_Add and p.exp == 2 and len(p.base.args) == 2:
                note += " — a square of a binomial: $(a+b)^2 = a^2 + 2ab + b^2$"
                break
        tree = powered
        steps.append(step(note, tex(tree, keep_order=True)))

    products = []
    foil = False
    for term in Add.make_args(tree):
        factors = Mul.make_args(term)
        binomials = [f for f in factors if f.is_Add]
        if len(binomials) == 2 and all(len(b.args) == 2 for b in binomials) and len(factors) == 2:
            foil = True
            (a, b), (c, d) = binomials[0].args, binomials[1].args
            products += [full_eval(a * c), full_eval(a * d), full_eval(b * c), full_eval(b * d)]
        else:
            expanded = sympy.expand(full_eval(term))
            syms = sorted(expanded.free_symbols, key=str)
            products += _degree_sorted(list(Add.make_args(expanded)), syms) if syms else [expanded]
    if len(products) > 1:
        with no_eval():
            distributed = Add(*products)
        if tex(distributed, keep_order=True) != steps[-1]["latex"]:
            steps.append(step("FOIL — First, Outer, Inner, Last" if foil else "Distribute every term", tex(distributed, keep_order=True)))
    result = sympy.expand(val)
    if tex(result) != steps[-1]["latex"]:
        steps.append(step("Combine like terms", tex(result)))
    return steps, result


# --------------------------------------------------------------- factor


def _int_pairs(product: int, total: int):
    for r in range(-abs(product) - 1, abs(product) + 2):
        if r == 0:
            if product == 0 and total == 0:
                return 0, 0
            continue
        if product % r == 0 and r + product // r == total:
            return r, product // r
    return None


def _perfect_root(term, n: int):
    """The n-th root of a monomial if it's a perfect n-th power (4x² → 2x,
    27y³ → 3y), else None. sympy.sqrt(x**2) stays sqrt(x**2) unless x is
    declared positive, so roots are read off coefficient and exponents."""
    coeff, rest = term.as_coeff_Mul()
    if not coeff.is_Rational or coeff <= 0:
        return None
    rp, okp = sympy.integer_nthroot(int(coeff.p), n)
    rq, okq = sympy.integer_nthroot(int(coeff.q), n)
    if not (okp and okq):
        return None
    root = Rational(rp, rq)
    for factor in Mul.make_args(rest):
        if factor == 1:
            continue
        base, exp = factor.as_base_exp()
        if not base.is_Symbol or not exp.is_Integer or exp % n:
            return None
        root *= base ** (exp // n)
    return root


def _paren(e) -> str:
    return f"\\left({tex(e)}\\right)"


def _degree_sorted(terms, syms):
    return sorted(terms, key=lambda t: -sympy.Poly(t, *syms).total_degree() if t.free_symbols else 1)


def factor_steps(val) -> tuple[list[dict], object]:
    expr = sympy.expand(val)
    steps = [step("Start", tex(expr))]
    syms = sorted(expr.free_symbols, key=str)
    if not syms or not expr.is_polynomial(*syms):
        result = sympy.factor(expr)
        steps.append(step("Factor", tex(result)))
        return steps, result

    terms = list(Add.make_args(expr))
    gcf = reduce(sympy.gcd, terms)
    if sympy.Poly(expr, *syms).LC() < 0:
        gcf = -gcf
    rest = sympy.expand(expr / gcf)

    # the GCF, as a LaTeX prefix for every later form ("3x^2 (...)", "-(...)")
    if gcf == 1:
        prefix = ""
    elif gcf == -1:
        prefix = "-"
    else:
        prefix = tex(gcf)
    if prefix:
        steps.append(step(f"Factor out the greatest common factor ${tex(gcf)}$", f"{prefix}{_paren(rest)}"))

    rest_terms = _degree_sorted(list(Add.make_args(rest)), syms)
    rest_vars = sorted(rest.free_symbols, key=str)

    if len(rest_terms) == 2:
        pos = [t for t in rest_terms if not t.could_extract_minus_sign()]
        neg = [-t for t in rest_terms if t.could_extract_minus_sign()]
        if len(pos) == 1 and len(neg) == 1:
            a, b = _perfect_root(pos[0], 2), _perfect_root(neg[0], 2)
            if a is not None and b is not None:
                steps.append(step(
                    f"Difference of squares: $a^2 - b^2 = (a-b)(a+b)$ with $a = {tex(a)}$, $b = {tex(b)}$",
                    f"{prefix}{_paren(a - b)}{_paren(a + b)}",
                ))
                return _finish(steps, val)
        for first, second in (rest_terms, rest_terms[::-1]):
            if first.could_extract_minus_sign():
                continue
            a = _perfect_root(first, 3)
            b = _perfect_root(-second if second.could_extract_minus_sign() else second, 3)
            if a is None or b is None:
                continue
            if second.could_extract_minus_sign():
                note, shown = "Difference of cubes: $a^3 - b^3 = (a-b)(a^2+ab+b^2)$", f"{_paren(a - b)}{_paren(a**2 + a * b + b**2)}"
            else:
                note, shown = "Sum of cubes: $a^3 + b^3 = (a+b)(a^2-ab+b^2)$", f"{_paren(a + b)}{_paren(a**2 - a * b + b**2)}"
            steps.append(step(f"{note} with $a = {tex(a)}$, $b = {tex(b)}$", prefix + shown))
            return _finish(steps, val)

    if len(rest_terms) == 3 and len(rest_vars) == 1:
        v = rest_vars[0]
        poly = sympy.Poly(rest, v)
        if poly.degree() == 2 and all(c.is_Integer for c in poly.all_coeffs()):
            a, b, c = (int(k) for k in poly.all_coeffs())
            sa, sc = math.isqrt(abs(a)), math.isqrt(abs(c))
            if a > 0 and c > 0 and sa * sa == a and sc * sc == c and abs(b) == 2 * sa * sc:
                root = sa * v + (sc if b > 0 else -sc)
                steps.append(step(
                    f"Perfect square trinomial: ${tex(a * v**2)} = ({tex(sa * v)})^2$, ${c} = {sc}^2$, and the middle term is $2 \\cdot {tex(sa * v)} \\cdot {sc}$",
                    f"{prefix}{_paren(root)}^{{2}}",
                ))
                return _finish(steps, val)
            pair = _int_pairs(a * c, b)
            if pair is None:
                steps.append(step(
                    f"No two integers multiply to ${a * c}$ and add to ${b}$ — this trinomial is prime (it doesn't factor over the integers)",
                    f"{prefix}{_paren(rest)}" if prefix else tex(rest),
                ))
                return steps, val
            r, s = pair
            if a == 1:
                steps.append(step(
                    f"Find two numbers that multiply to ${c}$ and add to ${b}$: ${r}$ and ${s}$",
                    f"{prefix}{_paren(v + r)}{_paren(v + s)}",
                ))
                return _finish(steps, val)
            split = " ".join([tex(a * v**2), _signed(r * v), _signed(s * v), _signed(Integer(c))])
            steps.append(step(
                f"AC method: $a \\cdot c = {a} \\cdot {c} = {a * c}$. Two numbers that multiply to ${a * c}$ and add to ${b}$: ${r}$ and ${s}$ — split the middle term",
                f"{prefix}{_paren_raw(split) if prefix else split}",
            ))
            left, right = a * v**2 + r * v, s * v + c
            g1, g2 = sympy.gcd(left, r * v), sympy.gcd(s * v, Integer(c))
            if sympy.expand(left / g1 - right / g2) != 0:
                g2 = -g2
            grouped = f"{tex(g1)}{_paren(sympy.expand(left / g1))} {_signed_factor(g2)}{_paren(sympy.expand(right / g2))}"
            steps.append(step("Group in pairs and factor each pair's GCF", prefix + (_paren_raw(grouped) if prefix else grouped)))
            return _finish(steps, val, note=f"Factor out the common binomial ${_paren(sympy.expand(left / g1))}$")

    if len(rest_terms) == 4:
        t = rest_terms
        g1, g2 = sympy.gcd(t[0], t[1]), sympy.gcd(t[2], t[3])
        if t[2].could_extract_minus_sign():
            g2 = -g2
        b1, b2 = sympy.expand((t[0] + t[1]) / g1), sympy.expand((t[2] + t[3]) / g2)
        if sympy.expand(b1 - b2) == 0:
            grouped = f"{tex(g1)}{_paren(b1)} {_signed_factor(g2)}{_paren(b2)}"
            steps.append(step("Factor by grouping: pull the GCF out of each pair", prefix + (_paren_raw(grouped) if prefix else grouped)))
            return _finish(steps, val, note=f"Factor out the common binomial ${_paren(b1)}$")

    return _finish(steps, val)


def _signed(term) -> str:
    text = tex(term)
    return f"- {text[1:].lstrip()}" if text.startswith("-") else f"+ {text}"


def _signed_factor(g) -> str:
    if g == 1:
        return "+ "
    if g == -1:
        return "- "
    return _signed(g)


def _paren_raw(latex: str) -> str:
    return f"\\left({latex}\\right)"


def _finish(steps, val, note="Factored form"):
    """The final answer always comes from sympy.factor on the original, so
    it's correct even if an illustrative step above took a shortcut."""
    result = sympy.factor(val)
    if result == sympy.expand(val) and len(steps) <= 1:
        steps.append(step("This doesn't factor over the integers (it's prime)", tex(result)))
    elif tex(result).replace(" ", "") != steps[-1]["latex"].replace(" ", ""):
        steps.append(step(note, tex(result)))
    return steps, result


# ----------------------------------------------------------- scientific


def scientific_steps(text: str) -> tuple[list[dict], object]:
    text = prep(text).replace(" ", "")
    m = re.fullmatch(r"([-+]?\d*\.?\d+)(?:\*10\^|e|E|x10\^)\(?([-+]?\d+)\)?", text)
    if m:
        coeff, exponent = sympy.Rational(m.group(1)), int(m.group(2))
        value = coeff * sympy.Integer(10) ** exponent
        direction = "right" if exponent > 0 else "left"
        steps = [
            step("Scientific notation", f"{m.group(1)} \\times 10^{{{exponent}}}"),
            step(f"Move the decimal point {abs(exponent)} place{'s' if abs(exponent) != 1 else ''} to the {direction}", _plain_decimal(value)),
        ]
        return steps, value
    value = sympy.Rational(text) if re.fullmatch(r"[-+]?\d*\.?\d+", text) else parse(text)
    f = num(value)
    if f is None or f == 0:
        raise MathInputError("scientific notation needs a nonzero number")
    exponent = math.floor(math.log10(abs(f)))
    coeff = sympy.nsimplify(value / sympy.Integer(10) ** exponent)
    direction = "left" if exponent > 0 else "right"
    coeff_text = _plain_decimal(coeff)
    steps = [
        step("Standard form", _plain_decimal(value)),
        step(
            f"Move the decimal point {abs(exponent)} place{'s' if abs(exponent) != 1 else ''} to the {direction} so exactly one nonzero digit is left of it",
            f"{coeff_text} \\times 10^{{{exponent}}}",
        ),
    ]
    return steps, value


def _plain_decimal(value) -> str:
    text = f"{float(value):.12f}".rstrip("0").rstrip(".")
    if "e" in f"{float(value)}" and abs(float(value)) >= 1:
        text = f"{int(value):,}".replace(",", "{,}")
    return text


# ------------------------------------------------------------------- op


def op_transform(req: dict) -> dict:
    mode = req.get("mode", "simplify")
    text, inline = split_assignments(req.get("expr", ""))
    text = strip_function_label(text)
    vars_ = {**(req.get("vars") or {}), **inline}

    if mode == "scientific":
        steps, value = scientific_steps(text)
        return {"steps": steps, "result_latex": steps[-1]["latex"], "mode": mode}

    if mode == "evaluate":
        scope = build_scope()
        raw = parse(text, scope, evaluate_expr=False)
        values = build_scope(vars_)
        subs = {sym: values[str(sym)] for sym in raw.free_symbols if str(sym) in values and values[str(sym)] != sym}
        missing = sorted(str(s) for s in raw.free_symbols if s not in subs)
        steps = [step("Start", tex(raw, keep_order=True))]
        if subs:
            with no_eval():
                raw = raw.xreplace(subs)
            steps.append(step(
                "Substitute " + ", ".join(f"${tex(k)} = {tex(v)}$" for k, v in sorted(subs.items(), key=lambda kv: str(kv[0]))),
                tex(raw, keep_order=True),
            ))
        if missing:
            raise MathInputError(f"give a value for {', '.join(missing)} — e.g. add “, {missing[0]} = 3” or a Variable block")
        more, value = pemdas_steps(raw)
        steps += more
        result = pretty_number(value)
        if steps[-1]["latex"] != result:
            steps.append(step("Result", result))
        return {"steps": steps, "result_latex": result, "mode": mode}

    scope = build_scope(vars_)
    raw = parse(text, scope, evaluate_expr=False)
    val = parse(text, scope)
    if mode == "expand":
        steps, result = expand_steps(raw, val)
    elif mode == "factor":
        steps, result = factor_steps(val)
    else:
        steps, result = simplify_steps(raw, val)
    result_latex = pretty_number(result) if not result.free_symbols else tex(result)
    return {"steps": steps, "result_latex": result_latex, "mode": mode}
