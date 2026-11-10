/** Every notebook's text, read once (and again when it's changed) — for the
 * list's search and #tags, and for which notebooks link to this one. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type Listing = { name: string; modified: number }[];

export const texts = new Map<string, { modified: number; text: string }>();

/** the notebooks' texts, each read when it's new or changed since */
export async function readAll(listing: Listing): Promise<void> {
  for (const l of listing) {
    if (texts.get(l.name)?.modified === l.modified) continue;
    const file = await invoke<{ text: string; modified: number }>("read_notebook", { name: l.name }).catch(() => null);
    if (file) texts.set(l.name, { modified: l.modified, text: file.text });
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** the notebooks that link to this one ([[its name]]), as Obsidian's backlinks */
export function useBacklinks(name: string | null | undefined, listing: Listing): string[] {
  const [links, setLinks] = useState<string[]>([]);
  useEffect(() => {
    if (!name) return setLinks([]);
    let live = true;
    readAll(listing).then(() => {
      if (!live) return;
      const to = new RegExp(`\\[\\[\\s*${escapeRe(name)}\\s*(\\||\\]\\])`, "i");
      setLinks(listing.filter((l) => l.name !== name && to.test(texts.get(l.name)?.text ?? "")).map((l) => l.name));
    });
    return () => {
      live = false;
    };
  }, [name, listing]);
  return links;
}
