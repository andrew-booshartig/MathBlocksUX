"""Checks a student's own work, line by line, without ever doing it for
them. Each line is compared with the line above it:

  ok       — it follows (an equivalent expression / an equation with the
             same solutions)
  wrong    — it doesn't follow from the line above: this is where the
             mistake happened; we try to say *what kind* (a sign slip) or
             give a test value that exposes it, but never the answer
  carried  — it follows from the line above, but an earlier mistake is
             carried through (so it doesn't match the problem any more)
  error    — couldn't read the line

A line can also be a conclusion in words — "no solution" or "all real
numbers" (infinitely many solutions) — checked against the line above it.

Lines are read in the block's chosen language (LaTeX from the Visual
editor, Python, Lua, Haskell, or one a teacher defined) through the
shared language layer in mathcore/lang."""

import random
import re

import sympy
from sympy import S, Symbol

from . import lang
from .lang import Incomplete
from .parsing import MathInputError, num, tex

REL_TEX = {"=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge"}
_RELOPS = {"<": sympy.Lt, ">": sympy.Gt, "<=": sympy.Le, ">=": sympy.Ge}
_INSTRUCTION = re.compile(r"^\s*(solve|simplify|expand|factor|evaluate|show that|prove)\b\s*:?\s*", re.I)

_FLIP = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}


_LATEX_REL = re.compile(r"\\le(?:q|qslant)?(?![a-zA-Z])|\\ge(?:q|qslant)?(?![a-zA-Z])|\\ne(?:q)?(?![a-zA-Z])|<=|>=|=|<|>")


def _split_latex(raw: str):
    """Split typed LaTeX at its one top-level relation: [left, rel, right]."""
    depth = 0
    for i, ch in enumerate(raw):
        depth += {"{": 1, "}": -1}.get(ch, 0)
        if depth == 0:
            m = _LATEX_REL.match(raw, i)
            if m and not raw[:i].rstrip().endswith("\\"):
                rel = {"<=": "\\le", ">=": "\\ge"}.get(m.group(0), m.group(0))
                left, right = raw[:i].strip(), raw[m.end():].strip()
                if _LATEX_REL.search(right):
                    return None
                return [left, rel, right]
    return None


class Line:
    """One line of work, read in ONE explicitly chosen language — never
    guessed — so a student always knows how their typing is understood."""

    def __init__(self, raw: str = "", language: str = "latex", custom: list | None = None, _node=None):
        self.language = language
        self.raw = _INSTRUCTION.sub("", raw).strip()
        self.node = _node if _node is not None else lang.parse(self.raw, language, custom)
        expanded = lang.expand_pm(self.node)  # x = ±4 is two answers
        self.alts: list[Line] = []
        if isinstance(expanded, lang.Alts):
            # "x = 2 or x = 3", "x < -1 or x > 4": a list of answers
            self.alts = [Line(language=language, custom=custom, _node=item) for item in expanded.items]
            rels = {a.rel for a in self.alts}
            self.rel = rels.pop() if len(rels) == 1 else "mixed"
            self.sides = self.raw_sides = []
            return
        if isinstance(expanded, lang.Rel):
            if len(expanded.ops) > 1:
                raise MathInputError("write one relation per line (one =, or one < ≤ > ≥)")
            if expanded.ops[0] == "!=":
                raise MathInputError("lines with ≠ can't be checked yet")
            self.rel, side_nodes = expanded.ops[0], expanded.parts
        else:
            self.rel, side_nodes = None, [expanded]
        self.raw_sides = [lang.to_sympy(n, evaluate=False) for n in side_nodes]
        self.sides = [lang.to_sympy(n) for n in side_nodes]

    @property
    def kind(self) -> str:
        return "expression" if self.rel is None else "equation" if self.rel == "=" else "inequality"

    def solution_set(self, sym):
        """Everything on the number line that makes this line true."""
        if self.alts:
            return sympy.Union(*[a.solution_set(sym) for a in self.alts])
        if self.rel == "=":
            sols = _solutions(self.diff, sym)
            if sols is None:
                raise NotImplementedError
            if sols == "all":
                return S.Reals
            if sols == "none":
                return S.EmptySet
            return sympy.FiniteSet(*[s for s in sols if s.is_real is not False])
        return sympy.solve_univariate_inequality(_RELOPS[self.rel](*self.sides), sym, relational=False)

    @property
    def diff(self):
        return sympy.expand(self.sides[0] - self.sides[1]) if self.rel else self.sides[0]

    @property
    def symbols(self):
        if self.alts:
            return sorted(set().union(*(a.symbols for a in self.alts)), key=str)
        return sorted(set().union(*(s.free_symbols for s in self.sides)), key=str)

    def latex(self) -> str:
        """How the line is shown: exactly as typed for LaTeX, otherwise the
        same math written as LaTeX (shape preserved: ¼·s stays ¼s)."""
        if self.raw and self.language == "latex":
            return self.raw
        return lang.latex(self.node)

    def parts(self):
        """[left, relation, right] LaTeX, for lining work up at the = sign."""
        node = self.node
        if self.alts or not isinstance(node, lang.Rel) or len(node.ops) != 1:
            return None
        if self.raw and self.language == "latex":
            return _split_latex(self.raw)
        return [lang.latex(node.parts[0]), REL_TEX[node.ops[0]], lang.latex(node.parts[1])]

    def with_sides(self, sides) -> "Line":
        clone = object.__new__(Line)
        clone.rel, clone.sides, clone.raw_sides, clone.alts = self.rel, sides, sides, []
        clone.language, clone.raw = self.language, ""
        return clone


