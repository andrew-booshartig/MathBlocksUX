/** The units library: every unit the calculator knows, by kind — its
 * symbol, its name and its size in an everyday unit of its kind (1 ft =
 * 0.3048 m, 1 cup ≈ 236.588 mL) — searchable. A
 * unit is typed after a number with a space (5 m, 10 s, 3 km/h).
 * The library comes from the engine (sidecar/mathcore/units.py), so the
 * units your own files add later show up here too. */
import { useEffect, useRef, useState } from "react";
import { mathRequest } from "../mathSidecar";

interface LibraryUnit {
  symbol: string;
  name: string;
  plural: string;
  /** its size in the kind's everyday unit ("0.3048", "≈ 236.588") — none for that unit itself */
  in_reference: string | null;
}
interface Kind {
  kind: string;
  reference: string | null;
  units: LibraryUnit[];
}

export default function UnitsPanel({ onClose }: { onClose: () => void }) {
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mathRequest<{ kinds: Kind[] }>({ op: "units" }).then(
      (r) => setKinds(r.kinds),
      (e) => setProblem(String(e)),
    );
  }, []);
  useEffect(() => {
    const down = (e: PointerEvent) => !panel.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".calc-app-units") && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const shown = (kinds ?? [])
    .map((k) => ({ ...k, units: k.units.filter((u) => !q || [u.symbol, u.name, u.plural, k.kind].some((t) => t.toLowerCase().includes(q))) }))
    .filter((k) => k.units.length);

  return (
    <div className="units-panel" ref={panel}>
      <div className="units-head">
        <input className="units-search" autoFocus placeholder="Find a unit — meter, ft, hour…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="units-hint">
          After a number, with a space: <b>5 m</b>, <b>10 s</b>, <b>3 km/h</b>. Without the space, 5m is 5 times m.
        </div>
      </div>
      <div className="units-list">
        {problem && <div className="units-empty">{problem}</div>}
        {!kinds && !problem && <div className="units-empty">Loading…</div>}
        {kinds && !shown.length && <div className="units-empty">No unit matches “{query}”</div>}
        {shown.map((k) => (
          <section key={k.kind}>
            <div className="units-kind">{k.kind}</div>
            {k.units.map((u) => (
              <div key={u.symbol} className="units-row" title={`1 ${u.name}`}>
                <span className="units-symbol">{u.symbol}</span>
                <span className="units-name">{u.name}</span>
                <span className="units-size">
                  {u.in_reference ? (
                    <>
                      {u.in_reference.startsWith("≈") ? u.in_reference : `= ${u.in_reference}`} <span className="units-ref">{k.reference}</span>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
