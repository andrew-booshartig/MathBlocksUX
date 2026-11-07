/** The calculator app: one smart calculator filling the window, and themes.
 * Its calculator is an ordinary calculator block (so it shares everything
 * with the canvas app's), saved in this app's own data folder. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type CalculatorBlockData, type WorkspaceSnapshot, useStore } from "../store";
import { metaFor } from "../blocks/meta";
import SmartCalc from "../blocks/SmartCalc";
import { DEFAULT_THEME, type Theme, ThemeError, applyTheme, builtInThemes, readTheme } from "./themes";
import ThemeMenu from "./ThemeMenu";
import ThemeEditor from "./ThemeEditor";
import WorkspaceMenu from "./WorkspaceMenu";
import LayoutMenu, { type SavedLayout } from "./LayoutMenu";
import { type CalcDockHandle, PRESETS, TILES } from "./CalcDock";
import { type Command, CommandPalette, ShortcutSheet } from "./CommandPalette";
import { makeUndo, typingInField } from "./undo";
import Icon from "../Icon";
import mark from "../assets/mx-mark.png";
import type { Equation } from "../equations";
import { INIT_TEMPLATE, SAMPLE_PLUGIN, loadPlugins, runKeymap, setAppCommands, usePlugins } from "../plugins";
import { setVimKeys, useVimKeys } from "../notebook/editorSettings";
import Extensions from "./Extensions";
import About from "./About";
import { tilesOn } from "./CalcDock";
import { useParts } from "../parts";
import { closeAllLinked, isLinkedId } from "../notebook/linked";

const SAVE = "__calculator__";
const SETTINGS = "__settings__";
const CALC_ID = "calculator";
/** a named workspace's file (any name works — km/h to m/s too) */
const wsFile = (name: string | null) => (name === null ? SAVE : name.startsWith(EQ) ? `eq-${encodeName(name.slice(EQ.length))}` : `ws-${encodeName(name)}`);
/** an equation's own workspace is "eq:Pyramid volume" (its file eq-…) —
 * opened from the Equations sidebar, not the Workspaces menu */
const EQ = "eq:";
/** every character a filename could trip on, as %XX — the apostrophe in
 * Dante's too (encodeURIComponent leaves ' ! ( ) * as they are) */
const encodeName = (name: string) => encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface ThemeProblem {
  file: string;
  message: string;
  line?: number;
}

function freshCalculator(): WorkspaceSnapshot {
  const block = { ...(metaFor("calculator").create(CALC_ID, { x: 0, y: 0 }) as CalculatorBlockData), profile: "smart" as const };
  return { blocks: { [CALC_ID]: block }, order: [CALC_ID], edges: [] };
}

