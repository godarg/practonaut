// Builds the living design gallery into .local/gallery/ (never shipped, never committed).
// The gallery renders the real kit from src/player/ui with the real tokens and CSS.
import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";

const output = resolve(".local/gallery");
await mkdir(output, { recursive: true });
const tokens = await readFile("design/tokens.css", "utf8");
const names = (pattern: RegExp): string[] => [...new Set([...tokens.matchAll(pattern)].map(m => m[1] as string))];
const define = { __TOKENS__: JSON.stringify({
  colors: names(/--pn-color-([a-z0-9-]+)\s*:/g).filter(n => !/^(scrim|glass|glass-border|glass-edge|shadow-.*|hatch)$/.test(n)),
  text: names(/--pn-text-([a-z0-9]+)\s*:/g),
  radii: names(/--pn-radius-([a-z0-9]+)\s*:/g),
  space: names(/--pn-space-([a-z0-9]+)\s*:/g),
}) };
await build({ entryPoints: [{ in: "src/player/gallery/main.ts", out: "gallery" }, { in: "src/player/gallery/entry.css", out: "gallery" }], outdir: output, bundle: true, platform: "browser", format: "iife", target: "es2022", minify: false, define, loader: { ".css": "css" } });
await cp("design/tokens.css", join(output, "tokens.css"));
await writeFile(join(output, "index.html"), `<!doctype html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Practonaut design gallery</title>
<link rel="stylesheet" href="./tokens.css"><link rel="stylesheet" href="./gallery.css"><script defer src="./gallery.js"></script></head>
<body><div id="app"></div></body></html>
`);
console.log(JSON.stringify({ output: relative(resolve("."), output), files: ["index.html", "gallery.js", "gallery.css", "tokens.css"] }));
