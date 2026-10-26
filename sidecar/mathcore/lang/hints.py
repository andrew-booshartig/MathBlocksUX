"""What went wrong in a line that doesn't read, said the way it looks on
the page — "something's missing between “+” and “≥”" rather than "didn't
expect ge". Both readers (LaTeX and the text languages) ask here once they
know the token they tripped on and the one just before it."""

# a token as it's written (LaTeX commands and ASCII spellings → the sign)
_SHOWN = {
    "ge": "≥", "geq": "≥", "geqslant": "≥", ">=": "≥",
    "le": "≤", "leq": "≤", "leqslant": "≤", "<=": "≤",
    "ne": "≠", "neq": "≠", "!=": "≠",
    "lt": "<", "gt": ">",
    "cdot": "·", "times": "×", "div": "÷", "-": "−", "pm": "±", "mp": "∓",
    "right": ")", "mright": ")", "rvert": "|",
}
_RELATIONS = {"=", "==", "<", ">", "≤", "≥", "≠", "~=", "/="}
_OPERATORS = {"+", "−", "*", "×", "·", "÷", "/", "^", "**", "^^", "±", "∓"}
_OPENERS = {"(": ")", "[": "]"}
_CLOSERS = {")": "(", "]": "["}
_WORDS = {"or", "and", "||", "&&"}
# a sign whose left-hand side is missing gets an example of it written out
_EXAMPLE = {"×": "2 × 3", "·": "2 · 3", "÷": "6 ÷ 3", "/": "6 / 3", "^": "x^2", "**": "x**2", "*": "2*3"}


def shown(token: str | None) -> str | None:
    if token is None:
        return None
    if token.lower() in ("or", "and"):
        return token.lower()
    return _SHOWN.get(token, token)


def unexpected(before: str | None, found: str) -> str:
    """`found` where a number, a letter or a bracket should be; `before` is
    the token just before it (None at the start of the line)."""
    b, f = shown(before), shown(found)
    q = lambda s: f"“{s}”"  # noqa: E731
    if b in _RELATIONS and f in _RELATIONS:
        return f"two relation signs in a row ({q(b)} then {q(f)}) — keep just one"
    if b in _OPERATORS and f in _OPERATORS:
        return f"two signs in a row ({q(b)} then {q(f)}) — one is extra, or something's missing between them"
    if b in _OPERATORS and f in _RELATIONS:
        return f"something's missing between {q(b)} and {q(f)} — a number or a letter goes there (or the {q(b)} is extra)"
    if b in _OPERATORS | _RELATIONS:
        if f == "}":  # the end of a box (a fraction's top, an exponent): invisible on the page
            return f"something's missing after {q(b)}"
        return f"something's missing between {q(b)} and {q(f)}"
    if b in (None, *_OPENERS, *_WORDS):
        if f in _RELATIONS:
            return f"{q(f)} needs something on its left — like x {f} 3"
        if f in _OPERATORS:
            return f"{q(f)} needs something on its left — like {_EXAMPLE.get(f, f'2 {f} 3')}"
        if f in _WORDS:
            return f"{q(f)} goes between two parts — like x < −2 {f} x > 5"
    if b in _OPENERS and f in _CLOSERS:
        return f"the brackets are empty — put something between {q(b)} and {q(f)}"
    if f in _CLOSERS:
        return f"there's a {q(f)} without a {q(_CLOSERS[f])} before it — add one, or delete the {q(f)}"
    if f in _WORDS:
        return f"{q(f)} goes between two parts — like x < −2 {f} x > 5"
    return f"didn't expect {q(f)} here"


def missing(before: str | None) -> str:
    """The line stops early, right after `before`."""
    b = shown(before)
    q = lambda s: f"“{s}”"  # noqa: E731
    if b is None:
        return "nothing typed yet"
    if b in _RELATIONS:
        return f"something's missing after {q(b)} — what's on the other side?"
    if b in _WORDS:
        return f"something's missing after {q(b)} — the second part"
    if b in _OPERATORS:
        return f"something's missing after {q(b)}"
    if b in _OPENERS:
        return f"a {q(b)} isn't closed — add {q(_OPENERS[b])}"
    return "it isn't finished yet"
