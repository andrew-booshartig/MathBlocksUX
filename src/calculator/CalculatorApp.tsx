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

const SAVE = "__calculator__";
const SETTINGS = "__settings__";
const CALC_ID = "calculator";

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
      try {
        const saved = await invoke<WorkspaceSnapshot>("load_workspace", { name: SAVE });
        useStore.getState().loadSnapshot(saved.blocks?.[CALC_ID] ? saved : freshCalculator());
      } catch {
        useStore.getState().loadSnapshot(freshCalculator()); // first run
      }
      try {
        const settings = await invoke<{ theme?: string }>("load_workspace", { name: SETTINGS });
        if (settings.theme) setThemeName(settings.theme);
      } catch {
        // first run: One Dark
      }
      await reloadThemes();
      loaded.current = true;
      // keep the calculator saved as it changes
      let timer: ReturnType<typeof setTimeout> | undefined;
      stop = useStore.subscribe(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const { blocks, order, edges } = useStore.getState();
          invoke("save_workspace", { name: SAVE, data: { blocks, order, edges } }).catch((e) => console.error("save failed", e));
        }, 600);
      });
    })();
    return () => stop();
  }, [reloadThemes]);

  // the theme on the page (a preview wins while there is one), and remembered
  useEffect(() => {
    applyTheme(preview ?? theme);
  }, [theme, preview]);
  useEffect(() => {
    if (!loaded.current) return;
    invoke("save_workspace", { name: SETTINGS, data: { theme: themeName } }).catch(() => {});
  }, [themeName]);

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
        <button className={`calc-app-theme${menuOpen ? " is-on" : ""}`} title="Theme" onClick={() => setMenuOpen((open) => !open)}>
          <span className="calc-app-swatch" style={{ background: `linear-gradient(135deg, ${theme.ui.raised} 0 50%, ${theme.numberline.solution} 50% 100%)` }} />
          {theme.name}
        </button>
        </span>
      </header>
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
