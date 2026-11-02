/** The NEC's numbers the Electrical tools work from (the 2023 edition).
 * These are the tables' values only — the code's text is NFPA's — each
 * with the section it's from. The code book, and the local inspector (the
 * AHJ), have the final word. */

export const EDITION = "NEC 2023";

/** conductor sizes, smallest to largest (AWG, then kcmil) */
export const SIZES = ["14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0", "250", "300", "350", "400", "500", "600", "750", "1000"] as const;
export type Size = (typeof SIZES)[number];
export const sizeLabel = (s: Size) => (Number(s) >= 250 ? `${s} kcmil` : `${s} AWG`);

export type Metal = "cu" | "al";
export type TempRating = 60 | 75 | 90;

/** 310.16: allowable ampacity, not more than 3 current-carrying conductors, 30 °C ambient — [60, 75, 90] °C */
export const AMPACITY: Record<Metal, Partial<Record<Size, [number, number, number]>>> = {
  cu: {
    "14": [15, 20, 25], "12": [20, 25, 30], "10": [30, 35, 40], "8": [40, 50, 55], "6": [55, 65, 75], "4": [70, 85, 95], "3": [85, 100, 115],
    "2": [95, 115, 130], "1": [110, 130, 145], "1/0": [125, 150, 170], "2/0": [145, 175, 195], "3/0": [165, 200, 225], "4/0": [195, 230, 260],
    "250": [215, 255, 290], "300": [240, 285, 320], "350": [260, 310, 350], "400": [280, 335, 380], "500": [320, 380, 430],
    "600": [350, 420, 475], "750": [400, 475, 535], "1000": [455, 545, 615],
  },
  al: {
    "12": [15, 20, 25], "10": [25, 30, 35], "8": [35, 40, 45], "6": [40, 50, 55], "4": [55, 65, 75], "3": [65, 75, 85],
    "2": [75, 90, 100], "1": [85, 100, 115], "1/0": [100, 120, 135], "2/0": [115, 135, 150], "3/0": [130, 155, 175], "4/0": [150, 180, 205],
    "250": [170, 205, 230], "300": [195, 230, 260], "350": [210, 250, 280], "400": [225, 270, 305], "500": [260, 310, 350],
    "600": [285, 340, 385], "750": [320, 385, 435], "1000": [375, 445, 500],
  },
};

/** 240.4(D): the most a small conductor's overcurrent protection can be */
export const SMALL_OCPD: Record<Metal, Partial<Record<Size, number>>> = {
  cu: { "14": 15, "12": 20, "10": 30 },
  al: { "12": 15, "10": 25 },
};

/** 310.15(B)(1): ambient temperature correction (30 °C base) — up to this °C: [60, 75, 90] °C columns (0: not allowed) */
export const AMBIENT: [number, number, number, number][] = [
  [10, 1.29, 1.2, 1.15], [15, 1.22, 1.15, 1.12], [20, 1.15, 1.11, 1.08], [25, 1.08, 1.05, 1.04], [30, 1, 1, 1],
  [35, 0.91, 0.94, 0.96], [40, 0.82, 0.88, 0.91], [45, 0.71, 0.82, 0.87], [50, 0.58, 0.75, 0.82], [55, 0.41, 0.67, 0.76],
  [60, 0, 0.58, 0.71], [65, 0, 0.47, 0.65], [70, 0, 0.33, 0.58], [75, 0, 0, 0.5], [80, 0, 0, 0.41], [85, 0, 0, 0.29],
];

/** 310.15(C)(1): more than three current-carrying conductors together — up to this many: the factor */
export const BUNDLED: [number, number][] = [
  [3, 1], [6, 0.8], [9, 0.7], [20, 0.5], [30, 0.45], [40, 0.4], [Infinity, 0.35],
];

