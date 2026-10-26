/** A solution set on a number line, drawn by the standard convention (as in
 * college algebra texts): one line with arrows at both ends and evenly
 * spaced ticks (steps of 1, 2, 5, 10…); the solution set shaded in one
 * color; an open circle where an endpoint isn't included (< >), a closed
 * one where it is (≤ ≥); an arrowhead where the shading goes on forever;
 * and each endpoint's value written once, exactly (4/3, not 1.33), under
 * the line at its place. No solution is the line with nothing shaded,
 * labeled ∅. One drawing for the app, printed pages and LaTeX (TikZ). */
import type { NumberLineSegment } from "./mathSidecar";

export interface NumberLinePalette {
  /** the line, its ticks and arrows */
  axis: string;
  /** the scale's numbers */
  label: string;
  /** an endpoint's value — part of the answer, so it stands out a little */
  value: string;
  /** the solution set: one color */
  shade: string;
  /** an "and" whose parts never meet: the parts, faint and dashed (they're
   * the reason there's no solution, not an answer) */
  work: string;
  /** inside an open circle (the page) */
  hole: string;
}

/** the app's: a theme sets these (the calculator app's themes); the canvas
 * app falls back to One Dark's */
export const APP_PALETTE: NumberLinePalette = {
  axis: "var(--nl-axis, #4b5260)",
  label: "var(--nl-label, #8b90a0)",
  value: "var(--nl-value, #d7dae0)",
  shade: "var(--nl-shade, #61afef)",
  work: "var(--nl-work, #abb2bf)",
  hole: "var(--nl-hole, #17171f)",
};
export const PRINT_PALETTE: NumberLinePalette = {
  axis: "#4b5563",
  label: "#374151",
  value: "#111827",
  shade: "#2c6fbb",
  work: "#6b7280",
  hole: "#ffffff",
};

/** Is the combined answer just what was typed, written another way? (Then
 * there's nothing to add under the graph; z < 4 or z ≥ -6 → "together: all
 * real numbers" is worth saying.) */
export function sameWritten(a: string, b: string): boolean {
  const plain = (s: string) => s.replace(/\\text\{([^}]*)\}/g, "$1").replace(/\\(quad|qquad|,|;|:|!| )|\s/g, "");
  return plain(a) === plain(b);
}

/** A LaTeX answer as plain text for a label: −14 < y < −7, no solution. */
export function plainMath(latex: string): string {
  return latex
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\le(?![a-z])/g, "≤")
    .replace(/\\ge(?![a-z])/g, "≥")
    .replace(/\\ne(?![a-z])/g, "≠")
    .replace(/\\infty/g, "∞")
    .replace(/\\varnothing|\\emptyset/g, "∅")
    .replace(/\\left|\\right|\\quad|\\qquad/g, " ")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/[{}]/g, "")
    .replace(/-/g, "−")
    .replace(/\s+/g, " ")
    .trim();
}

/** One piece of an "and" whose parts never meet: "x < 1". */
export interface NumberLinePart {
  /** plain text (no LaTeX) */
  label: string;
  latex?: string;
  segments: NumberLineSegment[];
}

export interface NumberLineExtras {
  /** an "and" whose parts never meet: drawn faint and dashed on the empty
   * line, so you can see they don't */
  parts?: NumberLinePart[];
}

/** a value as it's written — exact when it's a simple fraction (a drawing
 * saved before the engine sent exact values) */
function written(v: number): string {
  if (Number.isInteger(v)) return String(v);
  for (let q = 2; q <= 16; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v * q - p) < 1e-9) return `${p}/${q}`;
  }
  return String(Math.round(v * 100) / 100);
}

/** the line's ends and ticks: evenly spaced, in steps of 1, 2, 5, 10, 20… */
function layout(points: number[]) {
  const min = points.length ? Math.min(...points) : -5;
  const max = points.length ? Math.max(...points) : 5;
  const span = Math.max(max - min, 4);
  const raw = (span * 1.7) / 10; // about ten ticks across
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power);
  const lo = Math.floor((min - span * 0.35) / step) * step;
  const hi = Math.ceil((max + span * 0.35) / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { lo, hi, ticks };
}

/** The pieces as one solution set: overlapping or touching pieces joined
 * (a drawing saved before "or" was graphed as a set had a piece per part —
 * z < 4 or z ≥ −6 was two overlapping rays, with an open dot at 4). */
function union(segments: NumberLineSegment[]): NumberLineSegment[] {
  const lo = (s: NumberLineSegment) => s.lo ?? -Infinity;
  const hi = (s: NumberLineSegment) => s.hi ?? Infinity;
  const out: NumberLineSegment[] = [];
  for (const s of [...segments].sort((a, b) => lo(a) - lo(b) || Number(b.loClosed) - Number(a.loClosed))) {
    const last = out[out.length - 1];
    if (last && (lo(s) < hi(last) || (lo(s) === hi(last) && (last.hiClosed || s.loClosed)))) {
      if (lo(s) === lo(last)) last.loClosed ||= s.loClosed;
      if (hi(s) > hi(last)) Object.assign(last, { hi: s.hi, hiClosed: s.hiClosed, hiLabel: s.hiLabel });
      else if (hi(s) === hi(last)) last.hiClosed ||= s.hiClosed;
    } else out.push({ ...s });
  }
  return out;
}

