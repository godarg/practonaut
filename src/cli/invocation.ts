/**
 * How the user started the CLI, so suggested commands can be pasted back as they are. `npx practonaut`
 * (and `npm exec practonaut`) run the bin with `npm_command=exec`; everything else is `practonaut`.
 */
export function invocationName(env: NodeJS.ProcessEnv = process.env): string {
  return env.npm_command === 'exec' ? 'npx practonaut' : 'practonaut';
}

/** Command suggestions in help text, written as `practonaut <command>`, in the form the user started the CLI. */
export function withInvocation(text: string, name: string = invocationName()): string {
  if (name === 'practonaut') return text;
  // Not inside an existing `npx [-y] practonaut` and not a prefix like `practonaut:` or `practonaut.bench/1`.
  return text.replace(/(?<![\w./-]|npx |npx -y |mcp add )practonaut(?= (?:[a-z<[{-]|$))/gm, name);
}
