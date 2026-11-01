# Making a release

A built MatrixLab runs on a Mac with nothing installed. It carries its own
Python, frozen with sympy, numpy, pandas and matplotlib. That one Python is
both the math engine and every notebook's kernel (`engine --kernel`).

## Steps

1. `npm run build:engine` freezes `sidecar/engine.py` (with `kernel.py` and
   the modules a cell may import, listed in `sidecar/cell_modules.py`) into
   `sidecar/dist/engine` (about 94 MB).
2. `npm run build:notices` lists every library the app ships, with its
   license text, in `src-tauri/resources/THIRD_PARTY_NOTICES.txt`.
3. `npm run tauri build -- --config src-tauri/tauri.calculator.conf.json`
   builds the Calculator app; `npm run tauri build` builds the canvas app.
   Both put `engine/` and `THIRD_PARTY_NOTICES.txt` in `Contents/Resources`.

Check a build by running it from Finder on a Mac without the dev tools, and
running a notebook's Python cell and a graph.

## What isn't in the app

- **Octave, MATLAB, compilers** (clang, rustc, node…). People install these
  themselves; the Extensions panel says which are installed and how to get
  the rest. Octave is GPL, so it isn't shipped with the app.
- **Plugins.** They live in `~/Documents/MatrixLab/Plugins` and come under
  their authors' terms.

## Licenses

- Everything the app ships is under permissive licenses that allow selling it closed-source, as long as their notices go with it. That covers Python (PSF), the Python packages (BSD/MIT style), the web side (MIT/Apache) and the Rust crates (MIT/Apache).
- PyInstaller is GPL with an exception that lets frozen apps be sold.
- A few Rust crates Tauri uses are MPL-2.0. They're fine unmodified; the notices say where their source is.
- The name "MatrixLab" is close to MATLAB, a MathWorks trademark. Have a trademark lawyer check it before selling.

## Still to do before selling

- Sign with a Developer ID and notarize, so macOS opens it without the "unidentified developer" step. This needs Apple's $99 a year program.
- Build universal (Apple silicon and Intel). The freeze is arm64 only today.
- Add an About page in the app that shows the notices.
