import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

/** One line of worked math: a plain-language note (may contain $inline
 * math$ and **bold**) and the LaTeX for where the work stands after it. */
export interface Step {
  note: string;
  latex: string;
}

export type MathRequest = { op: string } & Record<string, unknown>;

export interface TransformResult {
  steps: Step[];
  result_latex: string;
  mode: string;
}

export interface NumberLineSegment {
  lo: number | null;
  hi: number | null;
  loClosed: boolean;
  hiClosed: boolean;
  /** each end exactly, as it's written under the line: "4/3", "−7", "√2" */
  loLabel?: string;
  hiLabel?: string;
}

export interface SolveResult {
  kind: "equation" | "inequality" | "system";
  steps: Step[];
  solution_latex: string;
  variable?: string;
  variables?: string[];
  solutions?: (number | null)[];
  points?: [number, number][];
  interval_latex?: string;
  numberline?: NumberLineSegment[];
  discriminant?: string;
}

export interface GraphSeries {
  index: number;
  kind: "function" | "points" | "vline" | "inequality" | "curve" | "region" | "field" | "area" | "polygon" | "value" | "analysis" | "error";
  /** a point's name (A = (1, 2)), written beside it */
  name?: string;
  /** geometry: segment, line, ray, vector, circle, polygon, perpendicular, parallel */
  shape?: string;
  /** a vector: an arrowhead at its end */
  arrow?: boolean;
  /** what's true about it, as math: a segment's length, a line's equation, ∫ … = … */
  facts?: string[];
  /** a straight shape: the two points it's drawn through (x, y, x, y) */
  anchor?: [number, number, number, number];
  /** a point slid along a shape: the letter that slides it, and the path it can take (that letter's value at each step) */
  glide?: string;
  path?: { x: number[]; y: number[]; t: number[] };
  /** a straight shape's equation alone (y = mx + b) */
  equation?: string;
  /** a straight line (y = 2x + 1, x = 3): two points on it, as math — to build a perpendicular or parallel from */
  through?: [string, string];
  /** a function, analyzed: its domain, zeros, highs and lows… as rows of math */
  rows?: { label: string; tex: string }[];
  /** drafting labels: each side's length (turned along it), each corner's angle */
  dims?: { x: number; y: number; text: string; deg?: number; side?: boolean }[];
  /** words written on the graph beside it: an angle's size */
  label?: { x: number; y: number; text: string };
  /** a function drawn for another line: its derivative, or a tangent line */
  role?: "derivative" | "tangent" | "riemann" | "between" | "slope";
  /** words on the graph beside it, each on a side of its spot: a slope triangle's rise and run */
  labels?: { x: number; y: number; text: string; at?: "below" | "above" | "right" }[];
  /** vertical asymptotes (x values), drawn dashed */
  asymptotes?: number[];
  /** a region: its grid and where it's true (rows of 0/1) */
  gx?: number[];
  gy?: number[];
  z?: number[][];
  /** an area under a curve: its value and limits; a tangent: its slope */
  value?: number;
  from?: number;
  to?: number;
  slope?: number;
  /** a polar or parametric curve: θ's or t's range */
  polar?: [number, number];
  parametric?: [number, number];
  latex?: string;
  error?: string;
  x?: number[];
  y?: (number | null)[];
  x0?: number;
  vertical?: boolean;
  shade?: "above" | "below" | "left" | "right";
  strict?: boolean;
  /** the line as typed, as math (letters kept) — `latex` has values filled in */
  display?: string;
  /** letters this line needs a value for (the Graph block makes sliders) */
  missing?: string[];
  /** every letter it uses but x and y — defined somewhere or not */
  letters?: string[];
}

export interface GraphMarker {
  x: number;
  y: number;
  kind: "x-intercept" | "y-intercept" | "vertex" | "intersection" | "max" | "min" | "hole" | "tangent";
  label: string;
  series: number | number[];
}

export interface GraphResult {
  series: GraphSeries[];
  markers: GraphMarker[];
  xrange: [number, number];
  yrange: [number, number];
}

export interface TableResult {
  expr_latex: string;
  rows: { x_latex: string; x: number | null; y_latex: string; y: number | null }[];
  first_differences: string[];
  second_differences: string[];
  ratios: string[];
  pattern: string;
}

