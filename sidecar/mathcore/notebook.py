"""Notebook code cells: Python run the way a script (or a MATLAB live
script) runs — top to bottom in one namespace, with numpy as np,
matplotlib.pyplot as plt, sympy as sp and math ready — each cell keeping
what it printed, the plots it drew and its last line's value.

The cells run in a process of their own, so a cell that loops forever (or
crashes Python) is stopped at a time limit instead of taking the
calculator down with it."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from .parsing import MathInputError

TIME_LIMIT = 30  # seconds, for a whole run
MAX_TEXT = 20_000  # characters of printout kept per cell
SENTINEL = "\x1e\x1enotebook-result\x1e\x1e"
SIDECAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_cells(cells: list[str]) -> list[dict]:
    """Every cell, in order, in one namespace — stopping at the first error
    (the cells after it would only fail on what it didn't make)."""
    import ast
    import base64
    import contextlib
    import io
    import math
    import traceback

    ns: dict = {"__name__": "__notebook__", "math": math}
    plt = sp = None
    try:
        import numpy as np

        ns.update(np=np, numpy=np)
    except Exception:  # noqa: BLE001 — not installed: cells just can't use it
        pass
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        ns["plt"] = plt
    except Exception:  # noqa: BLE001
        plt = None
    try:
        import sympy as sp

        ns.update(sp=sp, sympy=sp)
    except Exception:  # noqa: BLE001
        sp = None

    out: list[dict] = []
    for i, code in enumerate(cells):
        cell = {"stdout": "", "images": [], "value": None, "latex": None, "error": None}
        printed = io.StringIO()
        try:
            tree = ast.parse(code, "<cell>", "exec")
            # the last line, when it's an expression, is the cell's answer
            last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
            with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
                exec(compile(tree, "<cell>", "exec"), ns)  # noqa: S102 — the user's own code, like any notebook
                if last is not None:
                    value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), ns)  # noqa: S307
                    if value is not None and not _is_plot(value):
                        # a numpy number is just the number: 2.5, not np.float64(2.5)
                        if type(value).__module__ == "numpy" and getattr(value, "shape", None) == ():
                            value = value.item()
                        cell["value"] = repr(value)[:MAX_TEXT]
                        if sp is not None and isinstance(value, sp.Basic):
                            cell["latex"] = sp.latex(value)
        except Exception as exc:  # noqa: BLE001 — shown under the cell
            cell["error"] = _explain(exc, traceback)
        if plt is not None:
            for number in plt.get_fignums():
                figure = plt.figure(number)
                png = io.BytesIO()
                figure.savefig(png, format="png", dpi=144, bbox_inches="tight")
                cell["images"].append(base64.b64encode(png.getvalue()).decode("ascii"))
            plt.close("all")
        cell["stdout"] = printed.getvalue()[:MAX_TEXT]
        out.append(cell)
        if cell["error"]:
            out += [{"skipped": True} for _ in cells[i + 1 :]]
            break
    return out


def _is_plot(value) -> bool:
    """plt.plot(...) on the last line hands back its lines — the picture
    is the answer, not "[<Line2D …>]" """
    kinds = value if isinstance(value, list) else [value]
    return bool(kinds) and all(type(v).__module__.startswith("matplotlib") for v in kinds)


def _explain(exc: BaseException, traceback) -> str:
    """'line 3: NameError: name 'y' is not defined' — the line in the cell,
    not Python's whole traceback"""
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == "<cell>":
            line = frame.lineno
    if isinstance(exc, SyntaxError) and exc.filename == "<cell>":
        line = exc.lineno
    message = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    return f"line {line}: {message}" if line else message


def _main() -> None:
    """the separate process: cells in on stdin, results out after a marker
    (anything a library prints while loading comes before it)"""
    cells = json.loads(sys.stdin.read())
    result = run_cells(cells)
    sys.stdout.write(SENTINEL + json.dumps(result))
    sys.stdout.flush()


def _in_process(cells: list[str], conn) -> None:  # pragma: no cover — the packaged app's way
    conn.send(run_cells(cells))
    conn.close()


def op_pyrun(req: dict) -> dict:
    cells = [str(c) for c in req.get("cells") or []]
    if not cells:
        return {"cells": []}
    limit = float(req.get("limit") or TIME_LIMIT)
    too_long = f"the code ran longer than {limit:g} seconds and was stopped — a loop that never ends?"
    if getattr(sys, "frozen", False):  # pragma: no cover — no python to start in the packaged app
        import multiprocessing as mp

        ctx = mp.get_context("spawn")
        receive, send = ctx.Pipe(duplex=False)
        proc = ctx.Process(target=_in_process, args=(cells, send), daemon=True)
        proc.start()
        send.close()
        result = receive.recv() if receive.poll(limit) else None
        proc.join(1)
        if proc.is_alive():
            proc.terminate()
        if result is None:
            raise MathInputError(too_long)
        return {"cells": result}
    starter = f"import sys; sys.path.insert(0, {SIDECAR!r}); from mathcore.notebook import _main; _main()"
    try:
        done = subprocess.run([sys.executable, "-c", starter], input=json.dumps(cells), capture_output=True, text=True, timeout=limit)  # noqa: S603
    except subprocess.TimeoutExpired:
        raise MathInputError(too_long) from None
    if SENTINEL not in done.stdout:
        raise MathInputError(f"Python stopped without an answer: {done.stderr.strip()[-400:] or 'no message'}")
    return {"cells": json.loads(done.stdout.split(SENTINEL, 1)[1])}
