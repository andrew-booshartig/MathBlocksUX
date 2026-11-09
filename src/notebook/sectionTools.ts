/** A heading's tools, at its end when it's pointed at: bounce the section
 * in place (every app under it kept as its picture, as a DAW bounces a
 * track) and back — for a section that has apps in it. */
import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { refreshDecorations } from "./TextRun";

export interface SectionApi {
  /** what the section under a heading (its place in the writing) has: apps live, apps kept as pictures */
  has: (run: string, at: number) => { live: number; flat: number };
  bounce: (run: string, at: number) => void;
  unbounce: (run: string, at: number) => void;
}

class ToolsWidget extends WidgetType {
  constructor(
    readonly run: string,
    readonly at: number,
    readonly live: number,
    readonly flat: number,
    readonly api: { current: SectionApi },
  ) {
    super();
  }
  eq(o: ToolsWidget) {
    return o.run === this.run && o.at === this.at && o.live === this.live && o.flat === this.flat;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = "nb-section-tools";
    box.contentEditable = "false";
    const button = (label: string, title: string, run: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = (e) => (e.preventDefault(), e.stopPropagation(), run());
      box.append(b);
    };
    if (this.live) button("bounce", "Bounce this section in place — every app under this heading kept as a picture, so nothing in it is worked out or drawn again", () => this.api.current.bounce(this.run, this.at));
    if (this.flat) button("unbounce", "Every app under this heading live again", () => this.api.current.unbounce(this.run, this.at));
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

export function sectionTools(run: string, api: { current: SectionApi }) {
  const build = (view: EditorView): DecorationSet => {
    const out: Range<Decoration>[] = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        if (/^#{1,6}\s+\S/.test(line.text)) {
          const { live, flat } = api.current.has(run, line.from);
          if (live || flat) out.push(Decoration.widget({ widget: new ToolsWidget(run, line.from, live, flat, api), side: 1 }).range(line.to));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(out, true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshDecorations)))) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
