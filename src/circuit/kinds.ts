/** The parts a circuit is drawn with: where each one's wires join it (its
 * terminals, on the grid), its box, what it's called and what it starts as.
 * Drawn by symbols.tsx, worked out by solve.ts. Positions are in grid
 * squares (G pixels each at 100%); a part's origin is its middle, so a turn
 * keeps it where it is and its terminals stay on the grid. */
export const G = 20;

export type Pt = [number, number];
export type Rot = 0 | 90 | 180 | 270;

/** how a part behaves when the circuit is worked out */
export type Role =
  | "R" // a resistor
  | "LAMP" // a lamp, a pilot light: a resistance from its rating, lit by its power
  | "MOTOR" // a motor: a load from its rating, turning
  | "COIL" // a relay's or a starter's coil: a load that works the contacts with its name
  | "RECEPT" // a receptacle: hot, neutral, ground — a load when something's plugged in
  | "V" // a battery, a DC supply
  | "VAC" // an AC source
  | "I" // a current source
  | "PANEL" // a panel: L1, N, L2 — 120 V each side, 240 V across
  | "GND"
  | "LABEL" // a net's name: the same name joins
  | "SW" // a switch
  | "SPDT" // a 3-way switch
  | "DPDT" // a 4-way switch
  | "PB_NO" // a push button, normally open
  | "PB_NC" // normally closed
  | "NO" // a contact, open till its coil pulls in
  | "NC" // a contact, closed till its coil pulls in
  | "FUSE"
  | "CB" // a breaker
  | "C"
  | "L"
  | "XFMR" // a transformer
  | "D" // a diode
  | "LED"
  | "VM" // a voltmeter
  | "AM"; // an ammeter

export type Group = "Sources" | "Loads" | "Switches" | "Protection" | "Parts" | "Meters" | "Control" | "Labels";
export const GROUPS: Group[] = ["Sources", "Loads", "Switches", "Protection", "Parts", "Control", "Meters", "Labels"];

export interface KindDef {
  id: string;
  label: string;
  group: Group;
  /** its name's letters: R → R1, R2 … */
  prefix: string;
  /** its terminals, unturned (grid squares from its middle) */
  terms: Pt[];
  /** what each terminal is, shown pointed at */
  termNames?: string[];
  /** its box, unturned: x0 y0 x1 y1 (grid squares) */
  box: [number, number, number, number];
  value?: string;
  role: Role;
  /** words it's found by besides its name */
  search?: string;
  /** its name: not shown (ground, a label, a contact — its coil's name is its value), or inside it (a coil) */
  name?: "hide" | "inside";
  /** what it starts as (a switch open) */
  props?: Record<string, string>;
}

const two: Pt[] = [
  [-2, 0],
  [2, 0],
];
const upright: Pt[] = [
  [0, -2],
  [0, 2],
];

