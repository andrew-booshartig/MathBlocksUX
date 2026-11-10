/** Keys for writing in a text block, as a word processor has them: Enter
 * carries a lettered list on (a. → b., A. → B.; numbers and bullets are the
 * Markdown keymap's), Enter on an empty item ends the list; Tab and ⇧Tab
 * move a list item in under the one above it and back out (anywhere else
 * Tab is a tab's worth of space — never 4 spaces that would make the line
 * code); ⌘⇧7 / ⌘⇧8 / ⌘⇧9 a numbered, bulleted or checklist line. */
import type { EditorView } from "@codemirror/view";
import { writingKey } from "./writing";

/** the text made `value` (selected start…end), changed only where it differs — the rest of it, and its undo, left be */
export function applyEdit(v: EditorView, value: string, start: number, end: number) {
  const now = v.state.doc.toString();
  let a = 0;
  while (a < now.length && a < value.length && now[a] === value[a]) a++;
  let b = 0;
  while (b < now.length - a && b < value.length - a && now[now.length - 1 - b] === value[value.length - 1 - b]) b++;
  v.dispatch({ changes: { from: a, to: now.length - b, insert: value.slice(a, value.length - b) }, selection: { anchor: start, head: end }, scrollIntoView: true });
}

/** ⌘B ⌘I ⌘U ⌘E ⌘K ⌘⇧X ⌘⇧H: what's selected wrapped (a selection from a line's start leaves its # or list marker outside) */
export function wrapKey(key: string, shift = false) {
  return (v: EditorView): boolean => {
    const sel = v.state.selection.main;
    const line = v.state.doc.lineAt(sel.from);
    const lead = line.text.match(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|[a-zA-Z][.)]\s+)?/)![0].length;
    const from = sel.from - line.from < lead && sel.to > line.from + lead ? line.from + lead : sel.from;
    const edit = writingKey({ key, metaKey: true, ctrlKey: false, shiftKey: shift, altKey: false }, v.state.doc.toString(), from, sel.to);
    if (!edit) return false;
    applyEdit(v, edit.value, edit.start, edit.end);
    return true;
  };
}

/** a list item's start: its indent, its marker, the space after (and a task's box) */
export const ITEM = /^(\s*)([-*+]|\d{1,9}[.)]|[a-zA-Z][.)])(\s+)(\[[ xX]\]\s+)?/;

const nextLetter = (ch: string) => (ch === "z" ? "a" : ch === "Z" ? "A" : String.fromCharCode(ch.charCodeAt(0) + 1));

/** Enter in a lettered list: the next letter (an empty item: the list ends) */
export function letterEnter(v: EditorView): boolean {
  const sel = v.state.selection.main;
  if (!sel.empty) return false;
  const line = v.state.doc.lineAt(sel.head);
  const m = line.text.match(/^(\s*)([a-zA-Z])([.)])(\s+)/);
  if (!m || sel.head < line.from + m[0].length) return false;
  if (!line.text.slice(m[0].length).trim()) {
    // an empty item: its marker goes, and the list with it
    v.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } });
    return true;
  }
  const carry = `\n${m[1]}${nextLetter(m[2])}${m[3]}${m[4]}`;
  v.dispatch({ changes: { from: sel.head, to: sel.head, insert: carry }, selection: { anchor: sel.head + carry.length }, scrollIntoView: true });
  return true;
}

/** Enter: an empty top-level item ends its list — a blank line after it, so what's written next is a
 * paragraph of its own (not the item's, read on into it); a lettered item goes on to the next letter */
