"""Break an equation into movable terms for the Balance block: each side is
expanded into coefficient × monomial tiles (3x, -7y, 4xy, 9). The frontend
does the moving/combining itself with exact fractions; this only parses."""

import sympy

from .parsing import EQUALS, MathInputError, build_scope, parse, prep, tex


def _terms(expr):
    out = []
    expanded = sympy.expand(expr)
    if expanded == 0:
        return out
    syms = sorted(expanded.free_symbols, key=str)
    terms = sympy.Add.make_args(expanded)
    if syms:
        terms = sorted(terms, key=lambda t: (-sympy.Poly(t, *syms).total_degree() if t.free_symbols else 1, str(t)))
    for term in terms:
        coef, mono = term.as_coeff_Mul()
        if not coef.is_Rational:
            raise MathInputError("the Balance block works with whole-number and fraction coefficients")
        if mono.free_symbols and not mono.is_polynomial(*mono.free_symbols):
            raise MathInputError("the Balance block handles polynomial terms (no variables in denominators or roots)")
        out.append({
            "coef": f"{coef.p}/{coef.q}",
            "mono": "1" if mono == 1 else str(mono),
            "mono_latex": "" if mono == 1 else tex(mono),
        })
    return out


def _has_grouping(raw) -> bool:
    """Parentheses that expanding will remove: 2(x + 3), (x + 1)^2."""
    return any(any(a.is_Add for a in m.args) for m in raw.atoms(sympy.Mul)) or any(p.base.is_Add for p in raw.atoms(sympy.Pow))


def op_balance(req: dict) -> dict:
    text = prep(req.get("expr", ""))
    parts = EQUALS.split(text)
    if len(parts) != 2:
        raise MathInputError("type an equation with one = sign, like 3x + 7y = 9x")
    scope = build_scope()  # symbolic on purpose — this block is about moving letters around
    lhs_raw, rhs_raw = parse(parts[0], scope, evaluate_expr=False), parse(parts[1], scope, evaluate_expr=False)
    lhs, rhs = parse(parts[0], scope), parse(parts[1], scope)
    symbols = sorted({str(s) for s in (lhs.free_symbols | rhs.free_symbols)})
    return {
        "lhs": _terms(lhs),
        "rhs": _terms(rhs),
        "symbols": symbols,
        "start_latex": f"{tex(lhs_raw, keep_order=True)} = {tex(rhs_raw, keep_order=True)}",
        "expanded": _has_grouping(lhs_raw) or _has_grouping(rhs_raw),
    }
