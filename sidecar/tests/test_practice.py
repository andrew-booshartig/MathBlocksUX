"""Every practice topic: problems generate, their worked solution runs,
the true answer is accepted and an off-by-one answer is rejected."""

import pytest

from engine import handle
from mathcore.practice import TOPICS

SEEDS = range(25)


def correct_response(p):
    kind, answer = p["kind"], p["answer"]
    if kind == "solutions":
        return ", ".join(answer) if answer else "no solution"
    if kind == "literal":
        return f"{p['target']} = {answer[0]}"
    if kind == "scientific":
        from sympy import Rational, floor, log
        v = Rational(answer)
        e = int(floor(log(abs(v), 10)))
        m = v / Rational(10) ** e
        return f"{float(m):g} x 10^{e}"
    return answer


def wrong_response(p):
    kind, answer = p["kind"], p["answer"]
    if kind == "solutions":
        return ", ".join(f"({a}) + 1" for a in answer) if answer else "3"
    if kind == "value":
        return f"({answer}) + 1"
    if kind == "point":
        return answer.replace("(", "(1 + ", 1)
    if kind == "inequality":
        return "x > 1000"
    if kind == "line":
        return "y = 1000x"
    if kind == "literal":
        return f"{p['target']} = 1000"
    if kind == "scientific":
        return "9.9 x 10^40"
    return f"({answer}) + 1"


@pytest.mark.parametrize("topic", list(TOPICS))
def test_topic(topic):
    for seed in SEEDS:
        p = handle({"op": "practice", "topic": topic, "seed": seed})
        assert p["prompt"] and p["latex"]
        shown = handle(p["show"])
        assert shown, (topic, seed)
        base = {"op": "check", "kind": p["kind"], "answer": p["answer"], "target": p.get("target")}
        good = handle({**base, "response": correct_response(p)})
        assert good["correct"], (topic, seed, p, good)
        bad = handle({**base, "response": wrong_response(p)})
        assert not bad["correct"], (topic, seed, p)
