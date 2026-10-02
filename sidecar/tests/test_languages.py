"""Every language translates to every other without changing the math."""

import pytest
import sympy

from mathcore.lang import Alts, Rel, expand_pm, parse, to_sympy, translate, write
from mathcore.parsing import MathInputError

LANGS = ["latex", "python", "lua", "haskell"]

SAMPLES = [
    ("latex", r"6s-4=8\left(2+\frac14s\right)"),
    ("latex", r"x^{2}-5x+6=0"),
    ("latex", r"\frac{x+1}{2}\le3"),
    ("latex", r"x=\pm4"),
    ("latex", r"\sqrt{x+1}=3"),
    ("latex", r"\left|x-2\right|>3"),
    ("latex", r"y=\frac{1}{2}x+3"),
    ("latex", r"2\cdot3+4x^{-2}"),
    ("latex", r"x=2\text{ or }x=3"),
    ("latex", r"\sqrt[3]{27}+\pi r^2"),
    ("latex", r"-2(x-3)^2"),
    ("latex", r"\frac{2x}{3y}-\frac{1}{4}"),
    ("latex", r"-3\le2x+1<7"),
    ("latex", r"x+2\frac13=-1\frac{1}{2}"),
    ("latex", r"6\div2\frac{1}{3}x"),
    ("python", "6*s - 4 == 8*(2 + 1/4*s)"),
    ("python", "x**2 - 5*x + 6 == 0"),
    ("python", "sqrt(x + 1) == 3"),
    ("python", "abs(x - 2) > 3"),
    ("python", "x == 4 or x == -4"),
    ("python", "y = 1/2*x + 3"),
    ("python", "pi*r**2"),
    ("lua", "x^2 - 5*x + 6 == 0"),
    ("lua", "math.sqrt(x + 1) == 3"),
    ("lua", "2*x/(3*y)"),
    ("haskell", "x^2 - 5*x + 6 == 0"),
    ("haskell", "sqrt (x + 1) == 3"),
    ("haskell", "abs (x - 2) > 3"),
    ("haskell", "x == 2 || x == 3"),
    ("haskell", "sqrt x ^ 2"),
]


def meaning(node):
    """Order-free fingerprint of the math: what each relation/answer says."""
    node = expand_pm(node)
    if isinstance(node, Alts):
        return frozenset(meaning(i) for i in node.items)
    if isinstance(node, Rel):
        sides = [to_sympy(p) for p in node.parts]
        return tuple((op, sympy.simplify(a - b)) for op, a, b in zip(node.ops, sides, sides[1:]))
    return sympy.simplify(to_sympy(node))


@pytest.mark.parametrize("source,text", SAMPLES)
@pytest.mark.parametrize("target", LANGS)
def test_translation_keeps_meaning(source, text, target):
    original = parse(text, source)
    translated = write(original, target)
    assert meaning(parse(translated, target)) == meaning(original), translated


@pytest.mark.parametrize("source,text", SAMPLES)
def test_round_trip_is_stable(source, text):
    """A → B → A → B gives the same text the second time (no drift)."""
    for target in LANGS:
        once = translate(text, source, target)
        twice = translate(translate(once, target, source), source, target)
        assert once == twice


@pytest.mark.parametrize("text,latex", [
    ("6*s - 4 == 8*(2 + 1/4*s)", r"6s - 4 = 8\left(2 + \frac{1}{4}s\right)"),
    ("x**2 - 5*x + 6 == 0", r"x^{2} - 5x + 6 = 0"),
    ("2*3", r"2 \cdot 3"),
])
def test_code_reads_naturally_as_latex(text, latex):
    assert translate(text, "python", "latex") == latex


@pytest.mark.parametrize("language,text,message", [
    ("python", "x^2", "isn't a power"),
    ("python", "2x", "needs `*`"),
    ("lua", "x**2", "In Lua, powers use"),
    ("haskell", "x = 2", None),  # = is accepted as equals
])
def test_language_rules(language, text, message):
    if message is None:
        parse(text, language)
        return
    with pytest.raises(MathInputError, match=message):
        parse(text, language)


def test_teacher_defined_language():
    custom = [{
        "id": "pseudo",
        "name": "Pseudocode",
        "power": ["pow"],
        "equals": ["EQUALS"],
        "not_equal": ["<>"],
        "or": ["OR"],
        "names": {"sqrt": "ROOT", "abs": "ABS", "pi": "PI"},
        "implicit_multiplication": True,
    }]
    out = translate(r"x^{2}=\sqrt{9}\text{ or }2x=\pi", "latex", "pseudo", custom)
    assert out == "x pow 2 EQUALS ROOT(9) OR 2*x EQUALS PI"
    back = translate("2x pow 2 EQUALS ROOT(9)", "pseudo", "latex", custom)
    assert back == r"2x^{2} = \sqrt{9}"


@pytest.mark.parametrize("latex,value", [
    # a whole number against a fraction of numbers: a mixed number, as on paper
    (r"2\frac13", "7/3"),
    (r"2\frac{1}{3}", "7/3"),
    (r"12\frac{3}{4}", "51/4"),
    (r"-2\frac13", "-7/3"),          # −(2 + ⅓), not −2 + ⅓
    (r"5-2\frac13", "8/3"),
    (r"6\div2\frac13", "18/7"),     # 6 ÷ 7/3
    (r"2\frac13x", "7*x/3"),
    (r"\left(2\frac13\right)^2", "49/9"),
    # everything else still multiplies
    (r"2\frac{x}{3}", "2*x/3"),
    (r"2\cdot\frac13", "2/3"),
    (r"2\left(\frac13\right)", "2/3"),
    (r"x\frac13", "x/3"),
    (r"0.5\frac13", "1/6"),
])
def test_mixed_numbers_read_like_paper(latex, value):
    assert sympy.simplify(to_sympy(parse(latex, "latex")) - sympy.sympify(value)) == 0


def test_mixed_numbers_write_back():
    node = parse(r"-2\frac13", "latex")
    assert write(node, "latex") == r"-2\frac{1}{3}"
    assert write(node, "python") == "-(2 + 1/3)"
    assert to_sympy(parse(r"2\frac13", "latex"), evaluate=False) == sympy.Rational(7, 3)  # one number
    # a product of 2 and ⅓ keeps its dot, so it never reads back as 2⅓
    assert translate("2*(1/3)", "python", "latex") == r"2\left(\frac{1}{3}\right)"
    assert write(parse(r"2\cdot\frac13", "latex"), "latex") == r"2 \cdot \frac{1}{3}"
