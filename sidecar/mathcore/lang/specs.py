"""Language definitions. A text language (Python, Lua, Haskell, or one a
teacher defines) is just data: how it spells powers, equals, "not equal",
"or", square root, absolute value, π — and whether it writes functions as
sqrt(x) or sqrt x, and allows 2x. The same definition drives reading,
writing, error messages, and the keypad/hint the student sees.

LaTeX (and the Visual editor, which produces LaTeX) is built in separately:
it's a structured notation, not a spelling of operators."""

from copy import deepcopy

from ..parsing import MathInputError

# every canonical function/constant a language can name
CANONICAL = ("sqrt", "abs", "pi", "e", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp")

DEFAULTS = {
    "power": ["^"],  # first = how it's written; the rest are also accepted
    "multiply": "*",
    "implicit_multiplication": False,  # may 2x mean 2*x?
    "equals": ["==", "="],
    "not_equal": ["!="],
    "or": ["or"],
    "call_style": "parens",  # "parens": sqrt(x)  ·  "juxtapose": sqrt x
    "prefixes": [],  # module prefixes accepted when reading, e.g. "math."
    "names": {"sqrt": "sqrt", "abs": "abs", "pi": "pi", "e": "e", "sin": "sin", "cos": "cos", "tan": "tan", "ln": "ln", "log": "log", "exp": "exp"},
}

BUILTIN = {
    "python": {
        "name": "Python",
        "power": ["**"],
        "equals": ["==", "="],
        "not_equal": ["!="],
        "or": ["or"],
        "call_style": "parens",
        "prefixes": ["math."],
        "names": {"sqrt": "sqrt", "abs": "abs", "pi": "pi", "e": "e", "sin": "sin", "cos": "cos", "tan": "tan",
                  "asin": "asin", "acos": "acos", "atan": "atan", "ln": "log", "log": "log10", "exp": "exp"},
        "hints": {"^": "In Python, `^` isn't a power — write powers with `**`, like `x**2`."},
    },
    "lua": {
        "name": "Lua",
        "power": ["^"],
        "equals": ["==", "="],
        "not_equal": ["~="],
        "or": ["or"],
        "call_style": "parens",
        "prefixes": ["math."],
        "names": {"sqrt": "math.sqrt", "abs": "math.abs", "pi": "math.pi", "e": "math.exp(1)", "sin": "math.sin", "cos": "math.cos",
                  "tan": "math.tan", "asin": "math.asin", "acos": "math.acos", "atan": "math.atan", "ln": "math.log", "exp": "math.exp"},
        "hints": {"**": "In Lua, powers use `^`, like `x^2` (not `**`)."},
    },
    "haskell": {
        "name": "Haskell",
        "power": ["^", "**", "^^"],
        "equals": ["==", "="],
        "not_equal": ["/="],
        "or": ["||", "or"],
        "call_style": "juxtapose",
        "names": {"sqrt": "sqrt", "abs": "abs", "pi": "pi", "e": "exp 1", "sin": "sin", "cos": "cos", "tan": "tan",
                  "asin": "asin", "acos": "acos", "atan": "atan", "ln": "log", "exp": "exp"},
    },
}


def normalize(spec: dict, language_id: str) -> dict:
    """Fill in anything a (possibly teacher-made) definition leaves out, and
    check what it does say."""
    full = deepcopy(DEFAULTS)
    for key, value in spec.items():
        if key == "names":
            full["names"] = {**DEFAULTS["names"], **{k: v for k, v in value.items() if v}}
        else:
            full[key] = value
    for key in ("power", "equals", "not_equal", "or", "prefixes"):
        if isinstance(full[key], str):
            full[key] = [full[key]]
        full[key] = [v for v in full[key] if v]
    for key in ("power", "equals", "not_equal", "or"):
        if not full[key]:
            raise MathInputError(f"the language “{spec.get('name', language_id)}” needs a symbol for {key.replace('_', ' ')}")
    if full["call_style"] not in ("parens", "juxtapose"):
        raise MathInputError("call_style must be “parens” or “juxtapose”")
    full.setdefault("name", language_id)
    full.setdefault("hints", {})
    full["id"] = language_id
    return full


def resolve(language_id: str, custom: list | None = None) -> dict:
    """A language definition by id: built-in, or one the workspace carries."""
    for spec in custom or []:
        if spec.get("id") == language_id:
            return normalize({k: v for k, v in spec.items() if k != "id"}, language_id)
    if language_id in BUILTIN:
        return normalize(BUILTIN[language_id], language_id)
    raise MathInputError(f"unknown language “{language_id}”")


def describe(spec: dict) -> dict:
    """What the UI shows for a language: its hint line and keypad snippets."""
    n = spec["names"]
    call = (lambda f, a: f"{f}({a})") if spec["call_style"] == "parens" else (lambda f, a: f"{f} {a}")
    mult = "2x" if spec["implicit_multiplication"] else f"2{spec['multiply']}x"
    hint = (
        f"**{spec['name']}** — {mult} to multiply, x{spec['power'][0]}2 for powers, "
        f"{spec['equals'][0]} for equals, {spec['not_equal'][0]} for not equal, {call(n['sqrt'], 'x')}, {call(n['abs'], 'x')}, {n['pi']}."
    )
    wrap = "()" if spec["call_style"] == "parens" else " ()"
    palette = [
        {"label": "x²", "insert": f"{spec['power'][0]}2"},
        {"label": "xⁿ", "insert": f"{spec['power'][0]}()", "caret": -1},
        {"label": "√", "insert": f"{n['sqrt']}{wrap}", "caret": -1},
        {"label": "a⁄b", "insert": "()/()", "caret": -4},
        {"label": "( )", "insert": "()", "caret": -1},
        {"label": "|x|", "insert": f"{n['abs']}{wrap}", "caret": -1},
        {"label": "π", "insert": n["pi"]},
        {"label": spec["equals"][0], "insert": f" {spec['equals'][0]} "},
        {"label": "<=", "insert": " <= "},
        {"label": ">=", "insert": " >= "},
        {"label": spec["or"][0], "insert": f" {spec['or'][0]} "},
    ]
    example = f"6{spec['multiply']}s - 4 {spec['equals'][0]} 8{spec['multiply']}(2 + 1/4{spec['multiply']}s)"
    return {"id": spec["id"], "name": spec["name"], "hint": hint, "palette": palette, "placeholder": example}
