/** A triangle from whatever is known about it — sides a, b, c and the
 * angles A, B, C across from them (degrees) — the way it's solved on paper:
 * the angles add to 180°, the law of cosines, the law of sines. Two sides
 * and an angle not between them (SSA) can fit two triangles; `pick` says
 * which. Three angles fix the shape but not the size. */

export type TriKey = "a" | "b" | "c" | "A" | "B" | "C";
export type TriGiven = Partial<Record<TriKey, number>>;

export interface TriSolved {
  /** every side and angle, when it could be worked out */
  values: Partial<Record<TriKey, number>>;
  /** how each was found, in order: "C = 180° − A − B" */
  steps: string[];
  /** SSA with two answers: there's a second triangle to pick */
  twoFit?: boolean;
  /** why it can't be a triangle, or what's still missing */
  problem?: string;
}

const RAD = Math.PI / 180;
const SIDES = ["a", "b", "c"] as const;
const ANGLES = ["A", "B", "C"] as const;
const opposite = { a: "A", b: "B", c: "C", A: "a", B: "b", C: "c" } as const;
const r = (n: number) => String(Math.round(n * 1000) / 1000);

export function solveTriangle(given: TriGiven, pick: 1 | 2 = 1): TriSolved {
  const v: Partial<Record<TriKey, number>> = {};
  for (const k of [...SIDES, ...ANGLES]) {
    const n = given[k];
    if (n === undefined || !Number.isFinite(n)) continue;
    if (n <= 0) return { values: {}, steps: [], problem: `${k} has to be more than 0` };
    if (ANGLES.includes(k as "A") && n >= 180) return { values: {}, steps: [], problem: `${k} has to be less than 180°` };
    v[k] = n;
  }
  const steps: string[] = [];
  let twoFit = false;
  const known = (ks: readonly TriKey[]) => ks.filter((k) => v[k] !== undefined);
  for (let round = 0; round < 6; round++) {
    const before = Object.keys(v).length;
    const angles = known(ANGLES);
    // the angles add to 180°
    if (angles.length === 3) {
      const sum = v.A! + v.B! + v.C!;
      if (Math.abs(sum - 180) > 1e-6) return { values: v, steps, problem: `the angles add to ${r(sum)}°, not 180°` };
    } else if (angles.length === 2) {
      const [p, q] = angles;
      const last = ANGLES.find((k) => !angles.includes(k))!;
      const third = 180 - v[p]! - v[q]!;
      if (third <= 0) return { values: v, steps, problem: `${p} + ${q} is ${r(v[p]! + v[q]!)}° — a triangle's angles add to 180°` };
      v[last] = third;
      steps.push(`${last} = 180° − ${p} − ${q} = ${r(third)}°`);
    }
    const sides = known(SIDES);
    // three sides: each angle by the law of cosines
    if (sides.length === 3) {
      const [a, b, c] = [v.a!, v.b!, v.c!];
      if (a + b <= c || a + c <= b || b + c <= a) return { values: v, steps, problem: "those sides don't close up — any two have to add to more than the third" };
      for (const [s, x, y] of [["a", "b", "c"], ["b", "a", "c"], ["c", "a", "b"]] as const) {
        const ang = opposite[s];
        if (v[ang] !== undefined) continue;
        v[ang] = Math.acos((v[x]! ** 2 + v[y]! ** 2 - v[s]! ** 2) / (2 * v[x]! * v[y]!)) / RAD;
        steps.push(`${ang} = cos⁻¹((${x}² + ${y}² − ${s}²) / 2${x}${y}) = ${r(v[ang]!)}°`);
      }
    } else if (sides.length === 2) {
      // two sides and the angle between them: the third side, law of cosines
      const s = SIDES.find((k) => !sides.includes(k))!;
      const ang = opposite[s];
      if (v[ang] !== undefined) {
        const [x, y] = sides;
        v[s] = Math.sqrt(v[x]! ** 2 + v[y]! ** 2 - 2 * v[x]! * v[y]! * Math.cos(v[ang]! * RAD));
        steps.push(`${s} = √(${x}² + ${y}² − 2${x}${y}·cos ${ang}) = ${r(v[s]!)}`);
      }
    }
    // the law of sines, from a side and the angle across from it
    const pair = SIDES.find((s) => v[s] !== undefined && v[opposite[s]] !== undefined);
    if (pair) {
      const ratio = v[pair]! / Math.sin(v[opposite[pair]]! * RAD);
      for (const s of SIDES) {
        const ang = opposite[s];
        if (v[ang] !== undefined && v[s] === undefined) {
          v[s] = ratio * Math.sin(v[ang]! * RAD);
          steps.push(`${s} = ${pair} · sin ${ang} / sin ${opposite[pair]} = ${r(v[s]!)}`);
        } else if (v[s] !== undefined && v[ang] === undefined && known(ANGLES).length < 2) {
          const sin = v[s]! / ratio;
          if (sin > 1 + 1e-9) return { values: v, steps, problem: `${s} is too long to reach — no triangle has these` };
          let deg = Math.asin(Math.min(1, sin)) / RAD;
          // the obtuse answer fits too, when there's room for it
          const other = 180 - deg;
          if (Math.abs(other - deg) > 1e-6 && other + v[opposite[pair]]! < 180) {
            twoFit = true;
            if (pick === 2) deg = other;
          }
          v[ang] = deg;
          steps.push(`${ang} = sin⁻¹(${s} · sin ${opposite[pair]} / ${pair}) = ${r(deg)}°${twoFit ? " (one of two that fit)" : ""}`);
        }
      }
    }
    if (Object.keys(v).length === before) break;
  }
  const missing = [...SIDES, ...ANGLES].filter((k) => v[k] === undefined);
  if (missing.length)
    return {
      values: v,
      steps,
      twoFit,
      problem: known(SIDES).length === 0 && known(ANGLES).length >= 2 ? "angles fix its shape, not its size — give one side" : "give three of them, at least one a side",
    };
  return { values: v, steps, twoFit };
}

/** its corners: A where it's placed, B along the turn from A, C above AB */
export function triangleCorners(v: Partial<Record<TriKey, number>>, at: [number, number] = [0, 0], turn = 0): [number, number][] | null {
  if ([v.b, v.c, v.A].some((n) => n === undefined)) return null;
  const t = turn * RAD;
  const A: [number, number] = at;
  const B: [number, number] = [at[0] + v.c! * Math.cos(t), at[1] + v.c! * Math.sin(t)];
  const C: [number, number] = [at[0] + v.b! * Math.cos(t + v.A! * RAD), at[1] + v.b! * Math.sin(t + v.A! * RAD)];
  return [A, B, C];
}
