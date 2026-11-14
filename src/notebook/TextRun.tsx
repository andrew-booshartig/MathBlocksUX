/** Writing on the page: one editor for the writing between two objects
 * (an app, math, a table) — paragraph after paragraph, as a page in Word
 * or a note in Obsidian is. It's always there to write in: a click puts
 * the caret where it lands, a drag selects across paragraphs, Enter and
 * ⌫ go from one to the next, ⌘Z goes back through it all. It reads as it
 * will print (live preview: the Markdown shows only where the caret is). */
import { useEffect, useRef } from "react";
import { Annotation, EditorState, type Extension, Prec, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, type KeyBinding, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, undoDepth } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { getCM, vim } from "@replit/codemirror-vim";
import { livePreview } from "./livePreview";
import { smartTyping } from "./smartType";
import { wysiwyg } from "./wysiwyg";
import { type FoldInfo, foldField, setFoldInfo } from "./folds";

/** a run of writing, from outside it: the caret put in it, a place shown, where a place is */
export interface RunHandle {
  view: EditorView;
  /** the caret into it: where it was clicked, a place in the text, its start or its end */
  focus: (at?: { x: number; y: number } | number | "start" | "end") => void;
  /** a place picked out (a find): selected and scrolled to, the caret not taken */
  show: (from: number, to: number) => void;
  /** a place's top on the screen (null: not there) */
  top: (pos: number) => number | null;
  /** scrolled to a place (an outline's heading), at the top */
  scrollTo: (pos: number) => void;
}

/** a change that came from outside (the file, a replace, an undo of the notebook's): not typing */
const fromOutside = Annotation.define<boolean>();
/** what's drawn from outside the writing changed (a section's apps): its decorations made again */
export const refreshDecorations = StateEffect.define<null>();

export interface TextRunProps {
  id: string;
  value: string;
  onChange: (text: string) => void;
  vimKeys: boolean;
  /** its keys, before the editor's (⌘B, Enter in a list, /…) */
  keys: KeyBinding[];
  onFocus: (view: EditorView) => void;
  onBlur: (view: EditorView) => void;
  /** Esc (vim: in normal mode): out of the writing */
  onDone: () => void;
  /** off its top or bottom (↑ on the first line, ↓ on the last): on to the block beside it — true when there was one */
  onEdge: (dir: "up" | "down") => boolean;
  /** a paste it takes itself (a picture) */
  onPaste: (e: ClipboardEvent, view: EditorView) => boolean;
  /** files dropped on it (pictures): true when it took them */
  onDropFiles?: (e: DragEvent, view: EditorView) => boolean;
  /** ⌘Z with nothing of its own to undo: the notebook's (an app added, a block moved) */
  onUndoPast: () => void;
  /** a link ⌘-clicked: [[a note]], or the web */
  onLink: (to: { note?: string; href?: string }) => void;
  /** the caret moved, or it was typed in: what's at the caret (the bar's style, a / menu, the + beside an empty line) */
  onCursor?: (view: EditorView) => void;
  onHandle: (id: string, handle: RunHandle | null) => void;
  extensions?: Extension[];
  /** changes when something its decorations show from outside has (a section's apps) */
  refreshKey?: string;
  /** its headings folded (and a folded section from above running on into it) */
  fold?: FoldInfo;
}

