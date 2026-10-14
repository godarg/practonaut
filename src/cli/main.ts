#!/usr/bin/env node
import { cliText, getCliLanguage, setCliLanguage } from './messages.ts';
import { commandHelp, topHelp } from './help.ts';
import { withInvocation } from './invocation.ts';
// practonaut CLI (foundation commands).
//
// Exit codes (stable, documented in --help):
//   0  success
//   1  usage error (unknown command or option, missing argument, unreadable input path,
//      output path not writable)
//   2  package rejected (validate) or source rejected (pack); the output names the error code
//   3  environment missing (doctor: a required check failed)
import { statSync } from "node:fs";
import { commandServe } from "./serve.ts";
import { rename, rm, writeFile } from "node:fs/promises";
import { PackageError } from "../package/errors.ts";
import { packWorldWithManifest } from "../package/packer.ts";
import { readWorldPackage, readWorldPackageFile, type WorldPackage } from "../package/reader.ts";
import { formatChecks, requiredOk, runChecks } from "./doctor.ts";
import { displayPath, readableText, safeJson, safeText } from "./output.ts";
import { commandRun, commandCheck, RuntimeError } from "./runtime.ts";
import { loadWorldPackage, WorldError } from "../world/index.ts";
import { commandRecord, commandCompile } from './authoring.ts';
import { AuthoringError } from '../authoring/index.ts';
import { CheckerError } from '../checker/index.ts';
import { commandMcp } from './mcp.ts';
import { commandBench, commandCompare, commandReport } from './bench.ts';
import { worldContentHash } from '../bench/world.ts';
import { commandSetup } from './setup.ts';
import { commandTasks } from './tasks.ts';
import {PACKAGE_VERSION} from '../version.ts';

export const EXIT = Object.freeze({ OK: 0, USAGE: 1, REJECTED: 2, ENVIRONMENT: 3 });



function version(): string {
  return PACKAGE_VERSION;
}

class UsageError extends Error {}
let jsonErrors = false;
/** Text by default; one JSON line with --json. Messages are catalogued, never upstream stacks. In
 * text, the catalogue's line breaks and letters stay readable (umlauts, typographic quotes); controls,
 * bidi and format characters are still escaped, and values taken from input were escaped with
 * `safeText` when the message was built. */
