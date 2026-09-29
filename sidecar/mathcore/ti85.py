"""A home screen that computes the way a TI-85 does — our own
implementation of its published behavior, no TI firmware involved.

What makes it feel like a TI-85 rather than generic math:
  • its order of operations (TI-85 guidebook, "Equation Operating System"):
      1. functions after the value: x², x⁻¹, !, %
      2. powers and roots: ^, x√  — evaluated LEFT to right (2^3^2 = 64)
      3. functions before the value: √, sin, log, ln, ⁻ (negation) …
      4. nPr, nCr
      5. implied multiplication — tighter than × ÷, so 1/2x = 1/(2x)
      6. * /      7. + -      8. relations (==, <, … give 1 or 0)
  • 12 significant digits on screen, ⁻ for negatives, E for exponents
  • complex results as (real,imag) pairs:  √⁻4 → (0,2)
  • MODE: Normal/Sci/Eng, Float/Fix 0–11, Radian/Degree
  • its error screens: ERROR 02 DIV BY ZERO, ERROR 07 SYNTAX …"""

import math
import random
import re

import sympy

from .parsing import MathInputError

# ------------------------------------------------------------------ errors

ERRORS = {"overflow": "01 OVERFLOW", "div": "02 DIV BY ZERO", "domain": "04 DOMAIN", "syntax": "07 SYNTAX", "undefined": "14 UNDEFINED"}


class TIError(MathInputError):
    def __init__(self, kind: str):
        super().__init__(f"ERROR {ERRORS[kind]}")
        self.kind = kind


# ------------------------------------------------------------------ tokens

PREFIX = {
    "sin⁻¹": "asin", "cos⁻¹": "acos", "tan⁻¹": "atan", "sinh⁻¹": "asinh", "cosh⁻¹": "acosh", "tanh⁻¹": "atanh",
    "sin": "sin", "cos": "cos", "tan": "tan", "sinh": "sinh", "cosh": "cosh", "tanh": "tanh",
    "log": "log", "ln": "ln", "√": "sqrt", "abs": "abs", "iPart": "ipart", "fPart": "fpart", "int": "int", "sign": "sign",
    "10^": "tenpow", "ℯ^": "exp",
}
CALLS = {"round": 2, "min": 2, "max": 2, "mod": 2, "lcm": 2, "gcd": 2}
_NAMES = sorted(list(PREFIX) + list(CALLS) + ["nPr", "nCr", "x√", "Ans", "►Frac", "rand"], key=len, reverse=True)
_NUMBER = re.compile(r"(\d+\.?\d*|\.\d+)(ᴇ⁻?\d+)?")
_SYMBOLS = ["°", "ʳ", "==", "≠", "≤", "≥", "<", ">", "→", "²", "⁻¹", "⁻", "!", "%", "^", "*", "/", "+", "-", "(", ")", ",", "π"]


def tokenize(text: str) -> list[tuple[str, str]]:
    # ⁽ ⁾ seal a fraction made with the fraction key into one unit, so
    # typing after it multiplies the whole fraction (¾ then 5 is ¾·5)
    text = text.replace("⁽", "(").replace("⁾", ")")
    text = text.replace("×", "*").replace("÷", "/").replace("−", "-").replace("<=", "≤").replace(">=", "≥").replace("!=", "≠")
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        name = next((n for n in _NAMES if text.startswith(n, i)), None)
        if name and not (name[0].isalpha() and i + len(name) < len(text) and text[i + len(name)].isalpha() and name not in ("nPr", "nCr")):
            out.append(("name" if name not in ("nPr", "nCr", "x√") else "op", name))
            i += len(name)
            continue
        if m := _NUMBER.match(text, i):
            out.append(("num", m.group(0)))
            i = m.end()
            continue
        # symbols first: π, ʳ and friends count as "letters" to Python
        sym = next((s for s in _SYMBOLS if text.startswith(s, i)), None)
        if sym is not None:
            out.append(("op", sym))
            i += len(sym)
            continue
        if (c.isascii() and c.isalpha()) or c == "θ":
            m = re.match(r"[A-Za-zθ][A-Za-z0-9θ]*", text[i:])
            out.append(("var", m.group(0)))
            i += len(m.group(0))
            continue
        raise TIError("syntax")
    return out


