"""Notebook Python cells: run top to bottom in one namespace, each keeping
its printout, plots and last value — in a process of their own."""

import pytest

from mathcore.notebook import op_pyrun
from mathcore.parsing import MathInputError


def test_cells_share_one_namespace_and_keep_their_own_output():
    cells = op_pyrun({"cells": ["a = 3\nprint('a is', a)", "a * 2"]})["cells"]
    assert cells[0]["stdout"] == "a is 3\n"
    assert cells[0]["value"] is None
    assert cells[1]["value"] == "6"


def test_a_sympy_answer_comes_back_as_math_too():
    cell = op_pyrun({"cells": ["x = sp.symbols('x')\nsp.expand((x + 1)**2)"]})["cells"][0]
    assert cell["latex"] == "x^{2} + 2 x + 1"


def test_an_error_says_its_line_and_the_cells_after_it_wait():
    cells = op_pyrun({"cells": ["a = 1\nb = a + y", "print('never')"]})["cells"]
    assert cells[0]["error"].startswith("line 2: NameError")
    assert cells[1] == {"skipped": True}


def test_a_numpy_number_is_just_the_number():
    assert op_pyrun({"cells": ["np.linspace(0, 1, 5).sum()"]})["cells"][0]["value"] == "2.5"


def test_a_plot_is_a_picture_not_its_line_objects():
    cell = op_pyrun({"cells": ["x = np.linspace(-2, 2, 20)\nplt.plot(x, x**2)"]})["cells"][0]
    assert len(cell["images"]) == 1 and cell["images"][0].startswith("iVBOR")  # a PNG
    assert cell["value"] is None and cell["error"] is None


def test_a_loop_that_never_ends_is_stopped():
    with pytest.raises(MathInputError, match="longer than 2 seconds"):
        op_pyrun({"cells": ["while True:\n    pass"], "limit": 2})
