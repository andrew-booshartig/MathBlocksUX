/** The Graph block: the graphing tool itself, inline — its rows, tools,
 * sliders, settings — while you work in it; done, a picture of the graph
 * with what's graphed above it (drawn once, not kept live).
 *
 * In the file it's the equations, one a line (so Neovim and Obsidian show
 * what's graphed), then everything else about it on one line:
 *
 *     ```graph
 *     y = x^2 - 4
 *     window: -10 10 -10 10
 *     --- graph {"sum": …, "plot": {…}}
 *     ```
 *
 * Change the equations in another editor and the graph is made from them
 * again (its styles and such go, the equations win). */
import { useEffect, useRef, useState } from "react";
import XYGraph from "../blocks/XYGraph";
import { Plotly } from "../PlotlyChart";
import type { XYPlot } from "../store";
import { Tex } from "../ui";
import { readGraphCell } from "./cells";

const TRAILER = "--- graph ";

/** a short fingerprint of the readable part, to tell when another editor changed it */
const sum = (text: string) => {
  let h = 0;
  for (let k = 0; k < text.length; k++) h = (h * 31 + text.charCodeAt(k)) | 0;
  return h.toString(36);
};

const readable = (plot: XYPlot) => {
  const out = (plot.lines ?? []).filter((l) => l.latex.trim() && !l.note && l.folder === undefined).map((l) => l.latex.trim());
  const w = plot.window;
  if (w) out.push(`window: ${[w.xmin, w.xmax, w.ymin, w.ymax].map((v) => Math.round(v * 1e4) / 1e4).join(" ")}`);
  return out.join("\n");
};

/** a graph block's text → the graph */
export function readGraphBlock(code: string): XYPlot {
  const at = code.split("\n").findIndex((l) => l.startsWith(TRAILER));
  const top = at < 0 ? code : code.split("\n").slice(0, at).join("\n");
  if (at >= 0) {
    try {
      const state = JSON.parse(code.split("\n")[at].slice(TRAILER.length)) as { sum: string; plot: XYPlot };
      if (state.sum === sum(top.trim())) return state.plot;
    } catch {
      /* made again from the equations, below */
    }
  }
  const { exprs, vars, window } = readGraphCell(top);
  // a = 1/2: its value
  const letters = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => {
      const [top, bottom] = v.split("/").map(Number);
      return [k, bottom ? top / bottom : top];
    }),
  );
  return { lines: exprs.map((latex, i) => ({ id: `g${i}-${sum(latex)}`, latex })), ...(window ? { window } : {}), ...(Object.keys(letters).length ? { letters } : {}) };
}

/** the graph → a graph block's text */
export function writeGraphBlock(plot: XYPlot): string {
  const top = readable(plot);
  return `${top}\n${TRAILER}${JSON.stringify({ sum: sum(top.trim()), plot })}`;
}

/** what a graph block graphs, for its record: the equations as math */
export const graphedOf = (code: string) => readGraphCell(code.split("\n").filter((l) => !l.startsWith(TRAILER)).join("\n")).exprs;

/** The graph block being worked in. Done (the button, Esc with the hand in
 * hand, or a click outside it): its picture is taken, for the record. */
export function GraphLive({
  code,
  vars,
  onChange,
  onDone,
}: {
  code: string;
  /** what its section can see: x = 5… */
  vars: Record<string, number>;
  onChange: (code: string) => void;
  /** done, with a picture of the graph (a PNG data URL), or none if it couldn't take one */
  onDone: (picture: string | null) => void;
}) {
  const [plot, setPlot] = useState<XYPlot>(() => readGraphBlock(code));
  const box = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const update = (patch: Partial<XYPlot>) =>
    setPlot((p) => {
      const next = { ...p, ...patch };
      onChange(writeGraphBlock(next));
      return next;
    });
  const done = async () => {
    if (finished.current) return;
    finished.current = true;
    const div = box.current?.querySelector<HTMLElement & { data?: unknown }>(".xy-plot .js-plotly-plot");
    let picture: string | null = null;
    try {
      if (div) picture = await Plotly.toImage(div, { format: "png", width: div.offsetWidth, height: div.offsetHeight, scale: 2 });
    } catch {
      picture = null;
    }
    onDone(picture);
  };
  // a click outside the graph: done with it
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current && !box.current.contains(t) && !t.closest?.(".xy-pop, .nb-pop, .calc-app-notice")) done();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const known = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v]));
  const asText = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)]));
  return (
    <div className="app-graph" ref={box}>
      <XYGraph plot={plot} update={update} vars={asText} known={known} setVariable={() => {}} />
      <div className="app-graph-foot">
        <span className="app-calc-hint">Click outside it (or Done) and it's kept as a picture — click the picture to change it</span>
        <button className="nb-tool" onClick={done}>
          Done
        </button>
      </div>
    </div>
  );
}

/** A graph block's record: what's graphed, and the picture of it. */
export function GraphRecord({ code, picture }: { code: string; picture: React.ReactNode }) {
  const graphed = graphedOf(code);
  return (
    <div className="app-graph-record">
      {graphed.length > 0 && (
        <div className="app-graph-what">
          {graphed.map((latex, k) => (
            <span key={k} className="app-graph-chip">
              <Tex math={latex} />
            </span>
          ))}
        </div>
      )}
      {picture}
    </div>
  );
}
