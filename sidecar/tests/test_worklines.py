"""The show-your-work checker: follows / wrong / carried, with nudges."""

import pytest

from engine import handle


def statuses(problem, lines, syntax="latex"):
    r = handle({"op": "worklines", "problem": problem, "lines": lines, "syntax": syntax})
    return [(l["status"], l.get("done"), l.get("message") or "") for l in r["lines"]]


def test_correct_equation_work_is_solved():
    s = statuses("Solve: 2(x - 3) + 4 = 5x - 11", ["2x - 6 + 4 = 5x - 11", "2x - 2 = 5x - 11", "-3x = -9", "x = 3"])
    assert [x[0] for x in s] == ["ok"] * 4 and s[-1][1] == "Solved for $x$"


def test_first_mistake_is_wrong_and_later_lines_are_carried():
    s = statuses("2(x - 3) + 4 = 5x - 11", ["2x - 2 = 5x - 11", "-3x - 2 = 11", "-3x = 13"])
    assert [x[0] for x in s] == ["ok", "wrong", "carried"]
    assert "sign" in s[1][2]


def test_expression_mistake_gets_a_test_value():
    s = statuses("3(2x - 4) + 5x - 7", ["6x - 4 + 5x - 7"])
    assert s[0][0] == "wrong" and "Test it" in s[0][2]


def test_simplified_is_recognised():
    assert statuses("3(2x - 4) + 5x - 7", ["11x - 19"])[0][1] == "Fully simplified"


def test_forgot_to_flip_inequality():
    s = statuses("-2x + 1 > 7", ["-2x > 6", "x > -3"])
    assert s[1][0] == "wrong" and "direction" in s[1][2]


@pytest.mark.parametrize("problem,line,syntax", [
    ("x^2 = 16", "x = ±4", "latex"),
    ("x^2 - 5x + 6 = 0", "x = 2 or x = 3", "latex"),
    ("|x - 2| > 3", "x > 5 or x < -1", "latex"),
    (r"\frac{x}{2} + 3 = 7", "x = 8", "latex"),
    ("2x^2 + 3x - 4 = 0", r"x = \frac{-3 \pm \sqrt{41}}{4}", "latex"),
    ("A = l*w", "w = A/l", "latex"),
])
def test_final_answers_accepted(problem, line, syntax):
    assert statuses(problem, [line], syntax)[0][0] == "ok"


def test_lost_solution():
    s = statuses("x^2 = 16", ["x = 4"])
    assert s[0][0] == "wrong" and "missing" in s[0][2]


@pytest.mark.parametrize("syntax,problem,line,status", [
    ("latex", r"6s-4=8\left(2+\frac{1}{4}s\right)", "6s-4=16+2s", "ok"),
    ("latex", r"6s-4=8\left(2+\frac14s\right)", "s=5", "ok"),  # how the visual editor writes it
    ("python", "6*s - 4 == 8*(2 + 1/4*s)", "6*s - 4 == 16 + 2*s", "ok"),
    ("python", "x**2 == 16", "x == 4 or x == -4", "ok"),
    ("lua", "x^2 == 16", "x == 4 or x == -4", "ok"),
    ("lua", "6*s - 4 == 8*(2 + 1/4*s)", "s == 5", "ok"),
])
def test_languages(syntax, problem, line, status):
    r = handle({"op": "worklines", "problem": problem, "lines": [line], "syntax": syntax})
    assert r["lines"][0]["status"] == status


@pytest.mark.parametrize("syntax,problem,message", [
    ("python", "x^2 == 16", "isn't a power"),
    ("python", "6s - 4 == 8", "needs `*`"),
    ("lua", "x**2 == 16", "In Lua, powers use"),
    ("lua", "3(x + 1) == 6", "needs `*`"),
])
def test_code_rules_are_explained(syntax, problem, message):
    with pytest.raises(Exception, match=message):
        handle({"op": "worklines", "problem": problem, "lines": [], "syntax": syntax})


def test_latex_is_not_guessed():
    with pytest.raises(Exception, match="looks like LaTeX"):
        handle({"op": "worklines", "problem": r"\frac{x}{2} = 3", "lines": [], "syntax": "python"})


def test_problem_displays_as_typed():
    r = handle({"op": "worklines", "problem": r"6s-4=8\left(2+\frac{1}{4}s\right)", "lines": [], "syntax": "latex"})
    assert r["problem_latex"] == r"6s-4=8\left(2+\frac{1}{4}s\right)"


# ---- conclusions in words: "no solution" / "all real numbers"


def _lines(problem, lines, syntax="latex"):
    from mathcore.worklines import op_worklines

    return op_worklines({"problem": problem, "lines": lines, "syntax": syntax})["lines"]


def test_no_solution_conclusion():
    out = _lines("3x + 5 = 3x + 2", ["5 = 2", "\\text{no solution}"])
    assert [l["status"] for l in out] == ["ok", "ok"]
    assert "false" in out[0]["note"]
    assert out[1]["done"].startswith("No solution")


def test_all_reals_conclusion_typed_without_spaces():
    # the Visual editor drops spaces: "allrealnumbers"
    out = _lines("2(x + 3) = 2x + 6", ["6 = 6", "allrealnumbers"])
    assert [l["status"] for l in out] == ["ok", "ok"]
    assert out[1]["done"].startswith("Infinitely many")


def test_wrong_conclusions_are_nudged_not_answered():
    assert _lines("2(x + 3) = 2x + 6", ["0 = 0", "no solution"])[1]["status"] == "wrong"
    assert _lines("3x + 5 = 3x + 2", ["0 = -3", "infinitely many solutions"])[1]["status"] == "wrong"
    still = _lines("4x - 1 = 2x + 7", ["2x = 8", "no solution"])[1]
    assert still["status"] == "wrong" and "still has solutions" in still["message"]


def test_conclusion_in_text_languages_and_translation():
    from mathcore.lang import op_translate

    assert _lines("3*x + 5 = 3*x + 2", ["5 = 2", "no solution"], "python")[1]["status"] == "ok"
    items = op_translate({"from": "latex", "to": "python", "items": ["\\text{no solution}"]})["items"]
    assert items[0] == {"text": "no solution", "ok": True}


def test_single_letter_r_is_not_a_conclusion():
    from mathcore.worklines import conclusion

    assert conclusion("r") is None and conclusion("x = 3") is None
    assert conclusion("x \\in \\mathbb{R}") == "all" and conclusion("∅") == "none"