# ------------------------------------------------------------------ parser → numbers
# evaluates straight to Python complex numbers, with 14-digit-ish precision
# like the TI-85's internal arithmetic


class Evaluator:
    def __init__(self, tokens, variables: dict, ans, degrees: bool):
        self.t = tokens
        self.i = 0
        self.vars = variables
        self.ans = ans
        self.deg = degrees

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else ("end", "")

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def at(self, *ops) -> bool:
        k, v = self.peek()
        return k in ("op", "name") and v in ops

    def run(self):
        if not self.t:
            raise TIError("syntax")
        value = self.relation()
        if self.peek()[0] != "end":
            raise TIError("syntax")
        return value

    # 8. relations → 1 / 0
    def relation(self):
        left = self.sum()
        while self.at("==", "≠", "<", ">", "≤", "≥"):
            op = self.take()[1]
            right = self.sum()
            a, b = real(left), real(right)
            left = complex(float({"==": a == b, "≠": a != b, "<": a < b, ">": a > b, "≤": a <= b, "≥": a >= b}[op]))
        return left

    # 7. + -
    def sum(self):
        value = self.product()
        while self.at("+", "-"):
            op = self.take()[1]
            rhs = self.product()
            value = value + rhs if op == "+" else value - rhs
        return value

    # 6. * /
    def product(self):
        value = self.implied()
        while self.at("*", "/"):
            op = self.take()[1]
            rhs = self.implied()
            if op == "/":
                if rhs == 0:
                    raise TIError("div")
                value = value / rhs
            else:
                value = value * rhs
        return value

    # 5. implied multiplication — tighter than * and /
    def starts_value(self) -> bool:
        k, v = self.peek()
        return k in ("num", "var") or (k == "name" and v not in ("►Frac",)) or (k == "op" and v in ("(", "π", "⁻"))

    def implied(self):
        value = self.perm()
        while self.starts_value():
            value = value * self.perm()
        return value

    # 4. nPr nCr
    def perm(self):
        value = self.prefix()
        while self.at("nPr", "nCr"):
            op = self.take()[1]
            r = self.prefix()
            n, k = integer(value), integer(r)
            if k < 0 or n < 0 or k > n:
                raise TIError("domain")
            value = complex(math.perm(n, k) if op == "nPr" else math.comb(n, k))
        return value

    # 3. functions before the value, and negation
    def prefix(self):
        if self.at("⁻"):
            self.take()
            return negate(self.prefix())
        k, v = self.peek()
        if k == "name" and v in PREFIX:
            self.take()
            return self.apply(PREFIX[v], self.prefix())
        return self.power()

    # 2. ^ and x√ — left to right, like the TI-85
    def power(self):
        value = self.postfix()
        while self.at("^", "x√"):
            op = self.take()[1]
            rhs = self.prefix_operand()
            if op == "^":
                value = tipow(value, rhs)
            else:  # 3x√8: the 3rd root of 8
                value = tiroot(rhs, value)
        return value

    def prefix_operand(self):
        # the exponent may itself be negated or a prefix function: 2^⁻1, 2^√4
        if self.at("⁻"):
            self.take()
            return negate(self.prefix_operand())
        k, v = self.peek()
        if k == "name" and v in PREFIX:
            self.take()
            return self.apply(PREFIX[v], self.prefix_operand())
        return self.postfix()

    # 1. functions after the value
    def postfix(self):
        value = self.atom()
        while self.at("²", "⁻¹", "!", "%", "°", "ʳ"):
            op = self.take()[1]
            if op == "²":
                value = value * value
            elif op == "⁻¹":
                if value == 0:
                    raise TIError("div")
                value = 1 / value
            elif op == "!":
                n = real(value)
                if n < 0 or n != int(n) or n > 449:
                    raise TIError("domain" if n <= 449 else "overflow")
                value = complex(math.factorial(int(n)))
            elif op == "°":  # 30° means degrees whatever the mode
                value = value * math.pi / 180 if not self.deg else value
            elif op == "ʳ":  # 1ʳ means radians whatever the mode
                value = value * 180 / math.pi if self.deg else value
            else:
                value = value / 100
        return value

    def atom(self):
        k, v = self.take()
        if k == "num":
            mantissa, _, exponent = v.partition("ᴇ")
            return complex(float(mantissa) * 10 ** int(exponent.replace("⁻", "-") or 0))
        if k == "var":
            if v in self.vars:
                return self.vars[v]
            raise TIError("undefined")
        if k == "name":
            if v == "Ans":
                return self.ans
            if v == "rand":
                return complex(random.random())
            if v in CALLS:
                if not self.at("("):
                    raise TIError("syntax")
                self.take()
                args = [self.relation()]
                while self.at(","):
                    self.take()
                    args.append(self.relation())
                if self.at(")"):
                    self.take()
                if len(args) != CALLS[v]:
                    raise TIError("syntax")
                return self.call(v, args)
            raise TIError("syntax")
        if k == "op" and v == "π":
            return complex(math.pi)
        if k == "op" and v == "(":
            value = self.relation()
            if self.at(")"):  # like a TI, a missing ) at the end is fine
                self.take()
            return value
        raise TIError("syntax")

    # -------------------------------------------------------------- functions

    def angle_in(self, x):
        return x * math.pi / 180 if self.deg else x

    def angle_out(self, x):
        return x * 180 / math.pi if self.deg else x

    def apply(self, fn: str, x: complex) -> complex:
        import cmath

        if fn in ("sin", "cos", "tan"):
            r = real(x)
            if fn == "tan" and self.deg and (r - 90) % 180 == 0:
                raise TIError("domain")
            value = {"sin": math.sin, "cos": math.cos, "tan": math.tan}[fn](self.angle_in(r))
            return complex(clean(value))
        if fn in ("asin", "acos", "atan"):
            f = {"asin": cmath.asin, "acos": cmath.acos, "atan": cmath.atan}[fn]
            v = f(x)
            return complex(self.angle_out(v.real), v.imag) if abs(v.imag) < 1e-15 else v
        if fn in ("sinh", "cosh", "tanh", "asinh", "acosh", "atanh"):
            return getattr(cmath, fn)(x)
        if fn == "sqrt":
            return cmath.sqrt(x)
        if fn in ("log", "ln"):
            if x == 0:
                raise TIError("domain")
            return cmath.log10(x) if fn == "log" else cmath.log(x)
        if fn == "tenpow":
            return tipow(complex(10), x)
        if fn == "exp":
            return cmath.exp(x)
        if fn == "abs":
            return complex(abs(x))
        r = real(x)
        if fn == "ipart":
            return complex(math.trunc(r))
        if fn == "fpart":
            return complex(r - math.trunc(r))
        if fn == "int":
            return complex(math.floor(r))
        if fn == "sign":
            return complex((r > 0) - (r < 0))
        raise TIError("syntax")

    def call(self, fn: str, args: list) -> complex:
        a = [real(v) for v in args]
        if fn == "round":
            return complex(round(a[0], int(a[1])))
        if fn == "min":
            return complex(min(a))
        if fn == "max":
            return complex(max(a))
        if fn == "mod":
            if a[1] == 0:
                raise TIError("div")
            return complex(a[0] % a[1])
        if fn in ("lcm", "gcd"):
            x, y = integer(args[0]), integer(args[1])
            return complex(math.lcm(x, y) if fn == "lcm" else math.gcd(x, y))
        raise TIError("syntax")


