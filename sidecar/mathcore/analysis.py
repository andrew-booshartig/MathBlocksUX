"""A function, looked at closely — GeoGebra's function inspector, the way a
precalculus or calculus class asks for it: its domain and range, where it
crosses zero, its y-intercept, its highs and lows, where it bends, where it
rises and falls, which way it curves, its asymptotes.

Exact where it can be (√2, not 1.414). A polynomial or a fraction of them
is answered for every x; anything else (sin x, which goes on forever) for
the x in view, and says so. Each question gets a moment to answer and is
skipped if it needs longer — a hard function never holds up the graph."""

from __future__ import annotations

import contextlib
import math
import signal

import sympy
from sympy import Interval, S, oo

from .graphtex import X

PATIENCE = 1.2  # seconds, for any one question


class _TooLong(Exception):
    pass


@contextlib.contextmanager
def _within(seconds: float = PATIENCE):
    """give up on a question that takes longer than this (the engine's main thread only)"""
    def stop(*_):
        raise _TooLong

    try:
        old = signal.signal(signal.SIGALRM, stop)
    except ValueError:  # not the main thread: no limit, but no harm
        yield
        return
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


def _num(v) -> float | None:
    try:
        f = float(sympy.N(v))
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _tex(v) -> str:
    return sympy.latex(v).replace(" ", "")


def _said(v) -> str:
    """exact, with its decimal when the exact form isn't plain"""
    v = sympy.nsimplify(v) if isinstance(v, sympy.Float) else v
    t = _tex(v)
    if v.is_Integer or v.is_Rational and len(t) < 10 or len(t) > 28:
        return t if len(t) <= 28 else f"{_num(v):.4g}"
    f = _num(v)
    return f"{t}\\approx{f:.4g}" if f is not None else t


def _rational(f) -> bool:
    try:
        return bool(f.is_rational_function(X))
    except Exception:  # noqa: BLE001
        return False


def _roots(f, lo, hi, everywhere: bool) -> list:
    """where f = 0: exact, sorted — all of them for a polynomial or a
    fraction of them, else the ones between lo and hi"""
    try:
        with _within():
            num, den = sympy.fraction(sympy.together(f))
            if num.is_polynomial(X):
                if not num.has(X):
                    return []
                found = [r for r in sympy.Poly(num, X).real_roots() if sympy.simplify(den.subs(X, r)) != 0]
                found = sorted(set(found), key=lambda r: _num(r) or 0)
                return found if everywhere else [r for r in found if lo - 1e-9 <= (_num(r) or 0) <= hi + 1e-9]
            sol = sympy.solveset(f, X, Interval(lo, hi))
            if isinstance(sol, sympy.FiniteSet) and len(sol) <= 40:
                return sorted(sol, key=lambda r: _num(r) or 0)
    except Exception:  # noqa: BLE001 — too hard to say exactly: find them by number
        pass
    from .graphing import real_roots

    try:
        return [sympy.Float(r, 8) for r in real_roots(f, lo, hi)]
    except Exception:  # noqa: BLE001
        return []


def _breaks(f) -> list:
    """where a fraction of polynomials has no value (its bottom is 0)"""
    try:
        den = sympy.fraction(sympy.together(f))[1]
        return [] if not den.has(X) else sorted(sympy.Poly(den, X).real_roots(), key=lambda r: _num(r) or 0)
    except Exception:  # noqa: BLE001
        return []


def _intervals(sign_of, cuts, lo, hi, everywhere, breaks=()):
    """the stretches between cuts where sign_of(x) > 0, and where < 0 —
    joined across a cut that isn't a break (x³ rises straight through 0)"""
    edges = [(-oo if everywhere else sympy.nsimplify(round(lo, 4)))] + list(cuts) + [(oo if everywhere else sympy.nsimplify(round(hi, 4)))]
    up, down = [], []
    for a, b in zip(edges, edges[1:]):
        fa, fb = _num(a), _num(b)
        if fa is not None and fb is not None and fb - fa < 1e-12:
            continue
        mid = (fa + fb) / 2 if fa is not None and fb is not None else (fb - 1 if fa is None and fb is not None else (fa + 1 if fa is not None else 0.0))
        s = sign_of(mid)
        if s is None or s == 0:
            continue
        (up if s > 0 else down).append((a, b))
    return _merge(up, breaks), _merge(down, breaks)


def _merge(spans, breaks):
    out = []
    for a, b in spans:
        if out and out[-1][1] == a and a not in breaks:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


def _set_tex(spans) -> str:
    return "\\cup".join(f"\\left({_tex(a)},{_tex(b)}\\right)" for a, b in spans) if spans else "\\text{nowhere}"


def _points(xs, f) -> str:
    return ",\\ ".join(f"\\left({_said(x)},{_said(sympy.simplify(f.subs(X, x)))}\\right)" for x in xs[:6]) + (",\\ \\dots" if len(xs) > 6 else "")


