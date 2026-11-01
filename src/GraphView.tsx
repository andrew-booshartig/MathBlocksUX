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
import type { GraphAppearance, GraphDrawing, GraphLineStyle, GraphTheme, GraphWindow, XYImage } from "./store";
import { minorStep, niceStep } from "./GraphDraw";
import { Tex } from "./ui";

/** the colors a graph is drawn in */
export type GraphColors = { bg: string; grid: string; minor: string; axis: string; ink: string; palette: string[] };

export const SERIES_COLORS = ["#7c9bf7", "#e07ce0", "#55d6be", "#f0a35c", "#8fd694", "#f08787", "#e0b25c", "#c98cf0"];
export const DEFAULT_WINDOW: GraphWindow = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
const FAR = 1e5;

export type MarkerFeature = "intercepts" | "vertices" | "intersections" | "forms";

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
  endpoint: { color: "#ff8fb1", symbol: "circle" },
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
      // a slope triangle: dashed, thinner than its line
      return [{ x: s.x, y: s.y, type: "scatter", mode: "lines", line: s.role === "slope" ? { ...line, dash: "dash", width: 1.8 } : line, connectgaps: false, hoverinfo: s.role === "slope" ? "skip" : "x+y", name: "" }];
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
          text: (s.x ?? []).map((x, i) => {
            const numbers = `(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`;
            const name = s.name ? `<b>${s.name.replace(/_(\w+)/, "<sub>$1</sub>")}</b>` : "";
            if (style.text) return escapeHtml(style.text);
            // a sequence's dots, or a crowd of them, are read by hovering
            if (style.pointLabel === "none" || (!style.pointLabel && (s.sequence || (s.x?.length ?? 0) > 8))) return "";
            if (style.pointLabel === "both") return name ? `${name} ${numbers}` : numbers;
            return name || numbers;
          }),
          hovertext: (s.x ?? []).map((x, i) => (s.sequence ? `${s.sequence}<sub>${fmt(x)}</sub> = ${fmt(s.y?.[i] ?? 0)}` : `${s.name ? `${s.name} ` : ""}(${fmt(x)}, ${fmt(s.y?.[i] ?? 0)})`)),
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
const RANK: Record<GraphMarker["kind"], number> = { tangent: 0, intersection: 0, hole: 1, vertex: 1, max: 1, min: 1, endpoint: 1, "x-intercept": 2, "y-intercept": 2 };

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

/** k sixths of π as written: π/6, π/3, π/2, 2π/3… (or k·30°) */
function sixthLabel(k: number, degrees: boolean): string {
  if (degrees) return `${k * 30}°`;
  if (k === 0) return "0";
  let [n, d] = [k, 6];
  for (const f of [2, 3]) while (n % f === 0 && d % f === 0) [n, d] = [n / f, d / f];
  return `${n === 1 ? "" : n}π${d > 1 ? `/${d}` : ""}`;
}

/** polar graph paper over what's showing: rings every `step` out from the
 * origin, spokes every 15° (the 30° ones stronger), each 30° named where its
 * spoke leaves the view */
