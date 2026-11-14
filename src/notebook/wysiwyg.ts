/** Writing as a word processor does it, over the Markdown underneath (the
 * hidden pieces livePreview keeps):
 *
 * - The caret, where a bold word starts or ends, is where Word would have it:
 *   typing takes the look of the letter before it (at a bold word's end, bold;
 *   at its start, plain). The arrows never stop on a place that looks the same
 *   as the one they left.
 * - ⌫ and ⌦ take the letter beside the caret, never the marks hidden there; a
 *   word made empty takes its marks with it. ⌫ at the start of a bullet's,
 *   a box's, a number's, a quote's or a heading's words takes that off.
 * - ⌘B ⌘I ⌘U ⌘⇧X ⌘⇧H ⌘E: what's picked made bold (or not — split out of a
 *   bold run, as Word does); with nothing picked, what's typed next is bold
 *   (or isn't). A space typed at a bold word's end stays out of its marks
 *   (Markdown's bold can't end in one) and the next letter joins it again.
 * - Enter never breaks a bold word's marks: at its end, the new line starts
 *   after them; in its middle, the bold is closed before the break and opened
 *   again after it. */
import { Annotation, EditorSelection, EditorState, type Extension, Prec, StateEffect, StateField, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { MARKS, type MarkType, type Piece, piecesNear } from "./livePreview";

type Kind = keyof typeof MARKS;
/** our own changes: the caret where we put it */
const ours = Annotation.define<boolean>();

// ---- what's typed next: bold, not bold… (till the caret moves)
interface Typing {
  add: Kind[];
  remove: Kind[];
}
const EMPTY: Typing = { add: [], remove: [] };
const setTyping = StateEffect.define<Typing>();
const typingField = StateField.define<Typing>({
  create: () => EMPTY,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setTyping)) return e.value;
    if ((tr.docChanged || tr.selection) && !tr.annotation(ours)) return EMPTY;
    return v;
  },
});
export const typingAt = (state: EditorState): Typing => state.field(typingField, false) ?? EMPTY;

/** one character before (or after) a place — a pair of surrogates (an emoji) kept whole */
const charBefore = (state: EditorState, pos: number) => (pos >= 2 && /[\uDC00-\uDFFF]/.test(state.sliceDoc(pos - 1, pos)) && /[\uD800-\uDBFF]/.test(state.sliceDoc(pos - 2, pos - 1)) ? 2 : 1);
const charAfter = (state: EditorState, pos: number) => (/[\uD800-\uDBFF]/.test(state.sliceDoc(pos, pos + 1)) ? 2 : 1);

/** the nodes (a bold run, a link…) the pieces near a place belong to — each once */
function nodesOf(pieces: Piece[]) {
  const seen = new Map<string, NonNullable<Piece["node"]>>();
  for (const p of pieces) if (p.node) seen.set(`${p.node.from}:${p.node.to}:${p.node.type}`, p.node);
  return [...seen.values()];
}
/** the node of a kind whose words hold from…to (the innermost) */
function nodeOver(pieces: Piece[], type: MarkType, from: number, to: number) {
  return nodesOf(pieces)
    .filter((n) => n.type === type && n.inner[0] <= from && to <= n.inner[1])
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
}
/** a deletion grown to take the marks of any word it empties: **x** with its x deleted goes whole */
function emptied(pieces: Piece[], a: number, b: number): [number, number] {
  for (const n of nodesOf(pieces)) if (n.inner[0] === a && n.inner[1] === b) return emptied(pieces, n.from, n.to);
  return [a, b];
}

// ---- the caret where Word would have it: past a run of hidden marks, back to its start (the letter before's look)
const settle = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.annotation(ours)) return tr;
  const sel = tr.selection;
  let changed = false;
  const ranges = sel.ranges.map((r) => {
    if (!r.empty) return r;
    let p = r.head;
    const pieces = piecesNear(tr.startState, p, 200);
    for (let guard = 0; guard < 8; guard++) {
      const m = pieces.find((x) => x.kind === "mark" && x.to === p && x.from < p && x.node?.type !== "link" && x.node?.type !== "wiki");
      if (!m) break;
      p = m.from;
    }
    if (p === r.head) return r;
    changed = true;
    return EditorSelection.cursor(p, 1);
  });
  return changed ? [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }] : tr;
});

