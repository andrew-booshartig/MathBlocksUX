/** ⌘K: everything the app can do, found by typing a few letters — go to a
 * tile, switch the layout or the workspace, change the theme, fill the
 * window — each with its shortcut beside it, so the shortcut sticks. And
 * ⌘? : every shortcut on one sheet. */
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";

export interface Command {
  id: string;
  /** what it does: "Go to Calculate" */
  label: string;
  /** the kind of thing, shown dim and searched too: "Tile", "Layout"… */
  group: string;
  icon: string;
  keys?: string;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // every word typed is somewhere in its name or kind
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w)));
  }, [commands, query]);
  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".cmd-item.is-at")?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div className="cmd-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmd">
        <div className="cmd-search">
          <Icon name="zoom" size={16} />
          <input
            autoFocus
            value={query}
            spellCheck={false}
            placeholder="Type a command — calculate, graphing layout, one light, notebook…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(i + 1, shown.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(i - 1, 0)));
              else if (e.key === "Enter") (e.preventDefault(), run(shown[at]));
              else if (e.key === "Escape") (e.preventDefault(), onClose());
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmd-list" ref={list}>
          {shown.map((c, i) => (
            <button key={c.id} className={`cmd-item${i === at ? " is-at" : ""}`} onMouseMove={() => setAt(i)} onClick={() => run(c)}>
              <span className="cmd-icon">
                <Icon name={c.icon} size={15} />
              </span>
              <span className="cmd-label">{c.label}</span>
              <span className="cmd-group">{c.group}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </button>
          ))}
          {!shown.length && <div className="cmd-none">Nothing called that — try fewer letters</div>}
        </div>
      </div>
    </div>
  );
}

/** every shortcut, by where it works */
const SHEET: { where: string; keys: [string, string][] }[] = [
  {
    where: "Anywhere",
    keys: [
      ["⌘K", "Commands — anything, by name"],
      ["⌘1 … ⌘7", "Go to a tile: Calculate, Work, Graph, Notebook, Reference, Variables, Equations"],
      ["⌘⇧F", "The zone you're in fills the window (again: back)"],
      ["⌘B", "Show or hide Variables"],
      ["⌘E", "Show or hide Equations"],
      ["⌘Z  ⌘⇧Z", "Undo · redo (in a field: that field's own undo)"],
      ["⌘?", "This sheet"],
    ],
  },
  {
    where: "Typing math",
    keys: [
      ["/", "A fraction (or a/b on one line, when a÷b is on)"],
      ["⌘/", "Always ÷"],
      ["^", "A power — → to come back down"],
      ["↓  →", "Into a fraction's bottom · out of a fraction or power"],
      ["Enter", "Work it out"],
    ],
  },
  {
    where: "Work",
    keys: [
      ["Enter", "A new line under this one"],
      ["⇧Enter", "Copy this line down, to change it"],
    ],
  },
  {
    where: "Notebook",
    keys: [
      ["Esc  ⌘⏎", "Done editing a block"],
      ["⌘⏎", "In a Python cell: run it (reactive: and the cells that use it)"],
      ["⇧⏎", "Run it, and on to the next cell"],
      ["⌥⏎", "Run it, and a new cell under it"],
      ["Tab", "In code: finish the name (np.lin → linspace), else indent"],
      ["↑ ↓  Enter", "In the list of names: pick one"],
      ["Enter", "In a work cell's step: the next step"],
      ["⌫", "In an empty step: take it out"],
    ],
  },
  {
    where: "Graph (pointer over it)",
    keys: [
      ["V  H", "Move · hand"],
      ["P  S  L  Y", "Point · segment · line · ray"],
      ["O  R  G  A", "Circle · rectangle · polygon · angle"],
      ["I  M", "Intersect · midpoint"],
      ["D  T  E", "Pen · text · eraser"],
      ["5<30  4,3", "Drawing: a length at an angle · a rectangle's size"],
      ["⇧ drag", "Drawing: angles in 15° steps"],
      ["Esc", "Let go of what's half built · put the tool down"],
      ["← → ↑ ↓", "The picked point: a grid line over (⇧ five, ⌥ a tenth)"],
      ["↑ ↓", "In the list: the row above or below"],
    ],
  },
  {
    where: "Tiles",
    keys: [
      ["drag a tab", "Onto any zone or its edge — the highlight shows where it lands"],
      ["double-click a tab", "Fill the window"],
      ["middle-click a tab", "Close it (⌘K or ＋ brings it back)"],
      ["right-click a tab", "Float it, fill the window, close others"],
    ],
  },
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="cmd-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="keys-sheet">
        <div className="keys-head">
          Keyboard shortcuts
          <button className="dock-action" title="Close (esc)" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="keys-grid">
          {SHEET.map((s) => (
            <section key={s.where}>
              <h3>{s.where}</h3>
              {s.keys.map(([k, what]) => (
                <div key={k + what} className="keys-row">
                  <kbd>{k}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
