/** The formatting bar, as Word's ribbon has it: undo, the paragraph's
 * style, the notebook's fonts (any on this Mac — the writing's and the
 * headings' apart) and size, bold and its kin, links, lists, alignment, a
 * table, a picture, math, a symbol — and the apps, put in where the caret
 * is. It works on the writing the caret's in (its live preview); with no
 * caret anywhere, a style or a list starts a new paragraph at the end. */
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import Icon from "../Icon";
import ColorButton, { ColorPalette } from "./ColorMenu";
import { tabKey, wrapKey } from "./proseKeys";
import { APPLE_FONTS, DEFAULT_SIZE, SIZES, fontCss, recentFonts, rememberFont, useFonts } from "./fonts";

/** what starts a line: a heading's #s, a quote's >, a list's marker (lettered too) */
const LEAD = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|[a-zA-Z][.)]\s+)?/;

/** symbols a keyboard hasn't got, a click away (as Word's Insert → Symbol) */
const SYMBOLS = ["×", "÷", "±", "−", "·", "√", "∛", "π", "°", "≤", "≥", "≠", "≈", "∞", "²", "³", "½", "¼", "¾", "θ", "Δ", "Ω", "μ", "Σ", "∠", "⊥", "∥", "→", "←", "⇒", "%", "‰"];

const STYLES = [
  { id: "text", label: "Normal text", lead: "" },
  { id: "h1", label: "Heading 1", lead: "# " },
  { id: "h2", label: "Heading 2", lead: "## " },
  { id: "h3", label: "Heading 3", lead: "### " },
  { id: "h4", label: "Heading 4", lead: "#### " },
  { id: "quote", label: "Quote", lead: "> " },
  { id: "callout", label: "Callout", lead: "> [!note] " },
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
    // (a callout's [!note] goes with its >)
    const callout = m[2]?.startsWith(">") ? (line.text.slice(m[0].length).match(/^\[!\w+\][+-]?\s*/)?.[0].length ?? 0) : 0;
    const next = already ? "" : lead === "1. " ? `${k}. ` : lead === "a. " ? `${String.fromCharCode(96 + Math.min(26, k))}. ` : lead === "A. " ? `${String.fromCharCode(64 + Math.min(26, k))}. ` : lead;
    changes.push({ from: line.from + m[1].length, to: line.from + m[0].length + callout, insert: next });
  }
  v.dispatch({ changes });
  v.focus();
}

function insert(v: EditorView, text: string, caret = text.length) {
  const at = v.state.selection.main;
  v.dispatch({ changes: { from: at.from, to: at.to, insert: text }, selection: { anchor: at.from + caret } });
  v.focus();
}

/** the notebook's type: its writing's font and its headings' (none: the app's own), the writing's size in points */
export interface NotebookType {
  body: string;
  heading: string;
  size: number;
}

/** Font ▾: any font on this Mac — for the writing, or for the headings (the one the caret's in, to start with) */
function FontMenu({ type, heading, onType, onPreview, onClose }: { type: NotebookType; heading: boolean; onType: (t: Partial<NotebookType>) => void; onPreview: (t: Partial<NotebookType> | null) => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [forHeadings, setForHeadings] = useState(heading);
  const [find, setFind] = useState("");
  const all = useFonts(open);
  const current = forHeadings ? type.heading : type.body;
  const shown = (heading ? type.heading || type.body : type.body) || "San Francisco";
  const box = useRef<HTMLSpanElement>(null);
  const close = () => {
    setOpen(false);
    setFind("");
    onPreview(null);
    onClose();
  };
  // a press anywhere else puts it away
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  });
  const pick = (name: string) => {
    if (name) rememberFont(name);
    onType(forHeadings ? { heading: name } : { body: name });
    close();
  };
  const q = find.trim().toLowerCase();
  const match = (n: string) => !q || n.toLowerCase().includes(q);
  const recent = recentFonts().filter(match);
  const apple = APPLE_FONTS.map((f) => f.name).filter(match);
  const rest = all.filter(match);
  const item = (name: string, label = name) => (
    <button
      key={`${label}:${name}`}
      className={`nb-font-item${current === name ? " is-on" : ""}`}
      style={{ fontFamily: name ? fontCss(name) : undefined }}
      onMouseEnter={() => onPreview(forHeadings ? { heading: name } : { body: name })}
      onClick={() => pick(name)}
    >
      {label}
    </button>
  );
  return (
    <span className="nb-format-anchor" ref={box}>
      <button className="nb-format-font" title={heading ? "The headings' font — any on this Mac" : "The writing's font — any on this Mac"} style={{ fontFamily: fontCss(shown) }} onClick={() => (open ? close() : (setForHeadings(heading), setOpen(true)))}>
        <span className="nb-format-font-name">{shown}</span> <Icon name="chevron" size={12} />
      </button>
      {open && (
        <span className="nb-format-menu nb-font-menu" onMouseLeave={() => onPreview(null)}>
          <span className="nb-font-for">
            <button className={!forHeadings ? "is-on" : ""} onClick={() => setForHeadings(false)}>
              Text
            </button>
            <button className={forHeadings ? "is-on" : ""} onClick={() => setForHeadings(true)}>
              Headings
            </button>
          </span>
          <input
            className="nb-font-find"
            autoFocus
            value={find}
            placeholder="Find a font"
            spellCheck={false}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Enter") {
                const first = [...apple, ...rest][0];
                if (first) pick(first);
              }
            }}
          />
          <span className="nb-font-list">
            {forHeadings && !q && item("", "Same as the text")}
            {!q && !forHeadings && type.body && item("", "The app's own (San Francisco)")}
            {recent.length > 0 && !q && <span className="nb-font-title">Recent</span>}
            {!q && recent.map((n) => item(n))}
            {apple.length > 0 && <span className="nb-font-title">Apple</span>}
            {apple.map((n) => item(n))}
            {rest.length > 0 && <span className="nb-font-title">On this Mac</span>}
            {rest.map((n) => item(n))}
            {!apple.length && !rest.length && <span className="nb-font-none">No font called “{find}”</span>}
          </span>
        </span>
      )}
    </span>
  );
}

