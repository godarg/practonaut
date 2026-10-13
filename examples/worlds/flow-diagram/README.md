# Flow diagram source

Content dedication: CC0-1.0, created by Practonaut contributors. No third-party content assets
are in this world. The adapter supplies separately licensed fonts.

T1 builds a three-step chain, T2 inserts a step in either gap, T3 removes the middle step and
closes the chain. Seed selects one of six cases (labels, gap, integer layout offset). EN/DE
prompts and a three-level hint ladder are in world.json.

Actions are objects `{ "name": "reconnect_end", "params": { "id": "ab", "end": "end",
"target": "c" }, "baseStep": 0 }`. For T3, follow this with `disconnect` on `bc` at baseStep 1
and `delete_step` on `b` at baseStep 2. `disconnect` removes the entire arrow. All other
actions are unmodeled. T1/T2 creation IDs are deterministic and returned by the core API.

Run `npm run world:freeze` after adapter conformance. Freeze verifies every variant using
witnesses outside this directory. `practonaut pack examples/worlds/flow-diagram --out flow.pnworld`
produces only the declared world JSON and its manifest; README and license notices are skipped.
The .pncheck source is a sibling directory and contains evaluation-only fixtures and H1.
