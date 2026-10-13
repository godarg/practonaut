#!/usr/bin/env bash
# Install-and-package test: the packed tarball installs and runs.
#  1. build dist/
#  2. inspect the actual tarball: it holds only package.json, dist/, schemas/, the bundled
#     example world, the task library, README.md, LICENSE, NOTICE, CHANGELOG.md; no install-time
#     lifecycle script
#  3. `npm pack` -> install the tarball into an empty temporary project (npm install)
#  4. `npx` from an empty directory with a temporary PRACTONAUT_HOME: --help, serve <world> --no-open
#     and serve --no-open (bundled world) print a one-use link
#  5. installed `practonaut --version`, `pack` the example world, `validate` it, and compare the
#     archive sha256 with a pack made from the repository sources (this source/environment only)
# With --tarball <path>, reuse that already-built artifact without building or repacking it.
# Every failing step is reported; the script exits 1 if any step failed.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SUPPLIED_TGZ=""
if [ $# -gt 0 ]; then
  if [ $# -ne 2 ] || [ "$1" != "--tarball" ]; then echo 'Usage: test-pack.sh [--tarball <existing-tgz>]' >&2; exit 2; fi
  SUPPLIED_TGZ="$(node -p 'require("node:path").resolve(process.argv[1])' "$2")"
fi
TMP="$(mktemp -d "${TMPDIR:-/tmp}/practonaut-pack.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
# The installed CLI must never touch ~/.practonaut during this test.
mkdir -p "$TMP/home"; export PRACTONAUT_HOME="$(cd "$TMP/home" && pwd -P)"
FAILED=0
fail() { echo "test:pack: FAIL $*" >&2; FAILED=1; }
ok() { echo "test:pack: ok   $*"; }

if [ -z "$SUPPLIED_TGZ" ]; then
  if npm run --silent build >"$TMP/build.log" 2>&1; then ok "build"; else cat "$TMP/build.log" >&2; fail "build"; echo "test:pack: FAILED" >&2; exit 1; fi
  if npm pack --ignore-scripts --pack-destination "$TMP" >"$TMP/pack.out" 2>"$TMP/pack.err"; then
    TGZ="$TMP/$(tail -n 1 "$TMP/pack.out")"
    ok "npm pack -> $(basename "$TGZ")"
  else cat "$TMP/pack.err" >&2; fail "npm pack"; exit 1; fi
else
  TGZ="$SUPPLIED_TGZ"
  ok "reuse existing tarball without build/repack"
fi
if ! cp "$TGZ" "$TMP/candidate.tgz"; then fail "candidate tarball copy"; exit 1; fi
TGZ="$TMP/candidate.tgz"

node - "$TGZ" <<'NODE' || { fail "actual tarball inventory"; exit 1; }
const fs = require("node:fs");
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const bytes=fs.readFileSync(process.argv[2]);
// tar runs beside the tarball with a relative name: GNU tar (Git Bash on Windows) reads "C:\\..." as a remote host.
const tarIn={cwd:require('node:path').dirname(process.argv[2])},tgzName=require('node:path').basename(process.argv[2]);
const names=execFileSync('tar',['-tzf',tgzName],{...tarIn,encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n');
if(names.some(p=>!/^package\/[A-Za-z0-9._/@+-]+$/.test(p))||new Set(names).size!==names.length)throw Error('Unsafe or duplicate tarball name');
const types=execFileSync('tar',['-tvzf',tgzName],{...tarIn,encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n');
if(types.length!==names.length||types.some(line=>!['-','d'].includes(line[0])))throw Error('Tarball links and special entries are refused before extraction');
const entries=names.filter(p=>!p.endsWith('/'));
if(entries.some(p=>!p.startsWith('package/')||p.includes('..'))||new Set(entries).size!==entries.length)throw Error('Unexpected or duplicate tarball member');
const files=entries.map(p=>p.slice('package/'.length)).sort();
const allowed = (p) => p === "package.json" || p.startsWith("dist/") || p.startsWith("schemas/") || p.startsWith("examples/worlds/flow-diagram/") || p.startsWith("tasks/excalidraw/") || ["README.md", "LICENSE", "NOTICE", "CHANGELOG.md"].includes(p);
const extra = files.filter((p) => !allowed(p));
const required = ["README.md", "LICENSE", "NOTICE", "CHANGELOG.md", "dist/cli/main.js", "dist/index.js", "schemas/world-package-manifest.v1.schema.json", "schemas/checker-bundle-manifest.v1.schema.json", "schemas/world.v1.schema.json", "schemas/world.v2.schema.json", "schemas/bench.v1.json", "tasks/excalidraw/world/world.json", "tasks/excalidraw/library.json", "dist/adapters/excalidraw/engine/engine.js", "dist/adapters/excalidraw/engine/fonts/Cascadia/LICENSE", "dist/player/assets/player.js", "dist/player/assets/player.css", "dist/player/assets/tokens.css", "dist/player/assets/index.html", "dist/host/server.js", "examples/worlds/flow-diagram/world.json"];
const missing = required.filter((p) => !files.includes(p));
const packageMetadata = JSON.parse(execFileSync('tar',['-xOzf',tgzName,'package/package.json'],{...tarIn,encoding:'utf8',maxBuffer:1024*1024}));
// prepack builds dist/ before npm pack/publish; nothing may run when a user installs the package.
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter(name => Object.hasOwn(packageMetadata.scripts ?? {}, name));
if (packageMetadata.private !== false || !packageMetadata.bin?.practonaut) { console.error('test:pack: FAIL package must be public with a practonaut bin'); process.exit(1); }
// The MCP Registry verifies npm ownership through mcpName in the published package.json; server.json itself is not shipped.
if (packageMetadata.mcpName !== 'io.github.godarg/practonaut') { console.error('test:pack: FAIL package.json must carry mcpName io.github.godarg/practonaut'); process.exit(1); }
if (files.includes('server.json')) { console.error('test:pack: FAIL server.json belongs to the registry entry, not the package'); process.exit(1); }
console.log(`test:pack: exact candidate: ${files.length} files, ${bytes.length} bytes packed, sha256=${createHash('sha256').update(bytes).digest('hex')}`);
let bad = false;
if (lifecycle.length) { console.error(`test:pack: FAIL install-time lifecycle scripts: ${lifecycle.join(', ')}`); bad = true; } else console.log('test:pack: ok   no install-time lifecycle scripts');
if (extra.length) { console.error(`test:pack: FAIL files outside the allowlist: ${extra.join(", ")}`); bad = true; } else console.log("test:pack: ok   only allowlisted files in the tarball");
if (missing.length) { console.error(`test:pack: FAIL required files missing from the tarball: ${missing.join(", ")}`); bad = true; } else console.log("test:pack: ok   all required files present");
process.exit(bad ? 1 : 0);
NODE


mkdir -p "$TMP/empty"
cd "$TMP/empty"
NPX=(npx --yes --prefer-offline --no-audit --no-fund --package "$TMP/candidate.tgz" -- practonaut)
if "${NPX[@]}" --help >"$TMP/npx-help.out" 2>"$TMP/npx-help.err" && grep -q "practonaut play" "$TMP/npx-help.out"; then ok "npx practonaut --help (empty directory)"; else cat "$TMP/npx-help.err" >&2; fail "npx practonaut --help"; fi
for WORLD in "$ROOT/examples/worlds/flow-diagram" ""; do
  node - "$WORLD" "${NPX[@]}" <<'NODE'
const {spawn}=require('node:child_process');
const [world,...command]=process.argv.slice(2);
// Ctrl+C goes to the CLI process itself (its pid is in the token file name): a signal to npx alone
// does not reach a CLI behind Linux's dash, and npx then reports its own interruption, not the CLI's.
const posix=process.platform!=='win32';
const child=spawn(command[0],[...command.slice(1),'serve',...(world?[world]:[]),'--no-open','--mirror','off'],{stdio:['pipe','pipe','pipe']});
let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
const timer=setTimeout(()=>{console.error(out);child.kill('SIGKILL');process.exit(1);},60_000);
const poll=setInterval(()=>{
  const link=/^Open: http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}$/m.test(out),token=/^Token file: (.+)$/m.exec(out)?.[1];
  if(!link||!token)return;
  clearInterval(poll);
  if(!token.startsWith(process.env.PRACTONAUT_HOME)){console.error('token outside PRACTONAUT_HOME: '+token);process.exit(1);}
  if(!/world flow-diagram/.test(out)){console.error(out);process.exit(1);}
  // Windows cannot deliver Ctrl+C to another process; there the session is ended and only the link is checked.
  child.once('exit',code=>{clearTimeout(timer);process.exit(code===0||!posix?0:1);});if(posix)process.kill(Number(/session-(\d+)-[0-9a-f]{32}\.token$/.exec(token)[1]),'SIGINT');else child.kill();
},50);
NODE
  RC=$?
  [ $RC -eq 0 ] && ok "npx practonaut serve ${WORLD:+<world> }--no-open prints a one-use link and stops on Ctrl+C" || fail "npx practonaut serve ${WORLD:+<world> }--no-open -> exit $RC"
done
# The one-line agent setup, exactly as the MCP Registry entry starts it: the arguments come from
# server.json (`mcp --task excalidraw/connect`, default mirror) and must answer initialize and tools/list.
node - "$ROOT/server.json" "${NPX[@]}" <<'NODE'
const {spawn}=require('node:child_process');
const [serverJson,...command]=process.argv.slice(2);
const entry=JSON.parse(require('node:fs').readFileSync(serverJson,'utf8')).packages.find(p=>p.registryType==='npm');
if(entry.packageArguments.some(a=>a.type!=='positional'||typeof a.value!=='string')){console.error('server.json arguments must be literal positional values');process.exit(1);}
const args=entry.packageArguments.map(a=>a.value);
if(args.join(' ')!=='mcp --task excalidraw/connect'){console.error('server.json arguments: '+args.join(' '));process.exit(1);}
const child=spawn(command[0],[...command.slice(1),...args],{stdio:['pipe','pipe','pipe']});
let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
const timer=setTimeout(()=>{console.error(err);child.kill('SIGKILL');process.exit(1);},90_000);
const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'pack-smoke',version:'1'}}});
const poll=setInterval(()=>{
  const lines=out.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {invalid:l};}});
  if(lines.some(m=>m.invalid)){console.error('non-JSON-RPC output on stdout');process.exit(1);}
  if(lines.some(m=>m.id===1)&&!lines.some(m=>m.id===2)&&!poll.sent){poll.sent=true;send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/list'});}
  const tools=lines.find(m=>m.id===2)?.result?.tools;
  if(!tools)return;
  clearInterval(poll);
  const names=tools.map(t=>t.name).sort().join(',');
  if(names!=='act,check_result,explain_result,list_actions,observe,reset,undo'){console.error('tools: '+names);process.exit(1);}
  if(lines.find(m=>m.id===1).result?.serverInfo?.name!=='practonaut'||!/#code=[0-9a-f]{32}/.test(err)||/#code=/.test(out)){console.error('initialize or watch link wrong');process.exit(1);}
  child.once('exit',code=>{clearTimeout(timer);process.exit(0);});child.stdin.end();
},50);
NODE
RC=$?
[ $RC -eq 0 ] && ok "npx <tarball> with the server.json arguments (mcp --task excalidraw/connect) answers initialize and tools/list, link on stderr only" || fail "npx <tarball> mcp --task (server.json arguments) -> exit $RC"
[ -z "$(ls -A "$TMP/empty")" ] && ok "npx left the working directory empty" || fail "npx wrote into the working directory: $(ls -A "$TMP/empty")"

