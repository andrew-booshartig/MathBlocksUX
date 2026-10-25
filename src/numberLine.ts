/** A solution set drawn on a number line, the way it's drawn in class: open
 * or closed dots, shaded segments, arrows for rays. One drawing for the app
 * (dark), printed documents (light) and LaTeX (TikZ). */
import type { NumberLineSegment } from "./mathSidecar";

export interface NumberLinePalette {
  axis: string;
  label: string;
  /** one color per part of an "or" (pink, then violet — then round again) */
  shades: string[];
  /** the inside of an open dot */
  hole: string;
  /** how overlapping parts' shading mixes into a new color: lighter on a
   * dark page (screen), deeper on paper (multiply — like two highlighters) */
  blend: "screen" | "multiply";
}

export const APP_PALETTE: NumberLinePalette = { axis: "#55606e", label: "#8a8aa0", shades: ["#e07ce0", "#a78bfa"], hole: "#14141a", blend: "screen" };
export const PRINT_PALETTE: NumberLinePalette = { axis: "#6b7280", label: "#374151", shades: ["#a21caf", "#6d28d9"], hole: "#ffffff", blend: "multiply" };

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Is the combined answer just what was typed, written another way? (Then
 * there's nothing to add under the graph; z < 4 or z ≥ -6 → "together: all
 * real numbers" is worth saying.) */
export function sameWritten(a: string, b: string): boolean {
  const plain = (s: string) => s.replace(/\\text\{([^}]*)\}/g, "$1").replace(/\\(quad|qquad|,|;|:|!| )|\s/g, "");
  return plain(a) === plain(b);
}

/** the stretch of the line to show, and its tick marks */
function layout(segments: NumberLineSegment[]) {
  const ends = segments.flatMap((s) => [s.lo, s.hi]).filter((v): v is number => v !== null);
  let lo = ends.length ? Math.min(...ends) : -5;
  let hi = ends.length ? Math.max(...ends) : 5;
  const span = Math.max(hi - lo, 4);
  lo = Math.floor(lo - span * 0.35);
  hi = Math.ceil(hi + span * 0.35);
  const step = Math.max(1, Math.ceil((hi - lo) / 12));
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return { lo, hi, ticks };
}

/** One piece of an "and" — its own line in the picture: "3y + 7 < 2y". */
export interface NumberLinePart {
  /** plain text (no LaTeX) — it's drawn inside the picture */
  label: string;
  latex?: string;
  segments: NumberLineSegment[];
}

export interface NumberLineExtras {
  /** an "and" whose parts never meet: they're drawn (both on the one line,
   * each in its own color), with "no solution (∅)" — as in class */
  parts?: NumberLinePart[];
  /** the answer, as plain text, for the answer line's label */
  answer?: string;
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

const FONT = `font-family="-apple-system, Helvetica, sans-serif"`;

/** One number line at height y: the axis, its ticks (numbered or not), and
 * the shading with its dots — everything a single line needs. */
function drawLine(
  out: string[],
  segments: NumberLineSegment[],
  o: { y: number; width: number; sx: (v: number) => number; ticks: number[]; palette: NumberLinePalette; numbers?: number; tagsAt?: number; color?: (i: number) => string },
) {
  const { y, width, sx, ticks, palette } = o;
  const { axis, label, hole } = palette;
  const color = o.color ?? ((i: number) => palette.shades[i % palette.shades.length]);
  const group: string[] = [
    `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="1.5"/>`,
    `<polygon points="${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}" fill="${axis}"/>`,
    `<polygon points="2,${y} 9,${y - 4} 9,${y + 4}" fill="${axis}"/>`,
  ];
  for (const t of ticks) {
    group.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 4}" y2="${y + 4}" stroke="${axis}"/>`);
    if (o.numbers !== undefined) group.push(`<text x="${sx(t)}" y="${o.numbers}" font-size="9" fill="${label}" text-anchor="middle" ${FONT}>${t}</text>`);
  }
  const xs = (s: NumberLineSegment) => [s.lo === null ? 4 : sx(s.lo), s.hi === null ? width - 4 : sx(s.hi)] as const;
  // the shading first, every part on the one line, soft and see-through —
  // where parts overlap their colors mix into a new one. Then the dots on
  // top, solid, so one part never hides another's open circle.
  const soft = `opacity="0.72" style="mix-blend-mode:${palette.blend}"`;
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const c = color(i);
    const band: string[] = [`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`];
    if (s.lo === null) band.push(`<polygon points="1,${y} 11,${y - 6} 11,${y + 6}" fill="${c}"/>`);
    if (s.hi === null) band.push(`<polygon points="${width - 1},${y} ${width - 11},${y - 6} ${width - 11},${y + 6}" fill="${c}"/>`);
    group.push(`<g ${soft}>${band.join("")}</g>`);
  });
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const c = color(i);
    const dot = (x: number, closed: boolean) => `<circle cx="${x}" cy="${y}" r="5" fill="${closed ? c : hole}" stroke="${c}" stroke-width="2"/>`;
    const tag = (x: number, v: number) => `<text x="${x}" y="${o.tagsAt ?? y - 10}" font-size="10" fill="${c}" text-anchor="middle" ${FONT}>${fmt(v)}</text>`;
    if (s.lo !== null && s.lo === s.hi) group.push(dot(x1, true));
    else {
      if (s.lo !== null) group.push(dot(x1, s.loClosed));
      if (s.hi !== null) group.push(dot(x2, s.hiClosed));
    }
    if (s.lo !== null) group.push(tag(x1, s.lo));
    if (s.hi !== null && s.hi !== s.lo) group.push(tag(x2, s.hi));
  });
  out.push(group.join(""));
}

