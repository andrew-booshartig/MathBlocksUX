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


def test_variables_resolve_in_any_order_and_report_loops():
    from mathcore.smartcalc import resolve_variables

    v = resolve_variables([{"name": "d", "latex": "2r"}, {"name": "r", "latex": "4"}, {"name": "a", "latex": "b"}, {"name": "b", "latex": "a"}])
    assert v["d"]["latex"] == "8" and "itself" in v["a"]["error"]


def test_lines_use_variables_and_can_save_them():
    from mathcore.smartcalc import resolve_variables

    plain = {k: x["plain"] for k, x in resolve_variables([{"name": "r", "latex": "4"}, {"name": "rate", "latex": "\\frac{7}{100}"}]).items()}
    assert run("\\pi r^{2}", vars=plain)["result_latex"] == "16 \\pi"
    assert run("100\\cdot rate", vars=plain)["result_latex"] == "7"  # a multi-letter name stays whole
    saved = run("cost=250", vars=plain)
    assert saved["kind"] == "assign" and saved["name"] == "cost"
    assert run("xy=6")["kind"] == "choose"  # two letters: an equation, not a name
    solved = run("2x+r=11", vars=plain)
    assert solved["result_latex"].startswith("x = \\frac{7}{2}") and solved["graph"] == ["y = 2*x + r", "y = 11"]
    assert set(run("100\\cdot rate", vars=plain)["names"]) == {"rate"}


def test_handoffs_fill_in_values_and_frame_the_solution():
    r = run("2x+r=30", vars={"r": "10"})
    assert r["work_latex"] == "2x + 10 = 30"
    w = r["graph_window"]
    assert w["xmin"] < 10 < w["xmax"] and w["ymin"] < 30 < w["ymax"]


def test_variables_console():
    from mathcore.smartcalc import op_smart_console as console

    have = [{"name": "y", "latex": "5"}, {"name": "x", "latex": "7"}]
    saved = console({"text": "area = pi*r**2", "vars": [*have, {"name": "r", "latex": "3"}]})
    assert saved["kind"] == "assign" and saved["name"] == "area" and saved["result_latex"] == "9 \\pi"
    assert console({"text": "d = 2r", "vars": [{"name": "r", "latex": "3"}]})["result_latex"] == "6"
    assert console({"text": "2*y + x", "vars": have})["result_latex"] == "17"
    assert console({"text": "clear"}) == {"kind": "clear"} and console({"text": "del y"}) == {"kind": "delete", "name": "y"}
    with pytest.raises(MathInputError, match="z has no value"):
        console({"text": "z + 1", "vars": have})
