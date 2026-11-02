"""The notebook's kernel: one Python that keeps running for a notebook, so
what one cell makes the next can use — the way Jupyter's does. It talks one
JSON line each way:

  {"op": "run", "code": "..."}   → what it printed, drew and answered, its run
                                   number, how long it took, and the names the
                                   cell made and used (so the notebook can rerun
                                   the cells that depend on it — reactive)
  {"op": "vars"}                 → the variables there are now
  {"op": "names", "codes": [..]} → each cell's made and used names, unrun
  {"op": "complete", "code": ".."} → names that finish the word the code ends with

The calculator's variables come along with each run, as calc (calc.m,
calc["w"]) — the calculator and the notebook sharing their numbers.

While a cell runs, what it prints so far goes out too, a few times a
second, as {"stream": "..."} lines before its answer — so a long cell
shows its progress the way Jupyter's do.

An interrupt (SIGINT) stops the cell running; the kernel carries on."""

from __future__ import annotations

import ast
import base64
import builtins
import contextlib
import io
import json
import math
import sys
import time
import traceback

MAX_TEXT = 50_000  # characters of printout kept per run
BUILTIN = set(dir(builtins))

class Calc(dict):
    """the calculator's variables: calc.m, or calc["m"]"""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"the calculator has no variable {name}") from None

    def __repr__(self):
        return "calc(" + ", ".join(f"{k}={v:g}" for k, v in self.items()) + ")"


class _Live(io.StringIO):
    """what a cell prints: kept whole for its answer, and sent on as it comes,
    whole lines (at most ten times a second, the first at once)"""

    def __init__(self):
        super().__init__()
        self.sent = 0
        self.last = 0.0

    def write(self, s):
        n = super().write(s)
        if "\n" in s and time.perf_counter() - self.last > 0.1:
            self.send()
        return n

    def send(self):
        text = self.getvalue()[:MAX_TEXT]
        text = text[: text.rfind("\n") + 1]
        if len(text) > self.sent:
            sys.__stdout__.write(json.dumps({"stream": text[self.sent :]}) + "\n")
            sys.__stdout__.flush()
            self.sent = len(text)
        self.last = time.perf_counter()


def _no_input(prompt=""):
    """the kernel's stdin is how the notebook talks to it — input() would
    swallow the next request and hang, so it says what to do instead"""
    raise RuntimeError("input() can't ask in a notebook — set the value in the cell (name = 5), or use calc.<name> from the calculator")


shown: list = []  # what display( ) showed in the cell running


def _display(*objs):
    """show each richly — a table, math, a value — under the cell, in order
    (as Jupyter's display does), however many and wherever in the cell"""
    for value in objs:
        if value is None or _is_plot(value):
            continue
        out: dict = {}
        show(value, out)
        if len(shown) < 50:
            shown.append(out)


ns: dict = {"__name__": "__main__", "math": math, "calc": Calc(), "input": _no_input, "display": _display}



count = 0
plt = None
sp = None


def setup():
    global plt, sp
    try:
        import numpy as np

        ns.update(np=np, numpy=np)
    except Exception:  # noqa: BLE001 — not installed: cells just can't use it
        pass
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as _plt

        plt = _plt
        ns["plt"] = plt
    except Exception:  # noqa: BLE001
        pass
    try:
        import sympy as _sp

        sp = _sp
        ns.update(sp=sp, sympy=sp)
    except Exception:  # noqa: BLE001
        pass
    try:
        import pandas as pd

        ns.update(pd=pd)
    except Exception:  # noqa: BLE001
        pass


def _seconds(t: float) -> str:
    for unit, scale in (("s", 1), ("ms", 1e3), ("µs", 1e6), ("ns", 1e9)):
        if t * scale >= 1 or unit == "ns":
            return f"{t * scale:.3g} {unit}"
    return f"{t:.3g} s"


# each section's own names (headers are scope, as in the notebook): a cell
# sees the page's, then each header's out to its own — an inner one shadows
# an outer one, and what it makes stays in its own section
scopes: dict[str, dict] = {}
current: dict = ns  # the names the cell running sees (%time runs in them too)


def _time(stmt: str):
    """%time: run it once and say how long it took"""
    start = time.perf_counter()
    exec(compile(stmt, "<cell>", "exec"), current)  # noqa: S102
    print(f"Wall time: {_seconds(time.perf_counter() - start)}")


