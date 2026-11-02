/** Visual math input: type the way it looks. "/" makes a real fraction
 * (→ to leave it), "^" a superscript, "sqrt" a root, brackets size
 * themselves — like MathPrint on a TI. Built on MathLive (MIT).
 *
 * The value is LaTeX, which every engine op accepts. Enter, Backspace on an
 * empty field, and ↑/↓ past the edge are handed back to the parent, so a
 * stack of these behaves like lines in a notebook. */
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { MathfieldElement } from "mathlive";
import { cleanPastedLatex } from "./cleanLatex";
import { mathRequest } from "./mathSidecar";

/** pasted text that's code, not LaTeX: x**2 + 3*x, sqrt(x), math.pi, a == b */
const looksLikeCode = (t: string) => !/\\[a-zA-Z]/.test(t) && /\*\*|\b(?:sqrt|abs|exp|log|sin|cos|tan)\s*\(|\bmath\.|\bnp\.|==|\w\s*\*\s*\w/.test(t);

/** a whole new line in the field. MathLive remembers the last keys typed,
 * for its shortcuts (s + in → sin) — and a shortcut undoes back to before
 * its first key, which brought the old line back (r = d/f, then typing
 * "in" made it r = d/\sin). Moving the cursor forgets those keys. */
function replace(mf: MathfieldElement, latex: string) {
  mf.value = latex;
  mf.executeCommand("moveToMathfieldEnd");
}

// Fonts ship with the app (public/mathlive/fonts) so it works offline;
// no keypress sounds.
MathfieldElement.fontsDirectory = "/mathlive/fonts";
MathfieldElement.soundsDirectory = null;

// ---- selecting the way it's circled on paper: a fraction (root, power…)
// is one piece. MathLive's model numbers every spot inside it, so a plain
// selection could cut a fraction in half, or a ⇧-arrow press could move
// through it without anything changing on screen.
type Atom = { type: string; parent?: Atom; parentBranch?: unknown; leftSibling?: Atom };
type Model = { at(offset: number): Atom | undefined; offsetOf(atom: Atom): number; lastOffset: number };
const modelOf = (mf: MathfieldElement) => (mf as unknown as { _mathfield?: { model?: Model } })._mathfield?.model;

/** Typing the last letter of "or" / "and" between two answers makes it the
 * word (x < 2 or x > 5) — after a number, space, symbol or the start, but
 * never right after a letter, so score and for stay letters. The caret stays
 * in math (MathLive's own shortcuts left it in text mode, where the next
 * answer joined the word). */
function typeWord(mf: MathfieldElement, word: "or" | "and"): boolean {
  const model = modelOf(mf);
  if (!model || !mf.selectionIsCollapsed) return false;
  const typed = word.slice(0, -1); // the letters already in the line
  const pos = mf.position;
  const start = pos - typed.length;
  if (start < 0) return false;
  const letters = Array.from({ length: typed.length }, (_, i) => model.at(start + 1 + i) as Atom & { value?: string });
  if (letters.some((a, i) => a?.type !== "mord" || a.value !== typed[i] || a.parent !== letters[0].parent)) return false;
  const before = model.at(start) as (Atom & { value?: string }) | undefined;
  if (before && before.type === "mord" && /^[A-Za-z]$/.test(before.value ?? "")) return false;
  mf.selection = { ranges: [[start, pos]] };
  mf.insert(`\\text{ ${word} }`, { format: "latex", selectionMode: "after" });
  if (mf.mode !== "math") mf.mode = "math";
  return true;
}

/** [start, end] grown so neither end is inside a structure the other isn't */
function wholePieces(model: Model, start: number, end: number): [number, number] {
  const chain = (offset: number) => {
    const out: Atom[] = [];
    for (let a = model.at(offset); a?.parent; a = a.parent) out.push(a);
    return out;
  };
  const branch = (a: Atom) => [a.parent, JSON.stringify(a.parentBranch)] as const;
  const from = chain(start);
  const to = chain(end);
  for (let i = 0; i < from.length; i++) {
    const [parent, key] = branch(from[i]);
    const j = to.findIndex((a) => a.parent === parent && JSON.stringify(a.parentBranch) === key);
    if (j < 0) continue;
    // climbed out of a structure: take all of it
    const s = i === 0 ? start : from[i].leftSibling ? model.offsetOf(from[i].leftSibling!) : start;
    const e = j === 0 ? end : model.offsetOf(to[j]);
    return [s, e];
  }
  return [start, end];
}

function currentRange(mf: MathfieldElement) {
  const [a, b] = mf.selection.ranges[0];
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return mf.selection.direction === "backward" ? { anchor: hi, focus: lo } : { anchor: lo, focus: hi };
}

/** ⇧← / ⇧→: one press, one visible step — a whole fraction at a time */
function extendByPiece(mf: MathfieldElement, step: -1 | 1): boolean {
  const model = modelOf(mf);
  if (!model) return false; // MathLive changed inside — leave it to its own
  const { anchor } = currentRange(mf);
  let { focus } = currentRange(mf);
  const shown = (lo: number, hi: number) => (lo === hi ? "" : wholePieces(model, lo, hi).join(","));
  const before = shown(Math.min(anchor, focus), Math.max(anchor, focus));
  while (focus + step >= 0 && focus + step <= model.lastOffset) {
    focus += step;
    const lo = Math.min(anchor, focus);
    const hi = Math.max(anchor, focus);
    if (shown(lo, hi) === before) continue;
    if (lo === hi) mf.position = lo;
    else {
      const [s, e] = wholePieces(model, lo, hi);
      mf.selection = { ranges: [[s, e]], direction: focus < anchor ? "backward" : "forward" };
    }
    break;
  }
  return true;
}

export interface MathInputHandle {
  focus: () => void;
  /** Insert LaTeX at the caret. #? = an empty slot, #@ = the selection / what's just before the caret. */
  insert: (latex: string) => void;
  /** Run a MathLive editing command (deleteBackward, moveToPreviousChar…). */
  command: (name: string) => void;
  /** What's in the field right now — the change event can lag a keystroke behind. */
  getValue: () => string;
  /** Replace what's in the field (even when the parent's copy already matches). */
  setValue: (latex: string) => void;
  /** Is the cursor at the top level — not inside a fraction, power or root? */
  atTopLevel: () => boolean;
  /** Is the field on the page and set up yet (a new one takes a frame or two)? */
  ready: () => boolean;
}

export default function MathInput({
  value,
  onChange,
  placeholder,
  onEnter,
  onBackspaceEmpty,
  onMoveOut,
  onFocus,
  onBlur,
  onArrow,
  linear,
  words,
  showStart,
  className,
  ref,
}: {
  value: string;
  onChange: (latex: string) => void;
  /** plain text, shown greyed while the field is empty */
  placeholder?: string;
  onEnter?: (shift: boolean) => void;
  onBackspaceEmpty?: () => void;
  onMoveOut?: (direction: "upward" | "downward") => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** ↑/↓ — return true to take the key (e.g. to cycle through history) */
  onArrow?: (direction: "up" | "down") => boolean;
  /** / types a slash (3/4 on one line), not a stacked fraction */
  linear?: boolean;
  /** names typed out become upright words, like sin: segment, circle… */
  words?: readonly string[];
  /** a line too long for the field shows its start when it isn't being typed in (not where the cursor last was) */
  showStart?: boolean;
  className?: string;
  ref?: Ref<MathInputHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  // the latest callbacks, without re-creating the field on every render
  const handlers = useRef({ onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus, onBlur, onArrow, linear, showStart });
  handlers.current = { onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus, onBlur, onArrow, linear, showStart };

  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    // a field whose spot isn't on the page yet (a tile still being docked)
    // waits for it: MathLive can't be set up off the page
    let cleanup: (() => void) | undefined;
    let frame = 0;
    const mount = () => {
    const mf = new MathfieldElement();
    mf.classList.add("nokey");
    // MathLive only accepts most settings once the field is on the page —
    // configuring it first throws "Mathfield not mounted"
    host.current?.appendChild(mf);
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.popoverPolicy = "off";
    mf.menuItems = [];
    mf.smartFence = true;
    // MathLive turns or / and / not into logic symbols (∨ ∧ ¬), even inside
    // words — score became sc∨e. Here or and and are words (typeWord).
    // So do its unit shortcuts (km → one unit): here letters are letters —
    // k and m are variables of yours.
    // (lb too: MathLive's binary log — 5 lb is five pounds here)
    const units = new Set(["mm", "cm", "km", "kg", "ft", "inch", "mi", "lb"]);
    const { or: _or, and: _and, not: _not, ...shortcuts } = mf.inlineShortcuts;
    mf.inlineShortcuts = {
      ...Object.fromEntries(Object.entries(shortcuts).filter(([key]) => !units.has(key))),
      ...Object.fromEntries((words ?? []).map((w) => [w, `\\operatorname{${w}}`])),
    };
    // copied into another app, math reads as math: (3x)/4+5, not $$\frac{3x}{4}+5$$
    // (pasting back in here uses MathLive's own copy, so nothing is lost)
    mf.onExport = (_from, latex, range) => {
      try {
        return mf.getValue(range[0], range[1], "ascii-math") || latex;
      } catch {
        return latex;
      }
    };
    // a space is a (thin) space, so 2 1/3 types as the mixed number 2⅓ —
    // MathLive drops spaces by default, which made it 21/3
    mf.mathModeSpace = "\\,";
    mf.value = latest.current;
    if (handlers.current.showStart) mf.executeCommand("moveToMathfieldStart");
    mf.addEventListener("input", () => handlers.current.onChange(mf.value));
    mf.addEventListener("focus", () => handlers.current.onFocus?.());
    // a mouse drag (or ⇧⌥ / ⇧⌘ arrows) never ends halfway into a fraction
    mf.addEventListener("selection-change", () => {
      if (mf.selectionIsCollapsed && mf.mode === "text") mf.mode = "math";
      const model = modelOf(mf);
      if (!model || mf.selectionIsCollapsed) return;
      const { anchor, focus } = currentRange(mf);
      const [lo, hi] = [Math.min(anchor, focus), Math.max(anchor, focus)];
      const [s, e] = wholePieces(model, lo, hi);
      if (s !== lo || e !== hi) mf.selection = { ranges: [[s, e]], direction: focus < anchor ? "backward" : "forward" };
    });
    // a press puts the keyboard here at once: MathLive's own pointer
    // handling (it does mouse selection) blocks the browser's focusing and
    // moves the keyboard over 60ms later — keys typed in between were lost.
    // The browser's own focus is immediate (MathLive takes it from there).
    mf.addEventListener(
      "pointerdown",
      () => {
        if (document.activeElement !== mf) HTMLElement.prototype.focus.call(mf, { preventScroll: true });
      },
      { capture: true },
    );
    // pasted from a website (Khan Academy, a textbook): its formatting —
    // colors, \boxed, $…$, "\quad AND \quad" — comes off, so the line shows
    // and reads as plain math. A copy from one of these fields carries
    // MathLive's own JSON: that's left to MathLive.
    mf.addEventListener(
      "paste",
      (event) => {
        const data = event.clipboardData;
        if (!data || data.types.includes("application/json") || data.types.includes("application/json+mathlive")) return;
        const text = data.getData("application/x-latex") || data.getData("text/plain");
        // code (Python's way of writing math): the engine translates it, and the math goes in
        if (text && !data.getData("application/x-latex") && looksLikeCode(text)) {
          event.preventDefault();
          event.stopPropagation();
          mathRequest<{ items: { text: string; ok: boolean }[] }>({ op: "translate", from: "python", to: "latex", items: [text.trim()] })
            .then(({ items }) => (items[0]?.ok ? items[0].text : cleanPastedLatex(text)))
            .catch(() => cleanPastedLatex(text))
            .then((latex) => {
              mf.insert(latex, { format: "latex", selectionMode: "after" });
              if (mf.mode === "text") mf.mode = "math";
              handlers.current.onChange(mf.value);
            });
          return;
        }
        const cleaned = cleanPastedLatex(text);
        if (!text || cleaned === text) return;
        event.preventDefault();
        event.stopPropagation();
        mf.insert(cleaned, { format: "latex", selectionMode: "after" });
        if (mf.mode === "text") mf.mode = "math";
        handlers.current.onChange(mf.value);
      },
      { capture: true },
    );
    mf.addEventListener("blur", () => {
      if (handlers.current.showStart) mf.executeCommand("moveToMathfieldStart");
      handlers.current.onBlur?.();
    });
    // capture phase: runs before MathLive's own key handling inside the field
    let lastKey = "";
    mf.addEventListener(
      "keydown",
      (event) => {
        // words in a line (or, and, no solution) are text; a caret next to
        // one picks up text mode, and what's typed would join the word —
        // nothing here is typed as text, so it's always math (\ still
        // starts a LaTeX command: that's MathLive's "latex" mode, untouched)
        if (mf.mode === "text" && event.key.length === 1 && !event.metaKey && !event.ctrlKey) mf.mode = "math";
        // ** (code's power): the × just typed becomes a power
        const twice = event.key === "*" && lastKey === "*";
        lastKey = event.key;
        if (twice) {
          event.preventDefault();
          event.stopPropagation();
          mf.executeCommand("deleteBackward");
          mf.executeCommand("moveToSuperscript");
          lastKey = "";
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onEnter?.(event.shiftKey);
        } else if (event.key === "Backspace" && mf.value === "" && handlers.current.onBackspaceEmpty) {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onBackspaceEmpty();
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && handlers.current.onArrow?.(event.key === "ArrowUp" ? "up" : "down")) {
          event.preventDefault();
          event.stopPropagation();
        } else if ((event.key === "r" || event.key === "d") && !event.metaKey && !event.ctrlKey && !event.altKey && typeWord(mf, event.key === "r" ? "or" : "and")) {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onChange(mf.value);
        } else if (event.key === "/" && (event.metaKey || event.ctrlKey) && !event.altKey) {
          // ⌘/ is a division sign (÷), to mix with fractions: ¾ ÷ 2
          event.preventDefault();
          event.stopPropagation();
          mf.insert("\\div", { format: "latex" });
          handlers.current.onChange(mf.value);
        } else if (event.key === "/" && handlers.current.linear && !event.metaKey && !event.ctrlKey) {
          // a/b mode: the slash stays a slash, on the line
          event.preventDefault();
          event.stopPropagation();
          mf.insert("/", { format: "latex" });
          handlers.current.onChange(mf.value);
        } else if (event.key === "|" && !event.metaKey && !event.ctrlKey) {
          // | shares the backslash key, which MathLive takes as "type a raw
          // LaTeX command" — so a bar for |x| would strand you in that mode.
          // It's just a bar here (|-3| reads as an absolute value).
          event.preventDefault();
          event.stopPropagation();
          mf.insert("|", { format: "latex" });
          handlers.current.onChange(mf.value);
        } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey) {
          if (extendByPiece(mf, event.key === "ArrowLeft" ? -1 : 1)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      },
      { capture: true },
    );
    mf.addEventListener("move-out", (event) => {
      const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
      if (direction === "upward" || direction === "downward") {
        event.preventDefault();
        handlers.current.onMoveOut?.(direction);
      }
    });
    // a selection as one clean band: MathLive draws a box per piece (a
    // fraction's top, its bottom, the rest, with gaps between), so merge
    // them into a single rounded highlight each time it draws them
    let selectionWatch: MutationObserver | null = null;
    const watchSelection = (tries: number) => {
      const root = mf.shadowRoot;
      if (!root) {
        if (tries > 0) requestAnimationFrame(() => watchSelection(tries - 1));
        return;
      }
      const style = document.createElement("style");
      style.textContent = ".ML__selection { border-radius: 5px; }";
      root.appendChild(style);
      selectionWatch = new MutationObserver(() => {
        const boxes = [...root.querySelectorAll<HTMLElement>(".ML__selection")].filter((el) => el.style.display !== "none");
        if (boxes.length < 2) return;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const el of boxes) {
          const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + parseFloat(el.style.width));
          bottom = Math.max(bottom, y + parseFloat(el.style.height));
        }
        const [band, ...rest] = boxes;
        Object.assign(band.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        for (const el of rest) el.style.display = "none";
      });
      selectionWatch.observe(root, { childList: true, subtree: true });
    };
    watchSelection(10);
    field.current = mf;
    return () => {
      selectionWatch?.disconnect();
      mf.remove();
      field.current = null;
    };
    };
    const start = () => {
      if (host.current?.isConnected) cleanup = mount();
      else frame = requestAnimationFrame(start);
    };
    start();
    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
    // the field is created once; value changes are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mf = field.current;
    if (mf && mf.value !== value) {
      replace(mf, value);
      if (showStart && !mf.hasFocus()) mf.executeCommand("moveToMathfieldStart");
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    // a field that was *just* created finishes mounting a frame later, and
    // ignores focus until then — keep trying for a few frames
    focus: () => {
      const attempt = (tries: number) => {
        const mf = field.current;
        if (!mf) return;
        mf.focus();
        if (!mf.hasFocus() && tries > 0) requestAnimationFrame(() => attempt(tries - 1));
      };
      attempt(10);
    },
    insert: (latex: string) => {
      const mf = field.current;
      if (!mf) return;
      mf.focus();
      // something selected + a template key (fraction, root, |x|…): the
      // selection goes in the first slot — highlight 3x+1, tap the fraction
      // key, and 3x+1 is the top
      const wraps = !mf.selectionIsCollapsed && latex.includes("#?") && !latex.includes("#@");
      mf.insert(wraps ? latex.replace("#?", "#@") : latex, { selectionMode: "placeholder", format: "latex" });
      // a word (or, no solution…) leaves the caret in text mode — where
      // everything typed next would join the word; back to math
      if (mf.mode === "text") mf.mode = "math";
      handlers.current.onChange(mf.value);
    },
    getValue: () => field.current?.value ?? "",
    ready: () => !!field.current,
    // inside a fraction (or power, root…) the math before the cursor comes
    // back flattened, so it stops being the start of the whole line
    atTopLevel: () => {
      const mf = field.current;
      if (!mf) return true;
      return mf.value.startsWith(mf.getValue(0, mf.position, "latex"));
    },
    setValue: (latex: string) => {
      const mf = field.current;
      if (!mf) return;
      replace(mf, latex);
      if (mf.mode !== "math") mf.mode = "math";
      handlers.current.onChange(latex);
    },
    command: (name: string) => {
      const mf = field.current;
      if (!mf) return;
      mf.focus();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mf.executeCommand(name as any);
      handlers.current.onChange(mf.value);
    },
  }));

  // the placeholder is ordinary text over the empty field — MathLive's own
  // draws it as math text, which it boxes in a highlight while focused
  return (
    <div className={`math-input nodrag ${className ?? ""}`}>
      <div ref={host} />
      {!value && placeholder && (
        <span className="math-input-placeholder" aria-hidden>
          {placeholder}
        </span>
      )}
    </div>
  );
}
