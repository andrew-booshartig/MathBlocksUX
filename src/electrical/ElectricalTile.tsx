/** The Electrical tile: the numbers an electrician works out every day —
 * Ohm's law, voltage drop, wire size, conduit and box fill — and the
 * planning ones: a house's load and its service, a panel's circuits on
 * its legs. Each answer says where in the NEC it's from, and goes to the
 * notebook (or the clipboard) with a click. */
import type { ReactNode } from "react";
import Icon from "../Icon";
import { ambientFactor, ampacityOf, balance, boxFill, bundleFactor, type Circuit, conduitFill, dwellingLoad, type FillRow, loadAmps, ohm, sizeForDrop, voltageDrop, wireFor } from "./calc";
import { BOXES, CONDUCTOR_AREA, EDITION, type Metal, RACEWAYS, type Raceway, SIZES, type Size, type TempRating, sizeLabel } from "./nec";
import "./electrical.css";

export type ElectricalTool = "ohm" | "drop" | "wire" | "conduit" | "box" | "load" | "panel";
export interface ElectricalState {
  tool?: ElectricalTool;
  ohm?: { v?: string; i?: string; r?: string; p?: string };
  drop?: { size?: Size; metal?: Metal; feet?: string; amps?: string; volts?: string; phases?: 1 | 3 };
  wire?: { amps?: string; metal?: Metal; temp?: TempRating; ambient?: string; conductors?: string };
  conduit?: { type?: Raceway; rows?: FillRow[] };
  box?: { conductors?: Record<string, string>; devices?: string; clamps?: boolean; grounds?: boolean; fittings?: string; box?: string };
  load?: { area?: string; small?: string; laundry?: string; appliances?: string; range?: string; dryer?: string; hvac?: string };
  panel?: { circuits?: Circuit[] };
}

const TOOLS: [ElectricalTool, string, string][] = [
  ["ohm", "Ohm", "Ohm's law and power: any two of volts, amps, ohms, watts"],
  ["drop", "Drop", "Voltage drop on a run"],
  ["wire", "Wire", "Wire size for a load, and what a wire is good for"],
  ["conduit", "Conduit", "Conduit fill"],
  ["box", "Box", "Box fill"],
  ["load", "Load", "A house's load and its service size"],
  ["panel", "Panel", "A panel's circuits, balanced on its legs"],
];

const num = (s?: string) => {
  const n = Number(s);
  return s !== undefined && s.trim() !== "" && Number.isFinite(n) ? n : undefined;
};
const r = (x: number, d = 2) => Number(x.toFixed(d)).toLocaleString();

function Field({ label, value, onChange, unit, wide }: { label: string; value?: string; onChange: (v: string) => void; unit?: string; wide?: boolean }) {
  return (
    <label className={`el-field${wide ? " is-wide" : ""}`}>
      <span className="el-label">{label}</span>
      <span className="el-input">
        <input inputMode="decimal" value={value ?? ""} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="el-unit">{unit}</span>}
      </span>
    </label>
  );
}

function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="el-field">
      <span className="el-label">{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}>
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const SIZE_OPTIONS = SIZES.map((s) => [s, sizeLabel(s)] as [Size, string]);

