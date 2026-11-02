// ```chem cells. Each line is a formula — its molar mass — or a reaction
// (with -> or →) — whether it's balanced. Lines starting with # are notes.
const MASS = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
  Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71,
  Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24,
  Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05,
  Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04, Pa: 231.04, U: 238.03,
};

/** "Ca(OH)2" → { Ca: 1, O: 2, H: 2 } */
function atoms(formula) {
  const counts = {};
  const add = (into, from, times) => {
    for (const [el, n] of Object.entries(from)) into[el] = (into[el] ?? 0) + n * times;
  };
  // a hydrate's parts, each with its own count in front: CuSO4·5H2O
  for (const part of formula.split(/[·*.]/)) {
    const lead = part.trim().match(/^(\d+)\s*(.*)$/);
    const times = lead ? Number(lead[1]) : 1;
    const text = lead ? lead[2] : part.trim();
    let i = 0;
    const group = () => {
      const here = {};
      while (i < text.length) {
        const c = text[i];
        if (c === "(" || c === "[") {
          i++;
          const inner = group();
          i++; // the closing bracket
          add(here, inner, number());
        } else if (c === ")" || c === "]") break;
        else if (/[A-Z]/.test(c)) {
          let el = c;
          i++;
          if (/[a-z]/.test(text[i] ?? "")) el += text[i++];
          if (!(el in MASS)) throw new Error(`there's no element ${el}`);
          add(here, { [el]: 1 }, number());
        } else if (c === " ") i++;
        else throw new Error(`what's "${c}" doing in ${formula}?`);
      }
      return here;
    };
    const number = () => {
      const m = text.slice(i).match(/^\d+/);
      if (!m) return 1;
      i += m[0].length;
      return Number(m[0]);
    };
    add(counts, group(), times);
  }
  return counts;
}

/** "CuSO4·5H2O" → its LaTeX, numbers made small */
const tex = (formula) => `\\mathrm{${formula.trim().replace(/[·*]/g, "\\cdot ").replace(/([A-Za-z)\]])(\d+)/g, "$1_{$2}")}}`;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export function activate(matrixlab) {
  const round = (x) => {
    const places = Math.max(0, Math.min(8, Number(matrixlab.settings.get("places")) || 3));
    return x.toFixed(places);
  };
  /** one side of a reaction: "2H2 + O2" → its atoms, counted */
  const side = (text) => {
    const total = {};
    for (const term of text.split(/\s\+\s|\s*\+\s*(?=\d*[A-Z(])/)) {
      const m = term.trim().match(/^(\d*)\s*(.+)$/);
      const times = m[1] ? Number(m[1]) : 1;
      for (const [el, n] of Object.entries(atoms(m[2]))) total[el] = (total[el] ?? 0) + n * times;
    }
    return total;
  };
  const sideTex = (text) =>
    text
      .split(/\s*\+\s*(?=\d*[A-Z(])/)
      .map((term) => {
        const m = term.trim().match(/^(\d*)\s*(.+)$/);
        return `${m[1]}${tex(m[2])}`;
      })
      .join(" + ");

  matrixlab.cells.register({
    id: "chem",
    label: "Chemistry",
    starter: "# a formula a line: its molar mass\nH2O\nCuSO4·5H2O\n\n# a reaction: is it balanced?\n2H2 + O2 -> 2H2O",
    render(code) {
      const rows = [];
      for (const line of code.split("\n")) {
        const text = line.trim();
        if (!text) continue;
        if (text.startsWith("#")) {
          rows.push(`<tr><td colspan="2" style="color:var(--t-muted);font-size:13px;padding-top:8px">${esc(text.slice(1).trim())}</td></tr>`);
          continue;
        }
        try {
          const arrow = text.match(/\s*(->|→|=>|⟶|=)\s*/);
          if (arrow) {
            const [left, right] = [text.slice(0, arrow.index), text.slice(arrow.index + arrow[0].length)];
            const a = side(left);
            const b = side(right);
            const off = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((el) => (a[el] ?? 0) !== (b[el] ?? 0));
            const verdict = off.length
              ? `<span style="color:var(--t-red)">not balanced — ${off.map((el) => `${el}: ${a[el] ?? 0} → ${b[el] ?? 0}`).join(", ")}</span>`
              : `<span style="color:var(--t-green)">balanced ✓</span>`;
            rows.push(`<tr><td>${matrixlab.tex(`${sideTex(left)} \\to ${sideTex(right)}`)}</td><td>${verdict}</td></tr>`);
            continue;
          }
          const counts = atoms(text);
          const mass = Object.entries(counts).reduce((sum, [el, n]) => sum + MASS[el] * n, 0);
          const parts = matrixlab.settings.get("breakdown")
            ? `<div style="font-size:12px;color:var(--t-muted)">${Object.entries(counts)
                .map(([el, n]) => `${el} ${n} × ${MASS[el]} = ${round(MASS[el] * n)}`)
                .join(" · ")}</div>`
            : "";
          rows.push(`<tr><td>${matrixlab.tex(tex(text))}</td><td><b>${round(mass)}</b> g/mol${parts}</td></tr>`);
        } catch (err) {
          rows.push(`<tr><td>${esc(text)}</td><td style="color:var(--t-red)">${esc(err.message)}</td></tr>`);
        }
      }
      return `<table class="nb-plugin-table" style="border:none">${rows.join("")}</table>`;
    },
  });
}
