"""Reading and writing text languages (Python, Lua, Haskell, teacher-made)
from their definitions in specs.py — one reader/writer for all of them."""

import re

from ..parsing import MathInputError
from .ast import ATOMS, Add, Alts, Const, Div, Func, Group, Mixed, Mul, Neg, Node, Num, Pow, Rel, Sym, expand_pm, prec


class Incomplete(MathInputError):
    """The input simply isn't finished yet (ends on an operator, empty box)."""


_NUMBER = re.compile(r"\d+(?:\.\d*)?|\.\d+")
_IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*")
_STANDARD_OPS = ["**", "^^", "==", "!=", "~=", "<=", ">=", "||", "^", "*", "/", "+", "-", "(", ")", ",", "<", ">", "=", "|", "±",
                 "×", "÷", "·", "−", "–", "≤", "≥", "≠"]
_POWER_LIKE = {"**", "^", "^^"}
_UNICODE = {"−": "-", "–": "-", "×": "*", "·": "*", "÷": "/", "≤": "<=", "≥": ">=", "≠": "!="}


def _tokens(text: str, spec: dict) -> list[tuple[str, str]]:
    ops = set(_STANDARD_OPS)
    word_ops = set()  # a definition may spell an operator as a word: pow, EQUALS, OR
    for key in ("power", "equals", "not_equal", "or"):
        ops.update(t for t in spec[key] if not _IDENT.fullmatch(t))
        word_ops.update(t for t in spec[key] if _IDENT.fullmatch(t))
    if _IDENT.fullmatch(spec["multiply"]):
        word_ops.add(spec["multiply"])
    ops = sorted(ops, key=len, reverse=True)
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if m := _NUMBER.match(text, i):
            out.append(("num", m.group(0)))
            i = m.end()
            continue
        if m := _IDENT.match(text, i):
            word = m.group(0)
            out.append(("op" if word in word_ops else "ident", word))
            i = m.end()
            continue
        op = next((o for o in ops if text.startswith(o, i)), None)
        if op is None:
            raise MathInputError(f"“{c}” isn't something {spec['name']} understands here")
        out.append(("op", _UNICODE.get(op, op)))
        i += len(op)
    out.append(("end", ""))
    return out


