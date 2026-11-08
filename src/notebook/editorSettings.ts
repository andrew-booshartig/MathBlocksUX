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

/** the page as a sheet on a desk (Word's print layout) or the plain page — kept on this computer */
const PAGE_KEY = "mlx-page-view";
const pageListeners = new Set<() => void>();
let pageView = (() => {
  try {
    return localStorage.getItem(PAGE_KEY) !== "0";
  } catch {
    return true;
  }
})();
export function setPageView(on: boolean) {
  pageView = on;
  try {
    localStorage.setItem(PAGE_KEY, on ? "1" : "0");
  } catch {
    /* kept for this session only */
  }
  pageListeners.forEach((f) => f());
}
export function usePageView(): boolean {
  return useSyncExternalStore(
    (f) => (pageListeners.add(f), () => pageListeners.delete(f)),
    () => pageView,
  );
}
