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

/** a setting kept on this computer, that anything can watch */
function setting(key: string, fallback: boolean) {
  const listeners = new Set<() => void>();
  let value = (() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  })();
  return {
    get: () => value,
    set: (on: boolean) => {
      value = on;
      try {
        localStorage.setItem(key, on ? "1" : "0");
      } catch {
        /* kept for this session only */
      }
      listeners.forEach((f) => f());
    },
    use: () =>
      useSyncExternalStore(
        (f) => (listeners.add(f), () => listeners.delete(f)),
        () => value,
      ),
  };
}

/** smart symbols as you write (-> →, <= ≤, -- —): on unless turned off */
const smartSymbols = setting("mlx-smart-symbols", true);
export const smartSymbolsOn = smartSymbols.get;
export const setSmartSymbols = smartSymbols.set;
export const useSmartSymbols = smartSymbols.use;

/** focus: just the page — no bars, no lists beside it, the line being written kept in the middle */
const focus = setting("mlx-focus", false);
export const setFocusMode = focus.set;
export const useFocusMode = focus.use;

/** the app opens on Home (today, what's to do, your notebooks) — the last notebook open behind it, Esc away */
const startHome = setting("mlx-start-home", true);
export const startOnHome = startHome.get;
export const setStartOnHome = startHome.set;
export const useStartOnHome = startHome.use;
