import type { Action, Arrow, Frame, Localized, Step, StepV2, WorldObject } from '../world/types.ts';
import type { DemonstrationStatus, HostEvent, HostReply, HostView, ModelOnlyNotice, MutationReply, PublicCheck, ResumeReply } from '../host/protocol.ts';
import { createPhase3 } from './phase3.ts';
import { catalogs } from './messages.ts';
import type { Language, Message } from './messages.ts';
import { clearTabSession, readTabSession, writeTabSession } from './tab-session.ts';
import { banner, button, card, chip, disclosure, evidence, h, icon, listPicker, openSheet, segmented, selectField, statusIcon, textField } from './ui/components.ts';
import { stepList } from './ui/stepper.ts';
import { counted } from './plural.ts';
import { drawBoard } from './ui/board-art.ts';
import type { SceneArrow, SceneStep } from './ui/board-art.ts';
import { motion } from './ui/motion.ts';
import {createExportControl} from './export.ts';
import type { IconName } from './ui/components.ts';

type Pending = { kind: 'connect' | 'start' | 'end' | 'group'; origin: string; returnId: string } | { kind: 'move'; origin: string; returnId: string; x: number; y: number };
type Workspace = 'board' | 'editor' | 'author';
const app = document.getElementById('app')!;
const cached = readTabSession();
let language: Language = cached?.language ?? (navigator.language.startsWith('de') ? 'de' : 'en');
let theme: 'system' | 'light' | 'dark' = cached?.theme ?? 'system', token = '', authorToken:string|undefined,authorAvailable=false,current: HostView | undefined, selected = '', pending: Pending | undefined;
let workspace: Workspace = cached?.workspace ?? 'board', reloadAvailable = true;
let phase3: ReturnType<typeof createPhase3> | undefined;
// Formal conditions are shown together, behind one switch at the end of the goal list.
let showFormal = false, showRuleOrigins = false;
let boardResize = new ResizeObserver(() => {});
let streamPaused = false;
let working = false, announcement = '', errorCode: string | undefined, lastCheck: PublicCheck | undefined, toolUrl: string | undefined;
// Entrance motion only for what just happened, never for a plain re-render.
let freshVerdict = false, previousHints = 0, previousHistory = 0;
// Where each step was drawn last, so a step glides to its new place instead of jumping.
const drawn = new Map<string, { x: number; y: number }>();
// Why the session is model-only (from the CLI), and the bundled example's demonstration.
let modelOnlyNotice: ModelOnlyNotice | undefined, demoTasks: string[] = [], demo: DemonstrationStatus | null = null;
/** The demonstration owns the current attempt: while it runs and after it, until a reset or variant. */
function demoAttempt(): boolean { return !!demo && !!current && demo.taskId === current.task.id && demo.attempt === current.attempt; }
function demoRunning(): boolean { return demoAttempt() && demo!.state === 'running'; }
/** Nothing may change the session: a request is in flight or the demonstration is playing. */
function locked(): boolean { return working || demoRunning(); }

function cacheSession(): void { if (token&&current) reloadAvailable = writeTabSession({ schema: 'practonaut.tab-session/2', token, ...(authorToken?{authorToken}:{}),sessionId:current.sessionId,language, theme, workspace }); }
const msg = (key: Message): string => catalogs[language][key];
const exportControl=createExportControl({current:()=>current,request:expectedRevision=>request('export',{expectedRevision}),message:msg,working:()=>locked(),demonstration:()=>demoAttempt(),setWorking:value=>{working=value;},render,announce:say});
const text = (value: Localized): string => value[language];
const tagged = <T extends Element>(node: T, id: string): T => { node.setAttribute('data-testid', id); return node; };

// Persistent frame: skip link, bar, stage with the practice mount and the workbench, live announcer.
const skip = h('a', { class: 'skip-link', attrs: { href: '#main' } });
const bar = h('header', { class: 'shell-bar' });
const practiceMount = h('div', { id: 'practice-mount' });
const workbench = h('div', { id: 'workbench' });
const stage = h('main', { class: 'shell-stage', id: 'main' }, practiceMount, workbench);
const live = tagged(h('div', { class: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } }), 'live-announcer');
stage.tabIndex = -1;
skip.addEventListener('click', event => { event.preventDefault(); if (workspace === 'author' || !current) stage.focus(); else restoreFocus(selected); });
app.replaceChildren(skip, bar, stage, live);
document.body.dataset.workspace = workspace;

// Browser focus scrolling does not account for the sticky app bar. Keep a keyboard-focused
// field in the main content below it, including when Shift+Tab walks back up a long panel.
stage.addEventListener('focusin', event => {
  const target=event.target;
  if (!(target instanceof HTMLElement) || !target.matches('input,select,textarea,button,summary,a[href]')) return;
  requestAnimationFrame(() => {
    if(document.activeElement!==target || !target.matches(':focus-visible')) return;
    const bounds=target.getBoundingClientRect(), obstruction=bar.getBoundingClientRect();
    if(bounds.height>0 && bounds.top<obstruction.bottom && bounds.bottom>0) target.scrollIntoView({block:'center',behavior:'instant'});
  });
});

