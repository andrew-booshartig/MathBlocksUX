/** Diagrams typed as text — Mermaid, as Obsidian and GitHub draw them:
 * flowcharts, sequences, classes, states, timelines, mind maps, pies.
 * Mermaid is big, so it's loaded the first time a diagram's drawn; its
 * drawings are one at a time (it doesn't like two at once). */
type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;
let themed = "";
let queue: Promise<unknown> = Promise.resolve();
let n = 0;

type RGB = [number, number, number];
/** a theme color as numbers (a CSS variable resolved by the page) */
function resolve(cssVar: string, fallback: string): RGB {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${cssVar}, ${fallback})`;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
    probe.remove();
    return rgb.length >= 3 ? [rgb[0], rgb[1], rgb[2]] : [128, 128, 128];
  } catch {
    return [128, 128, 128];
  }
}
const css = ([r, g, b]: RGB) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k)];
const light = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** whether the app's dark (its page's background, by its lightness) */
export function isDark(): boolean {
  return light(resolve("--t-bg1", "#ffffff")) < 128;
}

/** Mermaid's colors, the app's own (or paper's: ink on white, for printing) */
function palette(paper: boolean): Record<string, string | boolean> {
  const bg = paper ? ([255, 255, 255] as RGB) : resolve("--t-bg2", "#ffffff");
  const text = paper ? ([29, 35, 48] as RGB) : resolve("--t-text", "#1d2330");
  const muted = paper ? ([107, 114, 128] as RGB) : resolve("--t-muted", "#6b7280");
  const line = paper ? ([213, 218, 226] as RGB) : resolve("--t-line", "#d5dae2");
  const blue = paper ? ([31, 98, 196] as RGB) : resolve("--t-blue", "#3b82f6");
  const teal = paper ? ([18, 140, 126] as RGB) : resolve("--t-teal", "#12a594");
  const purple = paper ? ([123, 63, 181] as RGB) : resolve("--t-purple", "#8e4ec6");
  const yellow = paper ? ([200, 150, 0] as RGB) : resolve("--t-yellow", "#e5b80b");
  const dark = light(bg) < 128;
  const node = css(mix(blue, bg, dark ? 0.2 : 0.12));
  return {
    darkMode: dark,
    background: css(bg),
    fontFamily: '-apple-system, "Inter", "Helvetica Neue", sans-serif',
    fontSize: "14px",
    primaryColor: node,
    primaryBorderColor: css(blue),
    primaryTextColor: css(text),
    secondaryColor: css(mix(teal, bg, dark ? 0.2 : 0.12)),
    secondaryBorderColor: css(teal),
    tertiaryColor: css(mix(purple, bg, dark ? 0.16 : 0.1)),
    tertiaryBorderColor: css(purple),
    lineColor: css(muted),
    textColor: css(text),
    mainBkg: node,
    nodeBorder: css(blue),
    clusterBkg: css(mix(text, bg, 0.04)),
    clusterBorder: css(line),
    edgeLabelBackground: css(bg),
    titleColor: css(text),
    noteBkgColor: css(mix(yellow, bg, dark ? 0.22 : 0.18)),
    noteBorderColor: css(yellow),
    noteTextColor: css(text),
    actorBkg: node,
    actorBorder: css(blue),
    actorTextColor: css(text),
    actorLineColor: css(muted),
    signalColor: css(text),
    signalTextColor: css(text),
    labelBoxBkgColor: node,
    labelBoxBorderColor: css(blue),
    labelTextColor: css(text),
    loopTextColor: css(text),
    activationBkgColor: css(mix(blue, bg, 0.3)),
    sequenceNumberColor: css(bg),
  };
}

/** the diagram as SVG, or what's wrong with what's typed (paper: drawn for printing) */
export function mermaidSvg(code: string, paper = false): Promise<{ svg: string } | { error: string }> {
  const job = queue.then(async () => {
    const m = await (loading ??= import("mermaid").then((x) => x.default));
    const vars = palette(paper);
    const key = JSON.stringify(vars);
    if (themed !== key) {
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: vars,
        flowchart: { htmlLabels: true, curve: "basis" },
      });
      themed = key;
    }
    const text = code.trim();
    if (!text) return { error: "" };
    try {
      await m.parse(text);
    } catch (err) {
      return { error: String((err as Error)?.message ?? err).split("\n").slice(0, 3).join("\n") };
    }
    try {
      const { svg } = await m.render(`mlx-mermaid-${++n}`, text);
      return { svg };
    } catch (err) {
      // (a failed drawing can leave its scratch element behind)
      document.querySelectorAll(`#dmlx-mermaid-${n}, #mlx-mermaid-${n}`).forEach((e) => e.remove());
      return { error: String((err as Error)?.message ?? err).split("\n")[0] };
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** diagrams to start from */
export const MERMAID_STARTS: { id: string; label: string; code: string }[] = [
  { id: "flow", label: "Flowchart", code: "flowchart TD\n  A[Start] --> B{Is it working?}\n  B -->|Yes| C[Keep going]\n  B -->|No| D[Check the wiring]\n  D --> B" },
  { id: "sequence", label: "Sequence", code: "sequenceDiagram\n  participant S as Switch\n  participant L as Lamp\n  S->>L: closes the circuit\n  L-->>S: draws current\n  Note over S,L: I = V / R" },
  { id: "state", label: "States", code: "stateDiagram-v2\n  [*] --> Off\n  Off --> On: Start pressed\n  On --> Off: Stop pressed\n  On --> Tripped: overload\n  Tripped --> Off: reset" },
  { id: "class", label: "Classes", code: "classDiagram\n  class Circuit {\n    +parts\n    +solve()\n  }\n  class Part {\n    +name\n    +value\n  }\n  Circuit o-- Part" },
  { id: "timeline", label: "Timeline", code: "timeline\n  title Apprenticeship\n  Year 1 : DC theory : Ohm's law\n  Year 2 : AC theory : Motors\n  Year 3 : Code : Grounding\n  Year 4 : Controls : Exam" },
  { id: "mindmap", label: "Mind map", code: "mindmap\n  root((Electricity))\n    Voltage\n      Push\n    Current\n      Flow\n    Resistance\n      Opposition" },
  { id: "pie", label: "Pie", code: 'pie title Where the power goes\n  "Heating" : 45\n  "Lighting" : 15\n  "Appliances" : 40' },
  { id: "gantt", label: "Schedule", code: "gantt\n  title Study plan\n  dateFormat YYYY-MM-DD\n  section Theory\n  DC circuits :a1, 2026-11-10, 7d\n  AC circuits :after a1, 10d\n  section Practice\n  Practice exam :2026-11-28, 3d" },
];
