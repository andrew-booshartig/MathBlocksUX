/** Every key, in one place (⌘/): the writing's, a block's, the apps' —
 * searched as it's typed. */
import { useEffect, useMemo, useRef, useState } from "react";

const SHEET: { group: string; keys: [string, string][] }[] = [
  {
    group: "Writing",
    keys: [
      ["⌘B  ⌘I  ⌘U", "Bold, italic, underline"],
      ["⌘⇧X  ⌘⇧H", "Strikethrough, highlight"],
      ["⌘E  ⌘K", "Code, a link ([[a note]] links another notebook)"],
      ["⌘⇧8  ⌘⇧7  ⌘⇧9", "Bulleted list, numbered list, checklist"],
      ["Tab  ⇧Tab", "A list item in under the one above, back out"],
      ["/", "The menu of things to put in: apps, headings, callouts, a picture…"],
      ["Enter on an empty item", "Out of a list, a quote, a callout"],
      ["↑  ↓ off the top or bottom line", "Onto the block above or below"],
      ["->  <=  !=  +-  ...  --", "→  ≤  ≠  ±  …  —  (⌘Z right after gives back what was typed)"],
      ["Words picked", "A little bar over them: bold, colors, a link, math"],
    ],
  },
  {
    group: "A block picked",
    keys: [
      ["↑  ↓  (j  k)", "The next one, the one before — into the writing too"],
      ["Enter  ·  Esc", "Work in it  ·  let it go"],
      ["Tab  ⇧Tab", "Step it in, back out"],
      ["/", "Something new right under it"],
      ["a  b", "Writing above it, below it"],
      ["⇧J  ⇧K", "Move it down, up"],
      ["dd  or  ⌫", "Delete it"],
      ["⇧⏎", "Run it (code), on to the next"],
    ],
  },
  {
    group: "The notebook",
    keys: [
      ["⌘F", "Find (and replace)"],
      ["⌘P", "Go to a note"],
      ["⌘⇧D", "Today's page (Home's jotted notes land in its Inbox)"],
      ["⌘⇧F", "Focus — just the page"],
      ["⌘Z  ⌘⇧Z", "Undo, redo"],
      ["⌘/", "These keys"],
    ],
  },
  {
    group: "Code cells",
    keys: [
      ["⌘⏎", "Run it"],
      ["⇧⏎  ⌥⏎", "Run it and go on, run it and add a cell"],
      ["Esc", "Done"],
    ],
  },
  {
    group: "Circuit",
    keys: [
      ["1 – 9  ·  /", "A part (the common ones)  ·  find any part"],
      ["W  ·  T", "A wire (or drag from any terminal)  ·  text"],
      ["R  ⇧R  ·  F", "Turn it, back  ·  flip it"],
      ["⌘D  ·  ⌥-drag", "A copy"],
      ["Arrows", "Nudge (⇧: five squares)"],
      ["Space-drag  ·  ⌘0", "Move the view  ·  fit it"],
      ["Esc", "Done"],
    ],
  },
  {
    group: "Drawing",
    keys: [
      ["1 – 0", "Pick, box, diamond, circle, arrow, line, pen, text, highlighter, eraser"],
      ["Q", "Keep the tool after drawing"],
      ["Enter", "Write in what's picked"],
      ["Tab  ⇧Tab", "The next box, joined by an arrow (right, below)"],
      ["⇧ while drawing", "Square, round, 15° steps"],
      ["⌘G  ⇧⌘G", "Group, ungroup"],
      ["⌥⌘]  ⌥⌘[", "To the front, to the back"],
      ["⌘D  ·  ⌥-drag", "A copy"],
    ],
  },
];

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHEET;
    return SHEET.map((g) => ({ ...g, keys: g.keys.filter(([k, what]) => `${k} ${what} ${g.group}`.toLowerCase().includes(q)) })).filter((g) => g.keys.length);
  }, [query]);
  return (
    <div className="nb-keys-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nb-keys" onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && onClose())}>
        <div className="nb-keys-head">
          <input ref={field} className="nb-keys-find" placeholder="Find a key" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="nb-keys-body">
          {shown.map((g) => (
            <section key={g.group} className="nb-keys-group">
              <h4>{g.group}</h4>
              {g.keys.map(([k, what]) => (
                <div key={k + what} className="nb-keys-row">
                  <span className="nb-keys-what">{what}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </section>
          ))}
          {!shown.length && <div className="nb-keys-none">No key for “{query}”</div>}
        </div>
      </div>
    </div>
  );
}
