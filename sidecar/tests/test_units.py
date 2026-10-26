"""Numbers with units: typed after a number with a space, cancelling like
factors, converted to add, kept by variables, explained step by step."""

import pytest

from engine import handle
from mathcore.parsing import MathInputError

import pytest

# units are off for now (units.ENABLED) — kept for the reference sheet
pytestmark = pytest.mark.skipif(not __import__("mathcore.units", fromlist=["ENABLED"]).ENABLED, reason="units are off")


def smart(latex, **req):
    return handle({"op": "smart", "latex": latex, **req})


def test_a_space_makes_a_unit_no_space_is_a_letter():
    assert smart(r"5\,m")["result_latex"] == r"5\,\mathrm{m}"
    assert smart(r"5\,x")["kind"] != "value"  # x isn't a unit: 5x
    assert smart("5m")["kind"] != "value"  # no space: 5 times m


@pytest.mark.parametrize(
    "typed, result",
    [
        (r"5\,\frac{m}{s}\cdot10\,s", r"50\,\mathrm{m}"),  # s cancels
        (r"2\,m\cdot3\,m", r"6\,\mathrm{m}^{2}"),
        (r"60\,\frac{mi}{h}\cdot30\,min", r"30\,\mathrm{mi}"),  # minutes made hours, then they cancel
        (r"5\,m+20\,cm", r"\frac{26}{5}\,\mathrm{m}"),  # in the bigger unit
        (r"12\,ft\div2", r"6\,\mathrm{ft}"),
    ],
)
def test_units_multiply_cancel_and_add(typed, result):
    assert smart(typed)["result_latex"] == result


def test_unlike_kinds_dont_add():
    with pytest.raises(MathInputError, match="different kinds"):
        smart(r"5\,m+3\,s")
    with pytest.raises(MathInputError, match="no unit"):
        smart(r"5\,m+3")


def test_variables_keep_their_units():
    r = smart(r"r=5\,\frac{m}{s}")
    t = smart(r"t=10\,s")
    values = handle({"op": "smartvars", "vars": [{"name": "r", "latex": r["value_latex"]}, {"name": "t", "latex": t["value_latex"]}]})["values"]
    d = smart(r"d=r\cdot t", vars={n: v["plain"] for n, v in values.items()})
    assert d["result_latex"] == r"d = 50\,\mathrm{m}"
    notes = [s["note"] for s in d["steps"]]
    assert notes[0] == "Put in the values" and any("cancel" in n for n in notes)
    assert d["steps"][0]["latex"] == r"\left(5\,\frac{\mathrm{m}}{\mathrm{s}}\right) \cdot \left(10\,\mathrm{s}\right)"


def test_solving_with_units():
    assert smart(r"5\,\frac{m}{s}\cdot x=50\,m")["result_latex"] == r"x = 10\,\mathrm{s}"


def test_steps_cross_out_what_cancels():
    steps = smart(r"5\,\frac{m}{s}\cdot10\,s")["steps"]
    assert any(r"\cancel{\mathrm{s}}" in s["latex"] for s in steps)
    assert steps[-1]["latex"] == r"50\,\mathrm{m}"


def test_the_library():
    kinds = {k["kind"]: k for k in handle({"op": "units"})["kinds"]}
    assert {"length", "time", "mass", "volume", "speed"} <= set(kinds)
    inch = next(u for u in kinds["length"]["units"] if u["symbol"] == "in")
    assert inch["name"] == "inch" and inch["size_decimal"] == 0.0254  # exact by definition


def test_a_conversion_chain_cancels_without_undoing_itself():
    """9 km/h · 1000 m/1 km · 1 h/3600 s: km and h cancel — the steps
    never turn the meters back into kilometers, and end on the answer."""
    r = smart(r"9\,\frac{km}{h}\cdot\frac{1000\,m}{1\,km}\cdot\frac{1\,h}{3600\,s}")
    assert r["result_latex"] == r"\frac{5}{2}\,\frac{\mathrm{m}}{\mathrm{s}}" and r["decimal"] == "2.5 m/s"
    notes = [s["note"] for s in r["steps"]]
    assert not any(n.startswith("Write") for n in notes) and any("cancel" in n for n in notes)
    assert r["steps"][-1]["latex"] == r["result_latex"]
