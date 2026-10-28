"""Reading and writing LaTeX — what the Visual editor produces and what
people type in the LaTeX language. Covers the notation of school algebra:
\\frac (incl. \\frac14), \\sqrt[n]{}, ^{}, _{}, \\left( \\right), |x|, \\cdot,
\\times, \\div, \\le/\\ge/\\ne, \\pm, \\pi, functions, \\text{ or }."""

import re

from ..parsing import MathInputError
from . import hints
from .ast import ATOMS, Add, Alts, Const, Div, Func, Group, Mixed, Mul, Neg, Node, Num, Pow, Rel, Sym, strip_group
from .text import Incomplete

_SKIP = {",", ";", "!", " ", ":", "quad", "qquad", "displaystyle", "textstyle", "limits", "nolimits"}
_REL = {"=": "=", "<": "<", ">": ">", "le": "<=", "leq": "<=", "leqslant": "<=", "ge": ">=", "geq": ">=", "geqslant": ">=",
        "ne": "!=", "neq": "!=", "lt": "<", "gt": ">"}
_FUNCS = {"sin": "sin", "cos": "cos", "tan": "tan", "arcsin": "asin", "arccos": "acos", "arctan": "atan", "ln": "ln", "log": "log", "exp": "exp"}
_OPERATORNAME = {"abs": "abs", "sqrt": "sqrt", **_FUNCS}

# Formatting that isn't math, in LaTeX pasted from a website: Khan Academy's
# colors (\maroonC{…}, \blueD{…}), \textcolor, \boxed, \cancel, bold.
# What's inside is kept, as it looks: 2\blueD{x+1} reads 2x + 1.
_WRAPPER = re.compile(
    r"\\(?:(?:blue|teal|green|gold|red|maroon|purple|mint|gray|pink)[A-I]|ka(?:Blue|Green)|boxed|[bx]?cancel|mathbf|boldsymbol|bold"
    r"|underline|(?:textcolor|colorbox|class|htmlClass)\{[^{}]*\})(?![A-Za-z])\s*\{"
)
_DELIMITERS = re.compile(r"^\s*(?:\$\$?|\\\(|\\\[)|(?:\$\$?|\\\)|\\\])\s*$")


def clean(text: str) -> str:
    """LaTeX as a website writes it, as plain math: no $…$ around it, no
    colors, boxes or spacing commands. (Running it twice changes nothing.)"""
    text = _DELIMITERS.sub("", text)
    while m := _WRAPPER.search(text):
        depth, j = 0, m.end() - 1
        while j < len(text):
            if text[j] == "{" and text[j - 1] != "\\":
                depth += 1
            elif text[j] == "}" and text[j - 1] != "\\":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        inner = text[m.end() : j]
        # a power or a subscript after it applies to all of it
        if text[j + 1 : j + 2] in ("^", "_"):
            inner = "{" + inner + "}"
        text = text[: m.start()] + inner + text[j + 1 :]
    text = re.sub(r"\\color\{[^{}]*\}|\\hspace\*?\{[^{}]*\}", "", text)
    # MathLive's lb (binary log) arrives as \operatorname{\mathrm{lb}}: a word, upright
    text = re.sub(r"\\operatorname\{\\mathrm\{([A-Za-z]+)\}\}", r"\\mathrm{\1}", text)
    text = re.sub(r"\{\s*(\\text\{[^{}]*\})\s*\}", r"\1", text)
    return text.replace("~", " ")


def _tokens(text: str) -> list[tuple[str, str]]:
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
        elif c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", text[i:])
            name = m.group(1)
            i += len(m.group(0))
            if name not in _SKIP:
                out.append(("cmd", name))
        elif c.isdigit() or (c == "." and i + 1 < len(text) and text[i + 1].isdigit()):
            m = re.match(r"\d*\.?\d+|\d+\.?", text[i:])
            out.append(("num", m.group(0)))
            i += len(m.group(0))
        elif c.isalpha():
            out.append(("letter", c))
            i += 1
        else:
            out.append(("op", {"−": "-", "×": "*", "·": "*", "÷": "/", "≤": "<=", "≥": ">=", "≠": "!="}.get(c, c)))
            i += 1
    out.append(("end", ""))
    # two-character relations typed as <= / >=
    merged = []
    for tok in out:
        if merged and tok == ("op", "=") and merged[-1] in (("op", "<"), ("op", ">"), ("op", "!")):
            merged[-1] = ("op", merged[-1][1] + "=")
        else:
            merged.append(tok)
    return merged


