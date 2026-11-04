/** Long division and long multiplication, the way they're done on paper:
 * every step in order, what to say about it, and where each digit goes.
 * A step's `answer` is what the person writes (for "I'll do it"). */

export interface Mark {
  row: number;
  col: number;
  ch: string;
  /** the step that writes it */
  step: number;
  /** small (a carry), or part of a line drawn under a row */
  small?: boolean;
  /** gone from this step on (a carry once its row is done — crossed out, on paper) */
  until?: number;
}
export interface Step {
  say: string;
  /** what's written at this step, to type when practicing */
  answer?: string;
}
export interface Paper {
  marks: Mark[];
  /** lines under rows: [row, from col, to col, the step that draws it] */
  lines: [number, number, number, number][];
  steps: Step[];
  cols: number;
  rows: number;
  /** long division's bracket: the dividend's row and its first column */
  bracket?: { row: number; col: number; width: number };
  result: string;
}

const digits = (n: string) => n.replace(/\D/g, "");

// ---- long division

/** dividend ÷ divisor (whole numbers), on past the decimal point for `places` digits when it doesn't come out even */
export function longDivision(dividendText: string, divisor: number, places = 0): Paper | null {
  const D = digits(dividendText).replace(/^0+(?=\d)/, "");
  if (!D || !Number.isInteger(divisor) || divisor <= 0) return null;
  const marks: Mark[] = [];
  const lines: Paper["lines"] = [];
  const steps: Step[] = [];
  const dv = String(divisor);
  const lead = dv.length + 1; // the divisor and its ")" sit left of the dividend
  const col = (i: number) => lead + i;
  const say = (s: string, answer?: string) => (steps.push({ say: s, answer }), steps.length - 1);
  // the setup: the divisor, the bracket, the dividend
  const setup = say(`Write ${D} under the bracket and ${divisor} outside it.`);
  [...dv].forEach((ch, k) => marks.push({ row: 1, col: k, ch, step: setup }));
  [...D].forEach((ch, k) => marks.push({ row: 1, col: col(k), ch, step: setup }));
  let all = D;
  let i = 0;
  let current = 0;
  // the first chunk: enough leading digits for the divisor to go in
  while (i < all.length - 1 && current * 10 + Number(all[i]) < divisor) current = current * 10 + Number(all[i++]);
  current = current * 10 + Number(all[i]);
  if (i > 0) say(`${divisor} doesn't go into ${String(current).slice(0, -1) || 0}, so take one more digit: ${current}.`);
  let row = 2;
  let quotient = "";
  let decimal = -1; // where the decimal point went
  for (;;) {
    const q = Math.floor(current / divisor);
    const p = q * divisor;
    const r = current - p;
    quotient += String(q);
    const sq = say(`How many times does ${divisor} go into ${current}? ${q} time${q === 1 ? "" : "s"} (${divisor} × ${q} = ${p}${q < 9 && (q + 1) * divisor <= current + divisor ? `, ${divisor} × ${q + 1} = ${(q + 1) * divisor} is too much` : ""}). Write ${q} above.`, String(q));
    marks.push({ row: 0, col: col(i), ch: String(q), step: sq });
    const sp = say(`Multiply: ${q} × ${divisor} = ${p}. Write it under ${current}.`, String(p));
    [...String(p)].forEach((ch, k, a) => marks.push({ row, col: col(i) - (a.length - 1 - k), ch, step: sp }));
    const ss = say(`Subtract: ${current} − ${p} = ${r}.`, String(r));
    const width = Math.max(String(current).length, String(p).length);
    lines.push([row, col(i) - width + 1, col(i), ss]);
    [...String(r)].forEach((ch, k, a) => marks.push({ row: row + 1, col: col(i) - (a.length - 1 - k), ch, step: ss }));
    i++;
    if (i >= all.length) {
      // past the last digit: done — or on past the decimal point
      if (r === 0 || all.length - D.length >= places) {
        const rest = decimal < 0 && r ? ` remainder ${r}` : "";
        const shown = decimal < 0 ? quotient.replace(/^0+(?=\d)/, "") : `${quotient.slice(0, decimal).replace(/^0+(?=\d)/, "") || "0"}.${quotient.slice(decimal)}`;
        say(`Nothing left to bring down. ${D} ÷ ${divisor} = ${shown}${rest}.${rest ? ` (Or keep going past the decimal point.)` : ""}`);
        return finish(marks, lines, steps, row + 2, all.length, lead, D, `${shown}${rest}`);
      }
      if (decimal < 0) {
        decimal = quotient.length;
        const sd = say(`There's a remainder of ${r}. Put a decimal point after ${D} (and in the answer, right above it), and add a 0 to bring down.`);
        marks.push({ row: 1, col: col(all.length) - 0.5, ch: ".", step: sd });
        marks.push({ row: 0, col: col(all.length) - 0.5, ch: ".", step: sd });
      }
      all += "0";
      marks.push({ row: 1, col: col(all.length - 1), ch: "0", step: steps.length - 1 });
    }
    const sb = say(`Bring down the next digit, ${all[i]}: that makes ${r * 10 + Number(all[i])}.`, all[i]);
    marks.push({ row: row + 1, col: col(i), ch: all[i], step: sb });
    current = r * 10 + Number(all[i]);
    row += 2;
  }
}