export const KINDS: KindDef[] = [
  // ---- sources
  { id: "battery", label: "Battery", group: "Sources", prefix: "B", terms: upright, termNames: ["+", "−"], box: [-0.8, -2, 0.8, 2], value: "12 V", role: "V", search: "cell dc emf" },
  { id: "dc", label: "DC source", group: "Sources", prefix: "V", terms: upright, termNames: ["+", "−"], box: [-0.8, -2, 0.8, 2], value: "12 V", role: "V", search: "supply power voltage" },
  { id: "ac", label: "AC source", group: "Sources", prefix: "V", terms: upright, termNames: ["~", "~"], box: [-0.8, -2, 0.8, 2], value: "120 V 60 Hz", role: "VAC", search: "alternating generator utility mains" },
  { id: "panel", label: "Panel 120/240 V", group: "Sources", prefix: "P", terms: [[2, -2], [2, 0], [2, 2]], termNames: ["L1", "N", "L2"], box: [-1, -2.7, 2, 2.7], value: "120/240 V", role: "PANEL", search: "service split phase breaker box loadcenter" },
  { id: "isource", label: "Current source", group: "Sources", prefix: "I", terms: upright, termNames: ["out", "in"], box: [-0.8, -2, 0.8, 2], value: "1 A", role: "I", search: "amp" },
  { id: "ground", label: "Ground", group: "Sources", prefix: "GND", terms: [[0, 0]], box: [-0.7, 0, 0.7, 1], role: "GND", name: "hide", search: "earth common 0v" },
  // ---- loads
  { id: "resistor", label: "Resistor", group: "Loads", prefix: "R", terms: two, box: [-2, -0.5, 2, 0.5], value: "10 Ω", role: "R", search: "ohm resistance" },
  { id: "lamp", label: "Lamp", group: "Loads", prefix: "L", terms: two, box: [-2, -0.75, 2, 0.75], value: "60 W", role: "LAMP", search: "bulb light fixture" },
  { id: "motor", label: "Motor", group: "Loads", prefix: "M", terms: two, box: [-2, -0.75, 2, 0.75], value: "1/2 hp", role: "MOTOR", search: "fan pump" },
  { id: "receptacle", label: "Receptacle", group: "Loads", prefix: "O", terms: [[-2, 0], [2, 0], [0, 2]], termNames: ["hot", "neutral", "ground"], box: [-2, -0.8, 2, 2], value: "", role: "RECEPT", search: "outlet plug duplex" },
  { id: "led", label: "LED", group: "Loads", prefix: "D", terms: two, termNames: ["anode", "cathode"], box: [-2, -0.9, 2, 0.6], value: "red", role: "LED", search: "diode light" },
  // ---- switches
  { id: "switch", label: "Switch", group: "Switches", prefix: "S", terms: two, box: [-2, -0.8, 2, 0.3], role: "SW", props: { state: "open" }, search: "single pole spst toggle" },
  { id: "switch3", label: "3-way switch", group: "Switches", prefix: "S", terms: [[-2, 0], [2, -1], [2, 1]], termNames: ["common", "traveler", "traveler"], box: [-2, -1.3, 2, 1.3], role: "SPDT", props: { state: "1" }, search: "three way spdt traveler" },
  { id: "switch4", label: "4-way switch", group: "Switches", prefix: "S", terms: [[-2, -1], [-2, 1], [2, -1], [2, 1]], termNames: ["traveler in", "traveler in", "traveler out", "traveler out"], box: [-2, -1.3, 2, 1.3], role: "DPDT", props: { state: "straight" }, search: "four way dpdt" },
  { id: "pbno", label: "Push button NO", group: "Switches", prefix: "PB", terms: two, box: [-2, -1, 2, 0.4], role: "PB_NO", search: "start momentary normally open" },
  { id: "pbnc", label: "Push button NC", group: "Switches", prefix: "PB", terms: two, box: [-2, -1, 2, 0.6], role: "PB_NC", search: "stop momentary normally closed" },
  // ---- protection
  { id: "fuse", label: "Fuse", group: "Protection", prefix: "F", terms: two, box: [-2, -0.45, 2, 0.45], value: "15 A", role: "FUSE", search: "protection overcurrent" },
  { id: "breaker", label: "Breaker", group: "Protection", prefix: "CB", terms: two, box: [-2, -1, 2, 0.3], value: "20 A", role: "CB", search: "circuit breaker overcurrent ocpd" },
  // ---- parts
  { id: "capacitor", label: "Capacitor", group: "Parts", prefix: "C", terms: two, box: [-2, -0.7, 2, 0.7], value: "100 µF", role: "C", search: "farad cap" },
  { id: "inductor", label: "Inductor", group: "Parts", prefix: "L", terms: two, box: [-2, -0.5, 2, 0.2], value: "10 mH", role: "L", search: "coil henry choke" },
  { id: "transformer", label: "Transformer", group: "Parts", prefix: "T", terms: [[-2, -2], [-2, 2], [2, -2], [2, 2]], termNames: ["primary", "primary", "secondary", "secondary"], box: [-2, -2, 2, 2], value: "10:1", role: "XFMR", search: "xfmr step down up" },
  { id: "diode", label: "Diode", group: "Parts", prefix: "D", terms: two, termNames: ["anode", "cathode"], box: [-2, -0.6, 2, 0.6], value: "", role: "D", search: "rectifier" },
  // ---- control (ladder diagrams)
  { id: "coil", label: "Coil", group: "Control", prefix: "CR", terms: two, box: [-2, -0.7, 2, 0.7], value: "120 V", role: "COIL", name: "inside", search: "relay contactor starter control" },
  { id: "contactno", label: "Contact NO", group: "Control", prefix: "K", terms: two, box: [-2, -0.7, 2, 0.7], value: "CR1", role: "NO", name: "hide", search: "relay auxiliary normally open holding seal" },
  { id: "contactnc", label: "Contact NC", group: "Control", prefix: "K", terms: two, box: [-2, -0.7, 2, 0.7], value: "CR1", role: "NC", name: "hide", search: "relay normally closed overload ol" },
  { id: "pilot", label: "Pilot light", group: "Control", prefix: "PL", terms: two, box: [-2, -0.8, 2, 0.8], value: "green", role: "LAMP", search: "indicator lamp" },
  // ---- meters
  { id: "voltmeter", label: "Voltmeter", group: "Meters", prefix: "VM", terms: two, termNames: ["+", "−"], box: [-2, -0.75, 2, 0.75], value: "", role: "VM", search: "meter volts" },
  { id: "ammeter", label: "Ammeter", group: "Meters", prefix: "AM", terms: two, termNames: ["+", "−"], box: [-2, -0.75, 2, 0.75], value: "", role: "AM", search: "meter amps current" },
  // ---- labels
  { id: "label", label: "Net label", group: "Labels", prefix: "N", terms: [[0, 0]], box: [0, -0.6, 2.5, 0.6], value: "A", role: "LABEL", name: "hide", search: "name node tag l1 l2 rail" },
];

