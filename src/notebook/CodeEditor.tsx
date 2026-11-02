/** A code cell's editor (CodeMirror): colored the way its language's plugin
 * says, ⌘⏎ / ⇧⏎ / ⌥⏎ to run, Tab to finish a name — and, with vim keys on,
 * Vim, set up the way the user's Neovim is (init.lua): Space is the leader
 * (<leader>r runs the cell), line numbers relative in normal mode and plain
 * while inserting, a yank goes to the system clipboard too, 4-space tabs,
 * ⌘/ comments a line, ⌥↑ ⌥↓ move it. Esc in normal mode (or :w, :q) is
 * done editing. */
import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderText } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, type StreamParser, bracketMatching, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Vim, getCM, vim } from "@replit/codemirror-vim";
import type { HighlightSpec } from "./languages";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { livePreview } from "./livePreview";

/** Python, as a spec like any plugin language's (decorators and """ too) */
export const PYTHON_SPEC: HighlightSpec = {
  lineComment: ["#"],
  strings: ['"', "'"],
  keywords: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "),
  builtins: "abs all any bin bool bytes callable chr dict dir divmod enumerate eval filter float format frozenset getattr hasattr hash help hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type vars zip self np sp pd plt math calc display".split(" "),
  constants: ["True", "False", "None"],
};

type St = { block: [string, string] | null; long: string | null; after: string };

/** a language's colors, from what its plugin says */
function parserFor(spec: HighlightSpec, python: boolean): StreamParser<St> {
  const keywords = new Set(spec.keywords ?? []);
  const builtins = new Set(spec.builtins ?? []);
  const constants = new Set(spec.constants ?? []);
  const longQuotes = python ? ['"""', "'''"] : [];
  return {
    name: "matrixlab",
    startState: () => ({ block: null, long: null, after: "" }),
    copyState: (s) => ({ ...s }),
    token(stream, st) {
      // inside a comment or a """string""" that goes on past this line
      if (st.block || st.long) {
        const end = st.block ? st.block[1] : st.long!;
        while (!stream.eol()) {
          if (stream.match(end)) {
            const kind = st.block ? "comment" : "string";
            st.block = null;
            st.long = null;
            return kind;
          }
          stream.next();
        }
        return st.block ? "comment" : "string";
      }
      if (stream.eatSpace()) return null;
      for (const q of longQuotes)
        if (stream.match(q)) {
          st.long = q;
          return this.token!(stream, st);
        }
      for (const b of spec.blockComment ?? [])
        if (stream.match(b[0])) {
          st.block = b;
          return this.token!(stream, st);
        }
      for (const c of spec.lineComment ?? [])
        if (stream.match(c)) {
          stream.skipToEnd();
          return "comment";
        }
      if ((spec.preprocessor && stream.sol() && stream.peek() === "#") || (python && stream.peek() === "@" && stream.match(/^@[\w.]+/, false))) {
        if (spec.preprocessor) stream.skipToEnd();
        else stream.match(/^@[\w.]+/);
        st.after = "";
        return "meta";
      }
      const ch = stream.peek()!;
      if (spec.strings?.includes(ch) && !(spec.transpose && ch === "'" && /[\w)\]}.']/.test(st.after))) {
        stream.next();
        let escaped = false;
        while (!stream.eol()) {
          const c = stream.next();
          if (c === ch && !escaped) break;
          escaped = !escaped && c === "\\" && ch !== "'";
        }
        st.after = "";
        return "string";
      }
      if (!/\w/.test(st.after.slice(-1)) && stream.match(/^(?:0x[\da-f]+|\d[\d_]*\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)[a-z]*/i)) {
        st.after = "0";
        return "number";
      }
      const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
      if (word) {
        const w = word[0];
        st.after = w;
        return keywords.has(w) ? "keyword" : constants.has(w) ? "atom" : builtins.has(w) ? "builtin" : null;
      }
      stream.next();
      st.after = ch;
      return null;
    },
    languageData: { commentTokens: { line: spec.lineComment?.[0] ?? "#", ...(spec.blockComment?.[0] ? { block: { open: spec.blockComment[0][0], close: spec.blockComment[0][1] } } : {}) } },
  };
}

