/** Write a theme in TOML and watch the calculator change as you type.
 * Saved into the themes folder as a .toml file (so it can be edited in any
 * editor too). A mistake says which line; nothing changes until it reads. */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Theme, ThemeError, readTheme } from "./themes";

export default function ThemeEditor({
  file,
  text: startText,
  known,
  onPreview,
  onSaved,
  onCancel,
}: {
  /** the file being edited (absent for a new theme) */
  file?: string;
  text: string;
  known: Theme[];
  onPreview: (theme: Theme | null) => void;
  onSaved: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(startText);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // read it as it's typed: a theme that reads is shown at once
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const t = readTheme(text, file ?? "new", known.filter((k) => k.source !== file));
        setTheme(t);
        setProblem(null);
        onPreview(t);
      } catch (error) {
        setTheme(null);
        setProblem(error instanceof ThemeError && error.line ? `Line ${error.line}: ${error.message}` : error instanceof Error ? error.message : String(error));
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [text, file, known, onPreview]);

  useEffect(() => {
    area.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);

  const save = async () => {
    if (!theme) return;
    setSaving(true);
    try {
      await invoke<string>("save_theme", { file: file ?? theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), text });
      onSaved(theme.name);
    } catch (error) {
      setProblem(`Couldn't save: ${error}`);
      setSaving(false);
    }
  };

  return (
    <div className="theme-editor-backdrop">
      <div className="theme-editor" role="dialog" aria-label="Theme editor">
        <div className="theme-editor-head">
          <span>{file ? file : "New theme"}</span>
          <span className="theme-editor-hint">TOML · colors are "#rrggbb" or a name from [palette] · anything left out comes from the theme you extend</span>
        </div>
        <textarea
          ref={area}
          className="theme-editor-text"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              // a tab is two spaces here, not "leave the box"
              e.preventDefault();
              const el = e.currentTarget;
              const at = el.selectionStart;
              setText(text.slice(0, at) + "  " + text.slice(el.selectionEnd));
              requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
            } else if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="theme-editor-foot">
          <span className={`theme-editor-status${problem ? " is-error" : ""}`}>{problem ?? (theme ? `“${theme.name}” — showing now` : "")}</span>
          <button onClick={onCancel}>Cancel</button>
          <button className="is-primary" disabled={!theme || saving} onClick={save} title="Save to the themes folder (⌘S)">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