export default function CalculatorApp() {
  const block = useStore((s) => s.blocks[CALC_ID]) as CalculatorBlockData | undefined;
  const [themes, setThemes] = useState<Theme[]>(() => builtInThemes());
  const [problems, setProblems] = useState<ThemeProblem[]>([]);
  const [themeName, setThemeName] = useState(DEFAULT_THEME);
  /** your saved equations — the same in every workspace */
  const [equations, setEquations] = useState<Equation[]>([]);
  /** hovering a theme in the menu (or editing one) shows it for a moment */
  const [preview, setPreview] = useState<Theme | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<{ file?: string; text: string } | null>(null);
  const loaded = useRef(false);
  /** the open workspace (null: Scratch) — and every saved one */
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  /** the tiles: a hand on them, and the layouts you've saved (every workspace has them) */
  const dock = useRef<CalcDockHandle | null>(null);
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** ⌘Z / ⌘⇧Z: back and forward through what you've done */
  const history = useRef<ReturnType<typeof makeUndo> | null>(null);
  const [can, setCan] = useState({ undo: false, redo: false });
  const blockReady = !!block;
  useEffect(() => {
    if (!blockReady) return;
    const h = makeUndo(CALC_ID, (undo, redo) => setCan({ undo, redo }));
    history.current = h;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z" || typingInField()) return;
      // a notebook keeps its own history (its blocks, its file), and so does a Paper sheet (what's written on it)
      if ((document.activeElement as HTMLElement | null)?.closest?.(".nb, .pp-scratch")) return;
      // ours: the field the cursor's in doesn't undo too
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) h.redo();
      else h.undo();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      h.stop();
      document.removeEventListener("keydown", onKey, true);
    };
  }, [blockReady]);
  /** ⌘K: commands; ⌘?: the shortcut sheet */
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  // plugins: loaded at the start (and again on ⌘K → Reload plugins); a plugin's words shown a moment
  const plugins = usePlugins();
  const vimKeys = useVimKeys();
  const [extOpen, setExtOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useParts(); // the ⌘K list follows tiles turned on and off
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    loadPlugins();
    // keys plugins (and init.js) mapped
    const onKey = (e: KeyboardEvent) => runKeymap(e);
    document.addEventListener("keydown", onKey, true);
    // a plugin (or init.js) saved — in Neovim, anywhere — loaded again, by itself
    let stamp = 0;
    const watch = window.setInterval(async () => {
      if (document.hidden) return;
      const now = await invoke<number>("plugins_stamp").catch(() => 0);
      if (stamp && now && now !== stamp) {
        const loaded = await loadPlugins();
        const broken = loaded.find((p) => p.error);
        window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: broken ? `${broken.name} didn't load: ${broken.error}` : "Plugins reloaded" }));
      }
      if (now) stamp = now;
    }, 1500);
    let t = 0;
    const show = (e: Event) => {
      setNotice((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = window.setTimeout(() => setNotice(null), 3500);
    };
    window.addEventListener("matrixlab-notice", show);
    return () => {
      window.removeEventListener("matrixlab-notice", show);
      document.removeEventListener("keydown", onKey, true);
      clearInterval(watch);
    };
  }, []);
  const say = (text: string) => window.dispatchEvent(new CustomEvent("matrixlab-notice", { detail: text }));
  /** a plugin started from the sample, in its own folder, shown in Finder */
  const newPlugin = async () => {
    const taken = new Set(plugins.loaded.map((p) => p.folder));
    const folder = ["my-plugin", ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `my-plugin-${n}`)].find((f) => !taken.has(f)) ?? `my-plugin-${Date.now()}`;
    try {
      const at = await invoke<string>("plugins_create", { folder, files: SAMPLE_PLUGIN });
      await reloadPlugins();
      revealItemInDir(at).catch(() => {});
    } catch (err) {
      say(String(err));
    }
  };
  const reloadPlugins = async () => {
    const loaded = await loadPlugins();
    const broken = loaded.filter((p) => p.error);
    const ok = loaded.length - broken.length;
    say(`${ok} plugin${ok === 1 ? "" : "s"} loaded${broken.length ? ` · ${broken[0].name} didn't: ${broken[0].error}${broken.length > 1 ? ` (and ${broken.length - 1} more — ⌘K, Plugin installed)` : ""}` : ""}`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // (in a note's text, ⌘K makes a link)
      if (e.key.toLowerCase() === "k" && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.(".nb-block.is-text textarea")) {
        e.preventDefault();
        setSheet(false);
        setPalette((open) => !open);
      } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setPalette(false);
        setSheet((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  /** a change not yet in the workspace's file (the dot on its name pulses) */
  const [unsaved, setUnsaved] = useState(false);
  /** the equations that have a workspace of their own (worked on before) */
  const [eqSpaces, setEqSpaces] = useState<string[]>([]);
  const listWorkspaces = useCallback(async () => {
    const files = await invoke<string[]>("list_workspaces").catch(() => [] as string[]);
    setWorkspaces(files.filter((f) => f.startsWith("ws-")).map((f) => decodeURIComponent(f.slice(3))).sort((a, b) => a.localeCompare(b)));
    setEqSpaces(files.filter((f) => f.startsWith("eq-")).map((f) => decodeURIComponent(f.slice(3))));
  }, []);
  const snapshot = () => {
    const { blocks, order, edges } = useStore.getState();
    // (a notebook block's app keeps its work in the notebook, not the workspace)
    return { blocks: Object.fromEntries(Object.entries(blocks).filter(([id]) => !isLinkedId(id))), order, edges };
  };
  /** switch: what's open is saved, then the other one comes in */
  const openWorkspace = async (name: string | null) => {
    setWsOpen(false);
    await invoke("save_workspace", { name: wsFile(activeRef.current), data: snapshot() }).catch(() => {});
    closeAllLinked();
    // the tiles as you have them: a new workspace (an equation's) keeps them
    const layout = (useStore.getState().blocks[CALC_ID] as CalculatorBlockData | undefined)?.smartLayout;
    let next: WorkspaceSnapshot;
    try {
      next = await invoke<WorkspaceSnapshot>("load_workspace", { name: wsFile(name) });
      if (!next.blocks?.[CALC_ID]) next = freshCalculator();
    } catch {
      next = freshCalculator();
    }
    const calc = next.blocks[CALC_ID] as CalculatorBlockData;
    if (!calc.smartLayout && layout) next = { ...next, blocks: { ...next.blocks, [CALC_ID]: { ...calc, smartLayout: layout } } };
    activeRef.current = name;
    setActive(name);
    useStore.getState().loadSnapshot(next);
    history.current?.reset();
  };
  /** an equation clicked: into its own workspace — the one from before, with
   * your numbers, or a fresh one (true: fresh, so load the equation in) */
  const openEquation = async (name: string) => {
    if (activeRef.current === EQ + name) return false;
    const fresh = !eqSpaces.includes(name);
    await openWorkspace(EQ + name);
    if (fresh) {
      await invoke("save_workspace", { name: wsFile(EQ + name), data: snapshot() }).catch(() => {});
      setEqSpaces((list) => [...list, name]);
    }
    return fresh;
  };
  /** an equation's workspace, gone — it starts fresh next time */
  const forgetEquation = async (name: string) => {
    await invoke("delete_workspace", { name: wsFile(EQ + name) }).catch(() => {});
    setEqSpaces((list) => list.filter((n) => n !== name));
    if (activeRef.current === EQ + name) await openWorkspace(null);
  };
  const saveAs = async (name: string) => {
    setWsOpen(false);
    await invoke("save_workspace", { name: wsFile(name), data: snapshot() });
    activeRef.current = name;
    setActive(name);
    await listWorkspaces();
  };
  const deleteWorkspace = async (name: string) => {
    await invoke("delete_workspace", { name: wsFile(name) }).catch(() => {});
    if (activeRef.current === name) {
      activeRef.current = null;
      setActive(null);
      try {
        useStore.getState().loadSnapshot(await invoke<WorkspaceSnapshot>("load_workspace", { name: SAVE }));
      } catch {
        useStore.getState().loadSnapshot(freshCalculator());
      }
    }
    await listWorkspaces();
  };

  /** the chosen theme — yours win over a built-in of the same name */
  const theme = useMemo(() => [...themes].reverse().find((t) => t.name === themeName) ?? themes[0], [themes, themeName]);

  /** read the themes folder again (built-ins + every .toml in it) */
  const reloadThemes = useCallback(async () => {
    const built = builtInThemes();
    const files = await invoke<[string, string][]>("list_themes").catch(() => [] as [string, string][]);
    const mine: Theme[] = [];
    const bad: ThemeProblem[] = [];
    for (const [file, text] of files) {
      try {
        mine.push(readTheme(text, file, [...built, ...mine]));
      } catch (error) {
        bad.push({ file, message: error instanceof Error ? error.message : String(error), line: error instanceof ThemeError ? error.line : undefined });
      }
    }
    setThemes([...built, ...mine]);
    setProblems(bad);
    return [...built, ...mine];
  }, []);

  // start: the saved calculator (or a new one), the chosen theme, the folder
  useEffect(() => {
    let stop = () => {};
    (async () => {
      let open: string | null = null;
      try {
        const settings = await invoke<{ theme?: string; workspace?: string | null; equations?: Equation[]; layouts?: SavedLayout[] }>("load_workspace", { name: SETTINGS });
        if (settings.theme) setThemeName(settings.theme);
        if (settings.equations) setEquations(settings.equations);
        if (settings.layouts) setLayouts(settings.layouts);
        open = settings.workspace ?? null;
      } catch {
        // first run: One Dark, Scratch
      }
      try {
        const saved = await invoke<WorkspaceSnapshot>("load_workspace", { name: wsFile(open) });
        useStore.getState().loadSnapshot(saved.blocks?.[CALC_ID] ? saved : freshCalculator());
      } catch {
        open = null;
        useStore.getState().loadSnapshot(freshCalculator()); // first run
      }
      activeRef.current = open;
      setActive(open);
      await listWorkspaces();
      await reloadThemes();
      loaded.current = true;
      // keep the calculator saved as it changes
      let timer: ReturnType<typeof setTimeout> | undefined;
      stop = useStore.subscribe(() => {
        clearTimeout(timer);
        setUnsaved(true);
        timer = setTimeout(() => {
          // into the open workspace (Scratch, or the named one)
          invoke("save_workspace", { name: wsFile(activeRef.current), data: snapshot() })
            .then(() => setUnsaved(false))
            .catch((e) => console.error("save failed", e));
        }, 600);
      });
    })();
    return () => stop();
  }, [reloadThemes, listWorkspaces]); // eslint-disable-line react-hooks/exhaustive-deps

  // the theme on the page (a preview wins while there is one), and remembered
  useEffect(() => {
    applyTheme(preview ?? theme);
  }, [theme, preview]);
  useEffect(() => {
    if (!loaded.current) return;
    invoke("save_workspace", { name: SETTINGS, data: { theme: themeName, workspace: active, equations, layouts } }).catch(() => {});
  }, [themeName, active, equations, layouts]);

  /** everything ⌘K offers */
  const commands = (): Command[] => [
    ...tilesOn().map((t, i) => ({
      id: `tile:${t.id}`,
      label: `Go to ${t.title}`,
      group: t.id.startsWith("plugin-") ? "Tile · plugin" : "Tile",
      icon: TILES.some((o) => o.id === t.id) ? t.id : "source",
      keys: i < 9 ? `⌘${i + 1}` : undefined,
      run: () => dock.current?.show(t.id as `plugin-${string}`, true),
    })),
    { id: "about", label: "About MatrixLab — version, and the open-source software it's built with", group: "App", icon: "reference", run: () => setAboutOpen(true) },
    { id: "extensions", label: "Extensions — tiles, languages, plugins (turn parts off, add your own)", group: "App", icon: "panel", run: () => setExtOpen(true) },
    { id: "fill", label: "Fill the window with this zone (or bring the rest back)", group: "Tiles", icon: "maximize", keys: "⌘⇧F", run: () => dock.current?.fill() },
    ...PRESETS.map((p) => ({ id: `preset:${p.id}`, label: `${p.name} layout`, group: "Layout", icon: "layout", run: () => dock.current?.preset(p.id) })),
    ...layouts.map((l) => ({ id: `mine:${l.name}`, label: `${l.name} layout`, group: "Your layout", icon: "layout", run: () => dock.current?.load(l.layout) })),
    { id: "ws:scratch", label: "Open Scratch", group: "Workspace", icon: "folder", run: () => openWorkspace(null) },
    ...workspaces.map((w) => ({ id: `ws:${w}`, label: `Open ${w}`, group: "Workspace", icon: "folder", run: () => openWorkspace(w) })),
    ...themes.map((t) => ({ id: `theme:${t.name}`, label: `${t.name} theme`, group: "Theme", icon: "eye", run: () => setThemeName(t.name) })),
    { id: "sheet", label: "Keyboard shortcuts", group: "Help", icon: "text", keys: "⌘?", run: () => setSheet(true) },
    ...plugins.commands.map((c) => ({ id: `plugin:${c.id}`, label: c.title, group: `Plugin · ${c.plugin}`, icon: "source", run: () => void c.run() })),
    { id: "plugins:reload", label: "Reload plugins (and your init.js)", group: "Plugins", icon: "reset", run: reloadPlugins },
    {
      id: "init:edit",
      label: "Edit your init.js — your own config, like Neovim's init.lua",
      group: "Plugins",
      icon: "source",
      run: () => invoke<string>("init_edit", { template: INIT_TEMPLATE }).then(() => say("init.js is open in Neovim — every :w reloads it here")).catch((err) => say(String(err))),
    },
    ...plugins.loaded.filter((p) => p.folder !== "init").map((p) => ({ id: `plugins:edit:${p.folder}`, label: `Edit the plugin ${p.name} in Neovim`, group: "Plugins", icon: "pen", run: () => invoke("plugin_edit", { folder: p.folder }).catch((err) => say(String(err))) })),
    { id: "vim", label: vimKeys ? "Vim keys off (code and notebook text)" : "Vim keys on (code and notebook text)", group: "Editing", icon: "source", run: () => (setVimKeys(!vimKeys), say(vimKeys ? "Vim keys off" : "Vim keys on — Space r runs a cell, :w is done")) },
    {
      id: "plugins:folder",
      label: "Open the plugins folder",
      group: "Plugins",
      icon: "folder",
      run: async () => revealItemInDir(await invoke<string>("plugins_folder")).catch(() => {}),
    },
    {
      id: "plugins:new",
      label: "New plugin (from a sample)",
      group: "Plugins",
      icon: "plus",
      run: newPlugin,
    },
    ...plugins.loaded.map((p) => ({ id: `plugins:about:${p.folder}`, label: `${p.name}${p.error ? ` — didn't load: ${p.error}` : p.adds.length ? ` — ${p.adds.join(", ")}` : ""}`, group: "Plugin installed", icon: "source", run: async () => revealItemInDir(`${await invoke<string>("plugins_folder")}/${p.folder}`).catch(() => {}) })),
  ];

  setAppCommands(() => commands());

  const openFolder = async () => {
    try {
      await revealItemInDir(await invoke<string>("theme_folder"));
    } catch (error) {
      console.error("couldn't open the themes folder", error);
    }
  };

  return (
    <div className="calc-app">
      {/* the window's title bar too: drag it to move the window, double-click to zoom */}
      <header className="calc-app-bar" data-tauri-drag-region>
        <span className="calc-app-brand" data-tauri-drag-region>
          <img className="calc-app-mark" src={mark} alt="" draggable={false} data-tauri-drag-region />
          <span className="calc-app-name" data-tauri-drag-region>
            MatrixLab
          </span>
        </span>
        <span className="calc-app-center" data-tauri-drag-region>
          <button className={`calc-app-workspaces${wsOpen ? " is-on" : ""}`} title="Workspaces — problems saved to come back to" onClick={() => setWsOpen((o) => !o)}>
            <Icon name={active?.startsWith(EQ) ? "equations" : "folder"} size={14} />
            <span className="calc-app-ws-name">{active === null ? "Scratch" : active.startsWith(EQ) ? active.slice(EQ.length) : active}</span>
            <span className={`calc-app-saved${unsaved ? " is-saving" : ""}`} title={unsaved ? "Saving…" : "Saved"} />
            <Icon name="chevron" size={13} />
          </button>
        </span>
        <span className="calc-app-tools" data-tauri-drag-region>
          <button className="calc-app-layout calc-app-cmd" title="Undo (⌘Z)" disabled={!can.undo} onClick={() => history.current?.undo()}>
            <Icon name="undo" size={15} />
          </button>
          <button className="calc-app-layout calc-app-cmd" title="Redo (⌘⇧Z)" disabled={!can.redo} onClick={() => history.current?.redo()}>
            <Icon name="redo" size={15} />
          </button>
          <button className="calc-app-layout calc-app-cmd" title="Commands — anything, by name (⌘K)" onClick={() => setPalette(true)}>
            <Icon name="zoom" size={15} />
            <kbd className="calc-app-kbd">⌘K</kbd>
          </button>
          <button className={`calc-app-layout${layoutOpen ? " is-on" : ""}`} title="Layouts — ready-made arrangements of the tiles, and yours" onClick={() => setLayoutOpen((o) => !o)}>
            <Icon name="layout" size={15} />
            <span className="calc-app-label">Layout</span>
          </button>
          <button className={`calc-app-layout calc-app-cmd${extOpen ? " is-on" : ""}`} title="Extensions — turn parts of the app off, add plugins of your own" onClick={() => setExtOpen(true)}>
            <Icon name="puzzle" size={15} />
          </button>
          <button className={`calc-app-theme${menuOpen ? " is-on" : ""}`} title="Theme" onClick={() => setMenuOpen((open) => !open)}>
            <span className="calc-app-swatch" style={{ background: `linear-gradient(135deg, ${theme.ui.raised} 0 50%, ${theme.numberline.solution} 50% 100%)` }} />
            {theme.name}
          </button>
        </span>
      </header>
      {palette && <CommandPalette commands={commands()} onClose={() => setPalette(false)} />}
      {notice && <div className="calc-app-notice">{notice}</div>}
      {extOpen && <Extensions onClose={() => setExtOpen(false)} onNewPlugin={newPlugin} />}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
      {sheet && <ShortcutSheet onClose={() => setSheet(false)} />}
      {layoutOpen && (
        <LayoutMenu
          saved={layouts}
          onPreset={(id) => {
            dock.current?.preset(id);
            setLayoutOpen(false);
          }}
          onLoad={(l) => {
            dock.current?.load(l.layout);
            setLayoutOpen(false);
          }}
          onSave={(name) => {
            const layout = dock.current?.layout();
            if (layout) setLayouts((list) => [...list.filter((l) => l.name !== name), { name, layout }]);
          }}
          onDelete={(name) => setLayouts((list) => list.filter((l) => l.name !== name))}
          onClose={() => setLayoutOpen(false)}
        />
      )}
      {wsOpen && <WorkspaceMenu names={workspaces} active={active} onOpen={openWorkspace} onSaveAs={saveAs} onDelete={deleteWorkspace} onClose={() => setWsOpen(false)} />}
      <main className="calc-app-main">{block && (
          <SmartCalc
            data={block}
            tiled
            layoutKey={active ?? "scratch"}
            dockRef={dock}
            equations={equations}
            onEquations={setEquations}
            spaces={{
              opened: eqSpaces,
              active: active?.startsWith(EQ) ? active.slice(EQ.length) : null,
              open: openEquation,
              forget: forgetEquation,
              scratch: () => openWorkspace(null),
            }}
          />
        )}</main>

      {menuOpen && (
        <ThemeMenu
          themes={themes}
          current={theme}
          problems={problems}
          onPreview={setPreview}
          onPick={(t) => {
            setThemeName(t.name);
            setPreview(null);
            setMenuOpen(false);
          }}
          onNew={(text) => {
            setMenuOpen(false);
            setEditing({ text });
          }}
          onEdit={(t) => {
            setMenuOpen(false);
            setEditing({ file: t.source, text: t.text });
          }}
          onOpenFolder={openFolder}
          onReload={reloadThemes}
          onClose={() => {
            setPreview(null);
            setMenuOpen(false);
          }}
        />
      )}
      {editing && (
        <ThemeEditor
          file={editing.file}
          text={editing.text}
          known={themes}
          onPreview={setPreview}
          onSaved={async (name) => {
            await reloadThemes();
            setThemeName(name);
            setPreview(null);
            setEditing(null);
          }}
          onCancel={() => {
            setPreview(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
