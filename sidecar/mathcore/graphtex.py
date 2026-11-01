"""Graph lines as they're typed (LaTeX, from a math field) → sympy.

The grapher's own reader, made for what gets graphed in college — every
function family (trig and its inverses, sec/csc/cot, hyperbolic, ln, log
and log with a base, floor/ceiling, |x|, min/max), derivatives (f'(x),
d/dx), integrals and sums, piecewise definitions (cases), restrictions in
braces (y = x² {0 ≤ x ≤ 2}), points and parametric pairs, θ for polar,
and functions defined on another line (f(x) = …, then f(2), f'(x)).
Geometry too: points by name (A = (1, 2), then A.x) and what's built on
them — segment(A, B), line, ray, vector, circle, polygon, angle,
midpoint, distance, perpendicular, parallel (see geometry.py).

2x means 2·x, sin 2x means sin(2x), and a letter that isn't a function's
name is a letter: m(x + 1) is m·(x + 1)."""

from __future__ import annotations

import dataclasses
import re

import sympy
from sympy import Integer, Rational, Symbol

from .parsing import MathInputError

X, Y, T, R = Symbol("x"), Symbol("y"), Symbol("t"), Symbol("r")
THETA = Symbol("theta")
DYDX = Symbol("DYDX")  # dy/dx (or y'): a slope field's left side

_TOKEN = re.compile(
    r"(?P<ws>\s+|\\[,;:! ]|\\q?quad\b)"
    r"|(?P<num>\d+\.?\d*|\.\d+)"
    r"|(?P<cmd>\\[a-zA-Z]+|\\[{}|\\])"
    r"|(?P<sym><=|>=|!=|[-+*/^_()\[\]{}|,=<>!'&~:;.])"
    r"|(?P<id>[a-zA-Z])"
    r"|(?P<uni>[πθ·×÷≤≥≠−∞])"
)
_UNICODE = {"π": ("cmd", "\\pi"), "θ": ("cmd", "\\theta"), "·": ("sym", "*"), "×": ("sym", "*"), "÷": ("sym", "/"), "≤": ("sym", "<="), "≥": ("sym", ">="), "≠": ("sym", "!="), "−": ("sym", "-"), "∞": ("cmd", "\\infty")}
_AS_SYM = {
    "\\cdot": "*", "\\times": "*", "\\ast": "*", "\\div": "/",
    "\\le": "<=", "\\leq": "<=", "\\leqslant": "<=", "\\ge": ">=", "\\geq": ">=", "\\geqslant": ">=",
    "\\lt": "<", "\\gt": ">", "\\ne": "!=", "\\neq": "!=",
    "\\{": "LB", "\\}": "RB", "\\lbrace": "LB", "\\rbrace": "RB", "\\\\": "ROW", "\\|": "|", "\\vert": "|", "\\mid": "|",
    "\\lfloor": "LFLOOR", "\\rfloor": "RFLOOR", "\\lceil": "LCEIL", "\\rceil": "RCEIL", "\\prime": "'",
}
_GREEK = {"alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega"}

_F = sympy.Function
_FUNCS = {
    "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan, "sec": sympy.sec, "csc": sympy.csc, "cot": sympy.cot,
    "arcsin": sympy.asin, "arccos": sympy.acos, "arctan": sympy.atan, "arcsec": sympy.asec, "arccsc": sympy.acsc, "arccot": sympy.acot,
    "asin": sympy.asin, "acos": sympy.acos, "atan": sympy.atan,
    "sinh": sympy.sinh, "cosh": sympy.cosh, "tanh": sympy.tanh, "sech": sympy.sech, "csch": sympy.csch, "coth": sympy.coth,
    "arcsinh": sympy.asinh, "arccosh": sympy.acosh, "arctanh": sympy.atanh, "arsinh": sympy.asinh, "arcosh": sympy.acosh, "artanh": sympy.atanh,
    "asinh": sympy.asinh, "acosh": sympy.acosh, "atanh": sympy.atanh,
    "ln": sympy.log, "exp": sympy.exp, "sqrt": sympy.sqrt, "abs": sympy.Abs,
    "sign": sympy.sign, "sgn": sympy.sign, "floor": sympy.floor, "ceil": sympy.ceiling, "ceiling": sympy.ceiling,
    "erf": sympy.erf, "gamma": sympy.gamma,
}
# geometry's words, typed whole (\operatorname{segment}) or letter by letter
GEOMETRY = (
    "segment", "line", "ray", "vector", "circle", "polygon", "angle", "perpendicular", "parallel", "midpoint", "distance",
    "intersection", "reflect", "rotate", "translate", "dilate", "arc", "sector", "semicircle", "bisector", "tangent",
    "length", "area", "perimeter", "slope", "point", "locus",
)
_SPELLED = sorted(GEOMETRY, key=len, reverse=True)
_INVERSE = {"sin": "arcsin", "cos": "arccos", "tan": "arctan", "sec": "arcsec", "csc": "arccsc", "cot": "arccot", "sinh": "arcsinh", "cosh": "arccosh", "tanh": "arctanh"}


