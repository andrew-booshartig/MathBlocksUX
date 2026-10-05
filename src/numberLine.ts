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

/** The number line as SVG markup (numbers only go in, so it's safe to inline). */
export function numberLineSvg(segments: NumberLineSegment[], width = 300, palette: NumberLinePalette = APP_PALETTE): string {
  const { lo, hi, ticks } = layout(segments);
  const pad = 16;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (width - pad * 2);
  const lane = lanes(segments, 9);
  const spread = Math.max(0, ...lane.map(Math.abs));
  const y = 26 + spread; // the line itself
  const height = 48 + spread * 2;
  const { axis, label, shades, hole } = palette;
  const color = (i: number) => shades[i % shades.length];
  const parts: string[] = [
    `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="1.5"/>`,
    `<polygon points="${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}" fill="${axis}"/>`,
    `<polygon points="2,${y} 9,${y - 4} 9,${y + 4}" fill="${axis}"/>`,
  ];
  for (const t of ticks) {
    parts.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 4}" y2="${y + 4}" stroke="${axis}"/>`);
    parts.push(`<text x="${sx(t)}" y="${y + 16 + spread}" font-size="9" fill="${label}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif">${t}</text>`);
  }
  const xs = (s: NumberLineSegment) => [s.lo === null ? 4 : sx(s.lo), s.hi === null ? width - 4 : sx(s.hi)] as const;
  // the shading first, for every part (each in its own color and lane) —
  // then the dots on top, so a part never paints over an open circle
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const ly = y + lane[i];
    const c = color(i);
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${ly}" y2="${ly}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`);
    if (s.lo === null) parts.push(`<polygon points="2,${ly} 10,${ly - 5} 10,${ly + 5}" fill="${c}"/>`);
    if (s.hi === null) parts.push(`<polygon points="${width - 2},${ly} ${width - 10},${ly - 5} ${width - 10},${ly + 5}" fill="${c}"/>`);
  });
  segments.forEach((s, i) => {
    const [x1, x2] = xs(s);
    const ly = y + lane[i];
    const c = color(i);
    const dot = (x: number, closed: boolean) => `<circle cx="${x}" cy="${ly}" r="5" fill="${closed ? c : hole}" stroke="${c}" stroke-width="2"/>`;
    const tag = (x: number, v: number) =>
      `<text x="${x}" y="${y - 10 - spread}" font-size="10" fill="${c}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif">${fmt(v)}</text>`;
    if (s.lo !== null && s.lo === s.hi) parts.push(dot(x1, true));
    else {
      if (s.lo !== null) parts.push(dot(x1, s.loClosed));
      if (s.hi !== null) parts.push(dot(x2, s.hiClosed));
    }
    if (s.lo !== null) parts.push(tag(x1, s.lo));
    if (s.hi !== null && s.hi !== s.lo) parts.push(tag(x2, s.hi));
  });
  return `<svg class="number-line" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

/** The same number line for a LaTeX document (TikZ). */
export function numberLineTikz(segments: NumberLineSegment[]): string {
  const { lo, hi, ticks } = layout(segments);
  const scale = Math.min(1, 12 / (hi - lo)); // about 12 cm wide
  const out = [`\\begin{tikzpicture}[x=${scale.toFixed(3)}cm]`, `\\draw[<->, gray] (${lo - 0.4},0) -- (${hi + 0.4},0);`];
  for (const t of ticks) out.push(`\\draw[gray] (${t},0.12) -- (${t},-0.12) node[below, font=\\scriptsize] {$${t}$};`);
  const lane = lanes(segments, 0.18); // cm apart, when parts overlap
  const colors = ["magenta", "violet"];
  segments.forEach((s, i) => {
    const a = s.lo ?? lo - 0.4;
    const b = s.hi ?? hi + 0.4;
    const arrows = s.lo === null && s.hi === null ? "<->" : s.lo === null ? "<-" : s.hi === null ? "->" : "-";
    if (a !== b) out.push(`\\draw[very thick, ${colors[i % 2]}, ${arrows}] (${a},${lane[i]}) -- (${b},${lane[i]});`);
  });
  // dots after all the shading (an open circle stays open)
  segments.forEach((s, i) => {
    const c = colors[i % 2];
    const dot = (x: number, closed: boolean) =>
      out.push(closed ? `\\fill[${c}] (${x},${lane[i]}) circle (3pt);` : `\\draw[thick, ${c}, fill=white] (${x},${lane[i]}) circle (3pt);`);
    if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
    else {
      if (s.lo !== null) dot(s.lo, s.loClosed);
      if (s.hi !== null) dot(s.hi, s.hiClosed);
    }
  });
  out.push("\\end{tikzpicture}");
  return out.join("\n");
}