class LatexReader:
    def __init__(self, text: str):
        from .. import units  # here: units reads through parsing, which lang uses too

        self.units = units
        text = units.mark(clean(text))
        if "\\placeholder" in text:
            raise Incomplete("there's an empty box ▢ to fill in")
        self.toks = _tokens(text)
        self.i = 0
        self.abs_depth = 0

    def peek(self, k=0):
        return self.toks[min(self.i + k, len(self.toks) - 1)]

    def take(self):
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def at(self, kind, text=None) -> bool:
        k, t = self.peek()
        return k == kind and (text is None or t == text)

    def need_more(self):
        if self.at("end"):
            raise Incomplete(hints.missing(self.before(self.i)))

    def before(self, at: int) -> str | None:
        """The token before toks[at], as it's written — the word for a
        \\text{ or } (or the letters o r) — None at the start."""
        if at <= 0:
            return None
        k, t = self.toks[at - 1]
        if (k, t) == ("op", "}"):
            depth, j = 0, at - 1
            while j >= 0:
                if self.toks[j] == ("op", "}"):
                    depth += 1
                elif self.toks[j] == ("op", "{"):
                    depth -= 1
                    if depth == 0:
                        break
                j -= 1
            if j >= 1 and self.toks[j - 1] in (("cmd", "text"), ("cmd", "textrm")):
                return "".join(tok[1] for tok in self.toks[j + 1 : at - 1]).strip() or t
            return t
        if k == "letter":
            for word in ("or", "and"):
                run = self.toks[max(0, at - len(word)) : at]
                if len(run) == len(word) and all(kind == "letter" for kind, _ in run) and "".join(ch for _, ch in run) == word:
                    return word
        return t

    def unexpected(self, at: int) -> MathInputError:
        """toks[at] can't go where it is: say why, as it looks on the page."""
        k, t = self.toks[at]
        if k == "cmd" and t in ("text", "textrm"):
            save, self.i = self.i, at + 1
            t = self.braced_text().strip() or t
            self.i = save
        elif k == "cmd" and t in ("right", "mright"):
            t = self.toks[at + 1][1] if at + 1 < len(self.toks) and self.toks[at + 1][1] else ")"
        return MathInputError(hints.unexpected(self.before(at), t))

    def at_word(self) -> str | None:
        """The letters "or" / "and" typed between two answers are a word,
        not o·r — so those letter pairs are reserved in the Work Pad."""
        for word in ("or", "and"):
            if all(self.peek(j) == ("letter", ch) for j, ch in enumerate(word)) and self.peek(len(word))[0] != "end":
                return word
        return None

    def is_or(self) -> bool:
        """Between two answers: or / and (as letters or \\text{}) or a comma.
        Which one it was is left in self.joiner."""
        k, t = self.peek()
        self.joiner = "or"
        if word := self.at_word():
            self.joiner = word
            self.i += len(word)
            return True
        if k == "cmd" and t in ("text", "mathrm", "textrm"):
            save = self.i
            self.take()
            content = self.braced_text()
            if content.strip().lower() in ("or", "and"):
                self.joiner = content.strip().lower()
                return True
            self.i = save
        return self.at("op", ",")

    def braced_text(self) -> str:
        if not self.at("op", "{"):
            return ""
        self.take()
        out, depth = [], 1
        while not self.at("end"):
            k, t = self.take()
            if (k, t) == ("op", "{"):
                depth += 1
            elif (k, t) == ("op", "}"):
                depth -= 1
                if depth == 0:
                    break
            out.append(t)
        return "".join(out)

    # -------------------------------------------------------------- grammar

    def parse(self) -> Node:
        if self.at("end"):
            raise Incomplete("nothing typed yet")
        node = self.alts()
        if not self.at("end"):
            raise self.unexpected(self.i)
        return node

    def alts(self) -> Node:
        items, words = [self.relation()], []
        while self.is_or():
            words.append(self.joiner)
            if self.at("op", ","):
                self.take()
            self.need_more()
            items.append(self.relation())
        # all "and": every part at once; anything else is a list of answers
        return items[0] if len(items) == 1 else Alts(items, "and" if all(w == "and" for w in words) else "or")

    def rel_op(self) -> str | None:
        k, t = self.peek()
        if k == "op" and t in ("=", "<", ">", "<=", ">=", "!="):
            return {"<=": "<=", ">=": ">=", "!=": "!="}.get(t, t)
        if k == "cmd" and t in _REL:
            return _REL[t]
        return None

    def relation(self) -> Node:
        parts, ops = [self.sum()], []
        while (op := self.rel_op()) is not None:
            self.take()
            self.need_more()
            ops.append(op)
            parts.append(self.sum())
        return parts[0] if not ops else Rel(parts, ops)

    def sign(self) -> str | None:
        if self.at("op", "+") or self.at("op", "-"):
            return self.take()[1]
        if self.at("cmd", "pm") or self.at("cmd", "mp") or self.at("op", "±"):
            self.take()
            return "±"
        return None

    def sum(self) -> Node:
        self.need_more()
        terms = []
        first = self.sign() or "+"
        self.need_more()
        terms.append((first, self.term()))
        while (s := self.sign()) is not None:
            self.need_more()
            terms.append((s, self.term()))
        if len(terms) == 1 and first == "+":
            return terms[0][1]
        if len(terms) == 1 and first == "-":
            return Neg(terms[0][1])
        return Add(terms)

    def starts_atom(self) -> bool:
        k, t = self.peek()
        if k == "letter" and self.at_word():
            return False
        if k in ("num", "letter"):
            return True
        if k == "op":
            return t in ("(", "[", "{") or (t == "|" and self.abs_depth == 0)
        if k == "cmd":
            return t in ("frac", "dfrac", "tfrac", "sqrt", "left", "mleft", "pi", "infty", "operatorname", "mathrm", "lvert", "exponentialE") or t in _FUNCS
        return False

    def term(self) -> Node:
        factors, ops = [self.unary()], []
        while True:
            k, t = self.peek()
            if (k, t) in (("cmd", "cdot"), ("cmd", "times"), ("op", "*")):
                self.take()
                self.need_more()
                factors.append(self.unary())
                ops.append("×" if t == "times" else "·")
            elif (k, t) in (("cmd", "div"), ("op", "/")):
                self.take()
                self.need_more()
                den = self.unary()
                after = self.quantity(den) if isinstance(den, Num) else None
                if after:
                    den, after = after
                num = factors[0] if len(factors) == 1 else Mul(factors, ops)
                factors, ops = [Div(num, den, "div" if t == "div" else "slash")], []
                if after:  # what followed the quantity, not part of it
                    factors.append(after)
                    ops.append("implicit")
            elif self.starts_atom():
                factors.append(self.unary())
                ops.append("implicit")
            else:
                break
        return factors[0] if len(factors) == 1 else Mul(factors, ops)

    def quantity(self, number: Num):
        """÷ 2 s, ÷ 0.9 g/mL: a number written against its units is one
        quantity, so it's all divided by — not (10 m ÷ 2)·s, the way bare
        left to right would read it. (quantity, what came after it) when
        units follow; None when they don't."""
        units, after = [], None
        while self.starts_atom():
            nxt = self.unary()
            if not _unit(nxt):
                after = nxt
                break
            units.append(nxt)
        if not units:
            return (number, after) if after else None
        q: Node = Mul([number, *units], ["implicit"] * len(units))
        # ÷ 0.9 g / mL: the rate, per mL
        while after is None and self.at("op", "/"):
            save = self.i
            self.take()
            if not self.starts_atom():
                self.i = save
                break
            per = self.unary()
            if not _unit(per):
                self.i = save
                break
            q = Div(q, per, "frac")
        return Group(q), after

    def unary(self) -> Node:
        if self.at("op", "-"):
            self.take()
            self.need_more()
            return Neg(self.unary())
        return self.power()

    def script(self) -> Node:
        """The argument of ^, _, \\frac, \\sqrt: {…} or one token."""
        self.need_more()
        if self.at("op", "{"):
            self.take()
            if self.at("op", "}"):
                raise Incomplete("there's an empty box to fill in")
            inner = self.alts()
            if not self.at("op", "}"):
                raise Incomplete("a { isn't closed")
            self.take()
            return inner
        k, t = self.take()
        if k == "num":
            if len(t) > 1 and "." not in t:  # \frac14: each argument is ONE digit
                self.toks.insert(self.i, ("num", t[1:]))
                return Num(t[0])
            return Num(t)
        if k == "letter":
            return Sym(t)
        if k == "cmd" and t == "pi":
            return Const("pi")
        raise self.unexpected(self.i - 1)

    def power(self) -> Node:
        base = self.atom()
        while self.at("op", "^"):
            self.take()
            base = Pow(base, self.script())
        return base

    def mixed(self, whole: str) -> Node | None:
        """A whole number then a fraction of numbers (2⅓) is a mixed number,
        as on paper — otherwise None, with nothing read (2·x/3 multiplies)."""
        if not (whole.isdigit() and self.peek()[0] == "cmd" and self.peek()[1] in ("frac", "dfrac", "tfrac")):
            return None
        saved = (self.i, list(self.toks))  # reading \frac14 splits a token: undo that too
        self.take()
        try:
            frac = Div(self.script(), self.script(), "frac")
        except MathInputError:
            frac = None
        if frac and _whole_number(frac.num) and _whole_number(frac.den) and int(frac.den.text) != 0:
            return Mixed(Num(whole), frac)
        self.i, self.toks = saved
        return None

    def atom(self) -> Node:
        self.need_more()
        k, t = self.take()
        if k == "num":
            return self.mixed(t) or Num(t)
        if k == "letter":
            name = t
            if self.at("op", "_"):
                self.take()
                sub = self.script()
                name += "_" + (sub.text if isinstance(sub, Num) else sub.name if isinstance(sub, Sym) else "")
            return Sym(name)
        if k == "op" and t in ("(", "["):
            inner = self.alts()
            close = ")" if t == "(" else "]"
            if not self.at("op", close):
                raise Incomplete(hints.missing(t))
            self.take()
            return Group(inner)
        if k == "op" and t == "{":
            inner = self.alts()
            if not self.at("op", "}"):
                raise Incomplete("a { isn't closed")
            self.take()
            return inner
        if k == "op" and t == "|":
            return self.abs_until(("op", "|"))
        if k == "cmd":
            if t in ("frac", "dfrac", "tfrac"):
                return Div(self.script(), self.script(), "frac")
            if t == "sqrt":
                if self.at("op", "["):
                    self.take()
                    index = self.alts()
                    if not self.at("op", "]"):
                        raise Incomplete("the root's index isn't closed")
                    self.take()
                    return Func("root", [self.script(), index])
                return Func("sqrt", [self.script()])
            if t in ("left", "mleft"):
                self.need_more()
                k2, d = self.take()
                if (k2, d) in (("op", "|"), ("cmd", "vert"), ("cmd", "lvert")):
                    return self.abs_until(None, closing_left=True)
                if d not in ("(", "[", "."):
                    raise MathInputError(f"unsupported bracket “{d}”")
                inner = self.alts()
                if not (self.at("cmd", "right") or self.at("cmd", "mright")):
                    raise Incomplete(hints.missing(d if d in ("(", "[") else "("))
                self.take()
                self.take()  # the closing delimiter
                return Group(inner)
            if t == "lvert":
                return self.abs_until(("cmd", "rvert"))
            if t == "pi":
                return Const("pi")
            if t == "infty":
                return Const("oo")
            if t == "exponentialE":
                return Const("e")
            if t in _FUNCS:
                return self.function(_FUNCS[t])
            if t in ("operatorname", "mathrm"):
                name = self.braced_text().strip()
                if name in _OPERATORNAME:
                    return self.function(_OPERATORNAME[name])
                if name == "e":
                    return Const("e")
                unit = self.units.find(name)
                if t == "mathrm" and unit:  # a unit: 5 m, 10 s
                    return Sym(self.units.symbol(unit).name)
                return Sym(name)
        raise self.unexpected(self.i - 1)

    def abs_until(self, close, closing_left=False) -> Node:
        self.abs_depth += 1
        inner = self.sum()
        self.abs_depth -= 1
        if closing_left:
            if not (self.at("cmd", "right") or self.at("cmd", "mright")):
                raise Incomplete("an absolute value isn't closed")
            self.take()
            self.take()
        else:
            if self.peek() != close:
                raise Incomplete("an absolute value isn't closed")
            self.take()
        return Func("abs", [inner])

    def function(self, name: str) -> Node:
        self.need_more()
        if self.at("cmd", "left") or self.at("cmd", "mleft") or self.at("op", "("):
            arg = self.atom()
            return Func(name, [strip_group(arg)])
        return Func(name, [self.power()])