def _timeit(stmt: str):
    """%timeit: run it many times (about a fifth of a second a go, 7 goes) and say how long one takes"""
    import statistics
    import timeit

    timer = timeit.Timer(stmt, globals=ns)
    number, _ = timer.autorange()
    goes = [t / number for t in timer.repeat(repeat=7, number=number)]
    spread = statistics.stdev(goes) if len(goes) > 1 else 0.0
    print(f"{_seconds(statistics.mean(goes))} ± {_seconds(spread)} per loop (mean ± std. dev. of 7 runs, {number:,} loops each)")


MAGIC = __import__("re").compile(r"^(\s*)%(time|timeit)\s+(.+)$")


def timed_cell(code: str) -> tuple[str, bool]:
    """%%time on a cell's first line: the cell without it, and that it's to be timed"""
    first, _, rest = code.lstrip().partition("\n")
    return (rest, True) if first.strip() == "%%time" else (code, False)


def magics(code: str, plain: bool = False) -> str:
    """Jupyter's line magics as Python: each %time and %timeit line a call
    (plain: just the statement — to read what names it makes and uses)"""
    code = timed_cell(code)[0]
    out = []
    for line in code.split("\n"):
        m = MAGIC.match(line)
        out.append(line if not m else f"{m.group(1)}{m.group(3).strip()}" if plain else f"{m.group(1)}__{m.group(2)}__({m.group(3).strip()!r})")
    return "\n".join(out)


def names_of(code: str) -> tuple[list[str], list[str]]:
    """the names a cell makes (x = …, def f, import numpy) and the ones it uses from elsewhere"""
    try:
        tree = ast.parse(magics(code, plain=True))
    except SyntaxError:
        return [], []
    made, used = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            (made if isinstance(node.ctx, (ast.Store, ast.Del)) else used).add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            made.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                made.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, ast.arg):
            made.add(node.arg)
    return sorted(made), sorted(used - made - BUILTIN)


def _plain(value) -> bool:
    return type(value).__module__ == "numpy" and getattr(value, "shape", None) == ()


def show(value, out: dict):
    """the last line's answer, as richly as it can be shown: a table, math, or text"""
    if _plain(value):
        value = value.item()
    html = getattr(value, "_repr_html_", None)
    if callable(html):
        try:
            text = html()
            if text:
                out["html"] = str(text)[:400_000]
        except Exception:  # noqa: BLE001
            pass
    if sp is not None and isinstance(value, sp.Basic):
        out["latex"] = sp.latex(value)
    else:
        latex = getattr(value, "_repr_latex_", None)
        if callable(latex):
            try:
                text = latex()
                if text:
                    out["latex"] = str(text).strip("$")
            except Exception:  # noqa: BLE001
                pass
    out["value"] = repr(value)[:MAX_TEXT]


def complete(code: str) -> dict:
    """what could finish the word (or dotted name — np.lin…) the code ends with"""
    import re
    import rlcompleter

    m = re.search(r"[A-Za-z_][\w.]*$", code)
    word = m.group(0) if m else ""
    if not word:
        return {"word": "", "matches": []}
    # every section's names (the cell asking could be in any)
    done = rlcompleter.Completer({**ns, **{k: v for names in scopes.values() for k, v in names.items()}})
    found: list[str] = []
    for i in range(200):
        try:
            hit = done.complete(word, i)
        except Exception:  # noqa: BLE001 — a name whose attributes can't be listed
            break
        if hit is None:
            break
        hit = hit.rstrip("(")
        if hit not in found and not hit.split(".")[-1].startswith("__"):
            found.append(hit)
    return {"word": word, "matches": found[:60]}


