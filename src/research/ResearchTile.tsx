/** Research: look something up without leaving the notebook. Wikipedia's
 * articles searched as you type, one read here — its summary, its sections,
 * its picture — and what's worth keeping put into the notebook where you
 * were writing: the summary, or any words picked out of the article, as a
 * quote with where it came from. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "../Icon";
import "./research.css";

export interface ResearchState {
  /** the article open (its key), and the ones looked up lately */
  page?: string;
  recent?: { key: string; title: string }[];
}

interface Hit {
  key: string;
  title: string;
  description?: string;
  thumb?: string;
}
interface Article {
  key: string;
  title: string;
  description?: string;
  thumb?: string;
  url: string;
  lead: string;
  sections: { title: string; level: number; text: string }[];
}

const WIKI = "https://en.wikipedia.org";
/** sections that are lists of other things, not the article */
const SKIP = /^(see also|references|external links|notes|further reading|bibliography|sources|citations|footnotes)$/i;

async function search(q: string, signal: AbortSignal): Promise<Hit[]> {
  const r = await fetch(`${WIKI}/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=8`, { signal });
  if (!r.ok) throw new Error(`Wikipedia said ${r.status}`);
  const data = (await r.json()) as { pages: { key: string; title: string; description?: string; thumbnail?: { url: string } | null }[] };
  return data.pages.map((p) => ({ key: p.key, title: p.title, description: p.description ?? undefined, thumb: p.thumbnail?.url ? (p.thumbnail.url.startsWith("//") ? `https:${p.thumbnail.url}` : p.thumbnail.url) : undefined }));
}

async function article(key: string, signal: AbortSignal): Promise<Article> {
  const [sum, full] = await Promise.all([
    fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(key)}`, { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${WIKI}/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=${encodeURIComponent(key.replace(/_/g, " "))}&format=json&formatversion=2&origin=*`, { signal }).then((r) => (r.ok ? r.json() : null)),
  ]);
  const text: string = full?.query?.pages?.[0]?.extract ?? sum?.extract ?? "";
  const parts = text.split(/\n(?=={2,}\s)/);
  const lead = parts[0].trim();
  const sections = parts.slice(1).map((p) => {
    const m = p.match(/^(={2,})\s*(.*?)\s*={2,}\s*\n?([\s\S]*)$/);
    return { title: m?.[2] ?? "", level: (m?.[1].length ?? 2) - 1, text: (m?.[3] ?? p).trim() };
  });
  return {
    key,
    title: sum?.title ?? key.replace(/_/g, " "),
    description: sum?.description,
    thumb: sum?.thumbnail?.source,
    url: sum?.content_urls?.desktop?.page ?? `${WIKI}/wiki/${encodeURIComponent(key)}`,
    lead,
    sections: sections.filter((s) => s.title && !SKIP.test(s.title) && s.text),
  };
}

/** a paragraph, or a line that's a formula (V=IR, on its own): set apart */
function Paragraphs({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const formula = t.length < 70 && /[=≈≤≥<>]/.test(t) && !/[.!?]$/.test(t) && t.split(/\s+/).length < 10;
    out.push(
      <p key={i} className={formula ? "rs-formula" : undefined}>
        {t}
      </p>,
    );
  });
  return <>{out}</>;
}