export function enterKey(v: EditorView): boolean {
  const sel = v.state.selection.main;
  if (!sel.empty) return false;
  const line = v.state.doc.lineAt(sel.head);
  // an empty line of a quote or a callout (just its >): out of it, as an empty list item ends a list — a paragraph of
  // its own after it (the quote's empty line before it taken off too)
  if (/^\s*>\s*$/.test(line.text) && line.number > 1) {
    const prev = v.state.doc.line(line.number - 1);
    const from = /^\s*>\s*$/.test(prev.text) ? prev.from : line.from;
    v.dispatch({ changes: { from, to: line.to }, selection: { anchor: from }, scrollIntoView: true });
    // (a blank line between the quote and what's written after it, so it isn't the quote's)
    const at = v.state.selection.main.head;
    v.dispatch({ changes: { from: at, insert: "\n" }, selection: { anchor: at + 1 } });
    return true;
  }
  const item = line.text.match(ITEM);
  if (item && !line.text.slice(item[0].length).trim() && sel.head >= line.from + item[0].length) {
    // (a nested bullet or number: the Markdown keymap moves it out a level)
    if (item[1].length && !/^[a-zA-Z]/.test(item[2])) return false;
    v.dispatch({ changes: { from: line.from, to: line.to, insert: "\n" }, selection: { anchor: line.from + 1 }, scrollIntoView: true });
    return true;
  }
  return letterEnter(v);
}

/** how far in an item goes to sit under the one above (its text's start) */
function nestWidth(v: EditorView, lineNo: number, indent: number): number {
  for (let n = lineNo - 1; n >= 1; n--) {
    const t = v.state.doc.line(n).text;
    if (!t.trim()) break;
    const m = t.match(ITEM);
    if (m && m[1].length <= indent) return m[1].length + m[2].length + m[3].length - indent;
  }
  return 3;
}

/** Tab / ⇧Tab: list items in and out; elsewhere, a tab's worth of (non-breaking) space */
export function tabKey(out: boolean) {
  return (v: EditorView): boolean => {
    const { state } = v;
    const sel = state.selection.main;
    const first = state.doc.lineAt(sel.from);
    const last = state.doc.lineAt(sel.to);
    const item = first.text.match(ITEM);
    // an item moves in and out from its start (or with lines selected); in its text, Tab is a tab — as in Word
    if (item && (first.number !== last.number || sel.from <= first.from + item[0].length)) {
      const changes = [];
      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        const m = line.text.match(ITEM);
        if (!m) continue;
        if (out) {
          const cut = Math.min(m[1].length, nestWidth(v, n, Math.max(0, m[1].length - 1)) || 2);
          if (cut) changes.push({ from: line.from, to: line.from + cut, insert: "" });
        } else changes.push({ from: line.from, insert: " ".repeat(nestWidth(v, n, m[1].length)) });
      }
      if (changes.length) v.dispatch({ changes });
      return true;
    }
    if (out) {
      // ⇧Tab: the space before the caret back out
      const before = state.doc.sliceString(Math.max(first.from, sel.from - 4), sel.from);
      const n = before.length - before.replace(/ +$/, "").length;
      if (n) v.dispatch({ changes: { from: sel.from - n, to: sel.from, insert: "" } });
      return true;
    }
    const tab = "    ";
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert: tab }, selection: { anchor: sel.from + tab.length } });
    return true;
  };
}

/** ⌘⇧7 / ⌘⇧8 / ⌘⇧9: the line (or the lines selected) a numbered / bulleted / checklist item — again, plain */
export function listKey(kind: "num" | "bullet" | "task" | "lower") {
  return (v: EditorView): boolean => {
    const { state } = v;
    const sel = state.selection.main;
    const first = state.doc.lineAt(sel.from).number;
    const last = state.doc.lineAt(sel.to).number;
    const changes = [];
    const lead = (k: number) => (kind === "num" ? `${k}. ` : kind === "lower" ? `${String.fromCharCode(96 + Math.min(26, k))}. ` : kind === "task" ? "- [ ] " : "- ");
    const already = (t: string) => {
      const m = t.match(ITEM);
      if (!m) return false;
      return kind === "num" ? /^\d/.test(m[2]) : kind === "lower" ? /^[a-zA-Z]/.test(m[2]) : kind === "task" ? !!m[4] : /^[-*+]$/.test(m[2]) && !m[4];
    };
    const off = already(state.doc.line(first).text);
    for (let n = first, k = 1; n <= last; n++, k++) {
      const line = state.doc.line(n);
      const m = line.text.match(ITEM);
      const from = line.from + (m ? m[1].length : (line.text.match(/^\s*/)?.[0].length ?? 0));
      const to = m ? line.from + m[0].length : from;
      changes.push({ from, to, insert: off ? "" : lead(k) });
    }
    v.dispatch({ changes });
    return true;
  };
}
