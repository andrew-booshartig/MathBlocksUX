"""The shared form → sympy, for checking. Symbols are always plain
symbols (a student's S or E is a letter, not a set or Euler's number)."""

import sympy
from sympy.core.parameters import evaluate as sympy_evaluate

from ..parsing import MathInputError
from .ast import Add, Alts, Const, Div, Func, Group, Mul, Neg, Node, Num, Pow, Rel, Sym

_FUNCS = {
    "sin": sympy.sin, "cos": sympy.cos, "tan": sympy.tan, "asin": sympy.asin, "acos": sympy.acos, "atan": sympy.atan,
    "ln": sympy.log, "exp": sympy.exp, "abs": sympy.Abs, "sqrt": sympy.sqrt,
}


def to_sympy(node: Node, evaluate: bool = True):
    with sympy_evaluate(evaluate):
        return _convert(node)


def _convert(node: Node):
    if isinstance(node, Num):
        return sympy.Rational(node.text)  # exact: 0.1 is 1/10
    if isinstance(node, Sym):
        return sympy.Symbol(node.name)
    if isinstance(node, Const):
        return {"pi": sympy.pi, "e": sympy.E, "oo": sympy.oo}[node.name]
    if isinstance(node, Group):
        return _convert(node.inner)
    if isinstance(node, Neg):
        return -_convert(node.arg)
    if isinstance(node, Add):
        terms = []
        for sign, term in node.terms:
            if sign == "±":
                raise MathInputError("± needs to be split into two answers first")
            value = _convert(term)
            terms.append(-value if sign == "-" else value)
        return sympy.Add(*terms)
    if isinstance(node, Mul):
        return sympy.Mul(*[_convert(f) for f in node.factors])
    if isinstance(node, Div):
        return sympy.Mul(_convert(node.num), sympy.Pow(_convert(node.den), -1))
    if isinstance(node, Pow):
        return sympy.Pow(_convert(node.base), _convert(node.exp))
    if isinstance(node, Func):
        args = [_convert(a) for a in node.args]
        if node.name == "root":
            return sympy.Pow(args[0], sympy.Pow(args[1], -1))
        if node.name == "log":
            return sympy.log(args[0], 10)
        if node.name in _FUNCS:
            return _FUNCS[node.name](*args)
        raise MathInputError(f"unknown function {node.name}")
    raise MathInputError(f"can't evaluate a {type(node).__name__} here")
