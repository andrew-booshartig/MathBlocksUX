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
  kind: "function" | "points" | "vline" | "inequality" | "error";
  latex?: string;
  error?: string;
  x?: number[];
  y?: (number | null)[];
  x0?: number;
  vertical?: boolean;
  shade?: "above" | "below" | "left" | "right";
  strict?: boolean;
}

export interface GraphMarker {
  x: number;
  y: number;
  kind: "x-intercept" | "y-intercept" | "vertex" | "intersection";
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
export function useLiveMath<T>(request: MathRequest | null, delayMs = 150) {
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<{ result: T | null; error: string | null }>({ result: null, error: null });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    if (!key) {
      setState({ result: null, error: null });
      return;
    }
    const timer = setTimeout(() => {
      mathRequest<T>(JSON.parse(key)).then(
        (result) => {
          if (mine === generation.current) setState({ result, error: null });
        },
        (error) => {
          if (mine === generation.current) setState({ result: null, error: String(error) });
        },
      );
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs]);

  return state;
}
