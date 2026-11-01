// The third-party notices a built app carries: every library it ships —
// the web side (npm), the frozen Python engine and its packages, the Rust
// crates — with its license and the license's text. Run before a release
// build: node scripts/notices.mjs  →  src-tauri/resources/THIRD_PARTY_NOTICES.txt
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = [];
const seen = new Set();
const licenseText = (dir) => {
  if (!dir || !fs.existsSync(dir)) return "";
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)/i.test(f));
  return file && fs.statSync(path.join(dir, file)).isFile() ? fs.readFileSync(path.join(dir, file), "utf8").trim() : "";
};
const add = (part, name, version, license, text) => {
  const key = `${part}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ part, name, version, license: license || "see its text", text });
};

// the web side: what the app's pages import, and what those import
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const walk = (name) => {
  const dir = path.join(root, "node_modules", name);
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file) || seen.has(`web:${name}`)) return;
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  add("web", name, p.version, typeof p.license === "string" ? p.license : p.license?.type, licenseText(dir));
  for (const dep of Object.keys(p.dependencies ?? {})) walk(dep);
};
for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);

// the frozen engine: Python itself and the packages in its venv
const py = path.join(root, "sidecar/.venv/bin/python");
const pyPackages = JSON.parse(
  execSync(
    `${py} -c "import json, importlib.metadata as m, sys
out = []
for d in m.distributions():
    meta = d.metadata
    files = [f for f in (d.files or []) if f.name.lower().startswith(('license', 'licence', 'copying', 'notice'))]
    text = '\\n\\n'.join(open(d.locate_file(f), encoding='utf-8', errors='replace').read().strip() for f in files[:3])
    out.append([meta['Name'], d.version, meta.get('License-Expression') or (meta.get('License') or '').split(chr(10))[0][:80], text])
out.append(['Python', sys.version.split()[0], 'PSF-2.0', open(sys.base_prefix + '/lib/python%d.%d/LICENSE.txt' % sys.version_info[:2]).read() if __import__('os').path.exists(sys.base_prefix + '/lib/python%d.%d/LICENSE.txt' % sys.version_info[:2]) else ''])
print(json.dumps(out))"`,
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString(),
);
const toolsOnly = new Set(["pip", "setuptools", "pytest", "pluggy", "iniconfig", "pygments", "pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "macholib", "packaging"]);
for (const [name, version, license, text] of pyPackages) if (!toolsOnly.has(name.toLowerCase())) add("python", name, version, license, text);

// the Rust side: the app's crates
const meta = JSON.parse(execSync("cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml", { cwd: root, maxBuffer: 256 * 1024 * 1024 }).toString());
const used = new Set(meta.resolve.nodes.map((n) => n.id));
for (const p of meta.packages) {
  if (!used.has(p.id) || p.source === null) continue;
  add("rust", p.name, p.version, p.license, licenseText(path.dirname(p.manifest_path)));
}

const order = { web: 0, python: 1, rust: 2 };
out.sort((a, b) => order[a.part] - order[b.part] || a.name.localeCompare(b.name));
const head = [
  "MatrixLab — third-party notices",
  "",
  "MatrixLab is built with the open-source software listed here. Each is used under its own license, given with it.",
  "Plugins and programs you install yourself (Octave, a compiler…) come under their own licenses and aren't part of MatrixLab.",
  "",
  ...out.map((p) => `${p.part.padEnd(6)} ${p.name} ${p.version} — ${p.license}`),
  "",
].join("\n");
const body = out
  .filter((p) => p.text)
  .map((p) => `${"=".repeat(72)}\n${p.name} ${p.version} (${p.license})\n${"=".repeat(72)}\n${p.text}`)
  .join("\n\n");
fs.mkdirSync(path.join(root, "src-tauri/resources"), { recursive: true });
fs.writeFileSync(path.join(root, "src-tauri/resources/THIRD_PARTY_NOTICES.txt"), `${head}\n${body}\n`);
const missing = out.filter((p) => !p.text).length;
console.log(`${out.length} libraries (${out.filter((p) => p.part === "web").length} web, ${out.filter((p) => p.part === "python").length} python, ${out.filter((p) => p.part === "rust").length} rust); ${missing} without a license file (their license is named)`);
