/** A circuit drawn: its wires (in their colors), the dots where they join,
 * its parts and their names and values, notes — and, worked out, what each
 * part's doing (its volts and amps beside it, a lamp lit). The editor draws
 * it with what's picked and what's pointed at; a notebook's page and its
 * printout draw it plain. */
import type { ReactNode } from "react";
import type { Circuit, Part, Wire } from "./format";
import { G, type Pt, boxOf, kindOf, runsAcross, termsOf } from "./kinds";
import type { Nets } from "./nets";
import { type Solution, cabs } from "./solve";
import { PartSymbol, type SymbolState } from "./Symbol";
import { fmt } from "./values";

/** a wire's color on the page (black and white keep an edge, to be seen on any paper) */
export const WIRE_INK: Record<string, { ink: string; edge?: string }> = {
  black: { ink: "#232323", edge: "var(--cs-wire-edge, #8a8f98)" },
  white: { ink: "#f7f7f5", edge: "#8a8f98" },
  red: { ink: "#e5484d" },
  blue: { ink: "#3b82f6" },
  green: { ink: "#2f9e44" },
  bare: { ink: "#c27c4a" },
  yellow: { ink: "#e5b80b" },
  orange: { ink: "#f08c2b" },
};

export const wirePath = (w: Pick<Wire, "pts">) => w.pts.map(([x, y], i) => `${i ? "L" : "M"}${x * G} ${y * G}`).join("");

export interface DrawOptions {
  /** being edited: terminals nothing's joined to are shown */
  edit?: boolean;
  /** picked: parts, wires, notes by id */
  picked?: Set<string>;
  /** pointed at */
  hover?: string | null;
  sol?: Solution | null;
  /** what each part's doing, beside it */
  values?: boolean;
  /** running: lamps lit, switches as they're set */
  live?: boolean;
  /** push buttons held down */
  pressed?: Set<string>;
  /** a part being put down, under the pointer */
  ghost?: Part | null;
  /** a part's value being typed (its label hidden meanwhile) */
  typing?: string | null;
  /** a note being typed */
  typingNote?: string | null;
}

/** the lines beside a part: its name, its value, what it's doing */
export function labelLines(p: Part, sol: Solution | null | undefined, values: boolean): { text: string; cls: string }[] {
  const k = kindOf(p.kind);
  if (!k || k.role === "GND" || k.role === "LABEL") return [];
  const lines: { text: string; cls: string }[] = [];
  if (k.name !== "hide" && k.name !== "inside") lines.push({ text: p.name, cls: "cs-name" });
  if (p.value.trim() && !(k.role === "LED" && !/\d/.test(p.value))) lines.push({ text: p.value, cls: k.name === "hide" ? "cs-name" : "cs-value" });
  const r = sol?.parts.get(p.id);
  if (r && values) {
    const ac = sol!.ac;
    const v = ac ? cabs(r.v) : Math.abs(r.v.re);
    const i = ac ? cabs(r.i) : Math.abs(r.i.re);
    let out = "";
    switch (k.role) {
      case "VM":
      case "AM":
        out = r.reading ?? "";
        break;
      case "V":
      case "VAC":
      case "I":
      case "PANEL":
        out = fmt(i, "A");
        break;
      case "SW":
      case "SPDT":
      case "DPDT":
      case "PB_NO":
      case "PB_NC":
      case "NO":
      case "NC":
        out = "";
        break;
      case "FUSE":
      case "CB":
        out = r.trouble ?? (i > 1e-6 ? fmt(i, "A") : "");
        break;
      case "XFMR":
        out = r.second ? `${fmt(ac ? cabs(r.second.v) : r.second.v.re, "V")} out` : "";
        break;
      default:
        out = `${fmt(v, "V")} · ${fmt(i, "A")}`;
    }
    if (r.trouble === "shorted") out = "shorted!";
    if (out) lines.push({ text: out, cls: r.trouble ? "cs-reading is-trouble" : k.role === "VM" || k.role === "AM" ? "cs-reading is-meter" : "cs-reading" });
  }
  return lines;
}

/** where a part's lines go: over it when it runs across, beside it when it stands up */
export function labelSpot(p: Part, count: number): { x: number; y: number; anchor: "middle" | "start"; step: number } {
  const [x0, y0, x1, y1] = boxOf(p).map((n) => n * G);
  const step = 13;
  if (runsAcross(p)) return { x: (x0 + x1) / 2, y: y0 - 6 - (count - 1) * step, anchor: "middle", step };
  return { x: x1 + 7, y: (y0 + y1) / 2 - ((count - 1) * step) / 2 + 1, anchor: "start", step };
}

