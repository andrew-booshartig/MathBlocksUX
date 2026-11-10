/** Each part's symbol, as US schematics and wiring diagrams draw them (ANSI /
 * IEEE: a zigzag resistor, a lamp's crossed circle, a 3-way switch's blade
 * between its travelers, a ladder diagram's contacts and coils). Drawn
 * unturned around the part's middle, in pixels (a grid square is G); the
 * part's own <g> turns it. What it's doing shows: a lamp lit by its power, a
 * switch's blade where it is, a fuse blown, a coil pulled in. */
import type { ReactNode } from "react";
import type { Part } from "./format";
import { kindOf } from "./kinds";

export interface SymbolState {
  /** closed, lit, conducting, pulled in */
  on?: boolean;
  /** a lamp's brightness, a motor's speed */
  level?: number;
  /** blown, tripped */
  trouble?: string;
  /** a push button held down */
  pressed?: boolean;
  /** running: what's live is shown */
  live?: boolean;
}

/** a light's color from its value (a pilot light's, an LED's) */
export function lightColor(value: string): string {
  const v = value.toLowerCase();
  if (/red/.test(v)) return "var(--t-red, #e5484d)";
  if (/green/.test(v)) return "var(--t-green, #2f9e44)";
  if (/blue/.test(v)) return "var(--t-blue, #3b82f6)";
  if (/amber|orange/.test(v)) return "var(--t-orange, #f08c2b)";
  if (/white/.test(v)) return "#f6f1df";
  return "var(--cs-glow, #f5c542)";
}

const filled = { fill: "currentColor", stroke: "none" } as const;
const text = (x: number, y: number, s: string, size = 12, weight = 600): ReactNode => (
  <text x={x} y={y} fontSize={size} fontWeight={weight} textAnchor="middle" dominantBaseline="central" style={{ fill: "currentColor", stroke: "none" }}>
    {s}
  </text>
);
/** a contact's dot: hollow, the paper showing through */
const contact = (x: number, y: number) => <circle cx={x} cy={y} r={2.6} style={{ fill: "var(--cs-paper, #fff)" }} />;