mkdir -p "$TMP/app"
cd "$TMP/app"
printf '{"name":"pack-smoke","private":true}\n' > package.json
if npm install --omit=dev --no-audit --no-fund --ignore-scripts --prefer-offline "$TMP/candidate.tgz" >"$TMP/install.log" 2>&1; then ok "npm install of the tarball into an empty project"; else cat "$TMP/install.log" >&2; fail "npm install"; echo "test:pack: FAILED" >&2; exit 1; fi
BIN="$TMP/app/node_modules/.bin/practonaut"

"$BIN" tasks list >"$TMP/tasks.out"; RC=$?
if [ $RC -eq 0 ] && grep -q "^  insert-between " "$TMP/tasks.out"; then ok "installed practonaut tasks list"; else cat "$TMP/tasks.out" >&2; fail "installed tasks list -> exit $RC"; fi
LIB="$TMP/app/node_modules/practonaut/tasks/excalidraw/sources/connect"
"$BIN" tasks from-scenes "$LIB/start.excalidraw" "$LIB/goal.excalidraw" --out "$TMP/scenes" >"$TMP/scenes.out"; RC=$?
if [ $RC -eq 0 ] && [ -f "$TMP/scenes/world/world.json" ] && [ -f "$TMP/scenes/oracle.json" ]; then ok "installed tasks from-scenes"; else cat "$TMP/scenes.out" >&2; fail "installed tasks from-scenes -> exit $RC"; fi