class TextReader:
    def __init__(self, text: str, spec: dict):
        self.spec = spec
        self.name = spec["name"]
        if "\\" in text or "{" in text:
            raise MathInputError(f"That looks like LaTeX, but this block's language is **{self.name}**. Switch the language to LaTeX (or Visual) to type LaTeX.")
        self.toks = _tokens(text, spec)
        self.i = 0
        names = spec["names"]
        # spelling → canonical, the language's own spellings first
        self.functions: dict[str, str] = {}
        self.constants: dict[str, str] = {}
        for canon in ("sqrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp"):
            self.functions.setdefault(canon, canon)
        for canon, spelled in names.items():
            if canon in ("pi", "e"):
                self.constants[spelled] = canon
            else:
                self.functions[spelled] = canon
        self.constants.setdefault("pi", "pi")
        self.abs_depth = 0

    # -------------------------------------------------------------- tokens

    def peek(self):
        return self.toks[self.i]

    def take(self):
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def is_op(self, *texts) -> bool:
        kind, text = self.peek()
        return kind == "op" and text in texts

    def word(self, text: str) -> bool:
        return self.peek() == ("ident", text) or self.peek() == ("op", text)

    def fail_if_end(self):
        if self.peek()[0] == "end":
            raise Incomplete("not finished yet")

    def strip_prefix(self, name: str) -> str:
        for prefix in self.spec["prefixes"]:
            if name.startswith(prefix):
                return name[len(prefix):]
        return name

    # -------------------------------------------------------------- grammar

    def parse(self) -> Node:
        if self.peek()[0] == "end":
            raise Incomplete("nothing typed yet")
        node = self.alts()
        if self.peek()[0] != "end":
            kind, text = self.peek()
            raise MathInputError(f"didn't expect “{text}” here")
        return node

    def alts(self) -> Node:
        items = [self.relation()]
        while any(self.word(t) for t in self.spec["or"]) or self.is_op(","):
            self.take()
            items.append(self.relation())
        return items[0] if len(items) == 1 else Alts(items)

    def rel_op(self) -> str | None:
        kind, text = self.peek()
        if kind != "op":
            return None
        if text in self.spec["equals"]:
            return "="
        if text in self.spec["not_equal"] or text == "!=":
            return "!="
        if text in ("<", ">", "<=", ">="):
            return text
        if text == "=":
            raise MathInputError(f"In {self.name}, “equals” is written `{self.spec['equals'][0]}`.")
        return None

    def relation(self) -> Node:
        parts, ops = [self.sum()], []
        while (op := self.rel_op()) is not None:
            self.take()
            ops.append(op)
            parts.append(self.sum())
        return parts[0] if not ops else Rel(parts, ops)

    def sum(self) -> Node:
        terms = []
        sign = "+"
        if self.is_op("+", "-", "±"):
            sign = self.take()[1]
        self.fail_if_end()
        terms.append((sign, self.term()))
        while self.is_op("+", "-", "±"):
            sign = self.take()[1]
            self.fail_if_end()
            terms.append((sign, self.term()))
        if len(terms) == 1 and terms[0][0] == "+":
            return terms[0][1]
        if len(terms) == 1 and terms[0][0] == "-":
            return Neg(terms[0][1])
        return Add(terms)

    def starts_atom(self) -> bool:
        kind, text = self.peek()
        if kind in ("num", "ident"):
            return True
        return kind == "op" and (text == "(" or (text == "|" and self.abs_depth == 0))

    def term(self) -> Node:
        node = self.unary()
        factors, ops = [node], []
        while True:
            if self.is_op("*", self.spec["multiply"]):
                self.take()
                self.fail_if_end()
                factors.append(self.unary())
                ops.append("*")
            elif self.is_op("/"):
                self.take()
                self.fail_if_end()
                den = self.unary()
                num = factors[0] if len(factors) == 1 else Mul(factors, ops)
                factors, ops = [Div(num, den, "slash")], []
            elif self.starts_atom():
                if not self.spec["implicit_multiplication"]:
                    m = self.spec["multiply"]
                    raise MathInputError(f"In {self.name}, multiplication needs `{m}` — write `2{m}x`, not `2x`.")
                factors.append(self.unary())
                ops.append("implicit")
            else:
                break
        return factors[0] if len(factors) == 1 else Mul(factors, ops)

    def unary(self) -> Node:
        if self.is_op("-"):
            self.take()
            self.fail_if_end()
            return Neg(self.unary())
        if self.is_op("+"):
            self.take()
            return self.unary()
        if self.is_op("±"):
            self.take()
            return Add([("±", self.unary())])
        return self.power()

    def power(self) -> Node:
        base = self.atom()
        kind, text = self.peek()
        if kind == "op" and text in _POWER_LIKE | set(self.spec["power"]):
            if text not in self.spec["power"]:
                raise MathInputError(self.spec["hints"].get(text) or f"In {self.name}, powers are written with `{self.spec['power'][0]}`, like `x{self.spec['power'][0]}2`.")
            self.take()
            self.fail_if_end()
            return Pow(base, self.unary())  # right-associative; x^-2 allowed
        return base

    def atom(self) -> Node:
        self.fail_if_end()
        kind, text = self.take()
        if kind == "num":
            return Num(text)
        if kind == "ident":
            name = text
            canon = self.functions.get(name) or self.functions.get(self.strip_prefix(name))
            if canon:
                return self.call(canon, name)
            const = self.constants.get(name) or self.constants.get(self.strip_prefix(name))
            if const:
                return Const(const)
            return Sym(name)
        if text == "(":
            inner = self.alts()
            if not self.is_op(")"):
                raise Incomplete("a bracket isn't closed yet")
            self.take()
            return Group(inner)
        if text == "|":
            self.abs_depth += 1
            inner = self.sum()
            self.abs_depth -= 1
            if not self.is_op("|"):
                raise Incomplete("an absolute value bar isn't closed yet")
            self.take()
            return Func("abs", [inner])
        raise MathInputError(f"didn't expect “{text}” here")

    def call(self, canon: str, spelled: str) -> Node:
        if self.is_op("("):
            self.take()
            args = [self.sum()]
            while self.is_op(","):
                self.take()
                args.append(self.sum())
            if not self.is_op(")"):
                raise Incomplete("a bracket isn't closed yet")
            self.take()
            return Func(canon, args)
        if self.spec["call_style"] == "juxtapose" and self.starts_atom():
            arg = self.atom()  # sqrt x ^ 2 is (sqrt x)^2, as in Haskell
            return Func(canon, [arg.inner if isinstance(arg, Group) else arg])
        self.fail_if_end()
        raise MathInputError(f"`{spelled}` needs something to act on — like `{spelled}({'x'})`" if self.spec["call_style"] == "parens" else f"`{spelled}` needs something to act on — like `{spelled} x`")