def negate(x: complex) -> complex:
    """-x without a negative-zero imaginary part — otherwise √⁻4 would land
    on the wrong side of the branch cut and show (0,⁻2)."""
    return complex(-x.real, -x.imag + 0.0)


def real(x: complex) -> float:
    if abs(x.imag) > 1e-12:
        raise TIError("domain")  # a TI-85 won't compare or round complex numbers
    return x.real


def integer(x: complex) -> int:
    r = real(x)
    if r != int(r):
        raise TIError("domain")
    return int(r)


def clean(v: float) -> float:
    """sin 180° is 0, not 1.2E⁻16 — round away float dust like the TI does."""
    return 0.0 if abs(v) < 1e-13 else v


def tipow(base: complex, exp: complex) -> complex:
    if base == 0 and exp.real < 0:
        raise TIError("div")
    if exp.imag == 0 and exp.real == int(exp.real) and abs(exp.real) < 1e6:
        try:
            return complex(base) ** int(exp.real)
        except OverflowError:
            raise TIError("overflow")
    if base.imag == 0 and base.real < 0 and exp.imag == 0:
        # a real odd root of a negative (⁻8^(1/3) → ⁻2), as a TI-85 in real mode
        n = 1 / exp.real if exp.real else 0
        if n and abs(n - round(n)) < 1e-9 and round(n) % 2 == 1:
            return complex(-((-base.real) ** exp.real))
    try:
        return base ** exp
    except (OverflowError, ZeroDivisionError):
        raise TIError("overflow")


