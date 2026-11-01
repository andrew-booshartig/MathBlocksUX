"""The notebook's kernel (kernel.py): one Python kept running per notebook,
spoken to one JSON line each way."""

import pytest

import kernel


@pytest.fixture(scope="module", autouse=True)
def _libraries():
    kernel.setup()  # numpy, sympy, pandas… as a kernel starts with


def test_cells_share_what_they_make():
    kernel.run("k_a = 4")
    out = kernel.run("k_a * 10")
    assert out["value"] == "40" and out["error"] is None


def test_input_says_why_instead_of_hanging():
    out = kernel.run("name = input('who? ')")
    assert "input() can't ask in a notebook" in out["error"]


def test_a_cell_reading_stdin_gets_nothing():
    out = kernel.run("import sys\nlen(sys.stdin.read())")
    assert out["value"] == "0"


def test_the_calculators_numbers_come_along_as_calc():
    out = kernel.run("calc.d / calc.t", {"d": 120, "t": 8, "label": "skip me"})
    assert out["value"] == "15.0"


def test_an_error_says_its_line():
    out = kernel.run("a = 1\nb = a + nowhere")
    assert out["error"].startswith("line 2: NameError")


def test_made_and_used_names():
    made, used = kernel.names_of("import numpy as np\ny = np.sin(x) + c\ndef f(t): return t")
    assert made == ["f", "np", "t", "y"]
    assert used == ["c", "x"]


def test_completion_finishes_a_dotted_name():
    kernel.ns["math"] = __import__("math")
    found = kernel.complete("v = math.sq")
    assert found["word"] == "math.sq" and "math.sqrt" in found["matches"]


def test_variables_leave_out_the_kernels_own_names():
    kernel.run("k_list = [1, 2, 3]")
    names = [v["name"] for v in kernel.variables()]
    assert "k_list" in names
    assert not {"calc", "input", "math"} & set(names)


def test_display_shows_each_richly_in_order():
    out = kernel.run("display(sp.Rational(1, 2), 7)\n'last'")
    assert [s.get("latex") for s in out["shown"]] == [r"\frac{1}{2}", None]
    assert out["shown"][1]["value"] == "7" and out["value"] == "'last'"


def test_time_magics():
    out = kernel.run("%timeit 1 + 1\n%time k_t = 5")
    assert "per loop" in out["stdout"] and "Wall time:" in out["stdout"] and out["error"] is None
    assert kernel.ns["k_t"] == 5


def test_a_timed_cell_keeps_its_answer():
    out = kernel.run("%%time\n6 * 7")
    assert out["value"] == "42" and out["stdout"].startswith("Wall time:")


def test_names_read_through_magics():
    assert kernel.names_of("%time a = b + 1") == (["a"], ["b"])
