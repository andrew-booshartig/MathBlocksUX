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
    assert solved["result_latex"].startswith("x = \\frac{7}{2}")
    assert set(run("100\\cdot rate", vars=plain)["names"]) == {"rate"}


def test_work_handoff_fills_in_values():
    r = run("2x+r=30", vars={"r": "10"})
    assert r["work_latex"] == "2x + 10 = 30" and "graph" not in r


def test_variables_console():
    from mathcore.smartcalc import op_smart_console as console

    have = [{"name": "y", "latex": "5"}, {"name": "x", "latex": "7"}]
    saved = console({"latex": "area=\\pi r^2", "items": [*have, {"name": "r", "latex": "3"}]})
    assert saved["kind"] == "assign" and saved["name"] == "area" and saved["result_latex"] == "9 \\pi"
    assert console({"latex": "d=2r", "items": [{"name": "r", "latex": "3"}]})["result_latex"] == "6"
    assert console({"latex": "2y+x", "items": have})["result_latex"] == "17"


def test_functions():
    from mathcore.smartcalc import op_smart_console as console, resolve_variables

    made = console({"latex": "f\\left(x\\right)=x^2+1"})
    assert made["kind"] == "assign" and made["params"] == ["x"] and made["result_latex"] == "f(x) = x^{2} + 1"
    items = [{"name": "a", "latex": "2"}, {"name": "f", "latex": "x^{2}+1", "params": ["x"]}, {"name": "g", "latex": "at-1", "params": ["t"]}]
    assert console({"latex": "f(2)+g(3)", "items": items})["result_latex"] == "10"
    # functions may use variables and other functions, in any order
    v = resolve_variables([{"name": "g", "latex": "f(x)+a", "params": ["x"]}, {"name": "f", "latex": "x^{2}", "params": ["x"]}, {"name": "a", "latex": "3"}])
    assert v["g"]["plain"] == "x**2 + 3"
    # on the Calculate line: f(3) is a call; f(x) = 10 (f exists) is solved; a new h(x) = … is defined
    vars_ = {"f(x)": "x**2 + 1"}
    assert run("2f(3)", vars=vars_)["result_latex"] == "20"
    assert run("f(x)=10", vars=vars_)["result_latex"].startswith("x = -3")
    assert run("h(x)=3x", vars=vars_)["kind"] == "assign"
    # one input for now: g(a, b) = … says so plainly
    with pytest.raises(MathInputError, match="one input"):
        console({"latex": "g\\left(a,b\\right)=a+b"})


def test_console_fractions():
    from mathcore.smartcalc import op_smart_console as console

    # MathLive writes 7/3 as \frac73 (no braces)
    for typed, plain in [("y=\\frac73", "\\frac{7}{3}"), ("y=\\frac{10}{3}", "\\frac{10}{3}"), ("y=-\\frac{7}{3}", "-\\frac{7}{3}")]:
        made = console({"latex": typed})
        assert made["kind"] == "assign" and made["latex"] == plain and made["error"] is None
    # a mixed number is 2 + ⅓, as on paper
    assert console({"latex": "y=2\\frac13"})["result_latex"] == "\\frac{7}{3}"
    # the space key types \, — "2 1/3" is 2⅓, and "area = 5" still names a variable
    assert console({"latex": "y=2\\,\\frac13"})["result_latex"] == "\\frac{7}{3}"
    assert console({"latex": "area\\,=\\,5"})["name"] == "area"
    items = [{"name": "y", "latex": "\\frac73"}]
    assert console({"latex": "2y", "items": items})["result_latex"] == "\\frac{14}{3}"


def test_console_commands_from_pretty_math():
    from mathcore.smartcalc import op_smart_console as console

    assert console({"latex": "\\mathrm{del}\\ y"}) == {"kind": "delete", "name": "y"}
    # MathLive turns a typed "del" into ∂
    assert console({"latex": "\\partial y"}) == {"kind": "delete", "name": "y"}
    assert console({"latex": "\\partial\\mathrm{area}"}) == {"kind": "delete", "name": "area"}
    assert console({"latex": "clear"}) == {"kind": "clear"}
    early = console({"latex": "area=\\pi r^2"})
    assert early["kind"] == "assign" and early["error"] == "r has no value"


def test_variables_block_rows_and_the_canvas():
    from mathcore.parsing import build_scope, parse
    from mathcore.smartcalc import op_smart_console as console, resolve_variables

    # the shared pool, in any order: d = 2*r before r = 4, and a function using d
    assert parse("d + f(1)", build_scope({"d": "2*r", "r": "4", "f(x)": "x**2 + d"})) == 17
    # rows from before the console are plain values; they show the way they read
    v = resolve_variables([{"name": "d", "value": "2*r"}, {"name": "r", "value": "4"}])
    assert v["d"]["plain"] == "8" and v["d"]["input_latex"] == "2r"
    # other blocks' variables come in as context; this block's own win
    v = resolve_variables([{"name": "g", "latex": "m+1"}, {"name": "m", "latex": "5"}], {"m": "10", "k": "3"})
    assert v["g"]["plain"] == "6"
    # a console line saves the body as typed, in plain text, for everything else to read
    made = console({"latex": "k=2m+d", "items": [{"name": "d", "value": "2*r"}, {"name": "r", "value": "4"}], "vars": {"m": "10"}})
    assert made["plain"] == "2*m + d" and made["result_latex"] == "28"
    made = console({"latex": "h(x)=f(x)+m", "vars": {"m": "10", "f(x)": "x**2"}})
    assert made["plain"] == "f(x) + m" and made["params"] == ["x"]
    assert console({"latex": "h(2)", "items": [{"name": "h", "latex": made["latex"], "params": ["x"]}], "vars": {"m": "10", "f(x)": "x**2"}})["result_latex"] == "14"


def test_plain_bars_are_absolute_value():
    # typed | is a plain bar in the field (not MathLive's LaTeX mode)
    assert run("|-3|")["result_latex"] == "3"
    assert run("2|x-1|=4")["result_latex"] == "x = -1 \\quad\\text{or}\\quad x = 3"
