/** Notes on worked problems — beside a step, or under the problem — and how
 * they look printed: a font, bold / italic / underline, a highlighter.
 *
 * In a work cell's text a note is written the way LaTeX writes a comment,
 * after a %, its look first in braces when it has one:
 *
 *   2x = 8 % {hand yellow} subtract 3 from both sides
 *   note: {sans bold} check: 2(4) + 3 = 11
 */
import type { CSSProperties, PointerEvent } from "react";
import type { Note, NoteStyle } from "../store";
import { NOTE_FONTS, NOTE_HIGHLIGHTS, noteCss } from "../workHistory";

const FONTS = NOTE_FONTS.map((f) => f.value) as string[];
const MARKS = NOTE_HIGHLIGHTS.map((h) => h.value) as string[];

/** "{hand bold yellow} subtract 3" → the note and its look */
export function readNote(text: string): Note | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^\{([a-z ,]+)\}\s*/i);
  const words = m ? m[1].toLowerCase().split(/[\s,]+/).filter(Boolean) : [];
  // braces with anything that isn't a look in them are just text
  if (!m || words.some((w) => !FONTS.includes(w) && !MARKS.includes(w) && !["bold", "italic", "underline"].includes(w))) return { text: t };
  const style: NoteStyle = {};
  for (const w of words) {
    if (FONTS.includes(w)) style.font = w as NoteStyle["font"];
    else if (MARKS.includes(w)) style.highlight = w as NoteStyle["highlight"];
    else style[w as "bold" | "italic" | "underline"] = true;
  }
  return { text: t.slice(m[0].length), style };
}

/** the note as it's written in the cell */
export function writeNote(note: Note | null | undefined): string {
  if (!note?.text.trim()) return "";
  const s = note.style ?? {};
  const words = [s.font && s.font !== "serif" ? s.font : null, s.bold && "bold", s.italic && "italic", s.underline && "underline", s.highlight].filter(Boolean);
  return `${words.length ? `{${words.join(" ")}} ` : ""}${note.text.trim()}`;
}

/** a note's look on screen (the printed page's too) */
export function noteLook(style: NoteStyle = {}): CSSProperties {
  return { ...noteCss(style), ...(style.highlight ? { color: "#1d2330", padding: "1px 5px", borderRadius: 4 } : {}) } as CSSProperties;
}

export function NoteView({ note }: { note: Note | null | undefined }) {
  if (!note?.text.trim()) return null;
  return (
    <span className="nb-note" style={noteLook(note.style)}>
      {note.text}
    </span>
  );
}

/** A note to write, and its look — the bar shows while you're in it. */
export function NoteField({ note, placeholder, multiline = false, onChange }: { note: Note | null; placeholder: string; multiline?: boolean; onChange: (note: Note) => void }) {
  const text = note?.text ?? "";
  const style = note?.style ?? {};
  const setStyle = (patch: NoteStyle) => onChange({ text, style: { ...style, ...patch } });
  const look = noteLook(style);
  // a button press keeps the cursor in the note
  const keep = (e: PointerEvent) => e.preventDefault();
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
