import pytest

from engine import handle


def check(kind, answer, response, **kw):
    return handle({"op": "check", "kind": kind, "answer": answer, "response": response, **kw})


@pytest.mark.parametrize("kind,answer,response,ok", [
    ("solutions", ["3", "-2"], "x = 3 or x = -2", True),
    ("solutions", ["3", "-2"], "-2, 3", True),
    ("solutions", ["4", "-4"], "x = ±4", True),
    ("solutions", ["3", "-2"], "3", False),
    ("solutions", [], "no solution", True),
    ("solutions", ["2 - sqrt(6)/2", "2 + sqrt(6)/2"], "0.78, 3.22", True),
    ("solutions", ["1/3"], "0.33", True),
    ("solutions", ["1/3"], "0.4", False),
    ("value", "7/2", "3.5", True),
    ("value", "7/2", "7/2", True),
    ("inequality", "x > 2", "2 < x", True),
    ("inequality", "x > 2", "x ≥ 2", False),
    ("inequality", "-2 < x <= 5", "(-2, 5]", True),
    ("inequality", "-2 < x <= 5", "x > -2 and x <= 5", True),
    ("inequality", "x < -1 or x > 4", "x<-1 or x>4", True),
    ("inequality", "x <= 3", "(-inf, 3]", True),
    ("factored", "2*(x - 2)*(x + 2)", "2(x-2)(x+2)", True),
    ("factored", "2*(x - 2)*(x + 2)", "2(x^2-4)", False),
    ("factored", "2*(x - 2)*(x + 2)", "(2x-4)(x+2)", False),
    ("factored", "(x - 5)*(x + 7)", "(x+7)(x-5)", True),
    ("simplified", "2*x + 6", "6 + 2x", True),
    ("simplified", "2*x + 6", "2(x+3)", False),
    ("simplified", "2*x + 6", "3x + 6 - x", False),
    ("point", "(3, -2)", "(3,-2)", True),
    ("point", "(3, -2)", "x = 3, y = -2", True),
    ("point", "(3, -2)", "(-2, 3)", False),
    ("line", "y = 2*x - 1", "y = 2x - 1", True),
    ("line", "y = 2*x - 1", "2x - y = 1", True),
    ("line", "y = 2*x - 1", "y = 2x + 1", False),
    ("scientific", "32000", "3.2 x 10^4", True),
    ("scientific", "32000", "3.2e4", True),
    ("scientific", "32000", "32 x 10^3", False),
    ("scientific", "3/10000", "3 × 10^-4", True),
    ("radical", "6*sqrt(2)", "6√2", True),
    ("radical", "6*sqrt(2)", "3√8", False),
    ("power", "6*x**5", "6x^5", True),
    ("power", "(1)/(x**2)", "1/x^2", True),
    ("power", "(1)/(x**2)", "x^-2", False),
])
def test_check(kind, answer, response, ok):
    assert check(kind, answer, response)["correct"] is ok


def test_literal():
    assert check("literal", ["A/l"], "w = A/l", target="w")["correct"]
    assert check("literal", ["(F - 32)*5/9"], "C = 5/9(F-32)", target="C")["correct"]


def test_flip_feedback():
    r = check("inequality", "x < -3", "x > -3")
    assert not r["correct"] and "opposite" in r["feedback"]
