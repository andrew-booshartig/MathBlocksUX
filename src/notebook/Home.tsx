/** Home: where a day starts — today's date; a line to jot something down
 * (it lands on today's page); what's still to do in every notebook, ticked off
 * right here; the notebooks you're in lately and the ones pinned; the apps, a
 * click away. The notebooks' texts are read once and kept (noteTexts). */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Icon from "../Icon";
import { type Listing, readAll, texts } from "./noteTexts";
import { plain, when } from "./Library";
import { isDayName, todayName, todayTitle } from "./daily";

/** this week, Monday to Sunday: each day's page's name, its weekday and its date */
function thisWeek(now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + k);
    return { name: todayName(d), weekday: d.toLocaleDateString(undefined, { weekday: "short" }), day: d.getDate(), title: todayTitle(d) };
  });
}

/** a box not ticked yet (- [ ] …) in a notebook: its line as written, and which of the same lines it is */
export interface HomeTask {
  note: string;
  text: string;
  raw: string;
  nth: number;
  /** the line it was ticked on (for taking it back) */
  line?: number;
}

/** the boxes not ticked yet in a note (- [ ] …) — not in its header or its code */
export function openTasks(note: string, text: string): HomeTask[] {
  const out: HomeTask[] = [];
  const seen = new Map<string, number>();
  let fence: RegExp | null = null;
  const lines = text.split("\n");
  let k = 0;
  // (its header)
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end > 0) k = end + 1;
  }
  for (; k < lines.length; k++) {
    const l = lines[k];
    if (fence) {
      if (fence.test(l)) fence = null;
      continue;
    }
    const f = l.match(/^(`{3,}|~{3,})/);
    if (f) {
      fence = new RegExp(`^${f[1][0] === "`" ? "`" : "~"}{${f[1].length},}\\s*$`);
      continue;
    }
    const m = l.match(/^\s*[-*+]\s+\[ \]\s+(\S.*?)\s*$/);
    if (!m) continue;
    const nth = seen.get(l) ?? 0;
    seen.set(l, nth + 1);
    out.push({ note, text: m[1], raw: l, nth });
  }
  return out;
}

/** the task's box ticked in a note's text (the nth line written just so, outside its code), or null when it's gone */
export function tickTask(text: string, t: HomeTask): string | null {
  const lines = text.split("\n");
  let n = 0;
  let fence: RegExp | null = null;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (fence) {
      if (fence.test(l)) fence = null;
      continue;
    }
    const f = l.match(/^(`{3,}|~{3,})/);
    if (f) {
      fence = new RegExp(`^${f[1][0] === "`" ? "`" : "~"}{${f[1].length},}\\s*$`);
      continue;
    }
    if (l !== t.raw) continue;
    if (n++ === t.nth) {
      lines[k] = l.replace("[ ]", "[x]");
      t.line = k;
      return lines.join("\n");
    }
  }
  return null;
}

/** a box ticked on Home, unticked again (Undo): on the line it was ticked on, else the first one ticked just so */
export function untickTask(text: string, t: HomeTask): string | null {
  const done = t.raw.replace("[ ]", "[x]");
  const lines = text.split("\n");
  const at = t.line !== undefined && lines[t.line] === done ? t.line : lines.indexOf(done);
  if (at < 0) return null;
  lines[at] = t.raw;
  return lines.join("\n");
}

// ---- notebooks pinned to Home (kept on this computer)
const PINS = "mlx-pins";
const pinListeners = new Set<() => void>();
let pins: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PINS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
})();
export function togglePin(name: string) {
  pins = pins.includes(name) ? pins.filter((p) => p !== name) : [...pins, name];
  try {
    localStorage.setItem(PINS, JSON.stringify(pins));
  } catch {
    /* pinned for this session only */
  }
  pinListeners.forEach((f) => f());
}
export const usePins = () =>
  useSyncExternalStore(
    (f) => (pinListeners.add(f), () => pinListeners.delete(f)),
    () => pins,
  );

/** the apps Home opens (each a tile beside the notebook) */
const APPS: { id: string; title: string; hue: string }[] = [
  { id: "calc", title: "Calculate", hue: "teal" },
  { id: "graph", title: "Graph", hue: "blue" },
  { id: "work", title: "Work", hue: "orange" },
  { id: "circuit", title: "Circuit", hue: "yellow" },
  { id: "draw", title: "Draw", hue: "pink" },
  { id: "flowchart", title: "Flowchart", hue: "teal" },
  { id: "electrical", title: "Electrical", hue: "yellow" },
  { id: "research", title: "Research", hue: "purple" },
  { id: "paper", title: "Paper", hue: "green" },
  { id: "reference", title: "Reference", hue: "yellow" },
];

