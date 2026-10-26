"""Shared input handling: turns what a student would type (2x^2, |x-3|,
√7, ≤, y = ...) into sympy, and sympy back into LaTeX."""

import re

import sympy
from sympy import Abs, Symbol
from sympy.core.parameters import evaluate
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    rationalize,
    standard_transformations,
)

TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor, rationalize)
# for code-language input: exactly the language's own operators
STRICT_TRANSFORMS = standard_transformations + (rationalize,)

X = Symbol("x")
Y = Symbol("y")

# Single letters sympy would otherwise read as built-ins (I = imaginary
# unit, E = e, S = sets, N = numeric eval, O = big-O, Q = assumptions) —
# in an algebra class these are just variables (I = Prt, E = mc², ...).
_SHADOWED = {name: Symbol(name) for name in ("E", "I", "N", "O", "Q", "S", "C")}

# A bare "=" — not ==, <=, >=, !=, :=
EQUALS = re.compile(r"(?<![=<>!:])=(?!=)")
INEQUALITY = re.compile(r"<=|>=|<|>")

_UNICODE = {
    "−": "-", "–": "-", "×": "*", "·": "*", "⋅": "*", "÷": "/",
    "²": "^2", "³": "^3", "π": "pi", "≤": "<=", "≥": ">=", "≠": "!=",
}


class MathInputError(ValueError):
    """An input problem worth showing the student verbatim."""


def prep(text: str) -> str:
    """Normalize typed math: unicode symbols, |abs| bars, √, stray spaces."""
    text = re.sub(r"√\s*\(", "sqrt(", text)
    text = re.sub(r"√\s*([0-9a-zA-Z.]+)", r"sqrt(\1)", text)
    # |...| → Abs(...), innermost pairs first
    for _ in range(10):
        new = re.sub(r"\|([^|]*)\|", r"Abs(\1)", text)
        if new == text:
            break
        text = new
    if "|" in text:
        raise MathInputError("unmatched | — absolute value bars must come in pairs")
    for old, new in _UNICODE.items():
        text = text.replace(old, new)
    return text.strip()


def normalize_symbols(text: str) -> str:
    """The first half of prep: √ and |abs| bars, before any regrouping."""
    text = re.sub(r"√\s*\(", "sqrt(", text)
    text = re.sub(r"√\s*([0-9a-zA-Z.]+)", r"sqrt(\1)", text)
    for _ in range(10):
        new = re.sub(r"\|([^|]*)\|", r"Abs(\1)", text)
        if new == text:
            break
        text = new
    return text


# ---------------------------------------------------------------- typed → LaTeX
# Draws typed math the way it was typed (1/4*s → ¼·s, not s/4), with the
# usual order of operations, so what you see is exactly how it will be read.

_WORD = re.compile(r"[A-Za-z0-9_.]+")
_MULTI = ("**", "<=", ">=", "!=", "==")
_SEPARATORS = {"=", "<", ">", "<=", ">=", "!=", "==", ",", ";", "≤", "≥", "≠", "or", "and"}
_PLUS_MINUS = {"+", "-", "−", "–"}
_PRODUCT_OPS = {"*", "×", "·", "⋅", "÷", "/"}

