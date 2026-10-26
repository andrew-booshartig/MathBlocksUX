/** The unit map — the Units tab's main view, and a reference sheet: each kind
 * of unit as chains of 1 : N links (km ×1000 m ×100 cm), bridges between
 * systems (1 in = 2.54 cm), your own links (1 bag = 50 lb). An amount typed
 * above (9 km/h → m/s) lights up its path, and the walk is the conversion:
 * each link × or ÷ its N — ÷ for a unit on the bottom (per hour). Tap a
 * unit to convert into it. */
import { useMemo, useState } from "react";
import { type MyUnit, type UnitsWork, newId } from "../store";
import { useLiveMath } from "../mathSidecar";
import MathInput from "../MathInput";
import { Tex } from "../ui";

interface Chain {
  units: string[];
  links: string[];
}
interface Link {
  a: string;
  b: string;
  n: string;
}
interface Kind {
  kind: string;
  chains: Chain[];
  bridges: Link[];
  mine: Link[];
  names: Record<string, string>;
}
interface Step {
  a: string;
  b: string;
  op: string;
  n: string;
}
interface Path {
  from_latex: string;
  result_latex: string;
  exact: boolean;
  decimal: string | null;
  arithmetic: string;
  parts: { kind: string; path: string[]; on_bottom: boolean; steps: Step[] }[];
  path_units: string[];
  path_links: [string, string][];
}

export default function UnitMap({ work, update }: { work: UnitsWork; update: (patch: UnitsWork) => void }) {
  const mine = work.mine ?? [];
  const units = useMemo(() => mine.map(({ symbol, name, equals }) => ({ symbol, name, equals })), [mine]);
  const { result: map } = useLiveMath<{ kinds: Kind[] }>({ op: "unitmap", units }, 0);
  const ready = (work.from ?? "").trim() && (work.to ?? "").trim();
  const { result: path, error } = useLiveMath<Path>(ready ? { op: "unitpath", from: work.from, to: work.to, units } : null, 250);
  const [adding, setAdding] = useState<{ symbol: string; n: string; unit: string } | null>(null);

  const lit = new Set(path?.path_units ?? []);
  const litLink = (a: string, b: string) => !!path?.path_links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  // the kinds this conversion walks first
  const kinds = [...(map?.kinds ?? [])].sort((p, q) => Number(q.chains.some((c) => c.units.some((u) => lit.has(u)))) - Number(p.chains.some((c) => c.units.some((u) => lit.has(u)))));
  const allUnits = (map?.kinds ?? []).flatMap((k) => Object.keys(k.names));

  const unit = (sym: string, names: Record<string, string>) => (
    <button key={sym} className={`umap-unit${lit.has(sym) ? " is-on" : ""}`} title={`${names[sym] ?? sym} — tap to convert into ${sym}`} onClick={() => update({ to: sym })}>
      {sym}
    </button>
  );
  const link = (a: string, b: string, n: string) => (
    <span key={`${a}-${b}`} className={`umap-link${litLink(a, b) ? " is-on" : ""}`} title={`1 ${a} = ${n} ${b}`}>
      ×{n}
    </span>
  );
  const addMine = () => {
    if (!adding) return;
    const symbol = adding.symbol.trim();
    const n = adding.n.trim();
    if (!/^[A-Za-z]+$/.test(symbol) || !n || !adding.unit) return;
    update({ mine: [...mine.filter((u) => u.symbol !== symbol), { id: newId("unit"), symbol, equals: `${n}\\,${adding.unit}` } as MyUnit] });
    setAdding(null);
  };

  return (
    <div className="umap">
      <div className="units-problem">
        <MathInput className="units-from" value={work.from ?? ""} placeholder="3 3/8 in" onChange={(from) => update({ from })} />
        <span className="units-arrow">→</span>
        <MathInput className="units-to" value={work.to ?? ""} placeholder="mm" onChange={(to) => update({ to })} />
      </div>
      <div className="units-tip">A space between a number and its unit: 3 3/8 in, 9 km/h. Tap a unit on the map to convert into it.</div>
      {error && <div className="units-error">{error}</div>}

      {path && !error && (
        <div className="umap-result">
          <div className="umap-answer">
            <Tex math={`${path.from_latex} = ${path.result_latex}`} />
            {path.exact ? <span className="umap-exact">exact</span> : path.decimal && <span className="umap-about">≈ {path.decimal}</span>}
          </div>
          {path.parts.map((p, i) => (
            <div key={i} className="umap-part">
              <span className="umap-part-kind">{p.kind}</span>
              <span className="umap-part-path">{p.path.join(" → ")}</span>
              <span className="umap-part-ops">{p.steps.map((s) => `${s.op} ${s.n}`).join("  ")}</span>
              {p.on_bottom && <span className="umap-part-why">{p.path[0]} is on the bottom (per {p.path[0]}), so each step divides</span>}
            </div>
          ))}
          <div className="umap-arith">
            <Tex math={path.arithmetic} />
          </div>
        </div>
      )}

      {kinds.map((k) => (
        <section key={k.kind} className="umap-kind">
          <div className="units-label">{k.kind}</div>
          {k.chains.map((c, i) => (
            <div key={i} className="umap-chain">
              {c.units.flatMap((u, j) => (j === 0 ? [unit(u, k.names)] : [link(c.units[j - 1], u, c.links[j - 1]), unit(u, k.names)]))}
            </div>
          ))}
          {[...k.bridges.map((b) => ({ ...b, mine: false })), ...k.mine.map((b) => ({ ...b, mine: true }))].map((b) => (
            <div key={`${b.a}-${b.b}`} className={`umap-bridge${b.mine ? " is-mine" : ""}${litLink(b.a, b.b) ? " is-on" : ""}`}>
              {unit(b.a, k.names)}
              {link(b.a, b.b, b.n)}
              {unit(b.b, k.names)}
              <span className="umap-bridge-fact">
                1 {b.a} = {b.n} {b.b}
                {b.mine && " — yours"}
              </span>
              {b.mine && (
                <button className="units-mine-remove" title={`Remove ${b.a}`} onClick={() => update({ mine: mine.filter((m) => m.symbol !== b.a) })}>
                  ×
                </button>
              )}
            </div>
          ))}
        </section>
      ))}

      <section className="umap-kind">
        <div className="units-label">Your own links</div>
        {adding ? (
          <div className="units-add">
            <span>1</span>
            <input autoFocus className="units-add-symbol" placeholder="k" value={adding.symbol} onChange={(e) => setAdding({ ...adding, symbol: e.target.value })} />
            <span>=</span>
            <input className="units-add-n" placeholder="1000" value={adding.n} onChange={(e) => setAdding({ ...adding, n: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addMine()} />
            <select className="units-add-unit" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value })}>
              <option value="">unit…</option>
              {allUnits.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button className="action-btn is-primary" onClick={addMine}>
              Add
            </button>
          </div>
        ) : (
          <button className="units-more" onClick={() => setAdding({ symbol: "", n: "", unit: "" })}>
            + a link of your own — 1 (your unit) = how many of a unit on the map
          </button>
        )}
      </section>
    </div>
  );
}
