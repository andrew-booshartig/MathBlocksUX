/** Live preview, as Obsidian does it: text is written as it reads. A
 * heading is big, **bold** is bold, $x^2$ is math, a task's box is a box —
 * and the Markdown that does it (the #, the **, the $) shows only where
 * the caret is, so it can be changed. It's still plain text underneath: the
 * file, Neovim and vim keys all see Markdown. */
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import katex from "katex";

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
        if (name === "Link") {
          const n = node.node;
          const marks = n.getChildren("LinkMark");
          if (marks.length >= 2) out.push(mark("cm-lp-link").range(marks[0].to, marks[1].from));
          if (!touched(node.from, node.to)) {
            if (marks[0]) out.push(hide.range(marks[0].from, marks[0].to));
            // ](address) — all of it
            if (marks[1]) out.push(hide.range(marks[1].from, node.to));
          }
          return false;
        }
        if (name === "Blockquote") {
          for (let p = node.from; p <= node.to; ) {
            const l = state.doc.lineAt(p);
            out.push(line("cm-lp-quote").range(l.from));
            p = l.to + 1;
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

/** Markdown (GitHub's, with task lists and tables), shown as it reads */
export function livePreview(): Extension {
  return [markdown({ base: markdownLanguage }), preview, EditorView.lineWrapping];
}
