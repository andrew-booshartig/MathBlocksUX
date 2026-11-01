/** The one graph renderer every block shares: the Graph block itself, and
 * the mini-graphs inside Line / Quadratic / Sequence / Stats. Takes lines
 * of text exactly as a student types them and draws whatever they are —
 * functions, vertical lines, points, shaded inequalities — with key points
 * (intercepts, vertices, intersections) marked. The Graph block adds per-line
 * styles, a theme, grid/axis options and drawings on top. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { plainMath } from "./plainMath";
import Plot from "./PlotlyChart";
import { type GraphMarker, type GraphResult, type GraphSeries, useLiveMath } from "./mathSidecar";
import type { GraphAppearance, GraphDrawing, GraphLineStyle, GraphTheme, GraphWindow } from "./store";
import { minorStep, niceStep } from "./GraphDraw";
import { Tex } from "./ui";

/** the colors a graph is drawn in */
export type GraphColors = { bg: string; grid: string; minor: string; axis: string; ink: string; palette: string[] };

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
  max: { color: "#ff8fb1", symbol: "triangle-up" },
  min: { color: "#ff8fb1", symbol: "triangle-down" },
  intersection: { color: "#ffffff", symbol: "star" },
  hole: { color: "#ffffff", symbol: "circle-open" },
  tangent: { color: "#f0a35c", symbol: "circle" },
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
    case "function": {
      // the derivative dashed and thinner, a tangent dotted; asymptotes dashed and faint
      const own = s.role === "derivative" ? { ...line, dash: "dash", width: Math.max(1.5, line.width - 0.5) } : s.role === "tangent" ? { ...line, dash: "dot", width: 1.8 } : line;
      const asymptotes = (s.asymptotes ?? []).map((a) => ({ x: [a, a], y: [-FAR, FAR], type: "scatter", mode: "lines", line: { color: toRgba(color, 0.55), width: 1.2, dash: "dash" }, hoverinfo: "x", name: "" }));
      return [...asymptotes, { x: s.x, y: s.y, type: "scatter", mode: "lines", line: own, connectgaps: false, hoverinfo: "x+y", name: "" }];
    }
    case "curve":
      return [{ x: s.x, y: s.y, type: "scatter", mode: "lines", line, connectgaps: false, hoverinfo: "x+y", name: "" }];
    case "field":
      return [{ x: s.x, y: s.y, type: "scatter", mode: "lines", line: { color: toRgba(color, 0.75), width: 1.3 }, connectgaps: false, hoverinfo: "skip", name: "" }];
    case "region":
      return [
        {
          x: s.gx,
          y: s.gy,
          z: s.z,
          type: "heatmap",
          zmin: 0,
          zmax: 1,
          colorscale: [
            [0, "rgba(0,0,0,0)"],
            [1, toRgba(color, style.fill ?? 0.22)],
          ],
          showscale: false,
          hoverinfo: "skip",
        },
        { x: s.x, y: s.y, type: "scatter", mode: "lines", line: { ...line, dash: s.strict ? "dash" : line.dash }, connectgaps: false, hoverinfo: "skip", name: "" },
      ];
    case "area":
      return [
        { x: s.x, y: (s.x ?? []).map(() => 0), type: "scatter", mode: "lines", line: { width: 0 }, hoverinfo: "skip", name: "" },
        { x: s.x, y: s.y, type: "scatter", mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: toRgba(color, 0.3), connectgaps: false, hoverinfo: "skip", name: "" },
      ];
    case "points":
      return [
        {
          x: s.x,
          y: s.y,
          type: "scatter",
          mode: "markers+text",
          marker: { color, size: 6 + 1.6 * (style.width ?? 2.5), line: { color: outline, width: 1.5 } },
          // a named point is labelled by its name, its numbers when hovered
          // (they're in the list too); names are only letters, digits and
          // primes — the engine reads no others
          text: (s.x ?? []).map((x, i) => (s.name ? `<b>${s.name.replace(/_(\w+)/, "<sub>$1</sub>")}</b>` : `(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`)),
          hovertext: (s.x ?? []).map((x, i) => `${s.name ? `${s.name} ` : ""}(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`),
          textposition: s.name ? "top right" : "top center",
          textfont: { color, size: s.name ? 13 : 10 },
          hoverinfo: "text",
        },
      ];
    case "polygon":
      return [{ x: s.x, y: s.y, type: "scatter", mode: "lines", line, fill: "toself", fillcolor: toRgba(color, style.fill ?? 0.16), hoverinfo: "skip", name: "" }];
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

