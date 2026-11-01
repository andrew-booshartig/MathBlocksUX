/** How code is edited, the same in every notebook: vim keys or not (kept on
 * this computer). */
import { useSyncExternalStore } from "react";

const KEY = "mlx-vim";
const listeners = new Set<() => void>();
let vimKeys = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

export function setVimKeys(on: boolean) {
  vimKeys = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* kept for this session only */
  }
  listeners.forEach((f) => f());
}

export function useVimKeys(): boolean {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => vimKeys,
  );
}