V="$("$BIN" --version)"; RC=$?
EXPECTED_V="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
if [ $RC -eq 0 ] && [ "$V" = "$EXPECTED_V" ]; then ok "practonaut --version -> $V"; else fail "practonaut --version -> exit $RC, '$V' (expected $EXPECTED_V)"; fi

"$BIN" pack "$ROOT/examples/worlds/minimal" --out "$TMP/installed.pnworld" >/dev/null; RC=$?
[ $RC -eq 0 ] && ok "installed practonaut pack (exit 0)" || fail "installed practonaut pack -> exit $RC"
"$BIN" validate "$TMP/installed.pnworld" >"$TMP/validate.out"; RC=$?
if [ $RC -eq 0 ]; then ok "installed practonaut validate -> $(head -n 1 "$TMP/validate.out")"; else cat "$TMP/validate.out" >&2; fail "installed practonaut validate -> exit $RC"; fi

"$BIN" pack "$ROOT/examples/worlds/flow-diagram" --out "$TMP/flow.pnworld" >/dev/null; RC=$?
[ $RC -eq 0 ] && ok "installed normative-world pack" || fail "normative-world pack -> exit $RC"
cat > "$TMP/actions.json" <<'JSON'
[{"name":"reconnect_end","params":{"id":"ab","end":"end","target":"c"},"baseStep":0},{"name":"disconnect","params":{"id":"bc"},"baseStep":1},{"name":"delete_step","params":{"id":"b"},"baseStep":2}]
JSON
"$BIN" run "$TMP/flow.pnworld" --seed 42 --task T3 --actions "$TMP/actions.json" --export "$TMP/result" > "$TMP/run.out"; RC=$?
[ $RC -eq 0 ] && ok "installed real-engine run and native/SVG export" || fail "installed run -> exit $RC"
"$BIN" check "$TMP/result.excalidraw" --world "$TMP/flow.pnworld" --pair "$TMP/result.session.json" > "$TMP/check.out"; RC=$?
[ $RC -eq 0 ] && ok "installed separate end-state check" || { cat "$TMP/check.out" >&2; fail "installed check -> exit $RC"; }