_FUNCS = {"sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp"}
_OPS_TEX = {"*": "\\cdot", "×": "\\times", "·": "\\cdot", "⋅": "\\cdot", "÷": "\\div", "−": "-", "–": "-", "±": "\\pm", "%": "\\%"}
_REL_TEX = {"<=": "\\le", ">=": "\\ge", "!=": "\\ne", "==": "=", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", ",": ",\\ ", ";": ";\\ ", "or": "\\text{ or }", "and": "\\text{ and }"}


def _raw_atoms(text: str) -> list[str] | None:
    """Words, operators, spaces, and bracket groups (inside kept as typed)."""
    atoms, i = [], 0
    while i < len(text):
        c = text[i]
        if c == "(":
            depth = 0
            for j in range(i, len(text)):
                depth += {"(": 1, ")": -1}.get(text[j], 0)
                if depth == 0:
                    break
            else:
                return None
            atoms.append(text[i : j + 1])
            i = j + 1
        elif c.isspace():
            while i < len(text) and text[i].isspace():
                i += 1
            atoms.append(" ")
        elif m := _WORD.match(text, i):
            atoms.append(m.group(0))
            i = m.end()
        else:
            op = next((m for m in _MULTI if text.startswith(m, i)), c)
            atoms.append(op)
            i += len(op)
    return atoms


def _tex_word(word: str) -> str:
    if word == "pi":
        return "\\pi"
    if word == "oo":
        return "\\infty"
    if word in _FUNCS:
        return f"\\{word}"
    if re.fullmatch(r"[A-Za-z]{2,}", word) and word not in ("or", "and"):
        return f"\\mathrm{{{word}}}"
    return word


def _tex_chunk(atoms: list[str], bare: bool = False) -> str:
    """Juxtaposed atoms: 4s, 2(x+1), sqrt(x), x^2. `bare`: drop one outer
    bracket pair (a fraction bar or exponent already groups it)."""
    atoms = [a for a in atoms if a != " "] if bare else atoms
    if bare and len(atoms) == 1 and atoms[0].startswith("("):
        return _tex(atoms[0][1:-1])
    out, i = [], 0
    while i < len(atoms):
        a = atoms[i]
        nxt = atoms[i + 1] if i + 1 < len(atoms) else None
        if a in ("sqrt", "Abs") and nxt and nxt.startswith("("):
            inner = _tex(nxt[1:-1])
            out.append(f"\\sqrt{{{inner}}}" if a == "sqrt" else f"\\left|{inner}\\right|")
            i += 2
            continue
        if a in ("^", "**") and nxt:
            exp = _tex(nxt[1:-1]) if nxt.startswith("(") else _tex_word(nxt)
            out.append(f"^{{{exp}}}")
            i += 2
            continue
        if a.startswith("("):
            out.append(f"\\left({_tex(a[1:-1])}\\right)")
        elif a == " ":
            out.append(" ")
        elif _WORD.fullmatch(a):
            out.append(_tex_word(a))
        else:
            out.append(_OPS_TEX.get(a, a))
        i += 1
    return "".join(out).strip()


def _tex_standard_term(atoms: list[str]) -> str:
    """Standard order of operations: a "/" divides the product so far by the
    ONE factor after it — 1/4s is ¼s, 2x/3 is (2x)/3, x/2y is (x/2)·y."""
    expanded: list[str] = []
    for a in atoms:
        if a == " ":
            continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?)([A-Za-z_]\w*)", a)
        expanded += [m.group(1), m.group(2)] if m else [a]
    factors: list[list[str]] = []
    i = 0
    while i < len(expanded):
        a = expanded[i]
        nxt = expanded[i + 1] if i + 1 < len(expanded) else ""
        if (a in ("sqrt", "Abs") or a in _FUNCS) and nxt.startswith("("):
            factor, i = [a, nxt], i + 2
        else:
            factor, i = [a], i + 1
        while i + 1 < len(expanded) and expanded[i] in ("^", "**"):
            factor += expanded[i : i + 2]
            i += 2
        factors.append(factor)
    # left to right: "/" divides EVERYTHING so far in this term (2*x/3 is
    # (2·x)/3) by the one factor after it
    out, only = "", None  # `only`: the term so far, if it's a single factor
    k = 0
    while k < len(factors):
        f = factors[k]
        if f == ["/"] and k + 1 < len(factors):
            num = _tex_chunk(only, bare=True) if only else out.strip()
            out = f"\\frac{{{num}}}{{{_tex_chunk(factors[k + 1], bare=True)}}}"
            only = None
            k += 2
            continue
        if len(f) == 1 and f[0] in _PRODUCT_OPS:
            out += f" {_OPS_TEX.get(f[0], f[0])} "
            only = None
        else:
            only = f if not out.strip() else None
            out += _tex_chunk(f)
        k += 1
    return out.strip()


