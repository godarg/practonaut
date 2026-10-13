// Foundation demo: package safety.
// Packs examples/worlds/minimal deterministically to .local/demo/minimal.pnworld, validates it,
// then builds the hostile fixture packages in a temp directory and shows the code each one is
// rejected with. Offline. This demonstrates the package format and validator only; there is no
// runtime, player or learning claim here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PackageError } from "../src/package/errors.ts";
import { packWorld } from "../src/package/packer.ts";
import { readCheckerBundleFile, readWorldPackageFile } from "../src/package/reader.ts";
import { loadWorldPackage } from "../src/world/index.ts";
import { Session } from "../src/core/index.ts";
import { checkState } from "../src/checker/index.ts";
import { solution } from "../tests/integration/solutions.ts";
import { HOSTILE_CASES } from "../tests/support/fixtures.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const out = join(ROOT, ".local", "demo", "minimal.pnworld");

process.stdout.write("Practonaut demo: package safety and model-only runtime\n");
process.stdout.write("(model-only replay; real engine is exercised by test:adapter and test:integration)\n\n");

mkdirSync(join(ROOT, ".local", "demo"), { recursive: true });
const bytes = await packWorld(join(ROOT, "examples", "worlds", "minimal"));
writeFileSync(out, bytes);
const again = await packWorld(join(ROOT, "examples", "worlds", "minimal"));
const pkg = await readWorldPackageFile(out);
process.stdout.write("1. Pack and validate examples/worlds/minimal -> .local/demo/minimal.pnworld\n");
process.stdout.write(`   world      ${pkg.manifest.world.id}, version ${pkg.manifest.world.version}\n`);
process.stdout.write(`   archive    ${pkg.archiveSize} bytes, sha256 ${pkg.archiveSha256}\n`);
process.stdout.write(`   repack     ${again.equals(bytes) ? "byte-identical" : "DIFFERENT (determinism broken)"}\n`);
for (const f of pkg.files.values()) process.stdout.write(`   file       ${f.path.padEnd(20)} ${f.mediaType.padEnd(17)} ${String(f.size).padStart(4)} B\n`);

process.stdout.write(`\n2. Hostile packages (${HOSTILE_CASES.length}), built in a temp directory and read through the same validator\n`);
const tmp = mkdtempSync(join(tmpdir(), "practonaut-demo-"));
let unexpected = 0;
try {
  for (const c of HOSTILE_CASES) {
    const f = join(tmp, `${c.id}.pnworld`);
    writeFileSync(f, c.build());
    let code = "ACCEPTED";
    try {
      await (c.reader === "world" ? readWorldPackageFile(f) : readCheckerBundleFile(f));
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      code = e.code;
    }
    const mark = code === c.expected ? "rejected" : "UNEXPECTED";
    if (code !== c.expected) unexpected++;
    process.stdout.write(`   ${mark.padEnd(10)} ${code.padEnd(27)} ${c.description}\n`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.stdout.write(`\n${HOSTILE_CASES.length - unexpected} of ${HOSTILE_CASES.length} hostile packages rejected with the expected code.\n`);
process.exitCode = unexpected === 0 && again.equals(bytes) ? 0 : 1;

const flowBytes=await packWorld(join(ROOT,"examples","worlds","flow-diagram"));
writeFileSync(join(ROOT,".local","demo","flow-diagram.pnworld"),flowBytes);
const flow=loadWorldPackage(await readWorldPackageFile(join(ROOT,".local","demo","flow-diagram.pnworld")));
process.stdout.write("\n3. Headless flow-diagram, three seeds × T1/T2/T3 (model-only, no LLM)\n");
for(const seed of [1,42,20261003])for(const taskId of ["T1","T2","T3"]){
 const session=new Session(flow,seed,taskId);
 for(const action of solution(flow,seed,taskId)){const r=session.act(action);if(!r.ok)throw new Error(r.error.code);}
 const replay=session.checkReplay();const verdict=checkState(flow,session.state,{seed,taskId});
 if(!replay.ok||!verdict.passed)process.exitCode=1;
 process.stdout.write(`   seed ${seed}, ${taskId}: replay ${replay.ok}, goal ${verdict.passed}, hash ${session.hash}\n`);
}
