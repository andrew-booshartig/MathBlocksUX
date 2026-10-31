/** The printed page, as it will look — over the app, white like paper. */
import { useEffect } from "react";

export default function Preview({ html, onClose, onPrint }: { html: string; onClose: () => void; onPrint: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="nb-preview-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nb-preview">
        <div className="nb-preview-head">
          <span>Preview — the page as it prints</span>
          <span className="nb-preview-buttons">
            <button className="nb-tool is-primary" onClick={onPrint}>
              Print / PDF
            </button>
            <button className="nb-tool" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        {/* the page with its "how to print" hint hidden: it's the paper */}
        <iframe className="nb-preview-page" title="Preview" srcDoc={html.replace('<div class="hint">', '<div class="hint" style="display:none">')} />
      </div>
    </div>
  );
}
