"""Turn App.css's hand-picked colors into theme tokens, keeping each color
as the fallback:  #17171f → var(--t-bg2, #17171f).

Nothing defines the tokens in the canvas app (MatrixLab), so it renders
exactly as before; the calculator app sets them from its theme. Each color
is sorted into a role by lightness and hue: background levels, line/text
levels, or a hue (red … pink). Paper/print styles are left alone — they're
light on purpose in every theme. Run again after adding colors by hand.
"""
import colorsys
import re
import sys
from collections import Counter

SKIP_SELECTOR = re.compile(r"paper|print|graph-theme|theme-", re.I)


def role(hex6: str) -> str:
    r, g, b = (int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    L, S, H = l * 100, s * 100, h * 360
    if L <= 18:  # backgrounds (dark tints too)
        return "bg0" if L < 5 else "bg1" if L < 8.5 else "bg2" if L < 11 else "bg3" if L < 14 else "bg4"
    # grays: lines and text — including pale cool tints (#e8e8f0, #c8d2e0
    # read as text, not as blue); a pale warm/pink tint is still an accent
    if S < 18 or (L >= 60 and S < 45 and 190 <= H <= 260):
        return "line" if L < 28 else "faint" if L < 42 else "muted" if L < 58 else "subtle" if L < 78 else "text"
    for limit, name in ((15, "red"), (45, "orange"), (70, "yellow"), (160, "green"), (200, "teal"), (245, "blue"), (285, "purple"), (345, "pink")):
        if H < limit:
            return name
    return "red"


def expand(h: str) -> str:
    h = h[1:]
    return "".join(c * 2 for c in h) if len(h) in (3, 4) else h


def replace_colors(body: str, counts: Counter) -> str:
    def sub(m):
        if m.group(0).startswith("var("):  # already a token: sort it again (rules may have changed)
            original = m.group(0).split(", ", 1)[1][:-1]
            token = role(expand(original)[:6])
            counts[token] += 1
            return f"var(--t-{token}, {original})"
        full = expand(m.group(0))
        hex6, alpha = full[:6], full[6:]
        token = role(hex6)
        counts[token] += 1
        if alpha:
            pct = round(int(alpha, 16) / 255 * 100)
            return f"color-mix(in srgb, var(--t-{token}, #{hex6}) {pct}%, transparent)"
        return f"var(--t-{token}, {m.group(0)})"

    # skip colors already inside var(--t-…, #…) — idempotent
    return re.sub(r"var\(--t-[a-z0-9]+, #[0-9a-fA-F]{3,8}\)|#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b", sub, body)


def transform(css: str) -> tuple[str, Counter]:
    counts: Counter = Counter()
    out, i, depth, selector_stack = [], 0, 0, []
    start = 0
    # walk blocks: text before each "{" is its selector; skip whole @media print
    while i < len(css):
        ch = css[i]
        if ch == "{":
            head = css[start:i]
            selector = head.strip().split("}")[-1].strip()
            selector_stack.append(selector)
            out.append(head + "{")
            start = i + 1
            depth += 1
        elif ch == "}":
            body = css[start:i]
            skipping = any(SKIP_SELECTOR.search(s) or s.startswith("@media print") for s in selector_stack)
            out.append(body if skipping else replace_colors(body, counts))
            out.append("}")
            selector_stack.pop()
            start = i + 1
            depth -= 1
        elif css.startswith("/*", i):
            end = css.index("*/", i) + 2
            i = end
            continue
        i += 1
    out.append(css[start:])
    return "".join(out), counts


if __name__ == "__main__":
    path = sys.argv[1]
    css = open(path).read()
    new, counts = transform(css)
    open(path, "w").write(new)
    print("tokens:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