/** the same colors as the page's (hl-k, hl-s…), so a cell looks the same edited or not */
const colors = HighlightStyle.define([
  { tag: tags.keyword, class: "hl-k" },
  { tag: tags.string, class: "hl-s" },
  { tag: tags.comment, class: "hl-c" },
  { tag: [tags.number, tags.atom, tags.bool], class: "hl-n" },
  { tag: tags.standard(tags.variableName), class: "hl-b" },
  { tag: tags.meta, class: "hl-d" },
]);

// ---- vim, as the user's Neovim has it (once, for every editor)

/** each editor's own run / done, found from the vim command's editor */
const handlers = new WeakMap<EditorView, { run: () => void; done: () => void }>();
let vimReady = false;
function setUpVim() {
  if (vimReady) return;
  vimReady = true;
  const viewOf = (cm: unknown) => (cm as { cm6?: EditorView }).cm6;
  Vim.defineAction("matrixlabRun", (cm: unknown) => {
    const v = viewOf(cm);
    if (v) handlers.get(v)?.run();
  });
  // Space is the leader (init.lua: mapleader = " "), not vim's "move right" — so it waits for what's next
  Vim.unmap("<Space>", undefined as unknown as string);
  // <leader>r runs the cell (init.lua: <leader>r runs the current file)
  Vim.mapCommand("<Space>r", "action", "matrixlabRun", {}, { context: "normal" });
  // :w, :q, :wq — done editing (it's saved as you type)
  const done = (cm: unknown) => {
    const v = viewOf(cm);
    if (v) handlers.get(v)?.done();
  };
  Vim.defineEx("write", "w", done);
  Vim.defineEx("quit", "q", done);
  Vim.defineEx("wq", "wq", done);
  Vim.defineEx("xit", "x", done);
  // clipboard=unnamedplus: what's yanked (or cut) goes to the system clipboard too
  const registers = Vim.getRegisterController() as unknown as { pushText: (name: string | undefined, op: string, text: string, ...rest: unknown[]) => void };
  const push = registers.pushText.bind(registers);
  registers.pushText = (name, op, text, ...rest) => {
    push(name, op, text, ...rest);
    if (!name || name === '"' || name === "+" || name === "*") navigator.clipboard?.writeText(text).catch(() => {});
  };
}

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** its language's colors — Python's when python */
  spec?: HighlightSpec;
  python?: boolean;
  vimKeys?: boolean;
  placeholder?: string;
  /** ⌘⏎ (and <leader>r): run it; ⇧⏎ run and go on; ⌥⏎ run and add a cell under it */
  onRun?: () => void;
  onRunNext?: () => void;
  onRunInsert?: () => void;
  /** done editing: Esc (in vim, Esc in normal mode, :w, :q) or clicking away */
  onDone: () => void;
  /** Tab after a name: what could finish it */
  complete?: (before: string) => Promise<{ word: string; matches: string[] }>;
  /** text, not code: no line numbers, words wrap */
  prose?: boolean;
  /** Markdown shown as it reads (live preview) — a text block's editor */
  markdown?: boolean;
  /** keys of its own, before the editor's (⌘B and such) */
  keys?: KeyBinding[];
  /** a paste it takes itself (a picture): true when it did */
  onPaste?: (e: ClipboardEvent, view: EditorView) => boolean;
  /** where it was clicked, to put the caret there (else at the end) */
  at?: { x: number; y: number };
  /** the caret at its start (come to from the block above) */
  fromTop?: boolean;
  /** off its top or bottom edge (↑ on the first line, ↓ on the last; vim's k and j): on to the next block — true when there was one */
  onEdge?: (dir: "up" | "down") => boolean;
}