/** the symbol, unturned */
export function PartSymbol({ part, st = {} }: { part: Pick<Part, "kind" | "value" | "name" | "props">; st?: SymbolState }): ReactNode {
  const k = kindOf(part.kind);
  if (!k) return <rect x={-20} y={-10} width={40} height={20} rx={3} strokeDasharray="3 3" />;
  const level = Math.max(0, Math.min(1.4, st.level ?? 0));
  const glow = (color: string, r: number) =>
    st.live && level > 0.02 ? <circle r={r + 5 * Math.min(1, level)} style={{ fill: color, opacity: 0.18 + 0.35 * Math.min(1, level), stroke: "none", filter: "blur(4px)" }} /> : null;
  switch (part.kind) {
    case "resistor":
      return <path d="M-40 0H-20L-17.5 -7L-12.5 7L-7.5 -7L-2.5 7L2.5 -7L7.5 7L12.5 -7L17.5 7L20 0H40" />;
    case "lamp": {
      const lit = st.live && level > 0.02;
      return (
        <>
          {glow("var(--cs-glow, #f5c542)", 13)}
          <path d="M-40 0H-13M13 0H40" />
          <circle r={13} style={{ fill: lit ? "var(--cs-glow, #f5c542)" : "var(--cs-paper, transparent)", fillOpacity: lit ? 0.25 + 0.6 * Math.min(1, level) : 1 }} />
          <path d="M-9.2 -9.2L9.2 9.2M-9.2 9.2L9.2 -9.2" />
        </>
      );
    }
    case "pilot": {
      const color = lightColor(part.value);
      const lit = st.live && level > 0.02;
      return (
        <>
          {glow(color, 13)}
          <path d="M-40 0H-13M13 0H40" />
          <circle r={13} style={{ fill: lit ? color : "var(--cs-paper, transparent)", fillOpacity: lit ? 0.55 : 1 }} />
          <path d="M-9.2 -9.2L9.2 9.2M-9.2 9.2L9.2 -9.2" style={{ opacity: 0.5 }} />
          <path d="M-13 -13l-4 -4M13 -13l4 -4M0 -16v-5" />
        </>
      );
    }
    case "motor":
      return (
        <>
          <path d="M-40 0H-13M13 0H40" />
          <circle r={13} style={{ fill: "var(--cs-paper, transparent)" }} />
          <g className={st.live && level > 0.02 ? "cs-spin" : undefined} style={st.live && level > 0.02 ? ({ "--spin": `${Math.max(0.25, 1.6 - level)}s` } as React.CSSProperties) : undefined}>
            {text(0, 0.5, "M", 13, 650)}
          </g>
        </>
      );
    case "receptacle":
      return (
        <>
          <path d="M-40 0H-14M14 0H40M0 14V40" />
          <circle r={14} style={{ fill: "var(--cs-paper, transparent)" }} />
          <rect x={-7} y={-7} width={2.6} height={8} rx={1} {...filled} />
          <rect x={4.4} y={-7} width={2.6} height={9.5} rx={1} {...filled} />
          <path d="M-2.4 8.5a2.4 2.4 0 0 1 4.8 0z" {...filled} />
          {st.live && level > 0.02 && <circle cx={10} cy={-10} r={2.5} style={{ fill: "var(--cs-glow, #f5c542)", stroke: "none" }} />}
        </>
      );
    case "battery":
      return (
        <>
          <path d="M0 -40V-9M0 9V40M-14 -9H14M-14 3H14" />
          <path d="M-7 -3H7M-7 9H7" strokeWidth={3.5} />
          {text(13, -17, "+", 12, 500)}
        </>
      );
    case "dc":
      return (
        <>
          <path d="M0 -40V-14M0 14V40" />
          <circle r={14} style={{ fill: "var(--cs-paper, transparent)" }} />
          <path d="M-3.5 -6H3.5M0 -9.5V-2.5M-3.5 6.5H3.5" />
        </>
      );
    case "ac":
      return (
        <>
          <path d="M0 -40V-14M0 14V40" />
          <circle r={14} style={{ fill: "var(--cs-paper, transparent)" }} />
          <path d="M-8 0C-5.5 -9 -2.5 -9 0 0S5.5 9 8 0" />
        </>
      );
    case "isource":
      return (
        <>
          <path d="M0 -40V-14M0 14V40" />
          <circle r={14} style={{ fill: "var(--cs-paper, transparent)" }} />
          <path d="M0 8V-8M-4 -3.5L0 -8L4 -3.5" />
        </>
      );
    case "panel":
      return (
        <>
          <rect x={-20} y={-53} width={36} height={106} rx={4} style={{ fill: "var(--cs-paper, transparent)" }} />
          <path d="M16 -40H40M16 0H40M16 40H40" />
          {text(-2, -40, "L1", 10, 600)}
          {text(-2, 0, "N", 10, 600)}
          {text(-2, 40, "L2", 10, 600)}
          <path d="M-13 -22H9M-13 22H9" style={{ opacity: 0.35 }} />
        </>
      );
    case "ground":
      return <path d="M0 0V8M-12 8H12M-7.5 13H7.5M-3 18H3" />;
    case "switch": {
      const closed = part.props.state === "closed";
      return (
        <>
          <path d="M-40 0H-16M16 0H40" />
          <path d={closed ? "M-16 0L16 -2.5" : "M-16 0L13 -14"} className="cs-blade" />
          {contact(-16, 0)}
          {contact(16, 0)}
        </>
      );
    }
    case "switch3": {
      const two = part.props.state === "2";
      return (
        <>
          <path d="M-40 0H-16M16 -20H40M16 20H40" />
          <path d={two ? "M-16 0L15 18" : "M-16 0L15 -18"} className="cs-blade" />
          {contact(-16, 0)}
          {contact(16, -20)}
          {contact(16, 20)}
        </>
      );
    }
    case "switch4": {
      const crossed = part.props.state === "crossed";
      return (
        <>
          <path d="M-40 -20H-16M-40 20H-16M16 -20H40M16 20H40" />
          <path d={crossed ? "M-16 -20L16 20M-16 20L16 -20" : "M-16 -20L16 -20M-16 20L16 20"} className="cs-blade" />
          <path d="M0 -20V20" strokeDasharray="2 3" style={{ opacity: crossed ? 0 : 0.45 }} />
          {contact(-16, -20)}
          {contact(-16, 20)}
          {contact(16, -20)}
          {contact(16, 20)}
        </>
      );
    }
    case "pbno": {
      const down = !!st.pressed;
      const y = down ? -3.5 : -9;
      return (
        <>
          <path d="M-40 0H-14M14 0H40" />
          <path d={`M-17 ${y}H17M0 ${y}V${y - 10}M-6 ${y - 10}H6`} className="cs-blade" />
          {contact(-14, 0)}
          {contact(14, 0)}
        </>
      );
    }
    case "pbnc": {
      const down = !!st.pressed;
      const y = down ? 10 : 3.5;
      return (
        <>
          <path d="M-40 0H-14M14 0H40" />
          <path d={`M-17 ${y}H17M0 ${y}V-12M-6 -12H6`} className="cs-blade" />
          {contact(-14, 0)}
          {contact(14, 0)}
        </>
      );
    }
    case "fuse": {
      const blown = st.trouble === "blown";
      return (
        <>
          <path d="M-40 0H-16M16 0H40" />
          <rect x={-16} y={-6.5} width={32} height={13} rx={2} style={{ fill: "var(--cs-paper, transparent)" }} />
          <path d={blown ? "M-16 0H-5M5 0H16" : "M-16 0H16"} />
          {blown && <path d="M-5 0l2 -3M5 0l-2 3" style={{ stroke: "var(--t-red, #e5484d)" }} />}
        </>
      );
    }
    case "breaker": {
      const tripped = st.trouble === "tripped";
      return (
        <>
          <path d="M-40 0H-14M14 0H40" />
          <path d="M-14 0A15 15 0 0 1 14 0" className="cs-blade" transform={tripped ? "rotate(-24 -14 0)" : undefined} style={tripped ? { stroke: "var(--t-red, #e5484d)" } : undefined} />
          {contact(-14, 0)}
          {contact(14, 0)}
        </>
      );
    }
    case "capacitor":
      return <path d="M-40 0H-4M4 0H40M-4 -13V13M4 -13V13" />;
    case "inductor":
      return <path d="M-40 0H-20a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0H40" />;
    case "transformer":
      return (
        <>
          <path d="M-40 -40H-14V-20M-40 40H-14V20M40 -40H14V-20M40 40H14V20" />
          <path d="M-14 -20a5 5 0 0 1 0 10a5 5 0 0 1 0 10a5 5 0 0 1 0 10a5 5 0 0 1 0 10" />
          <path d="M14 -20a5 5 0 0 0 0 10a5 5 0 0 0 0 10a5 5 0 0 0 0 10a5 5 0 0 0 0 10" />
          <path d="M-3 -24V24M3 -24V24" />
          <circle cx={-21} cy={-25} r={1.9} {...filled} />
          <circle cx={21} cy={-25} r={1.9} {...filled} />
        </>
      );
    case "diode":
      return (
        <>
          <path d="M-40 0H-10M10 0H40M10 -10V10" />
          <path d="M-10 -10L-10 10L10 0Z" style={{ fill: st.live && st.on ? "currentColor" : "var(--cs-paper, transparent)" }} />
        </>
      );
    case "led": {
      const color = lightColor(part.value);
      const lit = st.live && st.on;
      return (
        <>
          {lit && <circle r={16} style={{ fill: color, opacity: 0.35, stroke: "none", filter: "blur(4px)" }} />}
          <path d="M-40 0H-10M10 0H40M10 -10V10" />
          <path d="M-10 -10L-10 10L10 0Z" style={{ fill: lit ? color : "var(--cs-paper, transparent)" }} />
          <path d="M1 -12L7 -18M4.5 -18.4L7 -18L6.6 -15.5M7 -9L13 -15M10.5 -15.4L13 -15L12.6 -12.5" strokeWidth={1.3} />
        </>
      );
    }
    case "coil": {
      const on = st.live && st.on;
      return (
        <>
          <path d="M-40 0H-13M13 0H40" />
          <circle r={13} style={{ fill: on ? "var(--t-green, #2f9e44)" : "var(--cs-paper, transparent)", fillOpacity: on ? 0.22 : 1 }} />
          {text(0, 0.5, part.name.length > 4 ? part.name.slice(0, 4) : part.name, part.name.length > 2 ? 9.5 : 11.5, 650)}
        </>
      );
    }
    case "contactno":
    case "contactnc": {
      const nc = part.kind === "contactnc";
      const closed = st.live && st.on;
      return (
        <>
          <path d="M-40 0H-6M6 0H40M-6 -13V13M6 -13V13" />
          {nc && <path d="M-11 13L11 -13" />}
          {closed && <path d="M-6 0H6" style={{ stroke: "var(--t-green, #2f9e44)" }} strokeWidth={3} />}
        </>
      );
    }
    case "voltmeter":
    case "ammeter":
      return (
        <>
          <path d="M-40 0H-13M13 0H40" />
          <circle r={13} style={{ fill: "var(--cs-paper, transparent)" }} />
          {text(0, 0.5, part.kind === "voltmeter" ? "V" : "A", 13, 650)}
          {text(-22, -8, "+", 10, 500)}
        </>
      );
    case "label": {
      const w = Math.max(16, part.value.length * 7.2 + 10);
      return (
        <>
          <path d={`M0 0L8 -9H${8 + w}V9H8Z`} style={{ fill: "var(--cs-paper, transparent)" }} />
          <text x={8 + w / 2} y={0.5} fontSize={11} fontWeight={650} textAnchor="middle" dominantBaseline="central" style={{ fill: "currentColor", stroke: "none" }}>
            {part.value}
          </text>
        </>
      );
    }
    default:
      return <rect x={-20} y={-10} width={40} height={20} rx={3} />;
  }
}

