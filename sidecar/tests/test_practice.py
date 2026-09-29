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
    if kind == "count":
        return "one" if answer != "1" else "no solution"
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


def test_number_of_solutions_topics_agree_with_the_solver():
    from mathcore.practice import op_practice
    from mathcore.solve import op_solve

    seen = set()
    for seed in range(120):
        pr = op_practice({"topic": "num-solutions", "seed": seed})
        sol = op_solve(pr["show"])["solution_latex"]
        got = "0" if "no solution" in sol else "inf" if "all real" in sol else "1"
        assert got == pr["answer"], pr["latex"]
        assert [c["value"] for c in pr["choices"]] == ["0", "1", "inf"]
        seen.add(got)
    assert seen == {"0", "1", "inf"}
    for seed in range(80):
        pr = op_practice({"topic": "num-solutions-make", "seed": seed})
        sol = op_solve(pr["show"])["solution_latex"]
        assert ("no solution" if "no solution" in pr["prompt"] else "all real") in sol


def test_count_answers():
    from mathcore.practice import op_check

    for said, value in [("no solution", "0"), ("none", "0"), ("one", "1"), ("Exactly one solution", "1"), ("infinitely many", "inf"), ("all real numbers", "inf"), ("∞", "inf")]:
        assert op_check({"kind": "count", "answer": value, "response": said})["correct"], said
    assert not op_check({"kind": "count", "answer": "1", "response": "none"})["correct"]