def _tex_terms(atoms: list[str]) -> str:
    """Split at binary + and −, and draw each term."""
    out, term, previous = [], [], None
    for atom in atoms:
        binary = atom in _PLUS_MINUS and previous is not None and previous not in _PRODUCT_OPS | _PLUS_MINUS | {"^", "**"}
        if binary:
            out.append(_tex_standard_term(term))
            out.append(f" {_OPS_TEX.get(atom, atom)} ")
            term = []
        else:
            term.append(atom)
        if atom != " ":
            previous = atom
    out.append(_tex_standard_term(term))
    return re.sub(r"\s+", " ", "".join(out)).strip()


def _tex(text: str) -> str:
    atoms = _raw_atoms(text)
    if atoms is None:
        return text
    out, segment = [], []
    for atom in atoms:
        if atom in _SEPARATORS:
            out.append(_tex_terms(segment))
            out.append(f" {_REL_TEX.get(atom, atom)} ")
            segment = []
        else:
            segment.append(atom)
    out.append(_tex_terms(segment))
    return re.sub(r"\s+", " ", "".join(out)).strip()


def typed_latex(text: str) -> str:
    """Typed plain math → LaTeX drawn the way it was typed (1/4*s stays ¼·s,
    not s/4), following the usual order of operations."""
    return _tex(normalize_symbols(text))


def _dependency_order(vars_: dict) -> list[tuple[str, str]]:
    """Definitions so each comes after the ones it uses (d = 2*r after
    r = 4, whatever order they were made in); a loop keeps its order."""
    entries = [(str(k), str(v)) for k, v in vars_.items()]
    defined = {k.split("(")[0].strip(): k for k, _ in entries}
    ordered, done, pending = [], set(), list(entries)
    while pending:
        ready = [
            (k, v) for k, v in pending
            if not any(other != k and other not in done and re.search(rf"\b{re.escape(n)}\b", v) for n, other in defined.items())
        ]
        if not ready:  # a loop: what's left, as it came
            ready = pending
        for entry in ready:
            ordered.append(entry)
            done.add(entry[0])
        pending = [e for e in pending if e not in ready]
    return ordered


def build_scope(vars_: dict | None = None, keep_symbolic=()) -> dict:
    """Variable-block values as sympy objects, plus x/y as free symbols.

    `keep_symbolic` names are never substituted — e.g. when solving for x,
    a stray `x = 2` in a Variable block must not turn x into a number."""
    scope: dict = {"x": X, "y": Y, **_SHADOWED}
    keep = {str(k) for k in keep_symbolic}
    for name, value in _dependency_order(vars_ or {}):
        name = str(name).strip()
        # a function: "f(x)": "x^2 + 1" → f(3) is 10, everywhere
        call = re.fullmatch(r"([A-Za-z]\w*)\(\s*([A-Za-z]\w*(?:\s*,\s*[A-Za-z]\w*)*)\s*\)", name)
        if call and call.group(1) not in keep:
            params = [sympy.Symbol(p.strip()) for p in call.group(2).split(",")]
            try:
                body = parse_expr(prep(str(value)), local_dict={**scope, **{str(p): p for p in params}}, transformations=TRANSFORMS)
                scope[call.group(1)] = sympy.Lambda(tuple(params), body)
            except Exception:
                pass
            continue
        if not name or name in keep or not name.isidentifier():
            continue
        try:
            scope[name] = parse_expr(prep(str(value)), local_dict=dict(scope), transformations=TRANSFORMS)
        except Exception:
            scope[name] = Symbol(name)
    return scope


def parse(text: str, scope: dict | None = None, *, evaluate_expr: bool = True, strict: bool = False):
    """`strict`: programming-language rules (Python, Lua) — no implied
    multiplication, and ^ is not turned into a power."""
    text = prep(text)
    if not text:
        raise MathInputError("nothing to read yet")
    try:
        expr = parse_expr(text, local_dict=dict(scope or build_scope()), transformations=STRICT_TRANSFORMS if strict else TRANSFORMS, evaluate=evaluate_expr)
    except (SyntaxError, TypeError, ValueError, AttributeError, NameError) as exc:
        raise MathInputError(f"couldn't read “{text}” — check for a missing operator or parenthesis") from exc
    return expr if evaluate_expr else _drop_unit_factors(expr)