/** each endpoint's value, once: where it is and how it's written */
function endpoints(segments: NumberLineSegment[]): { at: number; text: string }[] {
  const out = new Map<number, string>();
  for (const s of segments) {
    if (s.lo !== null && !out.has(s.lo)) out.set(s.lo, s.loLabel ?? written(s.lo));
    if (s.hi !== null && !out.has(s.hi)) out.set(s.hi, s.hiLabel ?? written(s.hi));
  }
  return [...out].map(([at, text]) => ({ at, text }));
}

const FONT = `font-family="-apple-system, Helvetica, sans-serif"`;
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FRACTION = /^(−?)(\d+)\/(\d+)$/;
const isFraction = (text: string) => FRACTION.test(text.replace(/-/g, "−"));

/** A value under the line, at x: a fraction stacked (4 over 3, its sign
 * beside it), anything else as written. */
function valueText(x: number, y: number, text: string, color: string, strong: boolean): string {
  const t = text.replace(/-/g, "−");
  const weight = strong ? ` font-weight="600"` : "";
  const m = t.match(FRACTION);
  if (!m) return `<text x="${x}" y="${y}" font-size="10" text-anchor="middle"${weight} style="fill:${color}" ${FONT}>${escapeXml(t)}</text>`;
  const [, sign, n, d] = m;
  const half = (Math.max(n.length, d.length) * 5.6) / 2 + 1;
  return (
    (sign ? `<text x="${x - half - 1}" y="${y + 4}" font-size="10" text-anchor="end"${weight} style="fill:${color}" ${FONT}>−</text>` : "") +
    `<text x="${x}" y="${y - 1}" font-size="9" text-anchor="middle"${weight} style="fill:${color}" ${FONT}>${n}</text>` +
    `<line x1="${x - half}" x2="${x + half}" y1="${y + 2}" y2="${y + 2}" style="stroke:${color}" stroke-width="1"/>` +
    `<text x="${x}" y="${y + 11}" font-size="9" text-anchor="middle"${weight} style="fill:${color}" ${FONT}>${d}</text>`
  );
}

/** The number line as SVG markup (only numbers and the engine's value
 * labels go in, escaped, so it's safe to inline). */
