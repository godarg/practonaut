// Generates JSON Schemas from the zod manifest schemas (the source of truth).
//   node tools/schemas.ts --write   writes schemas/*.json
//   node tools/schemas.ts --check   exits 1 if a committed file differs from the generated text
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CheckerBundleManifestSchema, WorldManifestSchema } from "../src/package/manifest.ts";

import { WorldSchema, WorldSchemaV2 } from "../src/world/schema.ts";
import { BenchReportSchemaV1, BenchReportSchemaV2 } from "../src/bench/report.ts";

const ROOT = new URL("../", import.meta.url);
// No public schema host exists yet; a URN identifies the schema without promising a URL.
const BASE_ID = "urn:practonaut:schema:";

export const SCHEMA_FILES: ReadonlyArray<{ file: string; title: string; schema: z.ZodType }> = [
  { file: "world.v1.schema.json", title: "Practonaut world content v1", schema: WorldSchema },
  { file: "world.v2.schema.json", title: "Practonaut world content v2", schema: WorldSchemaV2 },
  { file: "world-package-manifest.v1.schema.json", title: "Practonaut world package manifest v1", schema: WorldManifestSchema },
  { file: "checker-bundle-manifest.v1.schema.json", title: "Practonaut checker bundle manifest v1", schema: CheckerBundleManifestSchema },
  { file: "bench.v1.json", title: "Practonaut bench report v1 (practonaut.bench/1)", schema: BenchReportSchemaV1 },
  { file: "bench.v2.json", title: "Practonaut bench report v2 (practonaut.bench/2)", schema: BenchReportSchemaV2 },
];

export function generate(entry: (typeof SCHEMA_FILES)[number]): string {
  const json = z.toJSONSchema(entry.schema, { target: "draft-2020-12", unrepresentable: "throw" }) as Record<string, unknown>;
  const out = { $schema: json.$schema, $id: BASE_ID + entry.file, title: entry.title, ...json };
  return JSON.stringify(out, null, 2) + "\n";
}

function main(): number {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    process.stderr.write("usage: node tools/schemas.ts --write|--check\n");
    return 1;
  }
  const dir = new URL("schemas/", ROOT);
  if (mode === "--write") mkdirSync(dir, { recursive: true });
  let stale = 0;
  for (const entry of SCHEMA_FILES) {
    const target = new URL(entry.file, dir);
    const text = generate(entry);
    if (mode === "--write") {
      writeFileSync(target, text);
      process.stdout.write(`wrote schemas/${entry.file}\n`);
      continue;
    }
    let committed: string | null = null;
    try {
      committed = readFileSync(target, "utf8");
    } catch {
      committed = null;
    }
    if (committed !== text) {
      stale++;
      process.stderr.write(`schema:check: schemas/${entry.file} ${committed === null ? "is missing" : "differs from the generated schema"}\n`);
    } else {
      process.stdout.write(`schema:check: schemas/${entry.file} up to date\n`);
    }
  }
  if (stale > 0) process.stderr.write("schema:check: run `npm run schema:write` and commit the result\n");
  return stale > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
