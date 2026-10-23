// Workflow allowlist check (PADR-0049 decision 2.8), part of `npm run check`.
//   node tools/check-workflows.ts [root]   exits 1 and names every problem.
// It reads every workflow and checks what the workflows say, not what a shell command does:
//  - every path handed to a cache or upload action, and every asset of `gh release create|upload`,
//    is literally in `.github/workflow-allowlist.json`; globs, unlisted expressions and bare roots
//    (`.`, `.local`, `~`, `${{ runner.temp }}`, the workspace) are refused;
//  - every other `uses:` is on the list of actions known not to save or publish files, pinned by SHA;
//  - the draw.io steps: setup, the layer and the deletion share one literal home under
//    `${{ runner.temp }}` (`PRACTONAUT_HOME`, `PN_DRAWIO_HOME`), the layer runs with
//    `PN_DRAWIO_REQUIRED=1`, the deletion runs `always()`, all after the step that lifts the AppArmor
//    restriction, and `PRACTONAUT_CHROMIUM_SANDBOX` is set at no level they see.
// The YAML reader (tools/yaml-subset.ts) takes the subset the workflows use and throws on anything
// else (anchors, aliases, tags, flow maps), so nothing it cannot read passes unchecked.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, type Yaml } from './yaml-subset.ts';

