// Trusted checker-bundle packing, separate from world packing and never part of a world.
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../src/canonical/index.ts";
import { readCheckerBundle, CheckerBundleManifestSchema, LIMITS } from "../src/package/index.ts";
import type { CheckerBundleManifest } from "../src/package/index.ts";
import { writeStoredZip } from "../src/package/zip-writer.ts";
// zip writer is deliberately shared only by trusted packing, not attack fixtures.
export async function packChecker(source:string):Promise<Buffer>{
 const body=await readFile(source+"/checker.json");const raw=JSON.parse(body.toString()) as {world:{id:string;version:string}};
 const manifest:CheckerBundleManifest={format:"practonaut.checker-bundle",schemaVersion:"1.0.0",world:raw.world,files:[{path:"checker.json",sha256:sha256Hex(body),size:body.length,mediaType:"application/json"}]};
 CheckerBundleManifestSchema.parse(manifest);const bytes=writeStoredZip([{name:"manifest.json",data:Buffer.from(canonicalJson(manifest)+"\n")},{name:"checker.json",data:body}],LIMITS);await readCheckerBundle(bytes);return bytes;
}
