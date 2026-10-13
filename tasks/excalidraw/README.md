# Excalidraw task library

Practice tasks for the pinned Excalidraw 0.18.1, built from pairs of drawings with
`practonaut tasks from-scenes`. Content is dedicated under CC0-1.0, like the bundled example world.

- `sources/<task-id>/start.excalidraw`, `goal.excalidraw` — the two drawings (open them in Excalidraw)
- `sources/<task-id>/task.json` — title, prompt (EN/DE), difficulty, options and two label variants
- `world/world.json` — generated `practonaut.world/2` world with every task (`practonaut play <task-id>`)
- `library.json` — generated reference solutions, near misses and one seed per variant; it never
  enters a world package and is not shown to agents

Edit a drawing or a `task.json`, then run `npm run library:write`. `npm run check` fails when the
generated files differ from a fresh build; `tests/unit/library.test.ts` checks every task in every
variant against the independent checker, and `tests/adapter/library-engine.test.ts` runs every
reference solution and near miss through the real Excalidraw engine.