// ---- a line break never lands inside marks (Markdown's bold can't cross a line's end): at a bold word's end, after
// them; at its start, before them; inside its words, closed before the break and opened again after it
function breakPlan(state: EditorState, pos: number) {
  const nodes = nodesOf(piecesNear(state, pos, 200)).filter((n) => n.type !== "esc");
  let at = pos;
  for (let guard = 0; guard < 8; guard++) {
    // (a link to a notebook that shows its name: never split — out to its nearer end)
    const whole = (n: (typeof nodes)[number]) => n.type === "wiki" && n.inner[0] === n.from + 2;
    const n = nodes.find((x) => x.from < at && at < x.to && (at >= x.inner[1] || at <= x.inner[0] || whole(x)));
    if (!n) break;
    at = at >= n.inner[1] ? n.to : at <= n.inner[0] ? n.from : at - n.inner[0] < n.inner[1] - at ? n.from : n.to;
  }
  const inside = nodes.filter((n) => n.inner[0] < at && at < n.inner[1]).sort((a, b) => a.to - a.from - (b.to - b.from));
  if (at === pos && !inside.length) return null;
  return {
    at,
    close: inside.map((n) => state.sliceDoc(n.inner[1], n.to)).join(""),
    open: [...inside].reverse().map((n) => state.sliceDoc(n.from, n.inner[0])).join(""),
  };
}
const breakOut = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) !== "input" || tr.annotation(ours)) return tr;
  const start = tr.startState.selection;
  if (start.ranges.length > 1 || !start.main.empty) return tr;
  const pos = start.main.head;
  const all: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((from, to, _a, _b, ins) => all.push({ from, to, insert: ins.toString() }));
  const k = all.findIndex((c) => c.from === pos && c.to === pos && c.insert.startsWith("\n"));
  if (k < 0) return tr;
  const plan = breakPlan(tr.startState, pos);
  if (!plan) return tr;
  // (nothing else changed between where it was and where it goes)
  const lo = Math.min(pos, plan.at);
  const hi = Math.max(pos, plan.at);
  if (all.some((c, i) => i !== k && c.to > lo && c.from < hi)) return tr;
  all[k] = { from: plan.at, to: plan.at, insert: plan.close + all[k].insert + plan.open };
  all.sort((a, b) => a.from - b.from);
  const changes = tr.startState.changes(all);
  return { changes, selection: { anchor: changes.mapPos(plan.at, 1) }, effects: tr.effects, scrollIntoView: tr.scrollIntoView, userEvent: "input" };
});

/** ← →: on to the next place that looks different (never a press that seems to do nothing) — two places look the same
 * when all that's between them is hidden (a bold word's marks) */
function step(forward: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection;
    if (sel.ranges.some((r) => !r.empty)) return false;
    const ranges = sel.ranges.map((r) => {
      const marks = piecesNear(view.state, r.head, 200).filter((p) => p.kind === "mark");
      const unseen = (a: number, b: number) => {
        for (let x = a; x < b; ) {
          const p = marks.find((m) => m.from <= x && m.to > x);
          if (!p) return false;
          x = p.to;
        }
        return true;
      };
      let at = r;
      for (let k = 0; k < 8; k++) {
        const next = view.moveByChar(at, forward);
        if (next.head === at.head) break;
        at = next;
        if (!unseen(Math.min(r.head, at.head), Math.max(r.head, at.head))) break;
      }
      return at;
    });
    view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex), scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

/** ⌫: the letter before the caret (past any marks hidden there) — or a line's bullet, box, number, quote, heading */
export function smartBackspace(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const pos = sel.head;
  const line = state.doc.lineAt(pos);
  // a heading's, a list item's or a quote's words' start: that taken off (the words stay) — as ⌫ in Word
  const lead = line.text.match(/^(#{1,6}\s+|\s*>\s?|\s*(?:[-*+]|\d{1,9}[.)]|[a-zA-Z][.)])\s+(?:\[[ xX]\]\s+)?)/)?.[0];
  if (lead && pos === line.from + lead.length && lead.trim()) {
    const indent = lead.match(/^\s*/)![0].length;
    // (an item further in steps out first)
    const keep = /^\s*(?:[-*+]|\d|[a-zA-Z][.)])/.test(lead) && indent ? Math.max(0, indent - 2) : 0;
    view.dispatch({ changes: { from: line.from + keep, to: pos, insert: "" }, selection: { anchor: line.from + keep }, annotations: ours.of(true), userEvent: "delete.backward" });
    return true;
  }
  const pieces = piecesNear(state, pos);
  let p = pos;
  let crossed = false;
  for (let guard = 0; guard < 8; guard++) {
    const m = pieces.find((x) => x.kind === "mark" && x.to === p && x.from < p);
    if (!m) break;
    p = m.from;
    crossed = true;
  }
  if (!crossed) {
    // (a word's last letter: its marks go with it)
    if (pos > line.from) {
      const a = pos - charBefore(state, pos);
      const [from, to] = emptied(pieces, a, pos);
      if (from !== a || to !== pos) {
        view.dispatch({ changes: { from, to }, selection: { anchor: from }, annotations: ours.of(true), userEvent: "delete.backward" });
        return true;
      }
    }
    return false;
  }
  if (p <= line.from) {
    if (p === 0) return true;
    view.dispatch({ changes: { from: p - 1, to: p }, selection: { anchor: p - 1 }, annotations: ours.of(true), userEvent: "delete.backward" });
    return true;
  }
  // the thing before it whole (math, a picture), else a letter
  const whole = pieces.find((x) => x.kind !== "mark" && x.to === p && x.from < p);
  const a = whole ? whole.from : p - charBefore(state, p);
  const [from, to] = emptied(pieces, a, p);
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, annotations: ours.of(true), userEvent: "delete.backward" });
  return true;
}