# ------------------------------------------------------------------ writing


class TextWriter:
    def __init__(self, spec: dict):
        self.spec = spec

    @staticmethod
    def op(token: str) -> str:
        """Word operators need spaces (x pow 2); symbols don't (x**2)."""
        return f" {token} " if _IDENT.fullmatch(token) else token

    def write(self, node: Node) -> str:
        return self.w(expand_pm(node))

    def wrap(self, node: Node, needed: bool) -> str:
        text = self.w(node)
        return f"({text})" if needed else text

    def w(self, node: Node) -> str:
        s = self.spec
        if isinstance(node, Num):
            return node.text
        if isinstance(node, Sym):
            return node.name
        if isinstance(node, Const):
            if node.name == "oo":
                return "inf"
            return s["names"][node.name]
        if isinstance(node, Group):
            return self.w(node.inner) if isinstance(node.inner, Mixed) else f"({self.w(node.inner)})"
        if isinstance(node, Neg):
            return "-" + self.wrap(node.arg, isinstance(node.arg, (Add, Neg)))
        if isinstance(node, Add):
            out = []
            for k, (sign, term) in enumerate(node.terms):
                if sign == "±":
                    raise MathInputError(f"± can't be written in {s['name']} — write the two answers with `{s['or'][0]}`")
                needs = isinstance(term, (Add, Neg, Rel, Alts))
                text = self.wrap(term, needs)
                out.append(("-" if sign == "-" else "") + text if k == 0 else f" {sign} {text}")
            return "".join(out)
        if isinstance(node, Mul):
            parts = []
            for k, f in enumerate(node.factors):
                needs = prec(f) < 3 or (k > 0 and isinstance(f, Neg))
                parts.append(self.wrap(f, needs))
            return self.op(s["multiply"]).join(parts)
        if isinstance(node, Div):
            num = self.wrap(node.num, prec(node.num) < 3)
            den = self.wrap(node.den, not isinstance(node.den, ATOMS + (Pow, Mixed)))  # (2 + 1/3) is bracketed already
            return f"{num}/{den}"
        if isinstance(node, Mixed):  # code has no mixed numbers: 2⅓ is (2 + 1/3)
            return f"({node.whole.text} + {node.frac.num.text}/{node.frac.den.text})"
        if isinstance(node, Pow):
            base = self.wrap(node.base, not isinstance(node.base, ATOMS + (Mixed,)))
            exp = self.wrap(node.exp, not isinstance(node.exp, ATOMS + (Mixed,)))
            return f"{base}{self.op(s['power'][0])}{exp}"
        if isinstance(node, Func):
            if node.name == "root":  # nth root → x^(1/n)
                return self.w(Pow(node.args[0], Group(Div(Num("1"), node.args[1], "slash"))))
            spelled = s["names"].get(node.name)
            if not spelled:
                raise MathInputError(f"{s['name']} has no way to write {node.name} here")
            if s["call_style"] == "parens":
                return f"{spelled}({', '.join(self.w(a) for a in node.args)})"
            return spelled + "".join(" " + self.wrap(a, not isinstance(a, (Num, Sym, Const, Group))) for a in node.args)
        if isinstance(node, Rel):
            spell = {"=": s["equals"][0], "!=": s["not_equal"][0]}
            out = self.w(node.parts[0])
            for op, part in zip(node.ops, node.parts[1:]):
                out += f" {spell.get(op, op)} {self.w(part)}"
            return out
        if isinstance(node, Alts):
            return f" {s['or'][0]} ".join(self.w(i) for i in node.items)
        raise MathInputError(f"can't write {type(node).__name__} in {s['name']}")