# ------------------------------------------------------------------ writing

def _whole_number(node: Node) -> bool:
    return isinstance(node, Num) and node.text.isdigit()


def _number_fraction(node: Node) -> bool:
    return isinstance(node, Div) and node.style == "frac" and _whole_number(node.num) and _whole_number(node.den)


_REL_OUT = {"=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge", "!=": "\\ne"}
_FUNC_OUT = {"sin": "\\sin", "cos": "\\cos", "tan": "\\tan", "asin": "\\arcsin", "acos": "\\arccos", "atan": "\\arctan", "ln": "\\ln", "log": "\\log"}


def _starts_with_digit(tex: str) -> bool:
    return tex[:1].isdigit() or tex.startswith("-")


def _unit(node) -> bool:
    """a unit (m), a unit to a power (m²) or over others (m/s)"""
    if isinstance(node, Sym):
        return node.name.startswith("unit_")
    if isinstance(node, Pow):
        return _unit(node.base)
    if isinstance(node, Div):
        return _unit(node.num)
    if isinstance(node, Mul):
        return all(_unit(f) for f in node.factors)
    return False


class LatexWriter:
    def write(self, node: Node) -> str:
        return self.w(node)

    def paren(self, node: Node, needed: bool) -> str:
        text = self.w(node)
        return f"\\left({text}\\right)" if needed else text

    def w(self, node: Node) -> str:
        if isinstance(node, Num):
            return node.text
        if isinstance(node, Sym):
            if node.name.startswith("unit_"):  # a unit, upright: \mathrm{m}
                return f"\\mathrm{{{node.name[5:]}}}"
            base, _, sub = node.name.partition("_")
            if len(base) > 1:
                base = f"\\mathrm{{{base}}}"
            return f"{base}_{{{sub}}}" if sub else base
        if isinstance(node, Const):
            return {"pi": "\\pi", "e": "e", "oo": "\\infty"}[node.name]
        if isinstance(node, Group):
            return f"\\left({self.w(node.inner)}\\right)"
        if isinstance(node, Neg):
            return "-" + self.paren(node.arg, isinstance(node.arg, (Add, Neg)))
        if isinstance(node, Add):
            out = []
            for k, (sign, term) in enumerate(node.terms):
                text = self.paren(term, isinstance(term, (Add, Neg, Rel, Alts)))
                spelled = {"+": "+", "-": "-", "±": "\\pm"}[sign]
                if k == 0:
                    out.append(("" if sign == "+" else spelled + ("" if sign == "-" else " ")) + text)
                else:
                    out.append(f"{spelled} {text}")
            return " ".join(out)
        if isinstance(node, Mul):
            out = ""
            for k, f in enumerate(node.factors):
                text = self.paren(f, isinstance(f, (Add, Rel, Alts)) or (k > 0 and isinstance(f, Neg)))
                if k == 0:
                    out = text
                    continue
                op = node.ops[k - 1] if k - 1 < len(node.ops) else "implicit"
                if op == "·":
                    out += " \\cdot " + text
                elif op == "×":
                    out += " \\times " + text
                elif _starts_with_digit(text) or (out[-1:].isdigit() and _number_fraction(f)):
                    # 2·3 must keep its dot — and 2·⅓ too, or it reads as 2⅓
                    out += " \\cdot " + text
                elif _unit(f) and not _unit(node.factors[k - 1]):  # a number and its unit: 5 m, 5 m/s
                    out += "\\," + text
                else:  # implicit, or a code language's * — written the way it's read
                    sep = " " if re.search(r"\\[A-Za-z]+$", out) else ""
                    out += sep + text
            return out
        if isinstance(node, Div):
            if node.style == "div":
                return f"{self.paren(node.num, isinstance(node.num, (Add,)))} \\div {self.paren(node.den, not isinstance(node.den, ATOMS + (Pow,)))}"
            return f"\\frac{{{self.w(strip_group(node.num))}}}{{{self.w(strip_group(node.den))}}}"
        if isinstance(node, Mixed):
            return f"{node.whole.text}{self.w(node.frac)}"
        if isinstance(node, Pow):
            base = self.paren(node.base, not isinstance(node.base, ATOMS) or isinstance(node.base, Func) and node.base.name not in ("sqrt", "abs", "root"))
            return f"{base}^{{{self.w(strip_group(node.exp))}}}"
        if isinstance(node, Func):
            if node.name == "sqrt":
                return f"\\sqrt{{{self.w(node.args[0])}}}"
            if node.name == "root":
                return f"\\sqrt[{self.w(node.args[1])}]{{{self.w(node.args[0])}}}"
            if node.name == "abs":
                return f"\\left|{self.w(node.args[0])}\\right|"
            if node.name == "exp":
                return f"e^{{{self.w(node.args[0])}}}"
            name = _FUNC_OUT.get(node.name, f"\\operatorname{{{node.name}}}")
            return f"{name}\\left({', '.join(self.w(a) for a in node.args)}\\right)"
        if isinstance(node, Rel):
            out = self.w(node.parts[0])
            for op, part in zip(node.ops, node.parts[1:]):
                out += f" {_REL_OUT[op]} {self.w(part)}"
            return out
        if isinstance(node, Alts):
            return f" \\text{{ {node.word} }} ".join(self.w(i) for i in node.items)
        raise MathInputError(f"can't write {type(node).__name__} as LaTeX")
