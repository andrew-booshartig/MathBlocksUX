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
}

export const APP_PALETTE: NumberLinePalette = { axis: "#55606e", label: "#8a8aa0", shades: ["#e07ce0", "#a78bfa"], hole: "#14141a" };
export const PRINT_PALETTE: NumberLinePalette = { axis: "#6b7280", label: "#374151", shades: ["#a21caf", "#6d28d9"], hole: "#ffffff" };

/** Each part's lane, as an offset from the line: on the line — unless parts
 * overlap (or touch), then each gets its own lane a little apart, so one
 * never hides the other (z < 4 or z ≥ -6: two rays, one above the other). */
function lanes(segments: NumberLineSegment[], gap: number): number[] {
  const lo = (s: NumberLineSegment) => s.lo ?? -Infinity;
  const hi = (s: NumberLineSegment) => s.hi ?? Infinity;
  const meet = (a: NumberLineSegment, b: NumberLineSegment) => Math.max(lo(a), lo(b)) <= Math.min(hi(a), hi(b));
  const stacked = segments.some((a, i) => segments.some((b, j) => i < j && meet(a, b)));
  return segments.map((_, i) => (stacked ? (i - (segments.length - 1) / 2) * gap : 0));
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
  /** an "and", the way it's done on paper: each part on its own faint line
   * above the answer's (which shows where they overlap — or nothing) */
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
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One number line at height y: the axis, its ticks (numbered or not), and
 * the shading with its dots — everything a single line needs. */
function drawLine(
  out: string[],
  segments: NumberLineSegment[],
  o: { y: number; width: number; sx: (v: number) => number; ticks: number[]; palette: NumberLinePalette; lane?: number[]; numbers?: number; tagsAt?: number; color?: (i: number) => string; opacity?: number },
) {
  const { y, width, sx, ticks, palette } = o;
  const { axis, label, hole } = palette;
  const color = o.color ?? ((i: number) => palette.shades[i % palette.shades.length]);
  const lane = o.lane ?? segments.map(() => 0);
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
  // the shading first, for every part — then the dots on top, so one part
  // never paints over another's open circle
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const ly = y + lane[i];
    const c = color(i);
    group.push(`<line x1="${x1}" x2="${x2}" y1="${ly}" y2="${ly}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`);
    if (s.lo === null) group.push(`<polygon points="2,${ly} 10,${ly - 5} 10,${ly + 5}" fill="${c}"/>`);
    if (s.hi === null) group.push(`<polygon points="${width - 2},${ly} ${width - 10},${ly - 5} ${width - 10},${ly + 5}" fill="${c}"/>`);
  });
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const ly = y + lane[i];
    const c = color(i);
    const dot = (x: number, closed: boolean) => `<circle cx="${x}" cy="${ly}" r="5" fill="${closed ? c : hole}" stroke="${c}" stroke-width="2"/>`;
    const tag = (x: number, v: number) => `<text x="${x}" y="${o.tagsAt ?? y - 10}" font-size="10" fill="${c}" text-anchor="middle" ${FONT}>${fmt(v)}</text>`;
    if (s.lo !== null && s.lo === s.hi) group.push(dot(x1, true));
    else {
      if (s.lo !== null) group.push(dot(x1, s.loClosed));
      if (s.hi !== null) group.push(dot(x2, s.hiClosed));
    }
    if (s.lo !== null) group.push(tag(x1, s.lo));
    if (s.hi !== null && s.hi !== s.lo) group.push(tag(x2, s.hi));
  });
  out.push(o.opacity !== undefined ? `<g opacity="${o.opacity}">${group.join("")}</g>` : group.join(""));
}

const svg = (width: number, height: number, body: string[]) =>
  `<svg class="number-line" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body.join("")}</svg>`;

/** The number line as SVG markup (only numbers and escaped labels go in, so
 * it's safe to inline). With `parts` (an "and"), it's drawn like a college
 * paper: each part on its own faint line, then the answer's line below on
 * the same scale — dotted guides drop from the parts' ends, and when the
 * parts don't meet the answer line is left empty: ∅, no solution. */