def analyze(f, window) -> list[dict]:
    """what's true about y = f(x), row by row: [{label, tex}]"""
    (lo, hi), _ = window
    rows: list[dict] = []
    everywhere = _rational(f)
    where = "" if everywhere else "\\ \\text{(in view)}"
    add = lambda label, tex: rows.append({"label": label, "tex": tex})  # noqa: E731
    def sign(g):
        """g's sign at x — none where f itself has no real value (ln x left of 0)"""

        def at(x):
            if _num(f.subs(X, x)) is None:
                return None
            v = _num(g.subs(X, x))
            return None if v is None else (1 if v > 1e-12 else -1 if v < -1e-12 else 0)

        return at

    try:
        with _within():
            from sympy.calculus.util import continuous_domain

            dom = continuous_domain(f, X, S.Reals)
            add("Domain", "\\mathbb{R}" if dom == S.Reals else _tex(dom))
    except Exception:  # noqa: BLE001
        dom = None
    if everywhere and f.is_polynomial(X):
        try:
            with _within():
                from sympy.calculus.util import function_range

                add("Range", "\\mathbb{R}" if (rng := function_range(f, X, S.Reals)) == S.Reals else _tex(rng))
        except Exception:  # noqa: BLE001
            pass

    zeros = _roots(f, lo, hi, everywhere)
    add("Zeros", (", ".join(f"x={_said(z)}" for z in zeros[:8]) + (", \\dots" if len(zeros) > 8 else "") if zeros else "\\text{none}") + where)
    try:
        y0 = sympy.simplify(f.subs(X, 0))
        if _num(y0) is not None:
            add("y-intercept", f"\\left(0,{_said(y0)}\\right)")
    except Exception:  # noqa: BLE001
        pass

    d1 = sympy.diff(f, X)
    d2 = sympy.diff(d1, X)
    crit = _roots(d1, lo, hi, everywhere)
    highs, lows = [], []
    for c in crit:
        a, b = _num(d1.subs(X, c - 1e-6)), _num(d1.subs(X, c + 1e-6))
        if a is not None and b is not None:
            if a > 0 > b:
                highs.append(c)
            elif a < 0 < b:
                lows.append(c)
    if highs:
        add("Highs (local max)", _points(highs, f) + where)
    if lows:
        add("Lows (local min)", _points(lows, f) + where)
    bends = [c for c in _roots(d2, lo, hi, everywhere) if (lambda a, b: a is not None and b is not None and a * b < 0)(_num(d2.subs(X, c - 1e-6)), _num(d2.subs(X, c + 1e-6)))]
    if bends:
        add("Inflection points", _points(bends, f) + where)

    holes = _breaks(f) if everywhere else []
    # where the domain starts or stops (√(x + 1) begins at −1): a cut too
    edges_of_domain = []
    try:
        edges_of_domain = [b for b in (dom.boundary if dom is not None else []) if (_num(b) is not None and lo < _num(b) < hi)]
    except Exception:  # noqa: BLE001
        pass
    holes = sorted(set(holes) | set(edges_of_domain), key=lambda r: _num(r) or 0)
    rise, fall = _intervals(sign(d1), sorted(set(crit) | set(holes), key=lambda r: _num(r) or 0), lo, hi, everywhere, holes)
    add("Increasing", _set_tex(rise) + where)
    add("Decreasing", _set_tex(fall) + where)
    if d2 != 0:
        cup, cap = _intervals(sign(d2), sorted(set(bends) | set(holes), key=lambda r: _num(r) or 0), lo, hi, everywhere, holes)
        add("Concave up", _set_tex(cup) + where)
        add("Concave down", _set_tex(cap) + where)

    lines = []
    for h in holes:
        if _num(sympy.simplify(sympy.cancel(f)).subs(X, h)) is None:
            lines.append(f"x={_said(h)}")
    try:
        with _within():
            left, right = sympy.limit(f, X, -oo), sympy.limit(f, X, oo)
            for L, reach in ((right, dom is None or dom.sup == oo), (left, dom is None or dom.inf == -oo)):
                if reach and L.is_finite and f"y={_said(L)}" not in lines:
                    lines.append(f"y={_said(L)}")
            if everywhere and not right.is_finite:
                q, r = sympy.div(*sympy.fraction(sympy.cancel(f)), X)
                if q.is_polynomial(X) and sympy.degree(q, X) == 1 and r != 0:
                    lines.append(f"y={_tex(sympy.expand(q))}")
            ends = []
            for side, L, reach in (("x\\to-\\infty", left, dom is None or dom.inf == -oo), ("x\\to\\infty", right, dom is None or dom.sup == oo)):
                # (not off the end of its domain, nor where it isn't real)
                if not reach or L.has(sympy.I) or L is S.NaN or isinstance(L, sympy.AccumBounds):
                    continue
                ends.append(f"{side}:\\ y\\to{_tex(L)}")
            if ends:
                add("End behavior", ",\\quad ".join(ends))
    except Exception:  # noqa: BLE001
        pass
    if lines:
        add("Asymptotes", ",\\ ".join(lines))
    return rows
