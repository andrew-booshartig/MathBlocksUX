/** About MatrixLab: its version, and the open-source software it's built
 * with — each one's license, and the license's text (THIRD_PARTY_NOTICES.txt,
 * made for each release). */
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import Icon from "../Icon";

export default function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  const [notices, setNotices] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    invoke<string>("notices_read").then(setNotices).catch((err) => setFailed(String(err)));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  // the list at the top of the file, and each library's text below it
  const { list, texts } = useMemo(() => {
    if (!notices) return { list: [] as string[], texts: new Map<string, string>() };
    const [head, ...bodies] = notices.split(/\n={72}\n/);
    const list = head.split("\n").filter((l) => /^(web|python|rust)\s/.test(l));
    const texts = new Map<string, string>();
    for (let k = 0; k + 1 < bodies.length; k += 2) texts.set(bodies[k].split(" (")[0].trim(), bodies[k + 1]);
    return { list, texts };
  }, [notices]);
  const shown = list.filter((l) => l.toLowerCase().includes(find.toLowerCase()));
  return (
    <div className="ext-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ext" role="dialog" aria-label="About MatrixLab">
        <div className="ext-head">
          <span className="ext-title">MatrixLab</span>
          <span className="ext-sub">{version && `version ${version} · `}built with the open-source software below, each under its own license</span>
          <button className="ext-close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="ext-body">
          {failed && <div className="ext-empty">{failed}</div>}
          {notices && (
            <>
              <input className="about-find" value={find} placeholder={`Find among ${list.length} — sympy, MIT, react…`} onChange={(e) => setFind(e.target.value)} />
              {shown.map((line) => {
                const [part, rest] = [line.slice(0, 6).trim(), line.slice(7)];
                const [nameVersion, license] = rest.split(" — ");
                const key = nameVersion.trim();
                return (
                  <div key={line} className="about-row">
                    <button className="about-line" onClick={() => setOpen(open === key ? null : key)} disabled={!texts.has(key)} title={texts.has(key) ? "Its license" : "Its license is named; it came with no file of its own"}>
                      <span className="about-part">{part}</span>
                      <span className="about-name">{nameVersion}</span>
                      <span className="ext-dim">{license}</span>
                    </button>
                    {open === key && <pre className="about-text">{texts.get(key)}</pre>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