export function PartView({ p, st, lines, picked, hover, ghost }: { p: Part; st: SymbolState; lines: { text: string; cls: string }[]; picked?: boolean; hover?: boolean; ghost?: boolean }) {
  const [x0, y0, x1, y1] = boxOf(p).map((n) => n * G);
  const spot = labelSpot(p, lines.length);
  return (
    <g className={`cs-part is-${p.kind}${picked ? " is-picked" : ""}${hover ? " is-hover" : ""}${ghost ? " is-ghost" : ""}`} data-part={p.id}>
      {(picked || hover) && <rect className="cs-halo" x={x0 - 5} y={y0 - 5} width={x1 - x0 + 10} height={y1 - y0 + 10} rx={6} />}
      <g transform={`translate(${p.x * G} ${p.y * G})${p.rot ? ` rotate(${p.rot})` : ""}${p.flip ? " scale(-1 1)" : ""}`}>
        <PartSymbol part={p} st={st} />
      </g>
      {lines.map((l, i) => (
        <text key={i} className={`cs-label ${l.cls}`} x={spot.x} y={spot.y + i * spot.step} textAnchor={spot.anchor} dominantBaseline="central">
          {l.text}
        </text>
      ))}
    </g>
  );
}

export function CircuitDrawing({ c, nets, o = {} }: { c: Circuit; nets: Nets; o?: DrawOptions }) {
  const { picked, hover, sol, values, live, ghost } = o;
  const wires: ReactNode[] = [];
  for (const w of c.wires) {
    const d = wirePath(w);
    const ink = w.color ? WIRE_INK[w.color] : undefined;
    const on = picked?.has(w.id);
    wires.push(
      <g key={w.id} className={`cs-wire${on ? " is-picked" : ""}${hover === w.id ? " is-hover" : ""}${sol?.shorted.size && isShortWire(w, c, sol) ? " is-short" : ""}`} data-wire={w.id}>
        {(on || hover === w.id) && <path className="cs-wire-halo" d={d} />}
        {ink?.edge && <path d={d} style={{ stroke: ink.edge }} strokeWidth={3.6} />}
        <path d={d} style={ink ? { stroke: ink.ink } : undefined} strokeWidth={ink ? 2.3 : undefined} />
      </g>,
    );
  }
  return (
    <>
      <g className="cs-wires">{wires}</g>
      <g className="cs-dots">
        {nets.dots.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x * G} cy={y * G} r={3.4} />
        ))}
      </g>
      <g className="cs-parts">
        {c.parts.map((p) => {
          const r = sol?.parts.get(p.id);
          const st: SymbolState = { on: r?.on, level: r?.level, trouble: r?.trouble, pressed: o.pressed?.has(p.id), live };
          const lines = o.typing === p.id ? [] : labelLines(p, sol, !!values);
          return <PartView key={p.id} p={p} st={st} lines={lines} picked={picked?.has(p.id)} hover={hover === p.id} />;
        })}
      </g>
      {o.edit && (
        <g className="cs-open">
          {nets.open.map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x * G} cy={y * G} r={2.8} />
          ))}
        </g>
      )}
      <g className="cs-notes">
        {c.notes.map((n) =>
          o.typingNote === n.id ? null : (
            <text key={n.id} className={`cs-note${picked?.has(n.id) ? " is-picked" : ""}${hover === n.id ? " is-hover" : ""}`} x={n.x * G} y={n.y * G} data-note={n.id}>
              {n.text.split("\n").map((line, i) => (
                <tspan key={i} x={n.x * G} dy={i ? "1.3em" : 0}>
                  {line || " "}
                </tspan>
              ))}
            </text>
          ),
        )}
      </g>
      {ghost && <PartView p={ghost} st={{}} lines={labelLines(ghost, null, false)} ghost />}
    </>
  );
}

/** whether a wire's in a short's path (its net is a shorted source's) */
function isShortWire(w: Wire, c: Circuit, sol: Solution): boolean {
  if (!sol.shorted.size) return false;
  const at = (pt: Pt) => `${pt[0]},${pt[1]}`;
  const ends = new Set(w.pts.map(at));
  return c.parts.some((p) => sol.shorted.has(p.id) && termsOf(p).some((t) => ends.has(at(t))));
}

/** everything's extent, in pixels: parts, their labels (roughly), wires, notes */
export function boundsOf(c: Circuit, extra: Part | null = null): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (a: number, b: number, cx: number, d: number) => {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, cx);
    y1 = Math.max(y1, d);
  };
  for (const p of extra ? [...c.parts, extra] : c.parts) {
    const [a, b, cx, d] = boxOf(p).map((n) => n * G);
    grow(a, b, cx, d);
    const lines = labelLines(p, null, true).length + 1;
    const spot = labelSpot(p, lines);
    const wide = Math.max(4, ...[p.name, p.value].map((s) => s.length)) * 7;
    if (spot.anchor === "middle") grow(spot.x - wide / 2, spot.y - 8, spot.x + wide / 2, spot.y);
    else grow(spot.x, spot.y - 8, spot.x + wide, spot.y + lines * spot.step);
  }
  for (const w of c.wires) for (const [x, y] of w.pts) grow(x * G, y * G, x * G, y * G);
  for (const n of c.notes) {
    const lines = n.text.split("\n");
    const wide = Math.max(...lines.map((l) => l.length)) * 7.5;
    grow(n.x * G, n.y * G - 12, n.x * G + wide, n.y * G + lines.length * 17);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

