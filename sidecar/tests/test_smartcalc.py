"""The smart calculator: numbers → a value, one letter → simplify or solve,
several letters → ask."""

import pytest

from mathcore.parsing import MathInputError
from mathcore.smartcalc import op_smart


def run(latex, **kw):
    return op_smart({"latex": latex, **kw})


def test_numbers_give_exact_and_decimal():
    r = run("\\frac{3}{4}+1")
    assert r["kind"] == "value" and r["result_latex"] == "\\frac{7}{4}" and r["decimal"] == "1.75"
    assert run("2+3")["decimal"] is None  # nothing to add when exact is already a plain number


def test_one_letter_simplifies_or_solves():
    assert run("3\\left(x+1\\right)-2x")["result_latex"] == "x + 3"
    assert run("2x+3=11")["result_latex"] == "x = 4"
    assert run("3x+5=3x+2")["result_latex"] == "\\text{no solution}"
    assert run("2x+1<7")["result_latex"] == "x < 3"


def test_several_letters_ask_then_do_what_was_picked():
    ask = run("\\frac{x}{2}+\\frac{y}{3}=1")
    assert ask["kind"] == "choose" and [c["label"] for c in ask["choices"]] == ["Solve for x", "Solve for y"]
    done = run("\\frac{x}{2}+\\frac{y}{3}=1", action=ask["choices"][1])
    assert done["result_latex"].startswith("y =") and [o["label"] for o in done["others"]] == ["Solve for x"]
    assert [c["label"] for c in run("3x+2y-x")["choices"]] == ["Simplify", "Expand", "Factor"]


def test_ans_and_half_typed():
    first = run("\\frac{3}{4}+1")
    assert run("\\mathrm{Ans}\\cdot 2", ans=first["ans"])["result_latex"] == "\\frac{7}{2}"
    assert run("\\mathrm{Ans}^{2}", ans=run("\\sqrt{8}")["ans"])["result_latex"] == "8"
    with pytest.raises(MathInputError):
        run("\\frac{3}{")
