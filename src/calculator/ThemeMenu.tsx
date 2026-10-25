/** The theme picker: hover to see one, click to keep it. Yours (the .toml
 * files in the themes folder) are listed under the built-ins, with any that
 * didn't read and why. */
import { useEffect, useRef } from "react";
import { type Theme, newThemeText } from "./themes";
import type { ThemeProblem } from "./CalculatorApp";

function Swatch({ theme }: { theme: Theme }) {
  return (
    <span className="theme-swatch" style={{ background: theme.ui.surface, borderColor: theme.ui.border }}>
      {[theme.numberline.first, theme.numberline.second, theme.numberline.overlap, theme.colors.orange].map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

export default function ThemeMenu({
  themes,
  current,
  problems,
  onPreview,
  onPick,
  onNew,
  onEdit,
  onOpenFolder,
  onReload,
  onClose,
}: {
  themes: Theme[];
  current: Theme;
  problems: ThemeProblem[];
  onPreview: (theme: Theme | null) => void;
  onPick: (theme: Theme) => void;
  onNew: (text: string) => void;
  onEdit: (theme: Theme) => void;
  onOpenFolder: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => !menu.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".calc-app-theme") && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const row = (t: Theme, mine: boolean) => (
    <div key={`${t.source}:${t.name}`} className={`theme-row${t === current ? " is-on" : ""}`}>
      <button className="theme-pick" onMouseEnter={() => onPreview(t)} onFocus={() => onPreview(t)} onClick={() => onPick(t)}>
        <Swatch theme={t} />
        <span className="theme-name">{t.name}</span>
        {t.appearance === "light" && <span className="theme-light">light</span>}
        {t === current && <span className="theme-check">✓</span>}
      </button>
      {mine && (
        <button className="theme-edit" title={`Edit ${t.source}`} onClick={() => onEdit(t)}>
          Edit
        </button>
      )}
    </div>
  );
  const builtIn = themes.filter((t) => t.source === "built-in");
  const mine = themes.filter((t) => t.source !== "built-in");

  return (
    <div className="theme-menu" ref={menu} onMouseLeave={() => onPreview(null)}>
      <div className="theme-list">
        {builtIn.map((t) => row(t, false))}
        {(mine.length > 0 || problems.length > 0) && <div className="theme-heading">Yours</div>}
        {mine.map((t) => row(t, true))}
        {problems.map((p) => (
          <div key={p.file} className="theme-problem" title={p.message}>
            <b>{p.file}</b> — {p.line ? `line ${p.line}: ` : ""}
            {p.message}
          </div>
        ))}
      </div>
      <div className="theme-actions">
        <button onClick={() => onNew(newThemeText(current, "My theme"))} title="A theme of your own, written in TOML — starts as a copy of this one">
          New theme…
        </button>
        <button onClick={onOpenFolder} title="Your .toml themes live here — edit them in any editor, then Reload">
          Open themes folder
        </button>
        <button onClick={onReload} title="Read the themes folder again">
          Reload
        </button>
      </div>
    </div>
  );
}
