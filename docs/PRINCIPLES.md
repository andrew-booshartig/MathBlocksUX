# mathblocks — design principles

mathblocks is a canvas of blocks that can be combined into almost anything:
an Algebra 1 course, a test, a physics simulation, a calendar with
automations, a D&D storyboard with dice. These principles keep it welcoming
as it grows, and keep growth from breaking what already works.

## For the people using it

1. **Feel at home.** Use the objects and words of a classroom, not of
   software: a calculator looks and clicks like a calculator, the work pad
   looks like ruled paper, lessons read like lesson plans. A teacher should
   recognise every block before touching it.
2. **Everything available, nothing in the way.** Every block works the
   moment it's added, with sensible content. Power lives one click deeper
   (⚙ settings, 2nd keys, tour editor). Never make a beginner wade through
   options; never make an expert go without them.
3. **The student does the thinking.** Tools check, nudge, and show — they
   don't hand over answers unless the teacher chooses to. Help is a dial the
   teacher controls (live checking → on request → off for tests).
4. **Live and visual.** Math responds as you type and drag. Motion explains
   (tiles fly across the equals sign, the scale tips). There is no "run"
   button for math.
5. **Honest.** If something can't be checked, say "can't check this"; never
   show a ✓ we aren't sure of. Error messages say what to do next.
6. **Nothing is lost.** Autosave, undo, confirm before replacing work, and
   every file ever saved opens forever.
7. **Calm and consistent.** Every block has the same anatomy (colored
   header, body, ⚙, ×), one accent color per family, real math typography,
   generous spacing. Beauty comes from consistency, not decoration.
8. **Everyone can use it.** Keyboard for everything, readable contrast,
   screen-reader labels, no information carried by color alone.

## For the code (so it can grow without breaking)

1. **Every block is a plugin — even built-in ones.** A block is metadata
   (`src/blocks/meta.ts`: title, category, color, defaults, tour text,
   goals) plus a component (`src/blocks/components.ts`). The rest of the app
   never lists block types; it reads the registry. The compiler fails if a
   block is missing from either registry. Community blocks will use the
   same shape: a manifest plus code.
2. **Saved data is plain JSON, and it's a promise.** New fields are
   optional with defaults; old shapes are upgraded in `normalizeSnapshot`;
   block types are never renamed (the Transform block is still stored as
   `"simplify"` for this reason).
3. **Compute speaks a language-neutral protocol.** Engines are separate
   processes that read one JSON request per line and write one JSON reply
   per line. Python/sympy is the first engine; anything that can read and
   print a line of text (Rust, Julia, JavaScript, Lua, C…) can be the next.
   That is how people will build blocks in "almost any language".
4. **Blocks talk through shared state and wires.** Today: the variable pool
   plus slider/increment wires. Next: typed ports (number, expression, text,
   table, image, audio/video, event) and an event bus (clock ticks,
   triggers), so calendars, simulations and games can be composed from
   blocks without new core code.
5. **Capabilities, not trust.** Community blocks run sandboxed (UI in an
   isolated frame, compute in its own process) and must ask for what they
   need: network, files, clock, audio, camera. Schools will require this.
6. **Test mode is a real state, not a hack.** Blocks declare how they behave
   in an exam (calculator profile, hints off, checking off), and a locked
   workspace enforces it.
7. **Languages are data, never guesses.** Every input language is read into
   one shared form (`sidecar/mathcore/lang/ast.py`) and written back out of
   it, so any language translates to any other and switching languages
   translates the work. The language is always chosen explicitly, and its
   own rules are enforced with clear messages. A text language (Python,
   Lua, Haskell, or one a teacher defines in the app) is just a definition
   (`lang/specs.py`); only a notation that isn't shaped like math — say,
   Lisp's `(* 2 x)` — would need its own reader.
8. **Verify the way a user would.** Engines have pytest suites; the UI has a
   headless browser harness driving the real app against the real engine.
   Native browser dialogs are banned (the desktop webview can't show them).

## Where this is heading

| Stage | What it unlocks |
|---|---|
| Block registry (done) | New blocks are one metadata entry + one component |
| Typed ports + event bus | Any block can feed any other; automations, simulations |
| Engine plugins | Blocks computed by any language over the JSON protocol |
| Block SDK + sandbox | Community blocks installed safely, with permissions |
| Test mode | Locked full-screen workspace, teacher-set tools, activity log |
| Sharing hub | Lessons and blocks published, remixed, rated |
