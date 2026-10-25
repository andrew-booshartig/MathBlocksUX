# MatrixLab

*(code name: mathblocks)* — a desktop math canvas: blocks you place, wire and lock together, built for
teaching and learning (Algebra 1 first). Tauri + React on the front, a
persistent Python/sympy engine behind it.

See [docs/PRINCIPLES.md](docs/PRINCIPLES.md) before making big changes.

## Setup

```sh
npm install
python3 -m venv sidecar/.venv
sidecar/.venv/bin/pip install -r sidecar/requirements.txt
```

## Run

```sh
npm run tauri dev                       # the app, with hot reload
npm run tauri build -- --bundles app    # a release .app
sidecar/.venv/bin/python -m pytest sidecar/tests   # engine tests
```

## Layout

- `src/` — the canvas, toolbar and blocks (`src/blocks/`; registry in `meta.ts`)
- `src/lessons.ts` — built-in lessons and tours
- `sidecar/` — the math engine (`engine.py` dispatches to `mathcore/`)
- `src-tauri/` — the desktop shell and the bridge to the engine

## Sharing the app

```sh
npm run tauri build -- --bundles app,dmg
```

The build freezes the math engine with PyInstaller (`npm run build:engine`)
and puts it inside the app, so the `.dmg` runs on any Apple Silicon Mac with
nothing installed. It's signed locally (not by Apple), so the first time,
macOS asks: **System Settings → Privacy & Security → Open Anyway**.

## MatrixLab Calculator (its own app)

The smart calculator — Calculate · Work (show your work) · Graph — as a
standalone app, from the same code and engine as the canvas.

```
npm run calculator      # dev: its own window (Vite on :1430), alongside the canvas app
```

Its calculator, settings and themes live in its own data folder
(`~/Library/Application Support/com.andrewboos.matrixlab.calculator/`).

**Themes** are TOML. Twelve come built in (`src/calculator/themes/*.toml`;
One Dark is the default and the documented template). Make your own from
the theme menu (New theme… — live preview, errors by line) or drop `.toml`
files into the themes folder (Open themes folder) and press Reload. A theme
can `extends = "Tokyo Night"` and change just a few colors.

How it works: `scripts/tokenize-colors.py` gave every color in `App.css` a
role with the original as fallback (`var(--t-bg2, #17171f)`), so the canvas
app looks exactly as before and a theme just sets the roles. Run it again
after adding colors to App.css.
