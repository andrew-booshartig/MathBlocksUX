/** Plugins — the app made into whatever someone needs, the way Neovim and
 * VS Code are: each a folder in ~/Documents/MatrixLab/Plugins with a
 * plugin.json, and a main.js if it scripts anything. A plugin can add
 *
 * - languages for code cells (C++, Julia, Fortran…) — in plugin.json alone
 * - kinds of cell: a fence (```csv) its script turns into what the page shows
 * - commands, in ⌘K
 * - tiles: a panel of its own in the dock, beside Calculate, Work, Graph…
 *
 * and its script gets the math engine (matrixlab.math) to work with, keys
 * of its own (matrixlab.keys.map), vim mappings (matrixlab.vim) and a place
 * to keep its settings (matrixlab.storage). The app's own languages come in
 * the same way (notebook/languages.ts).
 *
 * ~/Documents/MatrixLab/init.js is the user's own config, as Neovim's
 * init.lua is: run last, with the same matrixlab, after the plugins. See
 * docs/PLUGINS.md. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import katex from "katex";
import { Vim } from "@replit/codemirror-vim";
import { type Language, forgetPluginLanguages, registerLanguage } from "./notebook/languages";
import { partsNow, pluginOn, setParts } from "./parts";

/** a kind of notebook cell a plugin adds: ```<id> fences, shown as what render returns (HTML) */
export interface CellKind {
  id: string;
  label: string;
  /** what a new one starts with */
  starter?: string;
  render: (code: string) => string | Promise<string>;
  plugin: string;
}

export interface PluginCommand {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  plugin: string;
}

/** a tile a plugin adds: mount fills the element it's given (and may give back a clean-up) */
export interface TileDef {
  id: string;
  title: string;
  /** a few words for the + menu */
  blurb?: string;
  /** one of the app's tiles this takes the place of ("calc", "work"…): in every layout, and in the menus */
  replaces?: string;
  mount: (el: HTMLElement) => void | (() => void);
  plugin: string;
}

/** a setting a plugin asks for in its plugin.json (contributes.settings): shown in Extensions, read with matrixlab.settings.get */
export interface PluginSetting {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  default?: string | number | boolean;
  /** for a select: what it can be */
  options?: string[];
  description?: string;
}

export interface LoadedPlugin {
  folder: string;
  name: string;
  version?: string;
  description?: string;
  /** what it added: "language MATLAB", "cell csv", "command …" */
  adds: string[];
  error?: string;
  /** turned off: not loaded */
  off?: boolean;
  /** what can be set for it, in Extensions */
  settings?: PluginSetting[];
}

const settingKey = (folder: string, key: string) => `mlx-plugin:${folder}:setting:${key}`;
/** a plugin's setting, as set (or its default) */
export function pluginSetting(p: LoadedPlugin, key: string): unknown {
  const def = p.settings?.find((s) => s.key === key);
  try {
    const v = localStorage.getItem(settingKey(p.folder, key));
    if (v !== null) return JSON.parse(v);
  } catch {
    /* its default */
  }
  return def?.default ?? (def?.type === "boolean" ? false : def?.type === "number" ? 0 : "");
}
/** those listening for a plugin's settings to change (by its folder) */
const settingListeners = new Map<string, Set<(key: string, value: unknown) => void>>();
/** a setting changed in Extensions: kept, and the plugin told */
export function setPluginSetting(p: LoadedPlugin, key: string, value: unknown) {
  try {
    localStorage.setItem(settingKey(p.folder, key), JSON.stringify(value));
  } catch {
    /* for this session only */
  }
  for (const f of settingListeners.get(p.folder) ?? [])
    try {
      f(key, value);
    } catch (err) {
      console.error(`${p.folder}: its settings listener failed`, err);
    }
  changed({ loaded: [...state.loaded] });
}

/** a key (or chord) a plugin or init.js gave something to do: "Mod+Shift+G" */
export interface KeyMap {
  keys: string;
  run: () => void;
  plugin: string;
}

/** the app's own commands (⌘K's), for a plugin to run by id — the app hands them over */
let appCommands: () => { id: string; run: () => void }[] = () => [];
export function setAppCommands(list: () => { id: string; run: () => void }[]) {
  appCommands = list;
}

let keymaps: KeyMap[] = [];
/** the vim mappings plugins made (left side, mode), taken back before they load again */
let vimMaps: [string, string | undefined][] = [];

