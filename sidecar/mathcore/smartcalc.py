"""The smart calculator: one line of pretty math in, the obvious thing out.

  just numbers      → the value, exact and decimal (3/4 + 1 → 7/4 ≈ 1.75)
  one letter        → an expression is simplified; an equation or
                      inequality is solved for that letter
  several letters   → it asks what to do: solve for which letter, or
                      simplify / expand / factor

Input is LaTeX (from the visual math field). It's read with the shared
language layer and handed to the same engines the Transform and Solve
blocks use, so answers and worked steps match everywhere."""

import re

import sympy

from . import lang
from .calculator import op_calc
from .parsing import MathInputError, build_scope, parse
from .solve import op_solve
from .transform import op_transform

# how the engines above read text: 2*x, x^2, one "=" for equals
PLAIN = [{"id": "plain", "name": "Plain", "power": ["^"], "equals": ["="], "implicit_multiplication": False}]

_ANS = re.compile(r"\\(?:mathrm|operatorname|text)\{Ans\}|\bAns\b")
_RELATION = re.compile(r"<=|>=|<|>|=")

EXPRESSION_ACTIONS = [
    {"kind": "simplify", "label": "Simplify"},
    {"kind": "expand", "label": "Expand"},
    {"kind": "factor", "label": "Factor"},
]


def _letters(text: str) -> list[str]:
    """The letters a line uses (x and y first, then alphabetical)."""
    scope = build_scope({})
    names: set[str] = set()
    for side in _RELATION.split(text):
        if side.strip():
            names |= {str(s) for s in parse(side, scope).free_symbols}
    return sorted(names, key=lambda n: (n not in ("x", "y"), n != "x", n))


def op_smart(req: dict) -> dict:
    latex = (req.get("latex") or "").strip()
    if not latex:
        raise MathInputError("")
    ans = req.get("ans")
    if _ANS.search(latex):
        if not ans:
            raise MathInputError("there's no answer yet to use as Ans")
        latex = _ANS.sub(lambda _: f"\\left({ans}\\right)", latex)
    try:
        node = lang.parse(latex, "latex")
    except lang.Incomplete:
        raise MathInputError("") from None
    text = lang.write(node, "plain", PLAIN)
    input_latex = lang.latex(node)
    relation = isinstance(node, lang.Rel)
    letters = _letters(text)

    # just numbers: work it out, like any calculator
    if not letters:
        if relation:
            truth = bool(sympy.sympify(text.replace("=", "==") if "<" not in text and ">" not in text else text))
            return {"kind": "truth", "input_latex": input_latex, "result_latex": "\\text{true}" if truth else "\\text{false}"}
        value = op_calc({"expr": text, "angle": req.get("angle", "deg")})
        return {
            "kind": "value",
            "input_latex": input_latex,
            "result_latex": value["exact_latex"],
            "decimal": value["decimal"] if value["exact_differs"] else None,
            # Ans is this answer, exact, as math (2√2, not 2.828…)
            "ans": value["exact_latex"],
        }

    actions = (
        [{"kind": "solve", "var": v, "label": f"Solve for {v}"} for v in letters] if relation else EXPRESSION_ACTIONS
    )
    action = req.get("action")
    if not action:
        if len(letters) > 1:
            # several letters: there's no one obvious thing to do — ask
            return {"kind": "choose", "input_latex": input_latex, "letters": letters, "choices": actions}
        action = actions[0]

    if action["kind"] == "solve":
        out = op_solve({"expr": text, "for": action["var"]})
        result, steps = out.get("solution_latex", ""), out.get("steps", [])
    elif action["kind"] in ("simplify", "expand", "factor"):
        if relation:
            raise MathInputError("that's an equation — solve it instead")
        out = op_transform({"expr": text, "mode": action["kind"]})
        result, steps = out.get("result_latex", ""), out.get("steps", [])
    else:
        raise MathInputError(f"unknown action “{action.get('kind')}”")

    return {
        "kind": "result",
        "input_latex": input_latex,
        "result_latex": result,
        "steps": steps,
        "action": action,
        # a simplified expression can be used again as Ans; a solution can't
        "ans": result if action["kind"] != "solve" else None,
        # the other things this line could do, offered as one-tap chips
        "others": [a for a in actions if a != action],
    }
