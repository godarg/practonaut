# Excalidraw engine assets and licenses

## Build

`npm run engine:build` (and `npm run build`) bundles the real, unmodified
`@excalidraw/excalidraw` package from `node_modules` with esbuild into two entry points:
`engine.js` (headless mirror and export) and `editor.js` (the embedded editor), plus
`engine.css`. `tools/build-engine.ts` is the whole build. Excalidraw and React are build
dependencies; installed runs consume the static bundle and never run a bundler.

The only supply-chain pin is `npm ci` with `package-lock.json`. The build applies a few
name-based patches to the installed production sources. Each is found by pattern and must
match exactly once; if Excalidraw changes so that a pattern no longer matches, the build stops
with the patch name instead of shipping an unpatched bundle:

| Patch | Why |
|---|---|
| `font-cdn-fallback` | Excalidraw appends an `esm.sh` font URL even when `EXCALIDRAW_ASSET_PATH` points to the local origin. The append is removed; local font sources stay. |
| `font-cdn-constant` | The `esm.sh` fallback constant itself is emptied, so no CDN URL ships. |
| `firebase-config` | The inert public Firebase configuration is emptied. |
| `dialog-accessible-name` | Upstream labels every dialog with the fixed id `dialog-title` while its visible heading gets a generated id; the patch points `aria-labelledby` at the real heading so native dialogs (e.g. spreadsheet paste) have an accessible name. |
| Mermaid converter | `@excalidraw/mermaid-to-excalidraw` resolves to `src/adapters/excalidraw/converter-unavailable.js` ([PADR-0025](../adr/0025-no-optional-mermaid-converter-in-pilot.md)). `native-overlay.css` hides the More-tools entry and its "Generate" heading. |
| Theme bindings | `native-overlay.css` receives spacing and chart-paper values from `design/tokens.css` by token name. |

`tests/unit/engine-build.test.ts` builds the engine and requires that no `unpkg`, `esm.sh` or
`jsdelivr` URL is in any shipped script or stylesheet. At runtime the adapter and the editor
block and count every non-local request; the e2e and a11y suites require zero.

## Fonts

World labels accept only Cascadia (Excalidraw family 3); its WOFF2 and Microsoft's SIL Open
Font License 1.1 text are vendored under `src/adapters/excalidraw/assets/fonts/Cascadia/`.
Seven unchanged Excalifont WOFF2 files and the upstream OFL notice serve Excalidraw's native
family 5 (editor surfaces and its SVG font embedding); they do not make family 5 a supported
world font. The four Assistant weights used by the engine UI CSS come from the package and
carry the Google Fonts OFL text. `src/adapters/excalidraw/fonts-ready.js` waits for the native
font registry before the editor accepts input.

## Licenses

`src/adapters/excalidraw/assets/LICENSES.json` documents every vendored font and notice
(upstream URL, license, scope). `assertAssetsPresent` checks that every file it names exists;
content is not pinned. The build writes into the engine output:

- `licenses/` — the full notice of every npm package that contributes bytes to the bundle
  (from the package directory, or `assets/licenses/` where a package ships none), plus the
  notices of components embedded inside upstream prebundles (`embedded-*.txt`, e.g. HarfBuzz);
- `third-party-packages.json` — the package list;
- `LICENSES.json` and `fonts/`.

A package without a findable notice is reported as a build warning. These files ship beneath
`dist/adapters/excalidraw/engine/` inside the npm allowlist. Practonaut is Apache-2.0; original
example-world rights are declared in each manifest.
