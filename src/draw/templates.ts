/** Drawings to start from: a flowchart, a mind map, a Venn diagram, a cycle, a free-body diagram. */
export const DRAW_TEMPLATES: { id: string; label: string; code: string }[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    code: [
      { id: "f1", t: "ellipse", x: 0, y: 0, w: 150, h: 56, text: "Start", stroke: "green", fill: "soft" },
      { id: "f2", t: "rect", x: 0, y: 110, w: 150, h: 60, text: "Read the problem", stroke: "blue", fill: "soft" },
      { id: "f3", t: "diamond", x: -5, y: 225, w: 160, h: 110, text: "Know the formula?", stroke: "orange", fill: "soft" },
      { id: "f4", t: "rect", x: 0, y: 390, w: 150, h: 60, text: "Plug in, solve", stroke: "blue", fill: "soft" },
      { id: "f5", t: "rect", x: 230, y: 250, w: 150, h: 60, text: "Look it up", stroke: "purple", fill: "soft" },
      { id: "f6", t: "ellipse", x: 0, y: 505, w: 150, h: 56, text: "Check units", stroke: "green", fill: "soft" },
      { id: "a1", t: "arrow", pts: [[75, 56], [75, 110]], from: "f1", to: "f2" },
      { id: "a2", t: "arrow", pts: [[75, 170], [75, 225]], from: "f2", to: "f3" },
      { id: "a3", t: "arrow", pts: [[75, 335], [75, 390]], from: "f3", to: "f4", text: "yes", size: 14 },
      { id: "a4", t: "arrow", pts: [[155, 280], [230, 280]], from: "f3", to: "f5", text: "no", size: 14 },
      { id: "a5", t: "arrow", pts: [[305, 310], [150, 420]], from: "f5", to: "f4", path: "elbow" },
      { id: "a6", t: "arrow", pts: [[75, 450], [75, 505]], from: "f4", to: "f6" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  },
  {
    id: "mindmap",
    label: "Mind map",
    code: [
      { id: "m0", t: "ellipse", x: 0, y: 0, w: 170, h: 70, text: "Ohm's law", stroke: "purple", fill: "solid", size: 18 },
      { id: "m1", t: "rect", x: 260, y: -110, w: 140, h: 50, text: "$V = IR$", stroke: "blue", fill: "soft" },
      { id: "m2", t: "rect", x: 260, y: 10, w: 140, h: 50, text: "$P = VI$", stroke: "teal", fill: "soft" },
      { id: "m3", t: "rect", x: 260, y: 130, w: 140, h: 50, text: "Series: add R", stroke: "green", fill: "soft" },
      { id: "m4", t: "rect", x: -230, y: -60, w: 140, h: 50, text: "Volts: push", stroke: "orange", fill: "soft" },
      { id: "m5", t: "rect", x: -230, y: 80, w: 140, h: 50, text: "Amps: flow", stroke: "red", fill: "soft" },
      { id: "c1", t: "line", pts: [[170, 35], [260, -85]], from: "m0", to: "m1", path: "curve", stroke: "gray" },
      { id: "c2", t: "line", pts: [[170, 35], [260, 35]], from: "m0", to: "m2", stroke: "gray" },
      { id: "c3", t: "line", pts: [[170, 35], [260, 155]], from: "m0", to: "m3", stroke: "gray" },
      { id: "c4", t: "line", pts: [[0, 35], [-90, -35]], from: "m0", to: "m4", stroke: "gray" },
      { id: "c5", t: "line", pts: [[0, 35], [-90, 105]], from: "m0", to: "m5", stroke: "gray" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  },
  {
    id: "venn",
    label: "Venn diagram",
    code: [
      { id: "v1", t: "ellipse", x: 0, y: 0, w: 220, h: 220, stroke: "blue", fill: "soft" },
      { id: "v2", t: "ellipse", x: 130, y: 0, w: 220, h: 220, stroke: "pink", fill: "soft" },
      { id: "v3", t: "text", x: 40, y: 98, w: 70, h: 24, text: "Only A", size: 16, stroke: "blue" },
      { id: "v4", t: "text", x: 150, y: 98, w: 60, h: 24, text: "Both", size: 16 },
      { id: "v5", t: "text", x: 250, y: 98, w: 70, h: 24, text: "Only B", size: 16, stroke: "pink" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  },
  {
    id: "cycle",
    label: "Cycle",
    code: [
      { id: "y1", t: "rect", x: 100, y: 0, w: 130, h: 50, text: "Plan", stroke: "blue", fill: "soft" },
      { id: "y2", t: "rect", x: 260, y: 130, w: 130, h: 50, text: "Do", stroke: "green", fill: "soft" },
      { id: "y3", t: "rect", x: 100, y: 260, w: 130, h: 50, text: "Check", stroke: "orange", fill: "soft" },
      { id: "y4", t: "rect", x: -60, y: 130, w: 130, h: 50, text: "Fix", stroke: "red", fill: "soft" },
      { id: "z1", t: "arrow", pts: [[230, 25], [320, 60], [325, 130]], from: "y1", to: "y2", path: "curve" },
      { id: "z2", t: "arrow", pts: [[325, 180], [320, 250], [230, 285]], from: "y2", to: "y3", path: "curve" },
      { id: "z3", t: "arrow", pts: [[100, 285], [10, 250], [5, 180]], from: "y3", to: "y4", path: "curve" },
      { id: "z4", t: "arrow", pts: [[5, 130], [10, 60], [100, 25]], from: "y4", to: "y1", path: "curve" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  },
  {
    id: "freebody",
    label: "Free-body diagram",
    code: [
      { id: "b0", t: "rect", x: 0, y: 0, w: 120, h: 80, text: "$m$", stroke: "ink", fill: "soft", size: 20, round: false },
      { id: "b1", t: "arrow", pts: [[60, 80], [60, 200]], stroke: "red", end: "triangle", text: "$F_g = mg$", size: 15 },
      { id: "b2", t: "arrow", pts: [[60, 0], [60, -120]], stroke: "blue", end: "triangle", text: "$F_N$", size: 15 },
      { id: "b3", t: "arrow", pts: [[120, 40], [240, 40]], stroke: "green", end: "triangle", text: "$F_{app}$", size: 15 },
      { id: "b4", t: "arrow", pts: [[0, 40], [-100, 40]], stroke: "orange", end: "triangle", text: "$F_f$", size: 15 },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  },
];
