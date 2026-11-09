/** Type for a notebook: any font this Mac has (the families Font Book
 * shows — asked of the system once, then remembered), for its writing and
 * its headings apart, and the size of its writing. Kept in the notebook's
 * header (font, heading font, font size), so it's the notebook's own, as a
 * Word document's fonts are. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Apple's own faces, which a page reaches by their kind's name (not in the system's list by name) */
export const APPLE_FONTS: { name: string; css: string }[] = [
  { name: "San Francisco", css: "-apple-system, system-ui, sans-serif" },
  { name: "New York", css: "ui-serif, Georgia, serif" },
  { name: "SF Rounded", css: "ui-rounded, -apple-system, sans-serif" },
  { name: "SF Mono", css: "ui-monospace, Menlo, monospace" },
];

/** the header's keys for type */
export const TYPE_KEYS = ["font", "heading font", "font size"];

/** a few every Mac has, while the full list is asked for (or if it can't be) */
const EVERY_MAC = ["Avenir", "Avenir Next", "Baskerville", "Charter", "Didot", "Futura", "Georgia", "Gill Sans", "Helvetica", "Helvetica Neue", "Hoefler Text", "Iowan Old Style", "Menlo", "Optima", "Palatino", "Rockwell", "Seravek", "Times New Roman"];

/** a font's name as CSS: the face, then the page's own if it isn't there */
export function fontCss(name: string): string {
  const apple = APPLE_FONTS.find((f) => f.name === name);
  if (apple) return apple.css;
  return `"${name.replace(/["\\]/g, "")}", -apple-system, "Helvetica Neue", sans-serif`;
}

const remembered = (key: string, fallback: string[]): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, v: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* only not remembered */
  }
};

let known: string[] | null = remembered("mlx-fonts", []).length ? remembered("mlx-fonts", []) : null;
let asking: Promise<string[]> | null = null;
/** the system's font families (AppKit's list, the same as Font Book's) — a run of osascript, through the code cells' runner */
const ASK = 'ObjC.import("AppKit");\n$.NSFontManager.sharedFontManager.availableFontFamilies.js.map(function (f) { return f.js; }).join("\\n");\n';
export function listFonts(): Promise<string[]> {
  asking ??= invoke<{ stdout: string; error: string | null }>("lang_run", {
    notebook: "__fonts__",
    lang: "fonts",
    spec: { once: ["osascript", "-l", "JavaScript", "{file}"], extension: "fonts.js", timeout: 20 },
    code: ASK,
  })
    .then((r) => {
      const names = [...new Set(r.stdout.split("\n").map((n) => n.trim()))].filter((n) => n && !n.startsWith(".") && !/emoji|braille|symbols?$|^LastResort/i.test(n)).sort((a, b) => a.localeCompare(b));
      if (names.length > 10) {
        known = names;
        remember("mlx-fonts", names);
      }
      return known ?? EVERY_MAC;
    })
    .catch(() => known ?? EVERY_MAC);
  return asking;
}

/** the fonts, once the menu's opened (the remembered list at once, the system's when it comes) */
export function useFonts(open: boolean): string[] {
  const [list, setList] = useState<string[]>(known ?? EVERY_MAC);
  useEffect(() => {
    if (open) listFonts().then(setList);
  }, [open]);
  return list;
}

/** the fonts picked lately (on this computer), latest first */
export const recentFonts = () => remembered("mlx-recent-fonts", []);
export const rememberFont = (name: string) => remember("mlx-recent-fonts", [name, ...recentFonts().filter((n) => n !== name)].slice(0, 6));

/** sizes, in points as Word has them (a page's pixels are 4/3 of a point) */
export const SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
export const DEFAULT_SIZE = 12;