/** ⌦: the letter after the caret (past any marks hidden there) */
export function smartDelete(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return false;
  const pos = sel.head;
  const line = state.doc.lineAt(pos);
  const pieces = piecesNear(state, pos);
  let p = pos;
  let crossed = false;
  for (let guard = 0; guard < 8; guard++) {
    const m = pieces.find((x) => x.kind === "mark" && x.from === p && x.to > p);
    if (!m) break;
    p = m.to;
    crossed = true;
  }
  if (!crossed) {
    if (pos < line.to) {
      const b = pos + charAfter(state, pos);
      const [from, to] = emptied(pieces, pos, b);
      if (from !== pos || to !== b) {
        view.dispatch({ changes: { from, to }, selection: { anchor: from }, annotations: ours.of(true), userEvent: "delete.forward" });
        return true;
      }
    }
    return false;
  }
  if (p >= line.to) {
    if (p >= state.doc.length) return true;
    view.dispatch({ changes: { from: p, to: p + 1 }, selection: { anchor: pos }, annotations: ours.of(true), userEvent: "delete.forward" });
    return true;
  }
  const whole = pieces.find((x) => x.kind !== "mark" && x.from === p && x.to > p);
  const b = whole ? whole.to : p + charAfter(state, p);
  const [from, to] = emptied(pieces, p, b);
  view.dispatch({ changes: { from, to }, selection: { anchor: Math.min(pos, from) }, annotations: ours.of(true), userEvent: "delete.forward" });
  return true;
}

/** ⌘B and the rest: what's picked made bold, or not — nothing picked: what's typed next */
export function toggleMark(kind: Kind) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const { open, close } = MARKS[kind];
    const sel = state.selection.main;
    const pieces = piecesNear(state, sel.from, Math.max(400, sel.to - sel.from + 200));
    if (sel.empty) {
      const t = typingAt(state);
      const inside = nodeOver(pieces, kind, sel.head, sel.head);
      const next: Typing = inside
        ? { add: t.add.filter((k) => k !== kind), remove: t.remove.includes(kind) ? t.remove.filter((k) => k !== kind) : [...t.remove, kind] }
        : { remove: t.remove.filter((k) => k !== kind), add: t.add.includes(kind) ? t.add.filter((k) => k !== kind) : [...t.add, kind] };
      view.dispatch({ effects: setTyping.of(next), annotations: ours.of(true) });
      return true;
    }
    // (marks can't start or end on a space: the spaces at the ends stay out)
    const picked = state.sliceDoc(sel.from, sel.to);
    const a = sel.from + (picked.length - picked.trimStart().length);
    const b = sel.to - (picked.length - picked.trimEnd().length);
    if (b <= a) return true;
    const over = nodeOver(pieces, kind, a, b);
    let spec: TransactionSpec;
    if (over) {
      // out of the run: its marks moved to either side of what's picked (or off, at its ends)
      const changes = [];
      if (a === over.inner[0]) changes.push({ from: over.from, to: over.inner[0], insert: "" });
      else changes.push({ from: a, insert: close });
      if (b === over.inner[1]) changes.push({ from: over.inner[1], to: over.to, insert: "" });
      else changes.push({ from: b, insert: open });
      const set = state.changes(changes);
      spec = { changes: set, selection: EditorSelection.range(set.mapPos(a, 1), set.mapPos(b, -1)) };
    } else {
      // made so — the same marks inside it taken out first, so it's one run
      const inner = pieces.filter((x) => x.kind === "mark" && x.node?.type === kind && x.from >= a && x.to <= b);
      const set = state.changes([{ from: a, insert: open }, ...inner.map((x) => ({ from: x.from, to: x.to, insert: "" })), { from: b, insert: close }]);
      spec = { changes: set, selection: EditorSelection.range(set.mapPos(a, 1), set.mapPos(b, -1)) };
    }
    view.dispatch({ ...spec, annotations: ours.of(true), userEvent: "input.format", scrollIntoView: true });
    return true;
  };
}

