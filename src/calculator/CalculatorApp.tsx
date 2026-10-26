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

const SAVE = "__calculator__";
const SETTINGS = "__settings__";
const CALC_ID = "calculator";
/** a named workspace's file (any name works — km/h to m/s too) */
const wsFile = (name: string | null) => (name === null ? SAVE : `ws-${encodeName(name)}`);
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
  const listWorkspaces = useCallback(async () => {
    const files = await invoke<string[]>("list_workspaces").catch(() => [] as string[]);
    setWorkspaces(files.filter((f) => f.startsWith("ws-")).map((f) => decodeURIComponent(f.slice(3))).sort((a, b) => a.localeCompare(b)));
  }, []);
  const snapshot = () => {
    const { blocks, order, edges } = useStore.getState();
    return { blocks, order, edges };
  };
  /** switch: what's open is saved, then the other one comes in */
  const openWorkspace = async (name: string | null) => {
    setWsOpen(false);
    await invoke("save_workspace", { name: wsFile(activeRef.current), data: snapshot() }).catch(() => {});
    let next: WorkspaceSnapshot;
    try {
      next = await invoke<WorkspaceSnapshot>("load_workspace", { name: wsFile(name) });
      if (!next.blocks?.[CALC_ID]) next = freshCalculator();
    } catch {
      next = freshCalculator();
    }
    activeRef.current = name;
    setActive(name);
    useStore.getState().loadSnapshot(next);
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
        const settings = await invoke<{ theme?: string; workspace?: string | null }>("load_workspace", { name: SETTINGS });
        if (settings.theme) setThemeName(settings.theme);
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
        timer = setTimeout(() => {
          // into the open workspace (Scratch, or the named one)
          invoke("save_workspace", { name: wsFile(activeRef.current), data: snapshot() }).catch((e) => console.error("save failed", e));
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
    invoke("save_workspace", { name: SETTINGS, data: { theme: themeName, workspace: active } }).catch(() => {});
  }, [themeName, active]);

  const openFolder = async () => {
    try {
      await revealItemInDir(await invoke<string>("theme_folder"));
    } catch (error) {
      console.error("couldn't open the themes folder", error);
    }
  };

  return (
    <div className="calc-app">
      <header className="calc-app-bar">
        <span className="calc-app-title">Calculator</span>
        <span className="calc-app-tools">
        <button className={`calc-app-workspaces${wsOpen ? " is-on" : ""}`} title="Workspaces — problems saved to come back to" onClick={() => setWsOpen((o) => !o)}>
          {active ?? "Scratch"} ▾
        </button>
        <button className={`calc-app-theme${menuOpen ? " is-on" : ""}`} title="Theme" onClick={() => setMenuOpen((open) => !open)}>
          <span className="calc-app-swatch" style={{ background: `linear-gradient(135deg, ${theme.ui.raised} 0 50%, ${theme.numberline.solution} 50% 100%)` }} />
          {theme.name}
        </button>
        </span>
      </header>
      {wsOpen && <WorkspaceMenu names={workspaces} active={active} onOpen={openWorkspace} onSaveAs={saveAs} onDelete={deleteWorkspace} onClose={() => setWsOpen(false)} />}
      <main className="calc-app-main">{block && <SmartCalc data={block} />}</main>

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
