/** The writing as it reads, the way a word processor shows it: a heading is
 * big, bold is bold, math is math, a task's box is a box, a bullet a bullet,
 * a link its words — and the Markdown that does it never shows (only a
 * heading's # does, on the line the caret's on: its level, changed by typing).
 * It's plain Markdown underneath — the file, Neovim, Obsidian and vim keys
 * all see it — and the caret, ⌫, ⌦ and the arrows step over what's hidden as
 * a word processor's do (see wysiwyg.ts). Each hidden piece is kept as a
 * `Piece` for them: a mark (**, `, ==, a link's (address)), a line's start (a
 * bullet, a task's box, a quote's >), or a thing whole (math, a picture). */
import { syntaxTree } from "@codemirror/language";
import { colorSpans, markColorCss, textColorCss } from "./colors";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { type EditorState, type Extension, type Range, RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import katex from "katex";

/** pictures kept with a notebook (Name.assets/…), read once */
const pictures = new Map<string, string>();
/** a picture the app has just kept (pasted, chosen): known without reading it back */
export const rememberPicture = (path: string, url: string) => void pictures.set(path, url);

/** what's hidden or drawn over: a mark around words (its node — kind, whole, words — for ⌫ and the format keys), a
 * line's start (⌫ there takes it off: the bullet, the box, the quote), a thing whole (stepped over, ⌫ takes it) */
export interface Piece {
  from: number;
  to: number;
  kind: "mark" | "prefix" | "whole";
  node?: { type: MarkType; from: number; to: number; inner: [number, number] };
}
/** the marks around words the format keys put on and take off */
export type MarkType = "b" | "i" | "s" | "c" | "h" | "u" | "link" | "wiki" | "color" | "esc";
export const MARKS: Record<"b" | "i" | "s" | "c" | "h" | "u", { open: string; close: string }> = {
  b: { open: "**", close: "**" },
  i: { open: "*", close: "*" },
  s: { open: "~~", close: "~~" },
  c: { open: "`", close: "`" },
  h: { open: "==", close: "==" },
  u: { open: "<u>", close: "</u>" },
};

/** inline math, clicked: edited in the notebook's math box (set by the notebook) */
export const mathEditing: { open: ((view: EditorView, from: number, to: number, tex: string) => void) | null } = { open: null };

/** a picture in the writing: ![](Name.assets/…) or one from the web */
class PictureWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** the caret's on it: it's the one picked (as a picture in Word is) */
    readonly picked = false,
  ) {
    super();
  }
  eq(o: PictureWidget) {
    return o.src === this.src && o.alt === this.alt && o.picked === this.picked;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = `cm-lp-picture${this.picked ? " is-picked" : ""}`;
    img.alt = this.alt;
    img.draggable = false;
    const src = this.src.trim();
    if (/^(https?:|data:image\/)/i.test(src)) img.src = src;
    else {
      const path = decodeURI(src);
      const known = pictures.get(path);
      if (known) img.src = known;
      else
        invoke<string>("flat_read", { path })
          .then((url) => (pictures.set(path, url), (img.src = url)))
          .catch(() => img.replaceWith(Object.assign(document.createElement("span"), { className: "nb-missing", textContent: this.alt || "(a picture that's gone)" })));
    }
    // (its height known once it's drawn: the editor measures again)
    img.onload = () => view.requestMeasure();
    return img;
  }
}

/** a callout's kind, where its [!tip] was: its icon (and its name, when it has no title of its own) */
const CALLOUT_ICONS: Record<string, string> = { note: "✎", tip: "💡", hint: "💡", important: "❗", warning: "⚠", caution: "⚠", danger: "⛔", info: "ℹ", todo: "☐", example: "▸", quote: "❝", question: "?", success: "✓", check: "✓", done: "✓", failure: "✗", bug: "🐞", abstract: "≡", summary: "≡" };
class CalloutWidget extends WidgetType {
  constructor(
    readonly kind: string,
    readonly named: boolean,
  ) {
    super();
  }
  eq(o: CalloutWidget) {
    return o.kind === this.kind && o.named === this.named;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-callout-kind";
    el.textContent = `${CALLOUT_ICONS[this.kind] ?? "▸"}${this.named ? ` ${this.kind[0].toUpperCase()}${this.kind.slice(1)}` : ""}`;
    return el;
  }
}

/** a line, drawn: --- */
class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-rule";
    return el;
  }
}