/** what's typed: in the looks asked for (⌘B with nothing picked), a space at a bold word's end kept out of its marks */
const typed = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (from !== to || state.selection.ranges.length > 1 || text.includes("\n")) return false;
  const t = typingAt(state);
  const pieces = piecesNear(state, from);
  if (!t.add.length && !t.remove.length) {
    // a space at a word's end inside marks (bold, italic…): after them — the next letter joins the run again
    if (!/^\s+$/.test(text)) return false;
    const end = nodesOf(pieces).find((n) => n.inner[1] === from && (n.type === "b" || n.type === "i" || n.type === "s" || n.type === "h" || n.type === "u"));
    if (!end) return false;
    view.dispatch({ changes: { from: end.to, insert: text }, selection: { anchor: end.to + text.length }, effects: setTyping.of({ add: [end.type as Kind], remove: [] }), annotations: ours.of(true), userEvent: "input.type" });
    return true;
  }
  let at = from;
  /** around what's typed: marks closed before it and opened after (a run split, to type out of it) */
  let pre = "";
  let post = "";
  const changes: { from: number; to?: number; insert: string }[] = [];
  // not bold: out past the run's end (or its start), or the run split here
  for (const k of t.remove) {
    const n = nodeOver(pieces, k, at, at);
    if (!n) continue;
    if (at === n.inner[1]) at = n.to;
    else if (at === n.inner[0]) at = n.from;
    else {
      pre += MARKS[k].close;
      post = MARKS[k].open + post;
    }
  }
  // spaces while bold's asked for: as they are (a run can't end on one) — still bold for the next letter
  if (/^\s+$/.test(text) && t.add.length) {
    view.dispatch({ changes: { from: at, insert: pre + text + post }, selection: { anchor: at + pre.length + text.length }, effects: setTyping.of({ add: t.add, remove: [] }), annotations: ours.of(true), userEvent: "input.type" });
    return true;
  }
  let open = "";
  let close = "";
  for (const k of t.add) {
    // right after a run of it (spaces between, at most): the run's end moved past what's typed — one run, not two
    const back = state.sliceDoc(Math.max(0, at - 40), at);
    const spaces = back.length - back.trimEnd().length;
    const run = nodesOf(pieces).find((n) => n.type === k && n.to === at - spaces);
    if (run) changes.push({ from: run.inner[1], to: run.to, insert: "" });
    else open += MARKS[k].open;
    close = MARKS[k].close + close;
  }
  changes.push({ from: at, insert: pre + open + text + close + post });
  const set = state.changes(changes);
  // (the caret after what's typed, inside its marks — typing goes on in them)
  const caret = set.mapPos(at, -1) + pre.length + open.length + text.length;
  view.dispatch({ changes: set, selection: { anchor: caret }, effects: setTyping.of(EMPTY), annotations: ours.of(true), userEvent: "input.type" });
  return true;
});

/** ⌘K: what's picked a link (nothing picked: "link", picked to type over) — its address asked for beside it */
export const linkMade = { just: false };
export function linkKey(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const pieces = piecesNear(state, sel.from);
  // (in a link already: its address asked for again)
  if (nodeOver(pieces, "link", sel.from, sel.to) || nodeOver(pieces, "wiki", sel.from, sel.to)) {
    linkMade.just = true;
    view.dispatch({ selection: { anchor: sel.from, head: sel.to } });
    return true;
  }
  const words = state.sliceDoc(sel.from, sel.to) || "link";
  linkMade.just = true;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: `[${words}]()` }, selection: { anchor: sel.from + 1, head: sel.from + 1 + words.length }, annotations: ours.of(true), userEvent: "input.format" });
  return true;
}

/** the word-processor layer: the keys first, before Markdown's own */
export function wysiwyg(): Extension {
  return [
    typingField,
    settle,
    breakOut,
    Prec.highest(typed),
    Prec.highest(
      keymap.of([
        { key: "ArrowLeft", run: step(false) },
        { key: "ArrowRight", run: step(true) },
        { key: "Backspace", run: smartBackspace },
        { key: "Delete", run: smartDelete },
      ]),
    ),
  ];
}
