/** The bar's colors: the words picked colored, or highlighted, in the
 * palette's colors (the theme's own shades) — the last one used a click
 * away, the rest under ▾. */
import type { EditorView } from "@codemirror/view";
import { type CSSProperties, useState } from "react";
import Icon from "../Icon";
import { type ColorKind, SWATCHES, applyColor, colorsAt, dropPlainHighlight, markColorCss, textColorCss } from "./colors";

interface Last {
  kind: ColorKind;
  hex: string;
}
const remembered = (): Last => {
  try {
    const v = JSON.parse(localStorage.getItem("mlx-last-color") ?? "null");
    if (v && (v.kind === "text" || v.kind === "mark") && typeof v.hex === "string") return v;
  } catch {
    /* none kept */
  }
  return { kind: "text", hex: SWATCHES[1].hex };
};

/** the palette: text colors, then highlights — what's on the words now marked */
export function ColorPalette({ view, onPick, className }: { view: EditorView | null; onPick: (last: Last | null) => void; className?: string }) {
  const now = view ? colorsAt(view) : {};
  const sameHex = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase().slice(0, 7) === b;
  const pick = (kind: ColorKind, hex: string | null) => {
    if (!view) return;
    if (kind === "mark" && !hex) dropPlainHighlight(view);
    applyColor(view, kind, hex);
    onPick(hex ? { kind, hex } : null);
  };
  return (
    <span className={`nb-format-menu nb-color-palette${className ? ` ${className}` : ""}`}>
      <span className="nb-color-title">Text</span>
      <span className="nb-color-row">
        <button className={`nb-color-swatch is-none${!now.text ? " is-on" : ""}`} title="The writing's own color" onClick={() => pick("text", null)}>
          A
        </button>
        {SWATCHES.map((s) => (
          <button key={s.id} className={`nb-color-swatch${sameHex(now.text, s.hex) ? " is-on" : ""}`} title={s.label} style={{ color: textColorCss(s.hex) }} onClick={() => pick("text", s.hex)}>
            A
          </button>
        ))}
      </span>
      <span className="nb-color-title">Highlight</span>
      <span className="nb-color-row">
        <button className={`nb-color-swatch is-none is-mark${!now.mark ? " is-on" : ""}`} title="No highlight" onClick={() => pick("mark", null)}>
          A
        </button>
        {SWATCHES.map((s) => (
          <button key={s.id} className={`nb-color-swatch is-mark${sameHex(now.mark, s.hex) ? " is-on" : ""}`} title={`${s.label} highlight`} style={{ background: markColorCss(s.hex) }} onClick={() => pick("mark", s.hex)}>
            A
          </button>
        ))}
      </span>
    </span>
  );
}

/** the bar's button: the last color, a click away; ▾ the palette */
export default function ColorButton({ view, className }: { view: EditorView | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<Last>(remembered);
  const keep = (next: Last | null) => {
    setOpen(false);
    if (!next) return;
    setLast(next);
    try {
      localStorage.setItem("mlx-last-color", JSON.stringify(next));
    } catch {
      /* only not kept */
    }
  };
  const label = SWATCHES.find((s) => s.hex === last.hex)?.label ?? "Color";
  const css = last.kind === "text" ? textColorCss(last.hex) : markColorCss(last.hex);
  return (
    <span className={`nb-format-anchor nb-color${className ? ` ${className}` : ""}`}>
      <button
        disabled={!view}
        className="nb-color-main"
        title={last.kind === "text" ? `${label} words (▾ for every color)` : `${label} highlight (▾ for every color)`}
        onClick={() => view && (applyColor(view, last.kind, last.hex), keep(last))}
      >
        <span className={`nb-color-a${last.kind === "mark" ? " is-mark" : ""}`} style={{ "--c": css } as CSSProperties}>
          A
        </span>
      </button>
      <button disabled={!view} className={`nb-color-more${open ? " is-on" : ""}`} title="Colors — for the words, and highlights" onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={10} />
      </button>
      {open && (
        <span onMouseLeave={() => setOpen(false)}>
          <ColorPalette view={view} onPick={keep} />
        </span>
      )}
    </span>
  );
}
