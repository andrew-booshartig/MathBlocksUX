/** The one graph renderer every block shares: the Graph block itself, and
 * the mini-graphs inside Line / Quadratic / Sequence / Stats. Takes lines
 * of text exactly as a student types them and draws whatever they are —
 * functions, vertical lines, points, shaded inequalities — with key points
 * (intercepts, vertices, intersections) marked. The Graph block adds per-line
 * styles, a theme, grid/axis options and drawings on top. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Plot from "./PlotlyChart";
import { type GraphMarker, type GraphResult, type GraphSeries, useLiveMath } from "./mathSidecar";
import type { GraphAppearance, GraphDrawing, GraphLineStyle, GraphTheme, GraphWindow } from "./store";
import { minorStep, niceStep } from "./GraphDraw";
import { Tex } from "./ui";

export const SERIES_COLORS = ["#7c9bf7", "#e07ce0", "#55d6be", "#f0a35c", "#8fd694", "#f08787", "#e0b25c", "#c98cf0"];
export const DEFAULT_WINDOW: GraphWindow = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
const FAR = 1e5;

export type MarkerFeature = "intercepts" | "vertices" | "intersections";

/** How a theme paints the plot. `palette` is for lines without their own color. */
export const THEMES: Record<GraphTheme, { label: string; bg: string; grid: string; minor: string; axis: string; ink: string; palette: string[] }> = {
  dark: { label: "Dark", bg: "#14141a", grid: "#24242f", minor: "#1a1a22", axis: "#6a7584", ink: "#e8e8f0", palette: SERIES_COLORS },
  paper: {
    label: "Paper",
    bg: "#ffffff",
    grid: "#dfe3ea",
    minor: "#f0f2f6",
    axis: "#4a5263",
    ink: "#1d2330",
    palette: ["#2f6fe0", "#c2185b", "#0f9d76", "#e07b16", "#2e7d32", "#d32f2f", "#a0790a", "#7b1fa2"],
  },
  chalkboard: {
    label: "Chalkboard",
    bg: "#1e3a2f",
    grid: "rgba(255,255,255,0.10)",
    minor: "rgba(255,255,255,0.04)",
    axis: "#e9f2ec",
    ink: "#eef5f0",
    palette: ["#fff59d", "#ffab91", "#80deea", "#f8bbd0", "#c5e1a5", "#ffffff", "#ffcc80", "#b39ddb"],
  },
  blueprint: {
    label: "Blueprint",
    bg: "#123a73",
    grid: "rgba(255,255,255,0.16)",
    minor: "rgba(255,255,255,0.06)",
    axis: "#dce8ff",
    ink: "#eaf1ff",
    palette: ["#ffffff", "#ffd54f", "#80d8ff", "#ff8a80", "#b9f6ca", "#ea80fc", "#ffcc80", "#a7ffeb"],
  },
};

const MARKER_STYLE: Record<GraphMarker["kind"], { color: string; symbol: string }> = {
  "x-intercept": { color: "#f0e14a", symbol: "circle" },
  "y-intercept": { color: "#f0e14a", symbol: "circle" },
  vertex: { color: "#ff8fb1", symbol: "diamond" },
  intersection: { color: "#ffffff", symbol: "star" },
};

function toRgba(color: string, alpha: number) {
  if (!color.startsWith("#") || color.length !== 7) return color;
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Trace = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlotDiv = any;

function seriesTraces(s: GraphSeries, color: string, style: GraphLineStyle, outline: string): Trace[] {
  const line = { color, width: style.width ?? 2.5, dash: style.dash ?? "solid" };
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
          marker: { color, size: 6 + 1.6 * (style.width ?? 2.5), line: { color: outline, width: 1.5 } },
          text: (s.x ?? []).map((x, i) => `(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`),
          textposition: "top center",
          textfont: { color, size: 10 },
          hoverinfo: "text",
        },
      ];
    case "vline":
      return [{ x: [s.x0, s.x0], y: [-FAR, FAR], type: "scatter", mode: "lines", line, hoverinfo: "x" }];
    case "inequality": {
      const boundary = { ...line, dash: s.strict ? "dash" : line.dash };
      const fill = toRgba(color, style.fill ?? 0.18);
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

function markerTrace(markers: GraphMarker[], outline: string): Trace[] {
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
        line: { color: outline, width: 1.5 },
      },
      text: markers.map((m) => `${m.kind.replace("-", " ")} ${m.label}`),
      hoverinfo: "text",
    },
  ];
}

