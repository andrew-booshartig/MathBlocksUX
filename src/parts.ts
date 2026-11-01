/** Which parts of the app are on: each built-in tile (Calculate, Work…)
 * and each plugin can be turned off — the app is only what someone wants
 * of it. Kept on this computer. */
import { useSyncExternalStore } from "react";

export interface Parts {
  /** tiles turned off: "work", "equations", a plugin's "plugin-…" */
  offTiles: string[];
  /** plugins turned off (by folder): not loaded */
  offPlugins: string[];
  /** a plugin's tile → the app's tile it takes the place of (remembered, to put back if the plugin goes) */
  swaps: Record<string, string>;
  /** kinds of notebook cell left out of the notebook's add buttons ("numberline", "work", a plugin's "csv"…) */
  offCells: string[];
}

const KEY = "mlx-parts";
const listeners = new Set<() => void>();
let parts: Parts = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { offTiles: saved.offTiles ?? [], offPlugins: saved.offPlugins ?? [], swaps: saved.swaps ?? {}, offCells: saved.offCells ?? [] };
  } catch {
    return { offTiles: [], offPlugins: [], swaps: {}, offCells: [] };
  }
})();

export function partsNow(): Parts {
  return parts;
}

export function setParts(next: Partial<Parts>) {
  parts = { ...parts, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(parts));
  } catch {
    /* kept for this session only */
  }
  listeners.forEach((f) => f());
}

export const tileOn = (id: string) => !parts.offTiles.includes(id);
export const pluginOn = (folder: string) => !parts.offPlugins.includes(folder);

export function toggleTile(id: string) {
  setParts({ offTiles: tileOn(id) ? [...parts.offTiles, id] : parts.offTiles.filter((t) => t !== id) });
}

export const cellOn = (kind: string) => !parts.offCells.includes(kind);

export function toggleCell(kind: string) {
  setParts({ offCells: cellOn(kind) ? [...parts.offCells, kind] : parts.offCells.filter((c) => c !== kind) });
}

export function togglePlugin(folder: string) {
  setParts({ offPlugins: pluginOn(folder) ? [...parts.offPlugins, folder] : parts.offPlugins.filter((p) => p !== folder) });
}

export function useParts(): Parts {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => parts,
  );
}
