/** The Electrical tools' math — plain functions over the NEC's tables (nec.ts). */
import { AMBIENT, AMPACITY, BOX_ALLOWANCE, BUNDLED, CONDUCTOR_AREA, FILL, type Metal, RACEWAYS, RESISTANCE, type Raceway, SERVICE_SIZES, SIZES, SMALL_OCPD, type Size, type TempRating } from "./nec";

const col = (t: TempRating) => (t === 60 ? 0 : t === 75 ? 1 : 2);

// ---- Ohm's law and power

export interface OhmIn {
  v?: number;
  i?: number;
  r?: number;
  p?: number;
}
/** any two of volts, amps, ohms, watts: all four (null if fewer than two are given) */
export function ohm({ v, i, r, p }: OhmIn): Required<OhmIn> | null {
  const has = (x?: number) => x !== undefined && Number.isFinite(x) && x !== 0;
  if (has(v) && has(i)) return { v: v!, i: i!, r: v! / i!, p: v! * i! };
  if (has(v) && has(r)) return { v: v!, i: v! / r!, r: r!, p: (v! * v!) / r! };
  if (has(v) && has(p)) return { v: v!, i: p! / v!, r: (v! * v!) / p!, p: p! };
  if (has(i) && has(r)) return { v: i! * r!, i: i!, r: r!, p: i! * i! * r! };
  if (has(i) && has(p)) return { v: p! / i!, i: i!, r: p! / (i! * i!), p: p! };
  if (has(r) && has(p)) return { v: Math.sqrt(p! * r!), i: Math.sqrt(p! / r!), r: r!, p: p! };
  return null;
}

/** an AC load's current: watts, volts, power factor, single or three phase */
export const loadAmps = (watts: number, volts: number, pf = 1, phases: 1 | 3 = 1) => watts / (volts * pf * (phases === 3 ? Math.sqrt(3) : 1));

// ---- voltage drop (Chapter 9 Table 8 resistance)

export interface DropIn {
  size: Size;
  metal: Metal;
  /** one way, in feet */
  feet: number;
  amps: number;
  volts: number;
  phases: 1 | 3;
}
export function voltageDrop({ size, metal, feet, amps, volts, phases }: DropIn): { volts: number; percent: number } | null {
  const r = RESISTANCE[metal][size];
  if (r === undefined || !feet || !amps || !volts) return null;
  const drop = (phases === 3 ? Math.sqrt(3) : 2) * amps * r * (feet / 1000);
  return { volts: drop, percent: (drop / volts) * 100 };
}
/** the smallest size that keeps the drop at or under `limit` percent */
export function sizeForDrop(d: Omit<DropIn, "size">, limit = 3): Size | null {
  for (const size of SIZES) {
    const vd = voltageDrop({ ...d, size });
    if (vd && vd.percent <= limit) return size;
  }
  return null;
}

// ---- ampacity (310.16, 310.15(B) and (C))

export interface WireIn {
  metal: Metal;
  temp: TempRating;
  /** ambient, °C */
  ambient: number;
  /** current-carrying conductors together */
  conductors: number;
}
export const ambientFactor = (ambient: number, temp: TempRating) => (AMBIENT.find(([upTo]) => ambient <= upTo)?.[col(temp) + 1] ?? 0);
export const bundleFactor = (n: number) => BUNDLED.find(([upTo]) => n <= upTo)![1];

/** what a conductor is good for: its table ampacity, corrected and adjusted, and the breaker limit on small sizes */
export function ampacityOf(size: Size, w: WireIn) {
  const base = AMPACITY[w.metal][size]?.[col(w.temp)];
  if (base === undefined) return null;
  const adjusted = base * ambientFactor(w.ambient, w.temp) * bundleFactor(w.conductors);
  return { base, adjusted, ocpd: SMALL_OCPD[w.metal][size] };
}

/** the smallest conductor for `amps` (240.4(D)'s small-size limits counted) */
export function wireFor(amps: number, w: WireIn): Size | null {
  for (const size of SIZES) {
    const a = ampacityOf(size, w);
    if (!a) continue;
    if (a.adjusted >= amps && (a.ocpd === undefined || a.ocpd >= amps)) return size;
  }
  return null;
}

// ---- conduit fill (Chapter 9 Tables 1, 4, 5)

export interface FillRow {
  count: number;
  size: Size;
  insulation: string;
}
export function conduitFill(rows: FillRow[], type: Raceway) {
  const wires = rows.reduce((n, r) => n + r.count, 0);
  const area = rows.reduce((a, r) => a + r.count * (CONDUCTOR_AREA[r.insulation]?.[r.size] ?? 0), 0);
  const allowed = wires === 1 ? FILL.one : wires === 2 ? FILL.two : FILL.more;
  const sizes = RACEWAYS[type].map(([trade, total]) => ({ trade, total, percent: (area / total) * 100, fits: area <= total * allowed }));
  return { wires, area, allowed: allowed * 100, smallest: sizes.find((s) => s.fits) ?? null, sizes };
}

