/** Writing in a text block, as a note-taking app does it: ⌘B and friends
 * wrap what's selected, Enter carries a list on (and an empty item ends
 * it), Tab and ⇧Tab move a list item in and out. Each takes the text and
 * its selection and gives back the new ones — or null, when the key is
 * none of these. */

export interface Edit {
  value: string;
  start: number;
  end: number;
}

/** what's selected wrapped in a mark (or the mark taken off again, when it's there) */
function wrap(value: string, start: number, end: number, open: string, close = open): Edit {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  if (before.endsWith(open) && after.startsWith(close))
    return { value: before.slice(0, -open.length) + sel + after.slice(close.length), start: start - open.length, end: end - open.length };
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length)
    return { value: before + sel.slice(open.length, sel.length - close.length) + after, start, end: end - open.length - close.length };
  return { value: before + open + sel + close + after, start: start + open.length, end: end + open.length };
}

const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/** the line the caret is on: where it starts and ends */
function lineAt(value: string, at: number) {
  const from = value.lastIndexOf("\n", at - 1) + 1;
  const next = value.indexOf("\n", at);
  return { from, to: next < 0 ? value.length : next };
}

export function writingKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, value: string, start: number, end: number): Edit | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "b" && !e.shiftKey) return wrap(value, start, end, "**");
    if (k === "i" && !e.shiftKey) return wrap(value, start, end, "*");
    if (k === "e" && !e.shiftKey) return wrap(value, start, end, "`");
    if (k === "x" && e.shiftKey) return wrap(value, start, end, "~~");
    if (k === "h" && e.shiftKey) return wrap(value, start, end, "==");
    if (k === "u" && !e.shiftKey) return wrap(value, start, end, "<u>", "</u>");
    if (k === "k" && !e.shiftKey) {
      // [what's selected](|) — the caret where the address goes
      const sel = value.slice(start, end) || "link";
      const text = `[${sel}]()`;
      const at = start + text.length - 1;
      return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at };
    }
    return null;
  }
  if (e.altKey || mod) return null;
  const { from, to } = lineAt(value, start);
  const line = value.slice(from, to);
  const list = line.match(LIST);
  if (e.key === "Enter" && !e.shiftKey && list && start === end) {
    const [marker, indent, bullet, space, task] = list;
    // an empty item: the list ends here
    if (line.trim() === marker.trim()) return { value: value.slice(0, from) + value.slice(to), start: from, end: from };
    const num = bullet.match(/^(\d+)([.)])$/);
    const nextBullet = num ? `${Number(num[1]) + 1}${num[2]}` : bullet;
    const carry = `\n${indent}${nextBullet}${space}${task ? "[ ] " : ""}`;
    return { value: value.slice(0, start) + carry + value.slice(end), start: start + carry.length, end: start + carry.length };
  }
  if (e.key === "Tab" && list) {
    if (e.shiftKey) {
      const cut = line.match(/^( {1,2}|\t)/)?.[0].length ?? 0;
      if (!cut) return { value, start, end };
      return { value: value.slice(0, from) + line.slice(cut) + value.slice(to), start: Math.max(from, start - cut), end: Math.max(from, end - cut) };
    }
    return { value: value.slice(0, from) + "  " + value.slice(from), start: start + 2, end: end + 2 };
  }
  return null;
}

/** the nth task box in a text block's Markdown, ticked or not */
export function toggleTask(text: string, n: number): string {
  let k = -1;
  return text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm, (all, lead: string, mark: string) => {
    k++;
    return k === n ? `${lead}[${mark === " " ? "x" : " "}]` : all;
  });
}
