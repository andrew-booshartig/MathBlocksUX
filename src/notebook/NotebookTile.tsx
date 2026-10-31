/** The Notebook tile: notebooks are Markdown files (~/Documents/MatrixLab/
 * Notebooks) shown as pages — the header from the front matter, text and
 * math, and cells that work themselves out (calc, graph, number line, work,
 * python). Click a block to edit its Markdown; click away and it's a page
 * again. Every change is saved as you go, and a save from another editor
 * (Neovim, Obsidian…) shows up here by itself.
 *
 * New notebooks start from a template: Blank, Assignment (filled with the
 * problems finished in Work — what the Assignment tab did), Lab report,
 * Study notes, Script, and your own (any notebook → Save as template). */
import { type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "../Icon";
import { mathRequest } from "../mathSidecar";
import type { WorkHistoryEntry } from "../store";
import { todayLabel } from "../workHistory";
import { type CalcLine, CalcCell, GraphCell, NumberLineCell, type PyOutput, PythonOutput, WorkCell, runCalcCells } from "./cells";
import { type Block, type CellLang, type NotebookDoc, blockId, metaValue, parseNotebook, setMeta, writeNotebook } from "./format";
import { setNotebookInbox } from "./inbox";
import { renderMarkdown } from "./markdown";
import { notebookHtml } from "./print";
import { TEMPLATES, type Template, problemSection, userTemplate } from "./templates";
import "./notebook.css";

type Listing = { name: string; modified: number }[];

const errorText = (err: unknown) => String(err).replace(/^Error:\s*/, "");
/** "Nov 1" — for a new notebook's name */
const shortDate = () => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
const DEFAULT_NAMES: Record<string, string> = { blank: "Notebook", assignment: "Homework", lab: "Lab report", notes: "Notes", script: "Script" };

/** the header's fields, labelled; any others the file has follow */
const HEADER_FIELDS: [string, string][] = [
  ["title", "Title"],
  ["name", "Name"],
  ["course", "Class"],
  ["instructor", "Teacher"],
  ["date", "Date"],
];

/** what each kind of cell starts as */
const NEW_CELLS: { lang: CellLang | "text" | "math"; label: string; icon: string; start: string }[] = [
  { lang: "text", label: "Text", icon: "text", start: "" },
  { lang: "math", label: "Math", icon: "equations", start: "$$\n\n$$" },
  { lang: "calc", label: "Calc", icon: "calc", start: "" },
  { lang: "graph", label: "Graph", icon: "graph", start: "y = 2x + 1" },
  { lang: "numberline", label: "Number line", icon: "segment", start: "x < 3" },
  { lang: "work", label: "Work", icon: "work", start: "problem: 2x + 3 = 11\n" },
  { lang: "python", label: "Python", icon: "source", start: "" },
];

const LANG_LABEL: Record<string, string> = { calc: "Calc", graph: "Graph", numberline: "Number line", work: "Work", python: "Python" };

/** a textarea as tall as what's in it */
function AutoText({ value, onChange, onKeyDown, onBlur, mono, placeholder }: { value: string; onChange: (v: string) => void; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; onBlur?: () => void; mono?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className={`nb-edit${mono ? " is-mono" : ""}`}
      value={value}
      spellCheck={!mono}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

export default function NotebookTile({ name, onOpen, work }: { name?: string; onOpen: (name: string | undefined) => void; work: WorkHistoryEntry[] }) {
  const [doc, setDoc] = useState<NotebookDoc | null>(null);
  const [view, setView] = useState<"doc" | "source" | "new">(name ? "doc" : "new");
  const [listing, setListing] = useState<Listing>([]);
  const [mine, setMine] = useState<Template[]>([]);
  const [switcher, setSwitcher] = useState(false);
  const [menu, setMenu] = useState(false);
  const [prompt, setPrompt] = useState<{ kind: "rename" | "template"; value: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** a block just deleted, to put back (for a few seconds) */
  const [undo, setUndo] = useState<{ block: Block; at: number } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(t);
  }, [undo]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [headerOpen, setHeaderOpen] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [source, setSource] = useState("");
  const [calc, setCalc] = useState<CalcLine[][] | null>(null);
  const [py, setPy] = useState<Record<string, PyOutput>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const lastModified = useRef(0);
  const page = useRef<HTMLDivElement>(null);
  // the latest onOpen, so loading doesn't start over on every render
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshListing = useCallback(async () => {
    setListing(await invoke<Listing>("list_notebooks").catch(() => []));
    const yours = await invoke<[string, string][]>("list_templates").catch(() => [] as [string, string][]);
    setMine(yours.map(([n, t]) => userTemplate(n, t)));
  }, []);
  useEffect(() => {
    refreshListing();
  }, [refreshListing]);

  // ---- open / save

  const load = useCallback(
    async (which: string) => {
      try {
        const file = await invoke<{ text: string; modified: number }>("read_notebook", { name: which });
        lastModified.current = file.modified;
        setDoc(parseNotebook(file.text));
        setSource(file.text);
        setError(null);
        setElsewhere(false);
        const cache = await invoke<Record<string, PyOutput>>("load_workspace", { name: `nbpy-${encodeURIComponent(which)}` }).catch(() => ({}));
        setPy(cache);
      } catch {
        setDoc(null);
        onOpenRef.current(undefined);
        setView("new");
      }
    },
    [],
  );
  useEffect(() => {
    setEditing(null);
    if (name) {
      setView((v) => (v === "new" ? "doc" : v));
      load(name);
    } else {
      setDoc(null);
      setView("new");
    }
  }, [name, load]);

  /** a change: on screen now, in the file a moment later (`text`: exactly
   * this, as typed in Source — not rewritten from the blocks) */
  const commit = useCallback(
    (next: NotebookDoc, text?: string) => {
      setDoc(next);
      if (!name) return;
      setSaving(true);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        text ??= writeNotebook(next);
        try {
          lastModified.current = await invoke<number>("write_notebook", { name, text });
          setSource(text);
        } catch (err) {
          setError(`Couldn't save: ${errorText(err)}`);
        }
        setSaving(false);
      }, 350);
    },
    [name],
  );
  // a save still waiting when the tile closes happens now
  useEffect(
    () => () => {
      if (saveTimer.current && name && docRef.current) {
        clearTimeout(saveTimer.current);
        invoke("write_notebook", { name, text: writeNotebook(docRef.current) }).catch(() => {});
      }
    },
    [name],
  );

  // another editor saved it (Neovim, Obsidian…): show what it saved —
  // unless a block is being edited here, then ask first
  useEffect(() => {
    if (!name) return;
    const timer = setInterval(async () => {
      if (saving) return;
      const m = await invoke<number>("notebook_modified", { name }).catch(() => 0);
      if (!m || m === lastModified.current) return;
      if (editing || view === "source") setElsewhere(true);
      else {
        await load(name);
        setNotice("Updated — it was saved in another editor");
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [name, editing, view, saving, load]);

  // → Notebook from Calculate, Work or Graph lands here while it's open
  useEffect(() => {
    if (!name || !doc) return;
    setNotebookInbox((markdown) => {
      const current = docRef.current;
      if (!current) return false;
      commit({ ...current, blocks: [...current.blocks, ...parseNotebook(markdown).blocks] });
      setNotice("Added at the end");
      // down to where it landed
      setTimeout(() => page.current?.scrollTo({ top: page.current.scrollHeight, behavior: "smooth" }), 120);
      return true;
    });
    return () => setNotebookInbox(null);
  }, [name, doc, commit]);

  // ---- calc cells: worked out top to bottom whenever one changes
  const calcCodes = useMemo(() => (doc?.blocks ?? []).filter((b) => b.kind === "cell" && b.lang === "calc").map((b) => (b as { code: string }).code), [doc]);
  const calcKey = calcCodes.join("\u0001");
  useEffect(() => {
    let live = true;
    if (!calcCodes.length) {
      setCalc([]);
      return;
    }
    const timer = setTimeout(() => runCalcCells(calcCodes).then((out) => live && setCalc(out)), 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [calcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- python cells: ▶ runs a cell and every Python cell above it
  const codesOf = (d: NotebookDoc | null) => (d?.blocks ?? []).filter((b) => b.kind === "cell" && b.lang === "python").map((b) => (b as { code: string }).code);
  const pythonCodes = codesOf(doc);
  const runPython = async (through: number) => {
    // the notebook as it is now (a cell just edited included)
    const all = codesOf(docRef.current);
    const cells = all.slice(0, through + 1);
    setRunning(new Set(cells));
    try {
      const r = await mathRequest<{ cells: PyOutput[] }>({ op: "pyrun", cells });
      const next = { ...py };
      cells.forEach((code, i) => (next[code] = r.cells[i] ?? {}));
      // only what's in the notebook now is kept
      const kept = Object.fromEntries(Object.entries(next).filter(([code]) => all.includes(code)));
      setPy(kept);
      if (name) invoke("save_workspace", { name: `nbpy-${encodeURIComponent(name)}`, data: kept }).catch(() => {});
    } catch (err) {
      setPy({ ...py, [cells[cells.length - 1]]: { error: errorText(err) } });
    }
    setRunning(new Set());
  };

  // ---- blocks

  const updateBlock = (id: string, patch: Partial<Block>) => doc && commit({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) });
  const removeBlock = (id: string, quiet = false) => {
    if (!doc) return;
    const at = doc.blocks.findIndex((b) => b.id === id);
    if (at < 0) return;
    if (!quiet) setUndo({ block: doc.blocks[at], at });
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
  };
  const putBack = () => {
    if (!doc || !undo) return;
    const blocks = [...doc.blocks];
    blocks.splice(Math.min(undo.at, blocks.length), 0, undo.block);
    commit({ ...doc, blocks });
    setUndo(null);
  };
  const moveBlock = (id: string, by: number) => {
    if (!doc) return;
    const at = doc.blocks.findIndex((b) => b.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
    commit({ ...doc, blocks });
  };
  const addBlock = (kind: (typeof NEW_CELLS)[number]) => {
    if (!doc) return;
    const id = blockId();
    const block: Block = kind.lang === "text" || kind.lang === "math" ? { id, kind: "text", text: kind.start } : { id, kind: "cell", lang: kind.lang, info: "", code: kind.start };
    commit({ ...doc, blocks: [...doc.blocks, block] });
    setEditing(id);
    setDraft(kind.start);
  };
  const startEditing = (b: Block) => {
    setEditing(b.id);
    setDraft(b.kind === "text" ? b.text : b.code);
  };
  /** done editing a block: kept (an empty text block goes) */
  const finishEditing = () => {
    if (!editing || !doc) return setEditing(null);
    const b = doc.blocks.find((x) => x.id === editing);
    setEditing(null);
    if (!b) return;
    if (b.kind === "text") {
      if (!draft.trim()) removeBlock(b.id, true);
      else if (draft !== b.text) updateBlock(b.id, { text: draft });
    } else if (draft !== b.code) updateBlock(b.id, { code: draft });
  };
  const editKeys = (e: KeyboardEvent<HTMLTextAreaElement>, b: Block) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      finishEditing();
      if (b.kind === "cell" && b.lang === "python" && e.key === "Enter") {
        const at = doc!.blocks.filter((x) => x.kind === "cell" && x.lang === "python").findIndex((x) => x.id === b.id);
        setTimeout(() => runPython(at), 60);
      }
    } else if (e.key === "Tab" && b.kind === "cell") {
      // code indents with spaces (Python cares)
      e.preventDefault();
      const el = e.currentTarget;
      const at = el.selectionStart;
      const next = `${draft.slice(0, at)}    ${draft.slice(el.selectionEnd)}`;
      setDraft(next);
      requestAnimationFrame(() => el.setSelectionRange(at + 4, at + 4));
    }
  };

  /** [[another notebook]] opens it (or starts it); web links open outside */
  const followLinks = (e: MouseEvent<HTMLElement>) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link) return false;
    e.preventDefault();
    e.stopPropagation();
    const note = link.getAttribute("data-note");
    if (note) openOrCreate(note);
    else if (link.getAttribute("href")?.match(/^(https?:|mailto:)/)) openUrl(link.getAttribute("href")!).catch(() => {});
    return true;
  };

  // ---- notebooks: new, open, rename, template, trash

  const uniqueName = (base: string) => {
    const taken = new Set(listing.map((l) => l.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  };
  const create = async (template: Template) => {
    const base = newName.trim() || `${DEFAULT_NAMES[template.id] ?? template.name} — ${shortDate()}`;
    const fresh = uniqueName(base.replace(/[/\\:]/g, "-"));
    try {
      await invoke("write_notebook", { name: fresh, text: template.build(fresh, work) });
      setNewName("");
      await refreshListing();
      setView("doc");
      onOpen(fresh);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const openOrCreate = async (which: string) => {
    setSwitcher(false);
    if (!listing.some((l) => l.name === which)) {
      await invoke("write_notebook", { name: which, text: TEMPLATES[0].build(which, work) }).catch(() => {});
      await refreshListing();
    }
    setView("doc");
    onOpen(which);
  };
  const rename = async (to: string) => {
    if (!name || !to.trim() || to.trim() === name) return setPrompt(null);
    try {
      await invoke("rename_notebook", { from: name, to: to.trim() });
      setPrompt(null);
      await refreshListing();
      onOpen(to.trim());
    } catch (err) {
      setError(errorText(err));
    }
  };
  const saveTemplate = async (as: string) => {
    if (!doc || !as.trim()) return setPrompt(null);
    const withHolders = setMeta(setMeta(doc, "title", "{{title}}"), "date", "{{date}}");
    await invoke("save_template", { name: as.trim(), text: writeNotebook(withHolders) }).catch((err) => setError(errorText(err)));
    setPrompt(null);
    setNotice(`Saved as the template “${as.trim()}”`);
    refreshListing();
  };
  const trash = async () => {
    if (!name) return;
    setMenu(false);
    await invoke("trash_notebook", { name }).catch((err) => setError(errorText(err)));
    await refreshListing();
    onOpen(undefined);
    setNotice(`Moved “${name}” to the trash folder (Notebooks/.trash)`);
  };
  const addFinished = () => {
    if (!doc) return;
    setMenu(false);
    const have = doc.blocks.filter((b) => b.kind === "text" && /^## Problem/m.test(b.text)).length;
    const added = work.map((e, i) => problemSection(e, have + i + 1)).join("\n\n");
    commit({ ...doc, blocks: [...doc.blocks, ...parseNotebook(added).blocks] });
    setNotice(`Added ${work.length} finished problem${work.length === 1 ? "" : "s"} from Work`);
  };
  const reveal = async () => {
    setMenu(false);
    const folder = await invoke<string>("notebook_folder").catch(() => null);
    if (folder) revealItemInDir(name ? `${folder}/${name}.md` : folder).catch(() => {});
  };
  const copyPath = async () => {
    setMenu(false);
    const folder = await invoke<string>("notebook_folder").catch(() => null);
    if (folder && name) {
      await navigator.clipboard.writeText(`${folder}/${name}.md`).catch(() => {});
      setNotice("Copied — nvim and paste to open it there");
    }
  };
  const print = async () => {
    if (!doc || !name) return;
    try {
      const html = await notebookHtml(doc, name, calc, py);
      await invoke("print_document", { name: metaValue(doc, "title") || name, html });
      setNotice("Opened in your browser — ⌘P to print or Save as PDF");
    } catch (err) {
      setError(`Couldn't make the page: ${errorText(err)}`);
    }
  };

  // ---- the parts of the tile

  const toolbar = (
    <div className="nb-bar">
      <div className="nb-switch">
        <button className={`nb-switch-btn${switcher ? " is-on" : ""}`} title="Your notebooks" onClick={() => (refreshListing(), setSwitcher(!switcher))}>
          <Icon name="notebook" size={15} />
          <span className="nb-switch-name">{view === "new" ? "New notebook" : name ?? "Notebooks"}</span>
          {saving && <span className="nb-saving" title="Saving…" />}
          <Icon name="chevron" size={13} />
        </button>
        {switcher && (
          <div className="nb-pop" onMouseLeave={() => setSwitcher(false)}>
            <button className="nb-pop-item is-new" onClick={() => (setSwitcher(false), setView("new"))}>
              <Icon name="plus" size={14} /> New notebook…
            </button>
            {listing.length > 0 && <div className="nb-pop-line" />}
            {listing.map((l) => (
              <button key={l.name} className={`nb-pop-item${l.name === name ? " is-here" : ""}`} onClick={() => openOrCreate(l.name)}>
                <Icon name="notebook" size={14} />
                <span className="nb-pop-name">{l.name}</span>
              </button>
            ))}
            <div className="nb-pop-line" />
            <button className="nb-pop-item" onClick={reveal}>
              <Icon name="folder" size={14} /> Show the folder
            </button>
          </div>
        )}
      </div>
      {view !== "new" && doc && (
        <div className="nb-tools">
          {pythonCodes.length > 0 && (
            <button className="nb-tool" title="Run every Python cell, top to bottom" onClick={() => runPython(pythonCodes.length - 1)}>
              <Icon name="run" size={14} /> Run all
            </button>
          )}
          <button
            className={`nb-tool${view === "source" ? " is-on" : ""}`}
            title="The whole file as Markdown, to edit as text"
            onClick={() => {
              if (view === "source") setView("doc");
              else {
                finishEditing();
                setSource(writeNotebook(doc));
                setView("source");
              }
            }}
          >
            <Icon name="source" size={14} /> Source
          </button>
          <button className="nb-tool" title="Print it, or ⌘P → Save as PDF" onClick={print}>
            <Icon name="print" size={14} /> Print / PDF
          </button>
          <div className="nb-switch">
            <button className={`nb-tool is-icon${menu ? " is-on" : ""}`} title="More" onClick={() => setMenu(!menu)}>
              <Icon name="more" size={16} />
            </button>
            {menu && (
              <div className="nb-pop is-right" onMouseLeave={() => (setMenu(false), setPrompt(null))}>
                {work.length > 0 && (
                  <button className="nb-pop-item" onClick={addFinished}>
                    <Icon name="work" size={14} /> Add the {work.length} finished problem{work.length === 1 ? "" : "s"} from Work
                  </button>
                )}
                {prompt ? (
                  <div className="nb-prompt">
                    <input
                      autoFocus
                      value={prompt.value}
                      placeholder={prompt.kind === "rename" ? "New name" : "Template name"}
                      onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && (prompt.kind === "rename" ? rename(prompt.value) : saveTemplate(prompt.value))}
                    />
                    <button onClick={() => (prompt.kind === "rename" ? rename(prompt.value) : saveTemplate(prompt.value))}>{prompt.kind === "rename" ? "Rename" : "Save"}</button>
                  </div>
                ) : (
                  <>
                    <button className="nb-pop-item" onClick={() => setPrompt({ kind: "rename", value: name ?? "" })}>
                      <Icon name="pen" size={14} /> Rename…
                    </button>
                    <button className="nb-pop-item" onClick={() => setPrompt({ kind: "template", value: metaValue(doc, "template") || "" })}>
                      <Icon name="copy" size={14} /> Save as a template…
                    </button>
                  </>
                )}
                <button className="nb-pop-item" onClick={reveal}>
                  <Icon name="folder" size={14} /> Show in Finder
                </button>
                <button className="nb-pop-item" onClick={copyPath}>
                  <Icon name="source" size={14} /> Copy its path (for Neovim)
                </button>
                <div className="nb-pop-line" />
                <button className="nb-pop-item is-danger" onClick={trash}>
                  <Icon name="trash" size={14} /> Move to trash
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const gallery = (
    <div className="nb-gallery">
      <div className="nb-gallery-head">
        <h2>New notebook</h2>
        <p>Pick what it starts as. It's a Markdown file in Documents/MatrixLab/Notebooks — open it in Neovim or Obsidian too.</p>
        <input className="nb-gallery-name" value={newName} placeholder={`Its name (or “Homework — ${shortDate()}”…)`} onChange={(e) => setNewName(e.target.value)} />
      </div>
      <div className="nb-gallery-grid">
        {[...TEMPLATES, ...mine].map((t) => (
          <button key={t.id} className="nb-template" style={{ "--tile-hue": `var(--t-${t.hue})` } as CSSProperties} onClick={() => create(t)}>
            <span className="nb-template-icon">
              <Icon name={t.icon} size={20} />
            </span>
            <span className="nb-template-name">
              {t.name}
              {t.id === "assignment" && work.length > 0 && <span className="nb-template-note">{work.length} from Work</span>}
            </span>
            <span className="nb-template-blurb">{t.blurb}</span>
          </button>
        ))}
      </div>
      {name && (
        <button className="nb-link" onClick={() => setView("doc")}>
          ← Back to {name}
        </button>
      )}
    </div>
  );

  const header = doc && (
    <div className="nb-header">
      {headerOpen ? (
        <div className="nb-header-form">
          {[...HEADER_FIELDS, ...doc.meta.filter(([k]) => !HEADER_FIELDS.some(([f]) => f === k.toLowerCase()) && k !== "template").map(([k]) => [k, k] as [string, string])].map(([key, label]) => (
            <label key={key} className="nb-field">
              <span>{label}</span>
              <input value={metaValue(doc, key)} onChange={(e) => commit(setMeta(doc, key, e.target.value))} />
            </label>
          ))}
          <button className="nb-link" onClick={() => setHeaderOpen(false)}>
            Done
          </button>
        </div>
      ) : (
        <button className="nb-header-view" title="Edit the header — title, name, class, date" onClick={() => setHeaderOpen(true)}>
          <span className="nb-title">{metaValue(doc, "title") || name}</span>
          <span className="nb-meta">
            {[metaValue(doc, "name"), metaValue(doc, "course"), metaValue(doc, "instructor"), metaValue(doc, "date")].filter(Boolean).join(" · ") || "+ name, class, date"}
          </span>
        </button>
      )}
    </div>
  );

  const blockView = (b: Block, calcAt: number, pyAt: number): ReactNode => {
    const isEditing = editing === b.id;
    const tools = (
      <span className="nb-block-tools">
        <button title="Move up" onClick={() => moveBlock(b.id, -1)}>
          <Icon name="up" size={13} />
        </button>
        <button title="Move down" onClick={() => moveBlock(b.id, 1)}>
          <Icon name="down" size={13} />
        </button>
        <button title="Delete this block" onClick={() => removeBlock(b.id)}>
          <Icon name="trash" size={13} />
        </button>
      </span>
    );
    if (b.kind === "text") {
      return (
        <div key={b.id} className={`nb-block is-text${isEditing ? " is-editing" : ""}`}>
          {isEditing ? (
            <AutoText value={draft} onChange={setDraft} onBlur={finishEditing} onKeyDown={(e) => editKeys(e, b)} placeholder="Write — **bold**, *italic*, # heading, - list, $x^2$, $$math$$, [[another notebook]]" />
          ) : (
            <div className="nb-md" onClick={(e) => followLinks(e) || startEditing(b)} dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
          )}
          {!isEditing && tools}
        </div>
      );
    }
    const label = LANG_LABEL[b.lang] ?? b.lang;
    const result =
      b.lang === "calc" ? (
        <CalcCell lines={calc?.[calcAt]} />
      ) : b.lang === "graph" ? (
        <GraphCell id={b.id} code={isEditing ? draft : b.code} />
      ) : b.lang === "numberline" ? (
        <NumberLineCell code={isEditing ? draft : b.code} />
      ) : b.lang === "work" ? (
        <WorkCell code={isEditing ? draft : b.code} />
      ) : b.lang === "python" ? (
        <PythonOutput output={py[b.code]} running={running.has(b.code)} />
      ) : null;
    const showCode = isEditing || b.lang === "python" || !result;
    return (
      <div key={b.id} className={`nb-block is-cell is-${b.lang}${isEditing ? " is-editing" : ""}`}>
        <div className="nb-cell-head">
          <span className="nb-cell-lang">{label}</span>
          {b.lang === "python" && (
            <button className="nb-run" title="Run this cell (and every Python cell above it) — ⌘⏎" onClick={() => runPython(pyAt)}>
              <Icon name="run" size={12} /> Run
            </button>
          )}
          {!isEditing && b.lang !== "python" && result && (
            <button className="nb-cell-edit" onClick={() => startEditing(b)}>
              edit
            </button>
          )}
        </div>
        {showCode &&
          (isEditing ? (
            <AutoText value={draft} onChange={setDraft} onBlur={finishEditing} onKeyDown={(e) => editKeys(e, b)} mono />
          ) : (
            <pre className="nb-code" onClick={() => startEditing(b)}>
              {b.code || " "}
            </pre>
          ))}
        {result && (
          <div className="nb-cell-result" onClick={() => !isEditing && b.lang !== "python" && b.lang !== "graph" && startEditing(b)}>
            {result}
          </div>
        )}
        {!isEditing && tools}
      </div>
    );
  };

  let calcAt = 0;
  let pyAt = 0;
  return (
    <div className="nb">
      {toolbar}
      {error && (
        <div className="nb-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {elsewhere && name && (
        <div className="nb-elsewhere">
          It was changed in another editor.
          <button onClick={() => (setEditing(null), setView("doc"), load(name))}>Show that version</button>
          <button onClick={() => setElsewhere(false)}>Keep mine</button>
        </div>
      )}
      {notice && !undo && <div className="nb-notice">{notice}</div>}
      {undo && (
        <div className="nb-notice is-undo">
          Deleted a {undo.block.kind === "text" ? "text block" : `${LANG_LABEL[undo.block.lang] ?? undo.block.lang} cell`}
          <button onClick={putBack}>Undo</button>
        </div>
      )}
      {view === "new" || !doc ? (
        gallery
      ) : view === "source" ? (
        <div className="nb-source">
          <textarea
            className="nb-source-text"
            value={source}
            spellCheck={false}
            onChange={(e) => {
              setSource(e.target.value);
              commit(parseNotebook(e.target.value), e.target.value);
            }}
          />
        </div>
      ) : (
        <div className="nb-page" ref={page}>
          {header}
          {doc.blocks.map((b) => blockView(b, b.kind === "cell" && b.lang === "calc" ? calcAt++ : -1, b.kind === "cell" && b.lang === "python" ? pyAt++ : -1))}
          {!doc.blocks.length && <div className="nb-empty">An empty page — add something below, or open the file in another editor.</div>}
          <div className="nb-add">
            {NEW_CELLS.map((c) => (
              <button key={c.lang} className="nb-add-btn" onClick={() => addBlock(c)}>
                <Icon name={c.icon} size={13} /> {c.label}
              </button>
            ))}
          </div>
          <div className="nb-foot">Saved as {name}.md · {todayLabel()}</div>
        </div>
      )}
    </div>
  );
}