def _braced(text: str, i: int, what: str) -> tuple[str, int]:
    """{…} at text[i] (after spaces), braces inside and all: what's in it, and where it ends"""
    j = i
    while j < len(text) and text[j].isspace():
        j += 1
    if j >= len(text) or text[j] != "{":
        raise MathInputError(f"{what} needs {{…}}")
    depth = 0
    for k in range(j, len(text)):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        if depth == 0:
            return text[j + 1 : k], k + 1
    raise MathInputError(f"{what}'s {{ isn't closed")


def tokenize(latex: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    i = 0
    text = latex.replace("\\left.", "").replace("\\right.", "")
    while i < len(text):
        m = _TOKEN.match(text, i)
        if not m:
            raise MathInputError(f"didn't expect “{text[i]}” here")
        i = m.end()
        kind = m.lastgroup
        value = m.group(kind)
        if kind == "ws":
            continue
        if kind == "uni":
            kind, value = _UNICODE[value]
        if kind == "cmd":
            if value in ("\\left", "\\right", "\\big", "\\Big", "\\bigg", "\\Bigg", "\\displaystyle", "\\limits"):
                continue
            if value in _AS_SYM:
                kind, value = "sym", _AS_SYM[value]
            elif value in ("\\text", "\\mathrm", "\\operatorname", "\\mathit", "\\textrm", "\\mathbf"):
                # its name, read whole: \operatorname{sign}, \text{ and } — and as
                # MathLive saves one once it's edited: \operatorname{\mathrm{line}}
                inner, i = _braced(text, i, value)
                kind, value = "name", re.sub(r"\\[a-zA-Z]+|[{}]", "", inner).strip()
            elif value in ("\\begin", "\\end"):
                m2 = re.match(r"\s*\{([a-z*]+)\}", text[i:])
                if not m2:
                    raise MathInputError(f"{value} needs {{…}}")
                i += m2.end()
                kind, value = value[1:], m2.group(1)
        out.append((kind, value))
    return out


@dataclasses.dataclass
class Parsed:
    """one graph line, read: a relation's sides and its operators (no
    operators: just an expression), restrictions, or a list of points"""

    sides: list
    ops: list[str]
    conditions: list
    tuples: list | None = None  # (a, b), (c, d) … at the top level
    define: tuple[str, list[Symbol]] | None = None  # f(x) = … : its name and parameters
    name: str | None = None  # A = (1, 2), s = segment(A, B): what it's called
    computed: bool = False  # built by geometry (midpoint, intersection…), not typed in
    glide: str | None = None  # point(shape, t): the letter that slides it along


class Reader:
    def __init__(self, tokens, functions: dict | None = None, consts: set | None = None, points: dict | None = None):
        self.t = tokens
        self.i = 0
        self.functions = functions or {}  # name → (params, body)
        self.points = points or {}  # name → a point (a Tuple) or a shape, from its own line
        self.abs_depth = 0
        self.consts = consts or set()

    # ---- the tokens

    def peek(self, k=0):
        j = self.i + k
        return self.t[j] if j < len(self.t) else (None, None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def at(self, kind, value=None, k=0):
        tk, tv = self.peek(k)
        return tk == kind and (value is None or tv == value)

    def expect(self, kind, value=None):
        if not self.at(kind, value):
            got = self.peek()[1]
            raise MathInputError(f"expected “{value or kind}”" + (f", not “{got}”" if got else " at the end"))
        return self.take()

    # ---- relations and the line

    REL = {"=", "<", ">", "<=", ">=", "!="}

    def relation(self):
        """a, or a < b, or 0 ≤ x ≤ 2 — as the sides and their operators"""
        sides = [self.sum()]
        ops = []
        while self.at("sym") and self.peek()[1] in self.REL:
            ops.append(self.take()[1])
            sides.append(self.sum())
        return sides, ops

    def condition(self):
        """a restriction or a piecewise case's condition, as sympy logic"""
        if self.at("name") and self.peek()[1].lower() in ("otherwise", "else"):
            self.take()
            return sympy.true
        parts = [self._condition_one()]
        while self.at("sym", ",") or (self.at("name") and self.peek()[1].strip().lower() == "and"):
            self.take()
            parts.append(self._condition_one())
        return sympy.And(*parts) if len(parts) > 1 else parts[0]

    def _condition_one(self):
        sides, ops = self.relation()
        if not ops:
            raise MathInputError("a restriction needs <, >, ≤ or ≥ — like {0 ≤ x ≤ 2}")
        return sympy.And(*[_rel(sides[k], op, sides[k + 1]) for k, op in enumerate(ops)])

    # ---- sums, terms, powers

    def sum(self):
        left = self.term()
        while self.at("sym", "+") or self.at("sym", "-"):
            op = self.take()[1]
            right = self.term()
            left = left + right if op == "+" else left - right
        return left

    def starts_factor(self) -> bool:
        kind, value = self.peek()
        if kind in ("num", "id", "begin"):
            return True
        if kind == "name":
            return value.strip().lower() not in ("and", "or", "otherwise", "else")
        if kind == "cmd":
            return value not in ("\\to",)
        if kind == "sym":
            if value == "|":
                return self.abs_depth == 0
            return value in ("(", "[", "{", "LFLOOR", "LCEIL")
        return False

    def term(self, stop_at_function=False):
        left = self.unary()
        while True:
            if self.at("sym", "*"):
                self.take()
                left = left * self.unary()
            elif self.at("sym", "/"):
                self.take()
                left = left / self.unary()
            elif self.starts_factor():
                if stop_at_function and self._function_next():
                    break
                left = left * self.unary(implicit=True)
            else:
                break
        return left

    def _function_next(self) -> bool:
        kind, value = self.peek()
        return (kind == "cmd" and value[1:] in _FUNCS | {"log": 0}) or (kind == "name" and value in _FUNCS)

    def unary(self, implicit=False):
        if self.at("sym", "-"):
            self.take()
            return -self.unary()
        if self.at("sym", "+"):
            self.take()
            return self.unary()
        return self.power()

    def power(self):
        base = self.postfix()
        if self.at("sym", "^"):
            self.take()
            exp = self.script()
            return base**exp
        return base

    def script(self):
        """what's after ^ or _: {…}, or one thing"""
        if self.at("sym", "-"):
            self.take()
            return -self.script()
        if self.at("sym", "{") or self.at("num"):
            return self.arg()
        return self.postfix()

    def arg(self):
        """one argument, the TeX way: {…} or a single character — \\frac23 is
        2/3 and x^23 is x²·3 (MathLive writes one-digit parts without braces)"""
        if self.at("sym", "{"):
            self.take()
            return self.group()
        kind, value = self.peek()
        if kind == "num":
            if len(value) > 1 and "." not in value:
                # one digit; the rest is still there for what follows
                self.t[self.i] = ("num", value[1:])
                return Integer(value[0])
            self.take()
            return Rational(value) if "." in value else Integer(value)
        return self.primary()

    def postfix(self):
        value = self.primary()
        while self.at("sym", "!"):
            self.take()
            value = sympy.factorial(value)
        return value

    # ---- the pieces

    def group(self, close="}"):
        value = self.sum()
        self.expect("sym", close)
        return value

    def primary(self):
        kind, value = self.peek()
        if kind == "num":
            self.take()
            return Rational(value) if "." in value else Integer(value)
        if kind == "sym":
            if value in ("(", "["):
                self.take()
                close = ")" if value == "(" else "]"
                first = self.sum()
                if self.at("sym", ","):
                    items = [first]
                    while self.at("sym", ","):
                        self.take()
                        items.append(self.sum())
                    self.expect("sym", close)
                    return sympy.Tuple(*items)
                self.expect("sym", close)
                return first
            if value == "{":
                self.take()
                return self.group("}")
            if value == "|":
                self.take()
                self.abs_depth += 1
                inner = self.sum()
                self.abs_depth -= 1
                self.expect("sym", "|")
                return sympy.Abs(inner)
            if value == "LFLOOR":
                self.take()
                inner = self.sum()
                self.expect("sym", "RFLOOR")
                return sympy.floor(inner)
            if value == "LCEIL":
                self.take()
                inner = self.sum()
                self.expect("sym", "RCEIL")
                return sympy.ceiling(inner)
        if kind == "begin" and value == "cases":
            self.take()
            return self.cases()
        if kind == "id":
            spelled = self._spelled()
            if spelled:
                self.i += len(spelled)
                return self.geometry(spelled)
            return self.letter()
        if kind == "name":
            self.take()
            name = value.strip()
            if name in GEOMETRY:
                return self.geometry(name)
            if name in _FUNCS or name == "log":
                return self.function(name)
            if name in self.functions:
                return self.call(name)
            if len(name) == 1:
                return Symbol(name)
            return Symbol(name.replace(" ", "_"))
        if kind == "cmd":
            return self.command()
        raise MathInputError(f"didn't expect “{value}” here" if value else "it ends too soon")

    def letter(self):
        name = self.take()[1]
        # a subscript makes one name: x_1, a_{n}
        if self.at("sym", "_"):
            self.take()
            sub = self._raw_script()
            name = f"{name}_{sub}"
        primes = 0
        while self.at("sym", "'"):
            self.take()
            primes += 1
        named = name + "'" * primes
        if named in self.points:
            value = self.points[named]
            # A.x, A.y: a point's coordinates
            if isinstance(value, sympy.Tuple) and self.at("sym", ".") and self.peek(1) in (("id", "x"), ("id", "y")):
                self.take()
                return value[0] if self.take()[1] == "x" else value[1]
            return value
        if name in self.functions and self.at("sym", "("):
            return self.call(name, primes)
        if primes:
            if name == "y":
                return DYDX  # y' = …: a slope field
            raise MathInputError(f"{name}' needs {name}(x) defined on another line")
        if name == "e" and "e" not in self.consts:
            return sympy.E
        return Symbol(name)

    def _spelled(self) -> str | None:
        """segment( typed letter by letter: the word, when one is"""
        for word in _SPELLED:
            if self.at("sym", "(", len(word)) and all(self.at("id", ch, k) for k, ch in enumerate(word)):
                return word
        return None

    def geometry(self, name):
        from .geometry import build

        self.expect("sym", "(")
        args = [self.sum()]
        while self.at("sym", ","):
            self.take()
            args.append(self.sum())
        self.expect("sym", ")")
        self.built = True
        if name == "point" and len(args) == 2 and isinstance(args[1], Symbol):
            self.glide = str(args[1])
        return build(name, args)

    def _raw_script(self) -> str:
        if self.at("sym", "{"):
            self.take()
            parts = []
            while not self.at("sym", "}"):
                if self.peek()[0] is None:
                    raise MathInputError("a subscript's { isn't closed")
                parts.append(self.take()[1].lstrip("\\"))
            self.take()
            return "".join(parts)
        return self.take()[1].lstrip("\\")

    def call(self, name, primes=0):
        params, body = self.functions[name]
        self.expect("sym", "(")
        args = [self.sum()]
        while self.at("sym", ","):
            self.take()
            args.append(self.sum())
        self.expect("sym", ")")
        if len(args) != len(params):
            raise MathInputError(f"{name} takes {len(params)} input{'s' if len(params) != 1 else ''}")
        for _ in range(primes):
            body = sympy.diff(body, params[0])
        return body.subs(dict(zip(params, args)), simultaneous=True)

    def command(self):
        _, value = self.take()
        name = value[1:]
        if name == "pi":
            return sympy.pi
        if name == "infty":
            return sympy.oo
        if name in _GREEK:
            return Symbol(name.replace("var", ""))
        if name in ("frac", "dfrac", "tfrac"):
            return self.fraction()
        if name == "sqrt":
            if self.at("sym", "["):
                self.take()
                n = self.sum()
                self.expect("sym", "]")
                return _root(self.arg(), n)
            return sympy.sqrt(self.arg())
        if name in ("sum", "prod"):
            return self.series(name)
        if name == "int":
            return self.integral()
        if name in ("min", "max"):
            self.expect("sym", "(")
            args = [self.sum()]
            while self.at("sym", ","):
                self.take()
                args.append(self.sum())
            self.expect("sym", ")")
            return (sympy.Min if name == "min" else sympy.Max)(*args)
        if name in _FUNCS or name == "log":
            return self.function(name)
        raise MathInputError(f"didn't expect “\\{name}” here")

    def fraction(self):
        start = self.i
        # d/dx … : a derivative; dy/dx: a slope field's side
        top = self._braced_raw()
        bottom = self._braced_raw()
        if top == ["d"] and len(bottom) == 2 and bottom[0] == "d":
            var = Symbol(bottom[1])
            inner = self.power()
            return sympy.diff(inner, var)
        if top == ["d", "y"] and bottom == ["d", "x"]:
            return DYDX
        self.i = start
        num = self.arg()
        den = self.arg()
        return num / den

    def _braced_raw(self) -> list[str]:
        if not self.at("sym", "{"):
            return []
        depth, j, out = 0, self.i, []
        while j < len(self.t):
            kind, value = self.t[j]
            if (kind, value) == ("sym", "{"):
                depth += 1
                if depth > 1:
                    out.append("{")
            elif (kind, value) == ("sym", "}"):
                depth -= 1
                if depth == 0:
                    self.i = j + 1
                    return out
                out.append("}")
            else:
                out.append(value)
            j += 1
        raise MathInputError("a { isn't closed")

    def function(self, name):
        power = None
        base = None
        # \sin^2 x, \sin^{-1} x (that's arcsin), \log_2 x
        if self.at("sym", "^"):
            self.take()
            power = self.script()
        if self.at("sym", "_"):
            self.take()
            base = self.script()
        if self.at("sym", "^") and power is None:
            self.take()
            power = self.script()
        if power == -1 and name in _INVERSE:
            name, power = _INVERSE[name], None
        if self.at("sym", "("):
            self.take()
            arg = self.sum()
            self.expect("sym", ")")
        elif self.at("sym", "{"):
            self.take()
            arg = self.group()
        else:
            # sin 2x is sin(2x); sin x cos x is sin(x)·cos(x)
            arg = self.term(stop_at_function=True)
        if name == "log":
            value = sympy.log(arg, base) if base is not None else sympy.log(arg, 10)
        else:
            value = _FUNCS[name](arg)
        return value**power if power is not None else value

    def series(self, name):
        self.expect("sym", "_")
        self.expect("sym", "{")
        var = Symbol(self.expect("id")[1])
        self.expect("sym", "=")
        lo = self.group()
        self.expect("sym", "^")
        hi = self.script()
        body = self.term()
        lo_n, hi_n = sympy.nsimplify(lo), sympy.nsimplify(hi)
        if lo_n.is_Integer and hi_n.is_Integer and 0 <= hi_n - lo_n <= 2000:
            terms = [body.subs(var, k) for k in range(int(lo_n), int(hi_n) + 1)]
            return sympy.Add(*terms) if name == "sum" else sympy.Mul(*terms)
        done = (sympy.summation if name == "sum" else sympy.product)(body, (var, lo, hi))
        if done.has(sympy.Sum, sympy.Product):
            raise MathInputError("that sum can't be worked out — give it whole-number limits")
        return done

    def integral(self):
        lo = hi = None
        if self.at("sym", "_"):
            self.take()
            lo = self.script()
            self.expect("sym", "^")
            hi = self.script()
        # the integrand runs to d<letter> (dt, dx…)
        start = self.i
        depth = 0
        j = self.i
        end = None
        while j < len(self.t):
            kind, value = self.t[j]
            if kind == "sym" and value in ("(", "{", "["):
                depth += 1
            elif kind == "sym" and value in (")", "}", "]"):
                depth -= 1
            elif depth == 0 and kind == "id" and value == "d" and j + 1 < len(self.t) and self.t[j + 1][0] == "id":
                end = j
                break
            j += 1
        if end is None:
            raise MathInputError("an integral needs its d… at the end — like ∫ t dt")
        inner = Reader(self.t[start:end], self.functions, self.consts)
        body = inner.sum()
        var = Symbol(self.t[end + 1][1])
        self.i = end + 2
        if lo is None:
            done = sympy.integrate(body, var)
        else:
            done = sympy.integrate(body, (var, lo, hi))
        if done.has(sympy.Integral):
            raise MathInputError("that integral has no formula — try a simpler one")
        return done

    def cases(self):
        pieces = []
        while not self.at("end"):
            value = self.sum()
            self.expect("sym", "&")
            cond = self.condition()
            pieces.append((value, cond))
            if self.at("sym", "ROW"):
                self.take()
        self.take()
        return sympy.Piecewise(*pieces, (sympy.nan, True))


def _rel(a, op, b):
    return {"<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge, "=": sympy.Eq, "!=": sympy.Ne}[op](a, b)


def _root(inner, n):
    """the real nth root: ∛(−8) is −2, not a complex number"""
    n = sympy.nsimplify(n)
    if n.is_Integer and int(n) % 2 == 1:
        return sympy.sign(inner) * sympy.Abs(inner) ** (1 / n)
    return inner ** (1 / n)


_DEFINE = re.compile(r"^\s*([a-zA-Z])(?:_\{?([a-zA-Z0-9]+)\}?)?\s*(?:\\left)?\(\s*((?:[a-zA-Z]|\\theta)(?:\s*,\s*(?:[a-zA-Z]|\\theta))*)\s*(?:\\right)?\)\s*=")


def definition(latex: str):
    """f(x) = …: its name and parameters (y(x) = … and r(θ) = … aren't
    definitions — they're the curve itself)"""
    m = _DEFINE.match(latex)
    if not m or m.group(1) in ("x", "y"):
        return None
    name = m.group(1) + (f"_{m.group(2)}" if m.group(2) else "")
    params = [THETA if p.strip() == "\\theta" else Symbol(p.strip()) for p in m.group(3).split(",")]
    if name == "r" and params == [THETA]:
        return None
    return name, params, latex[m.end():]


_NAMING = re.compile(r"^\s*([a-zA-Z])(?:_\{?([a-zA-Z0-9]+)\}?)?((?:'|\^\{?\\prime\}?)*)\s*=(?![=<>])")


def naming(latex: str):
    """A = …: its name and what follows (x, y, r, t and e are the graph's own)"""
    m = _NAMING.match(latex)
    if not m or m.group(1) in ("x", "y", "r", "t", "e"):
        return None
    name = m.group(1) + (f"_{m.group(2)}" if m.group(2) else "") + "'" * m.group(3).count("'") + "'" * m.group(3).count("prime")
    return name, latex[m.end():]


def read_line(latex: str, functions: dict | None = None, consts: set | None = None, points: dict | None = None) -> Parsed:
    """a graph line → its relation, restrictions, points, or definition"""
    functions = functions or {}
    define = definition(latex)
    if define:
        name, params, body_latex = define
        reader = Reader(tokenize(body_latex), functions, consts, points)
        body = reader.sum()
        conditions = _restrictions(reader)
        _done(reader)
        return Parsed(sides=[Symbol("y"), body], ops=["="], conditions=conditions, define=(name, params))
    named = naming(latex)
    if named:
        # A = (1, 2) names a point, s = segment(A, B) a shape; anything else
        # (a = 3 …) reads as an equation, as before
        from .geometry import is_shape

        reader = Reader(tokenize(named[1]), functions, consts, points)
        value = reader.sum()
        # (and d = distance(A, B): a measurement, named to calculate with)
        measured = getattr(reader, "built", False) and not isinstance(value, sympy.Tuple) and not is_shape(value) and not value.has(X, Y)
        if isinstance(value, sympy.Tuple) or is_shape(value) or measured:
            conditions = _restrictions(reader)
            _done(reader)
            return Parsed(sides=[value], ops=[], conditions=conditions, tuples=[value] if isinstance(value, sympy.Tuple) else None, name=named[0], computed=getattr(reader, "built", False), glide=getattr(reader, "glide", None))
    reader = Reader(tokenize(latex), functions, consts, points)
    sides, ops = reader.relation()
    tuples = None
    if not ops and isinstance(sides[0], sympy.Tuple) and reader.at("sym", ","):
        tuples = [sides[0]]
        while reader.at("sym", ","):
            reader.take()
            item = reader.sum()
            if not isinstance(item, sympy.Tuple):
                raise MathInputError("a list of points: (1, 2), (3, 4)")
            tuples.append(item)
    elif not ops and isinstance(sides[0], sympy.Tuple):
        tuples = [sides[0]]
    conditions = _restrictions(reader)
    _done(reader)
    return Parsed(sides=sides, ops=ops, conditions=conditions, tuples=tuples, computed=getattr(reader, "built", False), glide=getattr(reader, "glide", None))


def _restrictions(reader: Reader) -> list:
    """{0 ≤ x ≤ 2}{y > 0} after the line"""
    out = []
    while reader.at("sym", "LB") or reader.at("sym", "{"):
        close = "RB" if reader.at("sym", "LB") else "}"
        reader.take()
        out.append(reader.condition())
        reader.expect("sym", close)
    return out


def _done(reader: Reader):
    if reader.i < len(reader.t):
        raise MathInputError(f"didn't expect “{reader.peek()[1]}” here")
