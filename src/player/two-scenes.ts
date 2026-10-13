/** Create, second way: draw the start, draw the goal, get an exercise. The drawing surface is the
 * real editor in author mode (nothing is recorded); the host turns the two scenes into a world/2
 * task and opens it in a new practice session. */
import type { AuthorFromScenesReply } from '../host/author-protocol.ts';
import type { Language } from './messages.ts';
import { banner, button, checkField, h, icon } from './ui/components.ts';
import { step, stepper } from './ui/stepper.ts';
import type { StepState } from './ui/stepper.ts';
import { counted } from './plural.ts';

export interface TwoScenesContext {
  language(): Language;
  ready(): boolean;
  command(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
  api<T>(route: string, payload?: unknown): Promise<T>;
  revision(): number;
  showEditor(): void;
  announce(text: string): void;
  /** Whether the drawing surface currently holds no step and no arrow (true until it has been read). */
  drawingEmpty(): boolean;
}
const copy = {
  en: {
    title: 'Draw start and goal', lead: 'Draw how the diagram looks at the start, then change it into the goal. Practonaut turns the difference into an exercise and checks that the goal passes and the start does not.',
    blank: 'Start an empty drawing', start: 'Use the drawing as start', drawFirst: 'Draw at least one step first; an empty drawing cannot be a start.', goal: 'Use the drawing as goal', create: 'Create exercise', open: 'Open my exercise',
    stepStart: 'Start', stepGoal: 'Goal', stepTask: 'Exercise', stepsLabel: 'Steps to draw an exercise', position: 'Step {n} of {total}, {state}.', stateDone: 'done', stateCurrent: 'current', stateUpcoming: 'upcoming', stateLocked: 'available later',
    startLead: 'Start an empty drawing in the drawing surface, draw the starting diagram, then take it.', goalLead: 'Change the drawing into the goal, then take it.', taskLead: 'Choose what the exercise keeps from your drawing.',
    afterStart: 'After the start', afterGoal: 'After the goal',
    none: 'Not taken yet.', taken: '{steps}, {arrows} taken.', steps1: '1 step', stepsN: '{n} steps', arrows1: '1 arrow', arrowsN: '{n} arrows',
    order: 'Keep the left-to-right order', align: 'Keep aligned rows and columns', working: 'Checking the two drawings…',
    created: 'Exercise created: {clauses}, reference solution with {actions}, {near} checked.', clauses1: '1 goal condition', clausesN: '{n} goal conditions', actions1: '1 action', actionsN: '{n} actions', near1: '1 near miss', nearN: '{n} near misses',
    ignored1: '1 drawing element is not modelled and was ignored.', ignoredN: '{n} drawing elements are not modelled and were ignored.',
    failed: 'No exercise was created', needBoth: 'Take a start and a goal first.',
    scenes_identical: 'Start and goal are the same. Change the drawing before taking the goal.', goal_empty: 'The goal has no steps or arrows.',
    oracle_unavailable: 'This goal needs an operation the exercise cannot model yet (for example creating or deleting a frame, or a loose arrow end).',
    ambiguous_labels: 'Grouped steps need unique labels.', goal_not_accepted: 'The goal drawing does not pass its own check.', start_accepted: 'The start already satisfies the goal.',
    scene_invalid: 'A drawing could not be read.', generic: 'Check the drawings and try again.',
  },
  de: {
    title: 'Start und Ziel zeichnen', lead: 'Zeichne, wie das Diagramm am Anfang aussieht, und ändere es dann in das Ziel. Practonaut macht aus dem Unterschied eine Übung und prüft, dass das Ziel besteht und der Start nicht.',
    blank: 'Leere Zeichnung beginnen', start: 'Zeichnung als Start übernehmen', drawFirst: 'Zeichne zuerst mindestens einen Schritt; eine leere Zeichnung kann kein Start sein.', goal: 'Zeichnung als Ziel übernehmen', create: 'Übung erzeugen', open: 'Meine Übung öffnen',
    stepStart: 'Start', stepGoal: 'Ziel', stepTask: 'Übung', stepsLabel: 'Schritte zum Zeichnen einer Übung', position: 'Schritt {n} von {total}, {state}.', stateDone: 'erledigt', stateCurrent: 'aktuell', stateUpcoming: 'folgt', stateLocked: 'später verfügbar',
    startLead: 'Beginne eine leere Zeichnung in der Zeichenfläche, zeichne das Ausgangsdiagramm und übernimm es.', goalLead: 'Ändere die Zeichnung in das Ziel und übernimm es.', taskLead: 'Wähle, was die Übung aus deiner Zeichnung übernimmt.',
    afterStart: 'Nach dem Start', afterGoal: 'Nach dem Ziel',
    none: 'Noch nicht übernommen.', taken: '{steps}, {arrows} übernommen.', steps1: '1 Schritt', stepsN: '{n} Schritte', arrows1: '1 Pfeil', arrowsN: '{n} Pfeile',
    order: 'Reihenfolge von links nach rechts beibehalten', align: 'Ausgerichtete Zeilen und Spalten beibehalten', working: 'Die beiden Zeichnungen werden geprüft…',
    created: 'Übung erzeugt: {clauses}, Referenzlösung mit {actions}, {near} geprüft.', clauses1: '1 Zielbedingung', clausesN: '{n} Zielbedingungen', actions1: '1 Aktion', actionsN: '{n} Aktionen', near1: '1 Beinahe-Treffer', nearN: '{n} Beinahe-Treffer',
    ignored1: '1 Zeichenelement ist nicht modelliert und wurde ignoriert.', ignoredN: '{n} Zeichenelemente sind nicht modelliert und wurden ignoriert.',
    failed: 'Keine Übung erzeugt', needBoth: 'Übernimm zuerst einen Start und ein Ziel.',
    scenes_identical: 'Start und Ziel sind gleich. Ändere die Zeichnung, bevor du das Ziel übernimmst.', goal_empty: 'Das Ziel hat keine Schritte oder Pfeile.',
    oracle_unavailable: 'Dieses Ziel braucht eine Aktion, die die Übung noch nicht modelliert (etwa einen Rahmen anlegen oder löschen, oder ein loses Pfeilende).',
    ambiguous_labels: 'Gruppierte Schritte brauchen eindeutige Beschriftungen.', goal_not_accepted: 'Die Zielzeichnung besteht ihre eigene Prüfung nicht.', start_accepted: 'Der Start erfüllt das Ziel bereits.',
    scene_invalid: 'Eine Zeichnung ließ sich nicht lesen.', generic: 'Prüfe die Zeichnungen und versuche es erneut.',
  },
} as const;
type Key = keyof typeof copy.en;
// Only the fields the scene parser reads travel to the host; the request body stays small.
const KEEP = ['id', 'type', 'x', 'y', 'width', 'height', 'isDeleted', 'frameId', 'containerId', 'groupIds', 'text', 'originalText', 'name', 'strokeColor', 'backgroundColor', 'startBinding', 'endBinding', 'startArrowhead', 'endArrowhead'];
function slim(elements: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(elements)) throw new Error('scene_invalid');
  return elements.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && (e as { isDeleted?: unknown }).isDeleted !== true).map(e => {
    const out: Record<string, unknown> = {};
    for (const key of KEEP) if (key in e) out[key] = key.endsWith('Binding') && e[key] && typeof e[key] === 'object' ? { elementId: (e[key] as { elementId?: unknown }).elementId } : e[key];
    return out;
  });
}
const counts = (elements: Array<Record<string, unknown>>): { steps: number; arrows: number } => ({
  steps: elements.filter(e => ['rectangle', 'ellipse', 'diamond'].includes(String(e.type))).length,
  arrows: elements.filter(e => e.type === 'arrow').length,
});