def run(code: str, calc: dict | None = None, notebook_vars: dict | None = None, scope: list | None = None) -> dict:
    global count, current
    count += 1
    if calc is not None:
        ns["calc"] = Calc({k: v for k, v in calc.items() if isinstance(v, (int, float))})
    # its section's names (and the sections it's inside): None is the one namespace of old
    chain = ["\x02".join(map(str, scope[:k])) for k in range(len(scope) + 1)] if scope is not None else None
    g = ns
    if chain is not None:
        g = dict(ns)
        for key in chain:
            g.update(scopes.get(key, {}))
    # the notebook's variables blocks: m, g… as names of their own
    for k, v in (notebook_vars or {}).items():
        if isinstance(v, (int, float)) and k.isidentifier():
            g[k] = v
    before = {k: id(v) for k, v in g.items()}
    current = g
    out: dict = {"count": count, "stdout": "", "images": [], "value": None, "latex": None, "html": None, "error": None}
    shown.clear()
    printed = _Live()
    start = time.perf_counter()
    commands, sys.stdin = sys.stdin, io.StringIO("")  # a cell reading stdin gets nothing, not the next request
    try:
        timed = timed_cell(code)[1]
        tree = ast.parse(magics(code), "<cell>", "exec")
        # the last line, when it's an expression, is the cell's answer
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
            exec(compile(tree, "<cell>", "exec"), g)  # noqa: S102 — the user's own code, like any notebook
            value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), g) if last is not None else None  # noqa: S307
            if timed:
                print(f"Wall time: {_seconds(time.perf_counter() - start)}")
            if value is not None and not _is_plot(value):
                show(value, out)
                g["_"] = value
    except KeyboardInterrupt:
        out["error"] = "Stopped."
    except SyntaxError as exc:
        out["error"] = f"line {exc.lineno}: {exc.msg}" + (f"\n    {exc.text.rstrip()}" if exc.text else "")
    except Exception as exc:  # noqa: BLE001 — shown under the cell
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == "<cell>"]
        where = f"line {frames[-1].lineno}: " if frames else ""
        out["error"] = f"{where}{type(exc).__name__}: {exc}"
    finally:
        sys.stdin = commands
        # what the cell made (or changed) stays in its own section
        if chain is not None:
            own = scopes.setdefault(chain[-1], {})
            for name, value in g.items():
                if not name.startswith("__") and before.get(name) != id(value):
                    own[name] = value
        current = ns
    if plt is not None:
        for num in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(num).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            out["images"].append(base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    out["stdout"] = printed.getvalue()[:MAX_TEXT]
    out["shown"] = list(shown)
    out["seconds"] = round(time.perf_counter() - start, 4)
    out["defines"], out["uses"] = names_of(code)
    return out


def _is_plot(value) -> bool:
    kind = type(value).__module__ or ""
    return kind.startswith("matplotlib") or (isinstance(value, list) and value and (type(value[0]).__module__ or "").startswith("matplotlib"))


ns.update(__time__=_time, __timeit__=_timeit)  # what %time and %timeit lines call


def variables() -> list[dict]:
    out = []
    # the page's, then each section's — said with the section they're in
    places = [("", ns)] + [(key.split("\x02")[-1].split(":", 1)[-1], names) for key, names in scopes.items()]
    for where, names in places:
        for name, value in names.items():
            out_of = _variable(name, value)
            if out_of:
                out.append({**out_of, **({"type": f"{out_of['type']} · {where}"} if where else {})})
    return sorted(out, key=lambda v: v["name"].lower())


def _variable(name, value):
    """a variable as the Variables panel lists it (none for the kernel's own names and modules)"""
    if name.startswith("_") or name in ("math", "np", "numpy", "plt", "sp", "sympy", "pd", "calc", "input", "display") or type(value).__name__ == "module":
        return None
    kind = type(value).__name__
    shape = getattr(value, "shape", None)
    try:
        text = repr(value)
    except Exception:  # noqa: BLE001
        text = "…"
    if len(text) > 80:
        text = text[:77] + "…"
    return {"name": name, "type": kind, "shape": list(shape) if isinstance(shape, tuple) else None, "value": text}


def main():
    setup()
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            continue  # an interrupt with nothing running: nothing to stop
        if not line:
            return
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "run":
                reply = run(str(req.get("code", "")), req.get("calc"), req.get("vars"), req.get("scope"))
            elif op == "complete":
                reply = complete(str(req.get("code", "")))
            elif op == "vars":
                reply = {"vars": variables()}
            elif op == "names":
                reply = {"cells": [dict(zip(("defines", "uses"), names_of(c))) for c in req.get("codes", [])]}
            else:
                reply = {"error": f"no such op: {op}"}
        except KeyboardInterrupt:
            reply = {"error": "Stopped."}
        except Exception as exc:  # noqa: BLE001
            reply = {"error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