def _same_value(a, b) -> bool:
    try:
        if sympy.simplify(a - b) == 0:
            return True
    except Exception:
        pass
    # numeric spot-check at a few random points (catches forms simplify misses)
    syms = sorted((a - b).free_symbols, key=str)
    rng = random.Random(7)
    for _ in range(4):
        point = {s: sympy.Rational(rng.randint(2, 29), rng.randint(2, 7)) for s in syms}
        va, vb = num(a.subs(point)), num(b.subs(point))
        if va is None or vb is None or abs(va - vb) > 1e-9 * max(1, abs(va)):
            return False
    return True


def _solutions(diff, sym):
    diff = sympy.simplify(diff)
    if diff == 0:
        return "all"
    if not diff.has(sym):
        return "none"
    try:
        return [sympy.simplify(s) for s in sympy.solve(diff, sym)]
    except NotImplementedError:
        return None


def _sets_equal(a, b) -> bool:
    if isinstance(a, sympy.FiniteSet) and isinstance(b, sympy.FiniteSet):
        return len(a) == len(b) and all(any(_same_value(x, y) for y in b) for x in a)
    return a == b


def _same_solutions(a: "Line", b: "Line") -> bool | None:
    """Same solution set? None when we can't tell."""
    syms = sorted(set(a.symbols) | set(b.symbols), key=str)
    if len(syms) == 1 or a.alts or b.alts:
        # one letter: compare the actual solution sets on the number line
        if len(syms) != 1:
            return None
        try:
            return _sets_equal(a.solution_set(syms[0]), b.solution_set(syms[0]))
        except (NotImplementedError, ValueError, TypeError):
            return None
    if a.rel != b.rel:
        return False
    if a.rel == "=":
        syms = [s for s in a.symbols if s in b.symbols] or a.symbols or b.symbols
        if not syms:  # 3 = 3, 5 = 2 …
            return bool(sympy.simplify(a.diff) == 0) == bool(sympy.simplify(b.diff) == 0)
        sym = next((s for s in syms if str(s) == "x"), syms[0])
        sa, sb = _solutions(a.diff, sym), _solutions(b.diff, sym)
        if sa is None or sb is None:
            return None
        if isinstance(sa, str) or isinstance(sb, str):
            return sa == sb
        return len(sa) == len(sb) and all(any(_same_value(x, y) for y in sb) for x in sa)
    # inequalities: compare solution sets on the number line
    syms = sorted(set(a.symbols) | set(b.symbols), key=str)
    if len(syms) != 1:
        return None
    sym = syms[0]
    try:
        set_a = sympy.solve_univariate_inequality(_RELOPS[a.rel](*a.sides), sym, relational=False)
        set_b = sympy.solve_univariate_inequality(_RELOPS[b.rel](*b.sides), sym, relational=False)
    except (NotImplementedError, ValueError):
        return None
    return set_a == set_b


def equivalent(a: Line, b: Line) -> bool | None:
    if a.kind == "expression":
        return _same_value(a.sides[0], b.sides[0])
    return _same_solutions(a, b)


def _terms(line: Line):
    for k, side in enumerate(line.sides or []):
        for t in sympy.Add.make_args(side):
            if t != 0:
                yield k, t