export function createTwoScenes(root: HTMLElement, context: TwoScenesContext): { render(): void } {
  let start: Array<Record<string, unknown>> | undefined, goal: Array<Record<string, unknown>> | undefined;
  let order = false, align = false, busy = false, result: AuthorFromScenesReply | undefined, error: string | undefined;
  const c = (key: Key, values: Record<string, string | number> = {}): string => copy[context.language()][key].replace(/\{([a-z]+)\}/g, (_, name: string) => String(values[name] ?? ''));
  const n = (value: number, one: Key, other: Key): string => counted(context.language(), value, { one: copy[context.language()][one], other: copy[context.language()][other] });
  const takenText = (taken: Array<Record<string, unknown>>): string => { const k = counts(taken); return c('taken', { steps: n(k.steps, 'steps1', 'stepsN'), arrows: n(k.arrows, 'arrows1', 'arrowsN') }); };
  const createdText = (summary: AuthorFromScenesReply['summary']): string => c('created', { clauses: n(summary.clauses, 'clauses1', 'clausesN'), actions: n(summary.oracleActions, 'actions1', 'actionsN'), near: n(summary.nearMisses, 'near1', 'nearN') });
  // The step the author opened by hand; otherwise the current one is open.
  let opened: 'start' | 'goal' | 'task' | undefined;
  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; error = undefined; render();
    try { await fn(); }
    catch (reason) { const code = String(reason instanceof Error ? reason.message : reason).split(':', 1)[0]!.trim(); error = Object.hasOwn(copy.en, code) ? code : 'generic'; context.announce(`${c('failed')}. ${c(error as Key)}`); }
    finally { busy = false; render(); }
  }
  const take = async (): Promise<Array<Record<string, unknown>>> => slim((await context.command('snapshot')).elements);
  const actions = {
    blank: () => run(async () => { await context.command('configure', { mode: 'author', elements: [], canUndo: false }); context.showEditor(); start = undefined; goal = undefined; result = undefined; }),
    start: () => run(async () => { start = await take(); goal = undefined; result = undefined; context.announce(takenText(start)); opened = undefined; }),
    goal: () => run(async () => { goal = await take(); result = undefined; context.announce(takenText(goal)); opened = undefined; }),
    create: () => run(async () => {
      if (!start || !goal) throw new Error('needBoth');
      context.announce(c('working'));
      result = await context.api<AuthorFromScenesReply>('author/from-scenes', { expectedRevision: context.revision(), start, goal, ...(order ? { layout: 'relative' } : {}), ...(align ? { align: true } : {}) });
      context.announce(createdText(result.summary));
    }),
  };
  function render(): void {
    const disabled = busy || !context.ready();
    const status = (taken: Array<Record<string, unknown>> | undefined, testid: string): HTMLElement => h('p', { class: 'create-footnote', testid, text: taken ? takenText(taken) : c('none') });
    const current: 'start' | 'goal' | 'task' = !start ? 'start' : !goal ? 'goal' : 'task';
    const done = { start: !!start, goal: !!goal, task: !!result };
    const locked = { start: false, goal: !start, task: !start || !goal };
    const chosen = opened && !locked[opened] ? opened : current;
    // An empty drawing cannot be a start: the button says why it is off instead of failing later.
    const empty = context.drawingEmpty();
    const startButton = button({ label: c('start'), variant: start ? 'secondary' : 'primary', icon: 'check', testid: 'two-scenes-start', disabled: disabled || empty, onClick: () => { void actions.start(); } });
    if (empty) startButton.setAttribute('aria-describedby', 'two-scenes-start-reason');
    const bodies: Record<'start' | 'goal' | 'task', HTMLElement[]> = {
      start: [
        h('p', { class: 'create-footnote', text: c('startLead') }),
        h('div', { class: 'create-actions' }, button({ label: c('blank'), variant: 'secondary', icon: 'document', testid: 'two-scenes-blank', disabled, onClick: () => { void actions.blank(); } }),
          startButton),
        ...(empty ? [h('p', { class: 'create-footnote', id: 'two-scenes-start-reason', testid: 'two-scenes-start-reason', text: c('drawFirst') })] : []),
        status(start, 'two-scenes-start-status'),
      ],
      goal: [
        h('p', { class: 'create-footnote', text: c('goalLead') }),
        h('div', { class: 'create-actions' }, button({ label: c('goal'), variant: start && !goal ? 'primary' : 'secondary', icon: 'target', testid: 'two-scenes-goal', disabled: disabled || !start, onClick: () => { void actions.goal(); } })),
        status(goal, 'two-scenes-goal-status'),
      ],
      task: [
        h('p', { class: 'create-footnote', text: c('taskLead') }),
        checkField({ id: 'two-scenes-order', testid: 'two-scenes-order', label: c('order'), checked: order, disabled, onChange: value => { order = value; } }).root,
        checkField({ id: 'two-scenes-align', testid: 'two-scenes-align', label: c('align'), checked: align, disabled, onChange: value => { align = value; } }).root,
        h('div', { class: 'create-actions' }, button({ label: c('create'), variant: start && goal && !result ? 'primary' : 'secondary', icon: 'flow', testid: 'two-scenes-create', disabled: disabled || !start || !goal, onClick: () => { void actions.create(); } })),
      ],
    };
    const target = bodies[chosen];
    if (error) target.push(banner({ tone: 'danger', title: c('failed'), text: c(error as Key), role: 'alert', testid: 'two-scenes-error' }));
    if (result) {
      bodies.task.push(banner({ tone: 'success', text: createdText(result.summary), testid: 'two-scenes-result' }));
      if (result.summary.unmodeled) bodies.task.push(h('p', { class: 'create-footnote', text: n(result.summary.unmodeled, 'ignored1', 'ignoredN') }));
      bodies.task.push(h('div', { class: 'create-actions' }, h('a', { class: 'create-link', testid: 'two-scenes-open', attrs: { href: result.url, target: '_blank', rel: 'noopener' } }, h('span', { text: c('open') }), icon('external', 'sm'))));
    }
    const order3 = ['start', 'goal', 'task'] as const;
    const summaries = { start: start ? takenText(start) : undefined, goal: goal ? takenText(goal) : locked.goal ? c('afterStart') : undefined, task: locked.task ? c('afterGoal') : undefined };
    const steps = order3.map((name, index) => {
      const state: StepState = done[name] ? 'done' : name === current ? 'current' : 'upcoming';
      const stateWord = state === 'done' ? 'stateDone' : state === 'current' ? 'stateCurrent' : locked[name] ? 'stateLocked' : 'stateUpcoming';
      const node = step({ index: index + 1, title: c(name === 'start' ? 'stepStart' : name === 'goal' ? 'stepGoal' : 'stepTask'), ...(summaries[name] ? { summary: summaries[name] } : {}), state, open: name === chosen, locked: locked[name],
        position: c('position', { n: index + 1, total: 3, state: c(stateWord) }), attrs: { 'data-two-scenes-step': name, name: 'two-scenes-steps' } }, ...bodies[name]);
      node.addEventListener('toggle', () => { if (node.open && opened !== name) opened = name; });
      return node;
    });
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    root.replaceChildren(h('section', { class: 'create-two-scenes', testid: 'two-scenes', attrs: { 'aria-labelledby': 'two-scenes-title' } },
      h('header', { class: 'create-hero' }, h('h2', { class: 'create-hero__title', id: 'two-scenes-title', text: c('title') }), h('p', { class: 'create-hero__lead', text: c('lead') })),
      stepper({ label: c('stepsLabel') }, ...steps)));
    if (focused?.startsWith('two-scenes')) root.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({ preventScroll: true });
  }
  return { render };
}