def tiroot(value: complex, n: complex) -> complex:
    if n == 0:
        raise TIError("div")
    return tipow(value, 1 / n)


# ------------------------------------------------------------------ display


def _num(x: float, fmt: str, digits: int | None) -> str:
    if x == 0:
        return "0" if digits is None else f"{0:.{digits}f}"
    if not math.isfinite(x) or abs(x) >= 1e1000:
        raise TIError("overflow")
    exp = math.floor(math.log10(abs(x)))
    if fmt == "normal" and -3 <= exp < 12:
        text = f"{x:.{digits}f}" if digits is not None else f"{x:.12g}"
        if "e" in text:  # %g chose sci — fall through to sci
            fmt = "sci"
        else:
            return text.replace("-", "⁻")
    if fmt == "eng":
        exp3 = exp - exp % 3
        mant = x / 10**exp3
        m = f"{mant:.{digits}f}" if digits is not None else f"{mant:.12g}"
        return f"{m}E{exp3}".replace("-", "⁻")
    mant = x / 10**exp
    if abs(round(mant, 11)) >= 10:
        mant /= 10
        exp += 1
    m = f"{mant:.{digits}f}" if digits is not None else f"{mant:.12g}"
    return f"{m}E{exp}".replace("-", "⁻")


def display(value: complex, fmt: str = "normal", digits: int | None = None) -> str:
    re_, im = round(value.real, 13), round(value.imag, 13)
    if abs(im) > 1e-12 * max(1, abs(re_)):
        return f"({_num(re_, fmt, digits)},{_num(im, fmt, digits)})"
    return _num(re_, fmt, digits)


def as_fraction(value: complex) -> str:
    """►Frac: the simplest fraction within the TI's precision, or the decimal."""
    r = real(value)
    frac = sympy.nsimplify(r, rational=True, tolerance=1e-12)
    if frac.q > 10000:
        return display(value)
    return (f"{frac.p}/{frac.q}" if frac.q != 1 else str(frac.p)).replace("-", "⁻")


def plain(value: complex) -> str:
    """Ans / stored values, for the next calculation."""
    return repr(value)


# ------------------------------------------------------------------ op


def op_ti(req: dict) -> dict:
    """Evaluate one home-screen entry. Returns what the screen shows, and
    any value stored with →."""
    entry = (req.get("entry") or "").strip()
    mode = req.get("mode") or {}
    variables = {k: complex(v) for k, v in (req.get("vars") or {}).items()}
    ans = complex(req.get("ans") or 0)
    degrees = mode.get("angle") == "deg"
    store = None
    if "→" in entry:
        entry, _, target = entry.rpartition("→")
        target = target.strip()
        if not re.fullmatch(r"[A-Za-zθ][A-Za-z0-9θ]{0,7}", target):
            raise TIError("syntax")
        store = target
    as_frac = entry.endswith("►Frac")
    if as_frac:
        entry = entry[: -len("►Frac")]
    try:
        value = Evaluator(tokenize(entry), variables, ans, degrees).run()
    except TIError:
        raise
    except (OverflowError, ValueError):
        raise TIError("overflow")
    except (ZeroDivisionError,):
        raise TIError("div")
    fmt = mode.get("format", "normal")
    digits = mode.get("digits")
    if as_frac:
        shown = as_fraction(value)
    elif req.get("frac_auto") and abs(value.imag) < 1e-12 and value.real != int(value.real):
        # "answers as fractions": a clean fraction if there is one, else the decimal
        shown = as_fraction(value)
    else:
        shown = display(value, fmt, digits)
    return {"result": shown, "value": plain(value), "store": store}
