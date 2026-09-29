import { useState, type ReactNode } from "react";
import type { NodeProps } from "@xyflow/react";
import { type NoteBlockData, useStore } from "../store";
import { RichText, Tex } from "../ui";
import BlockShell from "./BlockShell";

/** Just enough markdown for math notes: # headings, - bullets, 1. lists,
 * | tables | (a |---| line under the first row makes it the header),
 * $$display math$$ lines, and inline $math$ / **bold** via RichText. */
export function renderNote(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  let key = 0;
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const flushTable = () => {
    if (!table) return;
    const rows = table;
    table = null;
    const header = rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c));
    const body = header ? rows.slice(2) : rows;
    out.push(
      <table key={key++} className="note-table">
        {header && (
          <thead>
            <tr>
              {rows[0].map((c, i) => (
                <th key={i}>
                  <RichText text={c} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td key={i}>
                  <RichText text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    );
  };
  const flush = () => {
    flushTable();
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i}>
        <RichText text={item} />
      </li>
    ));
    out.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim().startsWith("|")) {
      if (list) flush();
      (table ??= []).push(cells(line));
      continue;
    }
    flushTable();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const display = line.trim().match(/^\$\$(.+)\$\$$/);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <div key={key++} className={`note-h${level}`}>
          <RichText text={heading[2]} />
        </div>,
      );
    } else if (display) {
      out.push(<Tex key={key++} math={display[1]} block />);
    } else if (line.trim() === "") {
      out.push(<div key={key++} className="note-gap" />);
    } else if (line.trim().startsWith(">")) {
      out.push(
        <div key={key++} className="note-callout">
          <RichText text={line.trim().slice(1).trim()} />
        </div>,
      );
    } else {
      out.push(
        <p key={key++}>
          <RichText text={line} />
        </p>,
      );
    }
  }
  flush();
  return out;
}

export default function NoteBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as NoteBlockData;
  const updateBlock = useStore((state) => state.updateBlock<NoteBlockData>);
  const [editing, setEditing] = useState(false);

  if (!data) return null;

  return (
    <BlockShell
      id={data.id}
      title="Note"
      wide
      help="Notes and explanations. Click to edit; click away to render."
      headerExtra={
        <button className={`block-icon-btn${editing ? " is-active" : ""}`} title={editing ? "Done" : "Edit"} onClick={() => setEditing(!editing)}>
          ✎
        </button>
      }
    >
      {editing ? (
        <textarea
          autoFocus
          className="nodrag block-input block-textarea note-editor"
          value={data.text}
          onChange={(event) => updateBlock(data.id, { text: event.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => event.key === "Escape" && setEditing(false)}
        />
      ) : (
        <div className="note-body" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {renderNote(data.text)}
        </div>
      )}
    </BlockShell>
  );
}
