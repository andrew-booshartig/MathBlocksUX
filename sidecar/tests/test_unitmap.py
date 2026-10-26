"""The unit map: chains of 1 : N links; a conversion walks them."""

from engine import handle


def path(start, target, **req):
    return handle({"op": "unitpath", "from": start, "to": target, **req})


def test_a_speed_walks_two_chains_and_divides_on_the_bottom():
    r = path(r"9\,\frac{km}{h}", r"\frac{m}{s}")
    length, time = r["parts"]
    assert length["path"] == ["km", "m"] and [s["op"] + s["n"] for s in length["steps"]] == ["×1000"]
    assert time["path"] == ["h", "min", "s"] and time["on_bottom"] and [s["op"] + s["n"] for s in time["steps"]] == ["÷60", "÷60"]
    assert r["result_latex"] == r"2.5\,\frac{\mathrm{m}}{\mathrm{s}}" and r["exact"]
    assert r["arithmetic"] == r"9 \times 1000 \div 60 \div 60 = 2.5"


def test_exact_answers_are_shown_exactly():
    assert path(r"3\frac{3}{8}\,in", "mm")["result_latex"] == r"85.725\,\mathrm{mm}"  # 1 in = 2.54 cm, exactly
    assert path(r"1\,mi", "mm")["result_latex"] == r"1609344\,\mathrm{mm}"
    assert path(r"10\,wk", "s")["result_latex"] == r"6048000\,\mathrm{s}"


def test_steps_are_written_the_exact_way_round():
    assert "\\div 0.45359237" in path(r"1\,kg", "lb")["arithmetic"]  # not × 2.2046…
    assert "\\div 2.54" in path(r"10\,cm", "in")["arithmetic"]


def test_your_own_units_are_on_the_map():
    mine = [{"symbol": "bag", "equals": r"50\,lb"}]
    r = path(r"1\,bag", "oz", units=mine)
    assert r["parts"][0]["path"] == ["bag", "lb", "oz"] and r["result_latex"] == r"800\,\mathrm{oz}"
    mass = next(k for k in handle({"op": "unitmap", "units": mine})["kinds"] if k["kind"] == "mass")
    assert mass["mine"] == [{"a": "bag", "b": "lb", "n": "50"}]


def test_the_map():
    kinds = {k["kind"]: k for k in handle({"op": "unitmap"})["kinds"]}
    assert kinds["length"]["chains"][0] == {"units": ["km", "m", "cm", "mm"], "links": ["1000", "100", "10"]}
    assert {"a": "in", "b": "cm", "n": "2.54"} in kinds["length"]["bridges"]
