/**
 * The public, unscored demonstration on the bundled example world (roadmap 0.2.0, Should 7).
 *
 * The host plays a short scripted solution of the current task through the same `act` every person
 * and agent uses: each action lands on the board, the real Excalidraw mirror confirms it when the
 * session has one (model-only sessions say so per action), and at the end the same result check as
 * the Check button judges the board. The Player only starts and stops it and watches the events.
 *
 * What is shown is public by construction: every script below is the third hint of its task (which
 * the Player shows on request) in executable form, for the bundled example world only. Nothing
 * here reads a checker bundle, a reference state, a near miss, a held-out task or a library or
 * bench oracle, and the script never travels as a whole: the Player sees each action only once it
 * is committed, exactly like a person's own action.
 *
 * The demonstration is never anyone's result. Its actions carry the actor `demonstration` in the
 * history, and from its start until the next reset or variant the attempt belongs to it: acting,
 * undoing, hints, editor input and the export are refused (`demonstration_running` while it runs,
 * `demonstration_attempt` afterwards), so a demonstration board can neither be continued nor saved
 * as somebody's attempt.
 */
import { variantIndex, variantTokens } from '../world/variant.ts';
import type { Action, World } from '../world/types.ts';
import type { DemonstrationRequest, DemonstrationState, DemonstrationStatus, HostErrorCode, HostEvent, HostReply, HostView, PracticeController, PublicCheck, TransactionContext } from './protocol.ts';

/** The world a demonstration exists for: the example that ships with the package. */
export const DEMONSTRATION_WORLD = Object.freeze({ id: 'flow-diagram', version: '1.0.0' });
/** Milliseconds before the first action, between actions and before the result check: slow enough
 * to follow, short enough to watch in about seven seconds. */
export interface DemonstrationPace { first: number; between: number; check: number }
export const DEMONSTRATION_PACE: DemonstrationPace = Object.freeze({ first: 600, between: 1000, check: 800 });

export interface DemonstrationControl {
  /** Tasks of this world that have a demonstration. */
  tasks(): string[];
  status(): DemonstrationStatus | null;
  /** Starts a new attempt on the current task and plays its demonstration (returns at once). */
  start(request: DemonstrationRequest, context?: TransactionContext): Promise<HostReply<DemonstrationStatus>>;
  /** Stops after the action in flight; nothing else changes. Idempotent. */
  stop(): HostReply<DemonstrationStatus | null>;
}

type Param = string | number | null | { created: number };
interface Planned { name: string; params: Record<string, Param> }
type Script = (token: (name: string) => string) => Planned[];

const box = { width: 180, height: 100, fontFamily: 3 } as const;
/** One script per task of the bundled example, each its task's third hint. `{ created: k }` is the
 * object the k-th action created (the convention of the task oracles). */
const SCRIPTS: Readonly<Record<string, Script>> = Object.freeze({
  // "Create {{first}}, {{middle}} and {{last}}. Bind one arrow from {{first}} to {{middle}} and one from {{middle}} to {{last}}."
  T1: token => [
    { name: 'add_step', params: { frameId: 'flow-frame', label: token('first'), x: 40, y: 120, ...box } },
    { name: 'add_step', params: { frameId: 'flow-frame', label: token('middle'), x: 280, y: 120, ...box } },
    { name: 'add_step', params: { frameId: 'flow-frame', label: token('last'), x: 520, y: 120, ...box } },
    { name: 'connect', params: { frameId: 'flow-frame', from: { created: 0 }, to: { created: 1 } } },
    { name: 'connect', params: { frameId: 'flow-frame', from: { created: 1 }, to: { created: 2 } } },
  ],
  // "Add {{inserted}}. For gap 1, redirect {{first}} → {{middle}} to {{inserted}}, then connect {{inserted}} → {{middle}}. For gap 2, …"
  T2: token => {
    const first = token('insertPosition') === '1';
    return [
      { name: 'add_step', params: { frameId: 'flow-frame', label: token('inserted'), x: first ? 220 : 460, y: 340, ...box } },
      { name: 'reconnect_end', params: { id: first ? 'ab' : 'bc', end: 'end', target: { created: 0 } } },
      { name: 'connect', params: { frameId: 'flow-frame', from: { created: 0 }, to: first ? 'b' : 'c' } },
    ];
  },
  // "Reconnect the end of {{first}} → {{middle}} to {{last}}. Remove the entire {{middle}} → {{last}} arrow, then delete {{middle}}."
  T3: () => [
    { name: 'reconnect_end', params: { id: 'ab', end: 'end', target: 'c' } },
    { name: 'disconnect', params: { id: 'bc' } },
    { name: 'delete_step', params: { id: 'b' } },
  ],
});

/** Whether `world` is the bundled example a demonstration was written for. */
export function demonstrationWorld(world: World): boolean {
  return world.id === DEMONSTRATION_WORLD.id && world.version === DEMONSTRATION_WORLD.version && world.tasks.some(task => Object.hasOwn(SCRIPTS, task.id));
}

