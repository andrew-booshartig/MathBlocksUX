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
    mf.value = value;
    mf.addEventListener("input", () => handlers.current.onChange(mf.value));
    mf.addEventListener("focus", () => handlers.current.onFocus?.());
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
    field.current = mf;
    return () => {
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
