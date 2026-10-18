/** Separate evaluator entry: bounded stdin JSON request, no action runtime or app engine. */
import { z } from "zod";
import { parseJsonEntry } from "../package/json.ts";
import { validateWorld, WorldError } from "../world/schema.ts";
import { checkSubmission, CheckerError, validateCheckerData } from "./index.ts";
import { NATIVE_FORMAT_IDS, type NativeFormatId } from "./formats.ts";
import { MAX_TIMELINE, traceSession, type TraceEntry } from "./trace.ts";
const scalar = z.union([z.string().max(4096), z.number().int().safe(), z.boolean(), z.null()]);
const actionSchema = z.strictObject({ name: z.string().max(64), params: z.record(z.string().max(64), scalar), baseStep: z.number().int().nonnegative().safe().optional() });
/** A run's accepted mutations for the condition trace (PADR-0039); with it, the request is a trace of a session. */
const traceSchema = z.array(z.union([z.strictObject({ seq: z.number().int().nonnegative().safe(), op: z.literal("act"), action: actionSchema }), z.strictObject({ seq: z.number().int().nonnegative().safe(), op: z.enum(["undo", "reset"]) })])).max(MAX_TIMELINE);
const requestSchema = z.strictObject({ world: z.unknown(), input: z.string(), options: z.strictObject({ seed: z.number().int().safe().optional(), taskId: z.string().max(64).optional(), fuel: z.number().int().min(0).max(1_000_000).optional(), format: z.enum(["session", ...NATIVE_FORMAT_IDS] as ["session", ...NativeFormatId[]]).optional(), bundle: z.unknown().optional(), trace: traceSchema.optional() }).optional() });
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
  const { bundle, seed, taskId, fuel, format, trace } = p.data.options ?? {};
  const options = { ...(seed === undefined ? {} : { seed }), ...(taskId === undefined ? {} : { taskId }), ...(fuel === undefined ? {} : { fuel }), ...(format === undefined ? {} : { format }) };
  if (trace !== undefined) {
    if (bundle !== undefined || (format !== undefined && format !== "session")) throw new CheckerError("checker_invalid", "a trace judges a session without a bundle");
    process.stdout.write(JSON.stringify({ ok: true, trace: traceSession(world, p.data.input, trace as TraceEntry[], options) }) + "\n");
    return;
  }
  const verdict = checkSubmission(world, p.data.input, { ...options, ...(bundle === undefined ? {} : { bundle: validateCheckerData(bundle, world) }) });
  process.stdout.write(JSON.stringify(verdict) + "\n");
}
main().catch((error: unknown) => {
  // A world for an application this Practonaut does not have keeps its named code (PADR-0045).
  const e = error instanceof CheckerError ? error : error instanceof WorldError && error.code !== "E_WORLD_INVALID" ? new CheckerError(error.code, error.message) : new CheckerError("checker_invalid", error instanceof Error ? error.message : "unknown checker failure");
  process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, details: e.details } }) + "\n"); process.exitCode = 1;
});
