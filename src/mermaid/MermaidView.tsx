/** A typed diagram drawn: redrawn a moment after the typing stops, the last
 * good drawing kept up while what's typed doesn't make sense yet (and what's
 * wrong said quietly under it). */
import { useEffect, useRef, useState } from "react";
import { mermaidSvg } from "./render";
import "./mermaid.css";

export default function MermaidView({ code, live = false, zoom = 1 }: { code: string; live?: boolean; zoom?: number }) {
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
  }, [code, live]);
  if (!code.trim()) return <div className="mm-empty">An empty diagram</div>;
  return (
    <div className={`mm-view${error ? " has-error" : ""}`}>
      {svg ? <div className="mm-svg" style={zoom !== 1 ? { zoom } : undefined} dangerouslySetInnerHTML={{ __html: svg }} /> : waiting ? <div className="mm-wait">…</div> : null}
      {error && <div className="mm-error">{error}</div>}
    </div>
  );
}