/** a task's words as they read: its marks (**bold**, `code`, [[a note|its label]], a link's address, a color's tags) left out */
const readable = (t: string) =>
  t
    .replace(/<\/?(span|mark|u|sub|sup)\b[^>]*>/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Home({
  listing,
  onOpen,
  onToday,
  onNew,
  onFind,
  onCapture,
  onTick,
  onUntick,
  onDay,
  onShowTile,
}: {
  listing: Listing;
  onOpen: (name: string) => void;
  onToday: () => void;
  onNew: () => void;
  /** ⌘P: any notebook by name */
  onFind: () => void;
  /** a line jotted down: on today's page (a to-do: a box to tick) — true once it's there */
  onCapture: (text: string, todo: boolean) => Promise<boolean>;
  /** a box ticked — true once it's in the file */
  onTick: (t: HomeTask) => Promise<boolean>;
  /** a box ticked here, unticked (Undo) */
  onUntick: (t: HomeTask) => Promise<boolean>;
  /** a day's page (made when it's first asked for) */
  onDay: (name: string) => void;
  /** an app's tile, opened beside the notebook */
  onShowTile?: (id: string) => void;
}) {
  const [read, setRead] = useState(0);
  useEffect(() => {
    let live = true;
    readAll(listing).then(() => live && setRead((n) => n + 1));
    return () => {
      live = false;
    };
  }, [listing]);
  const pinned = usePins();
  const [capture, setCapture] = useState("");
  const [landed, setLanded] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  /** boxes just ticked: shown struck through a moment, then gone */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [allTasks, setAllTasks] = useState(false);
  /** the box just ticked: a moment to take it back */
  const [undo, setUndo] = useState<HomeTask | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  // (left open past midnight: tomorrow's date — drawn again each minute)
  const [, minute] = useState(0);
  useEffect(() => {
    const t = setInterval(() => minute((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), 2200);
    return () => clearTimeout(t);
  }, [landed]);

  const byName = useMemo(() => new Map(listing.map((l) => [l.name, l])), [listing]);
  // the boxes still to tick: the notebooks changed lately first, a notebook's in its order
  const tasks = useMemo(
    () =>
      [...listing]
        .sort((a, b) => b.modified - a.modified)
        .flatMap((l) => openTasks(l.name, texts.get(l.name)?.text ?? "")),
    [listing, read], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const keyOf = (t: HomeTask) => `${t.note}\u0000${t.raw}\u0000${t.nth}`;
  const shownTasks = allTasks ? tasks : tasks.slice(0, 9);
  const recent = useMemo(() => {
    const pins = pinned.filter((p) => byName.has(p)).map((p) => byName.get(p)!);
    const rest = [...listing].filter((l) => !pinned.includes(l.name)).sort((a, b) => b.modified - a.modified);
    return [...pins, ...rest].slice(0, Math.max(8, pins.length + 4));
  }, [listing, pinned, byName]);
  const day = todayName();
  const hasToday = byName.has(day);

  const jot = async (todo: boolean) => {
    const text = capture.trim();
    if (!text) return;
    setCapture("");
    if (await onCapture(text, todo)) setLanded(todo ? "On today's page, to do" : "On today's page");
    else setCapture(text);
  };
  const tick = async (t: HomeTask) => {
    const k = keyOf(t);
    setTicked((s) => new Set(s).add(k));
    const done = await onTick(t);
    if (!done) setTicked((s) => (s.delete(k), new Set(s)));
    else setUndo(t);
  };
  const untick = async () => {
    const t = undo;
    setUndo(null);
    if (t && (await onUntick(t))) setTicked((s) => (s.delete(keyOf(t)), new Set(s)));
  };
  const week = useMemo(() => thisWeek(), [day]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="nb-home">
      <div className="nb-home-inner">
        <header className="nb-home-head">
          <div className="nb-home-greet">{greeting()}</div>
          <h1 className="nb-home-date">{todayTitle()}</h1>
          <nav className="nb-home-week">
            {week.map((w) => (
              <button key={w.name} className={`nb-home-day${w.name === day ? " is-today" : ""}${byName.has(w.name) ? " has-page" : ""}${w.name < day ? " is-past" : ""}`} title={byName.has(w.name) ? w.title : `${w.title} — start its page`} onClick={() => onDay(w.name)}>
                <span className="nb-home-day-name">{w.weekday}</span>
                <span className="nb-home-day-num">{w.day}</span>
              </button>
            ))}
          </nav>
        </header>

        <div className={`nb-home-capture${capture.trim() ? " is-typing" : ""}`}>
          <Icon name="pen" size={15} />
          <input
            ref={field}
            value={capture}
            placeholder="Jot something down"
            spellCheck
            title="Enter: a note on today's page · ⇧Enter: a to-do"
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.preventDefault(), jot(e.shiftKey));
              if (e.key === "Escape") (setCapture(""), (e.target as HTMLInputElement).blur());
            }}
          />
          {landed ? (
            <span className="nb-home-landed">
              <Icon name="check" size={13} /> {landed}
            </span>
          ) : (
            capture.trim() && (
              <span className="nb-home-keys">
                <kbd>⏎</kbd> note <kbd>⇧⏎</kbd> to-do
              </span>
            )
          )}
        </div>

        <div className="nb-home-actions">
          <button className="nb-home-action is-today" onClick={onToday} title={hasToday ? "Today's page" : "Start today's page"}>
            <Icon name="calendar" size={15} /> Today <kbd>⌘⇧D</kbd>
          </button>
          <button className="nb-home-action" onClick={onNew}>
            <Icon name="plus" size={15} /> New notebook
          </button>
          <button className="nb-home-action" onClick={onFind}>
            <Icon name="zoom" size={15} /> Go to… <kbd>⌘P</kbd>
          </button>
        </div>

        <div className="nb-home-cols">
          <section className="nb-home-section">
            <h2 className="nb-home-title">
              To do {tasks.length > 0 && <span className="nb-home-count">{tasks.length}</span>}
            </h2>
            {tasks.length === 0 && <div className="nb-home-empty">All done.</div>}
            {shownTasks.map((t) => {
              const done = ticked.has(keyOf(t));
              return (
                <div key={keyOf(t)} className={`nb-home-task${done ? " is-done" : ""}`}>
                  <input type="checkbox" checked={done} disabled={done} onChange={() => tick(t)} title="Done" />
                  <button className="nb-home-task-text" title={`Open ${t.note}`} onClick={() => onOpen(t.note)}>
                    {readable(t.text)}
                  </button>
                  <button className="nb-home-task-note" onClick={() => onOpen(t.note)}>
                    {isDayName(t.note) ? t.note.slice(5).replace("-", "/") : t.note}
                  </button>
                </div>
              );
            })}
            {undo && (
              <div className="nb-home-undo">
                <Icon name="check" size={13} /> Ticked “{readable(undo.text)}”
                <button onClick={untick}>Undo</button>
              </div>
            )}
            {tasks.length > 9 && (
              <button className="nb-home-more" onClick={() => setAllTasks(!allTasks)}>
                {allTasks ? "Fewer" : `All ${tasks.length}`}
              </button>
            )}
          </section>

          <section className="nb-home-section">
            <h2 className="nb-home-title">Notebooks</h2>
            {recent.length === 0 && <div className="nb-home-empty">None yet.</div>}
            {recent.map((l) => {
              const isPinned = pinned.includes(l.name);
              const words = plain(texts.get(l.name)?.text ?? "");
              return (
                <div key={l.name} className={`nb-home-note${isPinned ? " is-pinned" : ""}`}>
                  <button className="nb-home-note-open" onClick={() => onOpen(l.name)}>
                    <span className="nb-home-note-name">
                      <Icon name={isDayName(l.name) ? "calendar" : "notebook"} size={13} /> {l.name}
                    </span>
                    <span className="nb-home-note-when">{when(l.modified)}</span>
                    {words && <span className="nb-home-note-words">{words.slice(0, 90)}</span>}
                  </button>
                  <button className={`nb-home-pin${isPinned ? " is-on" : ""}`} title={isPinned ? "Unpin it" : "Pin it to the top"} onClick={() => togglePin(l.name)}>
                    <Icon name="pushpin" size={13} />
                  </button>
                </div>
              );
            })}
          </section>
        </div>

        {onShowTile && (
          <section className="nb-home-section">
            <h2 className="nb-home-title">Apps</h2>
            <div className="nb-home-apps">
              {APPS.map((a) => (
                <button key={a.id} className="nb-home-app" style={{ "--tile-hue": `var(--t-${a.hue})` } as React.CSSProperties} onClick={() => onShowTile(a.id)}>
                  <span className="nb-home-app-icon">
                    <Icon name={a.id} size={17} />
                  </span>
                  {a.title}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