// ---- box fill (314.16(B))

export interface BoxIn {
  /** conductors entering, by size: 12 → 4 */
  conductors: Partial<Record<string, number>>;
  /** devices (switches, receptacles) — two of the largest conductor each */
  devices: number;
  /** internal cable clamps (any number: one of the largest) */
  clamps: boolean;
  /** equipment grounding conductors (all of them: one of the largest) */
  grounds: boolean;
  /** support fittings (fixture studs, hickeys): one each */
  fittings: number;
}
export function boxFill(b: BoxIn): { volume: number; largest: string | null } {
  const sizes = Object.entries(b.conductors).filter(([, n]) => (n ?? 0) > 0);
  const per = (s: string) => BOX_ALLOWANCE[s as keyof typeof BOX_ALLOWANCE] ?? 0;
  const largest = sizes.length ? sizes.reduce((a, [s]) => (per(s) > per(a) ? s : a), sizes[0][0]) : null;
  const big = largest ? per(largest) : 0;
  const volume = sizes.reduce((v, [s, n]) => v + per(s) * (n ?? 0), 0) + b.devices * 2 * big + (b.clamps ? big : 0) + (b.grounds ? big : 0) + b.fittings * big;
  return { volume, largest };
}

// ---- a dwelling's load (Article 220, the standard method) and its service

export interface DwellingIn {
  /** living area, ft² */
  area: number;
  /** small-appliance branch circuits (at least 2) */
  smallAppliance: number;
  laundry: number;
  /** fastened-in-place appliances (water heater, dishwasher, disposal…), VA each */
  appliances: number[];
  /** cooking range nameplate, kW (0: none) */
  rangeKw: number;
  /** dryer nameplate, VA (0: none; at least 5000 counted) */
  dryer: number;
  /** the larger of heating and air conditioning, VA */
  hvac: number;
  volts: number;
}
export function dwellingLoad(d: DwellingIn) {
  const lines: { what: string; va: number; note: string }[] = [];
  const general = d.area * 3 + Math.max(2, d.smallAppliance) * 1500 + d.laundry * 1500;
  // Table 220.45: the first 3000 VA at 100%, to 120,000 at 35%, the rest 25%
  const demand = Math.min(general, 3000) + Math.max(0, Math.min(general, 120000) - 3000) * 0.35 + Math.max(0, general - 120000) * 0.25;
  lines.push({ what: "Lighting, small appliance, laundry", va: demand, note: `220.41, 220.52, Table 220.45 — ${general.toLocaleString()} VA before demand` });
  const fixed = d.appliances.reduce((a, b) => a + b, 0);
  if (fixed) lines.push({ what: "Fastened-in-place appliances", va: d.appliances.length >= 4 ? fixed * 0.75 : fixed, note: d.appliances.length >= 4 ? "220.53 — four or more at 75%" : "220.53" });
  if (d.dryer) lines.push({ what: "Dryer", va: Math.max(5000, d.dryer), note: "220.54 — 5000 VA or the nameplate, the larger" });
  if (d.rangeKw) lines.push({ what: "Range", va: (d.rangeKw <= 12 ? 8 : 8 * (1 + 0.05 * Math.ceil(d.rangeKw - 12))) * 1000, note: "Table 220.55, Column C (one range)" });
  if (d.hvac) lines.push({ what: "Heating or air conditioning", va: d.hvac, note: "220.60 — the larger, at 100%" });
  const total = lines.reduce((a, l) => a + l.va, 0);
  const amps = total / (d.volts || 240);
  return { lines, total, amps, service: SERVICE_SIZES.find((s) => s >= amps) ?? null };
}

// ---- a panel's circuits on its two legs

export interface Circuit {
  name: string;
  va: number;
  poles: 1 | 2;
  breaker: number;
}
/** one-pole circuits alternate A, B, A… down the panel; a two-pole one is half on each */
export function balance(circuits: Circuit[]) {
  let a = 0;
  let b = 0;
  let next: "A" | "B" = "A";
  const legs = circuits.map((c) => {
    if (c.poles === 2) {
      a += c.va / 2;
      b += c.va / 2;
      return "A+B";
    }
    if (next === "A") a += c.va;
    else b += c.va;
    const leg = next;
    next = next === "A" ? "B" : "A";
    return leg;
  });
  return { legs, a, b, total: a + b, imbalance: a + b ? (Math.abs(a - b) / Math.max(a, b)) * 100 : 0 };
}
