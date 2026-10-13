/** Independently derives world/1 session history. No runtime transitions or adapter code. */
import { stateHash } from '../canonical/index.ts';
import { evaluate } from '../predicate/index.ts';
import { RUNTIME_LIMITS } from '../world/limits.ts';
import { isDisplayText } from '../world/display-text.ts';
import type { Action, Arrow, EffectKind, Parameter, Predicate, SessionData, State, Step, StepV2, Task, World } from '../world/types.ts';
import { invalid } from './errors.ts';
import { validateSubmissionState } from './state.ts';

// The checker implements the seven specified world/1 transitions separately from
// their producer. Shared dependencies are data contracts, canonical JSON and predicates.
const specifications: Readonly<Record<string, { parameters: Record<string, Parameter['type']>; effects: EffectKind[] }>> = {
  add_step: { parameters: { frameId: 'id', label: 'string', x: 'integer', y: 'integer', width: 'integer', height: 'integer', fontFamily: 'integer' }, effects: ['create_step'] },
  rename_step: { parameters: { id: 'id', label: 'string' }, effects: ['set_label'] },
  move_step: { parameters: { id: 'id', x: 'integer', y: 'integer' }, effects: ['set_position'] },
  connect: { parameters: { frameId: 'id', from: 'id', to: 'id' }, effects: ['create_arrow'] },
  reconnect_end: { parameters: { id: 'id', end: 'end', target: 'id' }, effects: ['set_endpoint'] },
  disconnect: { parameters: { id: 'id' }, effects: ['disconnect_arrow'] },
  delete_step: { parameters: { id: 'id' }, effects: ['tombstone_step', 'detach_incident_arrows'] },
};
// world/2: the checker's own copy of the built-in contract (types and effects only; bounds come from the world).
const specificationsV2: Readonly<Record<string, { parameters: Record<string, Parameter['type']>; effects: EffectKind[] }>> = {
  add_step: { parameters: { frameId: 'nullable-id', label: 'string', x: 'integer', y: 'integer', width: 'integer', height: 'integer', shape: 'enum' }, effects: ['create_step'] },
  rename_step: { parameters: { id: 'id', label: 'string' }, effects: ['set_label'] },
  move_step: { parameters: { id: 'id', x: 'integer', y: 'integer' }, effects: ['set_position'] },
  resize_step: { parameters: { id: 'id', width: 'integer', height: 'integer' }, effects: ['set_size'] },
  set_style: { parameters: { id: 'id', shape: 'enum', stroke: 'enum', fill: 'enum' }, effects: ['set_style'] },
  delete_step: { parameters: { id: 'id' }, effects: ['tombstone_step', 'detach_incident_arrows'] },
  connect: { parameters: { from: 'id', to: 'id' }, effects: ['create_arrow'] },
  reconnect_end: { parameters: { id: 'id', end: 'end', target: 'id' }, effects: ['set_endpoint'] },
  disconnect: { parameters: { id: 'id' }, effects: ['disconnect_arrow'] },
  rename_frame: { parameters: { id: 'id', name: 'string' }, effects: ['set_frame_name'] },
  group_steps: { parameters: { id: 'id', with: 'id' }, effects: ['set_group'] },
  ungroup: { parameters: { id: 'id' }, effects: ['clear_group'] },
  set_frame: { parameters: { id: 'id', frameId: 'nullable-id' }, effects: ['set_frame'] },
};
const SHAPES = ['rectangle', 'ellipse', 'diamond'], STROKES = ['black', 'red', 'green', 'blue', 'orange'], FILLS = ['none', 'red', 'green', 'blue', 'yellow'];
const sameKeys = (a: object, b: object): boolean => Object.keys(a).sort().join(',') === Object.keys(b).sort().join(',');
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
function successorV2(world: World, state: State, action: Action, seed: number, prefix: Action[]): State {
  const spec = Object.hasOwn(specificationsV2, action.name) ? specificationsV2[action.name] : undefined;
  const definition = world.actions.find(candidate => candidate.name === action.name);
  if (!spec || !definition || !sameKeys(action.params, spec.parameters) || !sameKeys(definition.parameters, spec.parameters)) invalid('session contains an unknown or unsupported action');
  if (action.baseStep !== undefined && action.baseStep !== prefix.length) invalid('session action baseStep disagrees with its prefix');
  for (const [key, expectedType] of Object.entries(spec.parameters)) {
    const declared = definition.parameters[key]!, value = action.params[key];
    if (declared.type !== expectedType) invalid('session action contract is not covered');
    const allowed = key === 'shape' ? SHAPES : key === 'stroke' ? STROKES : key === 'fill' ? FILLS : [];
    const good = expectedType === 'integer' ? Number.isSafeInteger(value)
      : expectedType === 'string' ? typeof value === 'string' && isDisplayText(value)
      : expectedType === 'end' ? value === 'start' || value === 'end'
      : expectedType === 'enum' ? typeof value === 'string' && allowed.includes(value) && (declared.values ?? []).includes(value)
      : expectedType === 'nullable-id' ? value === null || isId(value) : isId(value);
    if (!good) invalid(`session action parameter is invalid: ${key}`);
    const size = typeof value === 'string' ? (expectedType === 'string' ? [...value].length : 0) : typeof value === 'number' ? value : 0;
    if ((declared.min !== undefined && size < declared.min) || (declared.max !== undefined && size > declared.max)) invalid(`session action parameter exceeds contract: ${key}`);
  }
  let fuel: number = RUNTIME_LIMITS.checkerFuel;
  const truth = (predicate: Predicate): boolean => {
    const result = evaluate(predicate, state, { fuel });
    if (!result.ok) invalid('session transition predicate budget or validation failed');
    fuel -= result.steps; return result.value;
  };
  if (!definition.preconditions.every(truth)) invalid('session action precondition is false');
  if (world.rules.some(rule => rule.action === action.name)) {
    const effects = new Set(world.rules.filter(rule => rule.action === action.name && rule.preconditions.every(truth)).flatMap(rule => rule.effects));
    if (effects.size !== spec.effects.length || spec.effects.some(effect => !effects.has(effect))) invalid('session transition effects are not exactly covered');
  }
  const str = (key: string): string => action.params[key] as string;
  const num = (key: string): number => action.params[key] as number;
  const orNull = (key: string): string | null => action.params[key] as string | null;
  const live = (id: string, type: 'frame' | 'step' | 'arrow') => {
    const object = state.objects[id];
    if (!object || object.deleted || object.type !== type) invalid(`session transition needs a live ${type}`);
    return object;
  };
  const result = structuredClone(state);
  const step = (id: string): StepV2 => { live(id, 'step'); return result.objects[id] as StepV2; };
  const digest = (): string => stateHash({ world: { id: world.id, version: world.version }, seed, prefix: [...prefix, action] }).slice(0, 60);
  let objectId = typeof action.params.id === 'string' ? str('id') : '';
  if (action.name === 'add_step' || action.name === 'connect') {
    if (Object.keys(state.objects).length >= RUNTIME_LIMITS.maxObjects) invalid('session object limit reached');
    objectId = `${action.name === 'add_step' ? 's' : 'a'}-${digest()}`;
    if (Object.hasOwn(result.objects, objectId)) invalid('session reuses a semantic identity');
  }
  switch (action.name) {
    case 'add_step':
      if (orNull('frameId') !== null) live(str('frameId'), 'frame');
      result.objects[objectId] = { id: objectId, type: 'step', deleted: false, frameId: orNull('frameId'), label: str('label'), x: num('x'), y: num('y'), width: num('width'), height: num('height'), shape: str('shape') as StepV2['shape'], groupId: null, stroke: 'black', fill: 'none' };
      break;
    case 'rename_step': step(objectId).label = str('label'); break;
    case 'move_step': { const target = step(objectId); target.x = num('x'); target.y = num('y'); break; }
    case 'resize_step': { const target = step(objectId); target.width = num('width'); target.height = num('height'); break; }
    case 'set_style': { const target = step(objectId); target.shape = str('shape') as StepV2['shape']; target.stroke = str('stroke') as StepV2['stroke']; target.fill = str('fill') as StepV2['fill']; break; }
    case 'delete_step':
      step(objectId).deleted = true;
      for (const object of Object.values(result.objects)) if (object.type === 'arrow' && !object.deleted) { if (object.from === objectId) object.from = null; if (object.to === objectId) object.to = null; }
      break;
    case 'connect':
      live(str('from'), 'step'); live(str('to'), 'step');
      result.objects[objectId] = { id: objectId, type: 'arrow', deleted: false, frameId: null, from: str('from'), to: str('to') };
      break;
    case 'reconnect_end': {
      live(objectId, 'arrow'); live(str('target'), 'step');
      const arrow = result.objects[objectId] as Arrow;
      if (str('end') === 'start') arrow.from = str('target'); else arrow.to = str('target');
      break;
    }
    case 'disconnect': { live(objectId, 'arrow'); const arrow = result.objects[objectId] as Arrow; arrow.deleted = true; arrow.from = null; arrow.to = null; break; }
    case 'rename_frame': live(objectId, 'frame'); (result.objects[objectId] as { name: string }).name = str('name'); break;
    case 'group_steps': {
      const target = step(objectId), other = step(str('with'));
      if (target.id === other.id) invalid('session groups a step with itself');
      const group = other.groupId ?? `g-${digest()}`;
      other.groupId = group; target.groupId = group; break;
    }
    case 'ungroup': {
      const group = step(objectId).groupId;
      if (group === null) invalid('session ungroups an ungrouped step');
      for (const object of Object.values(result.objects)) if (object.type === 'step' && !object.deleted && (object as StepV2).groupId === group) (object as StepV2).groupId = null;
      break;
    }
    case 'set_frame': { const target = step(objectId); if (orNull('frameId') !== null) live(str('frameId'), 'frame'); target.frameId = orNull('frameId'); break; }
    default: invalid('session transition is unknown');
  }
  for (const object of Object.values(result.objects)) {
    if (object.type !== 'arrow' || object.deleted) continue;
    const ends = [object.from, object.to].filter((end): end is string => end !== null);
    if (!ends.length) continue;
    const frames = ends.map(end => (result.objects[end] as StepV2).frameId);
    object.frameId = frames.every(frame => frame === frames[0]) ? frames[0]! : null;
  }
  return validateSubmissionState(result, undefined, 2);
}
function successor(world: World, state: State, action: Action, seed: number, prefix: Action[]): State {
  if (world.schema === 'practonaut.world/2') return successorV2(world, state, action, seed, prefix);
  const spec = Object.hasOwn(specifications, action.name) ? specifications[action.name] : undefined;
  const definition = world.actions.find(candidate => candidate.name === action.name);
  if (!spec || !definition || !sameKeys(action.params, spec.parameters) || !sameKeys(definition.parameters, spec.parameters)) invalid('session contains an unknown or unsupported action');
  if (action.baseStep !== undefined && action.baseStep !== prefix.length) invalid('session action baseStep disagrees with its prefix');
  for (const [key, expectedType] of Object.entries(spec.parameters)) {
    const declared = definition.parameters[key]!, value = action.params[key];
    if (declared.type !== expectedType) invalid('session action contract is not covered');
    const good = expectedType === 'integer' ? Number.isSafeInteger(value)
      : expectedType === 'string' ? typeof value === 'string' && isDisplayText(value)
      : expectedType === 'end' ? value === 'start' || value === 'end'
      : typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
    if (!good) invalid(`session action parameter is invalid: ${key}`);
    const size = typeof value === 'string' ? [...value].length : typeof value === 'number' ? value : 0;
    if ((declared.min !== undefined && size < declared.min) || (declared.max !== undefined && size > declared.max)) invalid(`session action parameter exceeds contract: ${key}`);
  }
  let fuel: number = RUNTIME_LIMITS.checkerFuel;
  const truth = (predicate: Predicate): boolean => {
    const result = evaluate(predicate, state, { fuel });
    if (!result.ok) invalid('session transition predicate budget or validation failed');
    fuel -= result.steps; return result.value;
  };
  if (!definition.preconditions.every(truth)) invalid('session action precondition is false');
  const effects = new Set(world.rules.filter(rule => rule.action === action.name && rule.preconditions.every(truth)).flatMap(rule => rule.effects));
  if (effects.size !== spec.effects.length || spec.effects.some(effect => !effects.has(effect))) invalid('session transition effects are not exactly covered');
  const str = (key: string): string => action.params[key] as string;
  const num = (key: string): number => action.params[key] as number;
  const live = (id: string, type: 'frame' | 'step' | 'arrow') => {
    const object = state.objects[id];
    if (!object || object.deleted || object.type !== type) invalid(`session transition needs a live ${type}`);
    return object;
  };
  const step = (id: string) => live(id, 'step') as Step;
  const result = structuredClone(state);
  let objectId = str('id');
  if (action.name === 'add_step' || action.name === 'connect') {
    live(str('frameId'), 'frame');
    if (Object.keys(state.objects).length >= RUNTIME_LIMITS.maxObjects) invalid('session object limit reached');
    const digest = stateHash({ world: { id: world.id, version: world.version }, seed, prefix: [...prefix, action] });
    objectId = `${action.name === 'add_step' ? 's' : 'a'}-${digest.slice(0, 60)}`;
    if (Object.hasOwn(result.objects, objectId)) invalid('session reuses a semantic identity');
  }
  switch (action.name) {
    case 'add_step':
      if (num('width') < 1 || num('height') < 1 || !world.app.fontFamilies.includes(num('fontFamily'))) invalid('session step geometry or font is invalid');
      result.objects[objectId] = { id: objectId, type: 'step', deleted: false, frameId: str('frameId'), label: str('label'), x: num('x'), y: num('y'), width: num('width'), height: num('height'), fontFamily: num('fontFamily') };
      break;
    case 'rename_step': step(objectId); (result.objects[objectId] as Step).label = str('label'); break;
    case 'move_step': step(objectId); (result.objects[objectId] as Step).x = num('x'); (result.objects[objectId] as Step).y = num('y'); break;
    case 'connect':
      if (step(str('from')).frameId !== str('frameId') || step(str('to')).frameId !== str('frameId')) invalid('session connects across frames');
      result.objects[objectId] = { id: objectId, type: 'arrow', deleted: false, frameId: str('frameId'), from: str('from'), to: str('to') };
      break;
    case 'reconnect_end': {
      const original = live(objectId, 'arrow'), arrow = result.objects[objectId];
      if (original.type !== 'arrow' || arrow?.type !== 'arrow' || step(str('target')).frameId !== original.frameId) invalid('session reconnects across frames');
      if (str('end') === 'start') arrow.from = str('target'); else arrow.to = str('target');
      break;
    }
    case 'disconnect': {
      live(objectId, 'arrow'); const arrow = result.objects[objectId];
      if (arrow?.type !== 'arrow') invalid('session arrow is invalid');
      arrow.deleted = true; arrow.from = null; arrow.to = null; break;
    }
    case 'delete_step':
      step(objectId); result.objects[objectId]!.deleted = true;
      for (const object of Object.values(result.objects)) if (object.type === 'arrow' && !object.deleted) {
        if (object.from === objectId) object.from = null;
        if (object.to === objectId) object.to = null;
      }
      break;
    default: invalid('session transition is unknown');
  }
  return validateSubmissionState(result, world.app.fontFamilies);
}

/** History consistency is distinct from provenance or a sealed agent-success claim. */
export function verifySessionHistory(world: World, task: Task, data: SessionData): void {
  const era = world.schema === 'practonaut.world/2' ? 2 : 1;
  let state = validateSubmissionState(structuredClone(task.initialState ?? world.initialState), era === 2 ? undefined : world.app.fontFamilies, era);
  const prefix: Action[] = [];
  for (const [index, entry] of data.log.entries()) {
    state = successor(world, state, entry.action, data.seed, prefix);
    if (stateHash(state) !== entry.hash) invalid(`session replay step hash mismatch at ${index}`);
    prefix.push(entry.action);
  }
  if (stateHash(state) !== data.hash) invalid('session final state differs from independent history');
}