export const kindOf = (id: string): KindDef | undefined => KINDS.find((k) => k.id === id);

/** the toolbar's parts, keys 1–9 */
export const FAVORITES = ["resistor", "battery", "lamp", "switch", "ground", "capacitor", "inductor", "fuse", "ac"];

/** a point turned (and mirrored first) about the part's middle */
export function turn([x, y]: Pt, rot: Rot, flip: boolean): Pt {
  const fx = flip ? -x : x;
  switch (rot) {
    case 90:
      return [-y, fx];
    case 180:
      return [-fx, -y];
    case 270:
      return [y, -fx];
    default:
      return [fx, y];
  }
}

export interface Placed {
  kind: string;
  x: number;
  y: number;
  rot: Rot;
  flip: boolean;
}

/** a part's terminals where they are on the grid */
export function termsOf(p: Placed): Pt[] {
  const k = kindOf(p.kind);
  if (!k) return [];
  return k.terms.map((t) => {
    const [dx, dy] = turn(t, p.rot, p.flip);
    return [p.x + dx, p.y + dy] as Pt;
  });
}

/** a part's box where it is (grid squares): x0 y0 x1 y1 */
export function boxOf(p: Placed): [number, number, number, number] {
  const k = kindOf(p.kind);
  if (!k) return [p.x - 1, p.y - 1, p.x + 1, p.y + 1];
  const [x0, y0, x1, y1] = k.box;
  const corners = [turn([x0, y0], p.rot, p.flip), turn([x1, y1], p.rot, p.flip)];
  return [p.x + Math.min(corners[0][0], corners[1][0]), p.y + Math.min(corners[0][1], corners[1][1]), p.x + Math.max(corners[0][0], corners[1][0]), p.y + Math.max(corners[0][1], corners[1][1])];
}

/** whether its terminals run across (left to right) once turned — its name goes above it then, else beside it */
export function runsAcross(p: Placed): boolean {
  const k = kindOf(p.kind);
  const across = !k || k.role === "V" || k.role === "VAC" || k.role === "I" ? false : true;
  return p.rot === 90 || p.rot === 270 ? !across : across;
}

export const ptKey = (p: Pt) => `${p[0]},${p[1]}`;
export const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** whether a point is on a straight segment (its ends included) */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  if (a[0] === b[0]) return p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  if (a[1] === b[1]) return p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]);
  // (a slanted segment — a wire drawn by hand in the file)
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  const len = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot >= 0 && dot <= len;
}