/** Chapter 9 Table 8: DC resistance, ohms per 1000 ft at 75 °C, uncoated copper / aluminum */
export const RESISTANCE: Record<Metal, Partial<Record<Size, number>>> = {
  cu: {
    "14": 3.07, "12": 1.93, "10": 1.21, "8": 0.764, "6": 0.491, "4": 0.308, "3": 0.245, "2": 0.194, "1": 0.154, "1/0": 0.122, "2/0": 0.0967,
    "3/0": 0.0766, "4/0": 0.0608, "250": 0.0515, "300": 0.0429, "350": 0.0367, "400": 0.0321, "500": 0.0258, "600": 0.0214, "750": 0.0171, "1000": 0.0129,
  },
  al: {
    "12": 3.18, "10": 2.0, "8": 1.26, "6": 0.808, "4": 0.508, "3": 0.403, "2": 0.319, "1": 0.253, "1/0": 0.201, "2/0": 0.159,
    "3/0": 0.126, "4/0": 0.1, "250": 0.0847, "300": 0.0707, "350": 0.0605, "400": 0.0529, "500": 0.0424, "600": 0.0353, "750": 0.0282, "1000": 0.0212,
  },
};

/** Chapter 9 Table 4: raceway trade sizes, smallest first, and their whole inside area (in²) */
const TRADE = ["1/2", "3/4", "1", "1-1/4", "1-1/2", "2", "2-1/2", "3", "3-1/2", "4"];
const sized = (areas: number[]) => TRADE.map((t, k) => [t, areas[k]] as [string, number]);
export const RACEWAYS = {
  EMT: sized([0.304, 0.533, 0.864, 1.496, 2.036, 3.356, 5.858, 8.846, 11.545, 14.753]),
  "PVC 40": sized([0.285, 0.508, 0.832, 1.453, 1.986, 3.291, 4.695, 7.268, 9.737, 12.554]),
  RMC: sized([0.314, 0.549, 0.887, 1.526, 2.071, 3.408, 4.866, 7.499, 10.01, 12.882]),
};
export type Raceway = keyof typeof RACEWAYS;

/** Chapter 9 Table 5: a conductor's area with its insulation (in²) */
export const CONDUCTOR_AREA: Record<string, Partial<Record<Size, number>>> = {
  "THHN/THWN-2": {
    "14": 0.0097, "12": 0.0133, "10": 0.0211, "8": 0.0366, "6": 0.0507, "4": 0.0824, "3": 0.0973, "2": 0.1158, "1": 0.1562, "1/0": 0.1855, "2/0": 0.2223,
    "3/0": 0.2679, "4/0": 0.3237, "250": 0.397, "300": 0.4608, "350": 0.5242, "400": 0.5863, "500": 0.7073, "600": 0.8676, "750": 1.0496, "1000": 1.3478,
  },
  "XHHW-2": {
    "14": 0.0139, "12": 0.0181, "10": 0.0243, "8": 0.0437, "6": 0.059, "4": 0.0814, "3": 0.0962, "2": 0.1146, "1": 0.1534, "1/0": 0.1825, "2/0": 0.219,
    "3/0": 0.2642, "4/0": 0.3197, "250": 0.3904, "300": 0.4536, "350": 0.5166, "400": 0.5782, "500": 0.6984, "600": 0.8709, "750": 1.0532, "1000": 1.3561,
  },
};

/** Chapter 9 Table 1: how much of a raceway its conductors may fill — 1, 2, more */
export const FILL = { one: 0.53, two: 0.31, more: 0.4 };

/** 314.16(B): volume each conductor counts for in a box (in³), by size */
export const BOX_ALLOWANCE: Partial<Record<Size | "18" | "16", number>> = { "18": 1.5, "16": 1.75, "14": 2, "12": 2.25, "10": 2.5, "8": 3, "6": 5 };

/** 314.16(A): common boxes and their volume (in³) */
export const BOXES: [string, number][] = [
  ["Device 3×2×2½", 12.5],
  ["Device 3×2×2¾", 14],
  ["Device 3×2×3½", 18],
  ["4″ octagon × 1½", 15.5],
  ["4″ octagon × 2⅛", 21.5],
  ["4″ square × 1½", 21],
  ["4″ square × 2⅛", 30.3],
  ["4¹¹⁄₁₆″ square × 1½", 29.5],
  ["4¹¹⁄₁₆″ square × 2⅛", 42],
];

/** 230.79 and 240.6(A): service sizes (amps) a dwelling's load is rounded up to (100 A the least for a one-family dwelling) */
export const SERVICE_SIZES = [100, 125, 150, 200, 225, 300, 400, 600, 800];