/** a part's symbol in a small square (the toolbar's, the parts list's) */
export function PartIcon({ kind, size = 22 }: { kind: string; size?: number }) {
  const k = kindOf(kind);
  if (!k) return null;
  const [x0, y0, x1, y1] = k.box;
  // (a two-terminal part: its body, the leads mostly cropped — so it reads at a toolbar's size)
  const body = k.terms.length === 2;
  const pad = 4;
  const w = Math.max(x1 - x0, 1) * 20 + pad * 2;
  const h = Math.max(y1 - y0, 1) * 20 + pad * 2;
  const side = body ? Math.max(48, Math.min(w, h) + 8) : Math.max(w, h);
  const cx = body ? 0 : ((x0 + x1) / 2) * 20;
  const cy = body ? ((y0 + y1) / 2) * 20 * (k.terms[0][0] === 0 ? 0 : 1) : ((y0 + y1) / 2) * 20;
  return (
    <svg className="cs-icon" width={size} height={size} viewBox={`${cx - side / 2} ${cy - side / 2} ${side} ${side}`} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g className="cs-icon-g">
        <PartSymbol part={{ kind, value: k.value ?? (kind === "label" ? "A" : ""), name: k.prefix, props: k.props ?? {} }} />
      </g>
    </svg>
  );
}
