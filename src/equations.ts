/** Equations for the calculator's Equations sidebar: a starter set, plus
 * the ones you save. Click one and its letters land in Variables — named
 * (h: height) and waiting for a number; fill them in and the answer is
 * worked out, live. */

export interface Equation {
  /** what it's for: Pyramid volume */
  name: string;
  /** as LaTeX: one letter on the left, worked out from the right */
  latex: string;
  /** what each letter is: { V: "volume", A: "base area", h: "height" } */
  labels?: Record<string, string>;
}

export const STARTER: { group: string; equations: Equation[] }[] = [
  {
    group: "Area & volume",
    equations: [
      { name: "Rectangle area", latex: "A = l \\cdot w", labels: { A: "area", l: "length", w: "width" } },
      { name: "Triangle area", latex: "A = \\frac{b \\cdot h}{2}", labels: { A: "area", b: "base", h: "height" } },
      { name: "Circle area", latex: "A = \\pi r^2", labels: { A: "area", r: "radius" } },
      { name: "Circumference", latex: "C = 2 \\pi r", labels: { C: "circumference", r: "radius" } },
      { name: "Box volume", latex: "V = l \\cdot w \\cdot h", labels: { V: "volume", l: "length", w: "width", h: "height" } },
      { name: "Pyramid volume", latex: "V = \\frac{A \\cdot h}{3}", labels: { V: "volume", A: "base area", h: "height" } },
      { name: "Cylinder volume", latex: "V = \\pi r^2 h", labels: { V: "volume", r: "radius", h: "height" } },
      { name: "Pythagorean theorem", latex: "c = \\sqrt{a^2 + b^2}", labels: { c: "long side", a: "side", b: "other side" } },
    ],
  },
  {
    group: "Rates & money",
    equations: [
      { name: "Distance", latex: "d = r \\cdot t", labels: { d: "distance", r: "rate", t: "time" } },
      { name: "Rate", latex: "r = \\frac{d}{t}", labels: { r: "rate", d: "distance", t: "time" } },
      { name: "Total cost", latex: "C = p \\cdot n", labels: { C: "total cost", p: "price each", n: "how many" } },
      { name: "Density", latex: "D = \\frac{m}{V}", labels: { D: "density", m: "mass", V: "volume" } },
      { name: "Simple interest", latex: "I = P \\cdot r \\cdot t", labels: { I: "interest", P: "principal", r: "rate", t: "years" } },
      { name: "Percent of", latex: "p = \\frac{r}{100} \\cdot w", labels: { p: "part", r: "percent", w: "whole" } },
    ],
  },
  {
    group: "Intercepts",
    equations: [
      { name: "x-intercept from a point", latex: "x\\text{-intercept} = x - \\frac{\\Delta x}{\\Delta y} \\times y", labels: { x: "a point's x", y: "its y", "\\Delta x": "change in x", "\\Delta y": "change in y" } },
      { name: "y-intercept from a point", latex: "y\\text{-intercept} = y - \\frac{\\Delta y}{\\Delta x} \\times x", labels: { x: "a point's x", y: "its y", "\\Delta x": "change in x", "\\Delta y": "change in y" } },
      { name: "x-intercept from the slope", latex: "x = -\\frac{b}{m}", labels: { x: "x-intercept", b: "y-intercept", m: "slope" } },
      { name: "y-intercept (b) from a point", latex: "b = y - m x", labels: { b: "y-intercept", y: "a point's y", m: "slope", x: "its x" } },
    ],
  },
  {
    group: "Lines & temperature",
    equations: [
      { name: "Slope-intercept", latex: "y = m x + b", labels: { y: "y", m: "slope", x: "x", b: "y-intercept" } },
      { name: "Slope", latex: "m = \\frac{y_2 - y_1}{x_2 - x_1}", labels: { m: "slope" } },
      { name: "°C to °F", latex: "F = \\frac{9}{5} C + 32", labels: { F: "°F", C: "°C" } },
      { name: "°F to °C", latex: "C = \\frac{5}{9} (F - 32)", labels: { C: "°C", F: "°F" } },
    ],
  },
  {
    group: "Electrical",
    equations: [
      { name: "Ohm's law", latex: "V = I \\cdot R", labels: { V: "volts", I: "amps", R: "ohms" } },
      { name: "Power", latex: "P = V \\cdot I", labels: { P: "watts", V: "volts", I: "amps" } },
      { name: "Power from current", latex: "P = I^2 R", labels: { P: "watts", I: "amps", R: "ohms" } },
      { name: "Charge", latex: "Q = I \\cdot t", labels: { Q: "coulombs", I: "amps", t: "seconds" } },
      { name: "Energy", latex: "E = P \\cdot t", labels: { E: "energy", P: "power", t: "time" } },
    ],
  },
];

/** the name an equation's workspace goes by: its name, or (one of yours) the
 * equation itself */
export const spaceName = (eq: Equation) => (eq.name.endsWith("…") ? eq.latex : eq.name);

/** each equation's own workspace: which have one, which is open, and how to
 * open one, start one over, or go back to Scratch */
export interface EquationSpaces {
  opened: string[];
  active: string | null;
  open: (name: string) => Promise<boolean>;
  forget: (name: string) => void;
  scratch: () => void;
}
