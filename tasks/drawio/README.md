# draw.io task library

The [Excalidraw task library](../excalidraw/README.md)'s 16 tasks in a draw.io world
([PADR-0049](../../docs/adr/0049-drawio-adapter.md) decision 8.1, [adapter page](../../docs/adapters/drawio.md)).
draw.io is a registered trademark; Practonaut is not affiliated with, endorsed or sponsored by
draw.io Ltd or draw.io AG. Content is dedicated under CC0-1.0; this folder holds no draw.io code or
asset.

- `world/world.json` — generated: the Excalidraw library's tasks, variant cases, titles, prompts and
  hints unchanged, id `drawio-library`, `app` draw.io 32.4.1, and `taskSet` `excalidraw-library` at the
  library's version, so the same seeds select the same cases and each instance has the same task
  identity on both apps (`practonaut play drawio/<task-id>`).
- `library.json` — generated: the same reference solutions, near misses and seeds, re-verified in the
  draw.io world in every case (the start fails, the reference passes, every near miss fails, under
  draw.io's declared constraints); it never enters a world package and is not shown to agents.

Nothing here is edited by hand: `npm run library:write` builds both libraries from
`tasks/excalidraw/sources/`, and `npm run check` fails when either differs from a fresh build. The
draw.io conformance layer (`npm run test:drawio`) runs every sequence through the real draw.io.
