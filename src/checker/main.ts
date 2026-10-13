/** Separate evaluator entry: bounded stdin JSON request, no action runtime or app engine. */
import { z } from "zod";
import { parseJsonEntry } from "../package/json.ts";
import { validateWorld } from "../world/schema.ts";
import { checkSubmission, CheckerError, validateCheckerData } from "./index.ts";
const requestSchema = z.strictObject({ world: z.unknown(), input: z.string(), options: z.strictObject({ seed: z.number().int().safe().optional(), taskId: z.string().max(64).optional(), fuel: z.number().int().min(0).max(1_000_000).optional(), format: z.enum(["session", "excalidraw"]).optional(), bundle: z.unknown().optional() }).optional() });
async function main(): Promise<void> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string); size += b.length;
    if (size > 32 * 1024 * 1024) throw new CheckerError("artifact_invalid", "checker request too large");
    chunks.push(b);
  }
  const raw = parseJsonEntry(Buffer.concat(chunks), "checker-request.json", 64);
  const p = requestSchema.safeParse(raw);
  if (!p.success) throw new CheckerError("checker_invalid", "invalid checker request");
  const world = validateWorld(p.data.world);
  const { bundle, seed, taskId, fuel, format } = p.data.options ?? {};
  const options = { ...(seed === undefined ? {} : { seed }), ...(taskId === undefined ? {} : { taskId }), ...(fuel === undefined ? {} : { fuel }), ...(format === undefined ? {} : { format }) };
  const verdict = checkSubmission(world, p.data.input, { ...options, ...(bundle === undefined ? {} : { bundle: validateCheckerData(bundle, world) }) });
  process.stdout.write(JSON.stringify(verdict) + "\n");
}
main().catch((error: unknown) => {
  const e = error instanceof CheckerError ? error : new CheckerError("checker_invalid", error instanceof Error ? error.message : "unknown checker failure");
  process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, details: e.details } }) + "\n"); process.exitCode = 1;
});