function polarGrid(box: { x0: number; x1: number; y0: number; y1: number }, step: number, perUnit: number, colors: { grid: string; minor: string; ink: string; bg: string }, degrees: boolean) {
  const shapes: Record<string, unknown>[] = [];
  const labels: Record<string, unknown>[] = [];
  const far = Math.max(...[box.x0, box.x1].flatMap((x) => [box.y0, box.y1].map((y) => Math.hypot(x, y))));
  const near = Math.hypot(Math.min(Math.max(0, box.x0), box.x1), Math.min(Math.max(0, box.y0), box.y1));
  let k = step;
  while ((far - near) / k > 60 || k * perUnit < 12) k *= 2;
  for (let r = Math.max(k, Math.ceil(near / k) * k); r <= far + 1e-9; r += k)
    shapes.push({ type: "circle", xref: "x", yref: "y", x0: -r, y0: -r, x1: r, y1: r, line: { color: colors.grid, width: 1 }, layer: "below" });
  const inside = box.x0 < 0 && box.x1 > 0 && box.y0 < 0 && box.y1 > 0;
  for (let d = 0; d < 360; d += 15) {
    const a = (d * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    shapes.push({ type: "line", xref: "x", yref: "y", x0: 0, y0: 0, x1: far * c, y1: far * s, line: { color: d % 30 === 0 ? colors.grid : colors.minor, width: 1 }, layer: "below" });
    if (!inside || d % 30) continue;
    // where the spoke leaves the view, pulled back in a little
    const out = Math.min(...[c > 1e-9 ? box.x1 / c : Infinity, c < -1e-9 ? box.x0 / c : Infinity, s > 1e-9 ? box.y1 / s : Infinity, s < -1e-9 ? box.y0 / s : Infinity]);
    const t = out - 18 / perUnit;
    if (t > 0) labels.push({ x: t * c, y: t * s, xref: "x", yref: "y", text: sixthLabel(d / 30, degrees), showarrow: false, font: { color: colors.ink, size: 10 }, bgcolor: toRgba(colors.bg, 0.7) });
  }
  return { shapes, labels };
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

/** a client point → pixels inside the plot's drawing area, or null when it's outside */
function plotPixels(plot: PlotDiv, clientX: number, clientY: number): [number, number] | null {
  const xa = plot?._fullLayout?.xaxis;
  const ya = plot?._fullLayout?.yaxis;
  if (!xa || !ya) return null;
  const rect = plot.getBoundingClientRect();
  const [px, py] = [clientX - rect.left - xa._offset, clientY - rect.top - ya._offset];
  return px >= 0 && px <= xa._length && py >= 0 && py <= ya._length ? [px, py] : null;
}

/** a value on an axis → pixels along it (log axes too) */
export const toAxisPx = (ax: { type?: string; l2p: (v: number) => number }, v: number) => ax.l2p(ax.type === "log" ? Math.log10(v) : v);

/** the line whose curve, point or edge passes within 10px of `at`, nearest first */
function nearestSeries(plot: PlotDiv, series: GraphSeries[], hidden: (i: number) => boolean, at: [number, number]): number | null {
  const xa = plot?._fullLayout?.xaxis;
  const ya = plot?._fullLayout?.yaxis;
  if (!xa || !ya) return null;
  const P = (x: number, y: number): [number, number] => [toAxisPx(xa, x), toAxisPx(ya, y)];
  const toSegment = (p: [number, number], a: [number, number], b: [number, number]) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  let best: { i: number; d: number } | null = null;
  for (const s of series) {
    if (hidden(s.index) || s.kind === "error" || s.kind === "value" || s.kind === "field") continue;
    let d = Infinity;
    if (s.kind === "vline" && s.x0 !== undefined) d = Math.abs(toAxisPx(xa, s.x0) - at[0]);
    else if (s.x && s.y) {
      const pts = s.x.map((x, k) => (x === null || s.y![k] === null || s.y![k] === undefined ? null : P(x, s.y![k] as number)));
      if (s.kind === "points") for (const p of pts) d = p ? Math.min(d, Math.hypot(p[0] - at[0], p[1] - at[1]) - 4) : d;
      else
        for (let k = 1; k < pts.length; k++) {
          const [a, b] = [pts[k - 1], pts[k]];
          if (a && b && Number.isFinite(a[0] + a[1] + b[0] + b[1])) d = Math.min(d, toSegment(at, a, b));
        }
    }
    if (d < 10 && (!best || d < best.d)) best = { i: s.index, d };
  }
  return best?.i ?? null;
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
  focus = null,
  images = [],
  onPick,
  wheel = false,
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
  /** the line picked (in the list, or by clicking its curve): drawn with a
   * glow, and only its marked points labelled — the rest say theirs when hovered */
  focus?: number | null;
  /** pictures under the graph (maps, photos), placed in graph units */
  images?: XYImage[];
  /** a click on the graph: the line whose curve is under it, or null */
  onPick?: (index: number | null) => void;
  /** pinch or ⌘-scroll zooms, two-finger scrolling moves around (a tile; not the canvas, where scrolling scrolls the page) */
  wheel?: boolean;
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
  const logX = !!appearance.logX;
  const logY = !!appearance.logY;
  const request = exprs.some((e) => e.trim())
    ? {
        op: "graph",
        exprs,
        vars,
        ...(latex ? { latex: true, window, ...(extras?.some(Boolean) ? { extras } : {}), ...(degrees ? { degrees: true } : {}) } : {}),
        ...(logX || logY ? { log: { x: logX, y: logY } } : {}),
        xrange: logX ? [Math.max(window.xmin, 1e-12) / 10, window.xmax * 10] : [window.xmin - span, window.xmax + span],
        yrange: [window.ymin, window.ymax],
        features: (["intercepts", "vertices", "intersections", "forms"] as MarkerFeature[]).filter((f) => !hide.includes(f)),
      }
    : null;
  const { result, error } = useLiveMath<GraphResult>(request, live ? 60 : 120, live ? "throttle" : "debounce");
  useEffect(() => onResult?.(result, error), [result, error, onResult]);

  const colorOf = (index: number) => styles[index]?.color ?? theme.palette[index % theme.palette.length];
  const hidden = (index: number) => !!styles[index]?.hidden;

  const drawn = useMemo(() => drawingLayers(drawings), [drawings]);
  // drafting: lengths along each side (turned to read along it), angles in the corners
  const dimLabels = useMemo(() => {
    if (!appearance.dims) return [];
    const unit = appearance.unit ? ` ${appearance.unit}` : "";
    return (result?.series ?? []).flatMap((s) =>
      hidden(s.index)
        ? []
        : (s.dims ?? []).map((d) => {
            let deg = -(d.deg ?? 0);
            if (deg > 90) deg -= 180;
            if (deg <= -90) deg += 180;
            return {
              x: d.x,
              y: d.y,
              xref: "x",
              yref: "y",
              text: escapeHtml(d.side ? `${d.text}${unit}` : d.text),
              showarrow: false,
              textangle: d.side ? deg : 0,
              yshift: d.side ? 9 : 0,
              font: { color: d.side ? theme.ink : colorOf(s.index), size: 11 },
              bgcolor: toRgba(theme.bg, 0.8),
            };
          }),
    );
  }, [result, styles, theme, appearance.dims, appearance.unit]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const own = seriesTraces(s, colorOf(s.index), styles[s.index] ?? {}, theme.bg);
      // the picked line glows: a wide soft stroke under it
      if (focus === s.index)
        for (const t of own) {
          if (t.type !== "scatter") continue;
          if (t.mode === "lines" && (t.line?.width ?? 1) > 0)
            traces.push({ x: t.x, y: t.y, type: "scatter", mode: "lines", line: { color: toRgba(colorOf(s.index), 0.28), width: (t.line?.width ?? 2.5) + 7 }, connectgaps: false, hoverinfo: "skip" });
          else if (String(t.mode).includes("markers"))
            traces.push({ x: t.x, y: t.y, type: "scatter", mode: "markers", marker: { color: toRgba(colorOf(s.index), 0.3), size: (t.marker?.size ?? 10) + 12 }, hoverinfo: "skip" });
        }
      traces.push(...own);
      if (s.label)
        traces.push({ x: [s.label.x], y: [s.label.y], type: "scatter", mode: "text", text: [escapeHtml(s.label.text)], textfont: { color: colorOf(s.index), size: 12 }, hoverinfo: "skip" });
      for (const l of s.labels ?? [])
        traces.push({ x: [l.x], y: [l.y], type: "scatter", mode: "text", text: [escapeHtml(l.text)], textposition: l.at === "below" ? "bottom center" : l.at === "above" ? "top center" : "middle right", textfont: { color: colorOf(s.index), size: 12 }, hoverinfo: "skip" });
    }
    traces.push(...extraTraces);
    traces.push(...drawn.traces);
    const owned = (m: GraphMarker) => (Array.isArray(m.series) ? m.series : [m.series]).every((i) => !hidden(Number(i)));
    const visible = (result?.markers ?? []).filter(
      (m) => owned(m) && m.x >= window.xmin - 1e-9 && m.x <= window.xmax + 1e-9 && m.y >= window.ymin - span && m.y <= window.ymax + span,
    );
    traces.push(...markerTrace(visible, theme.bg, theme.ink));
    // labelled: the picked line's points (and its crossings), or every line's when none is picked
    const labelled = visible.filter((m) => focus === null || (Array.isArray(m.series) ? m.series : [m.series]).map(Number).includes(focus));
    if (showLabels && labelled.length && !logX && !logY) {
      // pixels per unit, near enough: the plot's inside over the window
      const across = Math.max(1, plotWidth - 42) / (window.xmax - window.xmin);
      const up = Math.max(1, plotHeight - 34) / (window.ymax - window.ymin);
      const sides = placeLabels(labelled, equalAspect ? [Math.min(across, up), Math.min(across, up)] : [across, up]);
      traces.push({
        x: labelled.map((m) => m.x),
        y: labelled.map((m) => m.y),
        type: "scatter",
        mode: "text",
        text: labelled.map((m, i) => (sides[i] ? m.label : "")),
        textposition: sides.map((side) => side ?? "top right"),
        textfont: { color: theme.ink, size: 9 },
        hoverinfo: "skip",
      });
    }
    return traces;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, extraTraces, drawn, styles, theme, window.xmin, window.xmax, window.ymin, window.ymax, span, showLabels, plotWidth, plotHeight, equalAspect, focus, logX, logY]);

  // the equation written next to each curve that asked for a label
  const curveLabels = useMemo(() => {
    const out: Trace[] = [];
    for (const s of result?.series ?? []) {
      const style = styles[s.index];
      if (!(style?.label || style?.text) || style.hidden || s.kind === "points") continue;
      const spot = labelSpot(s, window);
      if (!spot) continue;
      out.push({
        x: spot[0],
        y: spot[1],
        xref: "x",
        yref: "y",
        // a shape says its equation; any other line, itself
        text: escapeHtml(style.text || plainMath((s.equation ?? exprs[s.index] ?? "").trim())),
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
    // "auto" is graph paper: about 20 lines across what's showing (1 per unit
    // at ±10) — what's showing, since the same scale both ways stretches one
    // axis past the window asked for; and square cells when it's the same scale
    const [spanX, spanY] = [window.xmax - window.xmin, window.ymax - window.ymin];
    const equal = equalAspect && !appearance.logX && !appearance.logY && plotWidth > 0 && plotHeight > 0;
    const per = equal ? Math.min(plotWidth / spanX, plotHeight / spanY) : 0;
    const [showX, showY] = equal ? [plotWidth / per, plotHeight / per] : [spanX, spanY];
    const auto = equal ? [niceStep(Math.min(showX, showY) / 20), niceStep(Math.min(showX, showY) / 20)] : [niceStep(showX / 20), niceStep(showY / 20)];
    const pick = (chosen: number | undefined, fallback: number) => (chosen && chosen > 0 ? chosen : fallback);
    return { x: pick(appearance.xStep, auto[0]), y: pick(appearance.yStep, auto[1]) };
  }, [appearance.xStep, appearance.yStep, appearance.logX, appearance.logY, equalAspect, plotWidth, plotHeight, window.xmin, window.xmax, window.ymin, window.ymax]);

  const layout = useMemo(() => {
    const polar = appearance.grid === "polar" && !logX && !logY;
    // a polar grid draws its own rings and spokes: no square lines under them
    const grid = polar ? "none" : appearance.grid === "polar" ? "major" : (appearance.grid ?? "major");
    const numbers = appearance.numbers !== false;
    const axes = appearance.axes !== false;
    // screen pixels per unit (equal scale: the same on both axes)
    const perX = plotWidth / (window.xmax - window.xmin);
    const perY = plotHeight / (window.ymax - window.ymin);
    const equal = equalAspect && !logX && !logY;
    const per = (own: number) => (equal ? Math.min(perX, perY) : own);
    const axis = (range: [number, number], step: number | undefined, pixelsPerUnit: number, label: string | undefined, pi = false, log = false) => {
      // powers of ten: Plotly's own ticks (1, 10, 100 with 2…9 between), its range in exponents
      if (log)
        return {
          type: "log" as const,
          range: range.map((v) => Math.log10(Math.max(v, 1e-12))),
          showgrid: grid !== "none",
          gridcolor: theme.grid,
          minor: { showgrid: grid !== "none", gridcolor: theme.minor },
          zeroline: false,
          showticklabels: numbers,
          tickfont: { color: theme.ink, size: 10 },
          ...(label ? { title: { text: escapeHtml(label), font: { color: theme.ink, size: 12 } } } : {}),
        };
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
        ...(appearance.unit ? { ticksuffix: ` ${appearance.unit}` } : {}),
        ...(step ? { dtick: step * every } : {}),
        ...lines,
        ...(pi ? piTicks(range, pixelsPerUnit) : {}),
        ...(label ? { title: { text: escapeHtml(label), font: { color: theme.ink, size: 12 } } } : {}),
      };
    };
    // what's in view (the same scale both ways shows more than the window on one axis)
    const [cx, cy] = [(window.xmin + window.xmax) / 2, (window.ymin + window.ymax) / 2];
    const [hx, hy] = equal && perX > 0 && perY > 0 ? [plotWidth / per(perX) / 2, plotHeight / per(perY) / 2] : [(window.xmax - window.xmin) / 2, (window.ymax - window.ymin) / 2];
    const paper = polar && plotWidth > 0 ? polarGrid({ x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy }, gridSteps.x, per(perX), theme, !!appearance.degrees) : { shapes: [], labels: [] };
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
      hovermode: "closest" as const,
      hoverdistance: 18,
      hoverlabel: { bgcolor: theme.bg, font: { color: theme.ink, size: 12, family: "-apple-system, BlinkMacSystemFont, Inter, sans-serif" } },
      width: plotWidth,
      height: plotHeight,
      annotations: [...drawn.annotations, ...curveLabels, ...arrows, ...dimLabels, ...paper.labels],
      shapes: paper.shapes,
      images: images
        .filter((im) => !im.hidden)
        .map((im) => ({ source: im.src, xref: "x", yref: "y", x: im.x, y: im.y + im.w * im.aspect, sizex: im.w, sizey: im.w * im.aspect, xanchor: "left", yanchor: "top", sizing: "stretch", opacity: im.opacity ?? 1, layer: "below" })),
      xaxis: axis([window.xmin, window.xmax], gridSteps.x, per(perX), appearance.xLabel, !!appearance.piX && !logX, logX),
      yaxis: {
        ...axis([window.ymin, window.ymax], gridSteps.y, per(perY), appearance.yLabel, false, logY),
        ...(equal ? { scaleanchor: "x" as const, scaleratio: 1 } : {}),
      },
    };
  }, [plotWidth, plotHeight, window.xmin, window.xmax, window.ymin, window.ymax, equalAspect, appearance, theme, drawn, curveLabels, arrows, dimLabels, gridSteps, logX, logY, images]);

  const [plot, setPlot] = useState<PlotDiv>(null);
  const ready = (_figure: unknown, div: PlotDiv) => {
    if (div !== plot) {
      setPlot(div);
      onPlot?.(div);
    }
  };

  // the latest of what the listeners below read, without re-adding them
  const live$ = useRef({ plot, result, window, onWindowChange, onPick, hidden });
  live$.current = { plot, result, window, onWindowChange, onPick, hidden };

  // a click (not a drag) on the graph picks the line whose curve or point is
  // under it — within 10px — or none. (The release is heard on the document:
  // Plotly lays a cover over the page while the button is down.)
  useEffect(() => {
    const el = box.current;
    if (!el || !onPick) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      start = e.button === 0 && !target.closest(".graph-draw-layer:not(.is-pan), .graph-handle") ? { x: e.clientX, y: e.clientY } : null;
    };
    const up = (e: PointerEvent) => {
      const from = start;
      start = null;
      if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;
      const { plot, result, onPick, hidden } = live$.current;
      const at = plotPixels(plot, e.clientX, e.clientY);
      if (!at || !onPick) return;
      onPick(nearestSeries(plot, result?.series ?? [], hidden, at));
    };
    el.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
    };
  }, [!!onPick]); // eslint-disable-line react-hooks/exhaustive-deps

  // pinch (or ⌘ + scroll) zooms where the pointer is; two fingers move the
  // graph around; a mouse wheel zooms — gathered up and applied once a frame
  useEffect(() => {
    const el = box.current;
    if (!el || !wheel) return;
    let pending: { factor: number; dx: number; dy: number; at: [number, number] } | null = null;
    let frame = 0;
    const flush = () => {
      frame = 0;
      const { plot, window: w, onWindowChange } = live$.current;
      const xa = plot?._fullLayout?.xaxis;
      const ya = plot?._fullLayout?.yaxis;
      if (!pending || !xa || !ya || !onWindowChange) return (pending = null);
      const { factor, dx, dy, at } = pending;
      pending = null;
      // in the axes' own (linear, or exponent) units, as drawn right now
      const [x0, x1] = (xa.range as number[]).map(Number);
      const [y0, y1] = (ya.range as number[]).map(Number);
      const [ux, uy] = [(x1 - x0) / xa._length, (y1 - y0) / ya._length];
      const [cx, cy] = [x0 + at[0] * ux, y1 - at[1] * uy];
      const f = Math.min(Math.max(factor, 0.2), 5);
      const scale = (v: number, c: number, shift: number) => c + (v + shift - c) * f;
      const back = (ax: { type?: string }, v: number) => Math.round((ax.type === "log" ? 10 ** v : v) * 1e6) / 1e6;
      const next = {
        xmin: back(xa, scale(x0, cx, dx * ux)),
        xmax: back(xa, scale(x1, cx, dx * ux)),
        ymin: back(ya, scale(y0, cy, -dy * uy)),
        ymax: back(ya, scale(y1, cy, -dy * uy)),
      };
      const sane = (a: number, b: number) => b - a > 1e-6 && b - a < 1e8 && Number.isFinite(a) && Number.isFinite(b);
      if (sane(next.xmin, next.xmax) && sane(next.ymin, next.ymax)) onWindowChange(next);
      else if (w) onWindowChange(w);
    };
    const onWheel = (e: WheelEvent) => {
      const { plot } = live$.current;
      const at = plotPixels(plot, e.clientX, e.clientY);
      if (!at) return;
      e.preventDefault();
      const pinch = e.ctrlKey || e.metaKey;
      const mouse = !pinch && (e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)));
      pending ??= { factor: 1, dx: 0, dy: 0, at };
      pending.at = at;
      if (pinch) pending.factor *= Math.exp(Math.max(-30, Math.min(30, e.deltaY)) * 0.012);
      else if (mouse) pending.factor *= e.deltaY > 0 ? 1.15 : 1 / 1.15;
      else {
        pending.dx += e.deltaX;
        pending.dy += e.deltaY;
      }
      if (!frame) frame = requestAnimationFrame(flush);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [wheel]);

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
          // a log axis reports its range in powers of ten
          const fx = (v: number | undefined) => (v === undefined ? v : logX ? 10 ** v : v);
          const fy = (v: number | undefined) => (v === undefined ? v : logY ? 10 ** v : v);
          const x0 = fx(event["xaxis.range[0]"] ?? event["xaxis.range"]?.[0]);
          const x1 = fx(event["xaxis.range[1]"] ?? event["xaxis.range"]?.[1]);
          const y0 = fy(event["yaxis.range[0]"] ?? event["yaxis.range"]?.[0]);
          const y1 = fy(event["yaxis.range[1]"] ?? event["yaxis.range"]?.[1]);
          if (event["xaxis.autorange"] || event["yaxis.autorange"]) {
            onWindowChange(DEFAULT_WINDOW);
          } else if (x0 !== undefined && x1 !== undefined) {
            const round = (n: number) => Math.round(n * 1e6) / 1e6;
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