def diagnose(prev: Line, line: Line) -> str:
    """Why doesn't `line` follow from `prev`? A useful nudge, not the answer."""
    syms = sorted(set(prev.symbols) | set(line.symbols), key=str)
    if len(syms) == 1 and line.kind != "expression":
        try:
            before, after = prev.solution_set(syms[0]), line.solution_set(syms[0])
            if after.is_subset(before) and before != after and after != S.EmptySet:
                return "Some solutions went missing — did you forget the $\\pm$ when taking a square root, or divide by something that could be zero?"
            if before.is_subset(after) and before != after:
                return "This has **extra** solutions the line above doesn't — plug them back in to check."
        except Exception:
            pass
    if line.alts:
        return "These answers don't match the solutions of the line above — check each one by plugging it back in."
    # forgot to flip (or flipped when it shouldn't have)
    if line.rel in _FLIP:
        flipped = line.with_sides(line.sides)
        flipped.rel = _FLIP[line.rel]
        if equivalent(prev, flipped):
            return "Check the direction of the inequality sign — it flips when you multiply or divide both sides by a **negative** number (and only then)."
    # a sign slip: flipping one term's sign would have made it right
    for k, t in _terms(line):
        sides = list(line.sides)
        sides[k] = sides[k] - 2 * t
        if equivalent(prev, line.with_sides(sides)):
            return f"Look at the sign of ${tex(t)}$ — did it change when it shouldn't have (or not change when it should)?"
    if line.kind == "expression":
        syms = line.symbols or prev.symbols
        point = {s: v for s, v in zip(syms, [2, 3, 5, 7, 11])}
        va, vb = prev.sides[0].subs(point), line.sides[0].subs(point)
        if syms and num(va) is not None and num(vb) is not None:
            where = ",\\ ".join(f"{tex(s)} = {v}" for s, v in point.items())
            return f"Test it: with ${where}$ the line above is ${tex(sympy.nsimplify(va))}$ but this line is ${tex(sympy.nsimplify(vb))}$ — equal expressions always match."
        return "This isn't equal to the line above."
    return "This doesn't have the same solutions as the line above — find the step that changed it."


# "no solution" / "all real numbers" typed as a line — in any language, with
# or without spaces (the Visual editor drops them: "nosolution")
_NONE_WORDS = re.compile(r"^(no(real)?solutions?|none|nosolutionsexist|∅|\\emptyset|\\varnothing|\{\}|\\\{\\\})$", re.I)
_ALL_WORDS = re.compile(
    r"^(all(real)?(numbers)?|allreals|infinitelymany(solutions)?|infinite(ly)?(many)?(solutions)?|∞solutions|"
    r"every(real)?number(isasolution)?|identity|ℝ|\\mathbb\{r\}|[a-z](∈|\\in)(ℝ|\\mathbb\{r\}))$",
    re.I,
)
CONCLUSION_TEX = {"none": "\\text{no solution}", "all": "\\text{all real numbers}"}


def conclusion(raw: str) -> str | None:
    """'none' / 'all' when the line is a conclusion in words, else None."""
    text = re.sub(r"\\(text|mathrm|operatorname|textrm|textit|mathit)\s*\{([^{}]*)\}", r"\2", raw)
    text = re.sub(r"\\[ ,;:!]|~|\\quad|\\qquad|[\s.]", "", text).lower()
    text = text.replace("solutionset", "").replace("x=", "")
    if _NONE_WORDS.match(text):
        return "none"
    if _ALL_WORDS.match(text):
        return "all"
    return None


def verdict(line: Line) -> str | None:
    """How many solutions does this line have: 'none', 'all' or 'some'
    (None when it can't be told)."""
    syms = line.symbols
    if line.kind == "expression":
        return None
    if not syms:  # 5 = 2, 6 = 6, 3 < 1 …
        try:
            if line.rel == "=":
                return "all" if sympy.simplify(line.diff) == 0 else "none"
            return "all" if bool(_RELOPS[line.rel](*line.sides)) else "none"
        except (TypeError, KeyError):
            return None
    if len(syms) != 1:
        return None
    try:
        found = line.solution_set(syms[0])
    except (NotImplementedError, ValueError, TypeError):
        return None
    return "none" if found == S.EmptySet else "all" if found == S.Reals else "some"