export default function ElectricalTile({ state, update, onNotebook, onCopy }: { state: ElectricalState; update: (patch: Partial<ElectricalState>) => void; onNotebook: (markdown: string) => void; onCopy: (text: string) => void }) {
  const tool = state.tool ?? "ohm";
  /** an answer: what it is, where it's from, and where it can go */
  const answer = (main: ReactNode, cite: string, text: string) => (
    <div className="el-answer">
      <div className="el-answer-main">{main}</div>
      <div className="el-answer-foot">
        <span className="el-cite">
          {EDITION} {cite}
        </span>
        <button className="el-send" title="Copy it" onClick={() => onCopy(text)}>
          <Icon name="copy" size={13} />
        </button>
        <button className="el-send" title="Put it in the notebook" onClick={() => onNotebook(`> [!note] ${text.split("\n")[0]}\n${text.split("\n").slice(1).map((l) => `> ${l}`).join("\n")}${text.includes("\n") ? "\n" : ""}> *${EDITION} ${cite}*`)}>
          <Icon name="notebook" size={13} />
        </button>
      </div>
    </div>
  );
  const blank = <div className="el-answer is-empty">—</div>;

  let body: ReactNode = null;
  if (tool === "ohm") {
    const o = state.ohm ?? {};
    const set = (k: keyof NonNullable<ElectricalState["ohm"]>) => (v: string) => update({ ohm: { ...o, [k]: v } });
    const res = ohm({ v: num(o.v), i: num(o.i), r: num(o.r), p: num(o.p) });
    body = (
      <>
        <div className="el-grid">
          <Field label="Volts" unit="V" value={o.v} onChange={set("v")} />
          <Field label="Amps" unit="A" value={o.i} onChange={set("i")} />
          <Field label="Ohms" unit="Ω" value={o.r} onChange={set("r")} />
          <Field label="Watts" unit="W" value={o.p} onChange={set("p")} />
        </div>
        {res
          ? answer(
              <span className="el-four">
                <b>{r(res.v)}</b> V · <b>{r(res.i)}</b> A · <b>{r(res.r, 3)}</b> Ω · <b>{r(res.p)}</b> W
              </span>,
              "(Ohm's law: V = IR, P = VI)",
              `${r(res.v)} V, ${r(res.i)} A, ${r(res.r, 3)} Ω, ${r(res.p)} W`,
            )
          : blank}
        <button className="el-quiet" onClick={() => update({ ohm: {} })}>
          Clear
        </button>
      </>
    );
  }
  if (tool === "drop") {
    const d = { size: "12" as Size, metal: "cu" as Metal, phases: 1 as 1 | 3, volts: "120", ...state.drop };
    const set = (patch: Partial<NonNullable<ElectricalState["drop"]>>) => update({ drop: { ...d, ...patch } });
    const run = { metal: d.metal, feet: num(d.feet) ?? 0, amps: num(d.amps) ?? 0, volts: num(d.volts) ?? 0, phases: d.phases };
    const vd = voltageDrop({ ...run, size: d.size });
    const better = vd && vd.percent > 3 ? sizeForDrop(run, 3) : null;
    body = (
      <>
        <div className="el-grid">
          <Pick label="Wire" value={d.size} options={SIZE_OPTIONS} onChange={(size) => set({ size })} />
          <Pick label="Metal" value={d.metal} options={[["cu", "Copper"], ["al", "Aluminum"]]} onChange={(metal) => set({ metal })} />
          <Field label="Length, one way" unit="ft" value={d.feet} onChange={(feet) => set({ feet })} />
          <Field label="Load" unit="A" value={d.amps} onChange={(amps) => set({ amps })} />
          <Field label="System" unit="V" value={d.volts} onChange={(volts) => set({ volts })} />
          <Pick label="Phase" value={d.phases} options={[[1, "Single"], [3, "Three"]]} onChange={(phases) => set({ phases })} />
        </div>
        {vd
          ? answer(
              <>
                <span className={`el-big${vd.percent > 3 ? " is-warn" : " is-ok"}`}>
                  {r(vd.volts)} V <span className="el-dim">·</span> {r(vd.percent, 1)}%
                </span>
                <span className="el-note">{vd.percent > 3 ? (better ? `Over 3% — ${sizeLabel(better)} keeps it under` : "Over 3% — no size in the table keeps it under") : "Within 3% for a branch circuit (5% with the feeder)"}</span>
              </>,
              "Ch. 9 Table 8 · 210.19(A) Informational Note",
              `Voltage drop: ${sizeLabel(d.size)} ${d.metal === "cu" ? "copper" : "aluminum"}, ${d.feet} ft, ${d.amps} A at ${d.volts} V → ${r(vd.volts)} V (${r(vd.percent, 1)}%)`,
            )
          : blank}
      </>
    );
  }
  if (tool === "wire") {
    const w = { metal: "cu" as Metal, temp: 75 as TempRating, ambient: "30", conductors: "3", ...state.wire };
    const set = (patch: Partial<NonNullable<ElectricalState["wire"]>>) => update({ wire: { ...w, ...patch } });
    const spec = { metal: w.metal, temp: w.temp, ambient: num(w.ambient) ?? 30, conductors: num(w.conductors) ?? 3 };
    const amps = num(w.amps);
    const size = amps ? wireFor(amps, spec) : null;
    const of = size ? ampacityOf(size, spec) : null;
    const factor = ambientFactor(spec.ambient, spec.temp) * bundleFactor(spec.conductors);
    body = (
      <>
        <div className="el-grid">
          <Field label="Load" unit="A" value={w.amps} onChange={(amps) => set({ amps })} />
          <Pick label="Metal" value={w.metal} options={[["cu", "Copper"], ["al", "Aluminum"]]} onChange={(metal) => set({ metal })} />
          <Pick label="Insulation rated" value={w.temp} options={[[60, "60 °C"], [75, "75 °C"], [90, "90 °C"]]} onChange={(temp) => set({ temp })} />
          <Field label="Ambient" unit="°C" value={w.ambient} onChange={(ambient) => set({ ambient })} />
          <Field label="Current-carrying conductors" value={w.conductors} onChange={(conductors) => set({ conductors })} />
        </div>
        {amps && size && of
          ? answer(
              <>
                <span className="el-big is-ok">{sizeLabel(size)}</span>
                <span className="el-note">
                  {of.base} A in the table{factor !== 1 ? ` × ${r(factor, 2)} = ${r(of.adjusted, 1)} A` : ""}
                  {of.ocpd ? ` · its breaker at most ${of.ocpd} A (240.4(D))` : ""}
                </span>
              </>,
              "310.16 · 310.15(B), (C)(1) · 240.4(D)",
              `Wire for ${amps} A: ${sizeLabel(size)} ${w.metal === "cu" ? "copper" : "aluminum"} (${w.temp} °C column, ${of.base} A${factor !== 1 ? ` × ${r(factor)} = ${r(of.adjusted, 1)} A` : ""})`,
            )
          : amps
            ? <div className="el-answer is-empty">No size in the table carries {amps} A that way</div>
            : blank}
      </>
    );
  }
  if (tool === "conduit") {
    const c = { type: "EMT" as Raceway, rows: [{ count: 3, size: "12", insulation: "THHN/THWN-2" }] as FillRow[], ...state.conduit };
    const set = (patch: Partial<NonNullable<ElectricalState["conduit"]>>) => update({ conduit: { ...c, ...patch } });
    const setRow = (k: number, patch: Partial<FillRow>) => set({ rows: c.rows.map((row, j) => (j === k ? { ...row, ...patch } : row)) });
    const f = conduitFill(c.rows, c.type);
    body = (
      <>
        <div className="el-grid">
          <Pick label="Raceway" value={c.type} options={Object.keys(RACEWAYS).map((t) => [t as Raceway, t])} onChange={(type) => set({ type })} />
        </div>
        <div className="el-rows">
          {c.rows.map((row, k) => (
            <div key={k} className="el-row">
              <input className="el-count" inputMode="numeric" value={row.count} onChange={(e) => setRow(k, { count: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="el-dim">×</span>
              <select value={row.size} onChange={(e) => setRow(k, { size: e.target.value as Size })}>
                {SIZE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select value={row.insulation} onChange={(e) => setRow(k, { insulation: e.target.value })}>
                {Object.keys(CONDUCTOR_AREA).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button className="el-quiet" title="Take this row out" onClick={() => set({ rows: c.rows.filter((_, j) => j !== k) })}>
                ×
              </button>
            </div>
          ))}
          <button className="el-quiet" onClick={() => set({ rows: [...c.rows, { count: 1, size: "12", insulation: "THHN/THWN-2" }] })}>
            + conductors
          </button>
        </div>
        {f.wires && f.smallest
          ? answer(
              <>
                <span className="el-big is-ok">
                  {f.smallest.trade}″ {c.type}
                </span>
                <span className="el-note">
                  {r(f.area, 4)} in² of {r(f.smallest.total, 3)} in² — {r(f.smallest.percent, 1)}% (allowed {f.allowed}%)
                </span>
              </>,
              "Ch. 9 Tables 1, 4, 5",
              `Conduit fill: ${c.rows.map((row) => `${row.count} × ${sizeLabel(row.size)} ${row.insulation}`).join(", ")} → ${f.smallest.trade}″ ${c.type} (${r(f.smallest.percent, 1)}% of ${f.allowed}% allowed)`,
            )
          : f.wires
            ? <div className="el-answer is-empty">Too much for 4″ {c.type}</div>
            : blank}
      </>
    );
  }
  if (tool === "box") {
    const b = { conductors: { "14": "", "12": "4", "10": "" }, devices: "1", clamps: true, grounds: true, fittings: "0", box: BOXES[0][0], ...state.box };
    const set = (patch: Partial<NonNullable<ElectricalState["box"]>>) => update({ box: { ...b, ...patch } });
    const res = boxFill({ conductors: Object.fromEntries(Object.entries(b.conductors).map(([s, n]) => [s, num(n) ?? 0])), devices: num(b.devices) ?? 0, clamps: b.clamps, grounds: b.grounds, fittings: num(b.fittings) ?? 0 });
    const room = BOXES.find(([name]) => name === b.box)?.[1] ?? 0;
    const fits = BOXES.find(([, v]) => v >= res.volume);
    body = (
      <>
        <div className="el-grid">
          {["14", "12", "10", "8", "6"].map((s) => (
            <Field key={s} label={`${s} AWG wires`} value={b.conductors[s]} onChange={(v) => set({ conductors: { ...b.conductors, [s]: v } })} />
          ))}
          <Field label="Devices" value={b.devices} onChange={(devices) => set({ devices })} />
          <Field label="Fixture studs, hickeys" value={b.fittings} onChange={(fittings) => set({ fittings })} />
          <Pick label="Box" value={b.box} options={BOXES.map(([name, v]) => [name, `${name} — ${v} in³`])} onChange={(box) => set({ box })} />
        </div>
        <div className="el-checks">
          <label>
            <input type="checkbox" checked={b.clamps} onChange={(e) => set({ clamps: e.target.checked })} /> Internal clamps
          </label>
          <label>
            <input type="checkbox" checked={b.grounds} onChange={(e) => set({ grounds: e.target.checked })} /> Grounding conductors
          </label>
        </div>
        {res.volume
          ? answer(
              <>
                <span className={`el-big${res.volume > room ? " is-warn" : " is-ok"}`}>
                  {r(res.volume, 2)} in³ <span className="el-dim">of {room}</span>
                </span>
                <span className="el-note">{res.volume > room ? `Too full — ${fits ? `a ${fits[0]} (${fits[1]} in³) holds it` : "no box in the list holds it"}` : "Fits"}</span>
              </>,
              "314.16(A), (B)",
              `Box fill: ${r(res.volume, 2)} in³ needed; ${b.box} holds ${room} in³ — ${res.volume > room ? "too full" : "fits"}`,
            )
          : blank}
      </>
    );
  }
  if (tool === "load") {
    const l = { area: "2000", small: "2", laundry: "1", appliances: "", range: "12", dryer: "5000", hvac: "", ...state.load };
    const set = (patch: Partial<NonNullable<ElectricalState["load"]>>) => update({ load: { ...l, ...patch } });
    const res = dwellingLoad({
      area: num(l.area) ?? 0,
      smallAppliance: num(l.small) ?? 2,
      laundry: num(l.laundry) ?? 1,
      appliances: (l.appliances ?? "").split(/[,\s]+/).map(Number).filter((n) => n > 0),
      rangeKw: num(l.range) ?? 0,
      dryer: num(l.dryer) ?? 0,
      hvac: num(l.hvac) ?? 0,
      volts: 240,
    });
    body = (
      <>
        <div className="el-grid">
          <Field label="Living area" unit="ft²" value={l.area} onChange={(area) => set({ area })} />
          <Field label="Small-appliance circuits" value={l.small} onChange={(small) => set({ small })} />
          <Field label="Laundry circuits" value={l.laundry} onChange={(laundry) => set({ laundry })} />
          <Field label="Appliances (VA each)" value={l.appliances} onChange={(appliances) => set({ appliances })} wide />
          <Field label="Range" unit="kW" value={l.range} onChange={(range) => set({ range })} />
          <Field label="Dryer" unit="VA" value={l.dryer} onChange={(dryer) => set({ dryer })} />
          <Field label="Heat or A/C, larger" unit="VA" value={l.hvac} onChange={(hvac) => set({ hvac })} />
        </div>
        <table className="el-table">
          <tbody>
            {res.lines.map((line) => (
              <tr key={line.what} title={line.note}>
                <td>{line.what}</td>
                <td className="el-num">{r(line.va, 0)} VA</td>
              </tr>
            ))}
          </tbody>
        </table>
        {answer(
          <>
            <span className="el-big is-ok">{res.service ? `${res.service} A service` : "Over 800 A"}</span>
            <span className="el-note">
              {r(res.total, 0)} VA ÷ 240 V = {r(res.amps, 1)} A
            </span>
          </>,
          "Article 220 Part III (standard method) · 230.79",
          `Dwelling load: ${res.lines.map((x) => `${x.what} ${r(x.va, 0)} VA`).join("; ")} → ${r(res.total, 0)} VA, ${r(res.amps, 1)} A → ${res.service} A service`,
        )}
      </>
    );
  }
  if (tool === "panel") {
    const circuits = state.panel?.circuits ?? [
      { name: "Kitchen counter", va: 1500, poles: 1, breaker: 20 },
      { name: "Kitchen counter 2", va: 1500, poles: 1, breaker: 20 },
      { name: "Lights", va: 900, poles: 1, breaker: 15 },
      { name: "Dryer", va: 5000, poles: 2, breaker: 30 },
    ];
    const setC = (next: Circuit[]) => update({ panel: { circuits: next } });
    const edit = (k: number, patch: Partial<Circuit>) => setC(circuits.map((c, j) => (j === k ? { ...c, ...patch } : c)));
    const bal = balance(circuits);
    const md = `| # | Circuit | Breaker | VA | Leg |\n| --- | --- | --- | --- | --- |\n${circuits.map((c, k) => `| ${k + 1} | ${c.name} | ${c.breaker} A ${c.poles}P | ${c.va} | ${bal.legs[k]} |`).join("\n")}\n\nLeg A ${r(bal.a, 0)} VA · Leg B ${r(bal.b, 0)} VA · ${r(bal.imbalance, 0)}% apart`;
    body = (
      <>
        <table className="el-table is-panel">
          <thead>
            <tr>
              <th>#</th>
              <th>Circuit</th>
              <th>Breaker</th>
              <th>Poles</th>
              <th>VA</th>
              <th>Leg</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {circuits.map((c, k) => (
              <tr key={k}>
                <td className="el-dim">{k + 1}</td>
                <td>
                  <input value={c.name} onChange={(e) => edit(k, { name: e.target.value })} />
                </td>
                <td>
                  <input className="el-short" inputMode="numeric" value={c.breaker} onChange={(e) => edit(k, { breaker: Number(e.target.value) || 0 })} />
                </td>
                <td>
                  <select value={c.poles} onChange={(e) => edit(k, { poles: Number(e.target.value) as 1 | 2 })}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </td>
                <td>
                  <input className="el-short" inputMode="numeric" value={c.va} onChange={(e) => edit(k, { va: Number(e.target.value) || 0 })} />
                </td>
                <td className="el-dim">{bal.legs[k]}</td>
                <td>
                  <button className="el-quiet" title="Take it out" onClick={() => setC(circuits.filter((_, j) => j !== k))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="el-quiet" onClick={() => setC([...circuits, { name: "", va: 0, poles: 1, breaker: 20 }])}>
          + circuit
        </button>
        {answer(
          <>
            <span className={`el-big${bal.imbalance > 20 ? " is-warn" : " is-ok"}`}>
              A {r(bal.a, 0)} <span className="el-dim">·</span> B {r(bal.b, 0)} VA
            </span>
            <span className="el-note">
              {r(bal.imbalance, 0)}% apart · {r(loadAmps(bal.total, 240), 1)} A at 240 V
            </span>
          </>,
          "220.61 · a panel schedule, its legs balanced",
          `Panel schedule\n${md}`,
        )}
      </>
    );
  }

  return (
    <div className="el-tile">
      <div className="el-tools" role="tablist">
        {TOOLS.map(([id, label, title]) => (
          <button key={id} role="tab" className={tool === id ? "is-on" : ""} title={title} onClick={() => update({ tool: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="el-body">{body}</div>
      <div className="el-fine">Values from the {EDITION} tables. The code book and your inspector have the final word.</div>
    </div>
  );
}