function markerTrace(markers: GraphMarker[], outline: string, ink: string): Trace[] {
  if (!markers.length) return [];
  return [
    {
      x: markers.map((m) => m.x),
      y: markers.map((m) => m.y),
      type: "scatter",
      mode: "markers",
      marker: {
        // a crossing's star in the ink's color: white on dark paper, dark on light
        color: markers.map((m) => (m.kind === "intersection" ? ink : MARKER_STYLE[m.kind].color)),
        symbol: markers.map((m) => MARKER_STYLE[m.kind].symbol),
        size: markers.map((m) => (m.kind === "intersection" ? 13 : m.kind === "hole" ? 11 : 10)),
        line: { color: outline, width: 1.5 },
      },
      text: markers.map((m) => `${m.kind.replace("-", " ")} ${m.label}`),
      hoverinfo: "text",
    },
  ];
}

type LabelSide = "top right" | "bottom right" | "top left" | "bottom left";
const RANK: Record<GraphMarker["kind"], number> = { tangent: 0, intersection: 0, hole: 1, vertex: 1, max: 1, min: 1, "x-intercept": 2, "y-intercept": 2 };

/** Where each point's label goes: beside it, on whichever side keeps it off
 * every other label and point — crossings placed first. A label with no
 * free side is left off (its point still says it when hovered), so points
 * close together never print on top of each other. `px` is screen pixels
 * per unit across and up. */