/** The planned actions for a task and seed of the bundled example, or undefined without a script. */
export function demonstrationPlan(world: World, taskId: string, seed: number): Planned[] | undefined {
  if (!demonstrationWorld(world) || !Object.hasOwn(SCRIPTS, taskId) || !world.tasks.some(task => task.id === taskId)) return undefined;
  const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
  return SCRIPTS[taskId]!(name => {
    if (!Object.hasOwn(tokens, name)) throw new Error(`demonstration token ${name} missing`);
    return tokens[name]!;
  });
}

/** A planned action with `{ created: k }` replaced by the id the k-th action created. */
export function resolvePlanned(planned: Planned, created: readonly (string | undefined)[]): Action['params'] {
  const params: Action['params'] = {};
  for (const [key, value] of Object.entries(planned.params)) {
    if (value === null || typeof value !== 'object') { params[key] = value; continue; }
    const id = created[value.created];
    if (id === undefined) throw new Error(`demonstration action ${value.created} created nothing`);
    params[key] = id;
  }
  return params;
}

const reject = <T>(code: HostErrorCode, message: string): HostReply<T> => ({ ok: false, error: { code, message } });
const wait = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise(done => {
  if (signal.aborted) { done(); return; }
  const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); done(); };
  const timer = setTimeout(finish, milliseconds);
  signal.addEventListener('abort', finish, { once: true });
});

/**
 * Wraps the practice controller of a bundled-example session. Every other surface (Player, MCP,
 * the real editor) reaches the session through the returned controller, which enforces the
 * demonstration's ownership of its attempt.
 */
