/** The calculator's Assignment tab: the problems finished in Work, as an
 * assignment to hand in — a header, the book's numbers and each problem's
 * instructions, the work lined up with its final answer boxed, the number
 * line drawn for it. Preview it, print it or save it as a PDF. */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type AssignmentInfo, type Note, type NoteStyle, type WorkBlockData, type WorkHistoryEntry, useStore } from "../store";
import { NOTE_FONTS, NOTE_HIGHLIGHTS, assignmentHtml, assignmentLatex, assignmentOptions, carryNotes, defaultInstructions, noteCss, snapshot, stepNote, todayLabel, withCarriedNotes } from "../workHistory";
import { Tex } from "../ui";

type Work = Partial<Omit<WorkBlockData, "id" | "type" | "position">>;

export default function AssignmentTab({
  work,
  update,
  onReopen,
}: {
  /** the calculator's Work section (its history is the assignment) */
  work: Work;
  update: (patch: Work) => void;
  /** a problem put back in Work to be fixed */
  onReopen: () => void;
}) {
  const languages = useStore((s) => s.languages);
  const history = work.history ?? [];
  const info = work.assignment ?? {};
  const options = assignmentOptions(info);
  const [detailsOpen, setDetailsOpen] = useState(!info.title && !info.name);
  const [preview, setPreview] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [cleared, setCleared] = useState<{ history: WorkHistoryEntry[]; info: AssignmentInfo } | null>(null);
  const [filing, setFiling] = useState(false);
  /** the problem whose notes are open (one at a time) */
  const [notesFor, setNotesFor] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 8000);
    return () => clearTimeout(timer);
  }, [cleared]);

  const setInfo = (patch: AssignmentInfo) => update({ assignment: { ...info, ...patch } });
  const setEntry = (id: string, patch: Partial<WorkHistoryEntry>) => update({ history: history.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...history];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it);
    update({ history: next });
  };

  /** work in progress in Work, not filed yet */
  const unfiled = (work.lines ?? []).some((l) => l.trim()) && (work.workFor ?? work.problem ?? "").trim();
  const padEmpty = !(work.problem ?? "").trim() && !(work.lines ?? []).some((l) => l.trim());

  const fileCurrent = async () => {
    if (!unfiled || filing) return;
    setFiling(true);
    const syntax = !work.input || work.input === "visual" ? "latex" : work.input;
    const entry = await snapshot(work.workFor ?? work.problem ?? "", work.lines ?? [], work.reasons ?? [], syntax, languages).catch(() => null);
    setFiling(false);
    if (!entry) return setFlash("Couldn't add it — check the problem in Work");
    update({
      history: [...history, withCarriedNotes({ ...entry, ...(work.graph ? { graph: work.graph } : {}) }, work.carriedNotes)],
      problem: "",
      lines: [""],
      reasons: [""],
      workFor: undefined,
      graph: undefined,
      carriedNotes: undefined,
      guide: undefined,
    });
    setFlash("Added — Work is ready for the next problem");
  };

  const reopen = (entry: WorkHistoryEntry) => {
    if (!padEmpty) return;
    update({
      history: history.filter((h) => h.id !== entry.id),
      problem: entry.problem,
      lines: entry.lines.length ? entry.lines : [""],
      reasons: entry.reasons,
      workFor: entry.problem,
      graph: entry.graph,
      carriedNotes: carryNotes(entry), // put back when it's filed again
      guide: undefined,
    });
    onReopen();
  };

  const title = info.title?.trim() || "Homework";
  const print = async () => {
    if (!history.length) return setFlash("Finish a problem in Work first");
    try {
      const path = await invoke<string>("print_document", { name: title.replace(/[\\/:*?"<>|]/g, "-"), html: assignmentHtml(info, history) });
      setFlash(`Opened in your browser (saved to ${path.split("/").slice(-2).join("/")}) — ⌘P to print or save as PDF`);
    } catch (error) {
      setFlash(`Couldn't open it: ${error}`);
    }
  };
  const copyLatex = () =>
    navigator.clipboard?.writeText(assignmentLatex(info, history)).then(
      () => setFlash("Copied as LaTeX"),
      () => setFlash("Couldn't copy"),
    );

  const field = (label: string, key: keyof AssignmentInfo, placeholder: string, wide = false) => (
    <label className={`assign-field${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      <input className="nodrag" value={(info[key] as string | undefined) ?? ""} placeholder={placeholder} onChange={(e) => setInfo({ [key]: e.target.value })} />
    </label>
  );
  const toggle = (label: string, key: "box" | "marks" | "graphs" | "reasons", title: string) => (
    <label className="assign-toggle" title={title}>
      <input type="checkbox" checked={options[key]} onChange={(e) => setInfo({ [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="assign">
      <div className="assign-card">
        <button className="assign-details-head" onClick={() => setDetailsOpen(!detailsOpen)}>
          <span>
            <b>{title}</b>
            {info.name?.trim() ? ` · ${info.name.trim()}` : ""}
          </span>
          <span className="assign-chevron">{detailsOpen ? "▴" : "▾"}</span>
        </button>
        {detailsOpen && (
          <div className="assign-fields">
            {field("Title", "title", "Section 2.4 Homework", true)}
            {field("Your name", "name", "Name")}
            {field("Course", "course", "MATH 1314")}
            {field("Instructor", "instructor", "Optional")}
            {field("Date", "date", todayLabel())}
          </div>
        )}
      </div>

      <div className="assign-head">
        <span className="graph-section-title">Problems{history.length ? ` · ${history.length}` : ""}</span>
        {unfiled && (
          <button className="chip is-handoff" disabled={filing} title="The problem you're working on in Work — add it as it stands" onClick={fileCurrent}>
            + Add the problem in Work
          </button>
        )}
      </div>

      <div className="assign-list">
        {!history.length && <div className="assign-empty">Finish problems in Work — press Next problem and each one lands here, ready to hand in.</div>}
        {history.map((h, i) => (
          <div key={h.id} className="assign-item">
            <div className="assign-item-top">
              <span className="assign-hash">#</span>
              <input className="assign-number nodrag" value={h.number ?? ""} placeholder={String(i + 1)} title="Its number in your book" onChange={(e) => setEntry(h.id, { number: e.target.value })} />
              <input
                className="assign-instructions nodrag"
                value={h.instructions ?? ""}
                placeholder={defaultInstructions(h)}
                title="What the problem asks — leave it empty for the suggestion"
                onChange={(e) => setEntry(h.id, { instructions: e.target.value })}
              />
              <span className="assign-order">
                <button disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button disabled={i === history.length - 1} title="Move down" onClick={() => move(i, 1)}>
                  ↓
                </button>
              </span>
            </div>
            <div className="assign-item-math">
              <Tex math={h.problemLatex} />
            </div>
            <div className="assign-item-foot">
              <span className={`assign-status${h.solved ? " is-solved" : ""}`}>{h.solved ? "✓ solved" : "not finished"}</span>
              {h.graph && <span className="work-history-graph">number line</span>}
              <span className="assign-actions">
                <button className={notesFor === h.id ? "is-on" : ""} title="Notes beside its steps and under it, on the printed page" onClick={() => setNotesFor(notesFor === h.id ? null : h.id)}>
                  ✎ Notes{noteCount(h) ? ` · ${noteCount(h)}` : ""}
                </button>
                <button disabled={!padEmpty} title={padEmpty ? "Put it back in Work to fix it" : "Finish (or add) the problem in Work first"} onClick={() => reopen(h)}>
                  Reopen
                </button>
                <button title="Take it out of the assignment" onClick={() => update({ history: history.filter((x) => x.id !== h.id) })}>
                  Remove
                </button>
              </span>
            </div>
            {notesFor === h.id && (
              <div className="assign-notes">
                {h.steps.length > 0 && <div className="assign-notes-label">Beside each step</div>}
                {h.steps.map((step, k) => (
                  <div key={k} className="assign-note-row">
                    <span className="assign-note-step">
                      <Tex math={step.latex} />
                    </span>
                    <NoteField
                      note={stepNote(h, k)}
                      placeholder="a note beside this step"
                      onChange={(note) => {
                        const notes = h.steps.map((_, j) => h.stepNotes?.[j] ?? null);
                        notes[k] = note;
                        setEntry(h.id, { stepNotes: notes });
                      }}
                    />
                  </div>
                ))}
                <div className="assign-notes-label">Under the problem</div>
                <NoteField note={h.note ?? null} placeholder="a note under the problem" multiline onChange={(note) => setEntry(h.id, { note })} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="assign-options">
        {toggle("Box answers", "box", "Box each finished problem's final answer")}
        {toggle("Checkmarks", "marks", "The ✓ / ✗ beside each step")}
        {toggle("Graphs", "graphs", "The number line drawn for a problem")}
        {toggle("Step notes", "reasons", "Notes beside steps — and the reasons written in Work")}
      </div>

      <div className="assign-buttons">
        <button className="action-btn" disabled={!history.length} onClick={() => setPreview(true)}>
          Preview
        </button>
        <button className="action-btn is-primary" disabled={!history.length} onClick={print} title="Opens it in your browser — print it, or ⌘P → Save as PDF">
          Print / PDF
        </button>
        <button className="action-btn" disabled={!history.length} onClick={copyLatex}>
          Copy LaTeX
        </button>
        {cleared ? (
          <button
            className="action-btn"
            onClick={() => {
              update({ history: [...cleared.history, ...history], assignment: { ...cleared.info, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== "")) } });
              setCleared(null);
            }}
          >
            ↶ Undo
          </button>
        ) : (
          <button
            className="action-btn"
            disabled={!history.length}
            title="Start the next assignment (your name and course stay)"
            onClick={() => {
              setCleared({ history, info });
              update({ history: [], assignment: { ...info, title: "", date: "" } });
              setDetailsOpen(true);
            }}
          >
            New assignment
          </button>
        )}
      </div>
      {flash && <div className="assign-flash">{flash}</div>}

      {preview && <AssignmentPreview html={assignmentHtml(info, history)} onClose={() => setPreview(false)} onPrint={print} />}
    </div>
  );
}

/** notes written for a problem (a step's reason from Work counts) */
const noteCount = (h: WorkHistoryEntry) => h.steps.filter((_, k) => stepNote(h, k)?.text.trim()).length + (h.note?.text.trim() ? 1 : 0);

/** A note, and how it looks printed: a font, bold / italic / underline, a
 * highlighter — the bar shows while you're in it. The field shows the look. */
function NoteField({ note, placeholder, multiline = false, onChange }: { note: Note | null; placeholder: string; multiline?: boolean; onChange: (note: Note) => void }) {
  const text = note?.text ?? "";
  const style = note?.style ?? {};
  const setStyle = (patch: NoteStyle) => onChange({ text, style: { ...style, ...patch } });
  const look = { ...noteCss(style), ...(style.highlight ? { color: "#1d2330" } : {}) };
  // a button press keeps the cursor in the note
  const keep = (e: React.PointerEvent) => e.preventDefault();
  const flag = (key: "bold" | "italic" | "underline", label: string, title: string) => (
    <button className={`note-flag is-${key}${style[key] ? " is-on" : ""}`} aria-pressed={!!style[key]} title={title} onPointerDown={keep} onClick={() => setStyle({ [key]: !style[key] })}>
      {label}
    </button>
  );
  return (
    <div className="note-field">
      {multiline ? (
        <textarea className="note-text nodrag" rows={2} value={text} placeholder={placeholder} style={look} onChange={(e) => onChange({ text: e.target.value, style })} />
      ) : (
        <input className="note-text nodrag" value={text} placeholder={placeholder} style={look} onChange={(e) => onChange({ text: e.target.value, style })} />
      )}
      <div className="note-tools">
        <select className="nodrag" value={style.font ?? "serif"} title="Font" onChange={(e) => setStyle({ font: e.target.value as NoteStyle["font"] })}>
          {NOTE_FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {flag("bold", "B", "Bold")}
        {flag("italic", "I", "Italic")}
        {flag("underline", "U", "Underline")}
        <span className="note-marks" title="Highlighter">
          <button className={`note-mark is-none${style.highlight ? "" : " is-on"}`} title="No highlight" onPointerDown={keep} onClick={() => setStyle({ highlight: undefined })} />
          {NOTE_HIGHLIGHTS.map((h) => (
            <button
              key={h.value}
              className={`note-mark${style.highlight === h.value ? " is-on" : ""}`}
              style={{ background: h.color }}
              title={`${h.label} highlighter`}
              onPointerDown={keep}
              onClick={() => setStyle({ highlight: h.value })}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/** The printed page, as it will look. */
function AssignmentPreview({ html, onClose, onPrint }: { html: string; onClose: () => void; onPrint: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="assign-preview-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="assign-preview">
        <div className="assign-preview-head">
          <span>Preview</span>
          <span className="assign-preview-buttons">
            <button className="action-btn is-primary" onClick={onPrint}>
              Print / PDF
            </button>
            <button className="action-btn" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        {/* the page with its "how to print" hint hidden: it's the paper */}
        <iframe ref={frame} className="assign-preview-page" title="Assignment preview" srcDoc={html.replace('<div class="hint">', '<div class="hint" style="display:none">')} />
      </div>
    </div>
  );
}
