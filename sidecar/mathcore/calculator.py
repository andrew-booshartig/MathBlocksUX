"""The scientific calculator's engine: evaluates what's typed on the keys
(3×(2+1)÷4, sin(30), 5!, 2.5E3, √(8), Ans×2 …) and returns both the exact
answer (2√2, 1/2) and the decimal, like an S⇔D key.

Angle mode matters only here: in degrees, sin(30) = 1/2 and asin(1/2) = 30."""

import re

import sympy
from sympy import E, pi

from . import units
from . import units
from .parsing import MathInputError, TRANSFORMS, _drop_unit_factors, build_scope, prep, tex
from sympy.parsing.sympy_parser import parse_expr, rationalize

# the display keeps decimals as typed (no 0.1 → 1/10)
_DISPLAY_TRANSFORMS = tuple(t for t in TRANSFORMS if t is not rationalize)

_DEG = pi / 180


def _functions(angle: str) -> dict:
    deg = angle == "deg"
    to_rad = (lambda x: x * _DEG) if deg else (lambda x: x)
    from_rad = (lambda x: x / _DEG) if deg else (lambda x: x)
    return {
        "sin": lambda x: sympy.sin(to_rad(x)),
        "cos": lambda x: sympy.cos(to_rad(x)),
        "tan": lambda x: sympy.tan(to_rad(x)),
        "asin": lambda x: from_rad(sympy.asin(x)),
        "acos": lambda x: from_rad(sympy.acos(x)),
        "atan": lambda x: from_rad(sympy.atan(x)),
        "ln": sympy.log,
        "log": lambda x, base=10: sympy.log(x, base),
        "sqrt": sympy.sqrt,
        "cbrt": lambda x: sympy.real_root(x, 3),
        "root": lambda x, n: sympy.real_root(x, n),
        "abs": sympy.Abs,
        "nCr": sympy.binomial,
        "nPr": lambda n, r: sympy.ff(n, r),
        "e": E,
        "pi": pi,
    }


# for the pretty display only: plain function objects, so nothing evaluates
_DISPLAY = {
    "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan, "asin": sympy.asin, "acos": sympy.acos, "atan": sympy.atan,
    "ln": sympy.Function("ln"), "log": sympy.Function("log"), "sqrt": sympy.sqrt,
    # evaluate=False parsing passes evaluate= to every call, so these take **_
    "cbrt": lambda x, **_: sympy.Pow(x, sympy.Rational(1, 3), evaluate=False),
    "root": lambda x, n, **_: sympy.Pow(x, sympy.Pow(n, -1, evaluate=False), evaluate=False),
    "abs": sympy.Abs, "nCr": lambda n, r, **_: sympy.binomial(n, r, evaluate=False), "nPr": sympy.Function("nPr"),
    "e": E, "pi": pi, "PCT": sympy.Symbol("PCT"), "ANS": sympy.Symbol("\\mathrm{Ans}"),
}

_INVERSE_TRIG = {"asin": "\\sin^{-1}", "acos": "\\cos^{-1}", "atan": "\\tan^{-1}"}


def _display_latex(text: str, base: dict) -> str | None:
    shown_text = re.sub(r"(\d+(?:\.\d+)?)\s*%", r"(\1*PCT)", text)
    try:
        shown = parse_expr(shown_text, local_dict={**base, **_DISPLAY}, transformations=_DISPLAY_TRANSFORMS, evaluate=False)
    except Exception:
        return None
    # calculators show × between numbers (√2 × √8, not √2 √8)
    latex = sympy.latex(_drop_unit_factors(shown), order="none", mul_symbol="times")
    for name, pretty in _INVERSE_TRIG.items():
        latex = latex.replace(f"\\operatorname{{{name}}}", pretty)
    return re.sub(r"\s*\\times\s*PCT|\s*PCT", "\\%", latex)


