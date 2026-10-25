/** Calculator themes — every one, built in or yours, is a small TOML file
 * (see themes/one-dark.toml, the documented template). A theme names the
 * window's levels of background and text, eight accent hues, and the
 * number line's three colors; the app turns them into the CSS variables
 * App.css's colors fall back from (scripts/tokenize-colors.py). */
import { parse, TomlError } from "smol-toml";

const BUILT_IN_FILES = import.meta.glob("./themes/*.toml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const DEFAULT_THEME = "One Dark";

const UI_KEYS = ["shadow", "background", "surface", "overlay", "raised", "border", "faint", "muted", "subtle", "text"] as const;
const HUES = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
const LINE_KEYS = ["first", "second", "overlap"] as const;

/** the CSS variable each UI level fills (App.css's roles, darkest first) */
const UI_TOKEN: Record<(typeof UI_KEYS)[number], string> = {
  shadow: "--t-bg0",
  background: "--t-bg1",
  surface: "--t-bg2",
  overlay: "--t-bg3",
  raised: "--t-bg4",
  border: "--t-line",
  faint: "--t-faint",
  muted: "--t-muted",
  subtle: "--t-subtle",
  text: "--t-text",
};

export interface Theme {
  name: string;
  author?: string;
  appearance: "dark" | "light";
  ui: Record<(typeof UI_KEYS)[number], string>;
  colors: Record<(typeof HUES)[number], string>;
  numberline: Record<(typeof LINE_KEYS)[number], string>;
  /** where it came from: built in, or the file in your themes folder */
  source: "built-in" | string;
  /** the TOML it was read from */
  text: string;
}

export class ThemeError extends Error {
  constructor(
    message: string,
    /** 1-based, when the TOML itself didn't read */
    readonly line?: number,
  ) {
    super(message);
  }
}

type Table = Record<string, unknown>;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Read a theme's TOML. `known` are the themes it can extend (by name). */
export function readTheme(text: string, source: string, known: Theme[] = []): Theme {
  let data: Table;
  try {
    data = parse(text) as Table;
  } catch (error) {
    if (error instanceof TomlError) throw new ThemeError(error.message.split("\n")[0], error.line);
    throw new ThemeError(String(error));
  }
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
  if (!name) throw new ThemeError('a theme needs a name — like name = "My theme"');

  const baseName = typeof data.extends === "string" ? data.extends : name === DEFAULT_THEME ? null : DEFAULT_THEME;
  const base = baseName ? known.find((t) => t.name.toLowerCase() === baseName.toLowerCase()) : undefined;
  if (baseName && !base && typeof data.extends === "string") throw new ThemeError(`extends = "${baseName}": there's no theme by that name`);

  const palette = (table(data.palette, "palette") ?? {}) as Table;
  const color = (where: string, value: unknown): string => {
    if (typeof value !== "string") throw new ThemeError(`${where} should be a color, in quotes — like "#61afef"`);
    const named = palette[value];
    const resolved = typeof named === "string" ? named : value;
    if (!HEX.test(resolved)) throw new ThemeError(`${where} = "${value}" isn't a color — use "#rrggbb" or a name from [palette]`);
    return resolved.toLowerCase();
  };
  const section = <K extends string>(key: string, keys: readonly K[], fallback: Record<K, string> | undefined): Record<K, string> => {
    const t = table(data[key], key) ?? {};
    const out = {} as Record<K, string>;
    for (const k of keys) {
      if (t[k] !== undefined) out[k] = color(`${key}.${k}`, t[k]);
      else if (fallback) out[k] = fallback[k];
      else throw new ThemeError(`[${key}] needs ${k} (or extend a theme that has it)`);
    }
    for (const k of Object.keys(t)) if (!(keys as readonly string[]).includes(k)) throw new ThemeError(`[${key}] has no setting called ${k} — it takes ${keys.join(", ")}`);
    return out;
  };

  const ui = section("ui", UI_KEYS, base?.ui);
  const colors = section("colors", HUES, base?.colors);
  // the number line defaults to the theme's own purple, blue and green
  const numberline = section("numberline", LINE_KEYS, base?.numberline ?? { first: colors.purple, second: colors.blue, overlap: colors.green });
  const appearance = data.appearance === "light" || data.appearance === "dark" ? data.appearance : (base?.appearance ?? "dark");
  return { name, author: typeof data.author === "string" ? data.author : undefined, appearance, ui, colors, numberline, source, text };
}

function table(value: unknown, key: string): Table | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ThemeError(`[${key}] should be a table — a line with [${key}], then key = "color" lines`);
  return value as Table;
}

/** The built-in themes, One Dark first (it's what others extend). */
export function builtInThemes(): Theme[] {
  const files = Object.entries(BUILT_IN_FILES).sort(([a], [b]) => (a.includes("one-dark") ? -1 : b.includes("one-dark") ? 1 : a.localeCompare(b)));
  const out: Theme[] = [];
  for (const [, text] of files) out.push(readTheme(text, "built-in", out));
  return out;
}

/** The CSS variables a theme sets on the page. */
export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const k of UI_KEYS) vars[UI_TOKEN[k]] = theme.ui[k];
  for (const h of HUES) vars[`--t-${h}`] = theme.colors[h];
  vars["--nl-a"] = theme.numberline.first;
  vars["--nl-b"] = theme.numberline.second;
  vars["--nl-both"] = theme.numberline.overlap;
  vars["--nl-axis"] = theme.ui.faint;
  vars["--nl-label"] = theme.ui.muted;
  vars["--nl-tag"] = theme.ui.subtle;
  vars["--nl-hole"] = theme.ui.surface;
  return vars;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVariables(theme))) root.style.setProperty(k, v);
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = theme.name;
}

/** A starting point for a new theme: the current one, renamed, as TOML
 * with every key spelled out (the template's comments included). */
export function newThemeText(from: Theme, name: string): string {
  const lines = [
    `# Your theme — colors are "#rrggbb", or a name from [palette].`,
    `# Leave a line out and it comes from the theme you extend.`,
    `name = ${JSON.stringify(name)}`,
    `extends = ${JSON.stringify(from.name)}`,
    `appearance = ${JSON.stringify(from.appearance)}`,
    ``,
    `[ui]`,
    ...UI_KEYS.map((k) => `${k.padEnd(10)} = "${from.ui[k]}"`),
    ``,
    `[colors]`,
    ...HUES.map((k) => `${k.padEnd(6)} = "${from.colors[k]}"`),
    ``,
    `[numberline]`,
    ...LINE_KEYS.map((k) => `${k.padEnd(7)} = "${from.numberline[k]}"`),
    ``,
  ];
  return lines.join("\n");
}
