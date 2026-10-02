/** Variable and function names, as math. */

/** a name as math: x, or rate upright (one name, not r·a·t·e) */
export const nameTex = (name: string) => (name.length > 1 ? `\\mathrm{${name}}` : name);

/** r, or f(x) for a function */
export const signature = (v: { name: string; params?: string[] }) => `${nameTex(v.name)}${v.params?.length ? `(${v.params.join(", ")})` : ""}`;

/** a key in the engines' vars map: "f(x)" → {name: "f", params: ["x"]}, "r" → {name: "r"} */
export function splitKey(key: string): { name: string; params?: string[] } {
  const call = key.match(/^\s*([A-Za-z]\w*)\((.*)\)\s*$/);
  return call ? { name: call[1], params: call[2].split(",").map((p) => p.trim()) } : { name: key.trim() };
}