def _prep(text: str, ans: str | None) -> str:
    text = prep(text)
    text = re.sub(r"\bAns\b", "ANS", text)
    text = re.sub(r"(\d(?:\.\d*)?)\s*E\s*([-+]?\d+)", r"(\1*10^(\2))", text)  # 2.5E3
    # typing ahead of closing brackets is normal on a calculator: close them
    missing = text.count("(") - text.count(")")
    return text + ")" * max(missing, 0)


def _fmt_decimal(value: float) -> str:
    if value == 0:
        return "0"
    if abs(value) >= 1e10 or abs(value) < 1e-6:
        mantissa, exponent = f"{value:.9e}".split("e")
        mantissa = mantissa.rstrip("0").rstrip(".")
        return f"{mantissa} \\times 10^{{{int(exponent)}}}"
    text = f"{value:.10g}"
    return text


def _quantity(value, input_latex) -> dict:
    """A value with units: exact, and as a decimal (with its units) when
    the number isn't whole — 50 m; 5/4 m ≈ 1.25 m."""
    terms = sympy.Add.make_args(value)
    exact = sympy.Add(*[sympy.nsimplify(t) if t.has(sympy.Float) else t for t in terms])
    exact_latex = tex(exact)
    number, unit_part = units.split(exact) if len(terms) == 1 else (None, None)
    decimal = None
    if number is not None and number.is_number and not number.is_Integer:
        decimal = f"{_fmt_decimal(float(number))} {units.plain(unit_part)}"  # plain text, beside the exact answer
    return {
        "input_latex": input_latex,
        "exact_latex": exact_latex,
        "decimal": decimal or exact_latex,
        "exact_plain": str(exact),
        "decimal_plain": str(exact),
        "exact_differs": decimal is not None,
    }


def op_calc(req: dict) -> dict:
    raw = (req.get("expr") or "").strip()
    if not raw:
        raise MathInputError("")
    text = _prep(raw, req.get("ans"))
    angle = req.get("angle", "deg")
    base = build_scope(req.get("vars") or {})
    input_latex = _display_latex(text, base)
    # Ans is the previous answer, exact (2*sqrt(2), not 2.8284…)
    ans = req.get("ans")
    text = text.replace("ANS", f"({ans})" if ans else "0")
    text = re.sub(r"(\d+(?:\.\d+)?)\s*%", r"(\1/100)", text)
    try:
        value = parse_expr(text, local_dict={**base, **_functions(angle)}, transformations=TRANSFORMS)
    except ZeroDivisionError:
        raise MathInputError("Math error: division by zero")
    except Exception as exc:
        raise MathInputError("Syntax error — check the brackets and operators") from exc
    if not isinstance(value, sympy.Basic):
        value = sympy.sympify(value)
    if units.without_units(value.free_symbols):
        names = ", ".join(sorted(map(str, units.without_units(value.free_symbols))))
        raise MathInputError(f"{names} has no value — give it one in a Variable block")
    if units.has_units(value):
        return _quantity(units.normalize(value), input_latex)
    exact = sympy.nsimplify(value) if value.is_Float else sympy.simplify(value)
    if exact.has(sympy.zoo, sympy.oo, -sympy.oo, sympy.nan):
        raise MathInputError("Math error: division by zero")
    numeric = complex(sympy.N(exact, 15))
    if abs(numeric.imag) > 1e-12:
        raise MathInputError(f"Not a real number (it's ${tex(exact)}$)")
    decimal = _fmt_decimal(numeric.real)
    exact_latex = tex(exact)
    return {
        "input_latex": input_latex,
        "exact_latex": exact_latex,
        "decimal": decimal,
        "exact_plain": str(exact),
        "decimal_plain": repr(numeric.real) if abs(numeric.real - round(numeric.real)) > 1e-12 else str(int(round(numeric.real))),
        "exact_differs": exact_latex.replace(" ", "") != decimal.replace(" ", ""),
    }
