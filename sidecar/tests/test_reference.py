"""The reference sheet: facts, and conversions as calculator lines."""

import pytest

from mathcore.parsing import MathInputError
from mathcore.reference import op_reference, op_refconvert


def lines(amount, a, b):
    out = op_refconvert({"amount": amount, "from": a, "to": b})
    return [(line["latex"], line["result"]["text"], line["label"]) for line in out["lines"]], out


def test_km_per_hour_to_meters_per_second_one_fact_at_a_time():
    got, out = lines("9", "km/h", "m/s")
    assert got == [
        ("9 \\times 1000", "9000", "meters per hour"),
        ("\\mathrm{Ans} \\div 60", "150", "meters per minute"),
        ("\\mathrm{Ans} \\div 60", "2.5", "meters per second"),
    ]
    assert out["one_line"] == "9 \\times 1000 \\div 60 \\div 60"
    assert out["to"]["amount"]["text"] == "2.5"


def test_answers_stay_exact():
    got, out = lines("250", "m/min", "m/s")
    assert got[-1][1] == "25/6"
    assert out["to"]["amount"]["approx"] == "4.16667"


def test_facts_are_written_the_way_they_are_defined():
    _, out = lines("5", "kg", "lb")
    assert out["lines"][0]["why"].startswith("1 lb = 0.45359237 kg")
    assert out["lines"][0]["latex"] == "5 \\div 0.45359237"


@pytest.mark.parametrize(
    "amount,a,b,result,label",
    [
        ("3 3/8", "in", "mm", "85.725", "millimeters"),
        ("2", "ft^2", "in^2", "288", "square inches"),
        ("1", "gallons", "cups", "16", "cups"),
        ("60", "mph", "km/h", "96.56064", "kilometers per hour"),
        ("1", "yr", "s", "31557600", "seconds"),
    ],
)
def test_conversions(amount, a, b, result, label):
    _, out = lines(amount, a, b)
    assert (out["to"]["amount"]["text"], out["to"]["label"]) == (result, label)


def test_different_kinds_dont_convert():
    with pytest.raises(MathInputError, match="measure different things"):
        op_refconvert({"amount": "9", "from": "km", "to": "s"})


def test_the_sheet_lists_each_kinds_facts():
    sheet = op_reference({})
    time = next(k for k in sheet["kinds"] if k["kind"] == "time")
    assert "1 h = 60 min" in [f["text"] for f in time["facts"]]
    assert {"from": "km/h", "to": "m/s"} in sheet["popular"]


def test_prefixes_and_relations():
    _, out = lines("250", "mA", "A")
    assert out["to"]["amount"]["text"] == "0.25"
    _, out = lines("5", "V*A", "W")
    assert out["to"]["amount"]["text"] == "5" and "voltage × current" in out["lines"][0]["why"]
    with pytest.raises(MathInputError, match="measure different things"):
        op_refconvert({"amount": "12", "from": "V", "to": "A"})
    sheet = op_reference({})
    assert {"current", "voltage", "resistance", "power"} <= {k["kind"] for k in sheet["kinds"]}
    assert any(r["text"] == "1 V = 1 A·Ω" for r in sheet["relations"])
