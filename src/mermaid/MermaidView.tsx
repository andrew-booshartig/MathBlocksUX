/** A typed diagram drawn: redrawn a moment after the typing stops, the last
 * good drawing kept up while what's typed doesn't make sense yet (and what's
 * wrong said quietly under it). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { mermaidSvg } from "./render";
import "./mermaid.css";

/** the theme, changing (the page's colors set on the document): diagrams drawn again in its colors */
let themeVersion = 0;
const themeListeners = new Set<() => void>();
let watching: MutationObserver | null = null;
function subscribeTheme(f: () => void) {
  themeListeners.add(f);
  if (!watching && typeof MutationObserver !== "undefined") {
    let timer = 0;
    watching = new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        themeVersion++;
        themeListeners.forEach((g) => g());
      }, 120);
    });
    watching.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  }
  return () => void themeListeners.delete(f);
}

export default function MermaidView({ code, live = false, zoom = 1 }: { code: string; live?: boolean; zoom?: number }) {
  const theme = useSyncExternalStore(subscribeTheme, () => themeVersion);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  const latest = useRef(code);
  latest.current = code;
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(
      () => {
        mermaidSvg(code).then((r) => {
          if (gone || latest.current !== code) return;
          setWaiting(false);
          if ("svg" in r) {
            setSvg(r.svg);
            setError("");
          } else setError(r.error);
        });
      },
      live ? 280 : 0,
    );
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [code, live, theme]);
  if (!code.trim()) return <div className="mm-empty">An empty diagram</div>;
  return (
    <div className={`mm-view${error ? " has-error" : ""}`}>
      {svg ? <div className="mm-svg" style={zoom !== 1 ? { zoom } : undefined} dangerouslySetInnerHTML={{ __html: svg }} /> : waiting ? <div className="mm-wait">…</div> : null}
      {error && <div className="mm-error">{error}</div>}
    </div>
  );
}