export interface WorkflowAllowlist {
  /** Every path a workflow may hand to a cache or upload action, literally. */
  paths: string[];
  /** Every asset argument of `gh release create` or `gh release upload`, literally. */
  releaseAssets: string[];
  /** Actions known not to save or publish files: `owner/repo@<40 hex>` → why. */
  actions: Record<string, string>;
}
const isMap = (value: Yaml | undefined): value is { [key: string]: Yaml } => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCacheOrUpload = (action: string): boolean => action === 'actions/cache' || action.startsWith('actions/cache/') || action.startsWith('actions/upload-artifact') || action.startsWith('actions/upload-pages-artifact');
const BARE_ROOTS = new Set(['', '.', './', '.local', '.local/', './.local', './.local/', '~', '~/', '/', '${{ runner.temp }}', '${{ runner.temp }}/', '${{ github.workspace }}', '${{ github.workspace }}/', '$GITHUB_WORKSPACE', '$RUNNER_TEMP', '$HOME']);
const GLOB = /[*?[\]!{}]/;
/** A path's own problem, before the list is consulted (also applied to the list itself). */
function pathProblem(path: string): string | undefined {
  if (BARE_ROOTS.has(path)) return `${JSON.stringify(path)} is a whole root`;
  const literal = path.replaceAll('${{ runner.temp }}', '').replaceAll('${{ github.workspace }}', '');
  if (literal.includes('$')) return `${JSON.stringify(path)} uses an expression or variable other than \${{ runner.temp }}`;
  if (GLOB.test(literal)) return `${JSON.stringify(path)} is a glob`;
  if (path.split('/').includes('..')) return `${JSON.stringify(path)} climbs with ..`;
  return undefined;
}
/** Asset arguments of every `gh release create|upload` in a run script. */
function releaseAssets(run: string): string[] {
  const valued = new Set(['--repo', '-R', '--title', '-t', '--notes', '-n', '--notes-file', '-F', '--target', '--discussion-category', '--notes-start-tag']);
  const assets: string[] = [];
  for (const command of run.split(/\n|;|&&|\|\|/)) {
    const words = command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const at = words.findIndex((word, index) => word === 'gh' && words[index + 1] === 'release' && ['create', 'upload'].includes(words[index + 2] ?? ''));
    if (at < 0) continue;
    const positional: string[] = [];
    for (let k = at + 3; k < words.length; k++) {
      const word = words[k]!;
      if (word.startsWith('-')) { if (valued.has(word)) k++; continue; }
      positional.push(word.replace(/^["']|["']$/g, ''));
    }
    assets.push(...positional.slice(1)); // the first is the tag
  }
  return assets;
}
const DRAWIO_VARIABLES = ['PRACTONAUT_HOME', 'PN_DRAWIO_HOME', 'PN_DRAWIO_REQUIRED', 'PRACTONAUT_CHROMIUM_SANDBOX'];
/** Whether a job may run on a Linux runner: its `runs-on`, or the matrix values it names, say so; anything else counts as Linux. */
function mayRunOnLinux(job: { [key: string]: Yaml }): boolean {
  const runsOn = job['runs-on'];
  if (typeof runsOn !== 'string') return true;
  const named = /^\$\{\{ matrix\.([A-Za-z0-9_-]+) \}\}$/.exec(runsOn)?.[1];
  if (named === undefined) return !/^(macos|windows)-/.test(runsOn);
  const strategy = isMap(job.strategy) && isMap(job.strategy.matrix) ? job.strategy.matrix[named] : undefined;
  return !Array.isArray(strategy) || strategy.some(value => typeof value !== 'string' || !/^(macos|windows)-/.test(value));
}
const HOME = /^\$\{\{ runner\.temp \}\}\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Every problem of one workflow file. */
export function checkWorkflow(name: string, text: string, allow: WorkflowAllowlist): string[] {
  const problems: string[] = [];
  let workflow: Yaml;
  try { workflow = parseYaml(text); } catch (error) { return [`${name}: ${(error as Error).message}`]; }
  if (!isMap(workflow) || !isMap(workflow.jobs)) return [`${name}: no jobs`];
  const envOf = (node: Yaml | undefined): { [key: string]: Yaml } => (isMap(node) && isMap(node.env) ? node.env : {});
  const workflowEnv = envOf(workflow);
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (!isMap(job)) { problems.push(`${name}: job ${jobId} is not a mapping`); continue; }
    if (job.uses !== undefined) { problems.push(`${name}: job ${jobId} calls a reusable workflow, which this check cannot see into`); continue; }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    steps.forEach((step, index) => {
      const where = `${name}: job ${jobId}, step ${index + 1}`;
      if (!isMap(step)) { problems.push(`${where} is not a mapping`); return; }
      if (typeof step.uses === 'string') {
        const [action, ref] = step.uses.split('@') as [string, string | undefined];
        if (!ref || !/^[0-9a-f]{40}$/.test(ref)) problems.push(`${where}: ${step.uses} is not pinned by a commit SHA`);
        if (isCacheOrUpload(action)) {
          const paths = isMap(step.with) && typeof step.with.path === 'string' ? step.with.path.split('\n').map(path => path.trim()).filter(Boolean) : [];
          if (!paths.length) problems.push(`${where}: ${action} names no path`);
          for (const path of paths) {
            const own = pathProblem(path);
            if (own) problems.push(`${where}: ${own}`);
            else if (!allow.paths.includes(path)) problems.push(`${where}: ${JSON.stringify(path)} is not in the workflow allowlist`);
          }
        } else if (!Object.hasOwn(allow.actions, step.uses)) problems.push(`${where}: ${step.uses} is not on the list of actions that save and publish nothing`);
      }
      if (typeof step.run === 'string') for (const asset of releaseAssets(step.run)) if (!allow.releaseAssets.includes(asset)) problems.push(`${where}: release asset ${JSON.stringify(asset)} is not in the workflow allowlist`);
    });
    // draw.io (decision 2.8): one literal home, the flag, the deletion, no sandbox variable.
    const runOf = (step: Yaml): string => (isMap(step) && typeof step.run === 'string' ? step.run : '');
    const find = (pattern: RegExp): number[] => steps.flatMap((step, index) => (pattern.test(runOf(step)) ? [index] : []));
    const setup = find(/\bsetup --app drawio\b/), layer = find(/\bnpm run test:drawio\b/), deletion = find(/\brm -rf "\$PN_DRAWIO_HOME"/);
    if (!setup.length && !layer.length && !deletion.length) continue;
    const where = `${name}: job ${jobId} (draw.io)`;
    if (setup.length !== 1 || layer.length !== 1 || deletion.length !== 1) { problems.push(`${where}: needs exactly one setup, one layer and one deletion step`); continue; }
    const [s, l, d] = [setup[0]!, layer[0]!, deletion[0]!];
    const lift = find(/kernel\.apparmor_restrict_unprivileged_userns=0/);
    if (!(s < l && l < d)) problems.push(`${where}: setup, layer and deletion must run in this order`);
    if (mayRunOnLinux(job) && (!lift.length || lift[0]! > s)) problems.push(`${where}: setup must run after the step that lifts the AppArmor restriction`);
    const home = envOf(steps[s]).PRACTONAUT_HOME;
    if (typeof home !== 'string' || !HOME.test(home)) problems.push(`${where}: setup's PRACTONAUT_HOME must be one literal folder under \${{ runner.temp }}`);
    else {
      if (envOf(steps[l]).PN_DRAWIO_HOME !== home) problems.push(`${where}: the layer's PN_DRAWIO_HOME is not setup's home`);
      if (envOf(steps[d]).PN_DRAWIO_HOME !== home) problems.push(`${where}: the deletion's PN_DRAWIO_HOME is not setup's home`);
      for (const path of allow.paths) if (path.startsWith(home) || home.startsWith(path.replace(/\/$/, ''))) problems.push(`${where}: the allowlisted path ${JSON.stringify(path)} would reach the draw.io home`);
    }
    if (envOf(steps[l]).PN_DRAWIO_REQUIRED !== '1') problems.push(`${where}: the layer must run with PN_DRAWIO_REQUIRED=1`);
    const deleteIf = isMap(steps[d]) ? steps[d].if : undefined;
    if (typeof deleteIf !== 'string' || !deleteIf.includes('always()')) problems.push(`${where}: the deletion must run always()`);
    for (const [level, env] of [['workflow', workflowEnv], ['job', envOf(job)], ['setup step', envOf(steps[s])], ['layer step', envOf(steps[l])], ['deletion step', envOf(steps[d])]] as const) {
      if (Object.hasOwn(env, 'PRACTONAUT_CHROMIUM_SANDBOX')) problems.push(`${where}: PRACTONAUT_CHROMIUM_SANDBOX is set at the ${level} level`);
    }
    for (const [level, env] of [['workflow', workflowEnv], ['job', envOf(job)]] as const) for (const variable of ['PRACTONAUT_HOME', 'PN_DRAWIO_HOME', 'PN_DRAWIO_REQUIRED']) if (Object.hasOwn(env, variable)) problems.push(`${where}: ${variable} is set at the ${level} level`);
    steps.forEach((step, index) => {
      const run = runOf(step);
      if (/GITHUB_ENV/.test(run) && DRAWIO_VARIABLES.some(variable => run.includes(variable))) problems.push(`${where}: step ${index + 1} sets a draw.io variable through $GITHUB_ENV`);
    });
  }
  return problems;
}

/** The list's own entries are held to the same path rules. */
export function checkAllowlist(allow: WorkflowAllowlist): string[] {
  const problems: string[] = [];
  for (const path of [...allow.paths, ...allow.releaseAssets]) { const own = pathProblem(path); if (own) problems.push(`allowlist: ${own}`); }
  for (const action of Object.keys(allow.actions)) {
    const [name, ref] = action.split('@');
    if (!ref || !/^[0-9a-f]{40}$/.test(ref)) problems.push(`allowlist: ${action} is not pinned by a commit SHA`);
    if (name && isCacheOrUpload(name)) problems.push(`allowlist: ${action} saves or publishes files`);
  }
  return problems;
}

export function checkRepository(root: string): string[] {
  const allow = JSON.parse(readFileSync(join(root, '.github/workflow-allowlist.json'), 'utf8')) as WorkflowAllowlist;
  const directory = join(root, '.github/workflows');
  const files = readdirSync(directory).filter(file => /\.ya?ml$/.test(file)).sort();
  const problems = [...checkAllowlist(allow), ...files.flatMap(file => checkWorkflow(file, readFileSync(join(directory, file), 'utf8'), allow))];
  // The draw.io layer must run in CI at all.
  if (!files.some(file => /\bnpm run test:drawio\b/.test(readFileSync(join(directory, file), 'utf8')))) problems.push('no workflow runs the draw.io layer (npm run test:drawio)');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
  const problems = checkRepository(root);
  for (const problem of problems) console.error(`workflows: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`workflows: ${readdirSync(join(root, '.github/workflows')).length} workflows match the allowlist`);
}