export function numberLineSvg(given: NumberLineSegment[], width = 300, palette: NumberLinePalette = APP_PALETTE, extras: NumberLineExtras = {}): string {
  const segments = union(given);
  const parts = extras.parts ?? [];
  const work = segments.length ? [] : parts.flatMap((p) => p.segments);
  const marked = endpoints([...segments, ...work]);
  const { lo, hi, ticks } = layout(marked.map((e) => e.at));
  const pad = 16;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (width - pad * 2);
  const empty = !segments.length;
  const y = empty ? 34 : 22; // room above for "no solution (∅)"
  const labelsAt = y + 18;
  const height = labelsAt + (marked.some((e) => isFraction(e.text)) ? 16 : 6);
  const { axis, label, shade, hole } = palette;
  const out: string[] = [];

  // the line: arrows at both ends (it goes on forever), ticks, their numbers
  out.push(
    `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" style="stroke:${axis}" stroke-width="1.5"/>`,
    `<polygon points="${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}" style="fill:${axis}"/>`,
    `<polygon points="2,${y} 9,${y - 4} 9,${y + 4}" style="fill:${axis}"/>`,
  );
  // about how wide a value is written (a fraction: its wider number)
  const wide = (text: string) => {
    const m = text.replace(/-/g, "−").match(FRACTION);
    return m ? Math.max(m[2].length, m[3].length) * 5.6 + (m[1] ? 7 : 0) : text.length * 6;
  };
  const crowded = (t: number) => marked.some((e) => Math.abs(sx(e.at) - sx(t)) < (wide(e.text) + wide(String(t))) / 2 + 3);
  for (const t of ticks) {
    out.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 5}" y2="${y + 5}" style="stroke:${axis}"/>`);
    // an endpoint's own value goes here instead (or a neighbor's is too close)
    if (!crowded(t)) out.push(`<text x="${sx(t)}" y="${labelsAt}" font-size="9" text-anchor="middle" style="fill:${label}" ${FONT}>${String(t).replace(/-/g, "−")}</text>`);
  }
  // each endpoint: a tick at its place (it may fall between) and its value
  for (const e of marked) {
    if (!ticks.includes(e.at)) out.push(`<line x1="${sx(e.at)}" x2="${sx(e.at)}" y1="${y - 5}" y2="${y + 5}" style="stroke:${axis}"/>`);
    out.push(valueText(sx(e.at), labelsAt, e.text, empty ? label : palette.value, !empty));
  }

  const ray = (left: boolean, color: string, size: number) =>
    left
      ? `<polygon points="1,${y} ${1 + size * 1.7},${y - size} ${1 + size * 1.7},${y + size}" style="fill:${color}"/>`
      : `<polygon points="${width - 1},${y} ${width - 1 - size * 1.7},${y - size} ${width - 1 - size * 1.7},${y + size}" style="fill:${color}"/>`;
  const dot = (v: number, closed: boolean, color: string, r: number) =>
    `<circle cx="${sx(v)}" cy="${y}" r="${r}" style="fill:${closed ? color : hole};stroke:${color}" stroke-width="2"/>`;
  const draw = (segs: NumberLineSegment[], color: string, faint: boolean) => {
    for (const s of segs) {
      if (s.lo !== null && s.lo === s.hi) continue; // a single value: just its dot
      const x1 = s.lo === null ? 6 : sx(s.lo);
      const x2 = s.hi === null ? width - 6 : sx(s.hi);
      out.push(`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" style="stroke:${color}" stroke-width="${faint ? 3 : 5}"${faint ? ` stroke-dasharray="6 4"` : ""}/>`);
      if (s.lo === null) out.push(ray(true, color, faint ? 4 : 6));
      if (s.hi === null) out.push(ray(false, color, faint ? 4 : 6));
    }
    // the circles on top (an open one stays open)
    for (const s of segs) {
      if (s.lo !== null && s.lo === s.hi) out.push(dot(s.lo, true, color, faint ? 4 : 5));
      else {
        if (s.lo !== null) out.push(dot(s.lo, s.loClosed, color, faint ? 4 : 5));
        if (s.hi !== null) out.push(dot(s.hi, s.hiClosed, color, faint ? 4 : 5));
      }
    }
  };
  draw(work, palette.work, true);
  draw(segments, shade, false);
  if (empty) out.push(`<text x="${width / 2}" y="13" font-size="11" text-anchor="middle" style="fill:${label}" ${FONT}>no solution (∅)</text>`);
  return `<svg class="number-line" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
}

/** a value as LaTeX: −14/5 → -\frac{14}{5}, √2 → \sqrt{2} */
function valueTex(text: string): string {
  return text
    .replace(/−/g, "-")
    .replace(/^(-?)(\d+)\/(\d+)$/, "$1\\frac{$2}{$3}")
    .replace(/√(\d+|\([^)]*\))/g, (_all, r: string) => `\\sqrt{${r.replace(/^\(|\)$/g, "")}}`);
}

/** The same picture for a LaTeX document (TikZ). */
export function numberLineTikz(given: NumberLineSegment[], extras: NumberLineExtras = {}): string {
  const segments = union(given);
  const parts = extras.parts ?? [];
  const work = segments.length ? [] : parts.flatMap((p) => p.segments);
  const marked = endpoints([...segments, ...work]);
  const { lo, hi, ticks } = layout(marked.map((e) => e.at));
  const scale = Math.min(1, 12 / (hi - lo)); // about 12 cm wide
  const hex = (c: string) => c.replace("#", "").toUpperCase();
  const out = [`\\begin{tikzpicture}[x=${scale.toFixed(3)}cm]`, `\\definecolor{nlShade}{HTML}{${hex(PRINT_PALETTE.shade)}}`];
  out.push(`\\draw[<->, gray] (${lo - 0.4},0) -- (${hi + 0.4},0);`);
  const crowded = (t: number) => marked.some((e) => Math.abs(e.at - t) * scale < 0.45);
  for (const t of ticks) out.push(`\\draw[gray] (${t},0.12) -- (${t},-0.12)${crowded(t) ? "" : ` node[below, font=\\scriptsize] {$${t}$}`};`);
  for (const e of marked) {
    const value = segments.length ? `\\boldsymbol{${valueTex(e.text)}}` : valueTex(e.text);
    out.push(`\\draw[gray] (${e.at},0.12) -- (${e.at},-0.12) node[below, font=\\scriptsize] {$${value}$};`);
  }
  const draw = (segs: NumberLineSegment[], color: string, faint: boolean) => {
    for (const s of segs) {
      if (s.lo !== null && s.lo === s.hi) continue;
      const arrows = s.lo === null && s.hi === null ? "<->" : s.lo === null ? "<-" : s.hi === null ? "->" : "-";
      out.push(`\\draw[line width=${faint ? "1.2pt, dashed" : "2.2pt"}, ${color}, ${arrows}] (${s.lo ?? lo - 0.4},0) -- (${s.hi ?? hi + 0.4},0);`);
    }
    // the circles after the shading (an open circle stays open)
    for (const s of segs) {
      const r = faint ? "2.4pt" : "3pt";
      const dot = (x: number, closed: boolean) => out.push(closed ? `\\fill[${color}] (${x},0) circle (${r});` : `\\draw[thick, ${color}, fill=white] (${x},0) circle (${r});`);
      if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
      else {
        if (s.lo !== null) dot(s.lo, s.loClosed);
        if (s.hi !== null) dot(s.hi, s.hiClosed);
      }
    }
  };
  draw(work, "gray!60", true);
  draw(segments, "nlShade", false);
  if (!segments.length) out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.25) {no solution ($\\varnothing$)};`);
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}