/** $math$, drawn — clicked, it opens in the math box (typed as it looks, no LaTeX needed) */
class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.from === this.from && o.to === this.to;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-lp-math";
    el.title = "Click to change it";
    el.innerHTML = katex.renderToString(this.tex, { throwOnError: false, strict: "ignore" });
    el.onmousedown = (e) => {
      if (!mathEditing.open || e.button !== 0) return;
      e.preventDefault();
      mathEditing.open(view, this.from, this.to, this.tex);
    };
    return el;
  }
  ignoreEvent(e: Event) {
    return e.type === "mousedown";
  }
}

/** a task's box: ticked on a click (its [ ] or [x] changed in the text) */
class TaskWidget extends WidgetType {
  constructor(
    readonly on: boolean,
    readonly at: number,
  ) {
    super();
  }
  eq(o: TaskWidget) {
    return o.on === this.on && o.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.on;
    box.className = "cm-lp-task";
    box.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.on ? " " : "x" } });
    };
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = ["•", "◦", "▪"][this.depth % 3];
    return el;
  }
}

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const INLINE: Record<string, { cls: string; marks: string[]; type: MarkType }> = {
  Emphasis: { cls: "cm-lp-em", marks: ["EmphasisMark"], type: "i" },
  StrongEmphasis: { cls: "cm-lp-strong", marks: ["EmphasisMark"], type: "b" },
  Strikethrough: { cls: "cm-lp-strike", marks: ["StrikethroughMark"], type: "s" },
  InlineCode: { cls: "cm-lp-code", marks: ["CodeMark"], type: "c" },
};

/** the writing from…to: its decorations, and every piece hidden or drawn over. `caretLines`: the lines a heading's #
 * shows on (the caret's) */