/** Size ▾: the writing's size, in points (the headings go with it) */
function SizeMenu({ size, onType, onPreview }: { size: number; onType: (t: Partial<NotebookType>) => void; onPreview: (t: Partial<NotebookType> | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="nb-format-anchor">
      <button className="nb-format-size" title="The writing's size (points)" onClick={() => setOpen(!open)}>
        {size} <Icon name="chevron" size={12} />
      </button>
      {open && (
        <span className="nb-format-menu nb-size-menu" onMouseLeave={() => (setOpen(false), onPreview(null))}>
          {SIZES.map((s) => (
            <button key={s} className={s === size ? "is-on" : ""} onMouseEnter={() => onPreview({ size: s })} onClick={() => (setOpen(false), onPreview(null), onType({ size: s }))}>
              {s}
            </button>
          ))}
        </span>
      )}
    </span>
  );
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
  type,
  onType,
  onPreviewType,
  onRefocus,
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
  /** a spreadsheet, where the caret is */
  onTable: () => void;
  /** an app (Calculate, Work, Graph, graph paper) or math, where the caret is, open to work in */
  onApp: (lang: "calc" | "work" | "graph" | "paper" | "math" | "draw" | "circuit" | "mermaid") => void;
  /** the paragraph's alignment (the one the caret's in) — none: nothing to align */
  align?: "left" | "center" | "right";
  onAlign?: (a: "left" | "center" | "right") => void;
  /** the notebook's type, and changing it (a font tried — pointed at in its menu — shows on the page till it's let go) */
  type: NotebookType;
  onType: (t: Partial<NotebookType>) => void;
  onPreviewType: (t: Partial<NotebookType> | null) => void;
  /** the caret back in the writing (after a menu that took it: the font's search) */
  onRefocus: () => void;
}) {
  const [symbols, setSymbols] = useState(false);
  const [styles, setStyles] = useState(false);
  /** narrow: the folded-away buttons' menu (and the symbols, from it) */
  const [more, setMore] = useState(false);
  const [foldSymbols, setFoldSymbols] = useState(false);
  const [foldColors, setFoldColors] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const line = view ? view.state.doc.lineAt(view.state.selection.main.head).text : "";
  const current = useMemo(() => [...STYLES].reverse().find((s) => s.lead && line.startsWith(s.lead) && (s.id !== "quote" || !/^>\s?\[!/.test(line)) && !line.startsWith(`${s.lead.trim()}#`)) ?? STYLES[0], [line]);
  const inHeading = current.id.startsWith("h");
  const off = !view;
  // (a press on the bar keeps the text's caret where it is)
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const lead = (l: string, toggle = false) => (view ? setLead(view, l, toggle) : onNew(l));
  const wrap = (key: string, shift = false) => view && (wrapKey(key, shift)(view), view.focus());
  const headStyle = (id: string): CSSProperties => (id.startsWith("h") ? { fontFamily: fontCss(type.heading || type.body || "San Francisco") } : id === "text" ? { fontFamily: fontCss(type.body || "San Francisco") } : {});
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
          <span className="nb-format-menu nb-style-menu" onMouseLeave={() => setStyles(false)}>
            {STYLES.map((s) => (
              <button key={s.id} className={`is-${s.id}${current.id === s.id ? " is-on" : ""}`} style={headStyle(s.id)} onClick={() => (setStyles(false), lead(s.lead))}>
                {s.label}
              </button>
            ))}
          </span>
        )}
      </span>
      <FontMenu type={type} heading={inHeading} onType={onType} onPreview={onPreviewType} onClose={onRefocus} />
      <SizeMenu size={type.size || DEFAULT_SIZE} onType={onType} onPreview={onPreviewType} />
      <span className="nb-format-sep" />
      <button disabled={off} title="Bold (⌘B)" onClick={() => wrap("b")}>
        <b>B</b>
      </button>
      <button disabled={off} title="Italic (⌘I)" onClick={() => wrap("i")}>
        <i>I</i>
      </button>
      <button disabled={off} title="Underline (⌘U)" onClick={() => wrap("u")}>
        <u>U</u>
      </button>
      <button className="nb-format-wide2" disabled={off} title="Strikethrough (⌘⇧X)" onClick={() => wrap("x", true)}>
        <s>S</s>
      </button>
      <ColorButton view={view} className="nb-format-wide2" />
      <button className="nb-format-wide2" disabled={off} title="Code (⌘E)" onClick={() => wrap("e")}>
        <Icon name="source" size={14} />
      </button>
      <button className="nb-format-wide2" disabled={off} title="Link (⌘K) — a web address, or another notebook's name" onClick={() => wrap("k")}>
        <Icon name="link" size={14} />
      </button>
      <span className="nb-format-sep" />
      <button title="Bulleted list (⌘⇧8)" onClick={() => lead("- ", true)}>
        <Icon name="list" size={15} />
      </button>
      <button title="Numbered list (⌘⇧7) — Enter goes on to the next number" onClick={() => lead("1. ", true)}>
        <span className="nb-format-num">1.</span>
      </button>
      <button className="nb-format-wide" title="Lettered list — a. b. c." onClick={() => lead("a. ", true)}>
        <span className="nb-format-num">a.</span>
      </button>
      <button className="nb-format-wide" title="Lettered list — A. B. C." onClick={() => lead("A. ", true)}>
        <span className="nb-format-num">A.</span>
      </button>
      <button title="Checklist (⌘⇧9)" onClick={() => lead("- [ ] ", true)}>
        <Icon name="check" size={15} />
      </button>
      <button className="nb-format-wide" disabled={off} title="Outdent (⇧Tab)" onClick={() => view && (tabKey(true)(view), view.focus())}>
        <Icon name="outdent" size={15} />
      </button>
      <button className="nb-format-wide" disabled={off} title="Indent — a list item in under the one above (Tab)" onClick={() => view && (tabKey(false)(view), view.focus())}>
        <Icon name="indent" size={15} />
      </button>
      <span className="nb-format-sep" />
      {(["left", "center", "right"] as const).map((a) => (
        <button key={a} disabled={!onAlign} className={`nb-format-wide${align === a ? " is-on" : ""}`} title={`Align ${a}`} onClick={() => onAlign?.(a)}>
          <Icon name={a === "left" ? "alignLeft" : a === "center" ? "alignCenter" : "alignRight"} size={15} />
        </button>
      ))}
      <span className="nb-format-sep" />
      <button className="nb-format-wide" title="A table — a spreadsheet, typed into right on the page" onClick={onTable}>
        <Icon name="table" size={15} />
      </button>
      <button className="nb-format-wide" title="A picture" onClick={() => file.current?.click()}>
        <Icon name="image" size={15} />
      </button>
      <button className="nb-format-wide3" title="Math — a problem written out, typed as it reads (math in a line: / then Math in the line)" onClick={() => onApp("math")}>
        <span className="nb-format-num">∑</span>
      </button>
      <span className="nb-format-anchor nb-format-wide3">
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
      {/* narrow: what's folded away, here */}
      <span className="nb-format-anchor nb-format-fold">
        <button className={more ? "is-on" : ""} title="More — lettered lists, indent, alignment, a table, a picture" onClick={() => setMore(!more)}>
          <Icon name="more" size={15} />
        </button>
        {more && (
          <span className="nb-format-menu nb-format-more" onMouseLeave={() => setMore(false)}>
            <button className="is-tier2" disabled={off} onClick={() => (setMore(false), wrap("x", true))}>
              <s>S</s> Strikethrough
            </button>
            <button className="is-tier2" disabled={off} onClick={() => (setMore(false), wrap("h", true))}>
              <span className="nb-format-mark">H</span> Highlight
            </button>
            <button className="is-tier2" disabled={off} onClick={() => (setMore(false), setFoldColors(true))}>
              <span className="nb-format-num nb-color-a" style={{ "--c": "var(--t-red, #e5484d)" } as CSSProperties}>
                A
              </span>{" "}
              Colors…
            </button>
            <button className="is-tier2" disabled={off} onClick={() => (setMore(false), wrap("e"))}>
              <Icon name="source" size={14} /> Code
            </button>
            <button className="is-tier2" disabled={off} onClick={() => (setMore(false), wrap("k"))}>
              <Icon name="link" size={14} /> Link
            </button>
            <button onClick={() => (setMore(false), lead("a. ", true))}>
              <span className="nb-format-num">a.</span> Lettered list
            </button>
            <button onClick={() => (setMore(false), lead("A. ", true))}>
              <span className="nb-format-num">A.</span> Lettered list
            </button>
            <button disabled={off} onClick={() => view && (setMore(false), tabKey(true)(view), view.focus())}>
              <Icon name="outdent" size={15} /> Outdent
            </button>
            <button disabled={off} onClick={() => view && (setMore(false), tabKey(false)(view), view.focus())}>
              <Icon name="indent" size={15} /> Indent
            </button>
            <button disabled={!onAlign} className={align === "left" ? "is-on" : ""} onClick={() => (setMore(false), onAlign?.("left"))}>
              <Icon name="alignLeft" size={15} /> Left
            </button>
            <button disabled={!onAlign} className={align === "center" ? "is-on" : ""} onClick={() => (setMore(false), onAlign?.("center"))}>
              <Icon name="alignCenter" size={15} /> Center
            </button>
            <button disabled={!onAlign} className={align === "right" ? "is-on" : ""} onClick={() => (setMore(false), onAlign?.("right"))}>
              <Icon name="alignRight" size={15} /> Right
            </button>
            <button onClick={() => (setMore(false), onTable())}>
              <Icon name="table" size={15} /> Table
            </button>
            <button onClick={() => (setMore(false), file.current?.click())}>
              <Icon name="image" size={15} /> Picture
            </button>
            <button className="is-tier2" onClick={() => (setMore(false), onApp("draw"))}>
              <Icon name="draw" size={15} /> Drawing
            </button>
            <button className="is-tier2" onClick={() => (setMore(false), onApp("circuit"))}>
              <Icon name="circuit" size={15} /> Circuit
            </button>
            <button onClick={() => (setMore(false), onApp("mermaid"))}>
              <Icon name="flowchart" size={15} /> Flowchart
            </button>
            <button className="is-tier3" onClick={() => (setMore(false), onApp("math"))}>
              <span className="nb-format-num">∑</span> Math
            </button>
            <button className="is-tier3" disabled={off} onClick={() => (setMore(false), setFoldSymbols(true))}>
              <span className="nb-format-num">Ω</span> Symbol
            </button>
          </span>
        )}
        {foldColors && view && (
          <span onMouseLeave={() => setFoldColors(false)}>
            <ColorPalette view={view} onPick={() => setFoldColors(false)} className="is-right" />
          </span>
        )}
        {foldSymbols && view && (
          <span className="nb-format-menu nb-format-symbols is-right" onMouseLeave={() => setFoldSymbols(false)}>
            {SYMBOLS.map((c) => (
              <button key={c} onClick={() => (insert(view, c), setFoldSymbols(false))}>
                {c}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="nb-format-sep" />
      <button className="nb-format-app" title="Calculate — work it out, right where the caret is" onClick={() => onApp("calc")}>
        <Icon name="calc" size={15} /> <span className="nb-format-label">Calculate</span>
      </button>
      <button className="nb-format-app" title="Work — a problem solved step by step, right where the caret is" onClick={() => onApp("work")}>
        <Icon name="work" size={15} /> <span className="nb-format-label">Work</span>
      </button>
      <button className="nb-format-app" title="Graph — right where the caret is" onClick={() => onApp("graph")}>
        <Icon name="graph" size={15} />
      </button>
      <button className="nb-format-app" title="Graph paper — beside the paragraph the caret's in: worked by hand, a digit a square, carries, lines, crossing out" onClick={() => onApp("paper")}>
        <Icon name="gridpaper" size={15} /> <span className="nb-format-label">Paper</span>
      </button>
      <button className="nb-format-app nb-format-wide2" title="Drawing — boxes and arrows, a pen, a mind map, right where the caret is" onClick={() => onApp("draw")}>
        <Icon name="draw" size={15} />
      </button>
      <button className="nb-format-app nb-format-wide2" title="Circuit — drawn, then run: current flows, every part worked out" onClick={() => onApp("circuit")}>
        <Icon name="circuit" size={15} />
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