def _drop_unit_factors(expr):
    """Unevaluated parses keep literal 1·(...) factors (from "1/2" and
    from substituting coefficients), which print as "1 · ½"."""
    if not expr.args:
        return expr
    args = [_drop_unit_factors(a) for a in expr.args]
    if expr.is_Mul:
        args = [a for a in args if a != 1] or [sympy.Integer(1)]
        if len(args) == 1:
            return args[0]
    with evaluate(False):
        return expr.func(*args)


def split_equation(text: str):
    parts = EQUALS.split(prep(text))
    if len(parts) != 2:
        return None
    return parts[0].strip(), parts[1].strip()


def strip_function_label(text: str) -> str:
    """'y = 2x+1', 'f(x) = 2x+1' → '2x+1' (the left side is only a label)."""
    parts = split_equation(text)
    if parts and re.fullmatch(r"\s*(y|[a-zA-Z]\s*\(\s*x\s*\))\s*", parts[0]):
        return parts[1]
    return prep(text)


def tex(expr, *, keep_order: bool = False) -> str:
    """LaTeX for display. keep_order preserves the as-typed term order
    for unevaluated step-by-step expressions."""
    if isinstance(expr, (list, tuple)):
        return ", ".join(tex(e, keep_order=keep_order) for e in expr)
    from . import units  # here: units uses this module

    if units.has_units(expr):
        return units.latex(expr, number_tex=lambda n: tex(n, keep_order=keep_order))
    if keep_order:
        text = sympy.latex(expr, order="none")
        # subtracting/adding a negative reads as "- (-4)", not "- -4"
        text = re.sub(r"([-+]) -(\d+(?:\.\d+)?|\\frac\{[^}]*\}\{[^}]*\})", r"\1 \\left(-\2\\right)", text)
        text = re.sub(r"\\cdot -(\d+(?:\.\d+)?)", r"\\cdot \\left(-\1\\right)", text)
        return text
    return sympy.latex(expr)


def ptex(expr) -> str:
    """LaTeX with terms in descending degree (textbook order: -2x/3 + 2)."""
    return sympy.latex(expr, order="lex")


def tex_eq(lhs, rhs, *, keep_order: bool = False, rel: str = "=") -> str:
    return f"{tex(lhs, keep_order=keep_order)} {rel} {tex(rhs, keep_order=keep_order)}"


def num(value) -> float | None:
    """Float value of a sympy number, or None if it isn't a finite real."""
    try:
        v = complex(sympy.N(value))
    except (TypeError, ValueError):
        return None
    if abs(v.imag) > 1e-12 or v.real != v.real or abs(v.real) == float("inf"):
        return None
    return v.real


def pretty_number(value) -> str:
    """Exact form, plus a decimal when the exact form isn't already one."""
    value = sympy.nsimplify(value) if isinstance(value, float) else value
    exact = tex(value)
    approx = num(value)
    if approx is None or value.is_Integer or (value.is_Rational and value.q in (1,)):
        return exact
    decimal = f"{approx:.4f}".rstrip("0").rstrip(".")
    if value.is_Float or exact == decimal:
        return decimal
    return f"{exact} \\approx {decimal}"


def step(note: str, latex: str) -> dict:
    return {"note": note, "latex": latex}


def no_eval():
    return evaluate(False)


def sign_word(value, positive: str, negative: str) -> tuple[str, object]:
    """('Subtract', 5) for 5, ('Add', 5) for -5 — phrasing for moving a term."""
    is_neg = value.could_extract_minus_sign() if hasattr(value, "could_extract_minus_sign") else value < 0
    return (negative, -value) if is_neg else (positive, value)


__all__ = [
    "Abs", "EQUALS", "INEQUALITY", "MathInputError", "TRANSFORMS", "X", "Y",
    "build_scope", "no_eval", "ptex", "num", "parse", "prep", "pretty_number", "sign_word",
    "split_equation", "step", "strip_function_label", "tex", "tex_eq",
]
