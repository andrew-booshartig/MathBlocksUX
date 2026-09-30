/** A calculator with the TI-85's layout and home-screen behavior (our own
 * implementation — no TI firmware, no TI branding):
 *
 *   gray LCD, 8 lines × 21 characters · entries left, answers right
 *   F1–F5 menu keys with MORE / EXIT · 2nd (yellow) and ALPHA (blue)
 *   MATH (NUM PROB ANGLE HYP MISC) · TEST · MODE · STO► / RCL · ANS · ENTRY
 *   (-) for negatives · EE · overwrite editing, INS to insert · CLEAR
 *   an operator first uses Ans · ENTER on an empty line repeats the last one
 *   TI error screens with GOTO / QUIT
 *
 * The math (order of operations, 12-digit display, errors) is in the
 * engine: sidecar/mathcore/ti85.py. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  type CalculatorBlockData,
  DEFAULT_TI,
  type TIState,
  useStore,
  useVariables,
} from "../store";
import { mathRequest } from "../mathSidecar";
import katex from "katex";
import { CARET, entryTex, resultTex } from "./tiTex";

/** KaTeX for the LCD — trusted only for the cursor's \htmlClass. */
function LcdMath({ tex, className }: { tex: string; className?: string }) {
  // \displaystyle: full-size fractions, like Desmos / MathPrint
  const html = katex.renderToString(`\\displaystyle ${tex}`, {
    throwOnError: false,
    strict: "ignore",
    trust: (context) => context.command === "\\htmlClass",
  });
  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const COLS = 21;
const ROWS = 8;

type Shift = null | "2nd" | "alpha";

interface MenuItem {
  label: string;
  insert?: string;
  open?: string;
}

const MENUS: Record<string, MenuItem[]> = {
  MATH: [
    { label: "NUM", open: "NUM" },
    { label: "PROB", open: "PROB" },
    { label: "ANGLE", open: "ANGLE" },
    { label: "HYP", open: "HYP" },
    { label: "MISC", open: "MISC" },
  ],
  NUM: [
    { label: "round", insert: "round(" },
    { label: "iPart", insert: "iPart " },
    { label: "fPart", insert: "fPart " },
    { label: "int", insert: "int " },
    { label: "abs", insert: "abs " },
    { label: "sign", insert: "sign " },
    { label: "min", insert: "min(" },
    { label: "max", insert: "max(" },
    { label: "mod", insert: "mod(" },
  ],
  PROB: [
    { label: "!", insert: "!" },
    { label: "nPr", insert: " nPr " },
    { label: "nCr", insert: " nCr " },
    { label: "rand", insert: "rand" },
  ],
  ANGLE: [
    { label: "°", insert: "°" },
    { label: "r", insert: "ʳ" },
  ],
  HYP: [
    { label: "sinh", insert: "sinh " },
    { label: "cosh", insert: "cosh " },
    { label: "tanh", insert: "tanh " },
    { label: "sinh⁻¹", insert: "sinh⁻¹ " },
    { label: "cosh⁻¹", insert: "cosh⁻¹ " },
    { label: "tanh⁻¹", insert: "tanh⁻¹ " },
  ],
  MISC: [
    { label: "lcm", insert: "lcm(" },
    { label: "gcd", insert: "gcd(" },
    { label: "►Frac", insert: "►Frac" },
    { label: "%", insert: "%" },
    { label: "x√", insert: "x√" },
  ],
  TEST: [
    { label: "==", insert: "==" },
    { label: "<", insert: "<" },
    { label: ">", insert: ">" },
    { label: "≤", insert: "≤" },
    { label: "≥", insert: "≥" },
    { label: "≠", insert: "≠" },
  ],
};

/** Keys that continue from the last answer when pressed first (TI: Ans+). */
const CONTINUES = new Set([
  "+",
  "-",
  "*",
  "/",
  "^",
  "^(",
  "²",
  "⁻¹",
  "!",
  "%",
  "→",
  " nPr ",
  " nCr ",
  "x√",
  "►Frac",
]);

/** The fraction/template keys — not on a real TI-85 (fractions came with
 * later models), so a teacher can switch them off. They sit in the keypad
 * row where the TI-85's GRAPH/STAT/PRGM/CUSTOM keys were, two of them with
 * a 2nd function. Templates are fill-in-the-blank: the cursor lands in the
 * first blank, → jumps to the next. */
const EXTRAS: {
  id: string;
  label: string;
  tex?: boolean;
  title: string;
  template?: string[];
  cursor?: number;
  insert?: string;
}[] = [
  {
    id: "X-FRAC",
    label: "\\dfrac{\\square}{\\square}",
    tex: true,
    title: "Fraction — type the top, → for the bottom, → again to step out",
    template: ["⁽(", ")/(", ")⁾"],
    cursor: 1,
  },
  {
    id: "X-TOFRAC",
    label: "►Frac",
    title: "Show the answer as a fraction",
    insert: "►Frac",
  },
  {
    id: "X-FRACMODE",
    label: "a/b⇄.5",
    title: "Answers as fractions (when there's a clean one) or decimals",
  },
  {
    id: "X-POW",
    label: "\\square^{n}",
    tex: true,
    title: "Power — type the exponent, → to step out",
    template: ["^(", ")"],
    cursor: 1,
  },
  {
    id: "X-ROOT",
    label: "\\sqrt[n]{\\square}",
    tex: true,
    title: "nth root — type n, → then the number",
    template: ["(", ")x√(", ")"],
    cursor: 1,
  },
  {
    id: "X-ABS",
    label: "|\\square|",
    tex: true,
    title: "Absolute value",
    template: ["abs(", ")"],
    cursor: 1,
  },
];

/** The keypad, row by row: [id, main label, 2nd label, alpha letter]. */
type KeySpec = [string, string, string?, string?];
const KEYS: KeySpec[][] = [
  [
    ["F1", "F1"],
    ["F2", "F2"],
    ["F3", "F3"],
    ["F4", "F4"],
    ["F5", "F5"],
  ],
  [
    ["2nd", "2nd"],
    ["EXIT", "EXIT", "QUIT"],
    ["MORE", "MORE", "MODE"],
  ],
  [
    ["ALPHA", "ALPHA"],
    ["XVAR", "x-VAR"],
    ["DEL", "DEL", "INS"],
  ],
  [
    ["X-FRAC", "n/d", "►Frac"],
    ["X-FRACMODE", "F⇄D"],
    ["X-POW", "xⁿ", "ⁿ√"],
    ["X-ABS", "|x|"],
    ["CLEAR", "CLEAR"],
  ],
  [
    ["LOG", "LOG", "10ˣ", "A"],
    ["SIN", "SIN", "SIN⁻¹", "B"],
    ["COS", "COS", "COS⁻¹", "C"],
    ["TAN", "TAN", "TAN⁻¹", "D"],
    ["^", "^", "π", "E"],
  ],
  [
    ["LN", "LN", "eˣ", "F"],
    ["EE", "EE", "x⁻¹", "G"],
    ["(", "(", undefined, "H"],
    [")", ")", undefined, "I"],
    ["÷", "÷", undefined, "J"],
  ],
  [
    ["x²", "x²", "√", "K"],
    ["7", "7", undefined, "L"],
    ["8", "8", undefined, "M"],
    ["9", "9", undefined, "N"],
    ["×", "×", "MATH", "O"],
  ],
  [
    [",", ",", undefined, "P"],
    ["4", "4", undefined, "Q"],
    ["5", "5", undefined, "R"],
    ["6", "6", undefined, "S"],
    ["−", "−", "TEST", "T"],
  ],
  [
    ["STO", "STO►", "RCL", "="],
    ["1", "1", undefined, "U"],
    ["2", "2", undefined, "V"],
    ["3", "3", undefined, "W"],
    ["+", "+", undefined, "X"],
  ],
  [
    ["ON", "ON", "OFF"],
    ["0", "0", undefined, "Y"],
    [".", ".", undefined, "Z"],
    ["NEG", "(−)", "ANS", "␣"],
    ["ENTER", "ENTER", "ENTRY"],
  ],
];

/** What a key types (primary, then 2nd). */
const TYPES: Record<string, [string?, string?]> = {
  LOG: ["log ", "10^"],
  SIN: ["sin ", "sin⁻¹ "],
  COS: ["cos ", "cos⁻¹ "],
  TAN: ["tan ", "tan⁻¹ "],
  "^": ["^", "π"],
  LN: ["ln ", "ℯ^"],
  EE: ["ᴇ", "⁻¹"],
  "(": ["("],
  ")": [")"],
  "÷": ["/"],
  "x²": ["²", "√"],
  "×": ["*"],
  ",": [","],
  "−": ["-"],
  "+": ["+"],
  ".": ["."],
  NEG: ["⁻", "Ans"],
  XVAR: ["x"],
  ...Object.fromEntries("0123456789".split("").map((d) => [d, [d]])),
};

const MODE_ROWS: { items: string[]; active: boolean }[] = [
  { items: ["Normal", "Sci", "Eng"], active: true },
  {
    items: [
      "Float",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "1",
    ],
    active: true,
  },
  { items: ["Radian", "Degree"], active: true },
];

/** The classic screen shows the fraction key's sealed brackets ⁽ ⁾ as ( ). */
const plainBrackets = (s: string) => s.replace(/⁽/g, "(").replace(/⁾/g, ")");

function wrap(text: string): string[] {
  if (!text) return [""];
  const rows = [];
  for (let i = 0; i < text.length; i += COLS)
    rows.push(text.slice(i, i + COLS));
  return rows;
}

interface Row {
  text: string;
  right?: boolean;
  cursorAt?: number;
  kind?: "entry" | "result" | "error";
}

export default function TI85({ data }: { data: CalculatorBlockData }) {
  const updateBlock = useStore(
    (state) => state.updateBlock<CalculatorBlockData>,
  );
  const pool = useVariables();
  const ti: TIState = { ...DEFAULT_TI, ...(data.ti ?? {}) };
  const save = (patch: Partial<TIState>) =>
    updateBlock(data.id, { ti: { ...ti, ...patch } });

  const [tokens, setTokens] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [shift, setShift] = useState<Shift>(null);
  const [alphaLock, setAlphaLock] = useState(false);
  const [insertMode, setInsertMode] = useState(false);
  const [menu, setMenu] = useState<{ stack: string[]; page: number } | null>(
    null,
  );
  const [screen, setScreen] = useState<"home" | "mode" | "off">("home");
  const [modeAt, setModeAt] = useState({ row: 0, col: 0 });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // a click anywhere on the block — its header, its border, the space
  // around the calculator — puts the cursor in the calculator (otherwise
  // the block itself takes focus and the cursor stays dim, which looks like
  // the click didn't take). Settings fields keep their own clicks.
  useEffect(() => {
    const node = root.current?.closest(".react-flow__node");
    if (!node) return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement;
      if (root.current?.contains(target) || target.closest("input, textarea, select, label, .calc-settings")) return;
      requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
    };
    node.addEventListener("pointerdown", onDown);
    return () => node.removeEventListener("pointerdown", onDown);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(timer);
  }, [flash]);

  // ------------------------------------------------------------ editing

  const insert = (tok: string) => {
    setError(null);
    let next = tokens;
    let at = cursor;
    if (next.length === 0 && CONTINUES.has(tok) && ti.lines.length) {
      next = ["Ans"];
      at = 1;
    }
    if (!insertMode && at < next.length) {
      next = [...next.slice(0, at), tok, ...next.slice(at + 1)]; // TI-85 overwrites by default
    } else {
      next = [...next.slice(0, at), tok, ...next.slice(at)];
    }
    setTokens(next);
    setCursor(at + 1);
  };

  /** Drop in a fill-in template and put the cursor in its first blank
   * (insert mode, so typing fills the blank instead of overwriting it). */
  const insertTemplate = (template: string[], offset: number) => {
    setError(null);
    let next = tokens;
    let at = cursor;
    if (next.length === 0 && CONTINUES.has(template[0]) && ti.lines.length) {
      next = ["Ans"];
      at = 1;
    }
    setTokens([...next.slice(0, at), ...template, ...next.slice(at)]);
    setCursor(at + offset);
    setInsertMode(true);
  };

  const erase = (backwards: boolean) => {
    if (!tokens.length) return;
    const at = backwards || cursor >= tokens.length ? cursor - 1 : cursor;
    if (at < 0) return;
    setTokens([...tokens.slice(0, at), ...tokens.slice(at + 1)]);
    setCursor(at);
  };

  const evaluate = async () => {
    const entryTokens = tokens.length ? tokens : ti.lastEntry;
    const entry = entryTokens.join("");
    if (!entry.trim() || busy) return;
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(pool))
      if (v.trim() !== "" && Number.isFinite(Number(v))) vars[k] = v;
    Object.assign(vars, ti.vars);
    setBusy(true);
    try {
      const r = await mathRequest<{
        result: string;
        value: string;
        store: string | null;
      }>({
        op: "ti",
        entry,
        ans: ti.ans,
        vars,
        mode: { angle: data.angle, format: ti.format, digits: ti.digits },
        frac_auto: !!ti.fracAnswers,
      });
      save({
        lines: [...ti.lines.slice(-40), { entry, result: r.result }],
        ans: r.value,
        vars: r.store ? { ...ti.vars, [r.store]: r.value } : ti.vars,
        shown: r.store
          ? { ...(ti.shown ?? {}), [r.store]: r.result }
          : ti.shown,
        lastEntry: entryTokens,
      });
      setTokens([]);
      setCursor(0);
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setMenu(null);
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ menus

  const current = menu ? (MENUS[menu.stack[menu.stack.length - 1]] ?? []) : [];
  const page = menu ? current.slice(menu.page * 5, menu.page * 5 + 5) : [];

  const openMenu = (id: string) => setMenu({ stack: [id], page: 0 });

  const choose = (slot: number) => {
    if (error) {
      if (slot === 0) setError(null); // GOTO: back to the entry, as typed
      if (slot === 4) {
        setError(null);
        setTokens([]);
        setCursor(0);
      }
      return;
    }
    if (menu?.stack[0] === "RCL") {
      const name = Object.keys(ti.vars)[menu.page * 5 + slot];
      if (name) {
        // RCL types the value in, as the screen shows it
        insert((ti.shown?.[name] ?? "0").replace(/E/g, "ᴇ"));
        setMenu(null);
      }
      return;
    }
    const item = page[slot];
    if (!item) return;
    if (item.open) setMenu({ stack: [menu!.stack[0], item.open], page: 0 });
    else if (item.insert) insert(item.insert);
  };

  // ------------------------------------------------------------ keys

  const press = (id: string) => {
    setPressed(id);
    setTimeout(() => setPressed((p) => (p === id ? null : p)), 110);
    const s = shift;
    if (id !== "2nd" && id !== "ALPHA") setShift(alphaLock ? "alpha" : null);

    if (screen === "off") {
      if (id === "ON") setScreen("home");
      return;
    }
    if (id === "ON") {
      if (s === "2nd") return setScreen("off");
      setError(null);
      setMenu(null);
      setScreen("home");
      return;
    }
    if (id === "2nd") return setShift(s === "2nd" ? null : "2nd");
    if (id === "ALPHA") {
      if (s === "alpha" && !alphaLock) {
        setAlphaLock(true);
        return setShift("alpha");
      }
      setAlphaLock(false);
      return setShift(s === "alpha" ? null : "alpha");
    }

    if (screen === "mode") return pressMode(id, s);

    // 2nd n/d = ►Frac, 2nd xⁿ = ⁿ√
    const extraId = s === "2nd" ? ({ "X-FRAC": "X-TOFRAC", "X-POW": "X-ROOT" } as Record<string, string>)[id] ?? id : id;
    const extra = EXTRAS.find((x) => x.id === extraId);
    if (extra) {
      if (data.tiExtras === false) return setFlash("Fraction keys are off");
      if (error) return;
      if (extraId === "X-FRACMODE") {
        save({ fracAnswers: !ti.fracAnswers });
        return setFlash(
          ti.fracAnswers ? "Answers: decimals" : "Answers: fractions",
        );
      }
      if (extra.template)
        return insertTemplate(extra.template, extra.cursor ?? 1);
      if (extra.insert) return insert(extra.insert);
    }

    if (/^F[1-5]$/.test(id)) return choose(Number(id[1]) - 1);
    if (id === "EXIT") {
      if (s === "2nd" || !menu)
        setMenu(null); // QUIT
      else
        setMenu(
          menu.stack.length > 1
            ? { stack: menu.stack.slice(0, -1), page: 0 }
            : null,
        );
      return;
    }
    if (id === "MORE") {
      if (s === "2nd") {
        setMenu(null);
        return setScreen("mode");
      }
      if (menu)
        setMenu({
          ...menu,
          page:
            (menu.page + 1) * 5 <
            (menu.stack[0] === "RCL"
              ? Object.keys(ti.vars).length
              : current.length)
              ? menu.page + 1
              : 0,
        });
      return;
    }
    if (error && !["LEFT", "RIGHT", "UP", "DOWN"].includes(id)) return; // choose GOTO or QUIT first
    if (id === "DEL")
      return s === "2nd" ? setInsertMode(!insertMode) : erase(false);
    if (id === "CLEAR") {
      if (tokens.length) {
        setTokens([]);
        setCursor(0);
      } else save({ lines: [] });
      return;
    }
    if (id === "LEFT")
      return setCursor(s === "2nd" ? 0 : Math.max(0, cursor - 1));
    if (id === "RIGHT")
      return setCursor(
        s === "2nd" ? tokens.length : Math.min(tokens.length, cursor + 1),
      );
    if (id === "UP") return setCursor(Math.max(0, cursor - COLS));
    if (id === "DOWN") return setCursor(Math.min(tokens.length, cursor + COLS));
    if (id === "ENTER") {
      if (s === "2nd") {
        setTokens(ti.lastEntry);
        setCursor(ti.lastEntry.length);
        return;
      }
      return evaluate();
    }
    if (id === "STO") {
      if (s === "2nd") {
        if (!Object.keys(ti.vars).length)
          return setFlash("RCL: nothing stored yet");
        return setMenu({ stack: ["RCL"], page: 0 });
      }
      insert("→");
      setAlphaLock(false);
      return setShift("alpha"); // like a TI, STO► turns ALPHA on for the name
    }
    if (s === "2nd" && id === "×") return openMenu("MATH");
    if (s === "2nd" && id === "−") return openMenu("TEST");
    if (s === "alpha") {
      const spec = KEYS.flat().find((k) => k[0] === id);
      const letter = spec?.[3];
      if (letter) return insert(letter === "␣" ? " " : letter);
    }
    const typed = TYPES[id];
    if (typed) {
      const tok = s === "2nd" ? typed[1] : typed[0];
      if (tok) insert(tok);
    }
  };

  const pressMode = (id: string, s: Shift) => {
    const rows = MODE_ROWS;
    if (id === "EXIT" || id === "CLEAR" || (s === "2nd" && id === "MORE"))
      return setScreen("home");
    if (id === "UP")
      return setModeAt(({ row }) => ({ row: Math.max(0, row - 1), col: 0 }));
    if (id === "DOWN")
      return setModeAt(({ row }) => ({ row: Math.min(2, row + 1), col: 0 }));
    if (id === "LEFT")
      return setModeAt(({ row, col }) => ({ row, col: Math.max(0, col - 1) }));
    if (id === "RIGHT")
      return setModeAt(({ row, col }) => ({
        row,
        col: Math.min(rows[row].items.length - 1, col + 1),
      }));
    if (id === "ENTER") return selectMode(modeAt.row, modeAt.col);
  };

  const selectMode = (row: number, col: number) => {
    setModeAt({ row, col });
    if (row === 0) save({ format: (["normal", "sci", "eng"] as const)[col] });
    if (row === 1) save({ digits: col === 0 ? null : col - 1 });
    if (row === 2) {
      if (data.locked) return setFlash("Angle locked by teacher");
      updateBlock(data.id, { angle: col === 0 ? "rad" : "deg" });
    }
  };

  const modeSelected = (row: number, col: number) => {
    if (row === 0) return ["normal", "sci", "eng"].indexOf(ti.format) === col;
    if (row === 1)
      return ti.digits === null ? col === 0 : col === ti.digits + 1;
    if (row === 2) return (data.angle === "rad" ? 0 : 1) === col;
    return col === 0;
  };

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map: Record<string, string> = {
      Enter: "ENTER",
      Escape: "CLEAR",
      Delete: "DEL",
      ArrowLeft: "LEFT",
      ArrowRight: "RIGHT",
      ArrowUp: "UP",
      ArrowDown: "DOWN",
      "+": "+",
      "*": "×",
      "/": "÷",
      "^": "^",
      "(": "(",
      ")": ")",
      ",": ",",
      ".": ".",
    };
    let handled = true;
    if (e.key === "Backspace") erase(true);
    else if (e.key === "-") {
      // from a keyboard, "-" means negation where a value is expected
      const prev = tokens[cursor - 1];
      if (!prev || /[-+*/^(,→=<>≤≥≠⁻]$/.test(prev)) insert("⁻");
      else press("−");
    } else if (map[e.key]) press(map[e.key]);
    else if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (/^[A-Za-z!%]$/.test(e.key)) insert(e.key);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ------------------------------------------------------------ screen

  const entryText = tokens.join("");
  const cursorChar = tokens.slice(0, cursor).join("").length;
  const rows: Row[] = [];
  if (screen === "home") {
    for (const line of ti.lines) {
      wrap(plainBrackets(line.entry)).forEach((t) =>
        rows.push({ text: t, kind: "entry" }),
      );
      wrap(line.result).forEach((t) =>
        rows.push({ text: t, right: true, kind: "result" }),
      );
    }
    if (error) {
      rows.push({ text: error.slice(0, COLS), kind: "error" });
      if (error.length > COLS)
        rows.push({ text: error.slice(COLS), kind: "error" });
    } else {
      const entryRows = wrap(plainBrackets(entryText));
      const cursorRow = Math.floor(cursorChar / COLS);
      if (cursorRow >= entryRows.length) entryRows.push(""); // cursor just past a full row
      entryRows.forEach((t, k) =>
        rows.push({
          text: t,
          cursorAt: k === cursorRow ? cursorChar - k * COLS : undefined,
          kind: "entry",
        }),
      );
    }
  }

  let menuRows: { items: string[]; selected?: number }[] = [];
  if (error) menuRows = [{ items: ["GOTO", "", "", "", "QUIT"] }];
  else if (menu?.stack[0] === "RCL")
    menuRows = [
      { items: Object.keys(ti.vars).slice(menu.page * 5, menu.page * 5 + 5) },
    ];
  else if (menu) {
    if (menu.stack.length > 1) {
      const parent = MENUS[menu.stack[0]];
      menuRows.push({
        items: parent.map((i) => i.label),
        selected: parent.findIndex((i) => i.open === menu.stack[1]),
      });
    }
    menuRows.push({ items: page.map((i) => i.label) });
  }
  const textRows = ROWS - menuRows.length - (flash ? 1 : 0);
  const visible = rows.slice(-textRows);
  while (visible.length < textRows) visible.push({ text: "" });

  // MathPrint: history and the line being typed, drawn as real math
  const pretty = data.tiPretty !== false;
  const caretText =
    entryText.slice(0, cursorChar) + CARET + entryText.slice(cursorChar);

  const cursorClass = `ti-cursor${shift === "2nd" ? " is-2nd" : shift === "alpha" ? " is-alpha" : ""}${insertMode ? " is-insert" : ""}`;

  return (
    <div
      className="ti85 nodrag nokey"
      ref={root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={() => root.current?.focus()}
    >
      <div className="ti-bezel">
        <div
          className={`ti-lcd${screen === "off" ? " is-off" : ""}${pretty && screen === "home" ? " is-pretty" : ""}${shift ? ` is-${shift}` : ""}${insertMode ? " is-insert" : ""}`}
        >
          {screen === "mode" &&
            MODE_ROWS.map((r, row) => (
              <div
                key={row}
                className={`ti-row ti-mode-row${r.active ? "" : " is-dim"}`}
              >
                {r.items.map((item, col) => (
                  <span
                    key={col}
                    className={`ti-mode-item${modeSelected(row, col) ? " is-on" : ""}${modeAt.row === row && modeAt.col === col && r.active ? " is-focus" : ""}`}
                    onClick={() => r.active && selectMode(row, col)}
                  >
                    {item}
                  </span>
                ))}
              </div>
            ))}
          {screen === "home" && pretty && (
            <div className="ti-pretty-history">
              {ti.lines.slice(-12).map((line, k) => (
                <div key={k} className="ti-pretty-line">
                  <LcdMath
                    className="ti-pretty-entry"
                    tex={entryTex(line.entry)}
                  />
                  <LcdMath
                    className="ti-pretty-result"
                    tex={resultTex(line.result)}
                  />
                </div>
              ))}
              {error ? (
                <div className="ti-row is-error">{error}</div>
              ) : (
                <LcdMath
                  className="ti-pretty-entry is-current"
                  tex={entryTex(caretText)}
                />
              )}
            </div>
          )}
          {screen === "home" &&
            !pretty &&
            visible.map((r, k) => (
              <div
                key={k}
                className={`ti-row${r.right ? " is-right" : ""}${r.kind === "error" ? " is-error" : ""}`}
              >
                {r.cursorAt === undefined ? (
                  r.text || " "
                ) : (
                  <>
                    {r.text.slice(0, r.cursorAt)}
                    <span className={cursorClass}>
                      {r.text[r.cursorAt] ?? " "}
                    </span>
                    {r.text.slice(r.cursorAt + 1)}
                  </>
                )}
              </div>
            ))}
          {screen === "home" && flash && (
            <div className="ti-row ti-flash">{flash.slice(0, COLS)}</div>
          )}
          {screen === "home" &&
            menuRows.map((m, k) => (
              <div key={k} className="ti-menu">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`ti-menu-item${m.items[i] ? "" : " is-empty"}${m.selected === i ? " is-selected" : ""}`}
                  >
                    {m.items[i] ?? ""}
                  </span>
                ))}
              </div>
            ))}
        </div>
      </div>

      <div className="ti-keys">
        {renderRow(KEYS[0], "is-fkeys")}
        {/* 2nd EXIT MORE / ALPHA x-VAR DEL, with the round cursor pad beside them */}
        <div className="ti-upper">
          <div className="ti-upper-keys">
            {renderRow(KEYS[1])}
            {renderRow(KEYS[2])}
          </div>
          <div className="ti-pad-col">
            <div className="ti-pad">
              {(
                [
                  ["UP", "▲"],
                  ["LEFT", "◀"],
                  ["RIGHT", "▶"],
                  ["DOWN", "▼"],
                ] as const
              ).map(([id, glyph]) => (
                <button
                  key={id}
                  className={`ti-pad-key is-${id.toLowerCase()}${pressed === id ? " is-pressed" : ""}`}
                  {...keyHandlers(id)}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </div>
        </div>
        {KEYS.slice(3).map((row, r) => renderRow(row, "", r))}
      </div>
    </div>
  );

  /** Keys act on press (pointer-down), like a real calculator — and so the
   * first tap on an unselected block isn't swallowed by the canvas
   * selecting it. Enter/Space on a focused key still work. */
  function keyHandlers(id: string) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        root.current?.focus();
        press(id);
      },
      onClick: (e: React.MouseEvent) => {
        if (e.detail === 0) press(id); // keyboard activation only
      },
    };
  }

  function renderRow(row: KeySpec[], className = "", key?: number) {
    return (
      <div key={key ?? row[0][0]} className={`ti-key-row ${className}`}>
        {row.map(([id, label, second, alpha]) => (
          <div key={id} className="ti-key-cell">
            <div className="ti-key-labels">
              <span className="ti-2nd-label">{second ?? ""}</span>
              <span className="ti-alpha-label">{alpha ?? ""}</span>
            </div>
            <button
              className={[
                "ti-key",
                `k-${id === "2nd" ? "second" : id === "ALPHA" ? "alpha" : /^F[1-5]$/.test(id) ? "fkey" : /^[0-9.]$|^NEG$/.test(id) ? "num" : "fn"}`,
                id === "2nd" && shift === "2nd" && "is-on",
                id === "ALPHA" && shift === "alpha" && "is-on",
                id === "X-FRACMODE" && ti.fracAnswers && "is-lit",
                id.startsWith("X-") && data.tiExtras === false && "is-off",
                pressed === id && "is-pressed",
              ]
                .filter(Boolean)
                .join(" ")}
              title={EXTRAS.find((x) => x.id === id)?.title}
              {...keyHandlers(id)}
            >
              {label}
            </button>
          </div>
        ))}
      </div>
    );
  }
}