export interface LineResult {
  steps: Step[];
  mode: string;
  vertical?: boolean;
  vertical_x?: number;
  slope_latex: string;
  slope_intercept: string | null;
  point_slope?: string;
  standard: string;
  x_intercept_latex: string;
  y_intercept_latex: string;
  parallel_slope: string;
  perpendicular_slope: string;
  direction: string;
  plot_expr?: string;
}

export interface QuadraticResult {
  steps: Step[];
  standard: string;
  vertex_form: string;
  factored: string | null;
  vertex_latex: string;
  vertex: [number, number];
  axis: string;
  opens: "up" | "down";
  extremum_latex: string;
  y_intercept_latex: string;
  discriminant_latex: string;
  roots_latex: string[];
  roots: number[];
  domain: string;
  range: string;
  plot_expr: string;
}

export interface SequenceResult {
  kind: "arithmetic" | "geometric" | "quadratic";
  steps: Step[];
  explicit: string;
  recursive: string | null;
  next_latex: string;
  n: number;
  nth_latex: string;
  points: [number, number | null][];
  common: string | null;
}

export interface StatsResult {
  steps: Step[];
  n: number;
  mean: string;
  median: string;
  mode: string;
  range: string;
  min: string;
  max: string;
  q1: string;
  q3: string;
  iqr: string;
  mad: string;
  sd_population: string;
  sd_sample: string;
  outliers: string[];
  values: number[];
  regression?: {
    equation: string;
    slope: number;
    intercept: number;
    r: string;
    r2: string;
    description: string;
    points: [number, number][];
  };
}

export interface PracticeProblem {
  topic: string;
  title: string;
  prompt: string;
  latex: string;
  kind: string;
  answer: unknown;
  answer_latex: string;
  target?: string;
  /** answer by picking one of these instead of typing */
  choices?: { label: string; value: string }[];
  show: MathRequest;
}

export interface CheckResult {
  correct: boolean;
  feedback: string | null;
}

export interface CustomResult {
  result: {
    text?: string;
    latex?: string;
    plot?: { x: number[]; y: (number | null)[] };
  };
}

export function mathRequest<T>(request: MathRequest): Promise<T> {
  return invoke<T>("math_eval", { request });
}

export const runCustom = (code: string, vars: Record<string, string>) =>
  mathRequest<CustomResult>({ op: "custom", expr: code, vars });

/** Live, debounced evaluation for a block. Pass null to mean "nothing to
 * compute yet". Requests are keyed on their JSON, so a re-render with an
 * identical request does nothing, and a slow response for stale input is
 * dropped rather than clobbering what's currently on screen. */
/** Keeps a live result for `request`. Debounced by default (waits for a
 * pause — typing doesn't flash half-read errors); `throttle` instead sends
 * at most one request per `delayMs` while it keeps changing, so a slider
 * being dragged or played redraws continuously. */
export function useLiveMath<T>(request: MathRequest | null, delayMs = 150, mode: "debounce" | "throttle" = "debounce") {
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<{ result: T | null; error: string | null }>({ result: null, error: null });
  const generation = useRef(0);
  const lastSent = useRef(0);
  // throttle: requests overlap while a slider moves, so an answer counts if
  // it's newer than the one on screen (not only if nothing changed since)
  const sent = useRef(0);
  const shown = useRef(0);
  const live = useRef(key);
  live.current = key;

  useEffect(() => {
    const mine = ++generation.current;
    if (!key) {
      setState({ result: null, error: null });
      return;
    }
    const send = () => {
      lastSent.current = performance.now();
      const seq = ++sent.current;
      const fresh = () => (mode === "throttle" ? seq > shown.current && live.current !== "" : mine === generation.current);
      mathRequest<T>(JSON.parse(key)).then(
        (result) => {
          if (!fresh()) return;
          shown.current = seq;
          setState({ result, error: null });
        },
        (error) => {
          if (!fresh()) return;
          shown.current = seq;
          setState({ result: null, error: String(error) });
        },
      );
    };
    const wait = mode === "throttle" ? Math.max(0, lastSent.current + delayMs - performance.now()) : delayMs;
    const timer = setTimeout(send, wait);
    return () => clearTimeout(timer);
  }, [key, delayMs, mode]);

  return state;
}
