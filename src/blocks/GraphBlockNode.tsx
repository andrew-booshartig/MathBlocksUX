/** The Graph block: a small graphing studio. An equation list (each line
 * with its own color, style, thickness, shading and label), sliders made
 * automatically for any letter a line uses, drawing tools, and a plot that
 * fills whatever size the block is dragged to — the list moves beside the
 * graph when there's room, above it when there isn't. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import {
  type GraphAppearance,
  type GraphBlockData,
  type GraphDrawing,
  type GraphLineStyle,
  type GraphSlider,
  type GraphTheme,
  type GraphWindow,
  useStore,
  useVariables,
} from "../store";
import GraphView, { DEFAULT_WINDOW, THEMES, type MarkerFeature, type PlotDiv } from "../GraphView";
import GraphDrawLayer, { type GraphTool } from "../GraphDraw";
import type { GraphResult } from "../mathSidecar";
import { Plotly } from "../PlotlyChart";
import { RichText, Tex } from "../ui";
import Icon from "../Icon";
import BlockShell from "./BlockShell";
import type { Frame } from "./WorkBlockNode";

const FEATURES: { value: MarkerFeature; label: string }[] = [
  { value: "intercepts", label: "Intercepts" },
  { value: "vertices", label: "Vertices" },
  { value: "intersections", label: "Intersections" },
];

const PRESETS: { label: string; window: GraphWindow }[] = [
  { label: "±10", window: DEFAULT_WINDOW },
  { label: "±5", window: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 } },
  { label: "±25", window: { xmin: -25, xmax: 25, ymin: -25, ymax: 25 } },
  { label: "Quadrant I", window: { xmin: -1, xmax: 20, ymin: -1, ymax: 20 } },
];

const TOOLS: { id: GraphTool; icon: string; title: string }[] = [
  { id: "pan", icon: "hand", title: "Move — drag to pan, scroll to zoom" },
  { id: "point", icon: "point", title: "Point — click to plot a point (it's added to the list)" },
  { id: "segment", icon: "segment", title: "Segment — drag from one end to the other" },
  { id: "arrow", icon: "arrow", title: "Arrow — drag from the tail to the tip" },
  { id: "pen", icon: "pen", title: "Pen — draw freehand" },
  { id: "text", icon: "text", title: "Text — click where it goes, type, Enter" },
  { id: "eraser", icon: "eraser", title: "Eraser — click (or drag over) a drawing to remove it" },
];

const LINE_COLORS = ["#7c9bf7", "#e07ce0", "#55d6be", "#f0a35c", "#8fd694", "#f08787", "#e0b25c", "#c98cf0", "#2f6fe0", "#c2185b", "#ffffff", "#1d2330"];
const INK_COLORS = ["#f0e14a", "#ff6b6b", "#55d6be", "#7c9bf7", "#e07ce0", "#ffffff", "#1d2330"];
const INK_WIDTHS = [2, 4, 7];

const THEME_IDS = Object.keys(THEMES) as GraphTheme[];
const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "sqrt", "abs", "log", "ln", "exp", "pi", "x", "y", "e"]);

const decimals = (step: number) => Math.max(0, Math.min(6, Math.ceil(-Math.log10(step || 1))));
const clean = (v: number, step: number) => Number(v.toFixed(decimals(step)));
const fmtCoord = (n: number) => String(Math.round(n * 1000) / 1000);

/** The graphing studio itself: everything but the block around it, so a
 * tab inside another block (the smart calculator) can use it too. */