export function placeLabels(markers: GraphMarker[], px: [number, number]): (LabelSide | null)[] {
  type Box = { x0: number; x1: number; y0: number; y1: number; owner: number };
  const at = (m: GraphMarker) => [m.x * px[0], -m.y * px[1]];
  // every point is in the way of every label but its own
  const taken: Box[] = markers.map((m, i) => {
    const [x, y] = at(m);
    return { x0: x - 6, x1: x + 6, y0: y - 6, y1: y + 6, owner: i };
  });
  const out: (LabelSide | null)[] = markers.map(() => null);
  const order = markers.map((_, i) => i).sort((a, b) => RANK[markers[a].kind] - RANK[markers[b].kind]);
  for (const i of order) {
    const [x, y] = at(markers[i]);
    const w = markers[i].label.length * 5.4 + 4;
    const h = 12;
    for (const side of ["top right", "bottom right", "top left", "bottom left"] as LabelSide[]) {
      const x0 = side.endsWith("right") ? x + 4 : x - 4 - w;
      const y0 = side.startsWith("top") ? y - 4 - h : y + 4;
      const box = { x0, x1: x0 + w, y0, y1: y0 + h, owner: i };
      if (taken.some((b) => b.owner !== i && box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      taken.push(box);
      out[i] = side;
      break;
    }
  }
  return out;
}

/** a graph in the app's own colors (whichever theme is on), not one of the
 * graph themes — read from the page, and again whenever the theme changes */
export function useAppGraphColors(): Partial<GraphColors> {
  const read = (): Partial<GraphColors> => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    if (!v("--t-bg1")) return {};
    const light = luminance(v("--t-bg2")) > 0.5;
    const bg = light ? v("--t-bg0") || v("--t-bg1") : v("--t-bg1");
    return {
      bg,
      grid: v("--t-line"),
      minor: mix(v("--t-line"), bg, 0.55),
      axis: v("--t-muted"),
      ink: v("--t-subtle"),
      palette: ["blue", "pink", "teal", "orange", "green", "red", "yellow", "purple"].map((h) => v(`--t-${h}`)).filter(Boolean),
    };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setColors(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => watch.disconnect();
  }, []);
  return colors;
}

const hexRgb = (hex: string) => {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (hex: string) => {
  const rgb = hexRgb(hex);
  return rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0;
};
/** a, part of the way (t) toward b */
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hexRgb(a), hexRgb(b)];
  if (!x || !y) return a;
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * t)).join(", ")})`;
};

/** the x axis numbered in π: π/2 steps (or π, 2π… when that's too tight) */
function piTicks(range: [number, number], pixelsPerUnit: number) {
  const step = [Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI, 8 * Math.PI].find((s) => s * pixelsPerUnit >= 46) ?? 16 * Math.PI;
  const vals: number[] = [];
  const text: string[] = [];
  const pad = range[1] - range[0];
  for (let v = Math.ceil((range[0] - pad) / step) * step; v <= range[1] + pad; v += step) {
    const quarters = Math.round((v / Math.PI) * 4);
    vals.push(v);
    text.push(piLabel(quarters));
  }
  return { tickmode: "array", tickvals: vals, ticktext: text, dtick: undefined };
}

/** n quarters of π, as written: π/4, π/2, 3π/4, π, −2π, 0 */
function piLabel(quarters: number): string {
  if (quarters === 0) return "0";
  const sign = quarters < 0 ? "−" : "";
  let n = Math.abs(quarters);
  let d = 4;
  while (d > 1 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  const top = n === 1 ? "π" : `${n}π`;
  return `${sign}${top}${d > 1 ? `/${d}` : ""}`;
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
  latex = false,
  extras,
  degrees = false,
  colors,
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
  /** the lines are LaTeX, as typed in a math field */
  latex?: boolean;
  /** per line: its derivative, a tangent line at x, the area from a to b */
  extras?: ({ derivative?: boolean; tangent?: number; area?: [number, number] } | null)[];
  /** trig in degrees */
  degrees?: boolean;
  /** colors of its own, over the graph theme's (the app's theme — useAppGraphColors) */
  colors?: Partial<GraphColors>;
  onResult?: (result: GraphResult | null, error: string | null) => void;
  /** the Plotly element, once drawn — for exporting and for drawing tools */
  onPlot?: (plot: PlotDiv) => void;
  /** drawn over the plot, the same size as it */
  overlay?: (plot: PlotDiv, size: { width: number; height: number }, grid: { x?: number; y?: number }) => ReactNode;
}) {
  const theme = useMemo(() => ({ ...THEMES[appearance.theme ?? "dark"], ...colors }), [appearance.theme, colors]);

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
        ...(latex ? { latex: true, window, ...(extras?.some(Boolean) ? { extras } : {}), ...(degrees ? { degrees: true } : {}) } : {}),
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
  // a vector's arrowhead, at its end
  const arrows = useMemo(
    () =>
      (result?.series ?? [])
        .filter((s) => s.arrow && !hidden(s.index) && s.x?.length === 2 && s.y?.length === 2)
        .map((s) => ({
          x: s.x![1],
          y: s.y![1],
          ax: s.x![0],
          ay: s.y![0],
          xref: "x",
          yref: "y",
          axref: "x",
          ayref: "y",
          text: "",
          showarrow: true,
          arrowhead: 2,
          arrowsize: 1.1,
          arrowwidth: styles[s.index]?.width ?? 2.5,
          arrowcolor: colorOf(s.index),
        })),
    [result, styles, theme], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
    traces.push(...markerTrace(visible, theme.bg, theme.ink));
    if (showLabels && visible.length) {
      // pixels per unit, near enough: the plot's inside over the window
      const across = Math.max(1, plotWidth - 42) / (window.xmax - window.xmin);
      const up = Math.max(1, plotHeight - 34) / (window.ymax - window.ymin);
      const sides = placeLabels(visible, equalAspect ? [Math.min(across, up), Math.min(across, up)] : [across, up]);
      traces.push({
        x: visible.map((m) => m.x),
        y: visible.map((m) => m.y),
        type: "scatter",
        mode: "text",
        text: visible.map((m, i) => (sides[i] ? m.label : "")),
        textposition: sides.map((side) => side ?? "top right"),
        textfont: { color: theme.ink, size: 9 },
        hoverinfo: "skip",
      });
    }
    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, extraTraces, drawn, styles, theme, window.xmin, window.xmax, window.ymin, window.ymax, span, showLabels, plotWidth, plotHeight, equalAspect]);

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
        // a shape says its equation; any other line, itself
        text: escapeHtml(plainMath((s.equation ?? exprs[s.index] ?? "").trim())),
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
    const axis = (range: [number, number], step: number | undefined, pixelsPerUnit: number, label: string | undefined, pi = false) => {
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
        ...(pi ? piTicks(range, pixelsPerUnit) : {}),
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
      annotations: [...drawn.annotations, ...curveLabels, ...arrows],
      xaxis: axis([window.xmin, window.xmax], gridSteps.x, per(perX), appearance.xLabel, !!appearance.piX),
      yaxis: {
        ...axis([window.ymin, window.ymax], gridSteps.y, per(perY), appearance.yLabel),
        ...(equalAspect ? { scaleanchor: "x" as const, scaleratio: 1 } : {}),
      },
    };
  }, [plotWidth, plotHeight, window.xmin, window.xmax, window.ymin, window.ymax, equalAspect, appearance, theme, drawn, curveLabels, arrows, gridSteps]);

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
