# MCP Registry server.json schema (vendored)

`server.schema.2025-12-11.json` is a byte-for-byte copy of
<https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json>, the `$schema` of
`server.json` and the registry's current schema version (`CurrentSchemaVersion` in
`pkg/model/constants.go` of [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)),
fetched 2026-10-13. `npm run registry:check` (`tools/check-server-json.ts`) validates `server.json`
against it offline and pins its sha256
(`3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0`).

To move to a newer schema: download the new version unchanged next to this one, update
`SCHEMA_URL`, `SCHEMA_FILE` and `SCHEMA_SHA256` in the check and `$schema` in `server.json`.