const svg = (width: number, height: number, body: string[]) =>
  `<svg class="number-line" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body.join("")}</svg>`;

/** The number line as SVG markup (only numbers go in, so it's safe to
 * inline). No solution is the line with nothing shaded,
 * labeled ∅ — or, for an "and" whose parts never meet (x < 3 and x > 6),
 * both parts on it in their own colors, so you can see they don't. */
export function numberLineSvg(segments: NumberLineSegment[], width = 300, palette: NumberLinePalette = APP_PALETTE, extras: NumberLineExtras = {}): string {
  const parts = extras.parts ?? [];
  const { lo, hi, ticks } = layout([...segments, ...parts.flatMap((p) => p.segments)]);
  const pad = 16;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (width - pad * 2);
  const out: string[] = [];
  const none = `no solution (∅)`;

  if (parts.length && !segments.length) {
    const drawn = parts.flatMap((p) => p.segments);
    const owner = parts.flatMap((p, i) => p.segments.map(() => i));
    const y = 40;
    out.push(`<text x="${width / 2}" y="13" font-size="11" fill="${palette.label}" text-anchor="middle" ${FONT}>${none}</text>`);
    drawLine(out, drawn, { y, width, sx, ticks, palette, numbers: y + 16, tagsAt: y - 10, color: (i) => palette.shades[owner[i] % palette.shades.length] });
    return svg(width, y + 22, out);
  }

  if (!segments.length) {
    // no solution: the line, with nothing on it
    drawLine(out, [], { y: 30, width, sx, ticks, palette, numbers: 46 });
    out.push(`<text x="${width / 2}" y="14" font-size="11" fill="${palette.label}" text-anchor="middle" ${FONT}>${none}</text>`);
    return svg(width, 54, out);
  }

  const y = 26;
  drawLine(out, segments, { y, width, sx, ticks, palette, numbers: y + 16, tagsAt: y - 10 });
  return svg(width, 48, out);
}

/** The same picture for a LaTeX document (TikZ). */
export function numberLineTikz(segments: NumberLineSegment[], extras: NumberLineExtras = {}): string {
  const parts = extras.parts ?? [];
  const { lo, hi, ticks } = layout([...segments, ...parts.flatMap((p) => p.segments)]);
  const scale = Math.min(1, 12 / (hi - lo)); // about 12 cm wide
  const out = [`\\begin{tikzpicture}[x=${scale.toFixed(3)}cm]`];
  const colors = ["magenta", "violet"];
  const line = (segs: NumberLineSegment[], y: number, color: (i: number) => string, numbers: boolean) => {
    out.push(`\\draw[<->, gray] (${lo - 0.4},${y}) -- (${hi + 0.4},${y});`);
    for (const t of ticks) out.push(`\\draw[gray] (${t},${y + 0.12}) -- (${t},${y - 0.12})${numbers ? ` node[below, font=\\scriptsize] {$${t}$}` : ""};`);
    segs.forEach((s, i) => {
      const a = s.lo ?? lo - 0.4;
      const b = s.hi ?? hi + 0.4;
      const arrows = s.lo === null && s.hi === null ? "<->" : s.lo === null ? "<-" : s.hi === null ? "->" : "-";
      if (a !== b) out.push(`\\draw[line width=2.2pt, ${color(i)}, draw opacity=0.6, ${arrows}] (${a},${y}) -- (${b},${y});`);
    });
    // dots after all the shading (an open circle stays open)
    segs.forEach((s, i) => {
      const c = color(i);
      const dot = (x: number, closed: boolean) =>
        out.push(closed ? `\\fill[${c}] (${x},${y}) circle (3pt);` : `\\draw[thick, ${c}, fill=white] (${x},${y}) circle (3pt);`);
      if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
      else {
        if (s.lo !== null) dot(s.lo, s.loClosed);
        if (s.hi !== null) dot(s.hi, s.hiClosed);
      }
    });
  };
  if (parts.length && !segments.length) {
    // the parts on the one line, each in its color — and no solution
    const drawn = parts.flatMap((p) => p.segments);
    const owner = parts.flatMap((p, i) => p.segments.map(() => i));
    line(drawn, 0, (i) => colors[owner[i] % 2], true);
    out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.3) {no solution ($\\varnothing$)};`);
  } else {
    line(segments, 0, (i) => colors[i % 2], true);
    if (!segments.length) out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.2) {no solution ($\\varnothing$)};`);
  }
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}
