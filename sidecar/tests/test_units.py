"""Numbers with units: typed after a number with a space, cancelling like
factors, converted to add, kept by variables, explained step by step."""

import pytest

from engine import handle
from mathcore.parsing import MathInputError



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


def test_a_conversion_chain_cancels_without_undoing_itself():
    """9 km/h · 1000 m/1 km · 1 h/3600 s: km and h cancel — the steps
    never turn the meters back into kilometers, and end on the answer."""
    r = smart(r"9\,\frac{km}{h}\cdot\frac{1000\,m}{1\,km}\cdot\frac{1\,h}{3600\,s}")
    assert r["result_latex"] == r"\frac{5}{2}\,\frac{\mathrm{m}}{\mathrm{s}}" and r["decimal"] == "2.5 m/s"
    notes = [s["note"] for s in r["steps"]]
    assert not any(n.startswith("Write") for n in notes) and any("cancel" in n for n in notes)
    assert r["steps"][-1]["latex"] == r["result_latex"]


@pytest.mark.parametrize(
    "latex,vars_,result",
    [
        # Dante's coating: mm³ → cm³ is ÷ 1000 (1 cm = 10 mm, cubed), cm² stays
        (r"\frac{c}{a}\to\frac{cm^{3}}{cm^{2}}", {"c": "50*unit_mm**3", "a": "unit_cm**2"}, r"0.05\,\frac{\mathrm{cm}^{3}}{\mathrm{cm}^{2}}"),
        (r"9\,\frac{km}{h}\to\frac{m}{s}", {}, r"2.5\,\frac{\mathrm{m}}{\mathrm{s}}"),
        (r"\frac{900\,km}{r}\to mL", {"r": "25/2*unit_km/unit_L"}, r"72000\,\mathrm{mL}"),
        (r"250\,\frac{m}{min}\rightarrow\frac{m}{s}", {}, r"\frac{25}{6}\,\frac{\mathrm{m}}{\mathrm{s}}"),
    ],
)
def test_arrow_converts_one_fact_at_a_time(latex, vars_, result):
    r = smart(latex, vars=vars_)
    assert r["result_latex"] == result
    assert r["steps"][0]["note"] == "Start" and len(r["steps"]) > 1


def test_a_rate_in_two_units_of_one_kind_keeps_its_shape():
    """50 mm³ per cm² is a rate — not simplified away to 0.05 cm"""
    assert smart(r"\frac{50\,mm^3}{1\,cm^2}")["result_latex"] == r"50\,\frac{\mathrm{mm}^{3}}{\mathrm{cm}^{2}}"


def test_converting_needs_units_of_the_same_kind():
    with pytest.raises(MathInputError, match="plain number"):
        smart(r"9\to m")
    with pytest.raises(MathInputError, match="different things"):
        smart(r"9\,km\to s")


@pytest.mark.parametrize(
    "latex,result",
    [
        # the current density problem: a decimeter is a tenth of a meter
        (r"1\,\frac{A}{dm^2}\to\frac{A}{m^2}", r"100\,\frac{\mathrm{A}}{\mathrm{m}^{2}}"),
        # Ohm's law: 12 V across 4 kΩ is 3 mA
        (r"\frac{12\,V}{4\,kohm}\to mA", r"3\,\mathrm{mA}"),
        (r"\frac{12\,V}{4\,k\Omega}\to mA", r"3\,\mathrm{mA}"),
        # power: volts times amps are watts
        (r"5\,V\cdot2\,A\to W", r"10\,\mathrm{W}"),
        (r"2\,kWh\to MJ", r"7.2\,\mathrm{MJ}"),
        (r"1500\,mAh\cdot3.7\,V\to Wh", r"5.55\,\mathrm{Wh}"),
        (r"3300\,\mu F\to mF", r"3.3\,\mathrm{mF}"),
    ],
)
def test_electrical_units_and_prefixes(latex, result):
    assert smart(latex)["result_latex"] == result


def test_units_show_as_written_in_a_textbook():
    assert smart(r"3\,uF")["result_latex"] == r"3\,\mu\mathrm{F}"  # typed u, shown µ
    assert smart(r"5\,V\cdot2\,A")["result_latex"] == r"10\,\mathrm{A} \cdot \mathrm{V}"


def test_a_unit_alone_over_the_bar_is_still_a_unit():
    """typing 12 V/4 kohm puts just the V over the bar"""
    assert smart(r"12\,\frac{V}{4\,kohm}\to mA")["result_latex"] == r"3\,\mathrm{mA}"


@pytest.mark.parametrize(
    "latex,result",
    [
        # the amusement park ride: per minute² → per second² is ÷ 60²
        (r"2160\,\frac{deg}{min^2}\to\frac{deg}{s^2}", r"0.6\,\frac{\text{°}}{\mathrm{s}^{2}}"),
        (r"90\,deg\to rad", r"\frac{\pi}{2}\,\mathrm{rad}"),
        (r"\pi\,rad\to deg", r"180\,\text{°}"),
        (r"100\,degC\to degF", r"212\,\text{°F}"),
        (r"1\,MiB\to kB", r"1048.576\,\mathrm{kB}"),
        (r"1\,atm\to kPa", r"101.325\,\mathrm{kPa}"),
    ],
)
def test_more_kinds_of_units(latex, result):
    assert smart(latex)["result_latex"] == result
