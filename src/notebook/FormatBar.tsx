/** The formatting bar, as every text editor has one: undo, the paragraph's
 * style, bold and its kin, links, lists, a table, a picture, math. It works
 * on the text being written (its live preview); with nothing being written,
 * a style or a list starts a new paragraph at the end. */
import { useRef, useState } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import Icon from "../Icon";
import { writingKey } from "./writing";
import { tabKey } from "./proseKeys";

/** what starts a line: a heading's #s, a quote's >, a list's marker (lettered too) */
const LEAD = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|[a-zA-Z][.)]\s+)?/;

/** symbols a keyboard hasn't got, a click away (as Word's Insert → Symbol) */
const SYMBOLS = ["×", "÷", "±", "−", "·", "√", "∛", "π", "°", "≤", "≥", "≠", "≈", "∞", "²", "³", "½", "¼", "¾", "θ", "Δ", "Ω", "μ", "Σ", "∠", "⊥", "∥", "→", "←", "⇒", "%", "‰"];

const STYLES = [
  { id: "text", label: "Text", lead: "" },
  { id: "h1", label: "Heading 1", lead: "# " },
  { id: "h2", label: "Heading 2", lead: "## " },
  { id: "h3", label: "Heading 3", lead: "### " },
  { id: "quote", label: "Quote", lead: "> " },
];

/** each selected line's lead made `lead` (or taken off, when it's that already) */
function setLead(v: EditorView, lead: string, toggle = false) {
  const { state } = v;
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from).number;
  const last = state.doc.lineAt(sel.to).number;
  const changes = [];
  const kindOf = (l?: string) => (!l ? "" : /^\d/.test(l) ? "1. " : /^[a-z][.)]/.test(l) ? "a. " : /^[A-Z][.)]/.test(l) ? "A. " : l);
  const already = toggle && kindOf(state.doc.line(first).text.match(LEAD)?.[2]) === kindOf(lead);
  for (let n = first, k = 1; n <= last; n++, k++) {
    const line = state.doc.line(n);
    const m = line.text.match(LEAD)!;
    const next = already ? "" : lead === "1. " ? `${k}. ` : lead === "a. " ? `${String.fromCharCode(96 + Math.min(26, k))}. ` : lead === "A. " ? `${String.fromCharCode(64 + Math.min(26, k))}. ` : lead;
    changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: next });
  }
  v.dispatch({ changes });
  v.focus();
}

function wrapWith(v: EditorView, key: string, shift = false) {
  const sel = v.state.selection.main;
  // (a selection from the line's start leaves its # or list marker outside: **inside** them)
  const line = v.state.doc.lineAt(sel.from);
  const lead = line.text.match(LEAD)![0].length;
  const from = sel.from - line.from < lead && sel.to > line.from + lead ? line.from + lead : sel.from;
  const edit = writingKey({ key, metaKey: true, ctrlKey: false, shiftKey: shift, altKey: false }, v.state.doc.toString(), from, sel.to);
  if (edit) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: edit.value }, selection: { anchor: edit.start, head: edit.end } });
  v.focus();
}

function insert(v: EditorView, text: string, caret = text.length) {
  const at = v.state.selection.main;
  v.dispatch({ changes: { from: at.from, to: at.to, insert: text }, selection: { anchor: at.from + caret } });
  v.focus();
}