"$BIN" bench --agent oracle --tasks connect --mirror off --out "$TMP/bench.json" >"$TMP/bench.out" 2>"$TMP/bench.err"; RC=$?
if [ $RC -eq 0 ] && grep -q "1 run, 1 passed" "$TMP/bench.out"; then ok "installed bench --agent oracle (MCP through the installed bridge)"; else cat "$TMP/bench.err" >&2; fail "installed bench -> exit $RC"; fi
"$BIN" report "$TMP/bench.json" --html "$TMP/bench.html" >/dev/null; RC=$?
if [ $RC -eq 0 ] && grep -q -- "--pn-color-bg" "$TMP/bench.html"; then ok "installed report --html inlines the design tokens"; else fail "installed report --html -> exit $RC"; fi

"$BIN" setup; RC=$?
[ $RC -eq 0 ] && ok "installed explicit Chromium setup" || fail "installed setup -> exit $RC"
node "$ROOT/tools/pack-smoke.mjs" "$BIN" "$TMP/flow.pnworld"; RC=$?
[ $RC -eq 0 ] && ok "installed CLI Player/MCP smoke" || fail "installed CLI Player/MCP smoke -> exit $RC"

node --input-type=module - "$TMP/app/node_modules/practonaut" "$TMP/flow.pnworld" <<'NODE' || FAILED=1
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root=process.argv[2];
const load=path=>import(pathToFileURL(join(root,'dist',path)).href);
const {readWorldPackageFile}=await load('package/index.js');
const {loadWorldPackage}=await load('world/index.js');
const {startHost}=await load('host/server.js');
const host=await startHost(loadWorldPackage(await readWorldPackageFile(process.argv[3])),{seed:42,taskId:'T3'});
try {
 assert.equal((await fetch(host.origin+'/player.js')).status,200);
 const bootstrap=await fetch(host.origin+'/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:host.code})});
 const auth=await bootstrap.json();assert.equal(auth.ok,true);
 const headers={'Content-Type':'application/json','X-Practonaut-Token':auth.value.token};
 let revision=0;
 for(const action of [{name:'reconnect_end',params:{id:'ab',end:'end',target:'c'},baseStep:0},{name:'disconnect',params:{id:'bc'},baseStep:1},{name:'delete_step',params:{id:'b'},baseStep:2}]) {
  const response=await fetch(host.origin+'/api/act',{method:'POST',headers,body:JSON.stringify({expectedRevision:revision,action})});
  const reply=await response.json();assert.equal(reply.ok,true);assert.equal(reply.value.mirrorConfirmed,true);revision=reply.value.view.revision;
 }
 const checked=await (await fetch(host.origin+'/api/check',{method:'POST',headers,body:JSON.stringify({expectedRevision:revision})})).json();assert.equal(checked.ok,true);assert.equal(checked.value.passed,true);assert.equal(checked.value.mode,'real-engine');
 const png=await fetch(host.origin+'/api/tool.png',{headers});assert.equal(png.headers.get('content-type'),'image/png');
 console.log('test:pack: ok   installed local Player, authenticated host, mirrored task and PNG');
}finally{await host.close();}
NODE

cd "$ROOT"
node src/cli/main.ts pack examples/worlds/minimal --out "$TMP/repo.pnworld" >/dev/null || fail "repository pack"
A="$(shasum -a 256 "$TMP/installed.pnworld" | cut -d' ' -f1)"
B="$(shasum -a 256 "$TMP/repo.pnworld" | cut -d' ' -f1)"
if [ "$A" = "$B" ]; then ok "installed and repository world packs are byte-identical in this source/environment ($A)"; else fail "pack differs: installed $A, repository $B"; fi

if [ $FAILED -eq 0 ]; then echo "test:pack: PASSED"; else echo "test:pack: FAILED" >&2; fi
exit $FAILED