export function scan(state: EditorState, from: number, to: number, caretLines: Set<number>, focused: boolean): { decos: Range<Decoration>[]; pieces: Piece[] } {
  const out: Range<Decoration>[] = [];
  const pieces: Piece[] = [];
  /** callouts' [!kind] markers (not links) */
  const callouts: [number, number][] = [];
  const sel = state.selection.ranges;
  /** the caret (or a selection) on from…to — a picture's picked ring */
  const touched = (a: number, b: number) => focused && sel.some((r) => r.from <= b && r.to >= a);
  const hidden = (a: number, b: number, kind: Piece["kind"], node?: Piece["node"]) => {
    if (b <= a) return;
    out.push(hide.range(a, b));
    pieces.push({ from: a, to: b, kind, node });
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const name = node.name;
      const h = name.match(/^ATXHeading(\d)$/);
      if (h) {
        out.push(line(`cm-lp-h${h[1]}`).range(state.doc.lineAt(node.from).from));
        return;
      }
      if (name === "HeaderMark" && node.node.parent?.name.startsWith("ATXHeading")) {
        // (a heading's # shows on the caret's line — its level, changed by typing; elsewhere it's just the heading)
        const l = state.doc.lineAt(node.from);
        if (!(focused && caretLines.has(l.number))) hidden(node.from, Math.min(node.to + 1, l.to), "prefix");
        return;
      }
      const inline = INLINE[name];
      if (inline) {
        out.push(mark(inline.cls).range(node.from, node.to));
        const n = node.node;
        const ms = [];
        for (let c = n.firstChild; c; c = c.nextSibling) if (inline.marks.includes(c.name)) ms.push(c);
        if (ms.length >= 2) {
          const info = { type: inline.type, from: node.from, to: node.to, inner: [ms[0].to, ms[ms.length - 1].from] as [number, number] };
          for (const m of ms) hidden(m.from, m.to, "mark", info);
        }
        return name === "InlineCode" ? false : undefined;
      }
      if (name === "Escape") {
        // \* — the backslash that keeps a * a star
        hidden(node.from, node.from + 1, "mark", { type: "esc", from: node.from, to: node.to, inner: [node.from + 1, node.to] });
        return false;
      }
      if (name === "Image") {
        // (a picture's always the picture — the caret on it picks it)
        const n = node.node;
        const url = n.getChild("URL");
        const marks = n.getChildren("LinkMark");
        const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
        if (url) {
          out.push(Decoration.replace({ widget: new PictureWidget(state.sliceDoc(url.from, url.to), alt, touched(node.from, node.to)) }).range(node.from, node.to));
          pieces.push({ from: node.from, to: node.to, kind: "whole" });
        }
        return false;
      }
      if (name === "HorizontalRule") {
        out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
        pieces.push({ from: node.from, to: node.to, kind: "whole" });
        return false;
      }
      if (name === "Link") {
        // (a callout's [!tip] isn't a link)
        if (callouts.some(([a, b]) => node.from >= a && node.to <= b)) return false;
        const n = node.node;
        const marks = n.getChildren("LinkMark");
        const url = n.getChild("URL");
        const href = url ? state.sliceDoc(url.from, url.to) : "";
        if (marks.length >= 2) {
          out.push(Decoration.mark({ class: "cm-lp-link", attributes: href ? { "data-href": href, title: `${href}\n⌘-click to open` } : {} }).range(marks[0].to, marks[1].from));
          const info = { type: "link" as const, from: node.from, to: node.to, inner: [marks[0].to, marks[1].from] as [number, number] };
          hidden(marks[0].from, marks[0].to, "mark", info);
          // ](address) — all of it
          hidden(marks[1].from, node.to, "mark", info);
        }
        return false;
      }
      if (name === "Blockquote") {
        // > [!tip] A title — a callout (Obsidian's): a box, its kind's color, its title in bold
        const first = state.doc.lineAt(node.from);
        const call = first.text.match(/^(\s*>\s?)\[!(\w+)\][+-]?[^\S\n]*(.*)$/);
        const kind = call?.[2].toLowerCase();
        for (let p = node.from; p <= node.to; ) {
          const l = state.doc.lineAt(p);
          out.push(line(call ? `cm-lp-callout is-${kind}${l.from === first.from ? " cm-lp-callout-title" : ""}` : "cm-lp-quote").range(l.from));
          p = l.to + 1;
        }
        if (call) {
          const a = first.from + call[1].length;
          const b = a + call[2].length + 3;
          callouts.push([a, b]);
          const end = Math.min(first.to, b + (call[3] ? 1 : 0));
          out.push(Decoration.replace({ widget: new CalloutWidget(kind!, !call[3].trim()) }).range(a, end));
          pieces.push({ from: a, to: end, kind: "whole" });
        }
        return;
      }
      if (name === "QuoteMark") {
        const l = state.doc.lineAt(node.from);
        // (the > and the space after it — and a callout's [!kind] right after, drawn as its widget)
        const end = Math.min(node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0), l.to);
        hidden(node.from, end, "prefix");
        return;
      }
      if (name === "TaskMarker") {
        out.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(state.sliceDoc(node.from, node.to)), node.from) }).range(node.from, node.to));
        pieces.push({ from: node.from, to: node.to, kind: "whole" });
        return;
      }
      if (name === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
        // a task's box is its bullet; any other item's bullet is a dot (◦ ▪ further in)
        const task = node.node.parent?.getChild("Task");
        if (task) {
          const box = task.getChild("TaskMarker");
          hidden(node.from, box ? box.from : Math.min(node.to + 1, task.from), "prefix");
        } else {
          let depth = 0;
          for (let p = node.node.parent?.parent?.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
          out.push(Decoration.replace({ widget: new BulletWidget(depth) }).range(node.from, node.to));
          pieces.push({ from: node.from, to: Math.min(node.to + 1, state.doc.lineAt(node.from).to), kind: "prefix" });
        }
        return;
      }
      if (name === "FencedCode") {
        for (let p = node.from; p <= node.to; ) {
          const l = state.doc.lineAt(p);
          out.push(line("cm-lp-codeblock").range(l.from));
          p = l.to + 1;
        }
        return false;
      }
      if (name === "CodeText") return false;
    },
  });
  // a list item's lines wrap under its text, not its marker (as Word's do) — lettered ones too
  for (let pos = from; pos <= to; ) {
    const l = state.doc.lineAt(pos);
    const item = l.text.match(/^(\s*)([-*+]|\d{1,9}[.)]|[a-zA-Z][.)])(\s+)(\[[ xX]\]\s+)?/);
    if (item) {
      const width = item[0].length - (/^[-*+]$/.test(item[2]) ? 0.4 : 0);
      out.push(Decoration.line({ class: "cm-lp-item", attributes: { style: `padding-left: calc(${width}ch + 6px); text-indent: calc(-${width}ch)` } }).range(l.from));
      if (/^[a-zA-Z][.)]$/.test(item[2])) out.push(mark("cm-lp-letter").range(l.from + item[1].length, l.from + item[1].length + item[2].length));
      // (a numbered item: ⌫ at its words' start takes its number off, as a bullet's)
      if (/^(\d{1,9}|[a-zA-Z])[.)]$/.test(item[2])) pieces.push({ from: l.from + item[1].length, to: l.from + item[1].length + item[2].length + item[3].length, kind: "prefix" });
    }
    if (l.to >= to) break;
    pos = l.to + 1;
  }
  // what Markdown's parser doesn't know: $math$, ==highlights==, [[links]], <u>, colors, #tags
  const text = state.sliceDoc(from, to);
  for (const m of text.matchAll(/(?<!\$)\$(?!\$)(?=\S)((?:\\.|[^\\$\n])+?)(?<=\S)\$(?!\d)/g)) {
    const a = from + m.index!;
    const b = a + m[0].length;
    // (in code it's just dollars)
    const at = syntaxTree(state).resolveInner(a, 1);
    if (/Code/.test(at.name) || /Code/.test(at.parent?.name ?? "")) continue;
    out.push(Decoration.replace({ widget: new MathWidget(m[1], a, b) }).range(a, b));
    pieces.push({ from: a, to: b, kind: "whole" });
  }
  for (const m of text.matchAll(/==(?=\S)([^=\n]+?)(?<=\S)==/g)) {
    const a = from + m.index!;
    const b = a + m[0].length;
    out.push(mark("cm-lp-mark").range(a, b));
    const info = { type: "h" as const, from: a, to: b, inner: [a + 2, b - 2] as [number, number] };
    hidden(a, a + 2, "mark", info);
    hidden(b - 2, b, "mark", info);
  }
  // [[another note]] (and [[note|what it says]])
  for (const m of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const a = from + m.index!;
    const b = a + m[0].length;
    const shown = m[2] ? b - 2 - m[2].length : a + 2;
    const info = { type: "wiki" as const, from: a, to: b, inner: [shown, b - 2] as [number, number] };
    hidden(a, shown, "mark", info);
    out.push(Decoration.mark({ class: "cm-lp-wikilink", attributes: { "data-note": m[1].trim(), title: `${m[1].trim()} — ⌘-click to open` } }).range(shown, b - 2));
    hidden(b - 2, b, "mark", info);
  }
  // <u>underlined</u>, <sub>…</sub>, <sup>…</sup> — the HTML Markdown has for them
  for (const m of text.matchAll(/<(u|sub|sup)>([^<\n]+)<\/\1>/g)) {
    const a = from + m.index!;
    const b = a + m[0].length;
    const open = m[1].length + 2;
    out.push(mark(`cm-lp-${m[1]}`).range(a + open, b - open - 1));
    const info = { type: m[1] === "u" ? ("u" as const) : ("esc" as const), from: a, to: b, inner: [a + open, b - open - 1] as [number, number] };
    hidden(a, a + open, "mark", info);
    hidden(b - open - 1, b, "mark", info);
  }
  // colored words and highlights: the color drawn, the tags it's written with never shown
  for (const c of colorSpans(text, from)) {
    if (c.innerEnd > c.inner)
      out.push(
        Decoration.mark(c.kind === "text" ? { class: "cm-lp-color", attributes: { style: `color: ${textColorCss(c.color)}` } } : { class: "cm-lp-hl", attributes: { style: `background: ${markColorCss(c.color)}` } }).range(c.inner, c.innerEnd),
      );
    const info = { type: "color" as const, from: c.from, to: c.to, inner: [c.inner, c.innerEnd] as [number, number] };
    hidden(c.from, c.inner, "mark", info);
    hidden(c.innerEnd, c.to, "mark", info);
  }
  for (const m of text.matchAll(/(^|\s)(#[A-Za-z][\w/-]*)/g)) {
    const a = from + m.index! + m[1].length;
    // (a color's #hex, inside the HTML it's written with, isn't a tag)
    const before = text.slice(0, a - from);
    if (before.lastIndexOf("<") > before.lastIndexOf(">")) continue;
    if (state.doc.lineAt(a).text.match(/^#{1,6}\s/) && state.doc.lineAt(a).from === a) continue;
    out.push(mark("cm-lp-tag").range(a, a + m[2].length));
  }
  return { decos: out, pieces };
}

/** the lines the caret's on (a heading's # shows there) */
export const caretLinesOf = (state: EditorState) => new Set(state.selection.ranges.flatMap((r) => [state.doc.lineAt(r.from).number, state.doc.lineAt(r.to).number]));

/** the pieces around a place (for the keys): what's hidden near it, worked out from the text as it is */
export function piecesNear(state: EditorState, pos: number, span = 400): Piece[] {
  const from = state.doc.lineAt(Math.max(0, pos - span)).from;
  const to = state.doc.lineAt(Math.min(state.doc.length, pos + span)).to;
  return scan(state, from, to, caretLinesOf(state), true).pieces;
}

const preview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: RangeSet<Decoration>;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } = this.make(view));
    }
    make(view: EditorView) {
      const decos: Range<Decoration>[] = [];
      const atom: Range<Decoration>[] = [];
      const lines = caretLinesOf(view.state);
      for (const { from, to } of view.visibleRanges) {
        const s = scan(view.state, from, to, lines, view.hasFocus);
        decos.push(...s.decos);
        // (each hidden piece stepped over as one thing: the caret's on one side of it or the other)
        for (const p of s.pieces) atom.push(Decoration.mark({}).range(p.from, p.to));
      }
      return { decorations: Decoration.set(decos, true), atomic: RangeSet.of(atom, true) };
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) ({ decorations: this.decorations, atomic: this.atomic } = this.make(u.view));
    }
  },
  { decorations: (v) => v.decorations },
);
const atomicPieces = EditorView.atomicRanges.of((view) => view.plugin(preview)?.atomic ?? Decoration.none);
/** whether an editor's the live writing (not a code block's or the Markdown's own) */
export const isLive = (view: EditorView) => !!view.plugin(preview);

