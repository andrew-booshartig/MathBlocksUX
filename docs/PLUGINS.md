# Plugins

MatrixLab is meant to become whatever you need, the way people make Neovim
and VS Code their own. A plugin is a folder in

    ~/Documents/MatrixLab/Plugins/<your-plugin>/

with a `plugin.json`, and a `main.js` if it runs any script. ⌘K has
everything for them: **New plugin (from a sample)** writes a working one to
start from, **Open the plugins folder**, **Reload plugins** after you edit
one, and **Plugin installed** lists each one with what it added (or why it
didn't load). The folder can be a link, so plugins can live with your
dotfiles.

The app's own languages (MATLAB, C++, Rust…) are made the same way. They're
in `src/notebook/languages.ts`, and copying one is the quickest start.

## Your init.js

`~/Documents/MatrixLab/init.js` is your own config, the way Neovim has `init.lua`. It runs after the plugins, with the same `matrixlab`.

- ⌘K → **Edit your init.js** makes one (with examples, commented out) and opens it in Neovim.
- The app watches it and the plugins folder, so every `:w` reloads them.

```js
export function activate(matrixlab) {
  matrixlab.vim.map("jk", "<Esc>", "insert");          // vim in code cells
  matrixlab.keys.map("Mod+Shift+J", "tile:notebook");   // a key to any ⌘K command
  matrixlab.commands.register({ id: "me.today", title: "What's today?", run: () => matrixlab.notify(new Date().toDateString()) });
}
```

## What a plugin can add

| it adds | where | how |
| --- | --- | --- |
| a language for code cells | the notebook's **Code ▾** menu, and any ```` ```fence ```` with its id | `plugin.json` alone, or `matrixlab.languages.register` |
| a kind of cell | the **Code ▾** menu, and ```` ```fence ```` with its id | `matrixlab.cells.register` in `main.js` |
| a command | ⌘K | `matrixlab.commands.register` in `main.js` |
| a tile | the dock, beside Calculate and Work (⌘K → Go to …, or an empty zone's menu) | `matrixlab.tiles.register` in `main.js` |

## plugin.json

```json
{
  "name": "fortran",
  "displayName": "Fortran",
  "version": "0.1.0",
  "description": "Fortran cells, compiled with gfortran",
  "contributes": {
    "languages": [
      {
        "id": "fortran",
        "label": "Fortran",
        "aliases": ["f90"],
        "extension": "f90",
        "starter": "program hi\n  print *, 'hello'\nend program hi",
        "install": "brew install gcc",
        "highlight": {
          "lineComment": ["!"],
          "strings": ["'", "\""],
          "keywords": ["program", "end", "do", "if", "then", "print", "integer", "real"]
        },
        "run": [{ "needs": "gfortran", "once": ["sh", "-c", "gfortran {file} -o {dir}/cell && {dir}/cell"] }]
      }
    ]
  }
}
```

### A language

- `id`: what a fence says (```` ```fortran ````). `aliases` are other names that work too.
- `label`: shown on the cell and in the menu.
- `extension`: the cell is written to `cell.<extension>` to run.
- `highlight`: how its code is colored.
  - `lineComment` and `blockComment` (`[["/*", "*/"]]`) mark comments.
  - `strings` lists the quote marks.
  - `keywords`, `builtins` and `constants` list words to color.
  - `preprocessor: true` colors `#include` lines.
  - `transpose: true` treats MATLAB's `'` after a name as transpose.
- `run`: ways to run it. The first one whose program (`needs`) is installed is used.
  - `once: [command…]` compiles and runs the cell's file. `{file}` is the cell's file and `{dir}` is its folder. Each run starts fresh and stops after `timeout` seconds (default 60).
  - `session: [command…]` keeps one program running per notebook. Each cell is sent to it, followed by `done`, a line that prints `{marker}`. What the program prints up to the marker is the cell's output. Variables carry from cell to cell, as in Python's.
  - `init: [lines…]` are sent first, when a session starts.
  - A printed line `__matrixlab_image__:/path/to/picture.png` shows that picture under the cell. This is how MATLAB's figures come back.
- `install`: what to tell someone who doesn't have the program.
- `output: "matlab"` shows `x = 5` and matrices as math.
- `variables` (a session language): the line that lists its variables for the notebook's Variables panel, one a line, as name, kind, size and value with tabs between. MATLAB's is `__mlx_vars__()`, defined in its `init`.
- `assign`: how a variables block's value is set in this language, put before each cell (`"{name} = {value};"`).
- `quiet` (in a `run` way): patterns for lines it prints that aren't the cell's own, left out.

Programs are looked for on the PATH, and in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.cargo/bin`.

## main.js

```js
export function activate(matrixlab) {
  // ```csv cells: their rows as a table (render returns HTML, or a promise of it)
  matrixlab.cells.register({
    id: "csv",
    label: "CSV table",
    starter: "x, y\n1, 2",
    render(code) {
      return "<table>…</table>";
    },
  });

  // a command in ⌘K
  matrixlab.commands.register({ id: "me.hello", title: "Say hello", run: () => matrixlab.notify("hello") });

  // a tile of its own: fill the element (give back a function to clean up, if it needs one)
  matrixlab.tiles.register({
    id: "scratchpad",
    title: "Scratchpad",
    blurb: "A place to jot things down",
    mount(el) {
      el.innerHTML = "<textarea></textarea>";
      return () => {};
    },
  });

  // the math engine, for anything the app can work out
  // matrixlab.math({ op: "smart", latex: "x^2 = 9" }).then(...)
}
```

`matrixlab` has:

| | |
| --- | --- |
| `languages.register(language)` | a language, as in plugin.json |
| `cells.register({ id, label, starter, render })` | a kind of cell |
| `commands.register({ id, title, run })` | a command in ⌘K |
| `tiles.register({ id, title, blurb, mount })` | a tile in the dock (`mount(element)` fills it) |
| `commands.run(id)` | run any command: the app's (⌘K's: `tile:graph`, `vim`, `extensions`…) or a plugin's |
| `keys.map(keys, commandIdOrFunction)` | a key of your own: `"Mod+Shift+G"` (Mod is ⌘), `"Ctrl+Alt+P"` |
| `vim.map(lhs, rhs, mode)`, `vim.noremap`, `vim.defineEx(name, prefix, fn)` | vim mappings and `:commands` in code cells; `vim.raw` is the whole of @replit/codemirror-vim's Vim |
| `storage.get(key, fallback)`, `storage.set(key, value)` | this plugin's own settings, kept on this computer |
| `math(request)` | the math engine (the same requests the app makes) |
| `notify(text)` | a few words at the top of the window |
| `version` | 1 |

A plugin runs as you do, with what your account can do, as VS Code
extensions and Neovim plugins do. Only install plugins you trust.

## How the app is put together

The calculator's tiles (Calculate, Work, Graph, Notebook…) and the
notebook's own cells are the app's built-in parts. Plugins add to them
through the registries above: a plugin's tile docks, drags and saves in a
layout like the app's own, and a plugin's language or cell sits in the
same menus. Next on the way: the app's own tiles registered the same way
as a plugin's, so any of them can be turned off or swapped for your own.
