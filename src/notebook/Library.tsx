/** The library: every note, beside the page — newest first, found by name
 * or by anything in it, by #tag, and the notes that link to this one. The
 * notes' text is read once and kept (read again only when a file changes). */
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Icon from "../Icon";

type Listing = { name: string; modified: number }[];

/** what each note says, as of its last change */
const texts = new Map<string, { modified: number; text: string }>();

const when = (ms: number) => {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1 && new Date().getDate() === d.getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** a note's words, without its header, fences or Markdown marks */
const plain = (text: string) =>
  text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // (a picture: not its file's name, nor a picture's whole data)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // (a link: its words)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // (a callout's [!tip], a task's [x], <u>: not words)
    .replace(/\[![\w-]+\][+-]?|\[[ xX]\]|<\/?(u|sub|sup)>/g, " ")
    .replace(/<\/?(span|mark)\b[^>]*>/g, "")
    .replace(/[#*_`>=[\]$|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default function Library({ listing, current, onOpen, onNew }: { listing: Listing; current: string | null; onOpen: (name: string) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [read, setRead] = useState(0);
  // every note's text, read (again) when it's changed
  useEffect(() => {
    let live = true;
    (async () => {
      for (const l of listing) {
        if (texts.get(l.name)?.modified === l.modified) continue;
        const file = await invoke<{ text: string; modified: number }>("read_notebook", { name: l.name }).catch(() => null);
        if (file) texts.set(l.name, { modified: l.modified, text: file.text });
      }
      if (live) setRead((n) => n + 1);
    })();
    return () => {
      live = false;
    };
  }, [listing]);
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const l of listing) for (const t of new Set((texts.get(l.name)?.text ?? "").replace(/<[^>\n]*>/g, " ").match(/(?<=^|\s)#[A-Za-z][\w/-]*/g) ?? [])) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [listing, read]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const found = [...listing]
    .sort((a, b) => b.modified - a.modified)
    .map((l) => {
      const words = plain(texts.get(l.name)?.text ?? "");
      if (!q) return { ...l, snippet: words.slice(0, 80) };
      if (q.startsWith("#")) return (texts.get(l.name)?.text ?? "").toLowerCase().match(new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)) ? { ...l, snippet: words.slice(0, 80) } : null;
      if (l.name.toLowerCase().includes(q)) return { ...l, snippet: words.slice(0, 80) };
      const at = words.toLowerCase().indexOf(q);
      return at < 0 ? null : { ...l, snippet: `${at > 30 ? "…" : ""}${words.slice(Math.max(0, at - 30), at + 60)}` };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);
  // notes that link here: [[this one]]
  const linkedFrom = current ? listing.filter((l) => l.name !== current && (texts.get(l.name)?.text ?? "").includes(`[[${current}`)) : [];
  return (
    <aside className="nb-library">
      <div className="nb-lib-search">
        <Icon name="zoom" size={13} />
        <input value={query} placeholder="Search notes" spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} />
        <button className="nb-lib-new" title="A new note" onClick={onNew}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="nb-lib-list">
        {found.map((l) => (
          <button key={l.name} className={`nb-lib-note${l.name === current ? " is-here" : ""}`} onClick={() => onOpen(l.name)}>
            <span className="nb-lib-name">
              {l.name}
              <span className="nb-lib-when">{when(l.modified)}</span>
            </span>
            {l.snippet && <span className="nb-lib-snippet">{l.snippet}</span>}
          </button>
        ))}
        {!found.length && <div className="nb-lib-empty">Nothing matches</div>}
      </div>
      {tags.length > 0 && (
        <div className="nb-lib-section">
          <div className="nb-lib-title">Tags</div>
          <div className="nb-lib-tags">
            {tags.map(([t, n]) => (
              <button key={t} className={`nb-tag${query === t ? " is-on" : ""}`} onClick={() => setQuery(query === t ? "" : t)}>
                {t} <span className="nb-lib-count">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {linkedFrom.length > 0 && (
        <div className="nb-lib-section">
          <div className="nb-lib-title">Linked from</div>
          {linkedFrom.map((l) => (
            <button key={l.name} className="nb-lib-link" onClick={() => onOpen(l.name)}>
              <Icon name="arrow" size={12} /> {l.name}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

/** ⌘P: any note, by a few of its letters (in order, anywhere in its name), newest first — Enter opens it */
export function QuickOpen({ listing, onOpen, onClose }: { listing: Listing; onOpen: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const fuzzy = (name: string) => {
    const want = q.toLowerCase().replace(/\s+/g, "");
    let k = 0;
    for (const ch of name.toLowerCase()) if (ch === want[k]) k++;
    return k === want.length;
  };
  const found = [...listing].sort((a, b) => b.modified - a.modified).filter((l) => fuzzy(l.name)).slice(0, 12);
  return (
    <div className="nb-quick-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nb-quick">
        <input
          autoFocus
          value={q}
          placeholder="Go to a note"
          spellCheck={false}
          onChange={(e) => (setQ(e.target.value), setAt(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") (e.preventDefault(), setAt((at + 1) % Math.max(1, found.length)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setAt((at - 1 + found.length) % Math.max(1, found.length)));
            else if (e.key === "Enter" && found[at]) onOpen(found[at].name);
          }}
        />
        {found.map((l, k) => (
          <button key={l.name} className={`nb-quick-item${k === at ? " is-at" : ""}`} onMouseEnter={() => setAt(k)} onClick={() => onOpen(l.name)}>
            <Icon name="notebook" size={14} /> {l.name}
            <span className="nb-lib-when">{when(l.modified)}</span>
          </button>
        ))}
        {!found.length && <div className="nb-lib-empty">No note called that</div>}
      </div>
    </div>
  );
}