export default function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const numbers = useRef(new Compartment());
  const [choices, setChoices] = useState<{ word: string; items: string[]; at: number; x: number; y: number } | null>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  useEffect(() => {
    if (!host.current) return;
    if (props.vimKeys) setUpVim();
    const p = latest.current;
    // an editor being taken down (or remade) blurs as it goes — that isn't the user leaving
    let alive = true;
    const call = (f?: () => void) => () => {
      if (!f) return false;
      f();
      return true;
    };
    const finishWord = (v: EditorView, word: string, full: string) => {
      const at = v.state.selection.main.head;
      v.dispatch({ changes: { from: at - word.length, to: at, insert: full }, selection: { anchor: at - word.length + full.length } });
    };
    const keys: KeyBinding[] = [
      { key: "Mod-Enter", run: call(() => latest.current.onRun?.() ?? latest.current.onDone()) },
      { key: "Shift-Enter", run: () => (latest.current.onRunNext ? (latest.current.onRunNext(), true) : false) },
      { key: "Alt-Enter", run: () => (latest.current.onRunInsert ? (latest.current.onRunInsert(), true) : false) },
      {
        key: "Escape",
        run: (v) => {
          if (choicesRef.current) return setChoices(null), true;
          // vim: Esc leaves insert mode first; in normal mode it's done editing
          const cm = latest.current.vimKeys ? getCM(v) : null;
          if (cm && (cm.state as { vim?: { insertMode?: boolean; visualMode?: boolean } }).vim?.insertMode) return false;
          if (cm && (cm.state as { vim?: { visualMode?: boolean } }).vim?.visualMode) return false;
          latest.current.onDone();
          return true;
        },
      },
      {
        key: "Tab",
        run: (v) => {
          const c = choicesRef.current;
          if (c) {
            finishWord(v, c.word, c.items[c.at]);
            setChoices(null);
            return true;
          }
          const sel = v.state.selection.main;
          const before = v.state.doc.sliceString(0, sel.head);
          const ask = latest.current.complete;
          if (ask && sel.empty && /[A-Za-z_][\w.]*$/.test(before)) {
            ask(before)
              .then(({ word, matches }) => {
                if (!matches.length) return;
                if (matches.length === 1) return finishWord(v, word, matches[0]);
                let common = matches[0];
                for (const m of matches) while (!m.startsWith(common)) common = common.slice(0, -1);
                if (common.length > word.length) finishWord(v, word, common);
                const at = v.coordsAtPos(v.state.selection.main.head);
                const box = host.current!.getBoundingClientRect();
                setChoices({ word: common.length > word.length ? common : word, items: matches, at: 0, x: (at?.left ?? box.left) - box.left, y: (at?.bottom ?? box.top) - box.top });
              })
              .catch(() => {});
            return true;
          }
          return indentMore(v);
        },
      },
      { key: "Shift-Tab", run: indentLess },
      { key: "ArrowDown", run: () => (choicesRef.current ? (setChoices({ ...choicesRef.current, at: (choicesRef.current.at + 1) % choicesRef.current.items.length }), true) : false) },
      { key: "ArrowUp", run: () => (choicesRef.current ? (setChoices({ ...choicesRef.current, at: (choicesRef.current.at - 1 + choicesRef.current.items.length) % choicesRef.current.items.length }), true) : false) },
      { key: "Enter", run: (v) => (choicesRef.current ? (finishWord(v, choicesRef.current.word, choicesRef.current.items[choicesRef.current.at]), setChoices(null), true) : false) },
      // init.lua's Mac keys: ⌘/ comments, ⌥↑ ⌥↓ move the line
      { key: "Mod-/", run: toggleComment },
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
    ];
    const extensions: Extension[] = [
      ...(p.vimKeys ? [vim({ status: true })] : []),
      ...(p.keys ? [keymap.of(p.keys)] : []),
      ...(p.markdown ? [livePreview(), keymap.of(markdownKeymap)] : []),
      keymap.of(keys),
      history(),
      keymap.of([...historyKeymap, ...defaultKeymap]),
      drawSelection(),
      bracketMatching(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      numbers.current.of(p.prose ? [] : lineNumbers()),
      ...(p.prose ? [EditorView.lineWrapping] : [highlightActiveLine()]),
      ...(p.placeholder ? [placeholderText(p.placeholder)] : []),
      ...(p.spec || p.python ? [StreamLanguage.define(parserFor(p.spec ?? PYTHON_SPEC, !!p.python)), syntaxHighlighting(colors)] : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          latest.current.onChange(u.state.doc.toString());
          if (choicesRef.current) setChoices(null);
        }
      }),
      EditorView.domEventHandlers({
        paste: (e, v) => latest.current.onPaste?.(e, v) ?? false,
        blur: (e) => {
          // clicking the list of names isn't leaving
          if (!alive || (e.relatedTarget as HTMLElement | null)?.closest?.(".nb-complete")) return;
          setTimeout(() => alive && !view.current?.hasFocus && latest.current.onDone(), 0);
        },
      }),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: p.value, extensions }), parent: host.current });
    view.current = v;
    handlers.set(v, { run: () => (latest.current.onRun ?? latest.current.onDone)(), done: () => latest.current.onDone() });
    v.focus();
    // the caret where it was clicked (the text reads the same as it did, so that's the same place)
    const clicked = p.at && v.posAtCoords(p.at);
    v.dispatch({ selection: { anchor: clicked ?? (p.fromTop ? 0 : v.state.doc.length) } });
    // ↑ on the first line, ↓ on the last (vim: k and j in normal mode): on to the block beside it
    const edge = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || !latest.current.onEdge || choicesRef.current) return;
      const cm = latest.current.vimKeys ? getCM(v) : null;
      const vimState = (cm?.state as { vim?: { insertMode?: boolean; visualMode?: boolean } } | undefined)?.vim;
      const normal = !!cm && !vimState?.insertMode && !vimState?.visualMode;
      const down = e.key === "ArrowDown" || (normal && e.key === "j");
      const up = e.key === "ArrowUp" || (normal && e.key === "k");
      if (!down && !up) return;
      const head = v.state.selection.main.head;
      const line = v.state.doc.lineAt(head).number;
      // (a wrapped line: only off its last visual row)
      const box = v.coordsAtPos(head);
      const endBox = v.coordsAtPos(down ? v.state.doc.length : 0);
      const lastRow = !box || !endBox || Math.abs(box.top - endBox.top) < 4;
      if ((down && line === v.state.doc.lines && lastRow) || (up && line === 1 && lastRow)) {
        if (latest.current.onEdge(down ? "down" : "up")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    host.current.addEventListener("keydown", edge, true);
    // vim: numbers relative in normal mode, plain while inserting (init.lua's InsertEnter / InsertLeave)
    if (p.vimKeys && !p.prose) {
      const relative = lineNumbers({
        formatNumber: (n, state) => {
          const here = state.doc.lineAt(state.selection.main.head).number;
          return n === here ? String(n) : String(Math.abs(n - here));
        },
      });
      v.dispatch({ effects: numbers.current.reconfigure(relative) });
      getCM(v)?.on("vim-mode-change", (e: { mode: string }) => {
        v.dispatch({ effects: numbers.current.reconfigure(e.mode === "insert" ? lineNumbers() : relative) });
      });
    }
    return () => {
      alive = false;
      v.destroy();
      view.current = null;
    };
    // the editor's made once; what's typed is its own (value only seeds it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.vimKeys]);

  // a value changed from outside (a completion picked elsewhere, a reset): into the editor
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);

  return (
    <div className={`nb-cm${props.prose ? " is-prose" : ""}${props.markdown ? " is-live" : ""}`} ref={host}>
      {choices && (
        <div className="nb-complete is-cm" style={{ left: choices.x, top: choices.y + 4 }} onMouseDown={(e) => e.preventDefault()}>
          {choices.items.map((item, k) => (
            <button
              key={item}
              className={`nb-complete-item${k === choices.at ? " is-at" : ""}`}
              onClick={() => {
                if (view.current) {
                  const v = view.current;
                  const at = v.state.selection.main.head;
                  v.dispatch({ changes: { from: at - choices.word.length, to: at, insert: item }, selection: { anchor: at - choices.word.length + item.length } });
                  v.focus();
                }
                setChoices(null);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
