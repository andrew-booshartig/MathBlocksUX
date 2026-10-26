/** Names on numbers, following the math. A variable's line can be named
 * (d = 100 → kilometers, f = 8 → liters), and an answer's name is worked
 * out from how its variables sit in it — they cancel like units:
 *
 *   d/f     → kilometers per liter
 *   trip/r  → kilometers ÷ (kilometers per liter) → liters
 *   9k      → meters (9 is a count)
 *   900/r   → liters per kilometer — a bare 900 has no name, so name it
 *             (trip = 900, kilometers) to have it count as kilometers
 *
 * The engine says how the variables sit ({d: 1, f: -1}); the words are
 * worked here, so renaming a line renames every answer using it. */

/** a name as powers of its words: kilometers per liter → {kilometer: 1, liter: -1} */
export type Words = Map<string, number>;

const IRREGULAR: Record<string, string> = { feet: "foot", inches: "inch", people: "person", children: "child" };
const PLURAL_OF = Object.fromEntries(Object.entries(IRREGULAR).map(([many, one]) => [one, many]));

/** one of it: meters → meter, inches → inch, batteries → battery */
function singular(phrase: string): string {
  const words = phrase.split(" ");
  const last = words.pop()!;
  const low = last.toLowerCase();
  let one = last;
  if (IRREGULAR[low]) one = IRREGULAR[low];
  else if (/[^aeiou]ies$/i.test(last)) one = last.slice(0, -3) + "y";
  else if (/(ch|sh|ss|x)es$/i.test(last)) one = last.slice(0, -2);
  else if (/[^s]s$/i.test(last) && last.length > 3) one = last.slice(0, -1);
  return [...words, one].join(" ");
}

/** more than one: meter → meters, inch → inches */
function plural(phrase: string): string {
  const words = phrase.split(" ");
  const last = words.pop()!;
  const low = last.toLowerCase();
  let many = last + "s";
  if (PLURAL_OF[low]) many = PLURAL_OF[low];
  else if (/[^aeiou]y$/i.test(last)) many = last.slice(0, -1) + "ies";
  else if (/(ch|sh|s|x)$/i.test(last)) many = last + "es";
  return [...words, many].join(" ");
}

/** how each word is written when there's more than one — the way you
 * wrote it, if you did (kpl stays kpl) */
const spelled = new Map<string, string>();

export function readName(name: string): Words {
  const out: Words = new Map();
  name
    .trim()
    .split(/\s+per\s+/i)
    .forEach((part, i) => {
      const phrase = part.trim();
      if (!phrase) return;
      const one = singular(phrase);
      // on top it's how you say many of it (liters); below, one (per liter)
      if (i === 0) spelled.set(one, phrase);
      out.set(one, (out.get(one) ?? 0) + (i === 0 ? 1 : -1));
    });
  return out;
}

/** the answer's name: each variable's name, to its power, multiplied —
 * what's on top and below cancels */
export function nameOf(dims: Record<string, number> | null | undefined, names: Map<string, string>): string | null {
  if (!dims) return null;
  const total: Words = new Map();
  for (const [variable, power] of Object.entries(dims)) {
    const name = names.get(variable);
    if (!name) continue; // a plain number: no name to add
    for (const [word, p] of readName(name)) total.set(word, (total.get(word) ?? 0) + p * power);
  }
  const shown = (word: string, p: number, many: boolean) => {
    const w = many ? (spelled.get(word) ?? plural(word)) : word;
    return p === 1 ? w : p === 2 ? `square ${w}` : p === 3 ? `cubic ${w}` : `${w}^${p}`;
  };
  const top = [...total].filter(([, p]) => p > 0).map(([w, p]) => shown(w, p, true));
  const bottom = [...total].filter(([, p]) => p < 0).map(([w, p]) => shown(w, -p, false));
  if (!top.length && !bottom.length) return null;
  return [top.join(" "), ...bottom.map((b) => `per ${b}`)].join(" ").trim();
}
