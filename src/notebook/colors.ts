/** Colored words and highlights, written the way Obsidian reads them (the
 * HTML Markdown allows): <span style="color: #e5484d">…</span> and
 * <mark style="background: #2f9e4455">…</mark>. A palette of the theme's
 * own colors — on the page each is drawn in the theme's shade of it, so it
 * sits right in every theme; in another editor it's the color as written. */
import type { EditorView } from "@codemirror/view";

export interface Swatch {
  id: string;
  label: string;
  /** as it's written in the file */
  hex: string;
  /** the theme's own shade of it */
  cssVar: string;
}

export const SWATCHES: Swatch[] = [
  { id: "gray", label: "Gray", hex: "#8a8f98", cssVar: "--t-muted" },
  { id: "red", label: "Red", hex: "#e5484d", cssVar: "--t-red" },
  { id: "orange", label: "Orange", hex: "#f08c2b", cssVar: "--t-orange" },
  { id: "yellow", label: "Yellow", hex: "#d4a20b", cssVar: "--t-yellow" },
  { id: "green", label: "Green", hex: "#2f9e44", cssVar: "--t-green" },
  { id: "teal", label: "Teal", hex: "#12a594", cssVar: "--t-teal" },
  { id: "blue", label: "Blue", hex: "#3b82f6", cssVar: "--t-blue" },
  { id: "purple", label: "Purple", hex: "#8e4ec6", cssVar: "--t-purple" },
  { id: "pink", label: "Pink", hex: "#e93d82", cssVar: "--t-pink" },
];
/** a highlight's see-through-ness, as written (#rrggbb + this) */
const MARK_ALPHA = "55";

export type ColorKind = "text" | "mark";

const swatchOf = (raw: string) => {
  const hex = raw.trim().toLowerCase().slice(0, 7);
  return SWATCHES.find((s) => s.hex === hex);
};
/** a color as written, safe to put on the page (a hex or a color's name; anything else: nothing) */
const safe = (raw: string) => (/^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(raw.trim()) ? raw.trim() : "");

/** a text color on the page: the theme's shade, when it's one of the palette's */
export function textColorCss(raw: string): string {
  const s = swatchOf(raw);
  return s ? `var(${s.cssVar}, ${s.hex})` : safe(raw);
}
/** a highlight on the page: the theme's shade, see-through */
export function markColorCss(raw: string): string {
  const s = swatchOf(raw);
  return s ? `color-mix(in srgb, var(${s.cssVar}, ${s.hex}) 30%, transparent)` : safe(raw);
}

/** the tags, as written */
export const openTag = (kind: ColorKind, hex: string) => (kind === "text" ? `<span style="color: ${hex}">` : `<mark style="background: ${hex}${MARK_ALPHA}">`);
export const closeTag = (kind: ColorKind) => (kind === "text" ? "</span>" : "</mark>");

/** a colored run in a line of text: its tags, where its words are, its color */
export interface ColorSpan {
  kind: ColorKind;
  /** where its opening tag starts, where its words start and end, where its closing tag ends */
  from: number;
  inner: number;
  innerEnd: number;
  to: number;
  color: string;
}
/** every colored run in some text (offset: where the text starts in the document) */
export const COLOR_SPAN = /<(span|mark)\s+style="\s*(color|background(?:-color)?)\s*:\s*([^";]+?)\s*;?\s*"\s*>([^<\n]*)<\/\1>/g;
export function colorSpans(text: string, offset = 0): ColorSpan[] {
  const out: ColorSpan[] = [];
  for (const m of text.matchAll(COLOR_SPAN)) {
    const from = offset + m.index!;
    const openLen = m[0].indexOf(">") + 1;
    const closeLen = m[1].length + 3;
    const kind: ColorKind = m[1] === "span" ? "text" : "mark";
    // (a span's color is its color: a mark's background its background — not the other way round)
    if ((kind === "text") !== (m[2] === "color")) continue;
    out.push({ kind, from, inner: from + openLen, innerEnd: from + m[0].length - closeLen, to: from + m[0].length, color: m[3] });
  }
  return out;
}

