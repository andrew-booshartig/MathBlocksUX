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


def ask(text, **req):
    return handle({"op": "unitask", "text": text, **req})


def test_ask_in_plain_words_with_the_amount_after_every_step():
    r = ask("9 km/h to m/s")
    assert [w["latex"] for w in r["walk"]] == [
        r"9\,\frac{\mathrm{km}}{\mathrm{h}}",
        r"9000\,\frac{\mathrm{m}}{\mathrm{h}}",
        r"150\,\frac{\mathrm{m}}{\mathrm{min}}",
        r"2.5\,\frac{\mathrm{m}}{\mathrm{s}}",
    ]
    assert "on the bottom" in r["walk"][2]["note"]
    assert ask("3 3/8 in to mm")["from_latex"] == r"3\frac{3}{8}\,\mathrm{in}"  # as typed
    assert ask("3 3/8 in in mm")["result_latex"] == r"85.725\,\mathrm{mm}"  # "in" is inches, then the word
    assert ask("mm in a mile")["result_latex"] == r"1609344\,\mathrm{mm}"
    assert ask("how many seconds in 10 weeks")["result_latex"] == r"6048000\,\mathrm{s}"
    assert ask("9 kilometers per hour to meters per second")["result_latex"] == r"2.5\,\frac{\mathrm{m}}{\mathrm{s}}"
    assert "isn't one fixed length" in ask("seconds in 10 years")["note"]


def test_ask_defines_your_own_unit():
    r = ask("1 k = 1000 m")
    assert r["kind"] == "define" and r["symbol"] == "k" and r["equals"] == r"1000\,m"


def test_the_linter_names_what_it_sees():
    lint = handle({"op": "unitlint", "text": "9 km/h to kg"})
    assert [(p["unit"], p["name"]) for p in lint["pieces"]] == [("km", "kilometer"), ("h", "hour"), ("kg", "kilogram")]
    assert lint["from_kind"] == "speed" and lint["to_kind"] == "mass" and lint["fits"] is False
    assert handle({"op": "unitlint", "text": "9 kmh to m/s"})["pieces"][0] == {"text": "kmh", "unknown": True}
    assert handle({"op": "unitlint", "text": "9 km/h to"})["from_kind"] == "speed"  # still typing


def test_your_units_like_variables():
    """k = 1000 m (or k = km, or 1 k = 1000 m), then 9k to m — no space needed."""
    for line in ("k = 1000 m", "1 k = 1000 m"):
        r = ask(line)
        assert r["kind"] == "define" and r["symbol"] == "k" and r["equals"] == r"1000\,m"
    assert ask("k = km")["equals"] == r"1\,km"
    mine = [{"symbol": "k", "equals": r"1000\,m"}]
    r = ask("9k to m", units=mine)
    assert r["result_latex"] == r"9000\,\mathrm{m}" and "1 k = 1000 m" in r["walk"][1]["note"]
    assert ask("k = 2000 m", units=mine)["equals"] == r"2000\,m"  # yours can be redefined
    import pytest
    from mathcore.parsing import MathInputError

    with pytest.raises(MathInputError, match="already a unit"):
        ask("m = 5 ft")  # a library unit can't be
    lint = handle({"op": "unitlint", "text": "k = 1000 m"})
    assert lint["pieces"][0] == {"text": "k", "new": True} and lint["define"]["kind"] == "length"
