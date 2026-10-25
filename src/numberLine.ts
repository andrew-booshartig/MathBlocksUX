/** A solution set drawn on a number line, the way it's drawn in class: open
 * or closed dots, shaded segments, arrows for rays. One drawing for the app
 * (dark), printed documents (light) and LaTeX (TikZ). */
import type { NumberLineSegment } from "./mathSidecar";

/** Flat, muted colors — easy on the eyes (bright, saturated color on a dark
 * page halos for people with astigmatism): one per part, and a clearly
 * different one where parts overlap. */
export interface NumberLinePalette {
  axis: string;
  /** the scale's numbers */
  label: string;
  /** the numbers at the dots */
  tag: string;
  /** one color per part (round again after these) */
  shades: string[];
  /** where parts overlap */
  both: string;
  /** the inside of an open dot (the page) */
  hole: string;
}

export const APP_PALETTE: NumberLinePalette = {
  axis: "#4b5260",
  label: "#8b90a0",
  tag: "#c3c7d2",
  shades: ["#c99bbf", "#94a8d8"], // dusty rose, soft periwinkle
  both: "#8fc4ae", // soft sage
  hole: "#17171f",
};
export const PRINT_PALETTE: NumberLinePalette = {
  axis: "#6b7280",
  label: "#374151",
  tag: "#1f2937",
  shades: ["#9b5c8f", "#4d6aa8"], // plum, slate blue
  both: "#3f8a70", // deep sage
  hole: "#ffffff",
};

/** The line cut where any part starts or stops: each stretch, and which
 * parts cover it (so it's drawn in one flat color — a part's, or the
 * overlap's). Single points are only dots. */
function stretches(segments: NumberLineSegment[], part: (i: number) => number) {
  const stops = [...new Set(segments.flatMap((s) => [s.lo, s.hi]).filter((v): v is number => v !== null))].sort((a, b) => a - b);
  const edges = [-Infinity, ...stops, Infinity];
  const out: { a: number; b: number; parts: Set<number> }[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = edges[k];
    const b = edges[k + 1];
    const mid = a === -Infinity ? (b === Infinity ? 0 : b - 1) : b === Infinity ? a + 1 : (a + b) / 2;
    const parts = new Set(segments.flatMap((s, i) => ((s.lo ?? -Infinity) < mid && mid < (s.hi ?? Infinity) ? [part(i)] : [])));
    if (parts.size) out.push({ a, b, parts });
  }
  return out;
}

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
  o: { y: number; width: number; sx: (v: number) => number; ticks: number[]; palette: NumberLinePalette; numbers?: number; tagsAt?: number; part?: (i: number) => number },
) {
  const { y, width, sx, ticks, palette } = o;
  const { axis, label, hole } = palette;
  const part = o.part ?? ((i: number) => i);
  const shade = (p: number) => palette.shades[p % palette.shades.length];
  const group: string[] = [
    `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="1.5"/>`,
    `<polygon points="${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}" fill="${axis}"/>`,
    `<polygon points="2,${y} 9,${y - 4} 9,${y + 4}" fill="${axis}"/>`,
  ];
  for (const t of ticks) {
    group.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 5}" y2="${y + 5}" stroke="${axis}"/>`);
    if (o.numbers !== undefined) group.push(`<text x="${sx(t)}" y="${o.numbers}" font-size="9" fill="${label}" text-anchor="middle" ${FONT}>${t}</text>`);
  }
  // the shading: each stretch one flat color — a part's, or the overlap's
  for (const { a, b, parts } of stretches(segments, part)) {
    const c = parts.size > 1 ? palette.both : shade([...parts][0]);
    const x1 = a === -Infinity ? 6 : sx(a);
    const x2 = b === Infinity ? width - 6 : sx(b);
    group.push(`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="5"/>`);
    if (a === -Infinity) group.push(`<polygon points="1,${y} 11,${y - 6} 11,${y + 6}" fill="${c}"/>`);
    if (b === Infinity) group.push(`<polygon points="${width - 1},${y} ${width - 11},${y - 6} ${width - 11},${y + 6}" fill="${c}"/>`);
  }
  // then the dots, solid, on top — each in its part's color
  const tags = new Set<number>();
  segments.forEach((s, i) => {
    const c = shade(part(i));
    const dot = (v: number, closed: boolean) => {
      group.push(`<circle cx="${sx(v)}" cy="${y}" r="5" fill="${closed ? c : hole}" stroke="${c}" stroke-width="2"/>`);
      tags.add(v);
    };
    if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
    else {
      if (s.lo !== null) dot(s.lo, s.loClosed);
      if (s.hi !== null) dot(s.hi, s.hiClosed);
    }
  });
  for (const v of tags) group.push(`<text x="${sx(v)}" y="${o.tagsAt ?? y - 10}" font-size="10" fill="${palette.tag}" text-anchor="middle" ${FONT}>${fmt(v)}</text>`);
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
    drawLine(out, drawn, { y, width, sx, ticks, palette, numbers: y + 16, tagsAt: y - 10, part: (i) => owner[i] });
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
  // the print palette's colors (xcolor), so paper matches the app's scheme
  const hex = (c: string) => c.replace("#", "").toUpperCase();
  out.push(
    `\\definecolor{nlA}{HTML}{${hex(PRINT_PALETTE.shades[0])}}\\definecolor{nlB}{HTML}{${hex(PRINT_PALETTE.shades[1])}}\\definecolor{nlBoth}{HTML}{${hex(PRINT_PALETTE.both)}}`,
  );
  const named = (p: number) => (p % 2 === 0 ? "nlA" : "nlB");
  const line = (segs: NumberLineSegment[], y: number, part: (i: number) => number, numbers: boolean) => {
    out.push(`\\draw[<->, gray] (${lo - 0.4},${y}) -- (${hi + 0.4},${y});`);
    for (const t of ticks) out.push(`\\draw[gray] (${t},${y + 0.12}) -- (${t},${y - 0.12})${numbers ? ` node[below, font=\\scriptsize] {$${t}$}` : ""};`);
    for (const { a, b, parts } of stretches(segs, part)) {
      const c = parts.size > 1 ? "nlBoth" : named([...parts][0]);
      const arrows = a === -Infinity && b === Infinity ? "<->" : a === -Infinity ? "<-" : b === Infinity ? "->" : "-";
      out.push(`\\draw[line width=2.2pt, ${c}, ${arrows}] (${a === -Infinity ? lo - 0.4 : a},${y}) -- (${b === Infinity ? hi + 0.4 : b},${y});`);
    }
    // dots after all the shading (an open circle stays open)
    segs.forEach((s, i) => {
      const c = named(part(i));
      const dot = (x: number, closed: boolean) => out.push(closed ? `\\fill[${c}] (${x},${y}) circle (3pt);` : `\\draw[thick, ${c}, fill=white] (${x},${y}) circle (3pt);`);
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
    line(drawn, 0, (i) => owner[i], true);
    out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.3) {no solution ($\\varnothing$)};`);
  } else {
    line(segments, 0, (i) => i, true);
    if (!segments.length) out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.2) {no solution ($\\varnothing$)};`);
  }
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}
