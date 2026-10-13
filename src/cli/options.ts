/**
 * `--option=value` means the same as `--option value` for every option that takes a value. MCP
 * registries render named arguments this way, and many people type it.
 *
 * Only tokens in option position are split, at the first `=` (a value may contain `=`); a value
 * that itself looks like `--x=y` (for example a command template after `--agent`) is left alone.
 * An empty inline value (`--task=`) stays empty, so each parser refuses it exactly like a missing
 * value. Boolean options keep refusing `=`; tokens after a literal `--` are untouched.
 */
export function inlineOptionValues(args: readonly string[], valued: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') { out.push(...args.slice(i)); break; }
    if (valued.includes(arg)) { out.push(arg); if (i + 1 < args.length) out.push(args[++i]!); continue; }
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2 && valued.includes(arg.slice(0, eq))) { out.push(arg.slice(0, eq), arg.slice(eq + 1)); continue; }
    out.push(arg);
  }
  return out;
}
