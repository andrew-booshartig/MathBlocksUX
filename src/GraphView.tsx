/** The one graph renderer every block shares: the Graph block itself, and
 * the mini-graphs inside Line / Quadratic / Sequence / Stats. Takes lines
 * of text exactly as a student types them and draws whatever they are —
 * functions, vertical lines, points, shaded inequalities — with key points
 * (intercepts, vertices, intersections) marked. */
import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "./PlotlyChart";
import { type GraphMarker, type GraphResult, type GraphSeries, useLiveMath } from "./mathSidecar";
import type { GraphWindow } from "./store";
import { Tex } from "./ui";

export const SERIES_COLORS = ["#7c9bf7", "#e07ce0", "#55d6be", "#f0a35c", "#8fd694", "#f08787", "#e0b25c", "#c98cf0"];
export const DEFAULT_WINDOW: GraphWindow = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
const FAR = 1e5;

export type MarkerFeature = "intercepts" | "vertices" | "intersections";

const MARKER_STYLE: Record<GraphMarker["kind"], { color: string; symbol: string }> = {
  "x-intercept": { color: "#f0e14a", symbol: "circle" },
  "y-intercept": { color: "#f0e14a", symbol: "circle" },
  vertex: { color: "#ff8fb1", symbol: "diamond" },
  intersection: { color: "#ffffff", symbol: "star" },
};

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Trace = Record<string, any>;