export function GraphStudio({
  data,
  update,
  frame,
  pool: poolOverride,
  poolNames = { toggle: "Use global variables", from: "from the canvas" },
}: {
  data: GraphBlockData;
  update: (patch: Partial<GraphBlockData>) => void;
  frame: Frame;
  /** where letters' values come from (default: the canvas's Variable blocks) */
  pool?: Record<string, string>;
  /** what to call that source (default: "global variables", "from the canvas") */
  poolNames?: { toggle: string; from: string };
}) {
  const canvasPool = useVariables();
  const pool = poolOverride ?? canvasPool;
  const latest = useRef(data);
  latest.current = data;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tool, setTool] = useState<GraphTool>("pan");
  const [ink, setInk] = useState({ color: INK_COLORS[0], width: 4 });
  const [snap, setSnap] = useState(true);
  const [result, setResult] = useState<GraphResult | null>(null);
  const [plot, setPlot] = useState<PlotDiv>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [styleOpen, setStyleOpen] = useState<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const onResult = useCallback((r: GraphResult | null) => setResult(r), []);

  const lines = (data?.expr ?? "").split("\n");
  const styles = data?.styles ?? [];
  const sliders = useMemo(() => data?.sliders ?? [], [data?.sliders]);
  const useGlobals = data?.useGlobals !== false;
  const appearance: GraphAppearance = data?.appearance ?? {};
  const theme = THEMES[appearance.theme ?? "dark"];
  const window = data?.window ?? DEFAULT_WINDOW;

  // globals win over this graph's own sliders when "use global variables" is on
  const vars = useMemo(() => {
    const local = Object.fromEntries(sliders.map((s) => [s.name, String(s.value)]));
    return useGlobals ? { ...local, ...pool } : local;
  }, [sliders, pool, useGlobals]);

  // any letter a line needs and nothing defines gets its own slider
  useEffect(() => {
    if (!data || !result) return;
    const missing = [...new Set(result.series.flatMap((s) => s.missing ?? []))];
    const have = new Set(sliders.map((s) => s.name));
    const add = missing.filter((name) => !have.has(name));
    if (add.length) update({ sliders: [...sliders, ...add.map((name) => ({ name, value: 1, min: -10, max: 10, step: 0.1 }))] });
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ▶ on a slider sweeps it back and forth
  useEffect(() => {
    if (!playing) return;
    let direction = 1;
    const timer = setInterval(() => {
      const block = latest.current;
      const s = block?.sliders?.find((x) => x.name === playing);
      if (!block || !s) return setPlaying(null);
      let v = s.value + direction * Math.max(s.step, (s.max - s.min) / 150);
      if (v >= s.max) [v, direction] = [s.max, -1];
      if (v <= s.min) [v, direction] = [s.min, 1];
      update({ sliders: block.sliders!.map((x) => (x.name === playing ? { ...x, value: clean(v, s.step) } : x)) });
    }, 50);
    return () => clearInterval(timer);
  }, [playing, update]);

  useEffect(() => {
    if (editing !== null) inputs.current[editing]?.focus();
  }, [editing]);

  // a click anywhere else closes the style popover
  useEffect(() => {
    if (styleOpen === null) return;
    const close = () => setStyleOpen(null);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [styleOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!data) return null;

  // ---- the equation list (styles stay lined up with the lines)
  const padded = (): GraphLineStyle[] => Array.from({ length: lines.length }, (_, k) => styles[k] ?? {});
  const saveLines = (next: string[], nextStyles: GraphLineStyle[]) => update({ expr: next.join("\n"), styles: nextStyles });
  const setLine = (i: number, text: string) => saveLines(lines.map((l, k) => (k === i ? text : l)), padded());
  const insertLine = (at: number, text = "") => {
    const next = [...lines];
    const st = padded();
    next.splice(at, 0, text);
    st.splice(at, 0, {});
    saveLines(next, st);
    setEditing(at);
  };
  const removeLine = (i: number) => {
    if (lines.length === 1) {
      saveLines([""], []);
      setEditing(0);
      return;
    }
    const next = [...lines];
    const st = padded();
    next.splice(i, 1);
    st.splice(i, 1);
    saveLines(next, st);
    setEditing(Math.max(0, i - 1));
  };
  const setStyle = (i: number, patch: Partial<GraphLineStyle>) => {
    const st = padded();
    st[i] = { ...st[i], ...patch };
    update({ styles: st });
  };
  const colorOf = (i: number) => styles[i]?.color ?? theme.palette[i % theme.palette.length];

  // ---- sliders
  const setSlider = (name: string, patch: Partial<GraphSlider>) =>
    update({ sliders: sliders.map((s) => (s.name === name ? { ...s, ...patch } : s)) });
  const removeSlider = (name: string) => update({ sliders: sliders.filter((s) => s.name !== name) });
  const usedGlobals = useGlobals
    ? [
        ...new Set(
          lines.flatMap((line) =>
            (line.match(/[A-Za-z_]\w*/g) ?? []).flatMap((token) =>
              FUNCTION_NAMES.has(token) ? [] : pool[token] !== undefined ? [token] : [...token].filter((ch) => !FUNCTION_NAMES.has(ch) && pool[ch] !== undefined),
            ),
          ),
        ),
      ]
    : [];

  /** zoom about the middle of the view, like a browser's + / − */
  const zoomBy = (k: number) => {
    const w = latest.current.window ?? DEFAULT_WINDOW;
    const cx = (w.xmin + w.xmax) / 2;
    const cy = (w.ymin + w.ymax) / 2;
    const hx = ((w.xmax - w.xmin) / 2) * k;
    const hy = ((w.ymax - w.ymin) / 2) * k;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    update({ window: { xmin: r(cx - hx), xmax: r(cx + hx), ymin: r(cy - hy), ymax: r(cy + hy) } });
  };

  const setAppearance = (patch: Partial<GraphAppearance>) => update({ appearance: { ...appearance, ...patch } });
  const setWindowField = (field: keyof GraphWindow, value: string) => {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) update({ window: { ...window, [field]: n } });
  };
  const hide = data.hideMarkers ?? [];
  const drawings = data.drawings ?? [];
  const panelHidden = data.panel === "hidden";

  const exportPng = async () => {
    if (!plot) return;
    try {
      const url = await Plotly.toImage(plot, { format: "png", width: plot.offsetWidth, height: plot.offsetHeight, scale: 2 });
      const name = (appearance.title || "graph").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "graph";
      const path = await invoke<string>("save_image", { name, dataUrl: url });
      setNotice(`Saved to ${path}`);
    } catch (err) {
      setNotice(`Couldn't save the picture: ${err}`);
    }
  };

  const rowKeys = (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      insertLine(i + 1);
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      setEditing(i - 1);
    } else if (e.key === "ArrowDown" && i < lines.length - 1) {
      e.preventDefault();
      setEditing(i + 1);
    } else if (e.key === "Backspace" && lines[i] === "" && lines.length > 1) {
      e.preventDefault();
      removeLine(i);
    } else if (e.key === "Escape") {
      (e.target as HTMLInputElement).blur();
    }
  };

  const panel = (
    <div className="graph-panel nodrag">
      <div className="graph-rows">
        {lines.map((line, i) => {
          const s = result?.series.find((x) => x.index === i);
          const st = styles[i] ?? {};
          const color = colorOf(i);
          const math = s && s.kind !== "error" ? (s.display ?? s.latex) : undefined;
          const showMath = editing !== i && line.trim() !== "" && !!math;
          const error = s?.kind === "error" && !s.missing?.length && editing !== i && line.trim() ? s.error : null;
          return (
            <div key={i} className={`graph-row${st.hidden ? " is-hidden" : ""}${editing === i ? " is-editing" : ""}`}>
              <button
                className="graph-row-dot"
                style={{ background: st.hidden ? "transparent" : color, borderColor: color }}
                title="Color & style"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setStyleOpen(styleOpen === i ? null : i)}
              />
              <div className="graph-row-main">
                {showMath ? (
                  <div className="graph-row-math" title="Click to edit" onClick={() => setEditing(i)}>
                    <Tex math={math!} />
                  </div>
                ) : (
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    className="graph-row-input"
                    value={line}
                    spellCheck={false}
                    placeholder={i === 0 ? "y = 2x + 1   ·   (3, 4)   ·   y < x² …" : ""}
                    onFocus={() => setEditing(i)}
                    onBlur={() => setEditing((e) => (e === i ? null : e))}
                    onChange={(e) => setLine(i, e.target.value)}
                    onKeyDown={rowKeys(i)}
                  />
                )}
                {error && <div className="graph-row-error">{error}</div>}
              </div>
              <button className="graph-row-btn" title={st.hidden ? "Show" : "Hide"} onClick={() => setStyle(i, { hidden: !st.hidden })}>
                <Icon name={st.hidden ? "eyeOff" : "eye"} size={14} />
              </button>
              <button className="graph-row-btn" title="Remove this line" onClick={() => removeLine(i)}>
                ×
              </button>
              {styleOpen === i && (
                <div className="graph-style-pop" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="graph-swatches">
                    {LINE_COLORS.map((c) => (
                      <button key={c} className={`graph-swatch-btn${c === color ? " is-on" : ""}`} style={{ background: c }} onClick={() => setStyle(i, { color: c })} />
                    ))}
                    <label className="graph-swatch-custom" title="Any color">
                      <input type="color" value={color.startsWith("#") ? color : "#7c9bf7"} onChange={(e) => setStyle(i, { color: e.target.value })} />
                    </label>
                  </div>
                  <div className="graph-seg">
                    {(["solid", "dash", "dot"] as const).map((d) => (
                      <button key={d} className={(st.dash ?? "solid") === d ? "is-on" : ""} title={d} onClick={() => setStyle(i, { dash: d })}>
                        <svg width="30" height="8">
                          <line x1="3" y1="4" x2="27" y2="4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={d === "dash" ? "6 4" : d === "dot" ? "0.5 4.5" : undefined} />
                        </svg>
                      </button>
                    ))}
                  </div>
                  <label className="graph-range">
                    Thickness
                    <input type="range" min={1} max={8} step={0.5} value={st.width ?? 2.5} onChange={(e) => setStyle(i, { width: Number(e.target.value) })} />
                  </label>
                  {s?.kind === "inequality" && (
                    <label className="graph-range">
                      Shading
                      <input type="range" min={0} max={0.8} step={0.02} value={st.fill ?? 0.18} onChange={(e) => setStyle(i, { fill: Number(e.target.value) })} />
                    </label>
                  )}
                  <label className="graph-check">
                    <input type="checkbox" checked={!!st.label} onChange={(e) => setStyle(i, { label: e.target.checked })} />
                    Write the equation on the graph
                  </label>
                  {st.color && (
                    <button className="chip" onClick={() => setStyle(i, { color: undefined })}>
                      Theme color
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button className="graph-add" onClick={() => insertLine(lines.length)}>
          + Add a line
        </button>
      </div>

      <div className="graph-sliders">
        <div className="graph-sliders-head">
          <span className="graph-section-title">Sliders</span>
          <label
            className="graph-check"
            title="On: letters use the values of Variable and Slider blocks on the canvas, and anything they don't define gets a slider here. Off: this graph only uses its own sliders."
          >
            <input type="checkbox" checked={useGlobals} onChange={(e) => update({ useGlobals: e.target.checked })} />
            {poolNames.toggle}
          </label>
        </div>
        {usedGlobals.map((name) => (
          <div key={`g-${name}`} className="graph-slider is-global" title="Set by a Variable or Slider block on the canvas">
            <span className="graph-slider-name">
              <Tex math={name} /> = {pool[name]}
            </span>
            <span className="graph-slider-note">{poolNames.from}</span>
          </div>
        ))}
        {sliders.map((s) => {
          const shadowed = useGlobals && pool[s.name] !== undefined;
          return (
            <div key={s.name} className={`graph-slider${shadowed ? " is-shadowed" : ""}`} title={shadowed ? "The canvas defines this letter too, and that value is used" : undefined}>
              <div className="graph-slider-top">
                <span className="graph-slider-name">
                  <Tex math={s.name} /> =
                </span>
                <input
                  className="graph-num"
                  key={`v-${s.value}`}
                  defaultValue={s.value}
                  onBlur={(e) => Number.isFinite(Number(e.target.value)) && e.target.value.trim() && setSlider(s.name, { value: Number(e.target.value) })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <button className={`graph-row-btn${playing === s.name ? " is-on" : ""}`} title={playing === s.name ? "Stop" : "Play — sweep back and forth"} onClick={() => setPlaying(playing === s.name ? null : s.name)}>
                  <Icon name={playing === s.name ? "pause" : "play"} size={13} />
                </button>
                <button className="graph-row-btn" title="Remove this slider" onClick={() => removeSlider(s.name)}>
                  ×
                </button>
              </div>
              <div className="graph-slider-track">
                <input
                  className="graph-num is-small"
                  key={`min-${s.min}`}
                  defaultValue={s.min}
                  title="lowest"
                  onBlur={(e) => Number.isFinite(Number(e.target.value)) && setSlider(s.name, { min: Number(e.target.value) })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.value} onChange={(e) => setSlider(s.name, { value: clean(Number(e.target.value), s.step) })} />
                <input
                  className="graph-num is-small"
                  key={`max-${s.max}`}
                  defaultValue={s.max}
                  title="highest"
                  onBlur={(e) => Number.isFinite(Number(e.target.value)) && setSlider(s.name, { max: Number(e.target.value) })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </div>
            </div>
          );
        })}
        {!sliders.length && !usedGlobals.length && (
          <div className="graph-hint">
            <RichText text="Use a letter like $m$ in a line and a slider for it appears here." />
          </div>
        )}
      </div>
    </div>
  );

  const toolbar = (
    <div className="graph-toolbar nodrag">
      <div className="graph-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`graph-tool${tool === t.id ? " is-on" : ""}`} title={t.title} onClick={() => setTool(t.id)}>
            <Icon name={t.icon} size={15} />
          </button>
        ))}
      </div>
      {(tool === "segment" || tool === "arrow" || tool === "pen" || tool === "text") && (
        <div className="graph-ink">
          {INK_COLORS.map((c) => (
            <button key={c} className={`graph-ink-color${ink.color === c ? " is-on" : ""}`} style={{ background: c }} title="Ink color" onClick={() => setInk({ ...ink, color: c })} />
          ))}
          {INK_WIDTHS.map((w) => (
            <button key={w} className={`graph-ink-width${ink.width === w ? " is-on" : ""}`} title={tool === "text" ? "Text size" : "Thickness"} onClick={() => setInk({ ...ink, width: w })}>
              <span style={{ width: w + 3, height: w + 3, background: ink.color }} />
            </button>
          ))}
        </div>
      )}
      {tool === "eraser" && drawings.length > 0 && (
        <button className="graph-tool is-text" title="Remove every drawing" onClick={() => update({ drawings: [] })}>
          <Icon name="trash" size={14} /> Clear drawings
        </button>
      )}
      <div className="graph-toolbar-end">
        {tool !== "pan" && tool !== "eraser" && (
          <button className={`graph-tool${snap ? " is-on" : ""}`} title="Snap to the grid" onClick={() => setSnap(!snap)}>
            <Icon name="magnet" size={15} />
          </button>
        )}
        <button className="graph-tool" title="Zoom out" onClick={() => zoomBy(1.5)}>
          <Icon name="zoomOut" size={15} />
        </button>
        <button className="graph-tool" title="Zoom in" onClick={() => zoomBy(1 / 1.5)}>
          <Icon name="zoom" size={15} />
        </button>
        <button className="graph-tool" title="Back to −10 … 10" onClick={() => update({ window: DEFAULT_WINDOW })}>
          <Icon name="reset" size={15} />
        </button>
        <button className="graph-tool" title="Save as a picture (PNG, to Downloads)" onClick={exportPng}>
          <Icon name="download" size={15} />
        </button>
        <button className={`graph-tool${panelHidden ? "" : " is-on"}`} title={panelHidden ? "Show the equation list" : "Hide the equation list"} onClick={() => update({ panel: panelHidden ? "shown" : "hidden" })}>
          <Icon name="panel" size={15} />
        </button>
      </div>
    </div>
  );

  const settings = settingsOpen && (
    <div className="graph-settings-panel nodrag nowheel">
      <div className="graph-settings-head">
        <span className="graph-section-title">Graph settings</span>
        <button className="graph-row-btn" title="Close" onClick={() => setSettingsOpen(false)}>
          ×
        </button>
      </div>
      <section>
        <h4>Window</h4>
        <div className="graph-window">
          {(["xmin", "xmax", "ymin", "ymax"] as const).map((field) => (
            <label key={field}>
              {field}
              <input
                className="graph-num"
                defaultValue={window[field]}
                key={`${field}-${window[field]}`}
                onBlur={(e) => setWindowField(field, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </label>
          ))}
        </div>
        <div className="graph-presets">
          {PRESETS.map((p) => (
            <button key={p.label} className="chip" onClick={() => update({ window: p.window })}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="graph-check" title="1 unit on x is the same length as 1 unit on y, so slopes look true">
          <input type="checkbox" checked={data.equalAspect !== false} onChange={(e) => update({ equalAspect: e.target.checked })} />
          Equal scale on both axes
        </label>
      </section>
      <section>
        <h4>Grid &amp; axes</h4>
        <div className="graph-seg is-wide">
          {(
            [
              ["none", "No grid"],
              ["major", "Grid"],
              ["minor", "Fine grid"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={(appearance.grid ?? "major") === value ? "is-on" : ""} onClick={() => setAppearance({ grid: value })}>
              {label}
            </button>
          ))}
        </div>
        <label className="graph-check">
          <input type="checkbox" checked={appearance.axes !== false} onChange={(e) => setAppearance({ axes: e.target.checked })} />
          Axes
        </label>
        <label className="graph-check">
          <input type="checkbox" checked={appearance.numbers !== false} onChange={(e) => setAppearance({ numbers: e.target.checked })} />
          Numbers on the axes
        </label>
        <div className="graph-window">
          {(
            [
              ["xStep", "x step"],
              ["yStep", "y step"],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                className="graph-num"
                placeholder="auto"
                key={`${field}-${appearance[field] ?? ""}`}
                defaultValue={appearance[field] ?? ""}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  setAppearance({ [field]: e.target.value.trim() && n > 0 ? n : undefined });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4>Labels</h4>
        {(
          [
            ["title", "Title"],
            ["xLabel", "x-axis"],
            ["yLabel", "y-axis"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="graph-text-field">
            {label}
            <input
              className="block-input"
              key={`${field}-${appearance[field] ?? ""}`}
              defaultValue={appearance[field] ?? ""}
              onBlur={(e) => setAppearance({ [field]: e.target.value.trim() || undefined })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </label>
        ))}
      </section>
      <section>
        <h4>Theme</h4>
        <div className="graph-themes">
          {THEME_IDS.map((t) => (
            <button key={t} className={`graph-theme${(appearance.theme ?? "dark") === t ? " is-on" : ""}`} onClick={() => setAppearance({ theme: t })}>
              <span className="graph-theme-swatch" style={{ background: THEMES[t].bg, borderColor: THEMES[t].axis }}>
                <span style={{ background: THEMES[t].palette[0] }} />
                <span style={{ background: THEMES[t].palette[1] }} />
              </span>
              {THEMES[t].label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h4>Key points</h4>
        {FEATURES.map((f) => (
          <label key={f.value} className="graph-check">
            <input
              type="checkbox"
              checked={!hide.includes(f.value)}
              onChange={(e) => update({ hideMarkers: e.target.checked ? hide.filter((h) => h !== f.value) : [...hide, f.value] })}
            />
            {f.label}
          </label>
        ))}
      </section>
      <section className="graph-settings-actions">
        <button className="action-btn" onClick={exportPng}>
          <Icon name="download" size={14} /> Save picture
        </button>
        <button className="action-btn" disabled={!drawings.length} onClick={() => update({ drawings: [] })}>
          <Icon name="trash" size={14} /> Clear drawings
        </button>
      </section>
    </div>
  );

  return frame(
        <button className={`block-icon-btn${settingsOpen ? " is-active" : ""}`} title="Graph settings: window, grid, labels, theme" onClick={() => setSettingsOpen(!settingsOpen)}>
          ⚙
        </button>,
    <>
      <div className={`graph-studio${panelHidden ? " is-panel-hidden" : ""}`}>
        <div className="graph-studio-main">
          {!panelHidden && panel}
          <div className="graph-stage">
            {toolbar}
            <GraphView
              fill
              live
              exprs={lines}
              vars={vars}
              window={window}
              onWindowChange={(w) => update({ window: w })}
              equalAspect={data.equalAspect !== false}
              hide={hide}
              styles={styles}
              appearance={appearance}
              drawings={drawings}
              onResult={onResult}
              onPlot={setPlot}
              overlay={(p, size) => (
                <GraphDrawLayer
                  plot={p}
                  size={size}
                  tool={tool}
                  color={ink.color}
                  width={ink.width}
                  snap={snap}
                  window={window}
                  drawings={drawings}
                  onDrawings={(next: GraphDrawing[]) => update({ drawings: next })}
                  onPoint={(x, y) => {
                    const point = `(${fmtCoord(x)}, ${fmtCoord(y)})`;
                    const empty = lines.findIndex((l) => !l.trim());
                    if (empty >= 0) setLine(empty, point);
                    else saveLines([...lines, point], padded().concat({}));
                  }}
                />
              )}
            />
          </div>
        </div>
        {settings}
        {notice && <div className="graph-notice">{notice}</div>}
      </div>
    </>,
  );
}

export default function GraphBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as GraphBlockData | undefined;
  const updateBlock = useStore((state) => state.updateBlock<GraphBlockData>);
  const update = useCallback((patch: Partial<GraphBlockData>) => updateBlock(id, patch), [id, updateBlock]);
  if (!data) return null;
  return (
    <GraphStudio
      data={data}
      update={update}
      frame={(headerExtra, body) => (
        <BlockShell
          id={id}
          title="Graph"
          wide
          help="One thing per line: y = 2x + 1, f(x) = x^2, x = 3, (2, 5), y < -x + 4. Letters get sliders. Drag to pan, scroll to zoom; pick a tool to draw."
          headerExtra={headerExtra}
        >
          {body}
        </BlockShell>
      )}
    />
  );
}
