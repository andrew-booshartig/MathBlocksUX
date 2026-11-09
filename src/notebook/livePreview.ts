/** Live preview, as Obsidian does it: text is written as it reads. A
 * heading is big, **bold** is bold, $x^2$ is math, a task's box is a box —
 * and the Markdown that does it (the #, the **, the $) shows only where
 * the caret is, so it can be changed. It's still plain text underneath: the
 * file, Neovim and vim keys all see Markdown. */
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { type EditorState, type Extension, type Range, RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import katex from "katex";

/** pictures kept with a notebook (Name.assets/…), read once */
const pictures = new Map<string, string>();
/** a picture the app has just kept (pasted, chosen): known without reading it back */
export const rememberPicture = (path: string, url: string) => void pictures.set(path, url);

/** a picture in the writing: ![](Name.assets/…) or one from the web */
class PictureWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: PictureWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = "cm-lp-picture";
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
          .catch(() => (img.replaceWith(Object.assign(document.createElement("span"), { className: "nb-missing", textContent: this.alt || "(a picture that's gone)" }))));
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

class MathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-math";
    el.innerHTML = katex.renderToString(this.tex, { throwOnError: false, strict: "ignore" });
    return el;
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
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const INLINE: Record<string, { cls: string; marks: string[] }> = {
  Emphasis: { cls: "cm-lp-em", marks: ["EmphasisMark"] },
  StrongEmphasis: { cls: "cm-lp-strong", marks: ["EmphasisMark"] },
  Strikethrough: { cls: "cm-lp-strike", marks: ["StrikethroughMark"] },
  InlineCode: { cls: "cm-lp-code", marks: ["CodeMark"] },
};

function build(state: EditorState, view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  /** callouts' [!kind] markers (not links) */
  const callouts: [number, number][] = [];
  const sel = state.selection.ranges;
  /** the caret (or a selection) touches from…to: its Markdown shows */
  const touched = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number) => {
    const l = state.doc.lineAt(pos);
    return touched(l.from, l.to);
  };
  for (const { from, to } of view.visibleRanges) {
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
          if (!lineTouched(node.from)) out.push(hide.range(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to)));
          return;
        }
        const inline = INLINE[name];
        if (inline) {
          out.push(mark(inline.cls).range(node.from, node.to));
          if (!touched(node.from, node.to)) {
            const n = node.node;
            for (let c = n.firstChild; c; c = c.nextSibling) if (inline.marks.includes(c.name)) out.push(hide.range(c.from, c.to));
          }
          return;
        }
        if (name === "Image") {
          if (touched(node.from, node.to)) return false;
          const n = node.node;
          const url = n.getChild("URL");
          const marks = n.getChildren("LinkMark");
          const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
          if (url) out.push(Decoration.replace({ widget: new PictureWidget(state.sliceDoc(url.from, url.to), alt) }).range(node.from, node.to));
          return false;
        }
        if (name === "HorizontalRule") {
          if (!lineTouched(node.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
          return false;
        }
        if (name === "Link") {
          // (a callout's [!tip] isn't a link)
          if (callouts.some(([a, b]) => node.from >= a && node.to <= b)) return false;
          const n = node.node;
          const marks = n.getChildren("LinkMark");
          const url = n.getChild("URL");
          const href = url ? state.sliceDoc(url.from, url.to) : "";
          if (marks.length >= 2) out.push(Decoration.mark({ class: "cm-lp-link", attributes: href ? { "data-href": href, title: "⌘-click to open" } : {} }).range(marks[0].to, marks[1].from));
          if (!touched(node.from, node.to)) {
            if (marks[0]) out.push(hide.range(marks[0].from, marks[0].to));
            // ](address) — all of it
            if (marks[1]) out.push(hide.range(marks[1].from, node.to));
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
            if (!lineTouched(first.from)) out.push(Decoration.replace({ widget: new CalloutWidget(kind!, !call[3].trim()) }).range(a, Math.min(first.to, b + (call[3] ? 1 : 0))));
          }
          return;
        }
        if (name === "QuoteMark") {
          if (!lineTouched(node.from)) out.push(hide.range(node.from, Math.min(node.to + 1, state.doc.lineAt(node.from).to)));
          return;
        }
        if (name === "TaskMarker") {
          if (!lineTouched(node.from)) out.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(state.sliceDoc(node.from, node.to)), node.from) }).range(node.from, node.to));
          return;
        }
        if (name === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
          if (lineTouched(node.from)) return;
          // a task's box is its bullet
          const task = node.node.parent?.getChild("Task");
          if (task) out.push(hide.range(node.from, Math.min(node.to + 1, task.from)));
          else out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
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
        if (name === "InlineCode" || name === "CodeText") return false;
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
      }
      pos = l.to + 1;
    }
    // what Markdown's parser doesn't know: $math$, ==highlights==, #tags
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(/(?<!\$)\$(?!\$)(?=\S)((?:\\.|[^\\$\n])+?)(?<=\S)\$(?!\d)/g)) {
      const a = from + m.index!;
      const b = a + m[0].length;
      if (touched(a, b)) out.push(mark("cm-lp-math-src").range(a, b));
      else out.push(Decoration.replace({ widget: new MathWidget(m[1]) }).range(a, b));
    }
    for (const m of text.matchAll(/==(?=\S)([^=\n]+?)(?<=\S)==/g)) {
      const a = from + m.index!;
      const b = a + m[0].length;
      out.push(mark("cm-lp-mark").range(a, b));
      if (!touched(a, b)) out.push(hide.range(a, a + 2), hide.range(b - 2, b));
    }
    // [[another note]] (and [[note|what it says]])
    for (const m of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
      const a = from + m.index!;
      const b = a + m[0].length;
      if (touched(a, b)) {
        out.push(mark("cm-lp-wikilink-src").range(a, b));
        continue;
      }
      const shown = m[2] ? b - 2 - m[2].length : a + 2;
      out.push(hide.range(a, shown), Decoration.mark({ class: "cm-lp-wikilink", attributes: { "data-note": m[1].trim(), title: "⌘-click to open" } }).range(shown, b - 2), hide.range(b - 2, b));
    }
    // <u>underlined</u>, <sub>…</sub>, <sup>…</sup> — the HTML Markdown has for them
    for (const m of text.matchAll(/<(u|sub|sup)>([^<\n]+)<\/\1>/g)) {
      const a = from + m.index!;
      const b = a + m[0].length;
      const open = m[1].length + 2;
      out.push(mark(`cm-lp-${m[1]}`).range(a + open, b - open - 1));
      if (!touched(a, b)) out.push(hide.range(a, a + open), hide.range(b - open - 1, b));
    }
    for (const m of text.matchAll(/(^|\s)(#[A-Za-z][\w/-]*)/g)) {
      const a = from + m.index! + m[1].length;
      if (state.doc.lineAt(a).text.match(/^#{1,6}\s/) && state.doc.lineAt(a).from === a) continue;
      out.push(mark("cm-lp-tag").range(a, a + m[2].length));
    }
  }
  return Decoration.set(out, true);
}

const preview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view.state, view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.state, u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

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
  return [markdown({ base: markdownLanguage }), preview, alignField, EditorView.lineWrapping];
}