/** a key pressed: a plugin's (or init.js's) keymap, run — true when one was */
export function runKeymap(e: KeyboardEvent): boolean {
  const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, math-field, [contenteditable], .cm-editor");
  for (const k of keymaps) {
    const parts = k.keys.toLowerCase().split("+");
    const key = parts.pop()!;
    const want = { mod: parts.includes("mod") || parts.includes("cmd") || parts.includes("meta"), ctrl: parts.includes("ctrl"), alt: parts.includes("alt") || parts.includes("option"), shift: parts.includes("shift") };
    if (e.metaKey !== want.mod || e.ctrlKey !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift) continue;
    const pressed = e.key.toLowerCase();
    if (pressed !== key && e.code.toLowerCase() !== `key${key}` && e.code.toLowerCase() !== `digit${key}`) continue;
    // a plain key while typing is the typing's
    if (typing && !want.mod && !want.ctrl && !want.alt) continue;
    e.preventDefault();
    k.run();
    return true;
  }
  return false;
}

/** ready: the plugins folder has been read (until then, a saved layout's plugin tile is left be) */
type State = { cells: CellKind[]; commands: PluginCommand[]; tiles: TileDef[]; loaded: LoadedPlugin[]; ready: boolean };
let state: State = { cells: [], commands: [], tiles: [], loaded: [], ready: false };
const listeners = new Set<() => void>();
const changed = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((f) => f());
};

export function usePlugins(): State {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => state,
  );
}

export const pluginTiles = (): TileDef[] => state.tiles;
export const pluginsReady = () => state.ready;

export function pluginTile(id: string): TileDef | undefined {
  return state.tiles.find((t) => t.id === id);
}

export function cellKindOf(id: string): CellKind | undefined {
  return state.cells.find((c) => c.id === id.toLowerCase());
}

/** what a plugin's script is handed: `export function activate(matrixlab) { … }` */
function apiFor(plugin: LoadedPlugin) {
  return {
    version: 1,
    languages: {
      register(lang: Language) {
        registerLanguage(lang, plugin.folder);
        plugin.adds.push(`language ${lang.label}`);
      },
    },
    cells: {
      register(kind: Omit<CellKind, "plugin">) {
        if (!kind?.id || typeof kind.render !== "function") throw new Error("a cell kind needs an id and a render(code) function");
        changed({ cells: [...state.cells.filter((c) => c.id !== kind.id), { ...kind, id: kind.id.toLowerCase(), plugin: plugin.folder }] });
        plugin.adds.push(`cell ${kind.id}`);
      },
    },
    tiles: {
      register(tile: Omit<TileDef, "plugin">) {
        if (!tile?.id || !tile.title || typeof tile.mount !== "function") throw new Error("a tile needs an id, a title and a mount(element) function");
        const id = tile.id.startsWith("plugin-") ? tile.id : `plugin-${tile.id}`;
        changed({ tiles: [...state.tiles.filter((t) => t.id !== id), { ...tile, id, plugin: plugin.folder }] });
        if (tile.replaces && partsNow().swaps[id] !== tile.replaces) setParts({ swaps: { ...partsNow().swaps, [id]: tile.replaces } });
        plugin.adds.push(`tile ${tile.title}`);
      },
    },
    commands: {
      /** run any command by id: the app's (⌘K's — "tile:graph", "vim"…) or a plugin's */
      run: (id: string) => runCommand(id),
      register(command: Omit<PluginCommand, "plugin">) {
        changed({ commands: [...state.commands.filter((c) => c.id !== command.id), { ...command, plugin: plugin.folder }] });
        plugin.adds.push(`command ${command.title}`);
      },
    },
    keys: {
      /** a key to a command (⌘K's id, or a plugin's) or a function: keys.map("Mod+Shift+G", "tile:graph") */
      map(keys: string, what: string | (() => void)) {
        const run = typeof what === "function" ? what : () => runCommand(what);
        keymaps = [...keymaps.filter((k) => k.keys.toLowerCase() !== keys.toLowerCase()), { keys, run, plugin: plugin.folder }];
        plugin.adds.push(`key ${keys}`);
      },
    },
    /** vim in code cells, as Neovim's: vim.map("jk", "<Esc>", "insert"); vim.raw is @replit/codemirror-vim's Vim */
    vim: {
      map(lhs: string, rhs: string, mode?: string) {
        Vim.map(lhs, rhs, mode as string);
        vimMaps.push([lhs, mode]);
        plugin.adds.push(`vim ${lhs}`);
      },
      noremap(lhs: string, rhs: string, mode?: string) {
        Vim.noremap(lhs, rhs, mode as string);
        vimMaps.push([lhs, mode]);
        plugin.adds.push(`vim ${lhs}`);
      },
      /** an :ex command of your own: defineEx("today", "to", (cm) => …) */
      defineEx: (name: string, prefix: string, run: (cm: unknown) => void) => Vim.defineEx(name, prefix, run),
      raw: Vim,
    },
    /** this plugin's own settings, kept on this computer */
    storage: {
      get<T>(key: string, fallback?: T): T | undefined {
        try {
          const v = localStorage.getItem(`mlx-plugin:${plugin.folder}:${key}`);
          return v === null ? fallback : (JSON.parse(v) as T);
        } catch {
          return fallback;
        }
      },
      set(key: string, value: unknown) {
        try {
          localStorage.setItem(`mlx-plugin:${plugin.folder}:${key}`, JSON.stringify(value));
        } catch {
          /* kept for this session only */
        }
      },
    },
    /** what's set for it in Extensions (its plugin.json's contributes.settings): settings.get("minutes") */
    settings: {
      get: (key: string) => pluginSetting(plugin, key),
      /** told when one is changed: settings.onChange((key, value) => …) */
      onChange(f: (key: string, value: unknown) => void) {
        const set = settingListeners.get(plugin.folder) ?? new Set();
        set.add(f);
        settingListeners.set(plugin.folder, set);
        return () => set.delete(f);
      },
    },
    /** math as HTML, the way the app draws it: tex("\\frac{1}{2}"), tex(latex, true) for a display line */
    tex: (latex: string, display = false) => katex.renderToString(String(latex), { displayMode: display, throwOnError: false, strict: "ignore" }),
    /** the math engine: matrixlab.math({ op: "smart", latex: "x^2 = 4" }) */
    math: (request: object) => invoke("math_eval", { request }),
    /** a few words shown at the top of the window for a moment */
    notify: (text: string) => window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: String(text) })),
  };
}