/** Pen strokes and segments as lines; arrows and text as annotations. */
function drawingLayers(drawings: GraphDrawing[]): { traces: Trace[]; annotations: Trace[] } {
  const traces: Trace[] = [];
  const annotations: Trace[] = [];
  for (const d of drawings) {
    if (d.kind === "pen" || d.kind === "segment") {
      traces.push({
        x: d.points.map((p) => p[0]),
        y: d.points.map((p) => p[1]),
        type: "scatter",
        mode: "lines",
        line: { color: d.color, width: d.width, shape: d.kind === "pen" ? "spline" : "linear", smoothing: 0.6 },
        hoverinfo: "skip",
      });
    } else if (d.kind === "arrow" && d.points.length === 2) {
      const [[x0, y0], [x1, y1]] = d.points;
      annotations.push({
        x: x1,
        y: y1,
        ax: x0,
        ay: y0,
        xref: "x",
        yref: "y",
        axref: "x",
        ayref: "y",
        text: "",
        showarrow: true,
        arrowhead: 2,
        arrowsize: 1.1,
        arrowwidth: d.width,
        arrowcolor: d.color,
      });
    } else if (d.kind === "text" && d.points.length) {
      annotations.push({
        x: d.points[0][0],
        y: d.points[0][1],
        xref: "x",
        yref: "y",
        text: escapeHtml(d.text ?? ""),
        showarrow: false,
        xanchor: "left",
        yanchor: "bottom",
        font: { color: d.color, size: 9 + d.width * 2.5 },
      });
    }
  }
  return { traces, annotations };
}