function finish(marks: Mark[], lines: Paper["lines"], steps: Step[], rows: number, n: number, lead: number, D: string, result: string): Paper {
  return { marks, lines, steps, cols: lead + n + 1, rows, bracket: { row: 1, col: lead, width: n }, result: result || D };
}

// ---- long multiplication

export function longMultiplication(aText: string, bText: string): Paper | null {
  const a = digits(aText).replace(/^0+(?=\d)/, "");
  const b = digits(bText).replace(/^0+(?=\d)/, "");
  if (!a || !b) return null;
  const marks: Mark[] = [];
  const lines: Paper["lines"] = [];
  const steps: Step[] = [];
  const say = (s: string, answer?: string) => (steps.push({ say: s, answer }), steps.length - 1);
  const W = a.length + b.length + 1;
  const right = W - 1;
  // rows: 0 carries, 1 a, 2 × b, 3 the line, then a row for each digit of b, a line, the total
  const setup = say(`Write ${a} on top and ${b} under it, the last digits lined up.`);
  [...a].forEach((ch, k) => marks.push({ row: 1, col: right - (a.length - 1 - k), ch, step: setup }));
  [...b].forEach((ch, k) => marks.push({ row: 2, col: right - (b.length - 1 - k), ch, step: setup }));
  marks.push({ row: 2, col: right - b.length, ch: "×", step: setup });
  lines.push([2, right - Math.max(a.length, b.length), right, setup]);
  const partials: string[] = [];
  const top = b.length > 1 ? 4 : 3;
  for (let j = 0; j < b.length; j++) {
    const bd = Number(b[b.length - 1 - j]);
    const row = top + j;
    const carries: Mark[] = [];
    if (j > 0) {
      const sz = say(`Next digit of ${b}: ${bd}${j === 1 ? " (the tens)" : j === 2 ? " (the hundreds)" : ""}. Its row starts with ${j === 1 ? "a 0" : `${j} 0s`} on the right, a placeholder for its place value.`, "0".repeat(j));
      for (let z = 0; z < j; z++) marks.push({ row, col: right - z, ch: "0", step: sz });
    }
    let carry = 0;
    let line = "0".repeat(j);
    for (let i = 0; i < a.length; i++) {
      const ad = Number(a[a.length - 1 - i]);
      const prod = ad * bd + carry;
      const write = prod % 10;
      const next = Math.floor(prod / 10);
      const last = i === a.length - 1;
      const step = say(
        `${bd} × ${ad} = ${ad * bd}${carry ? `, plus the carried ${carry} = ${prod}` : ""}. ${last && next ? `It's the last digit: write all of ${prod}.` : `Write ${write}${next ? `, carry ${next}` : ""}.`}`,
        last && next ? String(prod) : String(write),
      );
      marks.push({ row, col: right - j - i, ch: String(write), step });
      if (last && next) marks.push({ row, col: right - j - i - 1, ch: String(next), step });
      else if (next) {
        const m: Mark = { row: 0, col: right - i - 1, ch: String(next), step, small: true };
        carries.push(m);
        marks.push(m);
      }
      line = (last && next ? String(prod) : String(write)) + line;
      carry = last ? 0 : next;
    }
    partials.push(line);
    // this row's carries are done with once it's written
    for (const m of carries) m.until = steps.length;
  }
  const total = (BigInt(a) * BigInt(b)).toString();
  if (b.length === 1) {
    say(`One digit to multiply by, so that's the answer: ${a} × ${b} = ${total}.`);
    return { marks, lines, steps, cols: W, rows: top + 1, result: total };
  }
  const sumRow = top + b.length;
  const sl = say(`Now add the rows. Draw a line under them and add each column, starting on the right.`);
  lines.push([sumRow - 1, right - Math.max(...partials.map((p) => p.length)) + 1, right, sl]);
  let carry = 0;
  const cols = Math.max(...partials.map((p) => p.length));
  for (let c = 0; c < cols; c++) {
    const ds = partials.map((p) => Number(p[p.length - 1 - c] ?? 0)).filter((_, k) => partials[k].length > c);
    const sum = ds.reduce((x, y) => x + y, 0) + carry;
    const last = c === cols - 1;
    const step = say(`${["Ones", "Tens", "Hundreds", "Thousands", "Ten-thousands"][c] ?? "Next"} column: ${ds.join(" + ")}${carry ? ` + carried ${carry}` : ""} = ${sum}. ${last ? `Write ${sum}.` : `Write ${sum % 10}${sum >= 10 ? `, carry ${Math.floor(sum / 10)}` : ""}.`}`, last ? String(sum) : String(sum % 10));
    if (last) [...String(sum)].forEach((ch, k, arr) => marks.push({ row: sumRow, col: right - c - (arr.length - 1 - k), ch, step }));
    else marks.push({ row: sumRow, col: right - c, ch: String(sum % 10), step });
    carry = last ? 0 : Math.floor(sum / 10);
    if (carry && !last) marks.push({ row: 3, col: right - c - 1, ch: String(carry), step, small: true });
  }
  say(`${a} × ${b} = ${total}.`);
  return { marks, lines, steps, cols: W, rows: sumRow + 1, result: total };
}