function reportError(code: string, message: string): void {
  if (jsonErrors) printErr(safeJson({ ok: false, error: { code, message } }));
  else printErr(`practonaut: ${message.trimEnd().split('\n').map(line => readableText(line)).join('\n')} [${safeText(code)}]`);
}

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: string[], valued: ReadonlySet<string>, booleans: ReadonlySet<string>): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(0, eq) : a;
      if (valued.has(name)) {
        const v = eq >= 0 ? a.slice(eq + 1) : args[++i];
        if (v === undefined || v === "") throw new UsageError(cliText("optionValue", { option: name }));
        flags.set(name, v);
      } else if (booleans.has(name) && eq < 0) {
        flags.set(name, true);
      } else {
        throw new UsageError(cliText("optionUnknown", { option: safeText(a) }));
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function print(line: string): void {
  process.stdout.write(line + "\n");
}

function printErr(line: string): void {
  process.stderr.write(line + "\n");
}

function declaredRights(pkg: WorldPackage): { license: string; privateSource: boolean; redistributionGrantVerified: false } {
  const world = loadWorldPackage(pkg);
  return { license: world.rights.license, privateSource: Boolean(world.provenance.privateSource), redistributionGrantVerified: false };
}

function describe(pkg: WorldPackage, path: string, contentHash: string): Record<string, unknown> {
  return {
    ok: true,
    kind: pkg.kind,
    path,
    archive: { size: pkg.archiveSize, sha256: pkg.archiveSha256 },
    schemaVersion: pkg.manifest.schemaVersion,
    world: pkg.manifest.world,
    // SHA-256 of the world's canonical JSON: the content hash a bench report names (PADR-0036).
    contentHash,
    entry: pkg.manifest.entry,
    declaredRights: declaredRights(pkg),
    files: [...pkg.files.values()].map((f) => ({ path: f.path, mediaType: f.mediaType, size: f.size, sha256: f.sha256 })),
  };
}

function printPackage(pkg: WorldPackage, path: string, contentHash: string): void {
  print(cliText("packageOk", { id: safeText(pkg.manifest.world.id), version: safeText(pkg.manifest.world.version) }));
  print(cliText("packageArchive", { path: safeText(path), size: pkg.archiveSize, hash: pkg.archiveSha256 }));
  print(cliText("packageContentHash", { hash: contentHash }));
  print(cliText("packageManifest", { schema: pkg.manifest.schemaVersion, entry: safeText(pkg.manifest.entry) }));
  print(cliText("packageDeclaredRights", { license: declaredRights(pkg).license }));
  for (const f of pkg.files.values()) print(`  ${safeText(f.path)}  ${f.mediaType}  ${f.size} B  ${f.sha256}`);
}

function rejection(e: PackageError | WorldError, path: string, json: boolean, what: string): number {
  const entry = e instanceof PackageError ? e.entry : undefined;
  if (json) print(safeJson({ ok: false, path, error: { code: e.code, message: e.message, entry } }));
  else printErr(cliText("packageRejected", { what: cliText(what === "source" ? "source" : "package"), path: safeText(path), code: safeText(e.code), detail: safeText(e.message), entry: entry ? cliText("packageEntry", { entry: safeText(entry) }) : "" }));
  return EXIT.REJECTED;
}

async function cmdValidate(args: string[]): Promise<number> {
  const p = parseArgs(args, new Set(), new Set(["--json"]));
  if (p.positional.length !== 1) throw new UsageError(cliText("validateUsage"));
  const json = p.flags.has("--json");
  const file = p.positional[0] as string;
  const shown = displayPath(file);
  // A path that is not a regular file is a usage error (exit 1), not a rejected package.
  // stat (not open) cannot block on a FIFO; readArchiveFile re-checks the type on the open handle.
  let isFile: boolean;
  try {
    isFile = statSync(file).isFile();
  } catch (e) {
    throw new UsageError(cliText("readFailed", { path: safeText(shown), code: (e as NodeJS.ErrnoException).code ?? "error" }));
  }
  if (!isFile) throw new UsageError(cliText("regularFile", { path: safeText(shown) }));
  let pkg: WorldPackage, contentHash: string;
  try {
    pkg = await readWorldPackageFile(file);
    contentHash = worldContentHash(loadWorldPackage(pkg));
  } catch (e) {
    if (e instanceof PackageError || e instanceof WorldError) return rejection(e, shown, json, "package");
    const code = (e as NodeJS.ErrnoException).code ?? "error";
    throw new UsageError(cliText("readFailed", { path: safeText(shown), code }));
  }
  if (json) print(safeJson(describe(pkg, shown, contentHash)));
  else printPackage(pkg, shown, contentHash);
  return EXIT.OK;
}

async function cmdPack(args: string[]): Promise<number> {
  const p = parseArgs(args, new Set(["--out"]), new Set(["--json"]));
  if (p.positional.length !== 1) throw new UsageError(cliText("packUsage"));
  const out = p.flags.get("--out");
  if (typeof out !== "string") throw new UsageError(cliText("packOutput"));
  const json = p.flags.has("--json");
  const dir = p.positional[0] as string;
  const shownDir = displayPath(dir);
  const shownOut = displayPath(out);
  let pkg: WorldPackage;
  let bytes: Buffer;
  let skipped: string[];
  let contentHash: string;
  try {
    const r = await packWorldWithManifest(dir);
    bytes = r.bytes;
    skipped = r.skipped;
    pkg = await readWorldPackage(bytes); // self-check: the packer must emit what the reader accepts
    contentHash = worldContentHash(loadWorldPackage(pkg));
  } catch (e) {
    if (e instanceof PackageError || e instanceof WorldError) return rejection(e, shownDir, json, "source");
    const code = (e as NodeJS.ErrnoException).code ?? "error";
    throw new UsageError(cliText("sourceFailed", { path: safeText(shownDir), code }));
  }
  // Write next to the target and rename: a reader never sees a half-written package, and an
  // existing symlink at the target is replaced, not followed.
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, bytes, { flag: "wx", mode: 0o644 });
    await rename(tmp, out);
  } catch (e) {
    await rm(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code ?? "error";
    throw new UsageError(cliText("writeFailed", { path: safeText(shownOut), code }));
  }
  if (json) print(safeJson({ ...describe(pkg, shownOut, contentHash), source: shownDir, skipped }));
  else {
    printPackage(pkg, shownOut, contentHash);
    if (skipped.length > 0) print(cliText("packageSkipped", { files: skipped.map(safeText).join(", ") }));
  }
  return EXIT.OK;
}