function runCommand(id: string) {
  const own = appCommands().find((c) => c.id === id);
  if (own) return own.run();
  const theirs = state.commands.find((c) => c.id === id);
  if (theirs) return void theirs.run();
  throw new Error(`no command ${id} — ⌘K lists them`);
}

/** (re)load every plugin in the folder, then init.js: what each adds, and what went wrong */
export async function loadPlugins(): Promise<LoadedPlugin[]> {
  forgetPluginLanguages();
  keymaps = [];
  // vim mappings made by plugins (and init.js) are made again as they load
  for (const [lhs, mode] of vimMaps)
    try {
      Vim.unmap(lhs, mode as string);
    } catch {
      /* gone already */
    }
  vimMaps = [];
  settingListeners.clear();
  changed({ cells: [], commands: [], tiles: [], loaded: [] });
  let found: { folder: string; manifest: string; main: string | null }[] = [];
  try {
    found = await invoke("plugins_list");
  } catch (err) {
    console.error("couldn't read the plugins folder", err);
  }
  // the user's own init.js, last — as if it were a plugin with nothing but a script
  const init = await invoke<string | null>("init_read").catch(() => null);
  if (init) found = [...found, { folder: "init", manifest: JSON.stringify({ displayName: "Your init.js", description: "~/Documents/MatrixLab/init.js — your own config" }), main: init }];
  const loaded: LoadedPlugin[] = [];
  for (const f of found) {
    const plugin: LoadedPlugin = { folder: f.folder, name: f.folder, adds: [] };
    loaded.push(plugin);
    try {
      const manifest = JSON.parse(f.manifest);
      plugin.name = manifest.displayName ?? manifest.name ?? f.folder;
      plugin.version = manifest.version;
      plugin.description = manifest.description;
      const settings = manifest.contributes?.settings;
      if (Array.isArray(settings)) plugin.settings = settings.filter((x) => x?.key && x?.label).map((x) => ({ type: "text", ...x }));
      if (!pluginOn(f.folder)) {
        plugin.off = true;
        continue;
      }
      for (const lang of manifest.contributes?.languages ?? []) {
        if (!lang.id || !lang.label) throw new Error("each language needs an id and a label");
        registerLanguage({ extension: lang.id, ...lang }, f.folder);
        plugin.adds.push(`language ${lang.label}`);
      }
      if (f.main) {
        const url = URL.createObjectURL(new Blob([f.main], { type: "text/javascript" }));
        try {
          const mod = await import(/* @vite-ignore */ url);
          await mod.activate?.(apiFor(plugin));
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      plugin.error = err instanceof Error ? err.message : String(err);
    }
  }
  changed({ loaded, ready: true });
  return loaded;
}

/** a sample to start a plugin from: a language and a kind of cell */
export const SAMPLE_PLUGIN: [string, string][] = [
  [
    "plugin.json",
    JSON.stringify(
      {
        name: "my-plugin",
        displayName: "My plugin",
        version: "0.1.0",
        description: "A start: Python 3 as a code cell language, and ```csv cells shown as tables",
        contributes: {
          languages: [
            {
              id: "python3",
              label: "Python 3 (script)",
              extension: "py",
              starter: "print('hello from a plugin')",
              highlight: { lineComment: ["#"], strings: ['"', "'"], keywords: ["def", "return", "for", "in", "if", "else", "import", "from", "while", "class"], builtins: ["print", "range", "len"] },
              run: [{ needs: "python3", once: ["python3", "{file}"] }],
            },
          ],
        },
      },
      null,
      2,
    ),
  ],
  [
    "main.js",
    `// Runs when the app loads plugins (⌘K → Reload plugins after you change it).
export function activate(matrixlab) {
  // \`\`\`csv cells: the rows as a table
  matrixlab.cells.register({
    id: "csv",
    label: "CSV table",
    starter: "x, y\\n1, 2\\n3, 4",
    render(code) {
      const rows = code.trim().split("\\n").map((line) => line.split(",").map((cell) => cell.trim()));
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
      const [head, ...body] = rows;
      return \`<table class="nb-plugin-table"><tr>\${head.map((h) => \`<th>\${esc(h)}</th>\`).join("")}</tr>\${body
        .map((r) => \`<tr>\${r.map((c) => \`<td>\${esc(c)}</td>\`).join("")}</tr>\`)
        .join("")}</table>\`;
    },
  });
  // a tile of its own, beside Calculate and Work (⌘K → Go to Scratchpad)
  matrixlab.tiles.register({
    id: "scratchpad",
    title: "Scratchpad",
    blurb: "A place to jot things down — kept on this computer",
    mount(el) {
      const box = document.createElement("textarea");
      box.style.cssText = "width:100%;height:100%;box-sizing:border-box;padding:14px;border:none;resize:none;background:transparent;color:inherit;font:15px/1.5 -apple-system,sans-serif;outline:none";
      box.placeholder = "Jot something down…";
      box.value = localStorage.getItem("my-plugin.scratchpad") ?? "";
      box.oninput = () => localStorage.setItem("my-plugin.scratchpad", box.value);
      el.append(box);
    },
  });
  // a command in ⌘K
  matrixlab.commands.register({
    id: "my-plugin.hello",
    title: "Say hello",
    run: () => matrixlab.notify("hello from my plugin"),
  });
}
`,
  ],
];

/** a new init.js: what it can do, commented out */
export const INIT_TEMPLATE = `// Your MatrixLab config, the way Neovim has init.lua. It runs when the app
// starts, after the plugins — and again whenever you save it. Everything a
// plugin can do, it can do (docs/PLUGINS.md in the app's code).
export function activate(matrixlab) {
  // vim in code cells: jk leaves insert mode
  // matrixlab.vim.map("jk", "<Esc>", "insert");

  // a key for any command (⌘K's): ⌘⇧G goes to the Graph tile
  // matrixlab.keys.map("Mod+Shift+G", "tile:graph");

  // a command of your own, in ⌘K
  // matrixlab.commands.register({
  //   id: "me.today",
  //   title: "What's today?",
  //   run: () => matrixlab.notify(new Date().toDateString()),
  // });

  // a language for code cells (needs the program installed): Julia
  // matrixlab.languages.register({
  //   id: "julia", label: "Julia", extension: "jl",
  //   highlight: { lineComment: ["#"], strings: ['"'], keywords: ["function", "end", "for", "if", "else", "return"] },
  //   run: [{ needs: "julia", once: ["julia", "{file}"] }],
  // });
}
`;