/** the color at the caret (or the selection), of each kind */
export function colorsAt(v: EditorView): { text?: string; mark?: string } {
  const { from, to } = v.state.selection.main;
  const line = v.state.doc.lineAt(from);
  const out: { text?: string; mark?: string } = {};
  for (const s of colorSpans(line.text, line.from)) if (s.inner <= from && to <= s.innerEnd) out[s.kind] = s.color;
  return out;
}

/** what's picked colored (or its color taken off: hex null) — the word at the caret when nothing's picked, the run of
 * color the caret's in recolored; colors of a kind don't nest (a run inside what's colored goes) */
export function applyColor(v: EditorView, kind: ColorKind, hex: string | null): void {
  const { state } = v;
  let { from, to } = state.selection.main;
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  // the run the selection's inside: recolored, or uncolored
  const around = colorSpans(firstLine.text, firstLine.from).find((s) => s.kind === kind && s.inner <= from && to <= s.innerEnd);
  if (around && (from === to || (from >= around.inner && to <= around.innerEnd))) {
    if (!hex) {
      v.dispatch({ changes: [{ from: around.from, to: around.inner }, { from: around.innerEnd, to: around.to }], selection: { anchor: from - (around.inner - around.from), head: to - (around.inner - around.from) } });
    } else {
      const open = openTag(kind, hex);
      const shift = open.length - (around.inner - around.from);
      v.dispatch({ changes: { from: around.from, to: around.inner, insert: open }, selection: { anchor: from + shift, head: to + shift } });
    }
    v.focus();
    return;
  }
  // nothing picked: the word at the caret
  if (from === to) {
    const word = state.wordAt(from);
    if (word) ({ from, to } = word);
  }
  // runs of this kind inside it: gone (it's all one color now — or none)
  const inside: ColorSpan[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    const line = state.doc.line(n);
    for (const s of colorSpans(line.text, line.from)) if (s.kind === kind && s.from >= from && s.to <= to) inside.push(s);
  }
  const changes: { from: number; to?: number; insert?: string }[] = [];
  for (const s of inside) changes.push({ from: s.from, to: s.inner }, { from: s.innerEnd, to: s.to });
  if (hex) {
    if (from === to) {
      // nowhere to color: a run started, the caret in it (what's typed next is that color)
      const open = openTag(kind, hex);
      v.dispatch({ changes: { from, insert: open + closeTag(kind) }, selection: { anchor: from + open.length } });
      v.focus();
      return;
    }
    // (across lines: each line's part its own run — a run's on one line)
    for (let n = firstLine.number; n <= lastLine.number; n++) {
      const line = state.doc.line(n);
      const a = Math.max(from, line.from);
      const b = Math.min(to, line.to);
      if (b <= a || !line.text.slice(a - line.from, b - line.from).trim()) continue;
      changes.push({ from: a, insert: openTag(kind, hex) }, { from: b, insert: closeTag(kind) });
    }
  }
  if (!changes.length) return void v.focus();
  const tr = state.update({ changes });
  v.dispatch({ changes, selection: { anchor: tr.changes.mapPos(from, 1), head: tr.changes.mapPos(to, -1) } });
  v.focus();
}

/** runs of color with nothing in them (started, never typed in): taken out of some text */
export const dropEmptyColors = (text: string) => text.replace(/<(span|mark)\s+style="[^"]*"\s*><\/\1>/g, "");

/** ==highlight== around the caret (or what's picked): its marks taken off */
export function dropPlainHighlight(v: EditorView): boolean {
  const { from, to } = v.state.selection.main;
  const line = v.state.doc.lineAt(from);
  for (const m of line.text.matchAll(/==([^=\n]+)==/g)) {
    const a = line.from + m.index!;
    const b = a + m[0].length;
    if (a + 2 <= from && to <= b - 2) {
      v.dispatch({ changes: [{ from: a, to: a + 2 }, { from: b - 2, to: b }], selection: { anchor: from - 2, head: to - 2 } });
      return true;
    }
  }
  return false;
}