export default function FormatBar({
  view,
  onUndo,
  onRedo,
  onNew,
  onPicture,
  onTable,
  onApp,
  align,
  onAlign,
}: {
  /** the text being written, if any */
  view: EditorView | null;
  /** the notebook's own undo (blocks added, moved, deleted), when nothing's being written */
  onUndo: () => void;
  onRedo: () => void;
  /** nothing being written: a new paragraph at the end, starting with this */
  onNew: (start: string) => void;
  /** a picture file chosen: kept with the notebook, its Markdown back */
  onPicture: (file: File) => Promise<string | null>;
  /** a spreadsheet, under the text being written (or at the end) */
  onTable: () => void;
  /** an app block (Calculate, Work, Graph), under the text being written (or at the end), open to work in */
  onApp: (lang: "calc" | "work" | "graph" | "paper" | "math") => void;
  /** the paragraph's alignment (the one being written, or picked) — none: nothing to align */
  align?: "left" | "center" | "right";
  onAlign?: (a: "left" | "center" | "right") => void;
}) {
  const [symbols, setSymbols] = useState(false);
  const [styles, setStyles] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const line = view ? view.state.doc.lineAt(view.state.selection.main.head).text : "";
  const current = STYLES.find((s) => s.lead && line.startsWith(s.lead) && !line.startsWith(`${s.lead.trim()}#`)) ?? STYLES[0];
  const off = !view;
  // (a press on the bar keeps the text's caret where it is)
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const lead = (l: string, toggle = false) => (view ? setLead(view, l, toggle) : onNew(l));
  return (
    <div className="nb-format" onMouseDown={keep}>
      <button title="Undo (⌘Z)" onClick={() => (view ? (undo(view), view.focus()) : onUndo())}>
        <Icon name="undo" size={15} />
      </button>
      <button title="Redo (⌘⇧Z)" onClick={() => (view ? (redo(view), view.focus()) : onRedo())}>
        <Icon name="redo" size={15} />
      </button>
      <span className="nb-format-sep" />
      <span className="nb-format-anchor">
        <button className="nb-format-style" title="The paragraph's style" onClick={() => setStyles(!styles)}>
          {current.label} <Icon name="chevron" size={12} />
        </button>
        {styles && (
          <span className="nb-format-menu" onMouseLeave={() => setStyles(false)}>
            {STYLES.map((s) => (
              <button key={s.id} className={`is-${s.id}`} onClick={() => (setStyles(false), lead(s.lead))}>
                {s.label}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="nb-format-sep" />
      <button disabled={off} title="Bold (⌘B)" onClick={() => view && wrapWith(view, "b")}>
        <b>B</b>
      </button>
      <button disabled={off} title="Italic (⌘I)" onClick={() => view && wrapWith(view, "i")}>
        <i>I</i>
      </button>
      <button disabled={off} title="Strikethrough (⌘⇧X)" onClick={() => view && wrapWith(view, "x", true)}>
        <s>S</s>
      </button>
      <button disabled={off} title="Code (⌘E)" onClick={() => view && wrapWith(view, "e")}>
        <Icon name="source" size={14} />
      </button>
      <button disabled={off} title="Highlight (⌘⇧H)" onClick={() => view && wrapWith(view, "h", true)}>
        <span className="nb-format-mark">H</span>
      </button>
      <button disabled={off} title="Link (⌘K)" onClick={() => view && wrapWith(view, "k")}>
        <Icon name="link" size={14} />
      </button>
      <span className="nb-format-sep" />
      <button title="Bulleted list (⌘⇧8)" onClick={() => lead("- ", true)}>
        <Icon name="list" size={15} />
      </button>
      <button title="Numbered list (⌘⇧7) — Enter goes on to the next number" onClick={() => lead("1. ", true)}>
        <span className="nb-format-num">1.</span>
      </button>
      <button title="Lettered list — a. b. c." onClick={() => lead("a. ", true)}>
        <span className="nb-format-num">a.</span>
      </button>
      <button title="Lettered list — A. B. C." onClick={() => lead("A. ", true)}>
        <span className="nb-format-num">A.</span>
      </button>
      <button title="Checklist (⌘⇧9)" onClick={() => lead("- [ ] ", true)}>
        <Icon name="check" size={15} />
      </button>
      <button disabled={off} title="Outdent (⇧Tab)" onClick={() => view && (tabKey(true)(view), view.focus())}>
        <Icon name="outdent" size={15} />
      </button>
      <button disabled={off} title="Indent — a list item in under the one above (Tab)" onClick={() => view && (tabKey(false)(view), view.focus())}>
        <Icon name="indent" size={15} />
      </button>
      <span className="nb-format-sep" />
      {(["left", "center", "right"] as const).map((a) => (
        <button key={a} disabled={!onAlign} className={align === a ? "is-on" : ""} title={`Align ${a}`} onClick={() => onAlign?.(a)}>
          <Icon name={a === "left" ? "alignLeft" : a === "center" ? "alignCenter" : "alignRight"} size={15} />
        </button>
      ))}
      <span className="nb-format-sep" />
      <button title="A table — a spreadsheet, typed into right on the page" onClick={onTable}>
        <Icon name="table" size={15} />
      </button>
      <button title="A picture" onClick={() => file.current?.click()}>
        <Icon name="image" size={15} />
      </button>
      <button title="Math — a problem written out, typed as it reads (in a line of text, $x^2$ does it)" onClick={() => onApp("math")}>
        <span className="nb-format-num">∑</span>
      </button>
      <span className="nb-format-anchor">
        <button disabled={off} className={symbols ? "is-on" : ""} title="A symbol — × ÷ ± √ π ° ≤ ≥ ≈ ½ …" onClick={() => setSymbols(!symbols)}>
          <span className="nb-format-num">Ω</span>
        </button>
        {symbols && view && (
          <span className="nb-format-menu nb-format-symbols" onMouseLeave={() => setSymbols(false)}>
            {SYMBOLS.map((c) => (
              <button key={c} onClick={() => (insert(view, c), setSymbols(false))}>
                {c}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="nb-format-sep" />
      <button className="nb-format-app" title="Calculate — work it out, right on the page" onClick={() => onApp("calc")}>
        <Icon name="calc" size={15} /> <span className="nb-format-label">Calculate</span>
      </button>
      <button className="nb-format-app" title="Work — solve a problem step by step, right on the page" onClick={() => onApp("work")}>
        <Icon name="work" size={15} /> <span className="nb-format-label">Work</span>
      </button>
      <button className="nb-format-app" title="Graph — right on the page" onClick={() => onApp("graph")}>
        <Icon name="graph" size={15} />
      </button>
      <button className="nb-format-app" title="Graph paper — beside what you're writing: work it out by hand, a digit a square, carries, lines, crossing out" onClick={() => onApp("paper")}>
        <Icon name="gridpaper" size={15} /> <span className="nb-format-label">Paper</span>
      </button>
      {/* graph paper being worked on: its tools take the bar (as Word's ribbon turns to a table's) */}
      <div className="nb-format-slot" />
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const md = await onPicture(f);
          if (md) view ? insert(view, md) : onNew(md);
        }}
      />
    </div>
  );
}