/** Plotly annotation text is HTML-ish — show typed < > & as themselves. */
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where a curve leaves the visible window — a good spot for its label. */
function labelSpot(s: GraphSeries, w: GraphWindow): [number, number] | null {
  if (s.kind === "vline" && s.x0 !== undefined) return [s.x0, w.ymax - (w.ymax - w.ymin) * 0.06];
  if (!s.x || !s.y) return null;
  for (let i = s.x.length - 1; i >= 0; i--) {
    const x = s.x[i];
    const y = s.y[i];
    if (y === null || y === undefined) continue;
    if (x >= w.xmin && x <= w.xmax - (w.xmax - w.xmin) * 0.02 && y >= w.ymin && y <= w.ymax) return [x, y];
  }
  return null;
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
  fill = false,
  styles = [],
  appearance = {},
  drawings = [],
  live = false,
  onResult,
  onPlot,
  overlay,
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
  /** size the plot to fill its container (both ways) instead of width × height */
  fill?: boolean;
  /** per line (same order as `exprs`) */
  styles?: GraphLineStyle[];
  appearance?: GraphAppearance;
  drawings?: GraphDrawing[];
  /** redraw continuously while values change (sliders), not after a pause */
  live?: boolean;
  onResult?: (result: GraphResult | null, error: string | null) => void;
  /** the Plotly element, once drawn — for exporting and for drawing tools */
  onPlot?: (plot: PlotDiv) => void;
  /** drawn over the plot, the same size as it */
  overlay?: (plot: PlotDiv, size: { width: number; height: number }, grid: { x?: number; y?: number }) => ReactNode;
}) {
  const theme = THEMES[appearance.theme ?? "dark"];

  // follow the container: its width (height scales along), or both in `fill` mode
  const box = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ w: width, h: height });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // deferred a frame and ignoring ±1px jitter: resizing the plot inside
    // the observer's own callback is what triggers "ResizeObserver loop"
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (w <= 50) return;
        setMeasured((prev) => {
          const nextH = fill && h > 50 ? h : prev.h;
          return Math.abs(prev.w - w) > 1 || Math.abs(prev.h - nextH) > 1 ? { w, h: nextH } : prev;
        });
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fill]);
  const plotWidth = measured.w;
  const plotHeight = fill ? measured.h : Math.round(height * (measured.w / width));

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
  const { result, error } = useLiveMath<GraphResult>(request, live ? 60 : 120, live ? "throttle" : "debounce");
  useEffect(() => onResult?.(result, error), [result, error, onResult]);

  const colorOf = (index: number) => styles[index]?.color ?? theme.palette[index % theme.palette.length];
  const hidden = (index: number) => !!styles[index]?.hidden;

  const drawn = useMemo(() => drawingLayers(drawings), [drawings]);

  const data = useMemo(() => {
    const traces: Trace[] = [];
    for (const s of result?.series ?? []) {
      if (hidden(s.index)) continue;
      traces.push(...seriesTraces(s, colorOf(s.index), styles[s.index] ?? {}, theme.bg));
    }
    traces.push(...extraTraces);
    traces.push(...drawn.traces);
    const owned = (m: GraphMarker) => (Array.isArray(m.series) ? m.series : [m.series]).every((i) => !hidden(Number(i)));
    const visible = (result?.markers ?? []).filter(
      (m) => owned(m) && m.x >= window.xmin - 1e-9 && m.x <= window.xmax + 1e-9 && m.y >= window.ymin - span && m.y <= window.ymax + span,
    );
    traces.push(...markerTrace(visible, theme.bg));
    if (showLabels) {
      traces.push({
        x: visible.map((m) => m.x),
        y: visible.map((m) => m.y),
        type: "scatter",
        mode: "text",
        text: visible.map((m) => m.label),
        textposition: "top right",
        textfont: { color: theme.ink, size: 9 },
        hoverinfo: "skip",
      });
    }
    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, extraTraces, drawn, styles, theme, window.xmin, window.xmax, window.ymin, window.ymax, span, showLabels]);

  // the equation written next to each curve that asked for a label
  const curveLabels = useMemo(() => {
    const out: Trace[] = [];
    for (const s of result?.series ?? []) {
      const style = styles[s.index];
      if (!style?.label || style.hidden) continue;
      const spot = labelSpot(s, window);
      if (!spot) continue;
      out.push({
        x: spot[0],
        y: spot[1],
        xref: "x",
        yref: "y",
        text: escapeHtml((exprs[s.index] ?? "").trim()),
        showarrow: false,
        xanchor: "right",
        yanchor: "bottom",
        font: { color: colorOf(s.index), size: 12 },
        bgcolor: toRgba(theme.bg, 0.75),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, styles, exprs, theme, window.xmin, window.xmax, window.ymin, window.ymax]);

  // the grid: lines every `step` (what points snap to) — but numbers only as
  // often as they fit, so a fine grid doesn't crowd (or turn) the labels
  const gridSteps = useMemo(() => {
    // "auto" is graph paper: about 20 lines across the view (1 per unit at ±10)
    const pick = (chosen: number | undefined, span: number) => (chosen && chosen > 0 ? chosen : niceStep(span / 20));
    return { x: pick(appearance.xStep, window.xmax - window.xmin), y: pick(appearance.yStep, window.ymax - window.ymin) };
  }, [appearance.xStep, appearance.yStep, window.xmin, window.xmax, window.ymin, window.ymax]);

  const layout = useMemo(() => {
    const grid = appearance.grid ?? "major";
    const numbers = appearance.numbers !== false;
    const axes = appearance.axes !== false;
    // screen pixels per unit (equal scale: the same on both axes)
    const perX = plotWidth / (window.xmax - window.xmin);
    const perY = plotHeight / (window.ymax - window.ymin);
    const per = (own: number) => (equalAspect ? Math.min(perX, perY) : own);
    const axis = (range: [number, number], step: number | undefined, pixelsPerUnit: number, label: string | undefined) => {
      // a number every k grid lines, k the smallest of 1, 2, 5, 10 … that gives each ~34px
      const every = step ? ([1, 2, 5, 10, 20, 50, 100, 200, 500].find((k) => step * k * pixelsPerUnit >= 34) ?? 1000) : 1;
      const lines = grid === "none" ? {} : step && grid === "minor" ? { minor: { showgrid: true, gridcolor: theme.minor, dtick: minorStep(step) } }
        : step && every > 1 ? { minor: { showgrid: true, gridcolor: theme.grid, dtick: step } }
        : grid === "minor" ? { minor: { showgrid: true, gridcolor: theme.minor } }
        : {};
      return {
        range,
        zeroline: axes,
        zerolinecolor: theme.axis,
        zerolinewidth: 1.5,
        showgrid: grid !== "none",
        gridcolor: theme.grid,
        showticklabels: numbers,
        tickangle: 0,
        tickfont: { color: theme.ink, size: 10 },
        ...(step ? { dtick: step * every } : {}),
        ...lines,
        ...(label ? { title: { text: escapeHtml(label), font: { color: theme.ink, size: 12 } } } : {}),
      };
    };
    return {
      paper_bgcolor: theme.bg,
      plot_bgcolor: theme.bg,
      font: { color: theme.ink, size: 10 },
      margin: {
        l: (numbers ? 32 : 10) + (appearance.yLabel ? 18 : 0),
        r: 10,
        t: appearance.title ? 34 : 10,
        b: (numbers ? 24 : 10) + (appearance.xLabel ? 18 : 0),
      },
      ...(appearance.title ? { title: { text: escapeHtml(appearance.title), font: { color: theme.ink, size: 15 } } } : {}),
      showlegend: false,
      dragmode: "pan" as const,
      width: plotWidth,
      height: plotHeight,
      annotations: [...drawn.annotations, ...curveLabels],
      xaxis: axis([window.xmin, window.xmax], gridSteps.x, per(perX), appearance.xLabel),
      yaxis: {
        ...axis([window.ymin, window.ymax], gridSteps.y, per(perY), appearance.yLabel),
        ...(equalAspect ? { scaleanchor: "x" as const, scaleratio: 1 } : {}),
      },
    };
  }, [plotWidth, plotHeight, window.xmin, window.xmax, window.ymin, window.ymax, equalAspect, appearance, theme, drawn, curveLabels, gridSteps]);

  const [plot, setPlot] = useState<PlotDiv>(null);
  const ready = (_figure: unknown, div: PlotDiv) => {
    if (div !== plot) {
      setPlot(div);
      onPlot?.(div);
    }
  };

  return (
    // no wheel zoom: scrolling over a graph scrolls the page like anywhere
    // else (a big graph used to trap the wheel) — zoom with the buttons
    <div className={`graph-view nodrag${fill ? " is-fill" : ""}`} ref={box}>
      <Plot
        data={data}
        layout={layout}
        onInitialized={ready}
        onUpdate={ready}
        config={{
          displayModeBar: fill ? false : "hover",
          displaylogo: false,
          scrollZoom: false,
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
      {plot && overlay?.(plot, { width: plotWidth, height: plotHeight }, gridSteps)}
      {error && !onResult && <div className="block-error">{error}</div>}
      {legend && result && (
        <div className="graph-legend">
          {result.series.map((s) => (
            <div key={s.index} className="graph-legend-row">
              <span className="graph-swatch" style={{ background: colorOf(s.index) }} />
              {s.kind === "error" ? <span className="block-error">line {s.index + 1}: {s.error}</span> : <Tex math={s.latex ?? ""} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
