/** The Notebook tile: notebooks are Markdown files (~/Documents/MatrixLab/
 * Notebooks) shown as pages — the header from the front matter, text and
 * math, and cells that work themselves out (calc, graph, number line, work,
 * python — and code in any language a plugin adds: MATLAB, C++…, see
 * languages.ts). Click a block to edit its Markdown; click away and it's a page
 * again. Every change is saved as you go, and a save from another editor
 * (Neovim, Obsidian…) shows up here by itself.
 *
 * New notebooks start from a template: Blank, Assignment (filled with the
 * problems finished in Work — what the Assignment tab did), Lab report,
 * Study notes, Script, and your own (any notebook → Save as template). */
import { toJpeg, toPng } from "html-to-image";
import { type CSSProperties, Fragment, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import Icon from "../Icon";
import type { AssignmentInfo, WorkHistoryEntry } from "../store";
import { todayLabel } from "../workHistory";
import { type CalcLine, GraphCell, NumberLineCell, type PyOutput, PythonOutput, VarsCell, VarsRecord, WhenSeen, WorkCell, WorkCellEditor, drawEverything, numberOf, parseVars, plots, readWorkCell, runCalcCells, varsAsCalc } from "./cells";
import { type Block, type CellLang, type NotebookDoc, type Placement, PRINT_SWITCHES, blockId, metaValue, parseNotebook, printSwitches, rowsOf, scopeChain, scopesOf, setMeta, widthsOf, writeNotebook } from "./format";
import { setNotebookInbox } from "./inbox";
import { notebookLatex } from "./latex";
import { renderMarkdown } from "./markdown";
import Preview from "./Preview";
import { notebookHtml } from "./print";
import { TEMPLATES, type Template, problemSection, userTemplate } from "./templates";
import { fromIpynb, mainLanguage, toIpynb, toScript } from "./jupyter";
import { highlightCode, highlightWithError } from "./highlight";
import { type Language, languageOf, useLanguages } from "./languages";
import { type CellKind, cellKindOf, usePlugins } from "../plugins";
import CodeEditor, { PYTHON_SPEC } from "./CodeEditor";
import { CalcLive, CalcRecord, MathBlockLive, mathRowsOf } from "./apps";
import { toggleTask, writingKey } from "./writing";
import { TableBlock } from "./tableBlock";
import type { EditorView, KeyBinding } from "@codemirror/view";
import Library, { QuickOpen } from "./Library";
import FormatBar from "./FormatBar";
import { LINKED_LANGS, appDataFor, canLink, closeLinked, codeFor, linkedApp, linkedId, openLinked, rescopeLinked, useLinkedApps, watchLinked } from "./linked";
import type { Equation } from "../equations";
import { GraphLive, GraphRecord } from "./graphBlock";
import { setVimKeys, useVimKeys } from "./editorSettings";
import { useParts } from "../parts";
import "./notebook.css";

type Listing = { name: string; modified: number }[];

/** what the notebook does with Work: the problems finished there come in
 * (and leave Work's list — Undo puts them back), the one being worked on
 * can be added as it stands, and a problem can go back to Work to fix */
export interface NotebookWork {
  finished: WorkHistoryEntry[];
  take: (ids: string[]) => void;
  giveBack: (entries: WorkHistoryEntry[]) => void;
  inProgress: boolean;
  fileInProgress: () => Promise<WorkHistoryEntry | null>;
  /** false: Work has a problem going (finish or clear it first) */
  reopen: (problem: string, lines: string[], reasons: string[]) => boolean;
  /** who hands it in (name, class, teacher) — last time's, kept for next */
  me: AssignmentInfo;
  rememberMe: (patch: AssignmentInfo) => void;
}

const errorText = (err: unknown) => String(err).replace(/^Error:\s*/, "");
/** "Nov 1" — for a new notebook's name */
const shortDate = () => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
const DEFAULT_NAMES: Record<string, string> = { blank: "Notebook", assignment: "Homework", lab: "Lab report", notes: "Notes", script: "Script" };

/** the header's fields that are the print switches (shown as switches) */
const SWITCH_KEYS: string[] = PRINT_SWITCHES.map((p) => p.key);
/** the header's fields kept for the next assignment */
const ME_KEYS: Record<string, keyof AssignmentInfo> = { name: "name", course: "course", instructor: "instructor" };

/** the header's fields, labelled; any others the file has follow */
const HEADER_FIELDS: [string, string][] = [
  ["title", "Title"],
  ["name", "Name"],
  ["course", "Class"],
  ["instructor", "Teacher"],
  ["date", "Date"],
];

/** what each kind of cell starts as (the Extensions panel can leave any out of the add buttons) */
export const NEW_CELLS: { lang: CellLang | "text" | "math"; label: string; icon: string; start: string }[] = [
  { lang: "text", label: "Text", icon: "text", start: "" },
  { lang: "math", label: "Math", icon: "equations", start: "$$\n\n$$" },
  { lang: "vars", label: "Variables", icon: "variables", start: "m = 2.5 kg  # the cart's mass\ng = 9.81  # gravity, m/s²" },
  { lang: "calc", label: "Calculate", icon: "calc", start: "" },
  { lang: "graph", label: "Graph", icon: "graph", start: "y = 2x + 1" },
  { lang: "table", label: "Table", icon: "table", start: "x\ty\n0\t\n1\t\n2\t" },
  { lang: "numberline", label: "Number line", icon: "segment", start: "x < 3" },
  { lang: "work", label: "Work", icon: "work", start: "problem: 2x + 3 = 11\n" },
  { lang: "python", label: "Python", icon: "source", start: "" },
];

const LANG_LABEL: Record<string, string> = { table: "Table", vars: "Variables", calc: "Calculate", graph: "Graph", numberline: "Number line", work: "Work", python: "Python" };
/** the cells the app works out itself; any other fence is a language's (a plugin's) */
const OWN_CELLS = new Set(["vars", "calc", "graph", "numberline", "work", "python", "table"]);
/** cells worked out by the calculator, in order: calc lines, and variables blocks (as name = value) */
const isCalcLike = (b: Block) => b.kind === "cell" && (b.lang === "calc" || b.lang === "vars");
/** a cell's language, when a plugin's — not one of the app's own */
const codeLanguage = (b: Block) => (b.kind === "cell" && !OWN_CELLS.has(b.lang) ? languageOf(b.lang) : undefined);
/** a flattened cell's picture (its path from the Notebooks folder), from its fence: ```graph flat=… */
const flatOf = (b: Block) => (b.kind === "cell" ? decodeURIComponent(b.info.match(/(?:^|\s)flat=(\S+)/)?.[1] ?? "") || null : null);
const withFlat = (info: string, path: string | null) => [info.replace(/(?:^|\s)flat=\S+/, "").trim(), path ? `flat=${encodeURIComponent(path)}` : ""].filter(Boolean).join(" ");
/** an app block's record picture, taken when it was last done (a graph): ```graph shot=… — click to work in it again */
const shotOf = (b: Block) => (b.kind === "cell" ? decodeURIComponent(b.info.match(/(?:^|\s)shot=(\S+)/)?.[1] ?? "") || null : null);
const withShot = (info: string, path: string | null) => [info.replace(/(?:^|\s)shot=\S+/, "").trim(), path ? `shot=${encodeURIComponent(path)}` : ""].filter(Boolean).join(" ");
/** a word on a cell's fence that changes how it shows: hide-code (on the page and the printed one), fold-output */
const hasFlag = (b: Block, flag: string) => b.kind === "cell" && b.info.split(/\s+/).includes(flag);
const withFlag = (info: string, flag: string, on: boolean) => [...info.split(/\s+/).filter((w) => w && w !== flag), ...(on ? [flag] : [])].join(" ");
/** pictures read once, kept while the app runs */
const flatPictures = new Map<string, string>();
function FlatPicture({ path, fill = false }: { path: string; fill?: boolean }) {
  const [src, setSrc] = useState(flatPictures.get(path) ?? null);
  const [natural, setNatural] = useState(0);
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    if (flatPictures.has(path)) return setSrc(flatPictures.get(path)!);
    invoke<string>("flat_read", { path })
      .then((url) => (flatPictures.set(path, url), setSrc(url)))
      .catch((err) => setGone(String(err)));
  }, [path]);
  if (gone) return <div className="nb-cell-wait">{gone} — Unflatten to work it out again</div>;
  // (pictures are taken at twice their size on the page, for sharpness)
  return src ? (
    <img className="nb-flat" src={src} alt="the cell, flattened to a picture" draggable={false} style={fill ? { width: "100%" } : natural ? { width: natural / 2 } : undefined} onLoad={(e) => setNatural(e.currentTarget.naturalWidth)} />
  ) : (
    <div className="nb-cell-wait">…</div>
  );
}
/** where a cell's output is kept: Python's by its code, any other language's by both */
const outKey = (lang: string, code: string) => (lang === "python" ? code : `${lang}\u0001${code}`);

