"""The notebook's kernel (kernel.py): one Python kept running per notebook,
spoken to one JSON line each way."""

import kernel


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
