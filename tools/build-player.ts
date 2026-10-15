import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";

const output = resolve(process.argv.includes("--dist") ? "dist/player/assets" : ".local/player");
await mkdir(output, { recursive: true });
const result = await build({ entryPoints: ["src/player/main.ts"], outfile: join(output, "player.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022", minify: true,
  legalComments: "external", metafile: true });
const external = Object.values(result.metafile.outputs).flatMap(o => o.imports).filter(i => i.external);
if (external.length) throw new Error("Player bundle contains runtime external imports");
// The browser entry imports only browser code and type-only protocol data. Fail closed on a
// Node dependency, checker, or a world/source fixture entering the learner bundle.
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith("src/player/")) throw new Error(`Unexpected player input: ${input}`);
}
await cp("src/player/index.html", join(output, "index.html"));
await build({ entryPoints: { player: "src/player/player.css" }, outdir: output, bundle: true, minify: true, loader: { ".css": "css" }, legalComments: "none" });
await cp("design/tokens.css", join(output, "tokens.css"));
// The bench report's stylesheets ship beside the compiled renderers (dist/bench/render.js reads
// ./report.css, dist/bench/card.js reads ./card.css).
if (process.argv.includes("--dist")) { await mkdir("dist/bench", { recursive: true }); await cp("src/bench/report.css", "dist/bench/report.css"); await cp("src/bench/card.css", "dist/bench/card.css"); }
const files = ["index.html", "player.js", "player.css", "tokens.css"];
const inventory = await Promise.all(files.map(async file => {
  const bytes = await readFile(join(output, file));
  return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}));
await writeFile(join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
console.log(JSON.stringify({ output: relative(resolve("."), output), bytes: inventory.reduce((n, i) => n + i.bytes, 0), files: inventory.length, externalImports: external.length }));