export default function TextRun(props: TextRunProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** changes made in the writing itself (typed, a key's), counted */
  const ownEdits = useRef(0);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!host.current) return;
    const p = latest.current;
    const keys: KeyBinding[] = [
      {
        key: "Escape",
        run: (v) => {
          // vim: Esc leaves insert (or visual) mode first; in normal mode it's out of the writing
          const cm = latest.current.vimKeys ? getCM(v) : null;
          const st = (cm?.state as { vim?: { insertMode?: boolean; visualMode?: boolean } } | undefined)?.vim;
          if (cm && (st?.insertMode || st?.visualMode)) return false;
          latest.current.onDone();
          return true;
        },
      },
      // ⌘Z past the writing's own changes: the notebook's (an app put in, a block moved)
      { key: "Mod-z", run: (v) => (undoDepth(v.state) > 0 ? undo(v) : (latest.current.onUndoPast(), true)), preventDefault: true },
    ];
    const extensions: Extension[] = [
      ...(p.vimKeys ? [vim({ status: false })] : []),
      // (its own keys before the Markdown keymap's — with vim keys, after vim's)
      p.vimKeys ? keymap.of(p.keys) : Prec.highest(keymap.of(p.keys)),
      Prec.high(keymap.of(keys)),
      livePreview(),
      foldField,
      wysiwyg(),
      smartTyping,
      keymap.of(markdownKeymap),
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      drawSelection(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences", "aria-label": "Writing" }),
      ...(p.extensions ?? []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(fromOutside))) {
          ownEdits.current++;
          latest.current.onChange(u.state.doc.toString());
        }
        if (u.docChanged || u.selectionSet || u.focusChanged) latest.current.onCursor?.(u.view);
      }),
      EditorView.domEventHandlers({
        paste: (e, v) => latest.current.onPaste(e, v),
        drop: (e, v) => latest.current.onDropFiles?.(e, v) ?? false,
        focus: (_e, v) => latest.current.onFocus(v),
        blur: (_e, v) => latest.current.onBlur(v),
        mousedown: (e) => {
          // ⌘-click a link: it opens (a click alone puts the caret in it, to change it — as in Word)
          if (!(e.metaKey || e.ctrlKey)) return false;
          const a = (e.target as HTMLElement).closest?.<HTMLElement>("[data-note], [data-href]");
          if (!a) return false;
          e.preventDefault();
          latest.current.onLink(a.dataset.note ? { note: a.dataset.note } : { href: a.dataset.href });
          return true;
        },
      }),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: p.value, extensions }), parent: host.current });
    view.current = v;
    // ↑ on the first line, ↓ on the last (vim: k and j in normal mode): on to the block above or below
    const edge = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const cm = latest.current.vimKeys ? getCM(v) : null;
      const st = (cm?.state as { vim?: { insertMode?: boolean; visualMode?: boolean } } | undefined)?.vim;
      const normal = !!cm && !st?.insertMode && !st?.visualMode;
      const down = e.key === "ArrowDown" || (normal && e.key === "j");
      const up = e.key === "ArrowUp" || (normal && e.key === "k");
      if (!down && !up) return;
      const head = v.state.selection.main.head;
      const line = v.state.doc.lineAt(head).number;
      // (a wrapped line: only off its last row)
      const box = v.coordsAtPos(head);
      const endBox = v.coordsAtPos(down ? v.state.doc.length : 0);
      const lastRow = !box || !endBox || Math.abs(box.top - endBox.top) < 4;
      if (((down && line === v.state.doc.lines) || (up && line === 1)) && lastRow && latest.current.onEdge(down ? "down" : "up")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    host.current.addEventListener("keydown", edge, true);
    const handle: RunHandle = {
      view: v,
      focus: (at) => {
        v.focus();
        let pos: number | null = null;
        if (typeof at === "number") pos = Math.max(0, Math.min(at, v.state.doc.length));
        else if (at === "start") pos = 0;
        else if (at === "end" || at === undefined) pos = v.state.doc.length;
        else {
          // where it was clicked: in from the margin (a click beside the writing is the nearest place in its line)
          const r = v.contentDOM.getBoundingClientRect();
          pos = v.posAtCoords({ x: Math.max(r.left + 2, Math.min(r.right - 2, at.x)), y: at.y }, false);
        }
        v.dispatch({ selection: { anchor: pos ?? v.state.doc.length }, scrollIntoView: true });
      },
      show: (from, to) => {
        const n = v.state.doc.length;
        v.dispatch({ selection: { anchor: Math.min(from, n), head: Math.min(to, n) }, effects: EditorView.scrollIntoView(Math.min(from, n), { y: "center" }) });
      },
      top: (pos) => {
        const n = Math.min(pos, v.state.doc.length);
        return v.lineBlockAt(n).top + v.documentTop;
      },
      scrollTo: (pos) => v.dispatch({ effects: EditorView.scrollIntoView(Math.min(pos, v.state.doc.length), { y: "start", yMargin: 24 }) }),
    };
    p.onHandle(p.id, handle);
    return () => {
      host.current?.removeEventListener("keydown", edge, true);
      latest.current.onHandle(latest.current.id, null);
      v.destroy();
      view.current = null;
    };
    // made once (vim keys on or off remakes it); what's typed is its own — value only seeds it, and outside changes come in below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vimKeys]);

  // the text changed from outside (the file saved elsewhere, a replace, a split): in, the caret kept where it can be —
  // unless it was typed in since this was drawn (React running this late): then the value is older than the writing, and
  // the drawing the typing brings has the newer one (taken in as it is, it would undo what was just typed)
  const editsDrawn = ownEdits.current;
  useEffect(() => {
    const v = view.current;
    if (!v || ownEdits.current !== editsDrawn) return;
    const now = v.state.doc.toString();
    const next = props.value;
    if (now === next) return;
    let a = 0;
    while (a < now.length && a < next.length && now[a] === next[a]) a++;
    let b = 0;
    while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b]) b++;
    v.dispatch({ changes: { from: a, to: now.length - b, insert: next.slice(a, next.length - b) }, annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)] });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: refreshDecorations.of(null) });
  }, [props.refreshKey]);

  // its headings folded: told to the editor when they change (a heading's chevron asks the notebook, which keeps them)
  const foldKey = JSON.stringify([props.fold?.folded ?? [], props.fold?.hideTop ?? null]);
  useEffect(() => {
    view.current?.dispatch({ effects: setFoldInfo.of({ folded: props.fold?.folded ?? [], hideTop: props.fold?.hideTop ?? null, onFold: (line) => latest.current.fold?.onFold(line) }) });
  }, [foldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="nb-cm is-prose is-live is-run" ref={host} />;
}