/** a paragraph's alignment (<!-- matrixlab: align center --> the line before it): the comment
 * hidden (and stepped over as one thing — ⌫ at the paragraph's start takes the alignment off),
 * the paragraph's lines aligned so — till a blank line, or a heading */
const ALIGN = /^<!--\s*matrixlab:\s*align\s+(left|center|right)\s*-->\s*$/;
function aligned(state: EditorState) {
  const decos: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const doc = state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const m = line.text.match(ALIGN);
    if (!m) continue;
    decos.push(Decoration.replace({ block: true }).range(line.from, line.to));
    atomic.push(Decoration.mark({}).range(line.from, Math.min(doc.length, line.to + 1)));
    for (let k = n + 1; k <= doc.lines; k++) {
      const l = doc.line(k);
      const heading = /^#{1,6}\s/.test(l.text);
      if (!l.text.trim() || ALIGN.test(l.text) || (heading && k > n + 1)) break;
      decos.push(Decoration.line({ attributes: { style: `text-align: ${m[1]}` }, class: `cm-lp-align-${m[1]}` }).range(l.from));
      if (heading) break;
    }
  }
  return { decos: Decoration.set(decos, true), atomic: RangeSet.of(atomic, true) };
}
const alignField = StateField.define<{ decos: DecorationSet; atomic: RangeSet<Decoration> }>({
  create: aligned,
  update: (v, tr) => (tr.docChanged ? aligned(tr.state) : v),
  provide: (f) => [EditorView.decorations.from(f, (v) => v.decos), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
});

/** the alignment of the paragraph at a place (its comment's line, if it has one) */
export function alignmentAt(state: EditorState, pos: number): { align: "left" | "center" | "right"; line: number | null } {
  const doc = state.doc;
  let n = doc.lineAt(pos).number;
  // up to the paragraph's first line (a heading is a paragraph of its own)
  while (n > 1 && doc.line(n - 1).text.trim() && !ALIGN.test(doc.line(n - 1).text) && !/^#{1,6}\s/.test(doc.line(n).text) && !/^#{1,6}\s/.test(doc.line(n - 1).text)) n--;
  const above = n > 1 ? doc.line(n - 1) : null;
  const m = above?.text.match(ALIGN);
  return m ? { align: m[1] as "left" | "center" | "right", line: above!.number } : { align: "left", line: null };
}

/** the paragraph at the caret aligned (left: its comment gone) */
export function setAlignment(view: EditorView, align: "left" | "center" | "right") {
  const { state } = view;
  const at = alignmentAt(state, state.selection.main.head);
  const doc = state.doc;
  if (at.line !== null) {
    const l = doc.line(at.line);
    if (align === "left") view.dispatch({ changes: { from: l.from, to: Math.min(doc.length, l.to + 1), insert: "" } });
    else view.dispatch({ changes: { from: l.from, to: l.to, insert: `<!-- matrixlab: align ${align} -->` } });
  } else if (align !== "left") {
    let n = doc.lineAt(state.selection.main.head).number;
    while (n > 1 && doc.line(n - 1).text.trim() && !/^#{1,6}\s/.test(doc.line(n).text) && !/^#{1,6}\s/.test(doc.line(n - 1).text)) n--;
    view.dispatch({ changes: { from: doc.line(n).from, insert: `<!-- matrixlab: align ${align} -->\n` } });
  }
  view.focus();
}

/** Markdown (GitHub's, with task lists and tables), shown as it reads */
export function livePreview(): Extension {
  return [markdown({ base: markdownLanguage }), preview, atomicPieces, alignField, EditorView.lineWrapping];
}