function seriesTraces(s: GraphSeries, color: string): Trace[] {
  const line = { color, width: 2.5 };
  switch (s.kind) {
    case "function":
      return [{ x: s.x, y: s.y, type: "scatter", mode: "lines", line, connectgaps: false, hoverinfo: "x+y", name: "" }];
    case "points":
      return [
        {
          x: s.x,
          y: s.y,
          type: "scatter",
          mode: "markers+text",
          marker: { color, size: 10, line: { color: "#14141a", width: 1.5 } },
          text: (s.x ?? []).map((x, i) => `(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`),
          textposition: "top center",
          textfont: { color, size: 10 },
          hoverinfo: "text",
        },
      ];
    case "vline":
      return [{ x: [s.x0, s.x0], y: [-FAR, FAR], type: "scatter", mode: "lines", line, hoverinfo: "x" }];
    case "inequality": {
      const boundary = { ...line, dash: s.strict ? "dash" : "solid" };
      const fill = hexToRgba(color, 0.18);
      if (s.vertical) {
        const edge = s.shade === "right" ? FAR : -FAR;
        return [
          { x: [s.x0, s.x0, edge, edge], y: [-FAR, FAR, FAR, -FAR], type: "scatter", mode: "none", fill: "toself", fillcolor: fill, hoverinfo: "skip" },
          { x: [s.x0, s.x0], y: [-FAR, FAR], type: "scatter", mode: "lines", line: boundary, hoverinfo: "x" },
        ];
      }
      const edge = s.shade === "above" ? FAR : -FAR;
      return [
        { x: s.x, y: (s.x ?? []).map(() => edge), type: "scatter", mode: "lines", line: { width: 0 }, hoverinfo: "skip" },
        { x: s.x, y: s.y, type: "scatter", mode: "lines", line: boundary, fill: "tonexty", fillcolor: fill, connectgaps: false, hoverinfo: "x+y" },
      ];
    }
    default:
      return [];
  }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function markerTrace(markers: GraphMarker[]): Trace[] {
  if (!markers.length) return [];
  return [
    {
      x: markers.map((m) => m.x),
      y: markers.map((m) => m.y),
      type: "scatter",
      mode: "markers",
      marker: {
        color: markers.map((m) => MARKER_STYLE[m.kind].color),
        symbol: markers.map((m) => MARKER_STYLE[m.kind].symbol),
        size: markers.map((m) => (m.kind === "intersection" ? 13 : 10)),
        line: { color: "#14141a", width: 1.5 },
      },
      text: markers.map((m) => `${m.kind.replace("-", " ")} ${m.label}`),
      hoverinfo: "text",
    },
  ];
}

export default function GraphView({
  exprs,
  vars,
  window = DEFAULT_WINDOW,
  onWindowChange,
  equalAspect = true,
  hide = [],
  width = 320,
  height = 280,
  extraTraces = [],
  showLabels = true,
  legend = false,
}: {
  exprs: string[];
  vars: Record<string, string>;
  window?: GraphWindow;
  onWindowChange?: (window: GraphWindow) => void;
  equalAspect?: boolean;
  hide?: MarkerFeature[];
  width?: number;
  height?: number;
  extraTraces?: Trace[];
  showLabels?: boolean;
  /** Under the plot: each line's color swatch + LaTeX, or its error. */
  legend?: boolean;
}) {
  // follow the block's width when it's resized; height scales along
  const box = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(width);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // deferred a frame and ignoring ±1px jitter: resizing the plot inside
    // the observer's own callback is what triggers "ResizeObserver loop"
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (w > 50) setMeasured((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const plotWidth = measured;
  const plotHeight = Math.round(height * (measured / width));

  // sample a wider strip than what's visible, so a pan reveals curve that
  // is already there instead of empty space while the new request runs
  const span = window.xmax - window.xmin;
  const request = exprs.some((e) => e.trim())
    ? {
        op: "graph",
        exprs,
        vars,
        xrange: [window.xmin - span, window.xmax + span],
        yrange: [window.ymin, window.ymax],
        features: (["intercepts", "vertices", "intersections"] as MarkerFeature[]).filter((f) => !hide.includes(f)),
      }
    : null;
  const { result, error } = useLiveMath<GraphResult>(request, 120);

  const data = useMemo(() => {
    const traces: Trace[] = [];
    for (const s of result?.series ?? []) traces.push(...seriesTraces(s, SERIES_COLORS[s.index % SERIES_COLORS.length]));
    traces.push(...extraTraces);
    const visible = (result?.markers ?? []).filter(
      (m) => m.x >= window.xmin - 1e-9 && m.x <= window.xmax + 1e-9 && m.y >= window.ymin - span && m.y <= window.ymax + span,
    );
    traces.push(...markerTrace(visible));
    if (showLabels) {
      const labelled = visible;
      traces.push({
        x: labelled.map((m) => m.x),
        y: labelled.map((m) => m.y),
        type: "scatter",
        mode: "text",
        text: labelled.map((m) => m.label),
        textposition: "top right",
        textfont: { color: "#cfcfe0", size: 9 },
        hoverinfo: "skip",
      });
    }
    return traces;
  }, [result, extraTraces, window.xmin, window.xmax, window.ymin, window.ymax, span, showLabels]);

  const layout = useMemo(
    () => ({
      paper_bgcolor: "transparent",
      plot_bgcolor: "#14141a",
      font: { color: "#e8e8f0", size: 10 },
      margin: { l: 32, r: 8, t: 8, b: 24 },
      showlegend: false,
      dragmode: "pan" as const,
      width: plotWidth,
      height: plotHeight,
      xaxis: { zeroline: true, zerolinecolor: "#6a7584", zerolinewidth: 1.5, gridcolor: "#22222c", range: [window.xmin, window.xmax] },
      yaxis: {
        zeroline: true,
        zerolinecolor: "#6a7584",
        zerolinewidth: 1.5,
        gridcolor: "#22222c",
        range: [window.ymin, window.ymax],
        ...(equalAspect ? { scaleanchor: "x" as const, scaleratio: 1 } : {}),
      },
    }),
    [plotWidth, plotHeight, window.xmin, window.xmax, window.ymin, window.ymax, equalAspect],
  );

  return (
    <div className="graph-view nodrag nowheel" ref={box}>
      <Plot
        data={data}
        layout={layout}
        config={{
          displayModeBar: "hover",
          displaylogo: false,
          scrollZoom: true,
          modeBarButtonsToRemove: ["lasso2d", "select2d", "toggleSpikelines", "hoverClosestCartesian", "hoverCompareCartesian", "autoScale2d"],
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onRelayout={(event: any) => {
          if (!onWindowChange) return;
          const x0 = event["xaxis.range[0]"] ?? event["xaxis.range"]?.[0];
          const x1 = event["xaxis.range[1]"] ?? event["xaxis.range"]?.[1];
          const y0 = event["yaxis.range[0]"] ?? event["yaxis.range"]?.[0];
          const y1 = event["yaxis.range[1]"] ?? event["yaxis.range"]?.[1];
          if (event["xaxis.autorange"] || event["yaxis.autorange"]) {
            onWindowChange(DEFAULT_WINDOW);
          } else if (x0 !== undefined && x1 !== undefined) {
            const round = (n: number) => Math.round(n * 1000) / 1000;
            onWindowChange({
              xmin: round(x0),
              xmax: round(x1),
              ymin: round(y0 ?? window.ymin),
              ymax: round(y1 ?? window.ymax),
            });
          }
        }}
      />
      {error && <div className="block-error">{error}</div>}
      {legend && result && (
        <div className="graph-legend">
          {result.series.map((s) => (
            <div key={s.index} className="graph-legend-row">
              <span className="graph-swatch" style={{ background: SERIES_COLORS[s.index % SERIES_COLORS.length] }} />
              {s.kind === "error" ? <span className="block-error">line {s.index + 1}: {s.error}</span> : <Tex math={s.latex ?? ""} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
