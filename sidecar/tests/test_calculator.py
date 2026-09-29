import pytest

from engine import handle
from mathcore.parsing import MathInputError


@pytest.mark.parametrize("expr,extra,exact,decimal", [
    ("3×(2+1)÷4", {}, "\\frac{9}{4}", "2.25"),
    ("sin(30)", {}, "\\frac{1}{2}", "0.5"),
    ("asin(1/2)", {}, "30", "30"),
    ("√(8)", {}, "2 \\sqrt{2}", "2.828427125"),
    ("5!", {}, "120", "120"),
    ("2.5E3", {}, "2500", "2500"),
    ("50%×80", {}, "40", "40"),
    ("0.1+0.2", {}, "\\frac{3}{10}", "0.3"),
    ("cbrt(-27)", {}, "-3", "-3"),
    ("Ans×2", {"ans": "2*sqrt(2)"}, "4 \\sqrt{2}", "5.656854249"),
    ("a×2", {"vars": {"a": "4"}}, "8", "8"),
])
def test_calc(expr, extra, exact, decimal):
    r = handle({"op": "calc", "expr": expr, **extra})
    assert r["exact_latex"] == exact and r["decimal"] == decimal


def test_radians():
    assert handle({"op": "calc", "expr": "cos(pi)", "angle": "rad"})["exact_latex"] == "-1"


@pytest.mark.parametrize("expr,message", [("1/0", "division by zero"), ("√(-4)", "Not a real number")])
def test_math_errors(expr, message):
    with pytest.raises(MathInputError, match=message):
        handle({"op": "calc", "expr": expr})
