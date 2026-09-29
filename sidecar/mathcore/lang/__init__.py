"""Input languages: every language is read into one shared form (ast.py)
and written back out of it — so any language translates to any other,
and new ones (built in, or defined by a teacher as data) just plug in.

    parse(text, language)          → shared form
    write(node, language)          → text in that language
    translate(text, source, target)
    to_sympy(node)                 → for checking
"""

from .ast import Alts, Node, Rel, expand_pm
from .latex import LatexReader, LatexWriter
from .specs import BUILTIN, describe, resolve
from .text import Incomplete, TextReader, TextWriter
from .tosympy import to_sympy

STRUCTURED = {"latex": "LaTeX"}  # not spelled from a definition


def parse(text: str, language: str, custom: list | None = None) -> Node:
    if language == "latex":
        return LatexReader(text).parse()
    return TextReader(text, resolve(language, custom)).parse()


def write(node: Node, language: str, custom: list | None = None) -> str:
    if language == "latex":
        return LatexWriter().write(node)
    return TextWriter(resolve(language, custom)).write(node)


def translate(text: str, source: str, target: str, custom: list | None = None) -> str:
    return write(parse(text, source, custom), target, custom)


def latex(node: Node) -> str:
    return LatexWriter().write(node)


def languages(custom: list | None = None) -> list[dict]:
    """Everything the language picker offers: LaTeX, built-ins, custom."""
    out = [{"id": "latex", "name": "LaTeX", "builtin": True}]
    for language_id in BUILTIN:
        out.append({**describe(resolve(language_id)), "builtin": True})
    for spec in custom or []:
        out.append({**describe(resolve(spec["id"], custom)), "builtin": False})
    return out


__all__ = ["Alts", "Incomplete", "Node", "Rel", "expand_pm", "languages", "latex", "parse", "to_sympy", "translate", "write"]


def op_translate(req: dict) -> dict:
    """Translate lines between languages. A line that can't be read yet
    (half-typed) is left exactly as it was, and flagged."""
    source, target = req.get("from", "latex"), req.get("to", "latex")
    custom = req.get("languages") or []
    out = []
    for text in req.get("items", []):
        if not str(text).strip():
            out.append({"text": "", "ok": True})
            continue
        from ..worklines import conclusion  # here, not at the top: worklines imports lang

        claim = conclusion(str(text))
        if claim:  # "no solution" / "all real numbers" — words, in any language
            words = {"none": "no solution", "all": "all real numbers"}[claim]
            out.append({"text": f"\\text{{{words}}}" if target == "latex" else words, "ok": True})
            continue
        try:
            out.append({"text": translate(text, source, target, custom), "ok": True})
        except Exception as exc:  # noqa: BLE001 — any failure keeps the original line
            out.append({"text": text, "ok": False, "error": str(exc)})
    return {"items": out}


def op_languages(req: dict) -> dict:
    return {"languages": languages(req.get("languages") or [])}
