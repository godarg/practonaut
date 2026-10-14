/**
 * Built-in baselines without a language model. Both act only through MCP (see mcp-client.ts):
 * `oracle` plays the task's validated reference solution, `random` picks valid-looking actions at random
 * within the action budget. They bound a score from above and below; neither sees the goal predicate.
 */
import type { TaskOracle, OracleParam } from '../authoring/from-scenes.ts';
import type { PublicCheck } from '../host/protocol.ts';
import type { CompactView, MutationResult } from '../mcp/replies.ts';
import type { ActionDefinition, Parameter, Scalar, World } from '../world/types.ts';
import { substituteTokens, variantIndex, variantTokens } from '../world/variant.ts';
import type { StdioMcpClient } from './mcp-client.ts';

export const BUILTIN_AGENTS = ['oracle', 'random'] as const;
export type BuiltinAgent = typeof BUILTIN_AGENTS[number];
export interface BaselineContext { client: StdioMcpClient; world: World; seed: number; oracle?: TaskOracle | undefined; maxActions: number; randomSeed: number; deadline: number }
export interface BaselineResult { note?: string }

async function observe(client: StdioMcpClient): Promise<CompactView> {
  const reply = await client.call<CompactView>('observe', {});
  if (!reply.ok) throw new Error(`observe failed: ${reply.error.code}`);
  return reply.value;
}
/** The board as the agent knows it: the observed objects with every reply's changes applied. */
function applyChanges(view: CompactView, result: MutationResult): CompactView {
  const objects = { ...view.state.objects };
  for (const [id, object] of Object.entries(result.changed)) { if (object.deleted) delete objects[id]; else objects[id] = object; }
  return { ...view, state: { objects }, step: result.step, revision: result.revision };
}

/** The reference solution with this seed's variant labels; created ids are read from each reply. */
export async function runOracle(context: BaselineContext): Promise<BaselineResult> {
  const { client, world, seed, oracle } = context;
  // The bench refuses the oracle agent on a task without a reference before any run starts.
  if (!oracle) throw new Error('no reference solution for this task');
  const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
  let view = await observe(client);
  const created: string[] = [];
  for (const [index, step] of oracle.steps.entries()) {
    const params: Record<string, Scalar> = {};
    for (const [key, value] of Object.entries(step.params) as Array<[string, OracleParam]>) {
      if (value !== null && typeof value === 'object') params[key] = created[value.created] ?? '';
      else params[key] = typeof value === 'string' ? substituteTokens(value, tokens) : value;
    }
    const reply = await client.call<MutationResult>('act', { name: step.name, params, baseStep: view.step, expectedRevision: view.revision });
    if (!reply.ok) return { note: `oracle action ${index} rejected: ${reply.error.code}` };
    view = applyChanges(view, reply.value);
    created[index] = reply.value.created[0] ?? '';
  }
  const check = await client.call<PublicCheck>('check_result', { expectedRevision: view.revision });
  return check.ok ? {} : { note: `check_result failed: ${check.error.code}` };
}

/** mulberry32: a small seeded generator, so a random run is reproducible from its seeds. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['Start', 'Review', 'Done', 'Check', 'Approve', 'Step', 'Draft', 'Ship'];
/** One value per parameter contract, drawn from the current objects where the parameter is an id. */
export function randomParameter(parameter: Parameter, view: Pick<CompactView, 'state'>, random: () => number): Scalar {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const objects = Object.values(view.state.objects);
  const ids = objects.map(object => object.id);
  switch (parameter.type) {
    case 'id': return ids.length ? pick(ids) : 'x';
    case 'nullable-id': return random() < 0.25 || !ids.length ? null : pick(ids);
    case 'end': return pick(['start', 'end']);
    case 'enum': return pick(parameter.values ?? ['']);
    case 'integer': {
      const low = Math.max(parameter.min ?? -200, -200), high = Math.min(parameter.max ?? 1600, 1600);
      return high < low ? (parameter.min ?? 0) : low + Math.floor(random() * (high - low + 1));
    }
    case 'string': {
      const names = objects.flatMap(object => object.type === 'step' ? [object.label] : object.type === 'frame' ? [object.name] : []);
      const value = random() < 0.5 && names.length ? pick(names) : pick(WORDS);
      return value.slice(0, Math.max(parameter.max ?? 64, parameter.min ?? 1));
    }
  }
}

/** Valid-looking random actions until the action budget, the deadline or an unusable reply ends it. */
export async function runRandom(context: BaselineContext): Promise<BaselineResult> {
  const { client, maxActions } = context;
  const random = seededRandom(context.randomSeed);
  let view = await observe(client);
  const listed = await client.call<ActionDefinition[]>('list_actions', {});
  const actions = listed.ok ? listed.value : [];
  for (let attempt = 0; attempt < maxActions && Date.now() < context.deadline; attempt++) {
    if (!actions.length) return { note: 'no actions' };
    const action = actions[Math.floor(random() * actions.length)]!;
    const params: Record<string, Scalar> = {};
    for (const [name, parameter] of Object.entries(action.parameters)) params[name] = randomParameter(parameter, view, random);
    const reply = await client.call<MutationResult>('act', { name: action.name, params, baseStep: view.step, expectedRevision: view.revision });
    if (reply.ok) view = applyChanges(view, reply.value);
    else if (reply.error.code === 'action_budget_exhausted') break;
    else view = await observe(client);
  }
  return {};
}
