/** Today's page: a notebook of its own for each day (named 2026-11-14, as
 * Obsidian's daily notes are) — what's jotted down on Home lands in its Inbox. */

const pad = (n: number) => String(n).padStart(2, "0");
/** today's page's name: 2026-11-14 */
export const todayName = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** today, in words: Saturday, November 14 */
export const todayTitle = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
/** whether a notebook's name is a day's page */
export const isDayName = (name: string) => /^\d{4}-\d{2}-\d{2}$/.test(name);
/** a new day's page */
export const dailyText = (d = new Date()) => `---\ntitle: ${todayTitle(d)}\ndate: ${todayName(d)}\n---\n\n## Inbox\n`;

/** a line put at the end of a page's Inbox section (under its "## Inbox" heading — a list kept one list), or at the
 * page's end when it has no Inbox */
export function addToInbox(text: string, line: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  const head = lines.findIndex((l) => /^#{1,6}\s+inbox\s*$/i.test(l.trim()));
  if (head < 0) return `${lines.join("\n")}\n\n${line}\n`;
  // the section's end: the next heading (or the page's end), back over the blank lines before it
  let end = head + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
  let put = end;
  while (put > head + 1 && !lines[put - 1].trim()) put--;
  const before = lines.slice(0, put);
  const after = lines.slice(put);
  const prev = before[before.length - 1] ?? "";
  // (right under the heading, or after a paragraph: a blank line first; after a list's item: none — the same list)
  const glue = put === head + 1 || !/^\s*[-*+] /.test(prev) ? [""] : [];
  const out = [...before, ...glue, line];
  if (after.length) out.push(...(after[0].trim() ? ["", ...after] : after));
  return `${out.join("\n")}\n`;
}
