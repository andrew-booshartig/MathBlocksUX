/** Plugins — the app made into whatever someone needs, the way Neovim and
 * VS Code are: each a folder in ~/Documents/MatrixLab/Plugins with a
 * plugin.json, and a main.js if it scripts anything. A plugin can add
 *
 * - languages for code cells (C++, Julia, Fortran…) — in plugin.json alone
 * - kinds of cell: a fence (```csv) its script turns into what the page shows
 * - commands, in ⌘K
 * - tiles: a panel of its own in the dock, beside Calculate, Work, Graph…
 *
 * and its script gets the math engine (matrixlab.math) to work with. The
 * app's own languages come in the same way (notebook/languages.ts). See
 * docs/PLUGINS.md for how to write one. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
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
      register(command: Omit<PluginCommand, "plugin">) {
        changed({ commands: [...state.commands.filter((c) => c.id !== command.id), { ...command, plugin: plugin.folder }] });
        plugin.adds.push(`command ${command.title}`);
      },
    },
    /** the math engine: matrixlab.math({ op: "smart", latex: "x^2 = 4" }) */
    math: (request: object) => invoke("math_eval", { request }),
    /** a few words shown at the top of the window for a moment */
    notify: (text: string) => window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: String(text) })),
  };
}

/** (re)load every plugin in the folder: what each adds, and what went wrong */
export async function loadPlugins(): Promise<LoadedPlugin[]> {
  forgetPluginLanguages();
  changed({ cells: [], commands: [], tiles: [], loaded: [] });
  let found: { folder: string; manifest: string; main: string | null }[] = [];
  try {
    found = await invoke("plugins_list");
  } catch (err) {
    console.error("couldn't read the plugins folder", err);
  }
  const loaded: LoadedPlugin[] = [];
  for (const f of found) {
    const plugin: LoadedPlugin = { folder: f.folder, name: f.folder, adds: [] };
    loaded.push(plugin);
    try {
      const manifest = JSON.parse(f.manifest);
      plugin.name = manifest.displayName ?? manifest.name ?? f.folder;
      plugin.version = manifest.version;
      plugin.description = manifest.description;
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