export function withDemonstration(inner: PracticeController, world: World, options: { pace?: DemonstrationPace; pause?: (milliseconds: number, signal: AbortSignal) => Promise<void> } = {}): { controller: PracticeController; demonstration: DemonstrationControl } {
  const pace = options.pace ?? DEMONSTRATION_PACE, pause = options.pause ?? wait;
  const listeners = new Set<(event: HostEvent) => void>();
  let status: DemonstrationStatus | null = null, running: AbortController | undefined, closed = false;
  const emit = (): void => { const event: HostEvent = { type: 'demonstration', status: structuredClone(status) }; for (const listener of listeners) { try { listener(structuredClone(event)); } catch { /* A detached consumer cannot stop the demonstration. */ } } };
  const update = (change: Partial<DemonstrationStatus>): void => { if (status) { status = { ...status, ...change }; emit(); } };
  const end = (state: Exclude<DemonstrationState, 'running'>, extra: Partial<DemonstrationStatus> = {}): void => { running = undefined; update({ state, ...extra }); };
  /** While it runs nothing else changes the session; afterwards its attempt stays its own. */
  const owned = <T>(): HostReply<T> | undefined => status === null ? undefined : status.state === 'running'
    ? reject('demonstration_running', 'A demonstration is running; stop it in the Player or wait until it ends')
    : reject('demonstration_attempt', 'This attempt is a demonstration; reset or choose a variant to start an own attempt');
  const whileRunning = <T>(): HostReply<T> | undefined => status?.state === 'running' ? owned<T>() : undefined;
  /** A reset or variant ends the demonstration's attempt. */
  const release = <T>(reply: HostReply<T>): HostReply<T> => { if (reply.ok && status !== null) { status = null; withheld = false; emit(); } return reply; };
  /** The demonstration's own verdict, when a Stop overtook its final check: never published. */
  let withheld = false;
  /** The number the person's next own attempt gets: the demonstration never uses up one of theirs
   * (the attempt it replaced counts only if the person had acted or opened a hint in it). */
  let resumeAttempt = 1;
  /** A reset or variant of the demonstration's attempt on the same task continues the person's count. */
  const continuing = <T extends { taskId?: string; attempt?: number }>(request: T): T => {
    if (status === null || (request.taskId !== undefined && request.taskId !== status.taskId)) return request;
    return { ...request, attempt: resumeAttempt };
  };
  /** A view of the demonstration's attempt (its task and the attempt it started). */
  const owns = (view: HostView): boolean => status !== null && view.task.id === status.taskId && view.attempt === status.attempt;
  /** Every check of the demonstration's attempt says so and is never practice evidence. */
  const markCheck = (check: PublicCheck): PublicCheck => ({ ...check, demonstration: true, practiceEvidence: false });
  /** Every view of it, for the Player and for agents alike; a verdict a Stop overtook is left out. */
  const mark = (view: HostView): HostView => {
    if (!owns(view)) return view;
    const overtaken = withheld || (status!.state === 'running' && !!running?.signal.aborted);
    return { ...view, demonstration: true, practiceEvidence: false, result: overtaken || !view.result ? null : markCheck(view.result) };
  };
  const marked = (event: HostEvent): HostEvent => event.type === 'ready' || event.type === 'changed' ? { ...event, view: mark(event.view) } : event;

  async function play(plan: Planned[], abort: AbortController): Promise<void> {
    const created: Array<string | undefined> = [];
    try {
      for (let index = 0; index < plan.length; index++) {
        await pause(index === 0 ? pace.first : pace.between, abort.signal);
        if (abort.signal.aborted || closed) { end('stopped'); return; }
        const view: HostView = inner.view(), planned = plan[index]!;
        const action: Action = { name: planned.name, params: resolvePlanned(planned, created), baseStep: view.step };
        const reply = await inner.act({ expectedRevision: view.revision, action, actor: { kind: 'demonstration' } });
        if (!reply.ok) { end('failed', { error: reply.error.code }); return; }
        created.push(reply.value.delta.created.find(id => { const object = reply.value.view.state.objects[id]; return object?.type === 'step' || object?.type === 'arrow'; }));
        update({ done: index + 1 });
      }
      await pause(pace.check, abort.signal);
      if (abort.signal.aborted || closed) { end('stopped'); return; }
      const checked = await inner.check({ expectedRevision: inner.view().revision });
      // A Stop accepted while the check was reading the real tool back wins: no verdict is published.
      if (abort.signal.aborted || closed) { withheld = checked.ok; end('stopped'); return; }
      if (!checked.ok) { end('failed', { error: checked.error.code }); return; }
      end('finished', { passed: checked.value.passed });
    } catch { end('failed', { error: 'invalid_argument' }); }
  }

  const demonstration: DemonstrationControl = {
    tasks: () => world.tasks.map(task => task.id).filter(id => { try { return demonstrationPlan(world, id, 0) !== undefined; } catch { return false; } }),
    status: () => structuredClone(status),
    async start(request, context) {
      if (closed) return reject('mirror_unavailable', 'Session closed');
      if (status?.state === 'running') return reject('demonstration_running', 'A demonstration is already running');
      if (request.confirmed !== true) return reject('invalid_request', 'A demonstration replaces the current attempt and needs confirmation');
      const before = inner.view();
      let plan: Planned[] | undefined;
      try { plan = demonstrationPlan(world, before.task.id, before.seed); } catch { return reject('invalid_argument', 'The demonstration does not fit this variant'); }
      if (!plan) return reject('not_found', 'This task has no demonstration');
      // A fresh attempt of its own: the board starts at the task's start and the history is empty.
      // The status names that attempt before the reset publishes it, so its first view is marked too.
      const previous = status, previouslyWithheld = withheld, previousResume = resumeAttempt;
      if (previous === null) resumeAttempt = before.attempt + (before.step || before.hintsOpened ? 1 : 0);
      status = { state: 'running', taskId: before.task.id, attempt: before.attempt + 1, total: plan.length, done: 0 }; withheld = false;
      const fresh = await inner.reset({ expectedRevision: request.expectedRevision, confirmed: true }, context);
      if (!fresh.ok) { status = previous; withheld = previouslyWithheld; resumeAttempt = previousResume; return fresh; }
      status = { ...status, taskId: fresh.value.view.task.id, attempt: fresh.value.view.attempt };
      emit();
      const abort = new AbortController(); running = abort;
      void play(plan, abort);
      return { ok: true, value: structuredClone(status) };
    },
    stop() {
      running?.abort();
      return { ok: true, value: structuredClone(status) };
    },
  };

  const controller: PracticeController = {
    view: () => mark(inner.view()),
    act: async (request, context) => owned() ?? inner.act(request, context),
    undo: async (request, context) => owned() ?? inner.undo(request, context),
    hint: async (request, context) => owned() ?? inner.hint(request, context),
    export: async (request, context) => owned() ?? inner.export(request, context),
    reset: async (request, context) => whileRunning() ?? release(await inner.reset(continuing(request), context)),
    variant: async (request, context) => whileRunning() ?? release(await inner.variant(continuing(request), context)),
    check: async (request, context) => {
      const refused = whileRunning<PublicCheck>(); if (refused) return refused;
      // A check asked for afterwards replaces a verdict that was withheld; it is published, marked.
      const before = withheld; withheld = false;
      const reply = await inner.check(request, context);
      if (!reply.ok) { withheld = before; return reply; }
      return owns(inner.view()) ? { ok: true, value: markCheck(reply.value) } : reply;
    },
    png: async context => whileRunning() ?? inner.png(context),
    subscribe: listener => {
      const forward = (event: HostEvent): void => listener(marked(event));
      const off = inner.subscribe(forward); listeners.add(listener);
      return () => { listeners.delete(listener); off(); };
    },
    ...(inner.editor ? { editor: async (request, context) => owned() ?? inner.editor!(request, context) } satisfies Pick<PracticeController, 'editor'> : {}),
    ...(inner.scene ? { scene: () => inner.scene!() } : {}),
    close: async () => { closed = true; running?.abort(); listeners.clear(); await inner.close(); },
  };
  return { controller, demonstration };
}
