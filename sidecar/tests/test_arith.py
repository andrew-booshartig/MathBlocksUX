"""Arithmetic worked by hand: fractions the way a class does them."""

import pytest

from engine import handle
from mathcore import lang
from mathcore.arith import arithmetic_steps


def steps(latex):
    worked = arithmetic_steps(lang.to_sympy(lang.parse(latex, "latex"), evaluate=False))
    return [(note, shown) for note, shown in worked] if worked else None


def test_dividing_by_a_fraction_multiplies_by_its_reciprocal():
    s = steps(r"-\frac{11}{\frac{11}{4}}")
    assert s[0] == ("Start", r"-\frac{11}{\frac{11}{4}}")  # as typed, the sign out front
    assert "reciprocal" in s[1][0] and s[1][1] == r"-11 \cdot \frac{4}{11}"
    assert s[2][0].startswith("Multiply the tops and the bottoms") and s[2][1] == r"-\frac{44}{11}"
    assert s[-1][1] == "-4"


def test_adding_fractions_finds_a_common_denominator():
    s = steps(r"\frac{5}{6}-\frac{1}{3}")
    assert s[1] == ("Common denominator $6$: rewrite each part over $6$", r"\frac{5}{6} - \frac{2}{6}")
    assert s[2][0].startswith("Subtract the tops") and s[2][1] == r"\frac{3}{6}"
    assert s[3][0].startswith("Simplify") and s[3][1] == r"\frac{1}{2}"


@pytest.mark.parametrize("latex, value", [(r"2+3\cdot4", "14"), (r"\frac{3}{4}\div\frac{2}{5}", r"\frac{15}{8}"), (r"\left(\frac{2}{3}\right)^2", r"\frac{4}{9}"), (r"2-\frac{3}{4}", r"\frac{5}{4}")])
def test_order_of_operations_lands_on_the_answer(latex, value):
    assert steps(latex)[-1][1] == value


def test_not_arithmetic_or_nothing_to_do():
    assert steps("5") is None and steps(r"\frac{11}{4}") is None and steps("2x+3") is None


def test_equations_work_a_number_side_by_hand_first():
    r = handle({"op": "smart", "latex": r"-\frac{11}{\frac{11}{4}}=s"})
    notes = [s["note"] for s in r["steps"]]
    assert any("reciprocal" in n for n in notes) and notes.index(next(n for n in notes if "reciprocal" in n)) < notes.index(next(n for n in notes if n.startswith("Swap")))
    assert r["steps"][0]["latex"] == r"-\frac{11}{\frac{11}{4}} = s"  # not 11 · 1/4


def test_calculator_arithmetic_has_steps_and_show_work():
    r = handle({"op": "smart", "latex": r"\frac{3}{4}\div\frac{2}{5}"})
    assert r["work"] and any("reciprocal" in s["note"] for s in r["steps"])
    assert "work" not in handle({"op": "smart", "latex": "2+3"})  # one plain move: just the answer
    assert "steps" in handle({"op": "smart", "latex": r"\frac{80}{75}"})  # a simplification is worth seeing
    assert "steps" not in handle({"op": "smart", "latex": "1.5+2.25"})  # decimals aren't turned into fractions