def _check_conclusion(claim: str, prev: Line, given: Line, carried: bool) -> dict:
    entry = {"latex": CONCLUSION_TEX[claim], "parts": None}
    if given.kind == "expression":
        return {**entry, "status": "error", "message": "“No solution” and “all real numbers” are answers to equations and inequalities — this problem is an expression."}
    before = verdict(prev)
    if before is None:
        return {**entry, "status": "unknown", "message": "Can't check this step automatically."}
    if before == "some":
        return {**entry, "status": "wrong", "message": "The line above still has solutions — some values work and some don't. Keep solving."}
    if before != claim:
        if claim == "none":
            return {**entry, "status": "wrong", "message": "Is the line above ever false? It's true no matter what the variable is — so which values work?"}
        return {**entry, "status": "wrong", "message": "Is the line above ever true? It's false no matter what the variable is — so which values work?"}
    if carried and verdict(given) != claim:
        return {**entry, "status": "carried", "message": "This follows from the line above, but an earlier mistake is carried through."}
    done = "No solution — no value makes it true" if claim == "none" else "Infinitely many solutions — every value makes it true"
    return {**entry, "status": "ok", "done": done}


def _variable_gone(line: Line, given: Line) -> str | None:
    """A nudge when the variable cancels out: the line is now just true or
    false — the student still has to say what that means."""
    if line.kind == "expression" or line.alts or line.symbols or not given.symbols:
        return None
    v = verdict(line)
    if v == "none":
        return "The variable is gone and what's left is **false** — so what are the solutions?"
    if v == "all":
        return "The variable is gone and what's left is **always true** — so what are the solutions?"
    return None


def _is_done(line: Line, given: Line) -> str | None:
    if line.alts:
        return "Solved" if all(_is_done(a, given) for a in line.alts) else None
    if line.kind == "expression":
        raw = line.raw_sides[0]
        grouped = any(any(a.is_Add for a in m.args) for m in raw.atoms(sympy.Mul)) or any(p.base.is_Add for p in raw.atoms(sympy.Pow))
        target_terms = len(sympy.Add.make_args(sympy.expand(given.sides[0])))
        if not grouped and len(sympy.Add.make_args(raw)) == target_terms:
            return "Fully simplified"
        return None
    for k in (0, 1):
        alone, other = line.sides[k], line.sides[1 - k]
        if isinstance(alone, Symbol) and not other.has(alone):
            if len(given.symbols) == 1 and other.free_symbols:
                return None
            return f"Solved for ${tex(alone)}$"
    return None


def op_worklines(req: dict) -> dict:
    problem_text = req.get("problem", "").strip()
    if not problem_text:
        raise MathInputError("type the problem on the first line")
    language = req.get("syntax", "latex")
    custom = req.get("languages") or []
    given = Line(problem_text, language, custom)
    out = []
    prev = given
    carried = False  # an earlier line was wrong
    for raw in req.get("lines", []):
        # blank, or clearly still being typed (ends on an operator, or has an
        # empty box) — no marks or complaints yet
        if not raw.strip():
            out.append({"status": "empty"})
            continue
        claim = conclusion(raw)
        if claim:
            entry = _check_conclusion(claim, prev, given, carried)
            carried = carried or entry["status"] == "wrong"
            out.append(entry)
            continue
        try:
            line = Line(raw, language, custom)
        except Incomplete:  # still being typed — no marks or complaints yet
            out.append({"status": "empty"})
            continue
        except MathInputError as exc:
            out.append({"status": "error", "message": str(exc)})
            continue
        except Exception:
            out.append({"status": "error", "message": "couldn't read this line"})
            continue
        entry = {"latex": line.latex(), "parts": line.parts()}
        if line.kind != given.kind and not (given.kind != "expression" and line.kind != "expression"):
            entry.update(status="error", message=f"The problem is an {given.kind} — this line should be one too" + (" (it needs an = sign)." if given.kind == "equation" else "."))
            out.append(entry)
            continue
        follows = equivalent(prev, line)
        if follows is None:
            entry.update(status="unknown", message="Can't check this step automatically.")
        elif not follows:
            entry.update(status="wrong", message=diagnose(prev, line))
            carried = True
        elif carried and not equivalent(given, line):
            entry.update(status="carried", message="This follows from the line above, but an earlier mistake is carried through.")
        else:
            carried = False
            entry.update(status="ok")
            done = _is_done(line, given)
            if done:
                entry["done"] = done
            note = _variable_gone(line, given)
            if note:
                entry["note"] = note
        out.append(entry)
        prev = line
    return {"kind": given.kind, "problem_latex": given.latex(), "problem_parts": given.parts(), "lines": out}