export function numberLineSvg(segments: NumberLineSegment[], width = 300, palette: NumberLinePalette = APP_PALETTE, extras: NumberLineExtras = {}): string {
  const parts = extras.parts ?? [];
  const { lo, hi, ticks } = layout([...segments, ...parts.flatMap((p) => p.segments)]);
  const pad = 16;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (width - pad * 2);
  const out: string[] = [];
  const none = `no solution (∅)`;

  if (parts.length) {
    const ROW = 44; // a part's line: its label, the line, its numbers under it
    const answerTop = parts.length * ROW;
    const answerY = answerTop + 42; // its caption, then its numbers, then the line
    // where each part ends, down to the answer's line (do they meet?)
    const ends = new Set(parts.flatMap((p) => p.segments.flatMap((s) => [s.lo, s.hi])).filter((v): v is number => v !== null));
    for (const v of ends) out.push(`<line x1="${sx(v)}" x2="${sx(v)}" y1="${24}" y2="${answerY}" stroke="${palette.label}" stroke-width="1" stroke-dasharray="2 3" opacity="0.45"/>`);
    parts.forEach((part, i) => {
      const top = i * ROW;
      const c = palette.shades[i % palette.shades.length];
      out.push(`<text x="6" y="${top + 11}" font-size="10.5" fill="${c}" opacity="0.85" ${FONT}>${esc(part.label)}</text>`);
      drawLine(out, part.segments, { y: top + 24, width, sx, ticks, palette, tagsAt: top + 40, color: () => c, opacity: 0.5 });
    });
    const caption = segments.length ? `${extras.answer ? `both at once: ${extras.answer}` : "both at once"}` : `both at once: ${none}`;
    out.push(`<text x="6" y="${answerTop + 13}" font-size="10.5" font-weight="600" fill="${palette.label}" ${FONT}>${esc(caption)}</text>`);
    drawLine(out, segments, { y: answerY, width, sx, ticks, palette, numbers: answerY + 16, tagsAt: answerY - 10, color: () => palette.shades[0] });
    return svg(width, answerY + 22, out);
  }

  if (!segments.length) {
    // no solution: the line, with nothing on it
    drawLine(out, [], { y: 30, width, sx, ticks, palette, numbers: 46 });
    out.push(`<text x="${width / 2}" y="14" font-size="11" fill="${palette.label}" text-anchor="middle" ${FONT}>${none}</text>`);
    return svg(width, 54, out);
  }

  const lane = lanes(segments, 9);
  const spread = Math.max(0, ...lane.map(Math.abs));
  const y = 26 + spread;
  drawLine(out, segments, { y, width, sx, ticks, palette, lane, numbers: y + 16 + spread, tagsAt: y - 10 - spread });
  return svg(width, 48 + spread * 2, out);
}

/** The same picture for a LaTeX document (TikZ). */
export function numberLineTikz(segments: NumberLineSegment[], extras: NumberLineExtras = {}): string {
  const parts = extras.parts ?? [];
  const { lo, hi, ticks } = layout([...segments, ...parts.flatMap((p) => p.segments)]);
  const scale = Math.min(1, 12 / (hi - lo)); // about 12 cm wide
  const out = [`\\begin{tikzpicture}[x=${scale.toFixed(3)}cm]`];
  const colors = ["magenta", "violet"];
  const line = (segs: NumberLineSegment[], y: number, color: (i: number) => string, lane: number[], numbers: boolean) => {
    out.push(`\\draw[<->, gray] (${lo - 0.4},${y}) -- (${hi + 0.4},${y});`);
    for (const t of ticks) out.push(`\\draw[gray] (${t},${y + 0.12}) -- (${t},${y - 0.12})${numbers ? ` node[below, font=\\scriptsize] {$${t}$}` : ""};`);
    segs.forEach((s, i) => {
      const a = s.lo ?? lo - 0.4;
      const b = s.hi ?? hi + 0.4;
      const arrows = s.lo === null && s.hi === null ? "<->" : s.lo === null ? "<-" : s.hi === null ? "->" : "-";
      if (a !== b) out.push(`\\draw[very thick, ${color(i)}, ${arrows}] (${a},${y + lane[i]}) -- (${b},${y + lane[i]});`);
    });
    // dots after all the shading (an open circle stays open)
    segs.forEach((s, i) => {
      const c = color(i);
      const dot = (x: number, closed: boolean) =>
        out.push(closed ? `\\fill[${c}] (${x},${y + lane[i]}) circle (3pt);` : `\\draw[thick, ${c}, fill=white] (${x},${y + lane[i]}) circle (3pt);`);
      if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
      else {
        if (s.lo !== null) dot(s.lo, s.loClosed);
        if (s.hi !== null) dot(s.hi, s.hiClosed);
      }
    });
  };
  if (parts.length) {
    // each part faint on its own line, then the answer's line (∅ if they don't meet)
    parts.forEach((part, i) => {
      const y = (parts.length - i) * 0.9;
      out.push(`\\begin{scope}[opacity=0.5]`);
      line(part.segments, y, () => colors[i % 2], part.segments.map(() => 0), false);
      out.push(`\\end{scope}`);
      out.push(`\\node[anchor=south west, font=\\scriptsize, ${colors[i % 2]}] at (${lo - 0.4},${y + 0.1}) {$${part.latex ?? part.label}$};`);
    });
    line(segments, 0, () => colors[0], segments.map(() => 0), true);
    if (!segments.length) out.push(`\\node[anchor=west, font=\\small] at (${hi + 0.6},0) {$\\varnothing$ (no solution)};`);
  } else {
    line(segments, 0, (i) => colors[i % 2], lanes(segments, 0.18), true);
    if (!segments.length) out.push(`\\node[above, font=\\small] at (${(lo + hi) / 2},0.2) {no solution ($\\varnothing$)};`);
  }
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}
