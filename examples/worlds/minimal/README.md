# Example world: minimal

A supported `practonaut.world/1` world with one frame, one step and one confirmed
rename rule. Rename **Draft** to **Done** in task T1. The rule retains the native
adapter conformance evidence reference from the flow-diagram example; it is not
an additional human demonstration or held-out competence result.

Contents:

- `world.json`: version 0.0.0, task T1, one deterministic variant, provenance and rights.
- `assets/marker.png`: self-made 16 × 16 px yellow square with a dark border;
  its source and CC0 license are declared in `rights.assets`.

Pack and validate from the repository root:

```sh
mkdir -p .local
node src/cli/main.ts pack examples/worlds/minimal --out .local/minimal.pnworld
node src/cli/main.ts validate .local/minimal.pnworld
node src/cli/main.ts serve .local/minimal.pnworld --task T1 --seed 0
```

The serve command remains active until Ctrl+C. This README is source documentation
and is not packed into the world package. Draft-schema and missing-rights worlds
are rejected by the public pack and validate commands.

## License

The files in this directory (`world.json`, `assets/marker.png`, this README) are
CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/
