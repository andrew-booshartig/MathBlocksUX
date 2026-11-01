/** Languages for a notebook's code cells — each one a plugin's contribution.
 * The ones here come with the app; a plugin adds its own the same way, in
 * its plugin.json ("contributes": { "languages": [...] }) or from its
 * main.js (matrixlab.languages.register(...)). See docs/PLUGINS.md.
 *
 * A language says how its cells are colored (highlight), and how they run:
 * the first of its `run` ways whose program is installed. `once` compiles
 * and runs the cell's own file ({file} in {dir}); `session` keeps the
 * program running for the notebook, each cell sent to it and read back up
 * to the line `done` prints ({marker}) — so variables carry on, cell to cell. */
import { useSyncExternalStore } from "react";

export interface HighlightSpec {
  /** what starts a comment to the end of the line: //, #, % */
  lineComment?: string[];
  /** comments with an end: [["/*", "*\/"]] */
  blockComment?: [string, string][];
  /** what a string is quoted with */
  strings?: string[];
  keywords?: string[];
  builtins?: string[];
  constants?: string[];
  /** lines starting # are the preprocessor's (#include) */
  preprocessor?: boolean;
  /** ' after a name or ) is transpose (MATLAB), not a string */
  transpose?: boolean;
}

export interface LanguageRun {
  /** the program it needs (looked for on the PATH and the usual places) */
  needs: string;
  once?: string[];
  session?: string[];
  /** a session's first lines */
  init?: string[];
  /** a session's line that prints {marker} — after each cell */
  done?: string;
  /** seconds a run-once gets (60) */
  timeout?: number;
}

export interface Language {
  id: string;
  label: string;
  /** other names a ```fence may use: ```octave, ```m */
  aliases?: string[];
  /** the cell's file: cell.<extension> */
  extension: string;
  highlight?: HighlightSpec;
  /** how it runs: the first whose program is installed */
  run?: LanguageRun[];
  /** how to get one, said when none is installed */
  install?: string;
  /** how its printout is shown: "matlab" sets x = 5 and matrices as math */
  output?: "text" | "matlab";
  /** what a new cell starts with */
  starter?: string;
  /** a variables block's value set in this language, put before each cell: "{name} = {value};" */
  assign?: string;
  /** which plugin added it */
  plugin?: string;
}

const C_KEYWORDS =
  "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false";
const CPP_KEYWORDS = `${C_KEYWORDS} alignas alignof and asm catch class constexpr consteval decltype delete explicit export friend mutable namespace new noexcept not nullptr operator or private protected public static_assert template this throw try typeid typename using virtual co_await co_return co_yield concept requires auto`;

