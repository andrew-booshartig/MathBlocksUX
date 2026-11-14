/** Headings fold, as Notion's toggle headings and Obsidian's do: a heading's
 * section — the writing under it and the apps, down to the next heading as
 * big or bigger — tucked away under it (▸), and back (▾). The notebook keeps
 * which are folded (on this computer) and hides the blocks under them; here,
 * in a run of writing, the lines go: under a folded heading, and (`hideTop`)
 * at the top of writing that a folded section above runs on into. */
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface FoldInfo {
  /** the folded headings' lines (1-based) */
  folded: number[];
  /** a folded section from above runs on into this writing: its level (hidden down to the first heading as big) */
  hideTop: number | null;
  onFold: (line: number) => void;
}
export const setFoldInfo = StateEffect.define<FoldInfo>();

const HEADING = /^(#{1,6})\s+\S/;

/** the chevron beside a heading: fold it, or open it again */
class ToggleWidget extends WidgetType {
  constructor(
    readonly line: number,
    readonly folded: boolean,
    readonly onFold: (line: number) => void,
  ) {
    super();
  }
  eq(o: ToggleWidget) {
    return o.line === this.line && o.folded === this.folded && o.onFold === this.onFold;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-fold-toggle${this.folded ? " is-folded" : ""}`;
    el.title = this.folded ? "Show what's under it" : "Fold what's under it away";
    el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    el.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onFold(this.line);
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
/** what's folded away, shown as a quiet … after the heading (clicked: open again) */
class FoldedWidget extends WidgetType {
  constructor(
    readonly line: number,
    readonly onFold: (line: number) => void,
  ) {
    super();
  }
  eq(o: FoldedWidget) {
    return o.line === this.line && o.onFold === this.onFold;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-folded";
    el.textContent = "…";
    el.title = "Folded — click to show it";
    el.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onFold(this.line);
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** the headings' lines in some writing (not in a code block typed in it) */
function headingsIn(state: EditorState) {
  const out: { n: number; level: number }[] = [];
  let fence = false;
  for (let n = 1; n <= state.doc.lines; n++) {
    const t = state.doc.line(n).text;
    if (/^(`{3,}|~{3,})/.test(t)) fence = !fence;
    if (fence) continue;
    const m = t.match(HEADING);
    if (m) out.push({ n, level: m[1].length });
  }
  return out;
}

interface Held {
  /** the folded headings, by where their lines start (kept through typing) */
  at: number[];
  hideTop: number | null;
  onFold: (line: number) => void;
}

function decorate(state: EditorState, held: Held | null): DecorationSet {
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const heads = headingsIn(state);
  const folded = new Set((held?.at ?? []).map((p) => doc.lineAt(Math.min(p, doc.length)).number));
  const onFold = held?.onFold ?? (() => {});
  // a folded section from above runs on into here: its lines hidden down to the first heading as big
  if (held?.hideTop) {
    const first = heads.find((h) => h.level <= held.hideTop!);
    if (first && first.n > 1) out.push(Decoration.replace({ block: true }).range(0, doc.line(first.n - 1).to));
  }
  for (const h of heads) {
    const line = doc.line(h.n);
    const isFolded = folded.has(h.n);
    out.push(Decoration.widget({ widget: new ToggleWidget(h.n, isFolded, onFold), side: -1 }).range(line.from));
    if (!isFolded) continue;
    const next = heads.find((x) => x.n > h.n && x.level <= h.level);
    const last = next ? doc.line(next.n - 1) : doc.line(doc.lines);
    if (last.number > h.n) out.push(Decoration.replace({ widget: new FoldedWidget(h.n, onFold) }).range(line.to, last.to));
  }
  return Decoration.set(out, true);
}

export const foldField = StateField.define<{ held: Held | null; decos: DecorationSet }>({
  create: (state) => ({ held: null, decos: decorate(state, null) }),
  update(v, tr) {
    let held = v.held;
    for (const e of tr.effects)
      if (e.is(setFoldInfo)) {
        const doc = tr.state.doc;
        held = { at: e.value.folded.filter((n) => n >= 1 && n <= doc.lines).map((n) => doc.line(n).from), hideTop: e.value.hideTop, onFold: e.value.onFold };
      }
    if (held && tr.docChanged && held === v.held) held = { ...held, at: held.at.map((p) => tr.changes.mapPos(p, -1)) };
    if (held !== v.held || tr.docChanged) return { held, decos: decorate(tr.state, held) };
    return v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});
