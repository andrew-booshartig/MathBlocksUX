/** A solution set drawn on a number line, the way it's drawn in class: open
 * or closed dots, shaded segments, arrows for rays. One drawing for the app
 * (dark), printed documents (light) and LaTeX (TikZ). */
import type { NumberLineSegment } from "./mathSidecar";

// ---- the overlap's color: the two parts' colors mixed, as paint (or two
// sheets of colored glass) would — a hue between theirs, so it reads as
// "both" at a glance. Mixed in OKLCH (perceptual: the halfway hue really
// looks halfway), keeping the stronger color's saturation so it doesn't
// go muddy.

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToHex([L, C, H]: [number, number, number]): string {
  // out of the screen's range: ease the saturation down until it fits
  for (let c = C; c >= 0; c -= 0.005) {
    const A = c * Math.cos(H), B = c * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("");
    }
  }
  return "#808080";
}

/** The color halfway between two (OKLCH, the shorter way round the hue
 * circle), as saturated as the stronger of them. */
export function mixColors(a: string, b: string): string {
  const [L1, C1, H1] = hexToOklch(a);
  const [L2, C2, H2] = hexToOklch(b);
  let dH = H2 - H1;
  if (dH > Math.PI) dH -= 2 * Math.PI;
  if (dH < -Math.PI) dH += 2 * Math.PI;
  return oklchToHex([(L1 + L2) / 2, Math.max(C1, C2), H1 + dH / 2]);
}

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

/** the app's: a theme sets these (the calculator app's themes), and the
 * canvas app falls back to the muted defaults */
export const APP_PALETTE: NumberLinePalette = {
  axis: "var(--nl-axis, #4b5260)",
  label: "var(--nl-label, #8b90a0)",
  tag: "var(--nl-tag, #c3c7d2)",
  shades: ["var(--nl-a, #e06c75)", "var(--nl-b, #61afef)"], // One Dark's red and blue
  both: `var(--nl-both, ${mixColors("#e06c75", "#61afef")})`, // the two, mixed: purple
  hole: "var(--nl-hole, #17171f)",
};
export const PRINT_PALETTE: NumberLinePalette = {
  axis: "#6b7280",
  label: "#374151",
  tag: "#1f2937",
  shades: ["#c0392b", "#2c6fbb"], // brick red, slate blue (for paper)
  both: mixColors("#c0392b", "#2c6fbb"), // the two, mixed: purple
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
    `<line x1="4" x2="${width - 4}" y1="${y}" y2="${y}" style="stroke:${axis}" stroke-width="1.5"/>`,
    `<polygon points="${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}" style="fill:${axis}"/>`,
    `<polygon points="2,${y} 9,${y - 4} 9,${y + 4}" style="fill:${axis}"/>`,
  ];
  for (const t of ticks) {
    group.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${y - 5}" y2="${y + 5}" style="stroke:${axis}"/>`);
    if (o.numbers !== undefined) group.push(`<text x="${sx(t)}" y="${o.numbers}" font-size="9" style="fill:${label}" text-anchor="middle" ${FONT}>${t}</text>`);
  }
  // the shading: each stretch one flat color — a part's, or the overlap's
  for (const { a, b, parts } of stretches(segments, part)) {
    const c = parts.size > 1 ? palette.both : shade([...parts][0]);
    const x1 = a === -Infinity ? 6 : sx(a);
    const x2 = b === Infinity ? width - 6 : sx(b);
    group.push(`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" style="stroke:${c}" stroke-width="5"/>`);
    if (a === -Infinity) group.push(`<polygon points="1,${y} 11,${y - 6} 11,${y + 6}" style="fill:${c}"/>`);
    if (b === Infinity) group.push(`<polygon points="${width - 1},${y} ${width - 11},${y - 6} ${width - 11},${y + 6}" style="fill:${c}"/>`);
  }
  // then the dots, solid, on top — each in its part's color
  const tags = new Set<number>();
  segments.forEach((s, i) => {
    const c = shade(part(i));
    const dot = (v: number, closed: boolean) => {
      group.push(`<circle cx="${sx(v)}" cy="${y}" r="5" style="fill:${closed ? c : hole};stroke:${c}" stroke-width="2"/>`);
      tags.add(v);
    };
    if (s.lo !== null && s.lo === s.hi) dot(s.lo, true);
    else {
      if (s.lo !== null) dot(s.lo, s.loClosed);
      if (s.hi !== null) dot(s.hi, s.hiClosed);
    }
  });
  for (const v of tags) group.push(`<text x="${sx(v)}" y="${o.tagsAt ?? y - 10}" font-size="10" style="fill:${palette.tag}" text-anchor="middle" ${FONT}>${fmt(v)}</text>`);
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
    out.push(`<text x="${width / 2}" y="13" font-size="11" style="fill:${palette.label}" text-anchor="middle" ${FONT}>${none}</text>`);
    drawLine(out, drawn, { y, width, sx, ticks, palette, numbers: y + 16, tagsAt: y - 10, part: (i) => owner[i] });
    return svg(width, y + 22, out);
  }

  if (!segments.length) {
    // no solution: the line, with nothing on it
    drawLine(out, [], { y: 30, width, sx, ticks, palette, numbers: 46 });
    out.push(`<text x="${width / 2}" y="14" font-size="11" style="fill:${palette.label}" text-anchor="middle" ${FONT}>${none}</text>`);
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