export const BUILT_IN_LANGUAGES: Language[] = [
  {
    id: "matlab",
    label: "MATLAB",
    aliases: ["octave", "m"],
    extension: "m",
    output: "matlab",
    assign: "{name} = {value};",
    install: "Octave runs MATLAB code, free: brew install octave (or install MATLAB)",
    starter: "A = [1 2; 3 4];\nb = [5; 6];\nx = A \\ b",
    highlight: {
      lineComment: ["%", "#"],
      blockComment: [["%{", "%}"]],
      strings: ["'", '"'],
      transpose: true,
      keywords: "break case catch classdef continue else elseif end for function global if otherwise parfor persistent return switch try while".split(" "),
      builtins:
        "disp fprintf sprintf printf zeros ones eye rand randn randi size length numel linspace logspace plot plot3 scatter bar hist histogram surf mesh meshgrid figure hold xlabel ylabel zlabel title legend grid axis subplot sum prod cumsum mean median std var max min abs sqrt exp log log10 log2 sin cos tan asin acos atan atan2 sinh cosh tanh round floor ceil fix mod rem inv det rank trace transpose reshape find sort unique any all isempty isnumeric num2str str2num str2double strcat strsplit strrep upper lower fliplr flipud diag kron norm eig svd lu qr chol polyfit polyval roots conv deconv interp1 trapz diff cross dot ode45 fzero fminsearch integral cellfun arrayfun struct fieldnames cell numel repmat cat horzcat vertcat tic toc".split(
          " ",
        ),
      constants: "true false pi eps Inf inf NaN nan i j".split(" "),
    },
    run: [
      {
        needs: "octave",
        session: ["octave", "--no-gui", "--quiet", "--no-window-system", "--interactive", "--no-line-editing"],
        init: [
          "PS1(''); PS2(''); more off; page_screen_output(false); set(0, 'defaultfigurevisible', 'off');",
          // after each cell: its figures saved as pictures, said by a line the app reads
          "function __mlx_figs__(); h = get(0, 'children'); for k = 1:numel(h); f = [tempdir() sprintf('mlx_%d_%d_%d.png', getpid(), round(rem(now, 1) * 1e8), k)]; print(h(k), f, '-dpng', '-r110'); printf('__matrixlab_image__:%s\\n', f); end; close all; end",
        ],
        done: "__mlx_figs__(); disp('{marker}')",
      },
      { needs: "matlab", once: ["matlab", "-batch", "run('{file}')"], timeout: 120 },
    ],
  },
  {
    id: "cpp",
    label: "C++",
    aliases: ["c++", "cxx", "cc"],
    extension: "cpp",
    assign: "const double {name} = {value};",
    install: "Xcode's command line tools have it: xcode-select --install",
    starter: "#include <iostream>\n\nint main() {\n    std::cout << \"hello\\n\";\n}",
    highlight: { lineComment: ["//"], blockComment: [["/*", "*/"]], strings: ['"', "'"], preprocessor: true, keywords: CPP_KEYWORDS.split(" "), builtins: "std cout cin endl vector string map set array printf size_t".split(" ") },
    run: [{ needs: "clang++", once: ["sh", "-c", "clang++ -std=c++20 -O1 -w {file} -o {dir}/cell && {dir}/cell"] }],
  },
  {
    id: "c",
    label: "C",
    extension: "c",
    assign: "const double {name} = {value};",
    install: "Xcode's command line tools have it: xcode-select --install",
    starter: '#include <stdio.h>\n\nint main(void) {\n    printf("hello\\n");\n}',
    highlight: { lineComment: ["//"], blockComment: [["/*", "*/"]], strings: ['"', "'"], preprocessor: true, keywords: C_KEYWORDS.split(" "), builtins: "printf scanf malloc free size_t NULL".split(" ") },
    run: [{ needs: "clang", once: ["sh", "-c", "clang -std=c17 -O1 -w {file} -lm -o {dir}/cell && {dir}/cell"] }],
  },
  {
    id: "rust",
    label: "Rust",
    aliases: ["rs"],
    extension: "rs",
    assign: "#[allow(non_upper_case_globals, dead_code)] const {name}: f64 = {value};",
    install: "rustup: curl https://sh.rustup.rs -sSf | sh",
    starter: 'fn main() {\n    println!("hello");\n}',
    highlight: {
      lineComment: ["//"],
      blockComment: [["/*", "*/"]],
      strings: ['"'],
      keywords: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while".split(" "),
      builtins: "println print format vec Vec String Option Some None Ok Err Result Box i32 i64 u32 u64 usize f32 f64 bool char str".split(" "),
      constants: ["true", "false"],
    },
    run: [{ needs: "rustc", once: ["sh", "-c", "rustc --edition 2021 -A warnings -o {dir}/cell {file} && {dir}/cell"], timeout: 120 }],
  },
  {
    id: "javascript",
    label: "JavaScript",
    aliases: ["js", "node"],
    extension: "mjs",
    assign: "const {name} = {value};",
    install: "Node.js: brew install node",
    starter: "console.log([1, 2, 3].map((n) => n * n));",
    highlight: {
      lineComment: ["//"],
      blockComment: [["/*", "*/"]],
      strings: ['"', "'", "`"],
      keywords: "async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield".split(" "),
      builtins: "console Math JSON Array Object String Number Promise Map Set Date".split(" "),
      constants: "true false null undefined NaN Infinity".split(" "),
    },
    run: [{ needs: "node", once: ["node", "{file}"] }],
  },
  {
    id: "lua",
    label: "Lua",
    extension: "lua",
    assign: "local {name} = {value}",
    install: "brew install lua",
    starter: 'print("hello")',
    highlight: {
      lineComment: ["--"],
      blockComment: [["--[[", "]]"]],
      strings: ['"', "'"],
      keywords: "and break do else elseif end for function goto if in local not or repeat return then until while".split(" "),
      builtins: "print pairs ipairs table string math type tostring tonumber require".split(" "),
      constants: ["true", "false", "nil"],
    },
    run: [{ needs: "lua", once: ["lua", "{file}"] }],
  },
  {
    id: "shell",
    label: "Shell",
    aliases: ["sh", "bash", "zsh"],
    extension: "sh",
    assign: "{name}={value}",
    starter: "echo hello",
    highlight: {
      lineComment: ["#"],
      strings: ['"', "'"],
      keywords: "if then else elif fi for in do done while case esac function return export local".split(" "),
      builtins: "echo cd ls cat grep sed awk printf read".split(" "),
    },
    // one shell kept going: cd and variables carry on, cell to cell
    run: [{ needs: "sh", session: ["sh"], done: "echo {marker}" }],
  },
];

