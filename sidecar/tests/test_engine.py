"""Smoke + correctness checks across the op families."""

import pytest

from engine import handle
from mathcore.parsing import MathInputError


@pytest.mark.parametrize("expr,mode,result", [
    ("2 + 3(4-1)^2", "evaluate", "29"),
    ("3(x+2) - x", "simplify", "2 x + 6"),
    ("(x+3)(x-2)", "expand", "x^{2} + x - 6"),
    ("6x^2 - 7x - 3", "factor", "\\left(2 x - 3\\right) \\left(3 x + 1\\right)"),
    ("x^2 - 9", "factor", "\\left(x - 3\\right) \\left(x + 3\\right)"),
    ("sqrt(72)", "simplify", "6 \\sqrt{2} \\approx 8.4853"),
])
def test_transform(expr, mode, result):
    assert handle({"op": "transform", "mode": mode, "expr": expr})["result_latex"] == result


@pytest.mark.parametrize("expr,expected", [
    ("2x + 3 = 11", "x = 4"),
    ("x^2 = 25", "x = -5"),
    ("|x - 3| = 5", "x = -2"),
    ("-2x + 1 > 7", "x < -3"),
    ("2x + y = 7\nx - y = 2", "3"),
])
def test_solve(expr, expected):
    assert expected in handle({"op": "solve", "expr": expr})["solution_latex"]


def test_graph_markers():
    r = handle({"op": "graph", "exprs": ["y = x^2 - 4", "y = 2x - 1"]})
    kinds = {m["kind"] for m in r["markers"]}
    assert {"x-intercept", "y-intercept", "vertex", "intersection"} <= kinds
    assert all(s["kind"] == "function" for s in r["series"])


def test_graph_bad_line_is_isolated():
    r = handle({"op": "graph", "exprs": ["y = 2x", "y = (("]})
    assert r["series"][0]["kind"] == "function" and r["series"][1]["kind"] == "error"


def test_table_patterns():
    assert "linear" in handle({"op": "table", "expr": "y = 3x - 2"})["pattern"]
    assert "quadratic" in handle({"op": "table", "expr": "x^2 + 1"})["pattern"]
    assert "exponential" in handle({"op": "table", "expr": "2^x", "start": 0, "end": 5})["pattern"]


def test_line_and_quadratic():
    assert handle({"op": "line", "mode": "points", "p1": "(1, 2)", "p2": "(3, 8)"})["slope_intercept"] == "y = 3 x - 1"
    q = handle({"op": "quadratic", "expr": "x^2 - 4x + 3"})
    assert q["vertex"] == [2.0, -1.0] and q["roots"] == [1.0, 3.0]


def test_sequence_stats():
    assert handle({"op": "sequence", "terms": "2, 6, 18"})["kind"] == "geometric"
    assert handle({"op": "stats", "data": "1 2 3 4 5 6 100"})["outliers"] == ["100"]


def test_unknown_op():
    with pytest.raises(MathInputError):
        handle({"op": "nope"})


def test_balance_terms():
    r = handle({"op": "balance", "expr": "2(x + 3y) - 4 = 5y"})
    assert [(t["coef"], t["mono"]) for t in r["lhs"]] == [("2/1", "x"), ("6/1", "y"), ("-4/1", "1")]
    assert r["rhs"] == [{"coef": "5/1", "mono": "y", "mono_latex": "y"}]
    assert r["symbols"] == ["x", "y"] and r["expanded"]


@pytest.mark.parametrize("typed,meaning", [
    ("1/4s", "s/4"),
    ("2x/3y", "2*x*y/3"),
    ("a + b / c", "a + b/c"),
    ("5/9(F-32)", "5*(F-32)/9"),
])
def test_usual_order_of_operations(typed, meaning):
    import sympy
    from mathcore.parsing import parse
    assert sympy.simplify(parse(typed) - sympy.sympify(meaning, locals={"F": sympy.Symbol("F")})) == 0
