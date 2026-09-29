"""The TI-85-style home screen: its order of operations, display and errors."""

import pytest

from engine import handle


def ti(entry, **kw):
    return handle({"op": "ti", "entry": entry, **kw})["result"]


@pytest.mark.parametrize("entry,shown", [
    ("2+3*4", "14"),
    ("2^3^2", "64"),                 # powers go left to right
    ("⁻2²", "⁻4"),                   # x² before negation
    ("√⁻4", "(0,2)"),                # complex answers as pairs
    ("√2", "1.41421356237"),         # 12 digits
    ("1/3", "0.333333333333"),
    ("123456789*987654321", "1.21932631113E17"),
    ("0.0001", "1E⁻4"),
    ("2ᴇ⁻4", "2E⁻4"),
    ("5!", "120"),
    ("5 nCr 2", "10"),
    ("5 nPr 2", "20"),
    ("3x√8", "2"),
    ("⁻8^(1/3)", "⁻2"),
    ("10^2", "100"),
    ("ℯ^1", "2.71828182846"),
    (".75►Frac", "3/4"),
    ("round(π,4)", "3.1416"),
    ("iPart 2.7", "2"),
    ("int ⁻2.5", "⁻3"),
    ("2<3", "1"),
    ("(2+3", "5"),                   # a missing ) at the end is fine
    ("2(3+4)", "14"),
    ("50%", "0.5"),
    ("lcm(4,6)", "12"),
    ("abs ⁻5", "5"),
])
def test_home_screen(entry, shown):
    assert ti(entry) == shown


def test_implied_multiplication_binds_tighter():
    assert ti("1/2x", vars={"x": "4"}) == "0.125"
    assert ti("1/2*x", vars={"x": "4"}) == "2"


def test_angle_modes():
    assert ti("sin 30", mode={"angle": "deg"}) == "0.5"
    assert ti("sin⁻¹ .5", mode={"angle": "deg"}) == "30"
    assert ti("sin 180", mode={"angle": "deg"}) == "0"
    assert ti("cos π") == "⁻1"
    assert ti("sin 30°") == "0.5"                          # ° works in radian mode
    assert ti("cos (πʳ)", mode={"angle": "deg"}) == "⁻1"   # ʳ works in degree mode


def test_display_modes():
    assert ti("1/3", mode={"format": "sci"}) == "3.33333333333E⁻1"
    assert ti("12345", mode={"format": "eng"}) == "12.345E3"
    assert ti("1/3", mode={"digits": 2}) == "0.33"


def test_ans_and_store():
    assert ti("Ans+1", ans="(41+0j)") == "42"
    r = handle({"op": "ti", "entry": "5→A"})
    assert r["store"] == "A" and r["result"] == "5"
    assert ti("A*2", vars={"A": r["value"]}) == "10"


@pytest.mark.parametrize("entry,error", [
    ("1/0", "ERROR 02 DIV BY ZERO"),
    ("ln 0", "ERROR 04 DOMAIN"),
    ("3+", "ERROR 07 SYNTAX"),
    ("Q*2", "ERROR 14 UNDEFINED"),
])
def test_errors(entry, error):
    with pytest.raises(Exception, match=error):
        ti(entry)


def test_fraction_answers():
    assert ti("1/3+1/6", frac_auto=True) == "1/2"
    assert ti("(1)/(4)+(3)/(4)", frac_auto=True) == "1"
    assert ti("√2", frac_auto=True) == "1.41421356237"   # no clean fraction → decimal
    assert ti("Ans►Frac", ans="(0.625+0j)") == "5/8"


def test_fraction_key_is_one_unit():
    # the fraction key's fraction is sealed: what follows multiplies it
    assert ti("⁽(3)/(4)⁾5") == "3.75"
    assert ti("2⁽(1)/(2)⁾") == "1"
    # a typed / keeps TI-85 precedence: implied multiplication first
    assert ti("(3)/(4)5") == "0.15"