/** a plugin's cell: what its render(code) gives, as the page shows it */
function PluginCell({ kind, code }: { kind: CellKind; code: string }) {
  const [html, setHtml] = useState<string>("");
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => kind.render(code))
      .then((out) => live && (setHtml(String(out ?? "")), setFailed(null)))
      .catch((err) => live && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [kind, code]);
  if (failed) return <pre className="nb-cell-error is-code">{`${kind.plugin}: ${failed}`}</pre>;
  return <div className="nb-plugin-out" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function NotebookTile({
  name,
  onOpen,
  work,
  calcVars,
  equations = [],
}: {
  /** your saved equations (the Equations tile's), for a calc block's ƒ */
  equations?: Equation[];
  name?: string;
  onOpen: (name: string | undefined) => void;
  work: NotebookWork;
  /** the calculator's variables — Python cells see them as calc.m, calc["w"] */
  calcVars?: Record<string, number | null>;
}) {
  const [doc, setDoc] = useState<NotebookDoc | null>(null);
  const [view, setView] = useState<"doc" | "source" | "new">(name ? "doc" : "new");
  const [listing, setListing] = useState<Listing>([]);
  const [mine, setMine] = useState<Template[]>([]);
  const [switcher, setSwitcher] = useState(false);
  const [menu, setMenu] = useState(false);
  const [prompt, setPrompt] = useState<{ kind: "rename" | "template"; value: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** what was just done, to take back (for a few seconds) */
  const [undo, setUndo] = useState<{ label: string; button: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditingState] = useState<string | null>(null);
  /** the block being edited, as of now — an app block finishing a moment later (a graph taking its
   * picture) mustn't finish whichever block is being edited by then */
  const editingRef = useRef<string | null>(null);
  const setEditing = (id: string | null) => {
    editingRef.current = id;
    setEditingState(id);
  };
  const [draft, setDraft] = useState("");
  /** the block picked with the keys (Esc out of one, then j/k) — as in Jupyter's command mode */
  const [picked, setPicked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** the last plain key, for dd */
  const lastKey = useRef({ key: "", at: 0 });
  const toldKeys = useRef(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [source, setSource] = useState("");
  const [calc, setCalc] = useState<CalcLine[][] | null>(null);
  const [py, setPy] = useState<Record<string, PyOutput>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const allLanguages = useLanguages();
  const plugins = usePlugins();
  const { offCells } = useParts();
  /** the notebook's Python: off (not started), idle, or running a cell */
  const [kernel, setKernel] = useState<"off" | "idle" | "busy">("off");
  /** reactive: running a cell reruns the cells below that use what it made */
  const [reactive, setReactive] = useState(() => {
    try {
      return localStorage.getItem("nb-reactive") === "1";
    } catch {
      return false;
    }
  });
  const [varsOpen, setVarsOpen] = useState(false);
  // ---- find (and replace) in the notebook: every block's text and code
  const [finding, setFinding] = useState<{ find: string; replace: string; at: number; replacing: boolean } | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  /** where it's found: each block, each place in it */
  const found = useMemo(() => {
    const q = finding?.find;
    if (!q || !doc) return [] as { id: string; index: number }[];
    const out: { id: string; index: number }[] = [];
    const lower = q.toLowerCase();
    for (const b of doc.blocks) {
      const text = (b.kind === "text" ? b.text : b.code).toLowerCase();
      for (let k = text.indexOf(lower); k >= 0; k = text.indexOf(lower, k + Math.max(1, lower.length))) out.push({ id: b.id, index: k });
    }
    return out;
  }, [finding?.find, doc]);
  const foundIds = useMemo(() => new Set(found.map((f) => f.id)), [found]);
  const currentFound = finding && found.length ? found[((finding.at % found.length) + found.length) % found.length] : null;
  useEffect(() => {
    if (!currentFound) return;
    document.querySelector(`[data-block="${currentFound.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentFound?.id, currentFound?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  const startFinding = () => {
    setFinding((f) => f ?? { find: "", replace: "", at: 0, replacing: false });
    requestAnimationFrame(() => findInput.current?.select());
  };
  /** the one it's on (or every one) swapped for the replacement, in the file */
  const replaceFound = (all: boolean) => {
    if (!finding?.find || !doc) return;
    const swap = (text: string, only?: number) => {
      const lower = text.toLowerCase();
      const q = finding.find.toLowerCase();
      let out = "";
      let from = 0;
      for (let k = lower.indexOf(q); k >= 0; k = lower.indexOf(q, k + q.length)) {
        if (only !== undefined && k !== only) continue;
        out += text.slice(from, k) + finding.replace;
        from = k + q.length;
      }
      return out + text.slice(from);
    };
    commit({
      ...doc,
      blocks: doc.blocks.map((b) => {
        if (!foundIds.has(b.id) || (!all && b.id !== currentFound?.id)) return b;
        const only = all ? undefined : currentFound!.index;
        return b.kind === "text" ? { ...b, text: swap(b.text, only) } : { ...b, code: swap(b.code, only) };
      }),
    });
  };
  /** the other languages' variables (MATLAB's workspace…), by language */
  const [langVars, setLangVars] = useState<Record<string, { name: string; type: string; shape: string; value: string }[]>>({});
  const [vars, setVars] = useState<{ name: string; type: string; shape: number[] | null; value: string }[]>([]);
  const importer = useRef<HTMLInputElement>(null);
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
  // ⌘Z / ⌘⇧Z: back and forward through the notebook's changes (this notebook's, since it was opened)
  const past = useRef<NotebookDoc[]>([]);
  const future = useRef<NotebookDoc[]>([]);
  const lastStep = useRef(0);
  const restoring = useRef(false);
  useEffect(() => {
    past.current = [];
    future.current = [];
  }, [name]);
  const commit = useCallback(
    (next: NotebookDoc, text?: string) => {
      // what it was, for ⌘Z — changes close together (a drag, typing in a table) as one step
      const before = docRef.current;
      if (before && before !== next && !restoring.current) {
        if (Date.now() - lastStep.current > 700) {
          past.current.push(before);
          if (past.current.length > 200) past.current.shift();
        }
        lastStep.current = Date.now();
        future.current = [];
      }
      // the latest at once, so changes made one after another (flatten every graph) build on each other
      docRef.current = next;
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
  /** each block's scope: the headers it sits under (headers are scope, as Python's indentation is) */
  const scopes = useMemo(() => scopesOf(doc?.blocks ?? []), [doc]);
  const calcCells = useMemo(
    () =>
      (doc?.blocks ?? []).flatMap((b, k) =>
        isCalcLike(b) && b.kind === "cell" ? [{ code: b.lang === "vars" ? varsAsCalc(b.code) : b.code, scope: scopes[k] }] : [],
      ),
    [doc, scopes],
  );
  /** what each block can see of the variables blocks' values, as numbers (in the units given) —
   * its section's and the sections it's inside, up to it; for Python and code cells */
  const varsAt = useMemo(() => {
    const own = new Map<string, Record<string, number>>();
    const at = new Map<string, Record<string, number>>();
    let k = 0;
    (doc?.blocks ?? []).forEach((b, i) => {
      const chain = scopeChain(scopes[i] ?? []);
      if (isCalcLike(b)) {
        const lines = calc?.[k++];
        if (b.kind === "cell" && b.lang === "vars" && lines) {
          const mine = own.get(chain[chain.length - 1]) ?? {};
          parseVars(b.code)
            .filter((r) => r.name && r.value)
            .forEach((r, j) => {
              const n = numberOf(lines[j]);
              if (n !== null && /^[A-Za-z_]\w*$/.test(r.name)) mine[r.name] = n;
            });
          own.set(chain[chain.length - 1], mine);
        }
      }
      at.set(b.id, Object.assign({}, ...chain.map((c) => own.get(c) ?? {})));
    });
    return at;
  }, [doc, calc, scopes]);
  /** each calc or variables block's place among the worked-out ones */
  const calcIndex = useMemo(() => {
    const m = new Map<string, number>();
    let k = 0;
    for (const b of doc?.blocks ?? []) if (isCalcLike(b)) m.set(b.id, k++);
    return m;
  }, [doc]);
  const varsAtRef = useRef(varsAt);
  varsAtRef.current = varsAt;
  /** a cell's section (by its code): the headers it's under — Python keeps each section's names apart */
  const scopeFor = (lang: string, code: string) => {
    const blocks = docRef.current?.blocks ?? [];
    const at = blocks.findIndex((x) => x.kind === "cell" && x.lang === lang && x.code === code);
    return at < 0 ? [] : (scopesOf(blocks)[at] ?? []);
  };
  /** the variables a cell (by its code) can see */
  const varsFor = (lang: string, code: string) => {
    const b = docRef.current?.blocks.find((x) => x.kind === "cell" && x.lang === lang && x.code === code);
    return (b && varsAtRef.current.get(b.id)) ?? {};
  };
  const calcKey = JSON.stringify(calcCells);
  useEffect(() => {
    let live = true;
    if (!calcCells.length) {
      setCalc([]);
      return;
    }
    const timer = setTimeout(() => runCalcCells(calcCells).then((out) => live && setCalc(out)), 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [calcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- python cells: a kernel of the notebook's own, kept running (like
  // Jupyter's) — what one cell makes, the next can use. Runs wait their turn.
  /** the headings, in order: the outline */
  const outline = useMemo(
    () =>
      (doc?.blocks ?? []).flatMap((b) =>
        b.kind === "text" ? [...b.text.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((m) => ({ id: b.id, level: m[1].length, text: m[2].replace(/[*_`$]/g, "") })) : [],
      ),
    [doc],
  );
  const codesOf = (d: NotebookDoc | null) => (d?.blocks ?? []).filter((b) => b.kind === "cell" && b.lang === "python").map((b) => (b as { code: string }).code);
  const pyRef = useRef(py);
  pyRef.current = py;
  // a cell running: how long so far, counted up as it goes
  const started = useRef<Record<string, number>>({});
  const [, tick] = useState(0);
  /** the cell running now (its output's key, and its language), and what it's printed so far (asked for as it runs) */
  const now = useRef<{ key: string; lang: string } | null>(null);
  const [live, setLive] = useState<{ code: string; text: string } | null>(null);
  useEffect(() => {
    if (!running.size) return setLive(null);
    const t = setInterval(() => {
      tick((n) => n + 1);
      const at = now.current;
      if (name && at)
        invoke<string>(at.lang === "python" ? "kernel_output" : "lang_output", { notebook: name, lang: at.lang })
          .then((text) => now.current === at && setLive((l) => (l?.code === at.key && l.text === text ? l : { code: at.key, text })))
          .catch(() => {});
    }, 250);
    return () => clearInterval(t);
  }, [running.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const calcVarsRef = useRef(calcVars);
  calcVarsRef.current = calcVars;
  /** the outline, kept open beside the page (remembered) */
  const [outlineOpen, setOutlineOpenState] = useState(() => {
    try {
      return localStorage.getItem("nb-outline") === "1";
    } catch {
      return false;
    }
  });
  const setOutlineOpen = (open: boolean) => {
    setOutlineOpenState(open);
    try {
      localStorage.setItem("nb-outline", open ? "1" : "0");
    } catch {
      /* only not remembered */
    }
  };
  /** the notebook's own undo and redo (blocks added, moved, deleted…) */
  const notebookUndo = (again: boolean) => {
    const from = again ? future : past;
    const to = again ? past : future;
    const step = from.current.pop();
    if (!step || !docRef.current) return setNotice(again ? "Nothing to redo" : "Nothing to undo");
    to.current.push(docRef.current);
    restoring.current = true;
    commit(step);
    restoring.current = false;
    setNotice(again ? "Redone" : "Undone — ⌘⇧Z to redo");
  };
  /** the text being written (its editor), for the formatting bar */
  const [textView, setTextView] = useState<EditorView | null>(null);
  /** a picture chosen from the formatting bar: kept with the notebook */
  const keepPicture = async (f: File) => {
    if (!name) return null;
    const url = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(f);
    });
    try {
      const path = await invoke<string>("flat_save", { notebook: name, dataUrl: url });
      flatPictures.set(path, url);
      return `![](${encodeURI(path)})`;
    } catch (err) {
      setNotice(`Couldn't keep that picture: ${errorText(err)}`);
      return null;
    }
  };
  /** ⌘P: go to a note */
  const [quickOpen, setQuickOpen] = useState(false);
  /** the words written (text blocks') */
  const wordCount = useMemo(() => (doc?.blocks ?? []).reduce((n, b) => n + (b.kind === "text" ? (b.text.replace(/[#*_`>$=[\]()-]/g, " ").match(/\S+/g)?.length ?? 0) : 0), 0), [doc]);
  /** the library (every note) beside the page — remembered */
  const [libraryOpen, setLibraryOpenState] = useState(() => {
    try {
      return localStorage.getItem("nb-library") !== "0";
    } catch {
      return true;
    }
  });
  const setLibraryOpen = (open: boolean) => {
    setLibraryOpenState(open);
    try {
      localStorage.setItem("nb-library", open ? "1" : "0");
    } catch {
      /* only not remembered */
    }
  };
  /** which heading you're in, as you scroll (its place in the outline) */
  const [hereAt, setHereAt] = useState(-1);
  const spying = useRef(false);
  const spy = () => {
    if (spying.current) return;
    spying.current = true;
    requestAnimationFrame(() => {
      spying.current = false;
      const box = page.current;
      if (!box) return;
      const top = box.getBoundingClientRect().top + 90;
      let at = -1;
      const seen = new Set<string>();
      outline.forEach((h, i) => {
        if (seen.has(h.id)) return;
        seen.add(h.id);
        const el = box.querySelector(`[data-block="${h.id}"]`);
        if (el && el.getBoundingClientRect().top <= top) at = i;
      });
      // scrolled to the very end: the last heading
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && outline.length) at = Math.max(at, outline.findIndex((h) => h.id === outline[outline.length - 1].id));
      setHereAt(at);
    });
  };
  useEffect(spy, [outline]); // eslint-disable-line react-hooks/exhaustive-deps
  const vimKeys = useVimKeys();
  /** what's typed in the block being edited, as of now (an editor's callbacks run between renders) */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const type = (v: string) => {
    draftRef.current = v;
    setDraft(v);
  };
  /** Tab after a name in a Python cell: what Python knows that could finish it */
  const completePython = (before: string) => invoke<{ word: string; matches: string[] }>("kernel_complete", { notebook: name, code: before });
  const turn = useRef<Promise<unknown>>(Promise.resolve());
  const keepOutputs = (next: Record<string, PyOutput>) => {
    // only what's in the notebook now is kept
    const all = (docRef.current?.blocks ?? []).flatMap((b) => (b.kind === "cell" && (b.lang === "python" || codeLanguage(b)) ? [outKey(b.lang, b.code)] : []));
    const kept = Object.fromEntries(Object.entries(next).filter(([code]) => all.includes(code)));
    pyRef.current = kept;
    setPy(kept);
    if (name) invoke("save_workspace", { name: `nbpy-${encodeURIComponent(name)}`, data: kept }).catch(() => {});
  };
  const refreshVars = async () => {
    if (!name) return;
    const r = await invoke<{ vars: typeof vars }>("kernel_vars", { notebook: name }).catch(() => null);
    if (r) setVars(r.vars);
  };
  /** run cells one after another, stopping at the first error */
  const runCells = (codes: string[]) => {
    if (!name || !codes.length) return Promise.resolve(true);
    setRunning((r) => new Set([...r, ...codes]));
    const job = turn.current.then(async () => {
      let ok = true;
      for (const code of codes) {
        if (!ok) {
          keepOutputs({ ...pyRef.current, [code]: { skipped: true } });
          continue;
        }
        setKernel("busy");
        started.current[code] = performance.now();
        now.current = { key: code, lang: "python" };
        let out: PyOutput;
        try {
          const calc = Object.fromEntries(Object.entries(calcVarsRef.current ?? {}).filter(([, v]) => typeof v === "number"));
          out = await invoke<PyOutput>("kernel_run", { notebook: name, code, calc, vars: varsFor("python", code), scope: scopeFor("python", code) });
        } catch (err) {
          out = { error: errorText(err) };
        }
        ok = !out.error;
        now.current = null;
        keepOutputs({ ...pyRef.current, [code]: out });
        setRunning((r) => {
          const next = new Set(r);
          next.delete(code);
          return next;
        });
      }
      setKernel("idle");
      refreshVars();
      return ok;
    });
    turn.current = job.catch(() => {});
    return job;
  };
  /** the programs found installed (name → where, or nothing), asked once */
  const programs = useRef<Record<string, string | null>>({});
  /** run a cell in a plugin's language — the first of its ways whose program is installed */
  const runLanguage = (lang: Language, code: string) => {
    if (!name) return Promise.resolve(false);
    const key = outKey(lang.id, code);
    setRunning((r) => new Set([...r, key]));
    const job = turn.current.then(async () => {
      started.current[key] = performance.now();
      now.current = { key, lang: lang.id };
      const ways = lang.run ?? [];
      const unknown = ways.map((w) => w.needs).filter((p) => !(p in programs.current));
      if (unknown.length) Object.assign(programs.current, await invoke<Record<string, string | null>>("lang_which", { programs: unknown }).catch(() => ({})));
      const way = ways.find((w) => programs.current[w.needs]);
      let out: PyOutput;
      if (!way)
        out = {
          error: ways.length
            ? `${lang.label} cells run with ${ways.map((w) => w.needs).join(" or ")} — none is installed.${lang.install ? `\n${lang.install}` : ""}`
            : `${lang.label} cells don't run — its plugin doesn't say how`,
        };
      else
        try {
          const ran = await invoke<{ stdout: string; error: string | null; seconds: number; images: string[] }>("lang_run", {
            notebook: name,
            lang: lang.id,
            spec: { once: way.once, session: way.session, init: way.init, done: way.done, timeout: way.timeout, extension: lang.extension },
            code: lang.assign ? [...Object.entries(varsFor(lang.id, code)).map(([n, v]) => lang.assign!.split("{name}").join(n).split("{value}").join(String(v))), code].join("\n") : code,
          });
          // a library's chatter (a graphics driver's notes…) left out
          const quiet = (way.quiet ?? []).map((q) => new RegExp(q));
          const stdout = quiet.length ? ran.stdout.split("\n").filter((l) => !quiet.some((q) => q.test(l))).join("\n") : ran.stdout;
          out = { stdout, error: ran.error, seconds: ran.seconds, images: ran.images };
        } catch (err) {
          out = { error: errorText(err) };
        }
      now.current = null;
      // a session language that can list its variables: the Variables panel's, after each run
      if (way?.session && lang.variables && !out.error) {
        const listed = await invoke<{ stdout: string }>("lang_run", {
          notebook: name,
          lang: lang.id,
          spec: { session: way.session, init: way.init, done: way.done, extension: lang.extension },
          code: lang.variables,
        }).catch(() => null);
        if (listed)
          setLangVars((all) => ({
            ...all,
            [lang.label]: listed.stdout
              .split("\n")
              .map((l) => l.split("\t"))
              .filter((p) => p.length >= 4 && p[0])
              .map(([vname, type, shape, ...value]) => ({ name: vname, type, shape: shape.replace(/^\[|\]$/g, "").replace(/\s+/g, "×"), value: value.join("\t") })),
          }));
      }
      keepOutputs({ ...pyRef.current, [key]: out });
      setRunning((r) => {
        const next = new Set(r);
        next.delete(key);
        return next;
      });
      return !out.error;
    });
    turn.current = job.catch(() => {});
    return job;
  };
  /** run a cell, whatever its language */
  const runBlock = (b: Block, code: string) => {
    const lang = codeLanguage(b);
    if (lang) return runLanguage(lang, code);
    if (b.kind === "cell" && b.lang === "python") return runCell(code);
  };
  const runnable = (b: Block) => b.kind === "cell" && (b.lang === "python" || !!codeLanguage(b)?.run?.length);
  /** the cells below that use what this one makes (and what those make, on down) */
  const dependents = async (code: string) => {
    const all = codesOf(docRef.current);
    const info = await invoke<{ cells: { defines: string[]; uses: string[] }[] }>("kernel_names", { notebook: name, codes: all }).catch(() => null);
    const at = all.indexOf(code);
    if (!info || at < 0) return [];
    const made = new Set(info.cells[at].defines);
    const out: string[] = [];
    for (let k = at + 1; k < all.length; k++)
      if (info.cells[k].uses.some((n) => made.has(n))) {
        out.push(all[k]);
        info.cells[k].defines.forEach((n) => made.add(n));
      }
    return out;
  };
  /** run one cell — and, reactive, the cells that depend on it */
  const runCell = async (code: string) => {
    const ok = await runCells([code]);
    if (ok && reactive) runCells(await dependents(code));
  };
  /** every cell that runs — Python, MATLAB, C++… — top to bottom, stopping at the first that fails */
  const runAll = async () => {
    const cells = (docRef.current?.blocks ?? []).filter(runnable);
    // the Python ones show they're waiting their turn
    setRunning((r) => new Set([...r, ...cells.filter((b) => b.kind === "cell" && b.lang === "python").map((b) => (b as { code: string }).code)]));
    let ok = true;
    for (const b of cells) {
      if (b.kind !== "cell") continue;
      if (!ok) {
        if (b.lang === "python") setRunning((r) => (r.delete(b.code), new Set(r)));
        continue;
      }
      const lang = codeLanguage(b);
      ok = (await (lang ? runLanguage(lang, b.code) : runCells([b.code]))) !== false;
    }
  };
  /** the languages kept running for this notebook (a session each): MATLAB, a shell… */
  const sessionLanguages = () => [...new Set((docRef.current?.blocks ?? []).map(codeLanguage).filter((l): l is Language => !!l?.run?.some((w) => w.session)))];
  /** stop the cell running, whatever its language (variables stay) */
  const stopKernel = () => {
    if (!name) return;
    invoke("kernel_interrupt", { notebook: name }).catch(() => {});
    for (const l of sessionLanguages()) invoke("lang_stop", { notebook: name, lang: l.id }).catch(() => {});
    const at = now.current;
    if (at && at.lang !== "python") invoke("lang_stop", { notebook: name, lang: at.lang }).catch(() => {});
  };
  /** a fresh start: Python, and every other language kept running, every variable gone */
  const restartKernel = async (andRun = false) => {
    if (!name) return;
    await invoke("kernel_restart", { notebook: name }).catch(() => {});
    const others = sessionLanguages();
    for (const l of others) await invoke("lang_restart", { notebook: name, lang: l.id }).catch(() => {});
    setKernel("off");
    setVars([]);
    setLangVars({});
    const names = ["Python", ...others.map((l) => l.label)];
    setNotice(`${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]} restarted — every variable is gone`);
    if (andRun) runAll();
  };
  const toggleReactive = () => {
    setReactive(!reactive);
    try {
      localStorage.setItem("nb-reactive", reactive ? "0" : "1");
    } catch {
      // (only this browser's preference)
    }
  };
  /** the notebook as a Jupyter notebook, or as a Python script (# %% cells) */
  const exportAs = async (kind: "ipynb" | "script") => {
    if (!doc || !name) return;
    const { extension, text } = kind === "ipynb" ? { extension: "ipynb", text: toIpynb(doc, name, py) } : toScript(doc, name);
    const path = await invoke<string>("save_text", { name, extension, text }).catch((err) => (setError(errorText(err)), null));
    if (path) setNotice(`Saved to ${path.split("/").slice(-2).join("/")}`);
    setMenu(false);
  };
  const importIpynb = async (file: File) => {
    try {
      const text = fromIpynb(await file.text());
      const which = file.name.replace(/\.ipynb$/i, "").replace(/[/\\:]/g, "-");
      await invoke("write_notebook", { name: which, text });
      await refreshListing();
      onOpenRef.current(which);
      setNotice(`Opened ${file.name} — run its cells with Run all`);
    } catch (err) {
      setError(`Couldn't read that notebook: ${errorText(err)}`);
    }
    setMenu(false);
  };

  // ---- blocks

  const updateBlock = (id: string, patch: Partial<Block>) => {
    const now = docRef.current;
    if (now) commit({ ...now, blocks: now.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) });
  };
  /** before printing: the graphs not yet scrolled to drawn too (a moment for each), so the page has them all */
  const everyGraphDrawn = async () => {
    const ids = (docRef.current?.blocks ?? []).filter((b) => b.kind === "cell" && b.lang === "graph" && !flatOf(b)).map((b) => b.id);
    if (ids.every((id) => plots.get(id))) return;
    drawEverything(true);
    for (let t = 0; t < 40 && !ids.every((id) => plots.get(id)); t++) await new Promise((r) => setTimeout(r, 150));
  };
  /** a section: the blocks under a header, down to the next header as big (or bigger) — its own and its subsections' */
  const sectionOf = (b: Block) => {
    const blocks = docRef.current?.blocks ?? [];
    const at = blocks.findIndex((x) => x.id === b.id);
    const head = b.kind === "text" ? b.text.match(/^(#{1,6})\s/m) : null;
    if (at < 0 || !head) return [];
    const level = head[1].length;
    const out: Block[] = [];
    for (const x of blocks.slice(at + 1)) {
      const h = x.kind === "text" ? x.text.match(/^(#{1,6})\s/m) : null;
      if (h && h[1].length <= level) break;
      out.push(x);
    }
    return out;
  };
  /** bounce in place, as a DAW does: every app block in the section kept as its picture — the
   * section stays as it looks, and nothing in it is worked out or drawn again (⌘Z, or unflatten, brings it back) */
  const bounceSection = async (b: Block) => {
    const cells = sectionOf(b).filter((x) => x.kind === "cell" && !flatOf(x));
    if (!cells.length) return setNotice("Nothing in this section to bounce — its blocks are flattened already");
    for (const x of cells) await flatten(x, "png");
    setNotice(`Bounced — ${cells.length} block${cells.length === 1 ? "" : "s"} kept as pictures (unflatten any, or ⌘Z)`);
  };
  const unbounceSection = (b: Block) => sectionOf(b).forEach((x) => flatOf(x) && unflatten(x));
  /** a calc or variables block rendered down to text: its lines and answers as math (⌘Z brings the block back) */
  const toLatex = (b: Block, calcAt: number) => {
    if (b.kind !== "cell") return;
    const lines = calc?.[calcAt] ?? [];
    const rows = lines.map((l) => {
      const said = l.result?.input_latex ?? l.latex;
      const out = l.result?.kind === "assign" ? "" : (l.result?.result_latex && l.result.result_latex !== said ? `&= ${l.result.result_latex.replace(/^[^=]*=\s*/, "")}` : "");
      return `${said}${out ? ` ${out}` : ""}`;
    });
    const now = docRef.current;
    if (!now || !rows.length) return;
    commit({ ...now, blocks: now.blocks.map((x) => (x.id === b.id ? { id: x.id, kind: "text", text: `$$\n\\begin{aligned}\n${rows.map((r) => (r.includes("&=") ? r : `${r}&`)).join(" \\\\\n")}\n\\end{aligned}\n$$` } : x)) });
  };
  /** a graph block done: kept as its picture (the last one's put away), so the page doesn't keep it live */
  const graphDone = async (b: Block, picture: string | null) => {
    finishEditing(b.id);
    if (!picture || !name || b.kind !== "cell") return;
    try {
      const path = await invoke<string>("flat_save", { notebook: name, dataUrl: picture });
      flatPictures.set(path, picture);
      const now = docRef.current?.blocks.find((x) => x.id === b.id);
      const old = now && shotOf(now);
      if (old) invoke("flat_remove", { path: old }).catch(() => {});
      if (now && now.kind === "cell") updateBlock(b.id, { info: withShot(now.info, path) });
    } catch {
      /* no picture: the record draws it live */
    }
  };
  /** flatten: the cell as it shows, kept as a picture (PNG or JPEG) in its place — so it isn't worked out
   * or drawn again (thirty graphs, thirty pictures); its code stays, to unflatten */
  const flatten = async (b: Block, kind: "png" | "jpeg") => {
    if (!name || !doc || b.kind !== "cell") return;
    const block = document.querySelector<HTMLElement>(`[data-block="${b.id}"]`);
    const shown = block?.querySelector<HTMLElement>(".nb-obj-body") ?? block?.querySelector<HTMLElement>(".nb-code");
    // (an output with nothing in it — a cell not run yet — would be a blank picture)
    if (!shown || (!shown.innerText.trim() && !shown.querySelector("img, svg, canvas"))) return setNotice("Nothing to flatten yet — run it first");
    try {
      // the page's own color under it (not the tint of it being pointed at)
      const solid = (c: string) => !!c && c !== "transparent" && !/(?:,\s*|\/\s*)(0(?:\.\d+)?|\.\d+)\s*\)$/.test(c);
      let paper = getComputedStyle(document.body).backgroundColor;
      for (let el: HTMLElement | null = block!.parentElement; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (solid(c)) {
          paper = c;
          break;
        }
      }
      // what it shows, cropped to it (a graph or code keeps its width), with a little room around
      const fit = b.lang !== "graph" && b.lang !== "work" && b.lang !== "python" && !codeLanguage(b);
      const was = shown.style.width;
      if (fit) shown.style.width = "fit-content";
      const width = Math.ceil(shown.scrollWidth) + 12;
      const height = Math.ceil(shown.scrollHeight) + 12;
      shown.style.width = was;
      const url = await (kind === "png" ? toPng : toJpeg)(shown, {
        pixelRatio: 2,
        backgroundColor: paper,
        quality: 0.92,
        cacheBust: true,
        width,
        height,
        style: { width: `${width}px`, height: `${height}px`, padding: "6px", margin: "0", overflow: "visible", boxSizing: "border-box" },
      });
      const path = await invoke<string>("flat_save", { notebook: name, dataUrl: url });
      flatPictures.set(path, url);
      updateBlock(b.id, { info: withFlat(b.info, path) });
    } catch (err) {
      setNotice(`Couldn't flatten it: ${errorText(err)}`);
    }
  };
  const unflatten = (b: Block) => {
    const path = flatOf(b);
    if (!path || b.kind !== "cell") return;
    invoke("flat_remove", { path }).catch(() => {});
    flatPictures.delete(path);
    updateBlock(b.id, { info: withFlat(b.info, null) });
  };
  /** side by side: a block put beside the one above it (sharing the row evenly), or back on its own */
  const toggleBeside = (id: string) => {
    if (!doc) return;
    const at = doc.blocks.findIndex((b) => b.id === id);
    if (at <= 0) return;
    const on = !doc.blocks[at].beside;
    // the row it joins or leaves starts over at even widths
    let first = at;
    while (first > 0 && doc.blocks[first].beside) first--;
    let last = at;
    while (last + 1 < doc.blocks.length && doc.blocks[last + 1].beside) last++;
    commit({
      ...doc,
      blocks: doc.blocks.map((b, k) => (k === at ? { ...b, beside: on || undefined, width: undefined } : k >= first && k <= last ? { ...b, width: undefined } : b)),
    });
  };
  /** dragging the line between two blocks in a row: their widths, live, kept on letting go */
  const [resizing, setResizing] = useState<{ row: string; widths: number[] } | null>(null);
  const startResize = (e: ReactPointerEvent<HTMLDivElement>, row: Block[], k: number) => {
    e.preventDefault();
    const rowEl = e.currentTarget.parentElement!;
    const total = rowEl.getBoundingClientRect().width || 1;
    const start = e.clientX;
    const from = widthsOf(row);
    let now = from;
    const move = (ev: PointerEvent) => {
      const pair = from[k - 1] + from[k];
      const left = Math.max(15, Math.min(pair - 15, from[k - 1] + ((ev.clientX - start) / total) * 100));
      now = from.map((w, j) => (j === k - 1 ? left : j === k ? pair - left : w));
      setResizing({ row: row[0].id, widths: now });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      if (!doc || now === from) return;
      const widths = new Map(row.map((b, j) => [b.id, Math.round(now[j])]));
      commit({ ...doc, blocks: doc.blocks.map((b) => (widths.has(b.id) ? { ...b, width: widths.get(b.id) } : b)) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const removeBlock = (id: string, quiet = false) => {
    if (!doc) return;
    if (name) closeLinked(linkedId(name, id));
    const at = doc.blocks.findIndex((b) => b.id === id);
    if (at < 0) return;
    const gone = doc.blocks[at];
    if (!quiet)
      setUndo({
        label: `Deleted a ${gone.kind === "text" ? "text block" : `${LANG_LABEL[gone.lang] ?? gone.lang} cell`}`,
        button: "Undo",
        run: () => {
          const now = docRef.current;
          if (!now) return;
          const blocks = [...now.blocks];
          blocks.splice(Math.min(at, blocks.length), 0, gone);
          commit({ ...now, blocks });
        },
      });
    commit({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
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
  // ---- the page's objects: picked, moved and sized the way pictures are in a document

  /** the text column: where a block alone on its line can sit */
  const columnBox = () => {
    const el = page.current!;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const left = r.left + parseFloat(cs.paddingLeft);
    const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { left, width, right: left + width, center: left + width / 2 };
  };
  /** a block picked (its bar and its handles); the notebook takes the keys */
  const pickBlock = (id: string | null) => {
    setPicked(id);
    if (id) root.current?.focus({ preventScroll: true });
  };
  /** the block out of the page, its row closing up behind it */
  const detach = (blocks: Block[], id: string) => {
    const at = blocks.findIndex((b) => b.id === id);
    if (at < 0) return blocks;
    const gone = blocks[at];
    const out = blocks.filter((b) => b.id !== id);
    // it started a row: the next in the row starts it now
    if (!gone.beside && out[at]?.beside) out[at] = { ...out[at], beside: undefined };
    return out;
  };
  type Side = "before" | "after" | "left" | "right";
  /** moved: above or below a block (on a line of its own), or beside it (sharing its row) */
  const placeBlock = (id: string, target: string, side: Side) => {
    const now = docRef.current;
    if (!now || id === target) return;
    const moving = now.blocks.find((b) => b.id === id);
    if (!moving) return;
    const wasInRow = !!moving.beside || !!now.blocks[now.blocks.findIndex((b) => b.id === id) + 1]?.beside;
    let rest = detach(now.blocks, id);
    const row = rowsOf(rest).find((r) => r.some((b) => b.id === target));
    if (!row) return;
    let item = { ...moving } as Block;
    if (side === "before" || side === "after") {
      // a line of its own, over or under the target's row (a row's share of the line isn't a page's)
      item = { ...item, beside: undefined, ...(wasInRow ? { width: undefined } : {}) } as Block;
      let at = rest.findIndex((b) => b.id === (side === "before" ? row[0].id : row[row.length - 1].id));
      if (side === "after") at += 1;
      rest = [...rest.slice(0, at), item, ...rest.slice(at)];
    } else {
      // beside it: the row shares its line evenly again
      const inRow = new Set(row.map((b) => b.id));
      rest = rest.map((b) => (inRow.has(b.id) ? ({ ...b, width: undefined, wrap: undefined, wide: undefined } as Block) : b));
      const at = rest.findIndex((b) => b.id === target);
      const loose = { width: undefined, wrap: undefined, wide: undefined, align: undefined };
      if (side === "right") {
        rest.splice(at + 1, 0, { ...item, ...loose, beside: true } as Block);
      } else {
        rest.splice(at, 1, { ...item, ...loose, beside: rest[at].beside } as Block, { ...rest[at], beside: true } as Block);
      }
    }
    commit({ ...now, blocks: rest });
  };
  /** moving a block: where it would land */
  const [moving, setMoving] = useState<string | null>(null);
  const [dropBlock, setDropBlock] = useState<{ id: string; side: Side } | null>(null);
  /** a block taken by its grip (or picked, by itself) and dragged: it follows to where it's let go */
  const movedRef = useRef(false);
  const beginMove = (e: ReactPointerEvent, id: string, grip: boolean) => {
    if (e.button !== 0) return;
    movedRef.current = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let target: { id: string; side: Side } | null = null;
    let scroll = 0;
    const ticker = window.setInterval(() => scroll && page.current?.scrollBy({ top: scroll }), 16);
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        started = true;
        movedRef.current = true;
        setMoving(id);
        document.body.classList.add("nb-is-moving");
        window.getSelection()?.removeAllRanges();
      }
      // near the page's top or bottom: it scrolls
      const box = page.current?.getBoundingClientRect();
      scroll = box ? (ev.clientY < box.top + 50 ? -12 : ev.clientY > box.bottom - 50 ? 12 : 0) : 0;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-block]");
      const over = el?.dataset.block;
      if (!el || !over || over === id) {
        target = null;
        setDropBlock(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const edge = Math.min(110, r.width * 0.22);
      const side: Side = ev.clientX < r.left + edge ? "left" : ev.clientX > r.right - edge ? "right" : ev.clientY < r.top + r.height / 2 ? "before" : "after";
      if (target?.id !== over || target.side !== side) {
        target = { id: over, side };
        setDropBlock(target);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.clearInterval(ticker);
      document.body.classList.remove("nb-is-moving");
      setMoving(null);
      setDropBlock(null);
      if (!started) {
        // a click on the grip: picked
        if (grip) pickBlock(id);
        return;
      }
      if (target) placeBlock(id, target.id, target.side);
      pickBlock(id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const dropMark = (id: string) => (dropBlock?.id === id ? ` is-drop-${dropBlock.side}` : "") + (moving === id ? " is-moving" : "");
  /** a block placed freely, being dragged: where it is, and the helper lines it's snapped to */
  const [freeDrag, setFreeDrag] = useState<{ id: string; x: number; y: number; guides: number[] } | null>(null);
  const beginFreeMove = (e: ReactPointerEvent, b: Block) => {
    if (e.button !== 0 || !b.free) return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-block]");
    const col = columnBox();
    const w = el?.offsetWidth ?? 200;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const from = b.free;
    let now = { x: from.x, y: from.y };
    let started = false;
    // the other free blocks' edges, to line up with
    const others = [...(page.current?.querySelectorAll<HTMLElement>(".nb-solo.is-free > .nb-block") ?? [])].filter((x) => x !== el).flatMap((x) => {
      const r = x.getBoundingClientRect();
      return [r.left - col.left, r.right - col.left];
    });
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!started) {
        started = true;
        movedRef.current = true;
        document.body.classList.add("nb-is-moving");
      }
      let x = from.x + ev.clientX - x0;
      const y = Math.round(from.y + ev.clientY - y0);
      // helper lines: the column's edges and middle, and the other free blocks' edges (Alt: none)
      const guides: number[] = [];
      if (!ev.altKey) {
        const targets = [0, col.width / 2, col.width, ...others];
        for (const [edge, off] of [
          [x, 0],
          [x + w / 2, w / 2],
          [x + w, w],
        ] as const) {
          const hit = targets.find((t) => Math.abs(t - edge) < 7);
          if (hit !== undefined) {
            x = hit - off;
            guides.push(hit);
            break;
          }
        }
      }
      now = { x: Math.round(x), y };
      setFreeDrag({ id: b.id, ...now, guides });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("nb-is-moving");
      setFreeDrag(null);
      if (started) updateBlock(b.id, { free: now });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /** where a block sits, changed (its bar): left, centered, right, text around it, wide… */
  const place = (b: Block, patch: Partial<Block>) => updateBlock(b.id, patch);
  /** sizing a block alone on its line by an edge: its width, live, kept on letting go */
  const [sizing, setSizing] = useState<{ id: string; width: number } | null>(null);
  const startSizing = (e: ReactPointerEvent, b: Block, edge: "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    const col = columnBox();
    const side = b.wrap ?? b.align ?? "left";
    let width = b.width ?? 100;
    const move = (ev: PointerEvent) => {
      const px = side === "center" ? Math.abs(ev.clientX - col.center) * 2 : edge === "right" ? ev.clientX - col.left : col.right - ev.clientX;
      let pct = (px / col.width) * 100;
      // close to a third, a half…: that
      for (const snap of [25, 100 / 3, 50, 200 / 3, 75, 100]) if (Math.abs(pct - snap) < 1.6) pct = snap;
      width = Math.round(Math.max(15, Math.min(100, pct)));
      setSizing({ id: b.id, width });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("nb-is-sizing");
      setSizing(null);
      updateBlock(b.id, { width: width >= 100 ? undefined : width });
    };
    document.body.classList.add("nb-is-sizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /** the + menu: what to add, and where (under a block; at the end; in place of an empty one) */
  const [inserting, setInserting] = useState<{ after: string | null; replace?: string } | null>(null);
  const insertBlock = (kind: { lang: string; start: string }, after: string | null, replace?: string) => {
    const now = docRef.current;
    if (!now) return;
    setInserting(null);
    const id = blockId();
    const block: Block = kind.lang === "text" || kind.lang === "math" ? { id, kind: "text", text: kind.start } : { id, kind: "cell", lang: kind.lang, info: "", code: kind.start };
    let blocks: Block[];
    if (replace && now.blocks.some((b) => b.id === replace)) {
      const old = now.blocks.find((b) => b.id === replace)!;
      blocks = now.blocks.map((b) => (b.id === replace ? ({ ...block, beside: old.beside, width: old.width } as Block) : b));
    } else {
      // under the block (after its row, when it's in one)
      let at = after ? now.blocks.findIndex((b) => b.id === after) : -1;
      if (at < 0) at = now.blocks.length - 1;
      while (now.blocks[at + 1]?.beside) at++;
      blocks = [...now.blocks.slice(0, at + 1), block, ...now.blocks.slice(at + 1)];
    }
    editingRef.current = null;
    commit({ ...now, blocks });
    setPicked(id);
    // (a table is typed into where it is: nothing to open)
    if (kind.lang === "table") return setEditing(null);
    setEditing(id);
    setDraft(kind.start);
  };
  const addBlock = (kind: { lang: string; start: string }) => insertBlock(kind, null);
  const startEditing = (b: Block) => {
    if (editing && editing !== b.id) finishEditing();
    setEditing(b.id);
    setPicked(b.id);
    setDraft(b.kind === "text" ? b.text : b.code);
  };
  /** done editing a block: kept (an empty text block goes) */
  const finishEditing = (only?: string) => {
    const id = editingRef.current;
    // (done with one block in particular: only if it's still the one being edited)
    if (only !== undefined && id !== only) return;
    const now = docRef.current;
    if (!id || !now) return setEditing(null);
    const b = now.blocks.find((x) => x.id === id);
    setEditing(null);
    clickAt.current = null;
    // (the next block opened sets this again, after this)
    setTimeout(() => (fromTop.current = false), 50);
    if (!b) return;
    // it stays picked, so the keys go on from it (with nothing else taking them)
    setPicked(id);
    setTimeout(() => {
      const now = document.activeElement;
      if (!now || now === document.body) root.current?.focus({ preventScroll: true });
    }, 0);
    const draft = draftRef.current;
    if (b.kind === "text") {
      // (a Math block with no math in it goes too)
      if (!draft.trim() || mathRowsOf(draft)?.every((r) => !r)) removeBlock(b.id, true);
      else if (draft !== b.text) updateBlock(b.id, { text: draft });
    } else if (draft !== b.code) updateBlock(b.id, { code: draft });
  };
  /** ⌘⏎: done editing — and run it, if it runs */
  const runEdited = (b: Block) => {
    const code = draftRef.current;
    finishEditing();
    if (runnable(b)) setTimeout(() => runBlock(b, code), 60);
  };
  /** ⇧⏎: run it, and on to the next cell of its kind (a new one at the end) — as in Jupyter */
  const runAndNext = (b: Block) => {
    if (b.kind !== "cell") return;
    const code = draftRef.current;
    finishEditing();
    setTimeout(() => runBlock(b, code), 60);
    const blocks = doc!.blocks;
    const at = blocks.findIndex((x) => x.id === b.id);
    const nextBlock = blocks.slice(at + 1).find((x) => x.kind === "cell" && x.lang === b.lang);
    if (nextBlock) setTimeout(() => startEditing(nextBlock), 80);
    else {
      const id = blockId();
      commit({ ...doc!, blocks: [...blocks.map((x) => (x.id === b.id ? { ...x, code } : x)), { id, kind: "cell", lang: b.lang, info: "", code: "" }] });
      setTimeout(() => (setEditing(id), type("")), 80);
    }
  };
  /** ⌥⏎: run it, and a new cell right under it — as in Jupyter */
  const runAndInsert = (b: Block) => {
    if (b.kind !== "cell") return;
    const code = draftRef.current;
    finishEditing();
    setTimeout(() => runBlock(b, code), 60);
    const id = blockId();
    const blocks = doc!.blocks.map((x) => (x.id === b.id ? { ...x, code } : x));
    const at = blocks.findIndex((x) => x.id === b.id);
    commit({ ...doc!, blocks: [...blocks.slice(0, at + 1), { id, kind: "cell", lang: b.lang, info: "", code: "" }, ...blocks.slice(at + 1)] });
    setTimeout(() => (setEditing(id), type("")), 80);
  };
  /** come into a block from the one above: its caret at the start */
  const fromTop = useRef(false);
  /** off a block's edge (↑ / ↓, vim's k / j): the next one — text written in, an object picked */
  const onEdge = (b: Block) => (dir: "up" | "down") => {
    const blocks = docRef.current?.blocks ?? [];
    const at = blocks.findIndex((x) => x.id === b.id);
    const next = blocks[dir === "down" ? at + 1 : at - 1];
    if (!next) return false;
    finishEditing();
    if (next.kind === "text" || codeLanguage(next) || (next.kind === "cell" && next.lang === "python")) {
      fromTop.current = dir === "down";
      setTimeout(() => startEditing(next), 0);
    } else pickBlock(next.id);
    return true;
  };
  /** where a text block was clicked to write in it: the caret goes there */
  const clickAt = useRef<{ x: number; y: number } | null>(null);
  /** a text block's own keys: ⌘B ⌘I ⌘E ⌘K ⌘⇧X ⌘⇧H, and Enter or Tab taking what / asked for */
  const proseKeys = (b: Block): KeyBinding[] => {
    const wrapWith =
      (key: string, shift = false) =>
      (v: EditorView) => {
        const sel = v.state.selection.main;
        const edit = writingKey({ key, metaKey: true, ctrlKey: false, shiftKey: shift, altKey: false }, v.state.doc.toString(), sel.from, sel.to);
        if (!edit) return false;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: edit.value }, selection: { anchor: edit.start, head: edit.end } });
        return true;
      };
    const slashPick = () => {
      const slash = draftRef.current.match(/^\/([\w ]*)$/);
      const first = slash && insertItems().find((i) => i.label.toLowerCase().includes(slash[1].trim().toLowerCase()));
      if (!first) return false;
      insertBlock(first.kind, null, b.id);
      return true;
    };
    return [
      { key: "Mod-b", run: wrapWith("b") },
      { key: "Mod-i", run: wrapWith("i") },
      { key: "Mod-e", run: wrapWith("e") },
      { key: "Mod-k", run: wrapWith("k") },
      { key: "Mod-Shift-x", run: wrapWith("x", true) },
      { key: "Mod-Shift-h", run: wrapWith("h", true) },
      { key: "Enter", run: slashPick },
      { key: "Tab", run: slashPick },
    ];
  };
  /** a picture pasted into a text block's editor */
  const pasteInto = (e: ClipboardEvent, v: EditorView) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file || !name) return false;
    e.preventDefault();
    const at = v.state.selection.main.head;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const path = await invoke<string>("flat_save", { notebook: name, dataUrl: String(reader.result) });
        flatPictures.set(path, String(reader.result));
        v.dispatch({ changes: { from: at, insert: `![](${encodeURI(path)})` } });
      } catch (err) {
        setNotice(`Couldn't keep that picture: ${errorText(err)}`);
      }
    };
    reader.readAsDataURL(file);
    return true;
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
      await invoke("write_notebook", { name: fresh, text: template.build(fresh, work.finished, work.me) });
      setNewName("");
      await refreshListing();
      setView("doc");
      onOpen(fresh);
      // the finished problems are in this notebook now — out of Work's list
      const moved = template.id === "assignment" ? work.finished : [];
      if (moved.length) {
        work.take(moved.map((e) => e.id));
        setUndo({ label: `Moved ${moved.length} finished problem${moved.length === 1 ? "" : "s"} here from Work`, button: "Keep them in Work too", run: () => work.giveBack(moved) });
      }
    } catch (err) {
      setError(errorText(err));
    }
  };
  const openOrCreate = async (which: string) => {
    setSwitcher(false);
    if (!listing.some((l) => l.name === which)) {
      await invoke("write_notebook", { name: which, text: TEMPLATES[0].build(which, [], work.me) }).catch(() => {});
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
  /** problems as sections at the end (numbered on from the ones there) —
   * the ids of the blocks added */
  const appendProblems = (entries: WorkHistoryEntry[]) => {
    const current = docRef.current;
    if (!current) return [];
    const have = current.blocks.filter((b) => b.kind === "text" && /^## Problem/m.test(b.text)).length;
    const added = parseNotebook(entries.map((e, i) => problemSection(e, have + i + 1)).join("\n\n")).blocks;
    commit({ ...current, blocks: [...current.blocks, ...added] });
    setTimeout(() => page.current?.scrollTo({ top: page.current.scrollHeight, behavior: "smooth" }), 120);
    return added.map((b) => b.id);
  };
  /** the problems finished in Work: in here, out of Work's list (one
   * that's already here, same problem, isn't added twice) */
  const addFinished = () => {
    if (!doc) return;
    setMenu(false);
    const here = new Set(doc.blocks.filter((b) => b.kind === "cell" && b.lang === "work").map((b) => readWorkCell((b as { code: string }).code).problem.replace(/\s/g, "")));
    const fresh = work.finished.filter((e) => !here.has(e.problem.replace(/\s/g, "")));
    work.take(work.finished.map((e) => e.id));
    const ids = appendProblems(fresh);
    const moved = work.finished;
    setUndo({
      label: `Moved ${moved.length} finished problem${moved.length === 1 ? "" : "s"} here from Work`,
      button: "Undo",
      run: () => {
        work.giveBack(moved);
        const now = docRef.current;
        if (now) commit({ ...now, blocks: now.blocks.filter((b) => !ids.includes(b.id)) });
      },
    });
  };
  /** the problem being worked on in Work, as it stands — Work's ready for the next */
  const addInProgress = async () => {
    setMenu(false);
    const e = await work.fileInProgress();
    if (!e) return setError("Couldn't add it — check the problem in Work");
    work.take([e.id]);
    appendProblems([e]);
    setNotice("Added — Work is ready for the next problem");
  };
  const copyLatex = async () => {
    setMenu(false);
    if (!doc || !name) return;
    const tex = await notebookLatex(doc, name, calc, py);
    await navigator.clipboard.writeText(tex).then(
      () => setNotice("Copied as LaTeX"),
      () => setError("Couldn't copy"),
    );
  };
  const showPreview = async () => {
    if (!doc || !name) return;
    try {
      await everyGraphDrawn();
      setPreview(await notebookHtml(doc, name, calc, py));
    } catch (err) {
      setError(`Couldn't make the page: ${errorText(err)}`);
    }
  };
  /** a work cell's problem back in Work, to fix there */
  const reopen = (code: string) => {
    const { problem, steps } = readWorkCell(code);
    if (!work.reopen(problem, [problem, ...steps.map((s) => s.latex)], ["", ...steps.map((s) => s.note?.text ?? "")])) setNotice("Finish (or clear) the problem in Work first");
  };
  const reveal = async () => {
    setMenu(false);
    const folder = await invoke<string>("notebook_folder").catch(() => null);
    if (folder) revealItemInDir(name ? `${folder}/${name}.md` : folder).catch(() => {});
  };
  const neovim = async () => {
    setMenu(false);
    if (!name) return;
    try {
      await invoke("open_in_neovim", { name });
      setNotice("Opened in Neovim — every :w shows up here");
    } catch (err) {
      setError(errorText(err));
    }
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
      await everyGraphDrawn();
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
      {view !== "new" && doc && (
        <button className={`nb-tool is-icon${libraryOpen ? " is-on" : ""}`} title="Your notes — search, tags, what links here" onClick={() => setLibraryOpen(!libraryOpen)}>
          <Icon name="panel" size={15} />
        </button>
      )}
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
          {doc.blocks.some(runnable) && (
            <span className="nb-kernel">
              <span className={`nb-kernel-dot is-${kernel}`} title={kernel === "busy" ? "Python is running a cell" : kernel === "idle" ? "Python is ready — its variables kept between cells" : "Python starts on the first run"} />
              <button className="nb-tool" title="Run every cell that runs — Python, MATLAB, C++… — top to bottom" onClick={runAll}>
                <Icon name="run" size={14} /> Run all
              </button>
              {(kernel === "busy" || running.size > 0) && (
                <button className="nb-tool" title="Stop the cell running (its variables stay)" onClick={stopKernel}>
                  ■ Stop
                </button>
              )}
              <button className="nb-tool is-icon" title="Restart — Python (and MATLAB, a shell… kept running) start fresh, every variable gone" onClick={() => restartKernel()}>
                <Icon name="reset" size={14} />
              </button>
              <button
                className={`nb-tool${reactive ? " is-on" : ""}`}
                title={reactive ? "Reactive: running a cell reruns the cells below that use what it made — click to turn off" : "Reactive: run a cell, and the cells below that use what it made rerun by themselves"}
                onClick={toggleReactive}
              >
                ⚡ Reactive
              </button>
              <button className={`nb-tool${varsOpen ? " is-on" : ""}`} title="Every variable there is right now — Python's, MATLAB's workspace…" onClick={() => (setVarsOpen(!varsOpen), refreshVars())}>
                x= Variables
              </button>
            </span>
          )}
          <button className={`nb-tool is-icon${finding ? " is-on" : ""}`} title="Find and replace (⌘F)" onClick={() => (finding ? setFinding(null) : startFinding())}>
            <Icon name="zoom" size={15} />
          </button>
          {outline.length > 0 && (
            <button className={`nb-tool is-icon${outlineOpen ? " is-on" : ""}`} title="Outline — the headings, beside the page" onClick={() => setOutlineOpen(!outlineOpen)}>
              <Icon name="list" size={15} />
            </button>
          )}
          <button className="nb-tool is-icon" title="Edit in Neovim — every :w shows up here" onClick={neovim}>
            <Icon name="pen" size={15} />
          </button>
          <div className="nb-switch">
            <button className={`nb-tool is-icon${menu ? " is-on" : ""}`} title="More" onClick={() => setMenu(!menu)}>
              <Icon name="more" size={16} />
            </button>
            {menu && (
              <div className="nb-pop is-right" onMouseLeave={() => (setMenu(false), setPrompt(null))}>
                <button
                  className="nb-pop-item"
                  onClick={() => {
                    setMenu(false);
                    if (view === "source") setView("doc");
                    else {
                      finishEditing();
                      setSource(writeNotebook(doc));
                      setView("source");
                    }
                  }}
                >
                  <Icon name="source" size={14} /> {view === "source" ? "Back to the page" : "Source (the Markdown)"}
                </button>
                <button className="nb-pop-item" onClick={() => (setMenu(false), showPreview())}>
                  <Icon name="eye" size={14} /> Preview as printed
                </button>
                <button className="nb-pop-item" onClick={() => (setMenu(false), print())}>
                  <Icon name="print" size={14} /> Print or save as PDF
                </button>
                <button className={`nb-pop-item nb-vim-toggle${vimKeys ? " is-on" : ""}`} title="Vim in code cells and text, set up like Neovim: Space is the leader (Space r runs), :w is done, yanks go to the clipboard" onClick={() => (setMenu(false), setVimKeys(!vimKeys))}>
                  <Icon name="check" size={14} /> Vim keys {vimKeys ? "on" : "off"}
                </button>
                <div className="nb-pop-line" />
                {work.inProgress && (
                  <button className="nb-pop-item" onClick={addInProgress}>
                    <Icon name="work" size={14} /> Add the problem in Work
                  </button>
                )}
                {work.finished.length > 0 && (
                  <button className="nb-pop-item" onClick={addFinished}>
                    <Icon name="work" size={14} /> Move in the {work.finished.length} finished problem{work.finished.length === 1 ? "" : "s"} from Work
                  </button>
                )}
                <button className="nb-pop-item" onClick={copyLatex}>
                  <Icon name="copy" size={14} /> Copy as LaTeX
                </button>
                {doc.blocks.some((b) => b.kind === "cell" && b.lang === "graph" && !flatOf(b)) && (
                  <button
                    className="nb-pop-item"
                    title="Each graph kept as a picture — a notebook with many opens and scrolls faster (unflatten any to change it)"
                    onClick={async () => {
                      setMenu(false);
                      for (const b of doc.blocks) if (b.kind === "cell" && b.lang === "graph" && !flatOf(b)) await flatten(b, "png");
                    }}
                  >
                    <Icon name="frame" size={14} /> Flatten every graph
                  </button>
                )}
                {doc.blocks.some((b) => flatOf(b)) && (
                  <button className="nb-pop-item" onClick={() => (setMenu(false), doc.blocks.forEach((b) => flatOf(b) && unflatten(b)))}>
                    <Icon name="reset" size={14} /> Unflatten everything
                  </button>
                )}

                <div className="nb-pop-line" />
                <button className="nb-pop-item" onClick={() => exportAs("ipynb")}>
                  <Icon name="download" size={14} /> Save as a Jupyter notebook (.ipynb{mainLanguage(doc) === "python" ? "" : `, ${mainLanguage(doc) === "matlab" ? "Octave" : mainLanguage(doc)} kernel`})
                </button>
                <button className="nb-pop-item" onClick={() => exportAs("script")}>
                  <Icon name="download" size={14} /> Save as a {mainLanguage(doc) === "matlab" ? "MATLAB script (.m, %% sections)" : mainLanguage(doc) === "python" ? "Python script (.py)" : `script (${toScript(doc, name ?? "").extension})`}
                </button>
                <button className="nb-pop-item" onClick={() => importer.current?.click()}>
                  <Icon name="folder" size={14} /> Open a Jupyter notebook…
                </button>
                <input ref={importer} type="file" accept=".ipynb" hidden onChange={(e) => e.target.files?.[0] && importIpynb(e.target.files[0])} />
                {doc.blocks.some(runnable) && (
                  <>
                    <button className="nb-pop-item" onClick={() => (keepOutputs({}), setMenu(false))}>
                      <Icon name="close" size={14} /> Clear every output
                    </button>
                    <button className="nb-pop-item" onClick={() => (restartKernel(true), setMenu(false))}>
                      <Icon name="reset" size={14} /> Restart and run all
                    </button>
                  </>
                )}
                <div className="nb-pop-line" />
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
              {t.id === "assignment" && work.finished.length > 0 && <span className="nb-template-note">{work.finished.length} from Work</span>}
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
          {[...HEADER_FIELDS, ...doc.meta.filter(([k]) => !HEADER_FIELDS.some(([f]) => f === k.toLowerCase()) && k !== "template" && !SWITCH_KEYS.includes(k.toLowerCase())).map(([k]) => [k, k] as [string, string])].map(([key, label]) => (
            <label key={key} className="nb-field">
              <span>{label}</span>
              <input
                value={metaValue(doc, key)}
                onChange={(e) => {
                  commit(setMeta(doc, key, e.target.value));
                  // name, class, teacher: there next time too
                  if (ME_KEYS[key]) work.rememberMe({ [ME_KEYS[key]]: e.target.value });
                }}
              />
            </label>
          ))}
          <div className="nb-switches">
            <span className="nb-switches-label">On the printed page</span>
            {PRINT_SWITCHES.map((sw) => {
              const on = { checkmarks: printSwitches(doc).marks, "box answers": printSwitches(doc).box, "number lines": printSwitches(doc).numberLines, "step notes": printSwitches(doc).notes }[sw.key];
              return (
                <label key={sw.key} className="nb-switch-toggle" title={sw.title}>
                  <input type="checkbox" checked={on} onChange={(e) => commit(setMeta(doc, sw.key, e.target.checked ? "yes" : "no"))} />
                  {sw.label}
                </label>
              );
            })}
          </div>
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

  /** what a block is, in a word and an icon (its bar, the + menu) */
  const kindOf = (b: Block): { label: string; icon: string } => {
    if (b.kind === "text") return mathRowsOf(b.text) !== null ? { label: "Math", icon: "equations" } : /^#{1,6}\s/.test(b.text) ? { label: "Heading", icon: "text" } : { label: "Text", icon: "text" };
    const language = codeLanguage(b);
    const pluginCell = !language && !OWN_CELLS.has(b.lang) ? (plugins.cells.find((c) => c.id === b.lang.toLowerCase()) ?? cellKindOf(b.lang)) : undefined;
    return { label: language?.label ?? pluginCell?.label ?? LANG_LABEL[b.lang] ?? b.lang, icon: NEW_CELLS.find((c) => c.lang === b.lang)?.icon ?? "source" };
  };
  /** everything the + menu (and / in a new line) can add */
  const insertItems = () => [
    ...NEW_CELLS.filter((c) => !offCells.includes(c.lang)).flatMap((c) => [
      { key: c.lang, label: c.label, icon: c.icon, group: c.lang === "text" || c.lang === "math" ? "Write" : c.lang === "python" ? "Code" : "Apps", kind: c as { lang: string; start: string } },
      ...(c.lang === "text" ? [{ key: "heading", label: "Heading", icon: "text", group: "Write", kind: { lang: "text", start: "## " } }] : []),
    ]),
    ...plugins.cells.filter((c) => !offCells.includes(c.id)).map((c) => ({ key: `cell:${c.id}`, label: c.label, icon: "source", group: "From plugins", kind: { lang: c.id, start: c.starter ?? "" } })),
    ...allLanguages.map((l) => ({ key: `lang:${l.id}`, label: l.label, icon: "source", group: "Code", kind: { lang: l.id, start: l.starter ?? "" } })),
  ];
  const insertMenu = (after: string | null, replace?: string, filter = "") => {
    const items = insertItems().filter((i) => !filter || i.label.toLowerCase().includes(filter.trim()));
    const groups = [...new Set(items.map((i) => i.group))];
    return (
      // (a press here keeps the line being typed in: picking from it isn't leaving it)
      <div className="nb-insert" onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {!items.length && <div className="nb-insert-empty">Nothing called “{filter}”</div>}
        {groups.map((g) => (
          <div key={g} className="nb-insert-group">
            <div className="nb-insert-title">{g}</div>
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <button key={i.key} className="nb-insert-item" onClick={() => insertBlock(i.kind, after, replace)}>
                  <Icon name={i.icon} size={15} /> {i.label}
                </button>
              ))}
          </div>
        ))}
      </div>
    );
  };
  /** a copy, under it (a copy is live: its picture, if it has one, stays the original's) */
  const duplicateBlock = (b: Block) => {
    const now = docRef.current;
    if (!now) return;
    const at = now.blocks.findIndex((x) => x.id === b.id);
    const copy = { ...b, id: blockId(), beside: undefined, ...(b.kind === "cell" ? { info: withShot(withFlat(b.info, null), null) } : {}) } as Block;
    let end = at;
    while (now.blocks[end + 1]?.beside) end++;
    commit({ ...now, blocks: [...now.blocks.slice(0, end + 1), copy, ...now.blocks.slice(end + 1)] });
    pickBlock(copy.id);
  };
  /** open it: work in the app (a picture made live first) */
  const openBlock = (b: Block) => {
    // a table is worked in where it is
    if (b.kind === "cell" && b.lang === "table") return;
    if (b.kind === "cell" && flatOf(b)) unflatten(b);
    if (openInApp(b)) return;
    startEditing(b);
  };
  // ---- linked apps: an app block opens in its real app (its tile, floating beside the page), not a copy of it here

  const linkedApps = useLinkedApps();
  /** what a block's section knows (x → "5"), for its app */
  const scopeOfBlock = (b: Block) => Object.fromEntries(Object.entries(varsAt.get(b.id) ?? {}).map(([k, v]) => [k, String(v)]));
  /** the heading a block is under, for its app's tab ("Calculate · Problem 1") */
  const headingOver = (b: Block) => {
    const blocks = docRef.current?.blocks ?? [];
    for (let k = blocks.findIndex((x) => x.id === b.id) - 1; k >= 0; k--) {
      const x = blocks[k];
      const h = x.kind === "text" ? [...x.text.matchAll(/^#{1,6}\s+(.+)$/gm)].pop() : null;
      if (h) return h[1].replace(/[*_`$]/g, "").trim();
    }
    return metaValue(docRef.current!, "title") || name || "";
  };
  /** the block in its app (true when it opened there) */
  const openInApp = (b: Block) => {
    const view = b.kind === "cell" ? LINKED_LANGS[b.lang] : undefined;
    if (b.kind !== "cell" || !view || !name || !canLink()) return false;
    finishEditing();
    const id = linkedId(name, b.id);
    const lines = isCalcLike(b) ? calc?.[calcIndex.get(b.id) ?? -1] : undefined;
    const near = document.querySelector(`[data-block="${b.id}"]`)?.getBoundingClientRect();
    const title = `${kindOf(b).label} · ${headingOver(b)}`.replace(/ · $/, "");
    pickBlock(b.id);
    return openLinked({ id, notebook: name, block: b.id, lang: b.lang, view, title, scope: scopeOfBlock(b) }, appDataFor(id, b.lang, b.code, lines), near);
  };
  // what's done in a block's app is the block's: written into it as it happens (its old picture, a graph's, let go)
  useEffect(
    () =>
      watchLinked((app, data) => {
        const now = docRef.current;
        const b = now?.blocks.find((x) => x.id === app.block);
        if (app.notebook !== name || !b || b.kind !== "cell") return;
        const code = codeFor(app.lang, data, b.code);
        if (code === b.code) return;
        const shot = shotOf(b);
        if (shot) invoke("flat_remove", { path: shot }).catch(() => {});
        updateBlock(b.id, { code, ...(shot ? { info: withShot(b.info, null) } : {}) });
      }),
    [name], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // a section's values changed (a Variables block above): the apps open on blocks under it see the new ones
  useEffect(() => {
    if (!name) return;
    for (const app of linkedApps.values()) {
      if (app.notebook !== name) continue;
      const b = doc?.blocks.find((x) => x.id === app.block);
      if (b) rescopeLinked(app.id, scopeOfBlock(b));
      else closeLinked(app.id);
    }
  }, [varsAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // another notebook opened: this one's apps close (their work is in their blocks)
  useEffect(
    () => () => {
      for (const app of [...linkedApps.values()]) if (app.notebook === name) closeLinked(app.id);
    },
    [name], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const openInAppNow = (b: Block) => !!name && !!linkedApp(linkedId(name, b.id));
  /** pressing an object: it's picked (and can be dragged); pressing it again opens it */
  const press = useRef<{ id: string; already: boolean } | null>(null);
  const objectDown = (e: ReactPointerEvent, b: Block) => {
    if (e.button !== 0 || editing === b.id) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, select, math-field, .cm-editor, [contenteditable], .nb-obj-bar, .nb-gutter, .nb-size, .nb-insert, .nb-folded, .sheet")) return;
    press.current = { id: b.id, already: picked === b.id };
    pickBlock(b.id);
    // placed freely: dragged anywhere (a graph's plot and an output's text excepted — the grip moves those)
    if (b.free) {
      if (!t.closest(".js-plotly-plot, pre, .nb-py-out, .nb-code")) beginFreeMove(e, b);
      return;
    }
    // a graph pans under the pointer, and an output's text is there to select: those move by the grip
    if (!t.closest(".nb-graph, .js-plotly-plot, pre, .nb-py-out, .nb-code")) beginMove(e, b.id, false);
  };
  const objectClick = (b: Block) => {
    const p = press.current;
    press.current = null;
    if (p?.id === b.id && p.already && !movedRef.current && editing !== b.id) openBlock(b);
  };
  /** + to add under it, and the grip: drag it anywhere, or click it to pick it */
  const gutter = (b: Block) => (
    <span className="nb-gutter" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button className={`nb-gutter-btn${inserting?.after === b.id && !inserting.replace ? " is-on" : ""}`} title="Add something under it — text, math, an app, code (or type / on a new line)" onClick={() => setInserting(inserting?.after === b.id && !inserting.replace ? null : { after: b.id })}>
        <Icon name="plus" size={15} />
      </button>
      <span
        className="nb-gutter-btn is-grip"
        title="Drag to move it — between blocks, or to a side of one to sit beside it · click to pick it"
        onPointerDown={(e) => {
          e.stopPropagation();
          if (b.free) {
            pickBlock(b.id);
            beginFreeMove(e, b);
          } else beginMove(e, b.id, true);
        }}
      >
        <Icon name="grip" size={15} />
      </span>
      {inserting?.after === b.id && !inserting.replace && insertMenu(b.id)}
    </span>
  );
  const [barMenu, setBarMenu] = useState<{ id: string; which: "flat" | "more" } | null>(null);
  // a menu open (a bar's, or +): a press anywhere else puts it away
  useEffect(() => {
    if (!barMenu && !(inserting && !inserting.replace)) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".nb-obj-menu, .nb-obj-bar, .nb-insert, .nb-gutter, .nb-end-add")) return;
      setBarMenu(null);
      setInserting((now) => (now?.replace ? now : null));
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [barMenu, inserting]);
  /** a picked (or pointed-at) block's bar: what it is, open it, where it sits, flatten, more */
  const objectBar = (b: Block, inRow: boolean) => {
    const { label, icon } = kindOf(b);
    const cell = b.kind === "cell" ? b : null;
    const flat = cell ? flatOf(cell) : null;
    const code = !!cell && (cell.lang === "python" || !!codeLanguage(cell));
    const menu = barMenu?.id === b.id ? barMenu.which : null;
    const at = doc!.blocks.findIndex((x) => x.id === b.id);
    const set = (patch: Partial<Placement>) => {
      setBarMenu(null);
      place(b, patch);
    };
    // where it sits: text aligns its lines; a picture or an app its box (narrowed, if it took the whole line)
    const spot = b.wide ? "wide" : b.wrap ? `wrap-${b.wrap}` : (b.align ?? "left");
    const narrow = (to: number) => (b.width && b.width < 100 ? b.width : to);
    const toggleMenu = (which: "flat" | "more") => setBarMenu(menu === which ? null : { id: b.id, which });
    return (
      <div className={`nb-obj-bar${menu ? " is-open" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span className="nb-obj-name">
          <Icon name={icon} size={13} /> {label}
          {flat && <span className="nb-obj-tag" title="Kept as a picture — not worked out or drawn again">picture</span>}
        </span>
        {cell && !flat && (LINKED_LANGS[cell.lang] && canLink() ? (
          <button className={`is-text${openInAppNow(b) ? " is-on" : ""}`} title={openInAppNow(b) ? "It's open in its app — bring it forward" : `Open it in ${label} — the app itself, beside the page (or double-click it)`} onClick={() => openBlock(b)}>
            <Icon name="arrow" size={13} /> {openInAppNow(b) ? "Open" : "Open"}
          </button>
        ) : (
          <button title={code ? "Edit its code (click the code, or Enter)" : "Work in it (double-click it, or Enter)"} onClick={() => startEditing(b)}>
            <Icon name="pen" size={14} />
          </button>
        ))}
        {cell && runnable(cell) && !flat && (
          <button title="Run it (⇧⏎ when it's picked)" onClick={() => runBlock(cell, cell.code)}>
            <Icon name="run" size={13} />
          </button>
        )}
        {cell && flat && (
          <button className="is-text" title="Live again — worked out and drawn as it is now (or double-click it)" onClick={() => unflatten(cell)}>
            <Icon name="bolt" size={13} /> Live
          </button>
        )}
        {!inRow && (
          <>
            <span className="nb-obj-sep" />
            <button className={spot === "left" ? "is-on" : ""} title={cell ? "On the left" : "Lines on the left"} onClick={() => set({ align: undefined, wrap: undefined, wide: undefined })}>
              <Icon name="alignLeft" size={15} />
            </button>
            <button className={spot === "center" ? "is-on" : ""} title={cell ? "Centered" : "Lines centered"} onClick={() => set({ align: "center", wrap: undefined, wide: undefined, ...(cell ? { width: narrow(70) } : {}) })}>
              <Icon name="alignCenter" size={15} />
            </button>
            <button className={spot === "right" ? "is-on" : ""} title={cell ? "On the right" : "Lines on the right"} onClick={() => set({ align: "right", wrap: undefined, wide: undefined, ...(cell ? { width: narrow(70) } : {}) })}>
              <Icon name="alignRight" size={15} />
            </button>
            {!cell && (
              <button
                className={b.free ? "is-on" : ""}
                title={b.free ? "Back into the text" : "Free — a text box you drag anywhere on the page (by its grip), helper lines lining it up"}
                onClick={() => set(b.free ? { free: undefined } : { free: { x: 0, y: 0 }, width: b.width && b.width < 90 ? b.width : 40 })}
              >
                <Icon name="move" size={15} />
              </button>
            )}
            {cell && (
              <>
                <button className={spot === "wrap-left" ? "is-on" : ""} title="On the left, the text after it flowing around it" onClick={() => set({ wrap: "left", align: undefined, wide: undefined, width: b.width && b.width <= 70 ? b.width : 45 })}>
                  <Icon name="wrapLeft" size={15} />
                </button>
                <button className={spot === "wrap-right" ? "is-on" : ""} title="On the right, the text after it flowing around it" onClick={() => set({ wrap: "right", align: undefined, wide: undefined, width: b.width && b.width <= 70 ? b.width : 45 })}>
                  <Icon name="wrapRight" size={15} />
                </button>
                <button
                  className={b.free ? "is-on" : ""}
                  title={b.free ? "Back into the text" : "Free — drag it anywhere on the page, in front of the text (helper lines line it up)"}
                  onClick={() => set(b.free ? { free: undefined } : { free: { x: 0, y: 0 }, wrap: undefined, wide: undefined, align: undefined, width: b.width && b.width < 90 ? b.width : 50 })}
                >
                  <Icon name="move" size={15} />
                </button>
                <button className={spot === "wide" ? "is-on" : ""} title={b.wide ? "Back to the text's width" : "Wide — out past the text, toward the page's edges"} onClick={() => set(b.wide ? { wide: undefined } : { wide: true, width: undefined, align: undefined, wrap: undefined })}>
                  <Icon name="wide" size={15} />
                </button>
              </>
            )}
          </>
        )}
        {cell && !flat && (
          <span className="nb-obj-anchor">
            <button className={`is-text${menu === "flat" ? " is-on" : ""}`} title="Flatten — kept as it shows (a picture, or math text), not worked out or drawn again" onClick={() => toggleMenu("flat")}>
              <Icon name="frame" size={13} /> Flatten
            </button>
            {menu === "flat" && (
              <span className="nb-obj-menu">
                <button onClick={() => (setBarMenu(null), flatten(cell, "png"))}>A picture (PNG)</button>
                <button onClick={() => (setBarMenu(null), flatten(cell, "jpeg"))}>A smaller picture (JPEG)</button>
                {(cell.lang === "calc" || cell.lang === "vars") && <button onClick={() => (setBarMenu(null), toLatex(cell, calcIndex.get(cell.id) ?? -1))}>Math text (LaTeX)</button>}
              </span>
            )}
          </span>
        )}
        <span className="nb-obj-anchor">
          <button className={menu === "more" ? "is-on" : ""} title="More" onClick={() => toggleMenu("more")}>
            <Icon name="more" size={15} />
          </button>
          {menu === "more" && (
            <span className="nb-obj-menu is-right">
              {!inRow && !b.wide && (
                <span className="nb-obj-sizes">
                  {[33, 50, 75, 100].map((w) => (
                    <button key={w} className={(b.width ?? 100) === w ? "is-on" : ""} onClick={() => set({ width: w === 100 ? undefined : w })}>
                      {w === 100 ? "Full" : `${w}%`}
                    </button>
                  ))}
                </span>
              )}
              {code && (
                <button onClick={() => (setBarMenu(null), updateBlock(b.id, { info: withFlag(cell!.info, "hide-code", !hasFlag(b, "hide-code")) }))}>{hasFlag(b, "hide-code") ? "Show its code" : "Hide its code (a report shows the answer)"}</button>
              )}
              {code && (
                <button onClick={() => (setBarMenu(null), updateBlock(b.id, { info: withFlag(cell!.info, "fold-output", !hasFlag(b, "fold-output")) }))}>{hasFlag(b, "fold-output") ? "Show its output" : "Fold its output away"}</button>
              )}
              {cell?.lang === "work" && <button onClick={() => (setBarMenu(null), reopen(cell.code))}>Open it in the Work tile</button>}
              {at > 0 && <button onClick={() => (setBarMenu(null), toggleBeside(b.id))}>{b.beside ? "On a line of its own" : "Beside the one above"}</button>}
              <button onClick={() => (setBarMenu(null), duplicateBlock(b))}>Duplicate</button>
              <button onClick={() => (setBarMenu(null), moveBlock(b.id, -1))}>Move up</button>
              <button onClick={() => (setBarMenu(null), moveBlock(b.id, 1))}>Move down</button>
              <button className="is-danger" onClick={() => (setBarMenu(null), removeBlock(b.id))}>
                Delete
              </button>
            </span>
          )}
        </span>
      </div>
    );
  };
  // how far a wide block reaches past the text: the page's margin, less a little
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    const fit = () => {
      el.style.setProperty("--nb-room", `${Math.max(0, Math.min(240, parseFloat(getComputedStyle(el).paddingLeft) - 30))}px`);
      // the page's own color (a free block in front of the text is filled with it)
      for (let up: HTMLElement | null = el; up; up = up.parentElement) {
        const c = getComputedStyle(up).backgroundColor;
        if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
          el.style.setProperty("--nb-paper", c);
          break;
        }
      }
    };
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [view, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // pictures in text (![](Name.assets/…)): read from the notebook's folder once on the page
  useEffect(() => {
    for (const img of page.current?.querySelectorAll<HTMLImageElement>("img[data-asset]:not([src])") ?? []) {
      const path = decodeURI(img.dataset.asset!);
      const cached = flatPictures.get(path);
      if (cached) img.src = cached;
      else
        invoke<string>("flat_read", { path })
          .then((url) => (flatPictures.set(path, url), (img.src = url)))
          .catch(() => img.replaceWith(Object.assign(document.createElement("span"), { className: "nb-missing", textContent: "(a picture that's gone)" })));
    }
  });
  /** a picked block alone on its line: its edges, to drag */
  const sizeHandles = (b: Block) => {
    const side = b.wrap ?? b.align ?? "left";
    return (
      <>
        {side !== "right" && <div className="nb-size is-right" title="Drag to size it · double-click: the whole line" onPointerDown={(e) => startSizing(e, b, "right")} onDoubleClick={() => place(b, { width: undefined })} />}
        {side !== "left" && <div className="nb-size is-left" title="Drag to size it · double-click: the whole line" onPointerDown={(e) => startSizing(e, b, "left")} onDoubleClick={() => place(b, { width: undefined })} />}
        {sizing?.id === b.id && <span className="nb-size-label">{sizing.width}%</span>}
      </>
    );
  };

  const blockView = (b: Block, calcAt: number, inRow = false): ReactNode => {
    const isEditing = editing === b.id;
    const isPicked = picked === b.id && !isEditing;
    const marks = `${foundIds.has(b.id) ? (currentFound?.id === b.id ? " is-found-here" : " is-found") : ""}${dropMark(b.id)}${isPicked ? " is-picked" : ""}`;
    if (b.kind === "text") {
      // / at the start of a new line: what to put here instead
      const slash = isEditing && /^\/[\w ]*$/.test(draft) ? draft.slice(1).toLowerCase() : null;
      return (
        <div key={b.id} data-block={b.id} className={`nb-block is-text${isEditing ? " is-editing" : ""}${b.align && b.align !== "left" ? ` is-lines-${b.align}` : ""}${marks}`}>
          {!isEditing && gutter(b)}
          {isEditing && mathRowsOf(b.text) !== null ? (
            // a Math block: math typed as math, drawn as it's typed
            <MathBlockLive text={draft} onChange={type} onDone={() => finishEditing()} />
          ) : isEditing ? (
            // written as it reads (live preview): the Markdown shows only where the caret is
            <CodeEditor value={draft} onChange={type} onDone={() => finishEditing()} vimKeys={vimKeys} prose markdown keys={proseKeys(b)} onPaste={pasteInto} at={clickAt.current ?? undefined} fromTop={fromTop.current} onEdge={onEdge(b)} onView={setTextView} />
          ) : (
            <div
              className="nb-md"
              onClick={(e) => {
                const box = (e.target as HTMLElement).closest?.("input[type=checkbox]");
                if (box) {
                  e.stopPropagation();
                  const n = [...e.currentTarget.querySelectorAll("input[type=checkbox]")].indexOf(box);
                  updateBlock(b.id, { text: toggleTask(b.text, n) });
                  return;
                }
                if (!followLinks(e)) {
                  clickAt.current = { x: e.clientX, y: e.clientY };
                  startEditing(b);
                }
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }}
            />
          )}
          {slash !== null && insertMenu(null, b.id, slash)}
          {!isEditing && /^#{1,6}\s/m.test(b.text) && sectionOf(b).length > 0 && (
            <span className="nb-section-tools">
              <button title="Bounce this section in place — every block under this header kept as a picture, so nothing in it is drawn or worked out again" onClick={() => bounceSection(b)}>
                <Icon name="frame" size={12} /> bounce
              </button>
              {sectionOf(b).some((x) => flatOf(x)) && (
                <button title="Every block under this header live again" onClick={() => unbounceSection(b)}>
                  unbounce
                </button>
              )}
            </span>
          )}
          {isPicked && objectBar(b, inRow)}
          {isPicked && !inRow && sizeHandles(b)}
        </div>
      );
    }
    const flat = flatOf(b);
    const language = codeLanguage(b);
    // a kind of cell a plugin adds (```csv): what its render makes of it
    const pluginCell = !language && b.kind === "cell" && !OWN_CELLS.has(b.lang) ? (plugins.cells.find((c) => c.id === b.lang.toLowerCase()) ?? cellKindOf(b.lang)) : undefined;
    const { label, icon } = kindOf(b);
    // code: Python, a language's, or one no plugin knows — its code is what's on the page
    const isCode = b.lang === "python" || !!language || (!OWN_CELLS.has(b.lang) && !pluginCell);
    // a cell that runs (Python, or a plugin's language): its output's key
    const runKey = b.lang === "python" || language ? outKey(b.lang, b.code) : null;
    const result =
      flat && !isEditing ? (
        <FlatPicture path={flat} fill={(!!b.width && !inRow) || !!b.wide} />
      ) : b.lang === "vars" ? (
        // being worked in: the table; done: the values as they read
        isEditing ? (
          <VarsCell code={b.code} lines={calc?.[calcAt]} onCommit={(code) => updateBlock(b.id, { code })} onDone={() => finishEditing()} />
        ) : (
          <VarsRecord code={b.code} lines={calc?.[calcAt]} />
        )
      ) : language ? (
        <PythonOutput output={py[runKey!]} running={running.has(runKey!)} live={live?.code === runKey ? live.text : undefined} matlab={language.output === "matlab"} />
      ) : pluginCell ? (
        <PluginCell kind={pluginCell} code={isEditing ? draft : b.code} />
      ) : b.lang === "calc" ? (
        isEditing ? (
          // being worked in: the calculator itself
          <CalcLive
            code={draft}
            lines={calc?.[calcAt]}
            known={varsAt.get(b.id) ?? {}}
            equations={equations}
            onChange={(c) => {
              type(c);
              updateBlock(b.id, { code: c });
            }}
            onDone={() => finishEditing()}
          />
        ) : (
          <CalcRecord code={b.code} lines={calc?.[calcAt]} onChange={(c) => updateBlock(b.id, { code: c })} />
        )
      ) : b.lang === "graph" ? (
        isEditing ? (
          // being worked in: the graphing tool itself
          <GraphLive
            code={draft}
            vars={varsAt.get(b.id) ?? {}}
            onChange={(c) => {
              type(c);
              updateBlock(b.id, { code: c });
            }}
            onDone={(picture) => graphDone(b, picture)}
          />
        ) : (
          <GraphRecord
            code={b.code}
            picture={
              shotOf(b) ? (
                <FlatPicture path={shotOf(b)!} />
              ) : (
                <WhenSeen height={360}>
                  <GraphCell id={b.id} code={b.code} />
                </WhenSeen>
              )
            }
          />
        )
      ) : b.lang === "table" ? (
        // a spreadsheet, typed into right on the page
        <TableBlock code={b.code} plotted={hasFlag(b, "plot")} onChange={(code) => updateBlock(b.id, { code })} onPlot={(on) => updateBlock(b.id, { info: withFlag(b.info, "plot", on) })} />
      ) : b.lang === "numberline" ? (
        <NumberLineCell code={isEditing ? draft : b.code} />
      ) : b.lang === "work" ? (
        <WorkCell code={isEditing ? draft : b.code} />
      ) : b.lang === "python" ? (
        <PythonOutput output={py[b.code]} running={running.has(b.code)} live={live?.code === b.code ? live.text : undefined} />
      ) : null;
    const codeHidden = !isEditing && hasFlag(b, "hide-code");
    const outFolded = hasFlag(b, "fold-output");
    const foldLine = (what: string, flag: string, lines?: number) => (
      <button className="nb-folded" title={`Show its ${what} again`} onClick={() => updateBlock(b.id, { info: withFlag(b.info, flag, false) })}>
        {what} hidden{lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""} — show
      </button>
    );
    const codeEditor = (
      <CodeEditor
        value={draft}
        onChange={type}
        onDone={() => finishEditing()}
        vimKeys={vimKeys}
        python={b.lang === "python"}
        spec={b.lang === "python" ? PYTHON_SPEC : language?.highlight}
        onRun={() => runEdited(b)}
        onRunNext={runnable(b) ? () => runAndNext(b) : undefined}
        onRunInsert={runnable(b) ? () => runAndInsert(b) : undefined}
        complete={b.lang === "python" && name ? completePython : undefined}
        fromTop={fromTop.current}
        onEdge={onEdge(b)}
      />
    );
    // code on the page: a panel with its language, its count, Run
    const codePanel = isCode && !flat && (
      <div className="nb-code-panel">
        <div className="nb-code-head">
          <span className="nb-code-lang">{label}</span>
          {b.lang === "python" && (
            <span className="nb-count" title={py[b.code]?.count ? `Run ${py[b.code]!.count} in this Python` : "Not run yet"}>
              [{running.has(b.code) ? "*" : (py[b.code]?.count ?? " ")}]
            </span>
          )}
          {b.lang !== "python" && !language && <span className="nb-cell-note" title="Add a plugin for this language to color and run it">no plugin runs {b.lang}</span>}
          <span className="nb-code-space" />
          {runKey && running.has(runKey) && started.current[runKey] !== undefined && <span className="nb-time is-running">{((performance.now() - started.current[runKey]) / 1000).toFixed(1)} s</span>}
          {runKey && py[runKey]?.seconds !== undefined && !running.has(runKey) && <span className="nb-time">{py[runKey]!.seconds! < 1 ? `${Math.round(py[runKey]!.seconds! * 1000)} ms` : `${py[runKey]!.seconds!.toFixed(1)} s`}</span>}
          {language && runKey && running.has(runKey) && (
            <button className="nb-run is-stop" title="Stop it" onClick={() => name && invoke("lang_stop", { notebook: name, lang: language.id }).catch(() => {})}>
              Stop
            </button>
          )}
          {b.lang === "python" ? (
            <button
              className="nb-run"
              title="Run this cell — ⌘⏎ (⇧⏎ runs it and goes on to the next, ⌥⏎ runs it and adds a cell under it) · ⇧-click: this and every cell below · ⌥-click: every cell above, then this"
              onClick={(e) => {
                const all = codesOf(docRef.current);
                const at = all.indexOf(b.code);
                if (e.shiftKey) runCells(all.slice(at));
                else if (e.altKey) runCells(all.slice(0, at + 1));
                else runCell(b.code);
              }}
            >
              <Icon name="run" size={12} /> Run
            </button>
          ) : language?.run?.length ? (
            <button className="nb-run" title="Run this cell — ⌘⏎ (⇧⏎ runs it and goes on, ⌥⏎ runs it and adds a cell under it)" onClick={() => runLanguage(language, b.code)}>
              <Icon name="run" size={12} /> Run
            </button>
          ) : null}
        </div>
        {codeHidden ? (
          foldLine("code", "hide-code", b.code.split("\n").length)
        ) : isEditing ? (
          codeEditor
        ) : b.lang === "python" ? (
          <pre className="nb-code" onClick={() => startEditing(b)} dangerouslySetInnerHTML={{ __html: highlightWithError(b.code || " ", Number(py[b.code]?.error?.match(/^line (\d+):/)?.[1]) || undefined) }} />
        ) : language ? (
          <pre className="nb-code" onClick={() => startEditing(b)} dangerouslySetInnerHTML={{ __html: highlightCode(b.code || " ", language.highlight) }} />
        ) : (
          <pre className="nb-code" onClick={() => startEditing(b)}>
            {b.code || " "}
          </pre>
        )}
      </div>
    );
    // an app being worked in: it, with what it is and a way out above it
    const appEditor = !isCode && isEditing && (b.lang === "work" ? <WorkCellEditor code={draft} onChange={setDraft} onDone={() => finishEditing()} /> : b.lang === "numberline" || pluginCell ? codeEditor : null);
    return (
      <div
        key={b.id}
        data-block={b.id}
        className={`nb-block is-cell is-obj is-${b.lang}${isCode ? " is-code" : " is-app"}${isEditing ? " is-editing" : ""}${flat ? " is-flat" : ""}${openInAppNow(b) ? " is-in-app" : ""}${marks}`}
        onPointerDown={(e) => objectDown(e, b)}
        onClick={() => objectClick(b)}
        onDoubleClick={(e) => !isEditing && !(e.target as HTMLElement).closest("button, a, input, textarea, math-field, .cm-editor, .nb-obj-bar, .nb-gutter, .nb-code") && openBlock(b)}
      >
        {!isEditing && gutter(b)}
        {openInAppNow(b) && (
          <span className="nb-in-app" title="It's open in its app — what you do there shows here as you go">
            <Icon name={icon} size={12} /> open in {label}
          </span>
        )}
        {isEditing && !isCode && b.lang !== "graph" && b.lang !== "table" && (
          <div className="nb-obj-live">
            <span className="nb-obj-name">
              <Icon name={icon} size={13} /> {label}
            </span>
            <span className="nb-obj-live-hint" />
            <button className="nb-obj-done" onClick={() => finishEditing()}>
              <Icon name="check" size={13} /> Done
            </button>
          </div>
        )}
        {codePanel}
        {appEditor}
        {result && outFolded && foldLine("output", "fold-output")}
        {result && !outFolded && <div className="nb-obj-body nb-cell-result">{result}</div>}
        {!isEditing && objectBar(b, inRow)}
        {isPicked && !inRow && !b.wide && sizeHandles(b)}
      </div>
    );
  };

  /** a key in the notebook, nothing being edited: j/k pick, Enter edits, a/b add, dd deletes… */
  const commandKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && (barMenu || (inserting && !inserting.replace))) {
      setBarMenu(null);
      setInserting(null);
      return true;
    }
    if (!doc || editing || e.metaKey || e.ctrlKey || e.altKey) return false;
    const blocks = doc.blocks;
    const at = picked ? blocks.findIndex((b) => b.id === picked) : -1;
    const pick = (i: number) => {
      const b = blocks[Math.max(0, Math.min(blocks.length - 1, i))];
      if (!b) return;
      setPicked(b.id);
      page.current?.querySelector(`[data-block="${b.id}"]`)?.scrollIntoView({ block: "nearest" });
      if (!toldKeys.current) {
        toldKeys.current = true;
        setNotice("j/k: pick · Enter: edit · a/b: add above/below · dd: delete · ⇧J/⇧K: move it · ⇧⏎: run");
      }
    };
    const key = e.key;
    const twice = lastKey.current.key === key && Date.now() - lastKey.current.at < 600;
    lastKey.current = { key, at: Date.now() };
    if (key === "j" || (key === "ArrowDown" && at >= 0)) return pick(at + 1), true;
    if (key === "k" || (key === "ArrowUp" && at >= 0)) return pick(at < 0 ? blocks.length - 1 : at - 1), true;
    if (at < 0) return false;
    const b = blocks[at];
    if (key === "Enter" && e.shiftKey) {
      if (runnable(b)) runBlock(b, b.kind === "cell" ? b.code : b.text);
      return pick(at + 1), true;
    }
    if (key === "Enter") return openBlock(b), true;
    if (key === "Backspace" || key === "Delete") {
      removeBlock(b.id);
      const next = blocks[at + 1] ?? blocks[at - 1];
      setPicked(next?.id ?? null);
      return true;
    }
    if (key === "Escape") return setPicked(null), setBarMenu(null), true;
    if (key === "J" || key === "K") {
      moveBlock(b.id, key === "J" ? 1 : -1);
      setTimeout(() => page.current?.querySelector(`[data-block="${b.id}"]`)?.scrollIntoView({ block: "nearest" }), 0);
      return true;
    }
    if (key === "a" || key === "b") {
      const id = blockId();
      const where = key === "a" ? at : at + 1;
      commit({ ...doc, blocks: [...blocks.slice(0, where), { id, kind: "text", text: "" }, ...blocks.slice(where)] });
      setEditing(id);
      setDraft("");
      return true;
    }
    if (key === "d") {
      if (!twice) return true;
      lastKey.current = { key: "", at: 0 };
      removeBlock(b.id);
      const next = blocks[at + 1] ?? blocks[at - 1];
      setPicked(next?.id ?? null);
      return true;
    }
    return false;
  };

  let calcAt = 0;
  return (
    <div
      ref={root}
      className="nb"
      // focusable, so its keys (⌘F) come here once it's clicked
      tabIndex={-1}
      onKeyDownCapture={(e) => {
        // ⌘Z / ⌘⇧Z: the notebook's changes (a field or the code editor undoes its own typing)
        const inField = (e.target as HTMLElement).closest?.("input, textarea, .cm-editor, math-field, [contenteditable]");
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z" && !inField) {
          e.preventDefault();
          notebookUndo(e.shiftKey);
          return;
        }
        // ⌘P: go to any note
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
          e.preventDefault();
          setQuickOpen(true);
          return;
        }
        // ⌘F: find in this notebook (the editor's own search, in vim, is /)
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f" && !(e.target as HTMLElement).closest?.(".cm-editor")) {
          e.preventDefault();
          startFinding();
          return;
        }
        // the keys of command mode (not while typing anywhere)
        if (!inField && !(e.target as HTMLElement).closest?.("button, select, .nb-pop, .xy-pop") && commandKey(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {toolbar}
      {quickOpen && <QuickOpen listing={listing} onClose={() => setQuickOpen(false)} onOpen={(n) => (setQuickOpen(false), setView("doc"), onOpen(n))} />}
      {finding && (
        <div className="nb-find">
          <input
            ref={findInput}
            className="nb-find-input"
            value={finding.find}
            placeholder="Find in this notebook"
            spellCheck={false}
            onChange={(e) => setFinding({ ...finding, find: e.target.value, at: 0 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") setFinding({ ...finding, at: finding.at + (e.shiftKey ? -1 : 1) });
              if (e.key === "Escape") setFinding(null);
            }}
            autoFocus
          />
          <span className="nb-find-count">{finding.find ? (found.length ? `${(((finding.at % found.length) + found.length) % found.length) + 1} of ${found.length}` : "none") : ""}</span>
          <button className="nb-tool is-icon" title="The one before (⇧⏎)" disabled={!found.length} onClick={() => setFinding({ ...finding, at: finding.at - 1 })}>
            <Icon name="up" size={13} />
          </button>
          <button className="nb-tool is-icon" title="The next (⏎)" disabled={!found.length} onClick={() => setFinding({ ...finding, at: finding.at + 1 })}>
            <Icon name="down" size={13} />
          </button>
          <button className={`nb-tool${finding.replacing ? " is-on" : ""}`} title="Replace" onClick={() => setFinding({ ...finding, replacing: !finding.replacing })}>
            Replace
          </button>
          {finding.replacing && (
            <>
              <input className="nb-find-input" value={finding.replace} placeholder="with" spellCheck={false} onChange={(e) => setFinding({ ...finding, replace: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setFinding(null)} />
              <button className="nb-tool" disabled={!found.length} onClick={() => replaceFound(false)}>
                This one
              </button>
              <button className="nb-tool" disabled={!found.length} onClick={() => replaceFound(true)}>
                Every one
              </button>
            </>
          )}
          <button className="nb-tool is-icon" title="Close (Esc)" onClick={() => setFinding(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
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
          {undo.label}
          <button onClick={() => (undo.run(), setUndo(null))}>{undo.button}</button>
        </div>
      )}
      {preview && <Preview html={preview} onClose={() => setPreview(null)} onPrint={print} />}
      {varsOpen && view !== "new" && (
        <div className="nb-vars">
          <div className="nb-vars-head">
            Variables <span className="nb-vars-dim">{kernel === "off" ? "— run a cell to start Python" : `${vars.length}`}</span>
            <button className="nb-tool is-icon" title="Close" onClick={() => setVarsOpen(false)}>
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="nb-vars-list">
            {Object.keys(langVars).length > 0 && vars.length > 0 && <div className="nb-vars-lang">Python</div>}
            {vars.map((v) => (
              <div key={v.name} className="nb-var" title={v.value}>
                <span className="nb-var-name">{v.name}</span>
                <span className="nb-var-type">
                  {v.type}
                  {v.shape ? ` ${v.shape.join("×")}` : ""}
                </span>
                <span className="nb-var-value">{v.value}</span>
              </div>
            ))}
            {Object.entries(langVars).map(([label, list]) => (
              <Fragment key={label}>
                <div className="nb-vars-lang">{label}</div>
                {list.map((v) => (
                  <div key={`${label}:${v.name}`} className="nb-var" title={v.value}>
                    <span className="nb-var-name">{v.name}</span>
                    <span className="nb-var-type">
                      {v.type} {v.shape}
                    </span>
                    <span className="nb-var-value">{v.value}</span>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
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
        <div className="nb-main">
        {libraryOpen && <Library listing={listing} current={name ?? null} onOpen={(n) => (setView("doc"), onOpen(n))} onNew={() => setView("new")} />}
        <div className="nb-center">
        <FormatBar view={textView} onUndo={() => notebookUndo(false)} onRedo={() => notebookUndo(true)} onNew={(start) => addBlock({ lang: "text", start })} onPicture={keepPicture} />
        <div
          className="nb-page"
          ref={page}
          onScroll={spy}
          // a press on the page around the blocks: nothing picked
          onPointerDown={(e) => !(e.target as HTMLElement).closest("[data-block], .nb-insert, .nb-end, .nb-add") && setPicked(null)}
        >
          {header}
          {rowsOf(doc.blocks).map((row) => {
            if (row.length === 1) {
              const b = row[0];
              const width = sizing?.id === b.id ? sizing.width : (b.width ?? 100);
              const spot = b.free ? " is-free" : b.wide ? " is-wide" : b.wrap ? ` is-wrap-${b.wrap}` : b.kind === "cell" && b.align && b.align !== "left" ? ` is-align-${b.align}` : "";
              const at = freeDrag?.id === b.id ? freeDrag : b.free;
              return (
                <div key={`solo-${b.id}`} className={`nb-solo is-${b.kind}${spot}${sizing?.id === b.id ? " is-sizing" : ""}`} style={width < 100 && !b.wide ? { width: `${width}%` } : undefined}>
                  {at ? (
                    // placed freely: in front of the text, where it was put (its place in the text is its anchor)
                    <div className="nb-free" style={{ left: at.x, top: at.y }}>
                      {blockView(b, isCalcLike(b) ? calcAt++ : -1)}
                    </div>
                  ) : (
                    blockView(b, isCalcLike(b) ? calcAt++ : -1)
                  )}
                  {freeDrag?.id === b.id && freeDrag.guides.map((g) => <div key={g} className="nb-guide" style={{ left: g }} />)}
                </div>
              );
            }
            // side by side: each block its share of the row, a line between to drag
            const widths = resizing?.row === row[0].id ? resizing.widths : widthsOf(row);
            return (
              <div key={`row-${row[0].id}`} className={`nb-row${resizing?.row === row[0].id ? " is-resizing" : ""}`}>
                {row.map((b, k) => (
                  <Fragment key={b.id}>
                    {k > 0 && <div className="nb-col-handle" title="Drag to resize" onPointerDown={(e) => startResize(e, row, k)} />}
                    <div className="nb-col" style={{ flexBasis: `${widths[k]}%` }}>
                      {blockView(b, isCalcLike(b) ? calcAt++ : -1, true)}
                    </div>
                  </Fragment>
                ))}
              </div>
            );
          })}
          {!doc.blocks.length && <div className="nb-empty">An empty page — click below to write, or + for an app.</div>}
          {/* the end of the page: click to write on; + for anything else */}
          <div className="nb-end">
            <button className={`nb-gutter-btn nb-end-add${inserting?.after === null && !inserting.replace ? " is-on" : ""}`} title="Add something — text, math, an app, code" onClick={() => setInserting(inserting?.after === null && !inserting.replace ? null : { after: null })}>
              <Icon name="plus" size={15} />
            </button>
            <button className="nb-end-write" onClick={() => addBlock({ lang: "text", start: "" })}>
              Click to write
            </button>
            {inserting?.after === null && !inserting.replace && insertMenu(null)}
          </div>
          <div className="nb-foot">
            Saved as {name}.md · {todayLabel()} · {wordCount} word{wordCount === 1 ? "" : "s"}
          </div>
        </div>
        </div>
        {outlineOpen && outline.length > 0 && (
          <nav className="nb-outline-side">
            <div className="nb-outline-title">Outline</div>
            {outline.map((h, i) => (
              <button
                key={i}
                className={`nb-outline-item${i === hereAt ? " is-here" : ""}`}
                style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                title={h.text}
                onClick={() => page.current?.querySelector(`[data-block="${h.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}
        </div>
      )}
    </div>
  );
}