export default function ResearchTile({ state, update, onInsert }: { state: ResearchState; update: (patch: Partial<ResearchState>) => void; onInsert: (markdown: string) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);
  const [page, setPage] = useState<Article | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // searched as it's typed
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const stop = new AbortController();
    const timer = setTimeout(() => {
      search(q, stop.signal)
        .then((h) => (setHits(h), setActive(0), setProblem(null)))
        .catch((err) => !stop.signal.aborted && setProblem(String(err).includes("fetch") ? "Can't reach Wikipedia — is this computer online?" : String(err)));
    }, 220);
    return () => (clearTimeout(timer), stop.abort());
  }, [query]);

  // the article kept open (from last time)
  const want = state.page;
  useEffect(() => {
    if (!want) return setPage(null);
    if (page?.key === want) return;
    const stop = new AbortController();
    setLoading(true);
    article(want, stop.signal)
      .then((a) => (setPage(a), setOpen(new Set()), setProblem(null), body.current?.scrollTo({ top: 0 })))
      .catch((err) => !stop.signal.aborted && setProblem(String(err).includes("fetch") ? "Can't reach Wikipedia — is this computer online?" : String(err)))
      .finally(() => setLoading(false));
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  const go = (h: { key: string; title: string }) => {
    update({ page: h.key, recent: [h, ...(state.recent ?? []).filter((r) => r.key !== h.key)].slice(0, 12) });
    setQuery("");
    setHits(null);
  };
  const told = (text: string) => {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 2200);
  };
  const cite = (a: Article) => `[${a.title} — Wikipedia](${a.url})`;
  const putSummary = async () => {
    if (!page) return;
    const lead = page.lead.split("\n").filter((l) => l.trim()).slice(0, 2).join("\n>\n> ");
    const ok = await onInsert(`> [!info] ${page.title}\n> ${lead}\n>\n> ${cite(page)}`);
    told(ok ? "In the notebook, where you were writing" : "Couldn't put it in the notebook");
  };
  const putQuote = async () => {
    if (!page || !quote) return;
    const text = quote.text.replace(/\s+/g, " ").trim();
    setQuote(null);
    window.getSelection()?.removeAllRanges();
    const ok = await onInsert(`> [!quote] ${page.title}\n> “${text}”\n>\n> ${cite(page)}`);
    told(ok ? "Quoted in the notebook" : "Couldn't put it in the notebook");
  };
  // words picked out of the article: a button to quote them
  const picked = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !sel?.rangeCount || !body.current?.contains(sel.anchorNode)) return setQuote(null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const box = body.current.getBoundingClientRect();
    setQuote({ text, x: Math.min(box.width - 140, Math.max(8, r.left - box.left + r.width / 2 - 60)), y: r.top - box.top + body.current.scrollTop - 38 });
  };

  const list = hits ?? [];
  const recent = state.recent ?? [];
  const sections = useMemo(() => page?.sections ?? [], [page]);
  return (
    <div className="rs-tile">
      <div className="rs-head">
        {page && (
          <button className="rs-icon" title="Back to searching" onClick={() => (update({ page: undefined }), setTimeout(() => field.current?.focus(), 0))}>
            <Icon name="chevron" size={14} />
          </button>
        )}
        <div className="rs-search">
          <Icon name="zoom" size={14} />
          <input
            ref={field}
            value={query}
            placeholder="Look something up"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(list.length - 1, a + 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === "Enter" && list[active]) go(list[active]);
              if (e.key === "Escape") setQuery("");
            }}
          />
          <span className="rs-source">Wikipedia</span>
        </div>
      </div>
      {problem && <div className="rs-problem">{problem}</div>}
      {query.trim() && hits && (
        <div className="rs-hits">
          {list.map((h, i) => (
            <button key={h.key} className={`rs-hit${i === active ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
              {h.thumb ? <img src={h.thumb} alt="" /> : <span className="rs-nothumb" />}
              <span>
                <b>{h.title}</b>
                {h.description && <small>{h.description}</small>}
              </span>
            </button>
          ))}
          {!list.length && <div className="rs-none">Nothing on Wikipedia called “{query.trim()}”</div>}
        </div>
      )}
      {!query.trim() && !page && !loading && (
        <div className="rs-start">
          {recent.length > 0 && (
            <>
              <div className="rs-label">Looked up lately</div>
              <div className="rs-chips">
                {recent.map((r) => (
                  <button key={r.key} onClick={() => go(r)}>
                    {r.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {!query.trim() && loading && <div className="rs-loading">…</div>}
      {!query.trim() && page && !loading && (
        <div className="rs-body" ref={body} onMouseUp={() => setTimeout(picked, 0)} onScroll={() => quote && setQuote(null)}>
          <div className="rs-top">
            <div>
              <h2>{page.title}</h2>
              {page.description && <div className="rs-desc">{page.description}</div>}
              <div className="rs-actions">
                <button onClick={putSummary} title="Its summary into the notebook, where you were writing — as a callout, with where it came from">
                  <Icon name="notebook" size={13} /> Summary into the notebook
                </button>
                <button onClick={() => void openUrl(page.url).catch(() => window.open(page.url, "_blank"))} title="The whole article in the browser">
                  <Icon name="link" size={13} /> Wikipedia
                </button>
              </div>
            </div>
            {page.thumb && <img className="rs-thumb" src={page.thumb} alt="" />}
          </div>
          <div className="rs-text">
            <Paragraphs text={page.lead} />
          </div>
          {sections.map((s, i) => (
            <div key={i} className={`rs-section is-level-${Math.min(3, s.level)}`}>
              <button className={`rs-section-head${open.has(i) ? " is-open" : ""}`} onClick={() => setOpen((o) => (o.has(i) ? new Set([...o].filter((x) => x !== i)) : new Set([...o, i])))}>
                <Icon name="chevron" size={12} /> {s.title}
              </button>
              {open.has(i) && (
                <div className="rs-text">
                  <Paragraphs text={s.text} />
                </div>
              )}
            </div>
          ))}
          <div className="rs-credit">
            Text from{" "}
            <a href={page.url} onClick={(e) => (e.preventDefault(), void openUrl(page.url).catch(() => window.open(page.url, "_blank")))}>
              Wikipedia
            </a>
            , CC BY-SA 4.0
          </div>
          {quote && (
            <button className="rs-quote" style={{ left: quote.x, top: quote.y }} onMouseDown={(e) => e.preventDefault()} onClick={putQuote}>
              <Icon name="notebook" size={12} /> Quote it in the notebook
            </button>
          )}
        </div>
      )}
      {note && <div className="rs-note">{note}</div>}
    </div>
  );
}
