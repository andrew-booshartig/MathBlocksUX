"""Converting the student's way: each line the same amount in other units,
checked, with the exact slip named."""

from engine import handle


def lines(start, target, *typed, **req):
    return handle({"op": "convertlines", "from": start, "to": target, "lines": list(typed), **req})


def test_each_line_is_checked_and_a_slip_is_named():
    r = lines(r"9\,\frac{km}{h}", r"\frac{m}{s}", r"9000\,\frac{m}{h}", r"250\,\frac{m}{min}", r"150\,\frac{m}{min}", r"2.5\,\frac{m}{s}")
    status = [l["status"] for l in r["lines"]]
    assert status == ["ok", "wrong", "ok", "ok"]
    assert "km} \\to \\mathrm{m}" in r["lines"][0]["what"] and "1000" in r["lines"][0]["what"]
    assert "150" in r["lines"][1]["message"] and "9000 \\div 60 = 150" in r["lines"][1]["message"]
    assert r["lines"][3]["done"] and "2.5" in r["lines"][3]["done"] and r["solved"]


def test_a_chain_of_conversion_fractions():
    r = lines(r"9\,\frac{km}{h}", r"\frac{m}{s}", r"9\,\frac{km}{h}\cdot\frac{1000\,m}{1\,km}\cdot\frac{1\,h}{3600\,s}")
    line = r["lines"][0]
    assert line["status"] == "ok" and line["done"] and r"\cancel{\mathrm{km}}" in line["crossed_latex"]


def test_units_have_to_stay():
    r = lines(r"9\,\frac{km}{h}", r"\frac{m}{s}", r"9000\,m", "2.5")
    assert [l["status"] for l in r["lines"]] == ["wrong", "wrong"]
    assert "length" in r["lines"][0]["message"] and "no units" in r["lines"][1]["message"]


def test_different_kinds_cant_convert():
    import pytest

    from mathcore.parsing import MathInputError

    with pytest.raises(MathInputError, match="different things"):
        lines(r"9\,\frac{km}{h}", r"m^{2}")


def test_relationships_and_your_own_units():
    facts = [r["fact"] for r in handle({"op": "relations"})["relations"]]
    assert r"1\,\mathrm{km} = 1000\,\mathrm{m}" in facts and r"1\,\mathrm{in} = 2.54\,\mathrm{cm}" in facts
    mine = [{"symbol": "bag", "equals": r"50\,lb"}]
    chain = r"2\,bag\cdot\frac{50\,lb}{1\,bag}\cdot\frac{16\,oz}{1\,lb}"
    assert handle({"op": "smart", "latex": chain, "units": mine})["result_latex"] == r"1600\,\mathrm{oz}"
    assert any(r["custom"] and r["fact"] == r"1\,\mathrm{bag} = 50\,\mathrm{lb}" for r in handle({"op": "relations", "units": mine})["relations"])
    # only for that request: the library itself is unchanged
    assert not any(r["custom"] for r in handle({"op": "relations"})["relations"])
