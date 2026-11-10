/** Smart symbols as you write, as Word's AutoCorrect and Typora's do: -> is
 * →, <= ≤, >= ≥, != ≠, +- ±, ~= ≈, => ⇒, ... …, and -- in a sentence an em
 * dash. Never in code, in math, in a link's address or in HTML; never a
 * line's --- (a divider) or a table's |---|. ⌘Z right after gives back what
 * was typed. Turned off in the notebook's ⋯ menu. */
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { smartSymbolsOn } from "./editorSettings";

interface Rule {
  typed: string;
  sign: string;
  /** whether it's meant here (what's before what's typed on its line) */
  ok?: (before: string) => boolean;
}

const RULES: Rule[] = [
  { typed: "->", sign: "→" },
  { typed: "=>", sign: "⇒", ok: (b) => !/<$/.test(b.slice(0, -1)) },
  { typed: "<=", sign: "≤" },
  // (not a quote's > at a line's start)
  { typed: ">=", sign: "≥", ok: (b) => !/^\s*>$/.test(b) },
  { typed: "!=", sign: "≠" },
  { typed: "+-", sign: "±" },
  { typed: "~=", sign: "≈" },
  { typed: "...", sign: "…" },
  // an em dash in a sentence: not a line's start (--- is a divider), not a table's row, not a comment's <!--
  { typed: "--", sign: "—", ok: (b) => /[^\s-]/.test(b) && !/\|/.test(b) && !/<!-?$/.test(b) && !/-$/.test(b.slice(0, -1)) },
];

/** whether it's writing (not code, math, a link's address, HTML) where the caret is */
function writing(state: EditorState, pos: number, before: string): boolean {
  if ((before.match(/`/g)?.length ?? 0) % 2 === 1) return false;
  if ((before.replace(/\\\$/g, "").match(/\$/g)?.length ?? 0) % 2 === 1) return false;
  if (before.lastIndexOf("<") > before.lastIndexOf(">")) return false;
  if (/\]\([^)]*$/.test(before)) return false;
  // a $$ … $$ block it's inside
  if ((state.sliceDoc(0, pos).match(/\$\$/g)?.length ?? 0) % 2 === 1) return false;
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent)
    if (/Code|HTML|URL|Comment/.test(n.name)) return false;
  return true;
}

export const smartTyping = EditorView.inputHandler.of((view, from, to, text) => {
  if (!smartSymbolsOn() || text.length !== 1 || from !== to) return false;
  const { state } = view;
  const line = state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const rule = RULES.find((r) => (before + text).endsWith(r.typed) && (r.ok?.(before) ?? true));
  if (!rule) return false;
  // (where the rule's own characters start: what's before them decides whether it's writing)
  const start = from + 1 - rule.typed.length;
  if (!writing(state, start, line.text.slice(0, start - line.from))) return false;
  // what was typed, as typed — then its sign (⌘Z gives back what was typed)
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, userEvent: "input.type" });
  view.dispatch({ changes: { from: start, to: from + 1, insert: rule.sign }, selection: { anchor: start + rule.sign.length }, annotations: isolateHistory.of("before"), userEvent: "input.type" });
  return true;
});