async function cmdDoctor(args: string[]): Promise<number> {
  const p = parseArgs(args, new Set(), new Set(["--json", "--dev", "--adapter"]));
  if (p.positional.length > 0) throw new UsageError(cliText("doctorUsage"));
  const checks = await runChecks(p.flags.has("--dev") ? "dev" : "runtime", process.cwd(), p.flags.has("--adapter"));
  const ok = requiredOk(checks);
  if (p.flags.has("--json")) print(safeJson({ ok, checks }));
  else print(formatChecks(checks));
  return ok ? EXIT.OK : EXIT.ENVIRONMENT;
}

export async function main(argv: string[]): Promise<number> {
  try {
    setCliLanguage("en");
    if (argv[0]?.startsWith("--lang=")) argv = ["--lang", argv[0].slice("--lang=".length), ...argv.slice(1)];
    if (argv[0] === "--lang") {
      if (argv[1] !== "en" && argv[1] !== "de") throw new UsageError(cliText("languageInvalid"));
      setCliLanguage(argv[1]); argv = argv.slice(2);
    }
    jsonErrors = argv.includes("--json");
    // Options without a command belong to play: `practonaut --no-open` is `practonaut play --no-open`.
    if (argv[0]?.startsWith("-") && !["--help", "-h", "--version", "-V"].includes(argv[0])) argv = ["play", ...argv];
    const [cmd, ...given] = argv;
    // --json is a global switch for error output; validate, pack, doctor and tasks also take it.
    const rest = cmd === "validate" || cmd === "pack" || cmd === "doctor" || cmd === "tasks" || cmd === "report" || cmd === "compare" ? given : given.filter(arg => arg !== "--json");
    if (cmd !== undefined && (rest.includes("--help") || rest.includes("-h"))) {
      const text = commandHelp(cmd, getCliLanguage());
      if (text === undefined) throw new UsageError(cliText("commandUnknown", { command: safeText(cmd) }));
      print(withInvocation(text));
      return EXIT.OK;
    }
    switch (cmd) {
      case "--version":
      case "-V":
        if (rest.length > 0) throw new UsageError(cliText("versionUsage"));
        print(version());
        return EXIT.OK;
      case "--help":
      case "-h":
      case "help":
        print(withInvocation(topHelp(getCliLanguage())));
        return EXIT.OK;
      case "validate":
        return await cmdValidate(rest);
      case "pack":
        return await cmdPack(rest);
      case "run":
        return await commandRun(rest);
      case undefined:
      case "play":
      case "serve":
        return await commandServe(rest);
      case "check":
        return await commandCheck(rest);
      case "doctor":
        return await cmdDoctor(rest);
      case 'record': return await commandRecord(rest);
      case 'compile': return await commandCompile(rest);
      case 'mcp': return await commandMcp(rest);
      case 'bench': return await commandBench(rest);
      case 'report': return await commandReport(rest);
      case 'compare': return await commandCompare(rest);
      case 'eval': throw new RuntimeError('usage', cliText('evalRemoved'));
      case 'setup': return await commandSetup(rest);
      case 'tasks': return await commandTasks(rest);
      default:
        throw new UsageError(cliText("commandUnknown", { command: safeText(cmd) }));
    }
  } catch (e) {
    if (e instanceof RuntimeError || e instanceof AuthoringError || e instanceof CheckerError || (e instanceof Error && "code" in e && e.code === "E_WORLD_INVALID")) {
      const code = String((e as Error & { code: string }).code);
      reportError(code, e.message);
      return code === 'browser_runtime_missing' || code === 'browser_start_failed' ? EXIT.ENVIRONMENT : code === "usage" ? EXIT.USAGE : EXIT.REJECTED;
    }
    if (e instanceof Error && /^(recording_|replay_mismatch:)/.test(e.message)) {
      reportError(e.message.split(':')[0]!, e.message);
      return EXIT.REJECTED;
    }
    if (e instanceof UsageError) {
      if (jsonErrors) printErr(safeJson({ ok: false, error: { code: "usage", message: e.message } }));
      else { printErr(`practonaut: ${e.message}`); printErr(cliText("helpHint")); }
      return EXIT.USAGE;
    }
    // Session start-up failures (offline probe, unsafe private directory, port, file system).
    if (e instanceof Error && typeof (e as Error & { code?: unknown }).code === "string") {
      reportError(String((e as Error & { code: string }).code), e.message);
      return EXIT.ENVIRONMENT;
    }
    // Anything else is a defect or an environment this CLI does not know; one line, never a stack.
    reportError('unexpected', cliText('unexpectedFailure', { detail: e instanceof Error ? e.message.split('\n')[0]!.slice(0, 240) : String(e).slice(0, 240) }));
    return EXIT.ENVIRONMENT;
  }
}

process.exitCode = await main(process.argv.slice(2));
