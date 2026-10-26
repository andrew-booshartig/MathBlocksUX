"""mathblocks sidecar — a persistent process the Rust side spawns once and
talks to over stdio as newline-delimited JSON. Kept persistent (rather than
spawned per-request) because sympy's own import cost alone is a couple
hundred ms; blocks need to feel live as you type, not per-keystroke laggy.

Protocol (one JSON object per line, in both directions):
  request:  {"id": int, "op": <name in OPS>, ...op-specific fields}
  response: {"id": int, "ok": true, ...op result}
         or {"id": int, "ok": false, "error": str}

The math itself lives in mathcore/ (one module per family of ops).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sympy  # noqa: E402
from sympy.parsing.sympy_parser import parse_expr  # noqa: E402

from mathcore.balance import op_balance  # noqa: E402
from mathcore.worklines import op_worklines  # noqa: E402
from mathcore.calculator import op_calc  # noqa: E402
from mathcore.ti85 import op_ti  # noqa: E402
from mathcore.smartcalc import op_numberline, op_smart, op_smart_console, op_smart_vars  # noqa: E402
from mathcore import units  # noqa: E402
from mathcore.unitmap import op_unitask, op_unitlint, op_unitmap, op_unitpath, op_unitvars  # noqa: E402
from mathcore.units import op_units  # noqa: E402
from mathcore.lang import op_languages, op_translate  # noqa: E402
from mathcore.analyze import op_line_public, op_quadratic, op_sequence, op_stats  # noqa: E402
from mathcore.graphing import op_fit, op_graph, op_table  # noqa: E402
from mathcore.parsing import TRANSFORMS, MathInputError  # noqa: E402
from mathcore.practice import op_check, op_practice, op_topics  # noqa: E402
from mathcore.solve import op_solve  # noqa: E402
from mathcore.transform import op_transform  # noqa: E402


def op_custom(req: dict) -> dict:
    """The escape hatch: runs the user's own Python. This is their own
    machine and their own script (same trust model as a Jupyter cell), so
    no sandboxing — the point is that nothing here should limit what they
    can build. `vars` is handed to compute() as plain Python floats (or
    the raw string, if a variable doesn't parse as a plain number),
    not sympy objects, since a hardware/audio/simulation script has no
    reason to be sympy-aware."""
    code, vars_ = req.get("expr", ""), req.get("vars") or {}
    numeric_vars: dict = {}
    for name, value in vars_.items():
        try:
            numeric_vars[name] = float(value)
        except ValueError:
            try:
                numeric_vars[name] = float(parse_expr(value, transformations=TRANSFORMS))
            except Exception:
                numeric_vars[name] = value

    namespace: dict = {"sympy": sympy, "math": __import__("math")}
    exec(code, namespace)
    compute_fn = namespace.get("compute")
    if not callable(compute_fn):
        raise ValueError("define a compute(vars) function that returns a dict")
    result = compute_fn(numeric_vars)
    if not isinstance(result, dict):
        raise ValueError("compute(vars) must return a dict, e.g. {'latex': '...'} or {'plot': {'x': [...], 'y': [...]}} or {'text': '...'}")
    return {"result": result}


OPS = {
    "transform": op_transform,
    "solve": op_solve,
    "graph": op_graph,
    "fit": op_fit,
    "table": op_table,
    "line": op_line_public,
    "quadratic": op_quadratic,
    "sequence": op_sequence,
    "stats": op_stats,
    "practice": op_practice,
    "topics": op_topics,
    "check": op_check,
    "balance": op_balance,
    "worklines": op_worklines,
    "calc": op_calc,
    "ti": op_ti,
    "smart": op_smart,
    "smartvars": op_smart_vars,
    "smartconsole": op_smart_console,
    "numberline": op_numberline,
    "units": op_units,
    "unitmap": op_unitmap,
    "unitpath": op_unitpath,
    "unitask": op_unitask,
    "unitlint": op_unitlint,
    "unitvars": op_unitvars,
    "translate": op_translate,
    "languages": op_languages,
    "custom": op_custom,
}


def handle(request: dict) -> dict:
    op = OPS.get(request.get("op"))
    if op is None:
        raise MathInputError(f"unknown op “{request.get('op')}”")
    # your own units (1 bag = 50 lb), for this request
    with units.extra(request.get("units")):
        return op(request)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = None
        try:
            request = json.loads(line)
            response = {"id": request.get("id"), "ok": True, **handle(request)}
        except MathInputError as exc:
            response = {"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": str(exc)}
        except Exception as exc:
            response = {"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