function say(content: string): void {
  announcement = content; live.textContent = content;
}
/** Counted phrase by the language's plural rules: "1 arrow", "2 arrows"; "1 Pfeil", "2 Pfeile". */
function count(n: number, one: Message, other: Message): string { return counted(language, n, { one: msg(one), other: msg(other) }); }
function actionCount(n: number): string { return count(n, 'action1', 'actionN'); }
/** One sentence of guidance on the board, derived from the state, never from an announcement. */
function endName(id: string | null): string { return id === null ? msg('loose') : objectName(current!.state.objects[id]); }
function arrowText(arrow: Arrow): string { return `${endName(arrow.from)} → ${endName(arrow.to)}`; }
function coachText(): string {
  // During and after the demonstration the board is its board, and the coach says so.
  if (demoAttempt()) return demoRunning() ? msg('demoCoachRunning').replace('{n}', String(demo!.done)).replace('{total}', String(demo!.total)) : msg('demoCoachDone');
  // On narrow screens the inspector with its banner is below the board: the coach says it too (R5-03).
  if (errorCode === 'unmodeled' && narrow()) return msg('coachUnmodeled');
  if (pending?.kind === 'move') return msg('coachMove');
  // On narrow screens the palette shows only symbols, so the coach names the tool in use (R3-12).
  if (pending && (pending.kind === 'connect' || pending.kind === 'group') && !narrow()) return msg(pending.kind === 'connect' ? 'coachConnectTo' : 'coachGroupWith').replace('{from}', objectName(current?.state.objects[pending.origin])).replace('{to}', objectName(current?.state.objects[selected]));
  if (pending) return narrow() ? msg('coachTargetShort').replace('{tool}', msg(pending.kind === 'connect' ? 'toolConnect' : pending.kind === 'group' ? 'toolGroup' : pending.kind === 'start' ? 'rewireStartShort' : 'rewireEndShort')) : msg('coachTarget');
  const loose = arrows().reduce((sum, arrow) => sum + (arrow.from === null ? 1 : 0) + (arrow.to === null ? 1 : 0), 0);
  if (loose) return count(loose, 'coachLoose1', 'coachLooseN');
  const object = current?.state.objects[selected];
  if (object && object.type !== 'frame') return msg('coachSelected').replace('{name}', object.type === 'arrow' ? arrowText(object) : objectName(object));
  return msg('waiting');
}
function objectName(object: WorldObject | undefined): string {
  if (!object) return msg('none');
  if (object.type === 'step') return object.label;
  if (object.type === 'frame') return object.name;
  return `${msg('arrow')} ${msg('from')} ${objectName(current?.state.objects[object.from ?? ''])} ${msg('to')} ${objectName(current?.state.objects[object.to ?? ''])}`;
}
function steps(): Step[] { return Object.values(current!.state.objects).filter((object): object is Step => object.type === 'step' && !object.deleted); }
function arrows(): Arrow[] { return Object.values(current!.state.objects).filter((object): object is Arrow => object.type === 'arrow' && !object.deleted); }
function frames(): Frame[] { return Object.values(current!.state.objects).filter((object): object is Frame => object.type === 'frame' && !object.deleted); }
/** world/2 tools appear only when the session world offers the action. */
function offers(name: string): boolean { return !!current?.actions.some(action => action.name === name); }
function v2(): boolean { return offers('set_style'); }
/** world/2 steps carry a shape; the player bundle reads the vocabulary from the session's actions. */
function isStepV2(step: Step): step is StepV2 { return Object.hasOwn(step, 'shape'); }
/** The values a world/2 action parameter allows, in the world's order (first = default). */
function choices(action: string, parameter: string): string[] { return current?.actions.find(item => item.name === action)?.parameters[parameter]?.values ?? []; }
/** Display words: Rectangle, red line, no fill … (message keys, never colour values in code). */
function styleWord(kind: 'shape' | 'line' | 'fill', value: string): string {
  const key = `${kind}${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  return Object.hasOwn(catalogs.en, key) ? msg(key as Message) : value;
}
/** Visible words for a world/2 step's style and place; colour is never the only carrier. */
function styleText(step: Step): string {
  if (!isStepV2(step)) return '';
  const parts: string[] = [];
  const [defaultShape, defaultLine, defaultFill] = [choices('add_step', 'shape')[0], choices('set_style', 'stroke')[0], choices('set_style', 'fill')[0]];
  if (step.shape !== defaultShape) parts.push(styleWord('shape', step.shape).toLowerCase());
  if (step.stroke !== defaultLine) parts.push(styleWord('line', step.stroke));
  if (step.fill !== defaultFill) parts.push(styleWord('fill', step.fill));
  if (step.groupId !== null) parts.push(msg('grouped'));
  const frame = step.frameId === null ? undefined : current!.state.objects[step.frameId];
  if (frame?.type === 'frame' && frames().length > 1) parts.push(msg('inFrame').replace('{frame}', frame.name));
  return parts.join(', ');
}
function focusObject(id: string): void {
  const node = [...document.querySelectorAll<HTMLElement | SVGElement>('[data-object-id]')].find(item => item.dataset.objectId === id);
  node?.focus({ preventScroll: true });
  if (node?.closest('.canvas')) document.querySelector('.canvas')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  else node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
/** Focus returns to the object; without one (nothing selected, object gone) it lands on the labelled drawing region, one Tab before the first step. */
function restoreFocus(id: string): void {
  focusObject(id);
  if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.board-scroll')?.focus({ preventScroll: true });
}

/** Palette groups follow the selection: step tools for a step, arrow tools for an arrow. */
/** What the palette offers right now. While a preview is pending only the way out is offered. */
function paletteVisibility(): Record<string, boolean> {
  const object = current?.state.objects[selected];
  const editing = !!pending;
  return { add: !editing, divider: !editing && !!object && object.type !== 'frame', step: !editing && object?.type === 'step', arrow: !editing && object?.type === 'arrow', remove: !editing && !!object && object.type !== 'frame', cancel: editing };
}
function syncPalette(): void {
  const object = current?.state.objects[selected];
  const visible = paletteVisibility();
  for (const node of document.querySelectorAll<HTMLElement>('[data-palette]')) node.hidden = !visible[node.dataset.palette!];
  const disabled: Record<string, boolean> = { 'action-connect': object?.type !== 'step' || steps().length < 2, 'action-group': object?.type !== 'step' || steps().length < 2, 'action-ungroup': object?.type !== 'step' || !isStepV2(object) || object.groupId === null };
  for (const [key, value] of Object.entries(disabled)) { const control = document.querySelector<HTMLButtonElement>(`[data-testid="${key}"]`); if (control) control.disabled = value; }
}
function focusedSelection(id: string): void {
  if (pending || working || !current) return;
  selected = id;
  syncPalette();
  for (const node of document.querySelectorAll('[data-object-id]')) { const chosen = node.getAttribute('data-object-id') === id; node.setAttribute('aria-pressed', String(chosen)); node.classList.toggle('selected', chosen); }
}
function selectObject(id: string, focus = true): void {
  selected = id; render(); if (focus) focusObject(id);
  say(pending && pending.kind !== 'move' ? coachText() : `${msg('selected')}: ${objectName(current?.state.objects[id])}.`);
}
/** Steps a pending relation may end on: every step except the source of a connect or group. */
function relationTargets(): Step[] {
  const origin = pending && (pending.kind === 'connect' || pending.kind === 'group') ? pending.origin : undefined;
  return steps().filter(step => step.id !== origin);
}
function cancelPreview(restore = true): void {
  if (!pending) return; const id = pending.returnId; pending = undefined; render(); if (restore) restoreFocus(id); say(msg('cancelled'));
}
function beginRelation(kind: 'connect' | 'start' | 'end' | 'group'): void {
  if (!current || working || demoAttempt()) return;
  const object = current.state.objects[selected];
  const fromStep = kind === 'connect' || kind === 'group';
  if (fromStep && object?.type !== 'step' || !fromStep && object?.type !== 'arrow') return;
  const targets = steps().filter(step => !fromStep || step.id !== selected);
  if (!targets.length) return;
  pending = { kind, origin: selected, returnId: selected };
  selected = targets[0]!.id; render(); focusObject(selected); say(`${coachText()} ${msg('editing')}`);
}
function beginMove(): void {
  const object = current?.state.objects[selected]; if (object?.type !== 'step' || working || demoAttempt()) return;
  pending = { kind: 'move', origin: selected, returnId: selected, x: object.x, y: object.y }; render(); focusObject(selected); say(msg('moving'));
}
/** The first live frame; a world/2 board may have none. */
function frameId(): string | null { return frames()[0]?.id ?? null; }
async function request<T>(route: string, payload?: unknown, signal?:AbortSignal, heldCredential?:string): Promise<HostReply<T>> {
  // Credential selection stays inside the host-origin request seam. The host's explicit
  // default-deny table owns admission; no author credential is sent through the editor port.
  const path=route.split('?',1)[0]??'',authorRoute=path==='author'||path.startsWith('author/')||path==='recording'||path.startsWith('record/');
  if(authorRoute&&!authorToken)return{ok:false,error:{code:'author_required',message:'Author capability required'}};
  const credential=heldCredential??(authorRoute?authorToken!:token);
  try {
    const response = await fetch(`/api/${route}`, { method: payload === undefined ? 'GET' : 'POST', headers: { 'X-Practonaut-Token': credential, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), ...(signal?{signal}:{}), cache: 'no-store', credentials: 'omit' });
    return await response.json() as HostReply<T>;
  } catch { return { ok: false, error: { code: 'mirror_unavailable', message: 'Host unavailable' } }; }
}
/** The catalog key for a refusal: a known limit of the application names its constraint (PADR-0049). */
function rejectionMessage(error: { code: string; details?: Record<string, unknown> }): string {
  if (error.code !== 'constraint_refused') return error.code;
  return error.details?.constraint === 'group-within-one-frame' ? 'constraintGroupWithinOneFrame' : error.details?.constraint === 'xml-text' ? 'constraintXmlText' : 'constraint_refused';
}
function rejected(code: string): void {
  pending = undefined; errorCode = code; render(); restoreFocus(selected);
  say(msg(Object.hasOwn(catalogs.en, code) ? code as Message : 'genericError'));
}
function absorb(view: HostView): void {
  if (current && view.revision < current.revision) return;
  const changed = current && current.hash !== view.hash;
  current = view;
  if (changed && toolUrl) { URL.revokeObjectURL(toolUrl); toolUrl = undefined; }
  if (selected && (!current.state.objects[selected] || current.state.objects[selected]!.deleted)) selected = '';
  if (view.result) lastCheck = view.result;
}
async function mutate(route: string, extra: Record<string, unknown> = {}, feedback: Message = 'accepted'): Promise<void> {
  if (!current || working) return;
  const before = current; const oldIds = new Set(Object.keys(before.state.objects));
  working = true; errorCode = undefined; pending = undefined; render(); say(msg('working'));
  const reply = await request<MutationReply>(route, { expectedRevision: before.revision, ...extra });
  working = false;
  if (!reply.ok) {
    if (reply.error.code === 'stale_base') { const latest = await request<HostView>('observe'); if (latest.ok) absorb(latest.value); }
    rejected(rejectionMessage(reply.error)); return;
  }
  absorb(reply.value.view);
  const added = Object.values(current!.state.objects).find(object => !oldIds.has(object.id) && !object.deleted);
  if (added) selected = added.id;
  if (route === 'reset' || route === 'variant') { lastCheck = undefined; showFormal = false; }
  render(); restoreFocus(selected); const description = route === 'act' ? current!.history.at(-1)?.description : undefined;
  const errors = current!.errors.map(error => { const sentences = text(error.explanation).match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text(error.explanation)]; return sentences.length > 2 ? `${sentences[0]!.trim()} ${sentences.at(-1)!.trim()}` : text(error.explanation); });
  say(`${description ? text(description) : msg(feedback)} ${errors.join(' ')} ${actionCount(current!.step)}.`);
}
async function act(action: Action): Promise<void> { if (!current) return; await mutate('act', { action: { ...action, baseStep: current.step } }); }
function confirmPreview(targetId = selected): void {
  if (!pending || !current) return;
  const preview = pending;
  if (preview.kind === 'move') { void act({ name: 'move_step', params: { id: preview.origin, x: preview.x, y: preview.y } }); return; }
  if (current.state.objects[targetId]?.type !== 'step') return;
  if ((preview.kind === 'connect' || preview.kind === 'group') && targetId === preview.origin) { say(msg('selfTarget')); return; }
  if (preview.kind === 'group') void act({ name: 'group_steps', params: { id: preview.origin, with: targetId } });
  else if (preview.kind === 'connect') void act({ name: 'connect', params: v2() ? { from: preview.origin, to: targetId } : { frameId: frameId(), from: preview.origin, to: targetId } });
  else void act({ name: 'reconnect_end', params: { id: preview.origin, end: preview.kind === 'start' ? 'start' : 'end', target: targetId } });
}
function removeSelected(): void {
  const object = current?.state.objects[selected]; if (!object || working || demoAttempt()) return;
  if (object.type === 'arrow') void act({ name: 'disconnect', params: { id: selected } });
  if (object.type === 'step') void act({ name: 'delete_step', params: { id: selected } });
}
function connections(): void {
  const all = arrows(); const linked = all.filter(arrow => arrow.from === selected || arrow.to === selected);
  const list = linked.length ? linked : all; if (!list.length) return;
  const index = list.findIndex(arrow => arrow.id === selected);
  selectObject(list[(index + 1) % list.length]!.id);
}
function boardKey(event: KeyboardEvent, id: string): void {
  if (event.altKey || event.ctrlKey || event.metaKey || working) return;
  const key = event.key; const object = current!.state.objects[id]!; if (!pending) selected = id;
  if (key === 'Tab') { if (pending) cancelPreview(false); return; }
  if (key === 'Escape') { event.preventDefault(); cancelPreview(); return; }
  if (pending?.kind === 'move' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    event.preventDefault(); pending.x += key === 'ArrowLeft' ? -20 : key === 'ArrowRight' ? 20 : 0; pending.y += key === 'ArrowUp' ? -20 : key === 'ArrowDown' ? 20 : 0;
    render(); focusObject(id); say(`${msg('positions')}: ${pending.x}, ${pending.y}. ${msg('moving')}`); return;
  }
  if (object.type === 'step' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
    // While connecting or grouping, the source is never offered as its own target.
    event.preventDefault(); const list = relationTargets(); const index = list.findIndex(step => step.id === id);
    const next = key === 'Home' ? 0 : key === 'End' ? list.length - 1 : (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
    selectObject(list[next]!.id); return;
  }
  if (key === 'Enter' || key === ' ') { event.preventDefault(); if (pending) confirmPreview(id); else if (object.type === 'step') beginMove(); return; }
  if (key.toLowerCase() === 'c' && object.type === 'step' && !event.shiftKey) { event.preventDefault(); beginRelation('connect'); }
  if (key.toLowerCase() === 'a' && !event.shiftKey) { event.preventDefault(); connections(); }
  if (key.toLowerCase() === 'r' && object.type === 'arrow') { event.preventDefault(); beginRelation(event.shiftKey ? 'start' : 'end'); }
  if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); removeSelected(); }
}

// ---------- Sheets ----------
type DialogKind = 'add' | 'rename' | 'move' | 'resize' | 'restyle' | 'frame' | 'renameFrame';
function dialogForm(kind: DialogKind): void {
  if (!current || working || demoAttempt()) return;
  pending = undefined;
  const object = current.state.objects[selected]; const returnId = selected;
  const step = object?.type === 'step' ? object : undefined, styled: StepV2 | undefined = step && isStepV2(step) ? step : undefined;
  const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  const body = h('div', { class: 'pn-sheet__body' });
  const makeField = (name: 'label' | 'x' | 'y' | 'width' | 'height' | 'name', value: string): HTMLElement => {
    const text = name === 'label' || name === 'name', size = name === 'width' || name === 'height';
    const { root, input } = textField({ id: `field-${name}`, testid: `input-${name}`, label: msg(name === 'name' ? 'frameName' : name), value, required: true, ...(text ? { maxLength: name === 'name' ? 256 : 4096 } : { type: 'number' as const, min: size ? 10 : -100000, max: size ? 4000 : 100000, step: 1 }) });
    input.name = name; fields[name] = input; return root;
  };
  const choose = (name: 'shape' | 'stroke' | 'fill' | 'frameId', label: Message, value: string, options: Array<{ value: string; label: string }>): HTMLElement => {
    const { root, select } = selectField({ id: `field-${name}`, testid: `input-${name}`, label: msg(label), value, options });
    select.name = name; fields[name] = select; return root;
  };
  const frameOptions = [{ value: '', label: msg('noFrame') }, ...frames().map(frame => ({ value: frame.id, label: frame.name || frame.id }))];
  const x = String(kind !== 'add' && step ? step.x : Math.min(100000, Math.max(-140, ...steps().map(item => item.x)) + 240));
  const y = String(kind !== 'add' && step ? step.y : 160);
  if (kind === 'add' || kind === 'rename') body.append(makeField('label', kind === 'rename' && step ? step.label : ''));
  if (kind === 'move') body.append(makeField('x', x), makeField('y', y));
  if (kind === 'add' && v2()) {
    const shapes = choices('add_step', 'shape');
    body.append(choose('shape', 'shape', shapes[0] ?? '', shapes.map(value => ({ value, label: styleWord('shape', value) }))));
    if (frames().length) body.append(choose('frameId', 'frameField', frameId() ?? '', frameOptions));
  }
  // A new step is placed next to the others; the position is an advanced adjustment.
  if (kind === 'add') body.append(disclosure({ summary: msg('adjustPosition'), testid: 'add-position' }, makeField('x', x), makeField('y', y)));
  if (kind === 'resize') body.append(makeField('width', String(step?.width ?? 180)), makeField('height', String(step?.height ?? 90)));
  if (kind === 'restyle') body.append(
    choose('shape', 'shape', styled?.shape ?? '', choices('set_style', 'shape').map(value => ({ value, label: styleWord('shape', value) }))),
    choose('stroke', 'lineColour', styled?.stroke ?? '', choices('set_style', 'stroke').map(value => ({ value, label: styleWord('line', value) }))),
    choose('fill', 'fillColour', styled?.fill ?? '', choices('set_style', 'fill').map(value => ({ value, label: styleWord('fill', value) }))));
  if (kind === 'frame') body.append(choose('frameId', 'frameField', styled?.frameId ?? '', frameOptions));
  if (kind === 'renameFrame') {
    const first = frames()[0];
    if (frames().length > 1) body.append(choose('frameId', 'frameField', first?.id ?? '', frameOptions.slice(1)));
    body.append(makeField('name', first?.name ?? ''));
    const select = fields.frameId, name = fields.name;
    if (select && name) select.addEventListener('change', () => { name.value = frames().find(frame => frame.id === select.value)?.name ?? ''; });
  }
  const titles: Record<DialogKind, Message> = { add: 'addTitle', rename: 'renameTitle', move: 'moveTitle', resize: 'resize', restyle: 'restyle', frame: 'frameTool', renameFrame: 'renameFrame' };
  const sheet = openSheet({
    title: msg(titles[kind]), body, initialFocus: 'first-field',
    restoreFocus: () => document.querySelector<HTMLElement>(`[data-object-id="${returnId}"]`) ?? document.querySelector<HTMLElement>('[data-testid="action-add"]'),
    actions: [{ label: msg(kind === 'add' ? 'addSubmit' : 'submit'), variant: 'primary', testid: 'action-submit', type: 'submit', onClick: () => undefined }, { label: msg('cancelShort'), testid: 'action-cancel', onClick: () => dismiss() }],
    onSubmit: () => {
      if (!sheet.form.reportValidity()) return;
      const value = (key: string): string => fields[key]!.value;
      const number = (key: string): number => Number(value(key));
      let action: Action;
      if (kind === 'add') action = v2()
        ? { name: 'add_step', params: { frameId: fields.frameId && value('frameId') ? value('frameId') : null, label: value('label'), x: number('x'), y: number('y'), width: 180, height: 90, shape: value('shape') } }
        : { name: 'add_step', params: { frameId: frameId(), width: 180, height: 100, fontFamily: 3, label: value('label'), x: number('x'), y: number('y') } };
      else if (kind === 'rename') action = { name: 'rename_step', params: { id: returnId, label: value('label') } };
      else if (kind === 'move') action = { name: 'move_step', params: { id: returnId, x: number('x'), y: number('y') } };
      else if (kind === 'resize') action = { name: 'resize_step', params: { id: returnId, width: number('width'), height: number('height') } };
      else if (kind === 'restyle') action = { name: 'set_style', params: { id: returnId, shape: value('shape'), stroke: value('stroke'), fill: value('fill') } };
      else if (kind === 'frame') action = { name: 'set_frame', params: { id: returnId, frameId: value('frameId') || null } };
      else action = { name: 'rename_frame', params: { id: fields.frameId ? value('frameId') : frames()[0]!.id, name: value('name') } };
      dismiss(false); void act(action);
    },
  });
  function dismiss(restore = true): void { sheet.dialog.close(); sheet.dialog.remove(); if (restore) restoreFocus(returnId); }
  const submit = sheet.dialog.querySelector<HTMLButtonElement>('[data-testid="action-submit"]');
  const required = fields.label ?? fields.name;
  if (submit && required) { const sync = (): void => { submit.disabled = !required.value.trim(); }; required.addEventListener('input', sync); sync(); }
}
function confirmationDialog(options: { title: Message; titleText?: string; explanation: Message; confirm: Message; confirmId: string; cancelId: string; returnId: string; accept: () => void; destructive?: boolean }): void {
  if (working || document.querySelector('dialog[open]')) return;
  pending = undefined;
  const sheet = openSheet({
    title: options.titleText ?? msg(options.title), text: msg(options.explanation), testid: options.confirmId === 'reset-confirm' ? 'reset-dialog' : 'change-dialog',
    restoreFocus: () => document.querySelector<HTMLElement>(`[data-testid="${options.returnId}"]`),
    actions: [
      { label: msg(options.confirm), variant: options.destructive === false ? 'primary' : 'danger-solid', testid: options.confirmId, onClick: () => { sheet.close(); options.accept(); } },
      { label: msg('resetCancel'), testid: options.cancelId, onClick: () => sheet.close() },
    ],
  });
}
function resetDialog(): void {
  // The demonstration's board is not the person's work: nothing to lose, nothing to ask.
  if (demoAttempt()) { ownAttempt(); return; }
  confirmationDialog({ title: 'resetTitle', explanation: 'resetExplanation', confirm: 'resetConfirm', confirmId: 'reset-confirm', cancelId: 'reset-cancel', returnId: 'reset', accept: () => { void mutate('reset', { confirmed: true }, 'resetDone'); } });
}
function changeAttempt(taskId?: string): void {
  if (!current || working || document.querySelector('dialog[open]')) return;
  if (taskId !== undefined && taskId === current.task.id) return;
  const accept = (): void => { void mutate('variant', { confirmed: true, ...(taskId === undefined ? {} : { taskId }) }, taskId === undefined ? 'variantDone' : 'taskDone'); };
  // Ask only when unsolved work would be lost: actions on the board that no passing check covers
  // (the demonstration's board is not the person's work).
  if (!current.step || solvedNow() || demoAttempt()) { accept(); return; }
  const target = taskId === undefined ? undefined : current.tasks.find(item => item.id === taskId);
  confirmationDialog({ title: taskId === undefined ? 'variantChangeTitle' : 'taskChangeTitle', ...(target ? { titleText: msg('taskChangeTitle').replace('{task}', text(target.title)) } : {}), explanation: taskId === undefined ? 'variantChangeExplanation' : 'taskChangeExplanation', confirm: taskId === undefined ? 'variantChangeConfirm' : 'taskChangeConfirm', confirmId: 'change-confirm', cancelId: 'change-cancel', returnId: taskId === undefined ? 'new-variant' : 'task-picker', accept, destructive: false });
}
async function openHint(): Promise<void> {
  if (!current || working) return; working = true; render(); const reply = await request<HostView>('hint', { expectedRevision: current.revision }); working = false;
  if (!reply.ok) { rejected(reply.error.code); return; } absorb(reply.value); render(); (document.querySelector('[data-testid="hint"]') as HTMLElement)?.focus(); say(msg('hintsDone'));
}
async function check(): Promise<void> {
  if (!current || working) return; working = true; errorCode = undefined; render(); say(msg('working'));
  const reply = await request<PublicCheck>('check', { expectedRevision: current.revision }); working = false;
  if (!reply.ok) { rejected(reply.error.code); return; } lastCheck = reply.value; freshVerdict = true; render(); (document.querySelector('[data-testid="check-result"]') as HTMLElement)?.focus(); say(msg(reply.value.passed ? 'passed' : 'failed'));
}
async function showTool(): Promise<void> {
  if (working) return; working = true; render();
  try {
    const response = await fetch('/api/tool.png', { headers: { 'X-Practonaut-Token': token }, cache: 'no-store', credentials: 'omit' });
    if (!response.ok || response.headers.get('content-type') !== 'image/png') throw new Error('image unavailable');
    if (toolUrl) URL.revokeObjectURL(toolUrl); toolUrl = URL.createObjectURL(await response.blob()); working = false; render();
  } catch { working = false; rejected('mirror_unavailable'); }
}

// ---------- Demonstration (bundled example only) ----------
/** Asks first only when the person's own unsolved work would be cleared, like a task change. */
function watchDemonstration(): void {
  if (!current || locked() || document.querySelector('dialog[open]')) return;
  const accept = (): void => { void startDemonstration(); };
  if ((!current.step && !current.hintsOpened) || solvedNow()) { accept(); return; }
  confirmationDialog({ title: 'demoConfirmTitle', explanation: 'demoConfirmExplanation', confirm: 'demoConfirm', confirmId: 'demo-confirm', cancelId: 'demo-cancel', returnId: 'demo-start', accept, destructive: false });
}
async function startDemonstration(): Promise<void> {
  if (!current || locked()) return;
  working = true; errorCode = undefined; pending = undefined; render(); say(msg('working'));
  const reply = await request<DemonstrationStatus>('demonstration', { expectedRevision: current.revision, confirmed: true });
  // The fresh attempt it started, before its first action lands.
  const latest = await request<HostView>('observe');
  working = false;
  if (latest.ok) absorb(latest.value);
  if (!reply.ok) { rejected(reply.error.code); return; }
  // An event may already have brought a later status of this demonstration.
  if (!demo || demo.attempt !== reply.value.attempt || demo.taskId !== reply.value.taskId) demo = reply.value;
  // A verdict of the attempt before is gone; one the demonstration already reached (events can be faster) stays.
  if (lastCheck && current && (lastCheck.hash !== current.hash || lastCheck.revision !== current.revision)) lastCheck = undefined;
  showFormal = false; selected = ''; previousDemoObjects = new Set(Object.keys(current!.state.objects));
  // The whole board in view while it plays (narrow screens scroll to it), the one way out focused.
  render(); document.querySelector('.canvas')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  document.querySelector<HTMLElement>('[data-testid="demo-stop"]')?.focus({ preventScroll: true });
  say(msg('demoStarted'));
}
async function stopDemonstration(): Promise<void> {
  if (!demoRunning()) return;
  // The host stops after the action in flight; the final status arrives as an event.
  const reply = await request<DemonstrationStatus | null>('demonstration/stop', {});
  if (!reply.ok) rejected(reply.error.code);
}
/** The demonstration's board is not the person's: a fresh attempt on the same task and variant. */
function ownAttempt(): void { void mutate('reset', { confirmed: true }, 'demoOwnAttemptDone'); }
/** The live object the last demonstrated action touched: what it created, else what it named. */
function lastTouched(): string {
  const last = current?.history.filter(item => item.actor.kind === 'demonstration').at(-1);
  if (!last || !current) return '';
  const live = (id: unknown): id is string => typeof id === 'string' && !!current!.state.objects[id] && !current!.state.objects[id]!.deleted;
  const created = last.effects.map(effect => effect.id).filter(id => live(id) && !previousDemoObjects.has(id));
  return created[0] ?? [last.action.params.id, last.action.params.target, last.action.params.to].find(live) ?? '';
}
/** Objects on the board before the latest demonstrated action, to tell what it created. */
let previousDemoObjects = new Set<string>();
/** What the demonstration just did, for the live region and the board's selection ring. */
function demonstrationChanged(previous: DemonstrationStatus | null): void {
  const d = demo;
  if (!d || !current || !demoAttempt()) return;
  const total = String(d.total);
  if (d.state === 'running' && d.done > (previous?.state === 'running' && previous.attempt === d.attempt ? previous.done : 0)) {
    const last = current.history.filter(item => item.actor.kind === 'demonstration').at(-1);
    // The object it touched keeps the selection ring until the next action (design §10.2).
    selected = lastTouched(); previousDemoObjects = new Set(Object.keys(current.state.objects));
    say(`${msg('demoAnnounceAction').replace('{n}', String(d.done)).replace('{total}', total)} ${last ? text(last.description) : ''} ${msg(last?.mirrorConfirmed ? 'demoAnnounceConfirmed' : 'demoAnnounceModel')}`);
    return;
  }
  if (d.state === 'running' || previous?.state !== 'running') return;
  selected = '';
  if (d.state === 'finished') { freshVerdict = true; say(`${msg('demoAnnounceFinished')} ${msg(d.passed ? 'demoPassed' : 'demoNotPassed')}`); }
  else if (d.state === 'stopped') say(msg('demoAnnounceStopped').replace('{n}', String(d.done)).replace('{total}', total));
  else say(msg('demoFailedText'));
}
/** At its end the Demonstration card comes into view from its title (the inspector scrolls on its
 * own on wide screens, the page on narrow ones) and takes the focus. */
function revealDemonstration(): void {
  const card = document.querySelector<HTMLElement>('[data-testid="demonstration"]');
  if (!card) return;
  card.focus({ preventScroll: true });
  const side = card.closest<HTMLElement>('.practice-inspector');
  if (side && side.scrollHeight > side.clientHeight && getComputedStyle(side).overflowY !== 'visible') side.scrollTop += card.getBoundingClientRect().top - side.getBoundingClientRect().top - parseFloat(getComputedStyle(side).paddingTop);
  else window.scrollBy({ top: card.getBoundingClientRect().top - bar.getBoundingClientRect().bottom, behavior: 'instant' });
}

// ---------- Board drawing ----------
const narrowQuery = window.matchMedia('(max-width: 47.99em)');
const narrow = (): boolean => narrowQuery.matches;
narrowQuery.addEventListener('change', () => { if (current) render(); });
function boardSvg(): SVGSVGElement {
  const move = pending?.kind === 'move' ? pending : undefined;
  const sceneSteps: SceneStep[] = steps().map(step => ({ id: step.id, label: step.label, x: step.x, y: step.y, width: step.width, height: step.height, ...(isStepV2(step) ? { shape: step.shape, fill: step.fill, stroke: step.stroke } : {}), ...(move && move.origin === step.id ? { at: { x: move.x, y: move.y } } : {}) }));
  const sceneArrows: SceneArrow[] = arrows().map(arrow => {
    let from = arrow.from, to = arrow.to;
    if (pending && pending.kind !== 'move' && pending.origin === arrow.id) { if (pending.kind === 'start') from = selected; if (pending.kind === 'end') to = selected; }
    return { id: arrow.id, from, to };
  });
  const roving = current!.state.objects[selected]?.type === 'step' ? selected : sceneSteps[0]?.id;
  return drawBoard({
    name: msg('board'), looseLabel: msg('loose'), frameName: frames().map(frame => frame.name).join(' · '), steps: sceneSteps, arrows: sceneArrows, selectedId: selected,
    ...(move ? { pickedId: move.origin } : {}), ...(pending ? { previewArrowId: pending.origin } : {}),
    ...(pending?.kind === 'connect' ? { connect: { from: pending.origin, to: selected } } : {}),
  }, {
    roving, drawn, animate: !motion().calm, compact: narrow(),
    decorate: (group, step) => {
      const incoming = arrows().filter(edge => edge.to === step.id).map(edge => objectName(current!.state.objects[edge.from ?? '']));
      const outgoing = arrows().filter(edge => edge.from === step.id).map(edge => objectName(current!.state.objects[edge.to ?? '']));
      group.setAttribute('role', 'button');
      const style = styleText(current!.state.objects[step.id] as Step);
      group.setAttribute('aria-label', `${step.label}${style ? ` (${style})` : ''}. ${msg('positions')}: ${step.x}, ${step.y}`);
      group.setAttribute('aria-pressed', String(selected === step.id));
      group.setAttribute('aria-description', `${msg('incoming')}: ${incoming.join(', ') || msg('none')}. ${msg('outgoing')}: ${outgoing.join(', ') || msg('none')}.`);
      group.addEventListener('click', () => { if (working) return; if (pending && pending.kind !== 'move') { selected = step.id; confirmPreview(step.id); } else selectObject(step.id); });
      group.addEventListener('focus', () => focusedSelection(step.id));
      group.addEventListener('keydown', event => boardKey(event, step.id));
    },
  });
}
function tool(shortKey: Message, fullKey: Message, glyph: IconName, id: string, click: () => void, options: { danger?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
  return button({ label: msg(shortKey), title: msg(fullKey), icon: glyph, variant: options.danger ? 'tool-danger' : 'tool', testid: id, onClick: click, disabled: !!options.disabled || working });
}
function palette(): HTMLElement | undefined {
  // While the demonstration plays, the one way out sits where the tools are; afterwards its board
  // offers no tools (the next step, an own attempt, is in the Goal card).
  if (demoAttempt()) return demoRunning() ? h('div', { class: 'practice-palette pn-floating', attrs: { role: 'group', 'aria-label': msg('demoTitle') } },
    button({ label: msg('demoStop'), title: msg('demoStopTitle'), icon: 'stop', kbd: 'Esc', variant: 'tool', class: 'pn-btn--keep-label', testid: 'demo-stop', onClick: () => { void stopDemonstration(); } })) : undefined;
  const visible = paletteVisibility();
  const group = (name: string, ...children: Node[]): HTMLElement => h('div', { class: 'practice-palette__group', attrs: { 'data-palette': name, hidden: !visible[name] || undefined } }, ...children);
  const root = h('div', { class: 'practice-palette pn-floating', attrs: { role: 'group', 'aria-label': msg('board') } });
  root.append(
    group('add', tool('addShort', 'add', 'plus', 'action-add', () => dialogForm('add')),
      ...(offers('rename_frame') && frames().length ? [tool('renameFrameShort', 'renameFrame', 'pencil', 'action-rename-frame', () => dialogForm('renameFrame'))] : [])),
    h('span', { class: 'pn-floating__divider', attrs: { 'data-palette': 'divider', 'aria-hidden': 'true', hidden: !visible.divider || undefined } }),
    group('step',
      tool('moveShort', 'move', 'move', 'action-move', () => dialogForm('move')),
      tool('renameShort', 'rename', 'pencil', 'action-rename', () => dialogForm('rename')),
      tool('connectShort', 'connect', 'connect', 'action-connect', () => beginRelation('connect'), { disabled: steps().length < 2 }),
      ...(offers('resize_step') ? [tool('resizeShort', 'resize', 'target', 'action-resize', () => dialogForm('resize'))] : []),
      ...(offers('set_style') ? [tool('styleShort', 'restyle', 'contrast', 'action-style', () => dialogForm('restyle'))] : []),
      ...(offers('group_steps') ? [tool('groupShort', 'group', 'layers', 'action-group', () => beginRelation('group'), { disabled: steps().length < 2 })] : []),
      ...(offers('ungroup') ? [tool('ungroupShort', 'ungroup', 'ellipsis', 'action-ungroup', () => { const object = current?.state.objects[selected]; if (object?.type === 'step' && isStepV2(object) && object.groupId !== null) void act({ name: 'ungroup', params: { id: selected } }); }, { disabled: (() => { const object = current?.state.objects[selected]; return !(object?.type === 'step' && isStepV2(object) && object.groupId !== null); })() })] : []),
      ...(offers('set_frame') && frames().length ? [tool('frameShort', 'frameTool', 'folder', 'action-frame', () => dialogForm('frame'))] : [])),
    group('arrow',
      tool('rewireStartShort', 'rewireStart', 'undo', 'action-rewire-start', () => beginRelation('start')),
      tool('rewireEndShort', 'rewireEnd', 'arrowRight', 'action-rewire-end', () => beginRelation('end'))),
    group('remove', tool('deleteShort', 'delete', 'trash', 'action-delete', removeSelected, { danger: true })),
    group('cancel', tool('cancelShort', 'cancel', 'x', 'cancel-preview', () => cancelPreview())),
  );
  return root;
}
function objectButton(label: string, id: string, type: 'step' | 'arrow', classNames: string, click: () => void, lead?: string): HTMLButtonElement {
  const node = h('button', { class: `pn-btn pn-btn--sm tray-chip ${classNames}`, attrs: { type: 'button', 'aria-pressed': String(id === selected) } });
  if (type === 'step') node.dataset.stepId = id; else { node.dataset.objectId = id; node.dataset.objectType = 'arrow'; }
  if (lead) node.append(h('span', { class: 'sr-only', text: lead }));
  node.append(h('span', { text: label }));
  node.addEventListener('focus', () => focusedSelection(id)); node.addEventListener('click', click); node.addEventListener('keydown', event => boardKey(event, id));
  return node;
}
function trayNode(): HTMLElement {
  const list = steps();
  const stepList = h('div', { class: 'tray-list object-list', attrs: { role: 'group', 'aria-label': msg('steps') } });
  for (const step of list) {
    const style = styleText(step);
    stepList.append(objectButton(style ? `${step.label} · ${style}` : step.label, step.id, 'step', '', () => { if (pending && pending.kind !== 'move') { selected = step.id; confirmPreview(step.id); } else selectObject(step.id, false); }));
  }
  if (!list.length) stepList.append(h('p', { class: 't-footnote t-secondary', text: msg('emptyBoard') }));
  const edges = tagged(h('div', { class: 'tray-list object-list', attrs: { role: 'group', 'aria-label': msg('connections') } }), 'connection-list');
  for (const arrow of arrows()) {
    const detached = arrow.from === null || arrow.to === null;
    const name = (id: string | null): string => id === null ? msg('loose') : objectName(current!.state.objects[id]);
    edges.append(objectButton(`${name(arrow.from)} → ${name(arrow.to)}`, arrow.id, 'arrow', detached ? 'tray-chip--loose' : '', () => selectObject(arrow.id), `${detached ? msg('loose') : msg('arrow')}: `));
  }
  if (!arrows().length) edges.append(h('p', { class: 't-footnote t-secondary', text: msg('noArrows') }));
  const stepsGroup = h('div', { class: 'tray-group' }, h('div', { class: 'tray-group__head' }, h('h3', { class: 't-eyebrow', text: msg('steps') })), stepList);
  const edgesGroup = h('div', { class: 'tray-group' }, h('div', { class: 'tray-group__head' }, h('h3', { class: 't-eyebrow', text: msg('connections').replace(/\s*\(A\)$/, '') }), button({ label: msg('nextConnection'), kbd: 'A', variant: 'plain', size: 'sm', testid: 'show-connections', onClick: connections, disabled: !arrows().length || working })), edges);
  return h('section', { class: 'practice-tray', attrs: { 'aria-label': `${msg('steps')}, ${msg('connections')}` } }, stepsGroup, edgesGroup);
}
function boardSection(): HTMLElement {
  const section = h('section', { class: 'practice-board', attrs: { 'aria-labelledby': 'board-title' } });
  section.append(h('h2', { class: 'sr-only', id: 'board-title', text: msg('board') }));
  const canvas = h('div', { class: 'canvas' });
  const scroll = h('div', { class: 'canvas__scroll board-scroll', attrs: { tabindex: 0, role: 'region', 'aria-label': msg('diagramScroll') } }, boardSvg());
  const status = tagged(h('p', { class: 'canvas__coach', text: coachText() }), 'board-status');
  const tools = palette(); canvas.append(scroll, status, ...(tools ? [tools] : []));
  // A board wider than the screen (narrow phones) says so: faded edges where more of it lies, and a
  // line under it that the region names as its description.
  const hint = h('p', { class: 'board-scroll-hint', testid: 'board-scroll-hint', text: msg('boardSwipe'), attrs: { id: 'board-scroll-hint' } });
  const edges = (): void => {
    const overflow = scroll.scrollWidth - scroll.clientWidth > 2;
    scroll.classList.toggle('is-clipped-start', overflow && scroll.scrollLeft > 2);
    scroll.classList.toggle('is-clipped-end', overflow && scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft > 2);
    hint.hidden = !overflow;
    if (overflow) scroll.setAttribute('aria-describedby', 'board-scroll-hint'); else scroll.removeAttribute('aria-describedby');
  };
  hint.hidden = true;
  scroll.addEventListener('scroll', edges, { passive: true });
  boardResize.disconnect(); boardResize = new ResizeObserver(edges); boardResize.observe(scroll);
  section.append(canvas, hint, h('p', { class: 'practice-note' }, icon('info'), h('span', { text: current!.mirror === 'off' ? msg('modelOnly') : msg('boardModel'), attrs: { 'data-testid': 'mirror-mode-note' } })));
  section.append(disclosure({ summary: msg('help'), class: 'practice-help' }, h('p', { class: 't-subhead t-secondary', text: msg('keyboard') })));
  return section;
}

// ---------- Practice head and inspector ----------
/** Exactly one filled button is visible: the next sensible action wins (design language P2). */
/** The board as it is now passed a check: nothing unsolved would be lost by moving on. */
function solvedNow(): boolean { const c = current!; return !!lastCheck && lastCheck.passed && lastCheck.hash === c.hash && lastCheck.revision === c.revision; }
/** On the demonstration's board the next step is an own attempt, whatever its verdict says. */
function primaryOwner(): 'demo' | 'variant' | 'check' { return demoAttempt() ? 'demo' : solvedNow() ? 'variant' : 'check'; }
function practiceHead(): HTMLElement {
  const c = current!;
  const head = h('section', { class: 'practice-head', attrs: { 'aria-labelledby': 'task-title' } });
  // The attempt line sits beside "Task", so a long title never pushes it onto a line of its own; on
  // the demonstration's board it says whose board it is and counts no attempt of the person.
  const meta = demoAttempt() ? msg('demoHeadMeta').replace('{actions}', actionCount(c.step)) : `${msg('attempt')} ${c.attempt} · ${actionCount(c.step)}`;
  head.append(h('div', { class: 'practice-head__top' }, h('p', { class: 't-eyebrow', text: msg('task') }), h('span', { class: 'practice-head__meta t-footnote t-secondary t-tabular', testid: 'head-meta', text: meta })),
    h('h1', { class: 'practice-head__title', id: 'task-title', text: text(c.task.title) }), h('p', { class: 'practice-head__prompt', text: text(c.task.prompt) }));
  const controls = h('div', { class: 'practice-head__controls' });
  // One step: choosing a task switches to it (a dialog asks only when unsolved work would be lost).
  controls.append(listPicker({ id: 'task-picker', testid: 'task-picker', label: msg('taskSelect'), value: c.task.id, currentWord: msg('taskCurrent'), disabled: locked(), items: c.tasks.map(item => ({ value: item.id, label: text(item.title), ...(item.level && item.referenceActions ? { detail: actionCount(item.referenceActions), meter: { value: item.level, max: 3, label: msg('taskDifficulty').replace('{n}', String(item.level)) } } : {}) })), onPick: id => changeAttempt(id) }));
  controls.append(button({ label: msg('newVariant'), title: msg('newVariant'), icon: 'shuffle', variant: 'plain', testid: 'new-variant', disabled: locked(), onClick: () => changeAttempt() }));
  // The bundled example can show its task solved once; never offered on its own board.
  if (demoTasks.includes(c.task.id) && !demoAttempt()) controls.append(button({ label: msg('demoWatch'), title: msg('demoWatch'), icon: 'play', variant: 'plain', class: 'practice-head__demo', testid: 'demo-start', disabled: working, onClick: watchDemonstration }));
  // While an agent works on the session, the head says so: the last change and who made it.
  const last = c.history.at(-1);
  if (last?.actor.kind === 'agent') controls.append(h('span', { class: 'practice-head__actor t-footnote', testid: 'head-actor' }, chip(msg('actorAgent').replace('{client}', last.actor.client), { tone: 'accent' }), h('span', { class: 't-secondary', text: msg('lastChange') })));
  head.append(controls);
  return head;
}
/** What is on the board right now, from the visible state (display only): "3 steps, 2 connections, 2 loose ends". */
function boardFacts(): string {
  const list = arrows();
  const loose = list.reduce((sum, arrow) => sum + (arrow.from === null ? 1 : 0) + (arrow.to === null ? 1 : 0), 0);
  const facts = [count(steps().length, 'factSteps1', 'factStepsN'), count(list.length, 'factArrows1', 'factArrowsN'), ...(loose ? [count(loose, 'factLoose1', 'factLooseN')] : [])].join(', ');
  // Each arrow with its direction: the most common miss is an arrow drawn the wrong way round.
  return list.length ? `${facts} (${list.map(arrowText).join('; ')})` : facts;
}
/** The world states a goal as one verdict; its sentences are shown as separate lines under that verdict. */
function sentences(value: string): string[] {
  const parts = value.match(/[^.!?]+(?:[.!?]+["”“„»«)]*|$)/g)?.map(part => part.trim()).filter(Boolean);
  return parts?.length ? parts : [value];
}
function goalCard(): HTMLElement {
  const c = current!;
  const matches = !!lastCheck && lastCheck.hash === c.hash && lastCheck.revision === c.revision;
  const stale = !!lastCheck && !matches;
  const result = tagged(card({ title: msg('conditions'), titleId: 'result-title', class: 'inspector-card' }), 'check-result'); result.tabIndex = -1;
  const kind = !lastCheck || stale ? 'unknown' : lastCheck.passed ? 'pass' : 'fail';
  const verdictIcon = stale ? icon('warning') : statusIcon(lastCheck?.passed ? 'met' : 'unmet');
  const verdict = lastCheck ? h('div', { class: `verdict ${kind}${stale ? ' stale' : ''}${freshVerdict && matches ? ' is-new' : ''}`, attrs: { role: 'status' } }, verdictIcon, h('p', { text: msg(stale ? 'stale' : demoAttempt() ? (lastCheck.passed ? 'demoPassed' : 'demoNotPassed') : lastCheck.passed ? 'passed' : 'failed') })) : undefined;
  const arriving = freshVerdict && matches;
  const goals = h('ul', { class: `goal-list${arriving ? ' is-new' : ''}` });
  // A world without sentences for its goal (world/1) states it in the prompt: those sentences are the visible lines, the formula stays behind the switch.
  const formalOnly = (condition: { formalText?: unknown }): boolean => !condition.formalText;
  const promptLines = c.task.conditions.length === 1 && formalOnly(c.task.conditions[0]!) ? sentences(text(c.task.prompt)) : undefined;
  c.task.conditions.forEach((condition, order) => {
    const entry = matches ? lastCheck!.conditions.find(value => value.id === condition.id) : undefined;
    const item = h('li', { class: `goal-item${entry ? (entry.met ? ' goal-item--met' : ' goal-item--unmet') : ''}`, vars: { '--_i': order } }, statusIcon(entry ? (entry.met ? 'met' : 'unmet') : 'pending'));
    const body = h('div', { class: 'goal-item__body' }, h('span', { class: 'condition-status sr-only', text: entry ? msg(entry.met ? 'met' : 'unmet') : msg('noCheck') }));
    const visible = promptLines ?? (formalOnly(condition) ? undefined : sentences(text(condition.text)));
    (visible ?? [text(condition.text)]).forEach((sentence, index) => body.append(h(visible ? 'p' : 'pre', { class: visible ? (index ? 'goal-item__text goal-item__text--more' : 'goal-item__text') : 'author-data', text: sentence })));
    const formal = condition.formalText ?? (promptLines ? condition.text : undefined);
    if (formal && showFormal) body.append(h('div', { class: 'goal-item__formal', testid: 'goal-formal' }, h('p', { class: 'sr-only', text: msg('formalLabel') }), h('pre', { class: 'author-data', text: text(formal) })));
    item.append(body); goals.append(item);
  });
  const hasFormal = c.task.conditions.some(condition => condition.formalText) || !!promptLines;
  const owner = primaryOwner();
  const failedNow = matches && !lastCheck!.passed;
  const quietCheck = (!c.step && !lastCheck) || failedNow;
  const facts = failedNow ? h('p', { class: 'goal-note', text: msg('factsOnBoard').replace('{facts}', boardFacts()) }) : undefined;
  // A limited attempt (PADR-0040) says, next to Check, how many changes it has used and how many
  // checks remain; with no check left the host would refuse, so Check is off.
  const budget = c.limits?.actions, changesLeft = budget ? budget.limit - budget.used : undefined;
  const changesNote = budget ? h('p', { class: 'goal-note', testid: 'changes-used', text: msg('changesUsed').replace('{used}', String(budget.used)).replace('{limit}', String(budget.limit)) }) : undefined;
  // With every change used, a new variant, undo and reset would be refused: none of them is the
  // primary action. The way on is another task, through the task picker.
  const changesNone = changesLeft === 0 ? [h('p', { class: 'goal-note', testid: 'changes-none', text: msg('changesNone') }),
    button({ label: msg('chooseTask'), variant: 'secondary', block: true, testid: 'choose-task', disabled: working, onClick: () => { document.getElementById('task-picker')?.click(); } })] : [];
  const checks = c.limits?.checks, checksLeft = checks ? checks.limit - checks.used : undefined;
  const checksNote = checks ? h('p', { class: 'goal-note', testid: 'checks-left', text: checksLeft === 0 ? msg('checksNone') : count(checksLeft!, 'checksLeft1', 'checksLeftN').replace('{limit}', String(checks.limit)) }) : undefined;
  const checkButton = button({ label: owner === 'variant' || (owner === 'demo' && matches) ? msg('checkAgain') : msg('check'), icon: 'check', variant: owner === 'check' && !quietCheck && checksLeft !== 0 ? 'primary' : owner === 'check' ? 'tinted' : 'secondary', size: 'lg', block: true, testid: 'check', onClick: () => { void check(); }, disabled: locked() || checksLeft === 0 });
  const formalSwitch = hasFormal ? button({ label: msg(showFormal ? 'formalHide' : 'formalShow'), icon: showFormal ? 'chevronUp' : 'chevronDown', variant: 'plain', size: 'sm', class: 'goal-formal-switch', testid: 'formal-switch', pressed: showFormal, onClick: () => { showFormal = !showFormal; render(); document.querySelector<HTMLElement>('[data-testid="formal-switch"]')?.focus(); } }) : undefined;
  result.append(...(verdict ? [verdict] : []), ...(facts ? [facts] : []), goals, ...(formalSwitch ? [formalSwitch] : []), h('p', { class: 'goal-note', text: msg('endOnly') }));
  if (owner === 'variant') result.append(button({ label: msg('newVariantNext'), icon: 'shuffle', variant: changesLeft === 0 ? 'secondary' : 'primary', size: 'lg', block: true, testid: 'goal-new-variant', disabled: working, onClick: () => changeAttempt() }));
  if (owner === 'demo' && !demoRunning()) result.append(button({ label: msg('demoOwnAttempt'), icon: 'reset', variant: 'primary', size: 'lg', block: true, testid: 'demo-own-attempt', disabled: working, onClick: ownAttempt }));
  for (const note of [changesNote, checksNote]) if (note) result.append(note);
  // The demonstration's board is not the person's to check: no Check while it is its board.
  if (owner !== 'demo') result.append(checkButton, ...changesNone);
  return result;
}
function hintsCard(): HTMLElement {
  const c = current!;
  const root = card({ title: msg('hints'), class: 'inspector-card', actions: [h('span', { class: 't-footnote t-secondary t-tabular', text: `${c.hintsOpened}/${c.task.hintCount} ${msg('hintCount')}` })] });
  if (c.hints.length) {
    const list = h('div', { class: 'hint-list' });
    c.hints.forEach((hint, index) => list.append(h('div', { class: `hint${index >= previousHints && c.hintsOpened > previousHints ? ' is-new' : ''}` }, icon('lightbulb'), h('p', { text: text(hint) }))));
    root.append(list);
  }
  previousHints = c.hintsOpened;
  root.append(button({ label: msg(c.hintsOpened >= c.task.hintCount ? 'allHints' : 'hint'), icon: 'lightbulb', variant: 'secondary', block: true, testid: 'hint', onClick: () => { void openHint(); }, disabled: c.hintsOpened >= c.task.hintCount || working || demoAttempt() }));
  return root;
}
function historyCard(): HTMLElement {
  const c = current!;
  const root = card({ title: msg('history'), class: 'inspector-card', actions: [
    button({ label: msg('undo'), icon: 'undo', variant: 'plain', size: 'sm', testid: 'undo', onClick: () => { void mutate('undo', {}, 'undoDone'); }, disabled: !c.step || working || demoAttempt() }),
    button({ label: msg('reset'), icon: 'reset', variant: 'plain', size: 'sm', testid: 'reset', onClick: resetDialog, disabled: (!c.step && !c.hintsOpened) || locked() }),
  ] });
  if (!c.history.length) { root.append(h('p', { class: 't-subhead t-secondary', text: msg('emptyHistory') })); return root; }
  const list = h('ol', { class: 'history-list' });
  const grew = c.history.length > previousHistory;
  previousHistory = c.history.length;
  c.history.forEach((item, index) => {
    // Who made the change comes first: an agent through MCP (with the client's declared name), the
    // bundled example's demonstration, or you.
    const actor = item.actor.kind === 'agent' ? chip(msg('actorAgent').replace('{client}', item.actor.client), { tone: 'accent', testid: 'history-actor' })
      : item.actor.kind === 'demonstration' ? chip(msg('actorDemonstration'), { icon: 'play', testid: 'history-actor' }) : chip(msg('actorYou'), { testid: 'history-actor' });
    const body = h('div', { class: 'history-entry__body' }, h('p', { class: 'history-entry__head' }, actor, h('span', { text: text(item.description) })));
    for (const consequence of item.consequences) body.append(h('p', { class: 'history-entry__consequence' }, h('span', { class: 'history-entry__then', text: `${msg('atMoment')} ` }), text(consequence.explanation)));
    if (showRuleOrigins) body.append(h('p', { class: 'rule-origin', testid: 'history-rule-origin', text: `${msg('provenance')} ${item.ruleIds.join(', ')} · ${msg(item.mirrorConfirmed ? 'origin' : 'notChecked')}` }));
    list.append(h('li', { class: `history-entry${grew && index === c.history.length - 1 ? ' is-new' : ''}`, testid: 'history-entry' }, h('span', { class: 'history-entry__index', text: String(index + 1), attrs: { 'aria-hidden': 'true' } }), body));
  });
  // One switch for the rule and origin of every entry, instead of a link under each one.
  const toggle = button({ label: msg('rules'), icon: showRuleOrigins ? 'chevronUp' : 'chevronDown', variant: 'plain', size: 'sm', class: 'history-origins-switch', testid: 'history-origins', pressed: showRuleOrigins, onClick: () => { showRuleOrigins = !showRuleOrigins; render(); document.querySelector<HTMLElement>('[data-testid="history-origins"]')?.focus(); } });
  root.append(list, toggle);
  return root;
}
function howCheckedCard(): HTMLElement {
  const c = current!;
  const root = card({ title: msg('howChecked'), class: 'inspector-card', testid: 'how-checked' });
  // How actions are checked follows the real tool, not whether this attempt counts: a demonstration's
  // attempt is never practice evidence, yet its actions were confirmed when the mirror ran.
  const mirrored = c.mirrorHealth.status === 'available';
  root.append(h('p', { class: 't-subhead' }, evidence(mirrored ? 'confirmed' : 'observed', msg(mirrored ? 'evidence' : 'noEvidence'))));
  root.append(button({ label: msg('tool'), icon: 'image', variant: 'secondary', block: true, testid: 'show-tool', onClick: () => { void showTool(); }, disabled: c.mirror === 'off' || locked() }));
  if (toolUrl) root.append(h('img', { class: 'tool-image', attrs: { src: toolUrl, alt: msg('toolAlt') } }));
  const rules = h('div', { class: 'rule-list' });
  for (const rule of c.rules) rules.append(h('div', { class: 'rule-item' }, h('span', { class: 't-footnote t-medium', text: `${msg('confirmed')} · ${rule.id}` }), h('small', { class: 'rule-origin', text: `${msg('origin')}: ${rule.evidence.map(evidence => `${evidence.run} / ${evidence.case}`).join('; ')}` })));
  root.append(disclosure({ summary: msg('rules') }, rules));
  return root;
}
/** The demonstration in three lines, the way every result is made: actions land on the board, the
 * real Excalidraw confirms each one (or the session says it is model-only), the result check judges. */
function demonstrationCard(): HTMLElement {
  const c = current!, d = demo!;
  const done = c.history.filter(item => item.actor.kind === 'demonstration');
  const confirmed = done.filter(item => item.mirrorConfirmed).length;
  const state: Record<DemonstrationStatus['state'], { word: Message; tone: 'accent' | 'neutral' | 'warning' }> = { running: { word: 'demoRunning', tone: 'accent' }, finished: { word: 'demoFinished', tone: 'neutral' }, stopped: { word: 'demoStopped', tone: 'warning' }, failed: { word: 'demoFailed', tone: 'warning' } };
  const root = card({ title: msg('demoTitle'), titleId: 'demo-title', class: 'inspector-card', testid: 'demonstration', actions: [chip(msg(state[d.state].word), { tone: state[d.state].tone, testid: 'demo-state' })] });
  // Machine-readable state for tests; people read it in the chip and the three lines.
  root.dataset.state = d.state; root.dataset.done = String(d.done);
  const count = (key: Message, n: number, total: number): string => msg(key).replace('{n}', String(n)).replace('{total}', String(total));
  // Three numbered parts of every result, titled as nouns that are true in every session; each
  // line says what happened (the step list's marker never carries it alone).
  const running = d.state === 'running', mirrored = c.mirror === 'required', complete = d.done >= d.total;
  const mirror = !mirrored ? evidence('observed', msg('demoMirrorOff')) : done.length ? evidence('confirmed', msg('demoMirrorCount').replace('{n}', String(confirmed))) : h('span', { text: msg('demoMirrorNone') });
  const verdict = d.state === 'finished' && d.passed !== undefined
    ? h('span', { class: 'demo-state' }, statusIcon(d.passed ? 'met' : 'unmet'), h('span', { text: msg(d.passed ? 'passed' : 'failed') }))
    : h('span', { class: 'demo-state' }, statusIcon('pending'), h('span', { text: msg(running ? 'demoCheckPending' : 'demoCheckSkipped') }));
  root.tabIndex = -1;
  root.append(h('p', { class: 't-subhead t-secondary', text: msg('demoIntro') }), stepList({ labelledBy: 'demo-title' }, [
    { title: msg('demoRowActions'), detail: count('demoRowActionsCount', d.done, d.total), state: complete ? 'done' : running ? 'current' : 'upcoming', testid: 'demo-actions' },
    { title: msg('demoRowMirror'), detail: mirror, state: mirrored && complete && confirmed === done.length ? 'done' : mirrored && running && done.length ? 'current' : 'upcoming', testid: 'demo-mirror' },
    { title: msg('demoRowCheck'), detail: verdict, state: d.state === 'finished' ? 'done' : running && complete ? 'current' : 'upcoming', testid: 'demo-check' },
  ]));
  // Stopped early: a sentence for people; the refusal's code one disclosure deeper.
  if (d.state === 'failed') root.append(banner({ tone: 'danger', text: msg('demoFailedText'), testid: 'demo-failed' },
    disclosure({ summary: msg('technicalDetails') }, h('p', { class: 'rule-origin', text: d.error ?? 'unknown' }))));
  return root;
}
function inviteCard(): HTMLElement {
  return card({ class: 'invite' }, h('h2', { class: 'invite__title', text: msg('introHeading') }), h('p', { class: 't-subhead t-secondary', text: msg('introBody') }), button({ label: msg('createExercise'), icon: 'plus', variant: 'secondary', testid: 'create-exercise', onClick: () => { void phase3?.select('author'); }, disabled: !phase3 }));
}
function inspector(): HTMLElement {
  const c = current!;
  const side = h('aside', { class: 'practice-inspector', attrs: { 'aria-label': `${msg('history')}, ${msg('hints')}, ${msg('result')}` } });
  const notices = h('div', { class: 'practice-notices' });
  // In the Excalidraw workspace the engine status line already explains an unmodelled editor action.
  if (errorCode && !(workspace === 'editor' && errorCode === 'unmodeled')) {
    const unmodeled = errorCode === 'unmodeled';
    notices.append(tagged(banner({ tone: unmodeled ? 'unknown' : 'danger', title: msg(unmodeled ? 'unmodeledTitle' : 'error'), text: msg(Object.hasOwn(catalogs.en, errorCode) ? errorCode as Message : 'genericError'), role: 'alert', class: `notice ${unmodeled ? 'unmodeled' : 'error'}` }), 'rejection'));
  }
  if (c.mirrorHealth.status === 'unavailable') notices.append(banner({ tone: 'danger', text: msg('mirror_unavailable'), class: 'notice error' }));
  if (c.mirrorHealth.recoveries > 0) notices.append(banner({ tone: 'warning', text: msg('mirrorRecovered').replace('{n}', String(c.mirrorHealth.recoveries)) }));
  // What the last action changed sits below the goal, so it never pushes Check result down: the
  // change itself first, then what the board still needs, all in one banner.
  const last = c.step > 0 ? c.history.at(-1) : undefined;
  const points = c.errors.map(error => text(error.explanation));
  const consequence = last ? banner({ tone: 'accent', title: msg('consequence'), text: text(last.description), class: 'notice consequence', testid: 'consequence' },
    ...(points.length ? [h('p', { class: 'consequence-open', text: msg('stillToFix') }), h('ul', { class: 'consequence-list' }, ...points.map(point => h('li', { text: point })))] : [])) : undefined;
  side.append(notices, ...(demoAttempt() ? [demonstrationCard()] : []), goalCard(), ...(consequence ? [consequence] : []), hintsCard(), historyCard(), howCheckedCard(), exportControl.view(),inviteCard());
  freshVerdict = false;
  const edges = (): void => { side.classList.toggle('is-clipped-top', side.scrollTop > 2); side.classList.toggle('is-clipped-bottom', side.scrollHeight - side.clientHeight - side.scrollTop > 2); };
  side.addEventListener('scroll', edges, { passive: true });
  requestAnimationFrame(edges);
  return side;
}

// ---------- Shell ----------
function renderBar(): void {
  skip.textContent = msg('skip');
  const brand = h('span', { class: 'shell-brand', text: 'Practonaut' });
  const controls = h('div', { class: 'shell-controls' });
  controls.append(segmented({ key: 'language', label: msg('language'), size: 'sm', value: language, items: [{ id: 'en', label: 'EN', testid: 'language-en', ariaLabel: 'English' }, { id: 'de', label: 'DE', testid: 'language-de', ariaLabel: 'Deutsch' }], onChange: id => { language = id as Language; cacheSession(); render(); say(msg('waiting')); } }));
  const { root: themeSelect } = selectField({ id: 'theme-select', label: msg('theme'), value: theme, capsule: true, bare: true, testid: 'theme-select', options: (['system', 'light', 'dark'] as const).map(value => ({ value, label: msg(value) })), onChange: value => { theme = value as typeof theme; cacheSession(); render(); } });
  themeSelect.querySelector('select')!.setAttribute('aria-label', msg('theme'));
  controls.append(themeSelect);
  const nodes: Node[] = [brand];
  // The same three workspaces on every route; one that this window cannot open says why (tooltip and accessible name).
  if (current) {
    const mode = phase3?.mode() ?? 'board';
    const modes = segmented({ key: 'modes', label: msg('modes'), value: mode, onChange: id => { if (phase3) void phase3.select(id as Workspace).catch(error => say(String(error))); }, items: (['board', 'editor', 'author'] as const).map(id => {
      // The current workspace is never shown disabled: it is where you are (R4-03).
      const label = msg(id === 'board' ? 'modePractice' : id === 'editor' ? 'modeEditor' : 'modeAuthor');
      const unavailable = id !== 'board' && (!phase3 || (id === 'author' && !authorAvailable));
      const disabled = id !== mode && (unavailable || !phase3!.canSelect(id));
      // A segment that waits for the drawing surface says so, never just greys out.
      const ariaLabel = unavailable ? msg(id === 'editor' ? 'modeUnavailableEditor' : 'modeUnavailableAuthor') : disabled ? msg('modeWaiting').replace('{mode}', label) : id === 'editor' ? msg('modeEditorTitle') : undefined;
      return { id, label, testid: `mode-${id}`, disabled, ...(ariaLabel ? { ariaLabel } : {}) };
    }) });
    // While another workspace is being prepared the current one stays pressed (it is where you are);
    // a click on it is kept and brings you back as soon as the preparation has ended, never dropped.
    if (phase3?.preparing()) modes.querySelector<HTMLButtonElement>(`[data-testid="mode-${mode}"]`)?.addEventListener('click', () => { void phase3!.select(mode).catch(error => say(String(error))); });
    nodes.push(h('div', { class: 'shell-modes' }, modes));
  }
  nodes.push(controls);
  bar.replaceChildren(...nodes);
}
/** A model-only session says so above everything, with what gets the real engine: the one
 * download with its size, a check of a Chromium that did not start, or the switch that was chosen. */
function modelOnlyBanner(): HTMLElement {
  const notice = modelOnlyNotice;
  const key: Message = !notice ? 'modelOnlyUnknown' : notice.reason === 'missing' ? 'modelOnlyMissing' : notice.reason === 'start' ? 'modelOnlyStart' : 'modelOnlyOff';
  const sentence = msg(key).replace('{name}', notice?.download?.name ?? '').replace('{size}', String(notice?.download?.megabytes ?? ''));
  const [before, after] = sentence.split('{command}');
  const body = after !== undefined && notice?.command ? h('p', {}, before, h('code', { class: 'model-only-banner__command', text: notice.command }), after) : h('p', { text: sentence });
  return banner({ tone: 'warning', title: msg('modelOnlyTitle'), class: 'notice model-only-banner', testid: 'model-only-banner' }, body);
}
function centered(glyph: IconName, title: string, body: string, danger = false): HTMLElement {
  return h('div', { class: 'shell-center' }, h('div', { class: `shell-message${danger ? ' shell-message--danger' : ''}` },
    h('span', { class: 'shell-message__glyph' }, icon(glyph)), h('h1', { class: 't-title1', text: title }), h('p', { class: 'shell-message__text', text: body }),
    ...(danger ? [] : [h('div', { class: 'shell-skeleton', attrs: { 'aria-hidden': 'true' } }, h('div', { class: 'pn-skeleton' }), h('div', { class: 'pn-skeleton' }), h('div', { class: 'pn-skeleton' }))])));
}
function render(): void {
  document.documentElement.lang = language; if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.testid;
  const focusedObject = (document.activeElement as HTMLElement | null)?.dataset?.objectId;
  renderBar();
  if (!current) {
    practiceMount.replaceChildren(errorCode ? centered('xCircle', msg('unavailable'), msg('loadError'), true) : centered('flow', msg('loading'), msg('loadingText')));
    return;
  }
  const nodes: Node[] = [];
  if (current.mirror === 'off') nodes.push(modelOnlyBanner());
  if (streamPaused) nodes.push(banner({tone:'warning',text:msg('streamRecovering'),class:'notice',testid:'stream-recovering'}));
  if (!reloadAvailable) nodes.push(banner({ tone: 'warning', text: msg('reloadUnavailable'), class: 'notice' }));
  nodes.push(practiceHead(), boardSection(), trayNode(), inspector());
  practiceMount.replaceChildren(...nodes); phase3?.update();
  if (focusedObject) focusObject(focusedObject); else if (focusedId) (document.querySelector(`[data-testid="${focusedId}"]`) as HTMLElement | null)?.focus();
}
let eventLifetime = new AbortController();
window.addEventListener('pagehide', () => eventLifetime.abort());
window.addEventListener('pageshow', event => { if (event.persisted && token) { eventLifetime = new AbortController(); void events(eventLifetime.signal); } });
async function eventPause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
/** Clean EOF is a lost subscription too. Reads resynchronise; rejected writes are never replayed. */
async function events(signal: AbortSignal = eventLifetime.signal): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch('/api/events', { headers: { 'X-Practonaut-Token': token }, credentials: 'omit', cache: 'no-store', signal });
      if (!response.ok || !response.body) throw new Error('events unavailable');
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (!signal.aborted) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 8 * 1024 * 1024) throw new Error('event stream exceeds buffer limit');
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (!data) continue;
          const value = JSON.parse(data) as HostEvent;
          if (value.type === 'changed' || value.type === 'ready') {
            failures = 0; streamPaused = false; absorb(value.view); if (!working) render();
          } else if (value.type === 'rejected' && !working) rejected(value.error.code);
          else if (value.type === 'demonstration') {
            const previous = demo, active = document.activeElement;
            const followed = !active || active === document.body || !!active.closest('[data-testid="demo-stop"]');
            demo = value.status; demonstrationChanged(previous);
            if (!working) {
              render();
              // The Stop button is gone at the end: the focus follows to the verdict and the next step.
              if (demo && demo.state !== 'running' && previous?.state === 'running' && followed) revealDemonstration();
            }
          }
        }
      }
    } catch { /* Transport, parsing and EOF use the same bounded reconnect path below. */ }
    finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
    if (signal.aborted) return;
    const alreadyPaused=streamPaused;
    streamPaused = true; if (!working && !alreadyPaused) { render(); say(msg('streamRecovering')); }
    const observedRevision=current?.revision,observedHash=current?.hash;
    const latest = await request<HostView>('observe',undefined,signal);
    if (latest.ok) { absorb(latest.value); if (!working && (current?.revision!==observedRevision || current?.hash!==observedHash)) render(); }
    await eventPause(Math.min(4000, 250 * 2 ** Math.min(failures++, 4)), signal);
  }
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && pending) { event.preventDefault(); cancelPreview(); }
  // Escape stops a playing demonstration from anywhere but an open sheet.
  else if (event.key === 'Escape' && demoRunning() && !document.querySelector('dialog[open]') && (phase3?.mode() ?? 'board') !== 'author') { event.preventDefault(); void stopDemonstration(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); if (!working && !document.querySelector('dialog[open]') && !document.querySelector<HTMLElement>('.native-editor-scroll')?.inert && current?.step && !demoAttempt()) void mutate('undo', {}, 'undoDone'); }
});
render();
const code = new URLSearchParams(location.hash.slice(1)).get('code'); history.replaceState(null, '', location.pathname);
function startPlayer(value: ResumeReply, restored: boolean): void {
  authorAvailable=Boolean(authorToken&&value.authorEnabled);if(!authorAvailable&&workspace==='author')workspace='board';
  modelOnlyNotice = value.modelOnly; demoTasks = value.demonstration?.tasks ?? []; demo = value.demonstration?.status ?? null;
  absorb(value.view); selected = ''; cacheSession();
  if (value.engineOrigin) phase3 = createPhase3(value.engineOrigin, { authorEnabled:authorAvailable,mount: workbench, navChanged: renderBar, request, current: () => current!, language: () => language, absorb, redraw: render, undo: () => mutate('undo', {}, 'undoDone'), ...(restored ? { restoredWorkspace: workspace } : {}), workspaceChanged: next => { workspace = next; cacheSession(); render(); } });
  render(); say(msg('waiting')); void events();
}
if (code) {
  clearTabSession(); token = '';authorToken=undefined;workspace = 'board';
  const reply = await request<{ token: string;authorToken?:string } & ResumeReply>('bootstrap', { code });
  if (!reply.ok) { errorCode = reply.error.code; render(); }
  else { token = reply.value.token;authorToken=reply.value.authorToken;startPlayer(reply.value, false); }
} else if (cached) {
  token = cached.token;authorToken=cached.authorToken;const practice = await request<ResumeReply>('resume');
  const author=practice.ok&&authorToken?await request<ResumeReply>('resume',undefined,undefined,authorToken):undefined;
  const authorRefused=author&&!author.ok&&author.error.code==='author_required';
  const matched=practice.ok&&practice.value.view.sessionId===cached.sessionId&&(!author||authorRefused||(author.ok&&author.value.authorEnabled===true&&author.value.view.sessionId===cached.sessionId));
  if(!matched){token='';authorToken=undefined;clearTabSession();errorCode= !practice.ok?practice.error.code:author&&!author.ok?author.error.code:'token_invalid';render();}
  else{if(authorRefused)errorCode='author_required';startPlayer(author?.ok?author.value:(practice as {ok:true;value:ResumeReply}).value,true);}
} else { errorCode = 'bootstrap_expired'; render(); }
