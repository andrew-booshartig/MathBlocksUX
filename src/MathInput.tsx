/** Visual math input: type the way it looks. "/" makes a real fraction
 * (→ to leave it), "^" a superscript, "sqrt" a root, brackets size
 * themselves — like MathPrint on a TI. Built on MathLive (MIT).
 *
 * The value is LaTeX, which every engine op accepts. Enter, Backspace on an
 * empty field, and ↑/↓ past the edge are handed back to the parent, so a
 * stack of these behaves like lines in a notebook. */
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { MathfieldElement } from "mathlive";

// Fonts ship with the app (public/mathlive/fonts) so it works offline;
// no keypress sounds.
MathfieldElement.fontsDirectory = "/mathlive/fonts";
MathfieldElement.soundsDirectory = null;

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
  className?: string;
  ref?: Ref<MathInputHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  // the latest callbacks, without re-creating the field on every render
  const handlers = useRef({ onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus, onBlur, onArrow });
  handlers.current = { onChange, onEnter, onBackspaceEmpty, onMoveOut, onFocus, onBlur, onArrow };

  useEffect(() => {
    const mf = new MathfieldElement();
    mf.classList.add("nokey");
    // MathLive only accepts most settings once the field is on the page —
    // configuring it first throws "Mathfield not mounted"
    host.current?.appendChild(mf);
    mf.mathVirtualKeyboardPolicy = "manual";
    mf.popoverPolicy = "off";
    mf.menuItems = [];
    mf.smartFence = true;
    // a space is a (thin) space, so 2 1/3 types as the mixed number 2⅓ —
    // MathLive drops spaces by default, which made it 21/3
    mf.mathModeSpace = "\\,";
    mf.value = value;
    mf.addEventListener("input", () => handlers.current.onChange(mf.value));
    mf.addEventListener("focus", () => handlers.current.onFocus?.());
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
    mf.addEventListener("blur", () => handlers.current.onBlur?.());
    // capture phase: runs before MathLive's own key handling inside the field
    mf.addEventListener(
      "keydown",
      (event) => {
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
    // the field is created once; value changes are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mf = field.current;
    if (mf && mf.value !== value) mf.value = value;
  }, [value]);

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
      handlers.current.onChange(mf.value);
    },
    getValue: () => field.current?.value ?? "",
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
      mf.value = latex;
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