// ---- the registry: the built-ins, then each plugin's

let all: Language[] = BUILT_IN_LANGUAGES.map((l) => ({ ...l, plugin: "built-in" }));
const listeners = new Set<() => void>();

export function registerLanguage(lang: Language, plugin: string) {
  all = [...all.filter((l) => l.id !== lang.id), { ...lang, plugin }];
  listeners.forEach((f) => f());
}

/** every language a plugin added taken away (to load them again) */
export function forgetPluginLanguages() {
  all = all.filter((l) => l.plugin === "built-in");
  listeners.forEach((f) => f());
}

export function languages(): Language[] {
  return all;
}

/** the language a fence names (by its id or another name), if any */
export function languageOf(name: string): Language | undefined {
  const n = name.toLowerCase();
  return all.find((l) => l.id === n || l.aliases?.includes(n));
}

export function useLanguages(): Language[] {
  return useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    () => all,
  );
}

// ---- MATLAB's printout as math: x = 5, and matrices

export type OutputPart = { text: string } | { latex: string };

const NUM = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$|^-?Inf$|^NaN$/i;
const texNum = (n: string) => n.replace(/^(-?)Inf$/i, "$1\\infty").replace(/e([+-]?)0*(\d+)$/i, (_, s, d) => `\\times10^{${s === "-" ? "-" : ""}${d}}`);

/** Octave's and MATLAB's way of showing what a line made — `x = 5`, and
 * `A =` over rows of numbers — as math; anything else as it printed */
export function matlabOutput(text: string): OutputPart[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: OutputPart[] = [];
  let plain: string[] = [];
  const flush = () => {
    const t = plain.join("\n").replace(/^\n+|\n+$/g, "");
    if (t) out.push({ text: t });
    plain = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const scalar = line.match(/^\s*([A-Za-z]\w*)\s*=\s*(\S+)\s*$/);
    if (scalar && NUM.test(scalar[2])) {
      flush();
      out.push({ latex: `${scalar[1].replace(/_/g, "\\_")}=${texNum(scalar[2])}` });
      continue;
    }
    const head = line.match(/^\s*([A-Za-z]\w*)\s*=\s*$/);
    if (head) {
      // the rows after a blank line, up to the next blank
      let j = k + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const rows: string[][] = [];
      while (j < lines.length && lines[j].trim()) rows.push(lines[j++].trim().split(/\s+/));
      const width = rows[0]?.length ?? 0;
      if (rows.length && rows.every((r) => r.length === width && r.every((n) => NUM.test(n)))) {
        flush();
        const body = rows.map((r) => r.map(texNum).join("&")).join("\\\\");
        out.push({ latex: `${head[1].replace(/_/g, "\\_")}=${rows.length === 1 && width === 1 ? body : `\\begin{bmatrix}${body}\\end{bmatrix}`}` });
        k = j - 1;
        continue;
      }
    }
    plain.push(line);
  }
  flush();
  return out;
}
