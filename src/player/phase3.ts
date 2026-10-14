import type { HostReply, HostView, MutationReply } from '../host/protocol.ts';
import type { AuthorView, AuthorCompileReply } from '../host/author-protocol.ts';
import type { Recording, RecordedGesture } from '../adapters/excalidraw/recorder-types.ts';
import type { RawElement } from '../adapters/excalidraw/raw.ts';
import type { Language } from './messages.ts';
import { createRecovery, ruleStatement } from './recovery.ts';
import { createTwoScenes } from './two-scenes.ts';
import { banner, button, card, chip, evidence, h, icon, openSheet, selectField, textArea, textField } from './ui/components.ts';
import type { ButtonVariant, EvidenceKind, IconName } from './ui/components.ts';
interface Context {
 mount: HTMLElement;
 navChanged?(): void;
 restoredWorkspace?: 'board'|'editor'|'author';
 authorEnabled:boolean;
 workspaceChanged?(mode:'board'|'editor'|'author'):void;
  request<T>(route: string, payload?: unknown, signal?:AbortSignal): Promise<HostReply<T>>;
  current(): HostView;
  language(): Language;
  absorb(view: HostView): void;
  redraw(): void;
  undo(): Promise<void>;
}
// Own initial-navigation bound, separate from the helper's 8s font bound and
// the existing 10s command/font-retry bounds. Not a real-time timer guarantee.
const INITIAL_EDITOR_BOOT_TIMEOUT_MS=10_000;
const copy = {
 en:{unavailableRecordings:'Some saved recordings are unreadable or unsafe. Their entries are kept; healthy recordings remain available.',unavailableDerived:'Some compiled outputs could not be inspected safely and were kept. The listed entries need separate review.',defaultAuthor:'Local author',defaultConsent:'I consent to local recording, review, deletion and compilation.',nativeLimits:'Recording in the Excalidraw canvas needs a mouse, trackpad or touch. The canvas does not provide a screen-reader editing path. Practice has keyboard controls and a text object list.',preparing:'Preparing the drawing surface…',prepareFailed:'You stay in the current area.',restoreFailed:'The drawing surface could not be restored. Your project is kept; use Try again in the drawing surface.',surfaceInvisible:'The drawing surface is not visible.',sourcesRetained:'The recordings belong to this project and cannot be removed here. Start a separate project with supported demonstrations.',observedState:'Observed',unmodeledReason:'This exercise does not model “{operation}”; the drawing surface is unchanged.',unmodeledOther:'This exercise does not model this operation; the drawing surface is unchanged.',unmodeledNext:'Use a step or arrow action instead.',dirtyProject:'Your unsaved project text is kept. Rule and question states come from the host. Reload the project before you edit further.',reloadProject:'Discard text and reload project',observed:'observations',observedOne:'observation',confirmationCount:'confirmations',confirmationOne:'confirmation',counterexamples:'counterexamples',counterexampleOne:'counterexample',eventCount:'events',eventOne:'event',changeCount:'changes',changeOne:'change',recorderOff:'Recording is off.',unknownCount:'not modeled',quarantined:'quarantined',open:'Open question',answered:'Answered',cancel:'Cancel',retry:'Check your entries and try again. If the local host stays unavailable, restart it.',workbench:'Create and record',board:'Board',editor:'Practice in Excalidraw',author:'Create exercise',limit:'You are working in the real Excalidraw. Practonaut checks every supported change; anything else is marked and undone. With a keyboard, the Practice board works better.',local:'Recordings stay on this computer and only start when you say so.',authorName:'Author',license:'Recording license',consent:'Consent note',source:'Demonstration source',scripted:'Scripted',human:'Human',start:'Start recording',stop:'Stop and save',analyze:'Analyze saved observations',refresh:'Refresh',recordings:'Recordings',review:'Review',delete:'Delete recording',events:'Semantic events and limits',hypotheses:'Rule hypotheses and questions',proposed:'Hypothesis',confirmed:'Confirmed',refuted:'Refuted',evidence:'Recording used as evidence',gestureIndex:'Gesture index (from 0)',confirm:'Confirm with selected evidence',project:'Tasks, variants and author notes (JSON)',saveProject:'Save author project',compile:'Compile confirmed rules',unknown:'No model provider · quality, hardware needs and learning effect not measured',saved:'Saved locally. Review the events before analysis.',unmodeled:'Not yet modelled',divergence:'The editor differed from the host. The host restored the confirmed scene.',ready:'Real Excalidraw ready. Recording is off.',readyDraw:'Real Excalidraw ready.',nativeLimitsDraw:'Drawing in the Excalidraw canvas needs a mouse, trackpad or touch. The canvas does not provide a screen-reader editing path. Practice has keyboard controls and a text object list.',shapeRectangle:'rectangle',shapeEllipse:'ellipse',shapeDiamond:'diamond',recording:'Recording',error:'Not completed',empty:'No saved recording yet.',ruleNeed:'A proposal cannot confirm itself. Record a new, distinguishing demonstration and choose its matching gesture. Free text is not evidence.',compileReady:'Compiled locally in your Practonaut data folder (author/). Public world and held-out checker stay separate.',taskPending:'A selected task stays pending until Apply task is confirmed.',load:'Load committed scene',clear:'New demonstration',deleteConfirm:'Delete this recording?',deleteText:'Derived packages are removed too. Saved projects that still use this recording must be deleted explicitly first.',stopped:'Recording stopped',font:'Waiting for local fonts…',eventsEmpty:'Choose Review on a recording to see its events here.',details:'Technical details',advanced:'Technical authoring details',recorderTitle:'Manual recording',engineTitle:'Drawing surface (real editor)',editorTitle:'Real Excalidraw',engineLoading:'Opening the drawing surface…',engineFailedTitle:'The drawing surface did not open',engineFailedKept:'Your project is kept.',engineRetry:'Try again',chipReady:'Ready',chipLoading:'Loading',objectsTitle:'In the drawing surface now',objectsHelp:'This list shows what is really in the drawing surface.',objectsWaiting:'Appears once the drawing surface is open.',objectsEmpty:'Nothing drawn yet.',waysLabel:'Two ways to create an exercise',wayDraw:'Draw start and goal',wayDrawLead:'Draw the start, then the goal.',wayRecord:'Record a demonstration',wayRecordLead:'Show the repair once in the real editor.',drawEmptyTitle:'Your drawing appears here',drawEmptyText:'Start an empty drawing to open the drawing surface.',looseEnd:'loose end',unnamed:'Unnamed step',scroll:'Drawing surface · scroll horizontally',swipe:'Swipe sideways to see the whole drawing surface.',stopFirst:'Stop recording before switching.'},
 de:{unavailableRecordings:'Einige gespeicherte Aufnahmen sind unlesbar oder unsicher. Ihre Einträge bleiben erhalten; intakte Aufnahmen sind weiter verfügbar.',unavailableDerived:'Einige kompilierte Ausgaben ließen sich nicht sicher prüfen und bleiben erhalten. Die aufgeführten Einträge brauchen eine eigene Prüfung.',defaultAuthor:'Lokaler Autor',defaultConsent:'Ich willige in lokale Aufnahme, Prüfung, Löschung und Kompilierung ein.',nativeLimits:'Vorführen in der Excalidraw-Zeichenfläche braucht Maus, Trackpad oder Touch. Die Zeichenfläche bietet keinen Bearbeitungsweg für Screenreader. Üben hat Tastatursteuerung und eine Objektliste als Text.',preparing:'Zeichenfläche wird vorbereitet…',prepareFailed:'Du bleibst im bisherigen Bereich.',restoreFailed:'Die Zeichenfläche konnte nicht wiederhergestellt werden. Dein Projekt bleibt erhalten; nutze „Erneut versuchen“ in der Zeichenfläche.',surfaceInvisible:'Die Zeichenfläche ist nicht sichtbar.',sourcesRetained:'Die Aufnahmen gehören zu diesem Projekt und lassen sich hier nicht entfernen. Beginne ein eigenes Projekt mit unterstützten Vorführungen.',observedState:'Beobachtet',unmodeledReason:'„{operation}“ kennt diese Übung nicht; die Zeichenfläche ist unverändert.',unmodeledOther:'Diese Aktion kennt die Übung nicht; die Zeichenfläche ist unverändert.',unmodeledNext:'Nutze stattdessen eine Schritt- oder Pfeilaktion.',dirtyProject:'Dein ungespeicherter Projekttext bleibt erhalten. Regel- und Fragestatus kommen vom Host. Lade das Projekt neu, bevor du weiter bearbeitest.',reloadProject:'Text verwerfen und Projekt neu laden',observed:'Beobachtungen',observedOne:'Beobachtung',confirmationCount:'Bestätigungen',confirmationOne:'Bestätigung',counterexamples:'Gegenbeispiele',counterexampleOne:'Gegenbeispiel',eventCount:'Ereignisse',eventOne:'Ereignis',changeCount:'Änderungen',changeOne:'Änderung',recorderOff:'Aufnahme ist aus.',unknownCount:'nicht modelliert',quarantined:'Quarantäne',open:'Offene Frage',answered:'Beantwortet',cancel:'Abbrechen',retry:'Prüfe deine Angaben und versuche es erneut. Bleibt der lokale Host unerreichbar, starte ihn neu.',workbench:'Erstellen und aufnehmen',board:'Arbeitsfläche',editor:'In Excalidraw üben',author:'Übung erstellen',limit:'Du arbeitest im echten Excalidraw. Practonaut prüft jede unterstützte Änderung; alles andere wird markiert und zurückgesetzt. Mit der Tastatur geht es im Bereich Üben besser.',local:'Aufnahmen bleiben auf diesem Rechner und starten nur, wenn du es willst.',authorName:'Autor',license:'Lizenz der Aufnahme',consent:'Einwilligungsvermerk',source:'Quelle der Vorführung',scripted:'Skriptgesteuert',human:'Mensch',start:'Aufnahme starten',stop:'Stoppen und speichern',analyze:'Gespeicherte Beobachtungen analysieren',refresh:'Neu laden',recordings:'Aufnahmen',review:'Prüfen',delete:'Aufnahme löschen',events:'Semantische Ereignisse und Grenzen',hypotheses:'Regelhypothesen und Rückfragen',proposed:'Hypothese',confirmed:'Bestätigt',refuted:'Widerlegt',evidence:'Aufnahme als Beleg',gestureIndex:'Gestenindex (ab 0)',confirm:'Mit ausgewähltem Beleg bestätigen',project:'Aufgaben, Varianten und Autorennotizen (JSON)',saveProject:'Autorenprojekt speichern',compile:'Bestätigte Regeln kompilieren',unknown:'Kein Modellanbieter · Qualität, Hardwarebedarf und Lernwirkung nicht gemessen',saved:'Lokal gespeichert. Prüfe die Ereignisse vor der Analyse.',unmodeled:'Noch nicht modelliert',divergence:'Der Editor wich vom Host ab. Der Host hat die bestätigte Szene wiederhergestellt.',ready:'Echtes Excalidraw bereit. Aufnahme ist aus.',readyDraw:'Echtes Excalidraw bereit.',nativeLimitsDraw:'Zeichnen in der Excalidraw-Zeichenfläche braucht Maus, Trackpad oder Touch. Die Zeichenfläche bietet keinen Bearbeitungsweg für Screenreader. Üben hat Tastatursteuerung und eine Objektliste als Text.',shapeRectangle:'Rechteck',shapeEllipse:'Ellipse',shapeDiamond:'Raute',recording:'Aufnahme läuft',error:'Nicht ausgeführt',empty:'Noch keine gespeicherte Aufnahme.',ruleNeed:'Ein Vorschlag kann sich nicht selbst bestätigen. Nimm eine neue, unterscheidende Vorführung auf und wähle die passende Geste. Freitext ist kein Beleg.',compileReady:'Lokal in deinem Practonaut-Datenordner (author/) kompiliert. Öffentliche Welt und zurückgehaltener Prüfer bleiben getrennt.',taskPending:'Eine ausgewählte Aufgabe bleibt vorgemerkt, bis Aufgabe anwenden bestätigt wurde.',load:'Bestätigte Szene laden',clear:'Neue Vorführung',deleteConfirm:'Diese Aufnahme löschen?',deleteText:'Daraus abgeleitete Pakete werden ebenfalls entfernt. Gespeicherte Projekte, die diese Aufnahme nutzen, musst du zuvor ausdrücklich löschen.',stopped:'Aufnahme gestoppt',font:'Warte auf lokale Schriften…',eventsEmpty:'Wähle bei einer Aufnahme Prüfen, um ihre Ereignisse hier zu sehen.',details:'Technische Details',advanced:'Technische Autorendetails',recorderTitle:'Manuelle Aufnahme',engineTitle:'Zeichenfläche (echter Editor)',editorTitle:'Echtes Excalidraw',engineLoading:'Zeichenfläche wird geöffnet…',engineFailedTitle:'Zeichenfläche nicht geöffnet',engineFailedKept:'Dein Projekt bleibt erhalten.',engineRetry:'Erneut versuchen',chipReady:'Bereit',chipLoading:'Lädt',objectsTitle:'Aktuell in der Zeichenfläche',objectsHelp:'Diese Liste zeigt, was tatsächlich in der Zeichenfläche liegt.',objectsWaiting:'Erscheint, sobald die Zeichenfläche offen ist.',objectsEmpty:'Noch nichts gezeichnet.',waysLabel:'Zwei Wege zu einer Übung',wayDraw:'Start und Ziel zeichnen',wayDrawLead:'Zeichne den Start, dann das Ziel.',wayRecord:'Vorführung aufnehmen',wayRecordLead:'Zeige die Reparatur einmal im echten Editor.',drawEmptyTitle:'Hier erscheint deine Zeichnung',drawEmptyText:'Beginne eine leere Zeichnung, um die Zeichenfläche zu öffnen.',looseEnd:'loses Ende',unnamed:'Unbenannter Schritt',scroll:'Zeichenfläche · horizontal scrollen',swipe:'Seitlich wischen, um die ganze Zeichenfläche zu sehen.',stopFirst:'Stoppe zuerst die Aufnahme.'},
} as const;

const errors = {
 en: { demonstration_running:'A demonstration is running. Stop it or wait until it ends.', demonstration_attempt:'This board belongs to the demonstration. Start your own attempt to work on it.', author_required:'Creating an exercise needs author access in this tab. Practice remains available. Start a fresh author session on this computer to create.', recording_in_use:'This recording is still used by saved projects, or unreadable projects may refer to it. Delete these projects explicitly first:', evidence_unmodeled:'This project contains changes that are not modeled yet. Its recordings are kept, but their rules cannot be used. Save this draft and start a separate project with only the shown pilot actions.', project_store_busy:'Another save is still running or was interrupted, so this one could not finish. Saved projects can still be opened. Wait a moment and try again; if it persists, keep this page open and look at the technical details.', compilation_missing:'There is no checked exercise yet. Check and create the exercise before you open it.',compilation_changed:'The project, its recordings or the checked exercise changed. Check and create the exercise again before you open it.',session_busy:'The previous action is still being confirmed. Wait for it to finish, then try again.', checker_invalid:'The checker examples are incomplete or do not match the task. Add a valid reference, an alternative and a failing near miss for every public and held-out task.',compile_incomplete:'The exercise is incomplete. Look at the open items under Finish.',variant_unsolved:'A variant has no valid solution. Review the task and its solution steps.',rights_missing:'Complete the recording license and consent before you compile.',provenance_missing:'Choose saved recordings and an author so every rule keeps its source.',confirmation_without_evidence:'Confirm the rule with a new recorded demonstration before you compile.',checker_fixture_invalid:'Add a passing alternative and a failing near miss for every task; held-out tasks stay in the checker.', confirmation_requires_new_observation:'The demonstration that suggested a rule cannot confirm it. Record a new demonstration and choose that one. A new matching demonstration stays usable after another analysis.', evidence_missing:'The chosen change is missing or cannot confirm anything. Choose a saved, modeled change that is not excluded.', hypothesis_refuted:'This rule has a counterexample. The counterexample is kept; demonstrate a different rule.', evidence_ambiguous:'Delete a step that has an attached arrow, so the demonstration shows whether arrows stay or go.', compile_tasks_missing:'Define the tasks, variants and a solution for each variant before you compile.', compile_rules_missing:'Confirm rules with new demonstrations before you compile.', recording_limit:'The recording reached its local limit and has stopped. Refresh and review the saved data before you continue.', stale_base:'The project changed in the meantime. Refresh it and choose the action again.', evidence_required:'Text edits cannot confirm rules. Choose a new recorded demonstration instead.', recording_inactive:'Start a recording before you demonstrate.', author_project_missing:'Analyze your demonstrations before you confirm or compile.', compile_solutions_missing:'Add a valid solution for every task and variant.', compile_variant_unsolvable:'A variant has no checked solution. Review its task and the recorded actions.' },
 de: { demonstration_running:'Eine Vorführung läuft. Halte sie an oder warte, bis sie endet.', demonstration_attempt:'Diese Arbeitsfläche gehört zur Vorführung. Beginne einen eigenen Versuch, um daran zu arbeiten.', author_required:'Zum Erstellen braucht dieser Tab Autorenzugriff. Üben bleibt verfügbar. Starte zum Erstellen eine neue Autorensitzung auf diesem Rechner.', recording_in_use:'Gespeicherte Projekte nutzen diese Aufnahme oder unlesbare Projekte könnten auf sie verweisen. Lösche diese Projekte zuerst ausdrücklich:', evidence_unmodeled:'Dieses Projekt enthält Änderungen, die noch nicht modelliert sind. Die Aufnahmen bleiben erhalten, ihre Regeln sind aber nicht verwendbar. Speichere den Entwurf und beginne ein eigenes Projekt nur mit den gezeigten Pilotaktionen.', project_store_busy:'Ein anderer Speichervorgang läuft noch oder wurde unterbrochen, deshalb ließ sich nicht speichern. Gespeicherte Projekte kannst du weiterhin öffnen. Warte kurz und versuche es erneut; bleibt die Meldung, halte die Seite offen und sieh dir die technischen Details an.', compilation_missing:'Es gibt noch keine geprüfte Übung. Prüfe und erzeuge die Übung, bevor du sie öffnest.',compilation_changed:'Das Projekt, seine Aufnahmen oder die geprüfte Übung haben sich geändert. Prüfe und erzeuge die Übung erneut, bevor du sie öffnest.',session_busy:'Die vorherige Aktion wird noch bestätigt. Warte, bis sie fertig ist, und versuche es dann erneut.', checker_invalid:'Die Beispiele des Prüfers sind unvollständig oder passen nicht zur Aufgabe. Ergänze für jede öffentliche und zurückgehaltene Aufgabe ein gültiges Ergebnis, eine Alternative und einen scheiternden Beinahe-Treffer.',compile_incomplete:'Die Übung ist unvollständig. Sieh dir die offenen Punkte unter Fertigstellen an.',variant_unsolved:'Eine Variante hat keine gültige Lösung. Prüfe die Aufgabe und ihre Lösungsschritte.',rights_missing:'Ergänze Lizenz und Einwilligung der Aufnahmen, bevor du kompilierst.',provenance_missing:'Wähle gespeicherte Aufnahmen und einen Autor, damit jede Regel ihre Quelle behält.',confirmation_without_evidence:'Bestätige die Regel mit einer neuen aufgezeichneten Vorführung, bevor du kompilierst.',checker_fixture_invalid:'Ergänze je Aufgabe eine erfolgreiche Alternative und einen scheiternden Beinahe-Treffer. Zurückgehaltene Aufgaben bleiben im Prüfer.', confirmation_requires_new_observation:'Die Vorführung, die eine Regel vorgeschlagen hat, kann sie nicht bestätigen. Nimm eine neue Vorführung auf und wähle diese. Eine neue passende Vorführung bleibt auch nach erneuter Analyse verwendbar.', evidence_missing:'Die gewählte Änderung fehlt oder kann nichts bestätigen. Wähle eine gespeicherte, modellierte Änderung, die nicht ausgeschlossen ist.', hypothesis_refuted:'Diese Regel hat ein Gegenbeispiel. Es bleibt erhalten; zeige eine andere Regel.', evidence_ambiguous:'Lösche einen Schritt mit angebundenem Pfeil, damit die Vorführung zeigt, ob Pfeile bleiben oder verschwinden.', compile_tasks_missing:'Lege Aufgaben, Varianten und je Variante eine Lösung fest, bevor du kompilierst.', compile_rules_missing:'Bestätige Regeln mit neuen Vorführungen, bevor du kompilierst.', recording_limit:'Die Aufnahme hat ihre lokale Grenze erreicht und wurde gestoppt. Lade neu und prüfe die gespeicherten Daten, bevor du weitermachst.', stale_base:'Das Projekt hat sich inzwischen geändert. Lade es neu und wähle die Aktion erneut.', evidence_required:'Textänderungen bestätigen keine Regeln. Wähle stattdessen eine neue aufgezeichnete Vorführung.', recording_inactive:'Starte eine Aufnahme, bevor du vorführst.', author_project_missing:'Analysiere deine Vorführungen, bevor du bestätigst oder kompilierst.', compile_solutions_missing:'Ergänze eine gültige Lösung für jede Aufgabe und Variante.', compile_variant_unsolvable:'Eine Variante hat keine geprüfte Lösung. Prüfe ihre Aufgabe und die aufgezeichneten Aktionen.' },
} as const;
const operations = {
 en:{strokeColor:'Stroke color',backgroundColor:'Background color',fillStyle:'Fill style',strokeWidth:'Stroke width',strokeStyle:'Stroke style',roughness:'Sketch style',opacity:'Opacity',points:'Arrow bending',angle:'Rotation',roundness:'Corner rounding',groupIds:'Grouping',fontFamily:'Font family',ellipse:'Ellipse',freedraw:'Free drawing',image:'Image',redo:'Redo',other:'This operation'},
 de:{strokeColor:'Linienfarbe',backgroundColor:'Hintergrundfarbe',fillStyle:'Füllstil',strokeWidth:'Linienbreite',strokeStyle:'Linienstil',roughness:'Skizzenstil',opacity:'Deckkraft',points:'Pfeilbiegen',angle:'Drehung',roundness:'Eckenrundung',groupIds:'Gruppierung',fontFamily:'Schriftfamilie',ellipse:'Ellipse',freedraw:'Freihandzeichnung',image:'Bild',redo:'Wiederholen',other:'Diese Operation'},
} as const;
type Operation=keyof typeof operations.en;
// Labels come from a fixed local catalog; untrusted element strings remain data.
function unknownOperation(message:Record<string,unknown>):Operation {
 if(message.message==='Redo is not modeled')return 'redo';
 const elements=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.filter((e):e is Record<string,unknown>=>e!==null&&typeof e==='object'&&!Array.isArray(e)):[];
 const before=new Map(elements(message.before).map(e=>[e.id,e]));
 for(const after of elements(message.after)){
  const previous=before.get(after.id);
  if(!previous&&['ellipse','freedraw','image'].includes(String(after.type)))return after.type as Operation;
  if(previous)for(const attribute of ['strokeColor','backgroundColor','fillStyle','strokeWidth','strokeStyle','roughness','opacity','points','angle','roundness','groupIds','fontFamily'] as const)if(JSON.stringify(previous[attribute])!==JSON.stringify(after[attribute]))return attribute;
 }
 return 'other';
}
type Key=keyof typeof copy.en;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls=''):HTMLElementTagNameMap[K]{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;}
function tagged<T extends HTMLElement>(n:T,id:string):T{n.dataset.testid=id;return n;}
function stable(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';const obj=value as Record<string,unknown>;return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+stable(obj[k])).join(',')+'}';}
async function hash(value:unknown):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value)));return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
/** Step shapes a world can hold: world/1 rectangles, world/2 rectangles, ellipses and diamonds. */
const SHAPES=new Set(['rectangle','ellipse','diamond']);
// Presentation acknowledgement compares modeled object content, not native version/layout metadata.
function nativeContent(elements:RawElement[]):unknown[]{return elements.map(e=>{const base=[e.id,e.type,e.isDeleted,e.frameId];if(SHAPES.has(e.type))return [...base,e.x,e.y,e.width,e.height,e.strokeColor,e.backgroundColor,[...((e.groupIds as string[]|undefined)??[])]];if(e.type==='text')return [...base,e.containerId,e.originalText??e.text,e.fontFamily];if(e.type==='frame')return [...base,e.name];if(e.type==='arrow')return [...base,e.startBinding?.elementId??null,e.endBinding?.elementId??null];throw new Error('Unexpected native scene object');}).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));}
export type Workspace3='board'|'editor'|'author';
export function createPhase3(engineOrigin:string,context:Context):{update():void;select(mode:Workspace3):Promise<void>;mode():Workspace3;canSelect(mode:Workspace3):boolean} {
 const root=tagged(node('section','','phase3-workbench'),'phase3');root.setAttribute('aria-labelledby','phase3-title');context.mount.append(root);
 const heading=node('h2','','sr-only');heading.id='phase3-title';
 // Engine panel: head (title, note, state chip), the coming scene while there is no project, the real editor, the object list.
 const enginePanel=node('section','','engine-panel');enginePanel.setAttribute('aria-labelledby','engine-panel-title');
 const engineTitle=h('h2',{class:'engine-panel__title',id:'engine-panel-title'}),note=node('p','','engine-note'),engineChip=h('span',{class:'engine-panel__chip'});
 const engineTasks=h('div',{class:'engine-tasks'});
 const engineHead=h('header',{class:'engine-panel__head'},engineTitle,engineChip,note,engineTasks);
 const emptyScene=h('div',{class:'engine-empty'});
 const createEditorFrame=():HTMLIFrameElement=>{const frame=tagged(node('iframe'),'real-editor');frame.title='Excalidraw';frame.setAttribute('sandbox','allow-scripts allow-same-origin');return frame;};
 let iframe=createEditorFrame(); // Navigation starts only after the listener and initial deadline exist.
 // One status for engine state; quiet while all is well, a kit banner when something needs attention.
 const status=tagged(h('div',{class:'phase3-status',attrs:{role:'status','aria-live':'polite'}}),'phase3-status');
 const authorPanel=node('div','','create-advanced__panels');const guided=tagged(node('div','','create-guide'),'recovery-guide');
 const advancedSummary=h('summary');
 const advanced=tagged(h('details',{class:'create-advanced pn-disclosure'},advancedSummary,h('div',{class:'create-advanced__body'},authorPanel)),'author-advanced');
 advanced.addEventListener('toggle',()=>{if(mode==='author')syncEditor();});
 // While a recording runs its bar sits at the top of the guide column and sticks under the app bar (a stage item, so it stays in reach over the editor too).
 const recordingDock=h('div',{class:'create-recording-dock'});
 const engineSlot=node('div','','engine-slot');engineSlot.append(enginePanel);
 // The second way to create: two drawings instead of a demonstration (shown in the Create workspace).
 const twoScenesRoot=tagged(node('div','','create-two-scenes-slot'),'two-scenes-slot');let twoScenes:{render():void}|undefined;
 // Two equal ways to create, side by side at the top: draw start and goal, or record a demonstration.
 const ways=tagged(h('div',{class:'create-ways',attrs:{role:'group'}}),'create-ways');let way:'draw'|'record'|undefined,drawStarted=false;
 // Recording stays the way a Create session opens in (saved projects and a running recording live there); drawing is one click away, never below.
 const currentWay=():'draw'|'record'=>view?.recording.active?'record':way??'record';
 // The draw way records nothing, so its status never mentions recording.
 const readyText=():string=>c(mode==='author'&&currentWay()==='draw'?'readyDraw':'ready');
 root.append(heading,ways,status,recordingDock,guided,twoScenesRoot,engineSlot,advanced);
 // The dock sticks right under the app bar, whose height changes with its rows (narrow) and the pointer.
 const appBar=document.querySelector<HTMLElement>('.shell-bar');
 if(appBar)new ResizeObserver(()=>document.documentElement.style.setProperty('--_appbar',`${Math.ceil(appBar.getBoundingClientRect().height)}px`)).observe(appBar);
 const nativeScroll=node('div','','native-editor-scroll');nativeScroll.tabIndex=0;nativeScroll.setAttribute('role','region');nativeScroll.append(iframe);const nativeObjects=node('section','','native-objects');
 // The list speaks about the open drawing surface only; while it opens (or failed) one sentence stands in its place.
 const objectsTitle=h('h3',{class:'native-objects__title'}),objectsHelp=h('p',{class:'native-objects__help'}),objectsWaiting=h('p',{class:'native-objects__waiting',testid:'native-objects-waiting'}),objectsList=h('ul',{class:'native-objects__list'});
 nativeObjects.append(objectsTitle,objectsHelp,objectsWaiting,objectsList);
 // Narrow screens: the editor keeps its width and scrolls sideways; this line says so (the region's name says it to assistive technology).
 const swipe=h('p',{class:'engine-swipe',testid:'engine-swipe'});
 // Loading and failure of the drawing surface are shown in its own place, over the editor (one wrapper built once).
 const engineState=h('div',{class:'engine-state',testid:'engine-state',attrs:{hidden:true}});const engineStage=h('div',{class:'engine-stage'},nativeScroll,engineState);
 const drawEmpty=h('div',{class:'engine-empty',testid:'engine-draw-empty',attrs:{hidden:true}});
 enginePanel.append(engineHead,emptyScene,drawEmpty,swipe,engineStage,nativeObjects);
 let mode:'board'|'editor'|'author'='board',port:MessagePort|undefined,ready=false,sequence=0,view:AuthorView|undefined,review:Recording|undefined,compiled:AuthorCompileReply|undefined,lastRevision=-1,changing=false;
 let transitioning=false,recoveryRequired=false,nativeMode:'author'|'editor'='author';let nativePresentation={language:'en',theme:'light'},nativeCanUndo=false;
 let fontBootstrapFailed=false,fontBootstrapRetryPending=false,portGeneration=0,fontRetrySequence=0;
 type FontRetryAttempt={id:number;timer:ReturnType<typeof setTimeout>;controller:AbortController;postSent:boolean;acceptedPort?:MessagePort;acceptedGeneration?:number};
 let fontRetryAttempt:FontRetryAttempt|undefined;
 let initialBootFailed=false,initialBootSequence=0;
 type InitialBootAttempt={frame:HTMLIFrameElement;generation:number;deadline:number;timer:ReturnType<typeof setTimeout>};
 let initialBootAttempt:InitialBootAttempt|undefined;
 let recoveryCheckpoint:{elements:RawElement[];presentation:typeof nativePresentation;mode:'author'|'editor';canUndo:boolean}|undefined;
 let restorationPending=!!context.restoredWorkspace,interruptedRecording=false;let projectDraft:string|undefined,dirtyProject=false,lastEnginePresentation='';
 let gestureTail:Promise<void>=Promise.resolve();const requests=new Map<number,{resolve:(message:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;port:MessagePort;generation:number}>();
 // Read-only presentation geometry on the existing verified port. No host command or input change.
 let boundsFrame=0,boundsActive=false,lastBounds='';
 const boundsResize=new ResizeObserver(()=>scheduleBounds());
 function sendBounds():void{
  boundsFrame=0;if(!port||!ready||iframe.hidden||nativeScroll.hidden||enginePanel.hidden)return;
  const f=iframe.getBoundingClientRect(),s=nativeScroll.getBoundingClientRect();
  const occluders=[appBar,recordingDock].filter((element):element is HTMLElement=>!!element).map(element=>element.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0&&rect.right>Math.max(f.left,s.left,0)&&rect.left<Math.min(f.right,s.right,innerWidth));
  const visibleTop=Math.max(0,...occluders.map(rect=>rect.bottom));
  const left=Math.max(f.left,s.left,0),top=Math.max(f.top,s.top,visibleTop),right=Math.min(f.right,s.right,innerWidth),bottom=Math.min(f.bottom,s.bottom,innerHeight);
  const clamp=(value:number,max:number):number=>Number.isFinite(value)?Math.min(Math.max(0,value),Math.max(0,max)):0;
  const x=clamp(left-f.left,f.width),y=clamp(top-f.top,f.height),width=clamp(right-left,f.width-x),height=clamp(bottom-top,f.height-y);
  const bounds={x,y,width,height},key=JSON.stringify(bounds);if(key===lastBounds)return;lastBounds=key;port.postMessage({type:'presentation-bounds',bounds});
 }
 function scheduleBounds():void{if(boundsActive&&!boundsFrame)boundsFrame=requestAnimationFrame(sendBounds);}
 function stopBounds():void{
  boundsActive=false;boundsResize.disconnect();cancelAnimationFrame(boundsFrame);boundsFrame=0;lastBounds='';
  nativeScroll.removeEventListener('scroll',scheduleBounds);window.removeEventListener('scroll',scheduleBounds,true);window.removeEventListener('resize',scheduleBounds);
 }
 function syncBounds():void{
  if(!ready||mode==='board'||iframe.hidden||nativeScroll.hidden||enginePanel.hidden){stopBounds();return;}
  if(!boundsActive){boundsActive=true;boundsResize.observe(nativeScroll);boundsResize.observe(iframe);if(appBar)boundsResize.observe(appBar);boundsResize.observe(recordingDock);nativeScroll.addEventListener('scroll',scheduleBounds,{passive:true});window.addEventListener('scroll',scheduleBounds,{passive:true,capture:true});window.addEventListener('resize',scheduleBounds,{passive:true});}
  scheduleBounds();
 }
 window.addEventListener('pagehide',stopBounds,{once:true});
 const c=(key:Key):string=>copy[context.language()][key];
 const count=(n:number,one:Key,other:Key):string=>`${n} ${c(new Intl.PluralRules(context.language()).select(n)==='one'?one:other)}`;
 let lastMessage: { key?:Key; code?:keyof typeof errors.en; literal?:string; retry?:boolean; technical?:string; relatedProjects?:string[]; error:boolean; operation?:Operation } = {key:'font',error:false};
 let statusSignature='';let retryTarget:Workspace3|undefined;
 /** Writes the status only when it changed, so the live region does not repeat itself on every render. */
 function paintStatus(kind:'quiet'|'error'|'unmodeled',text:string,title?:string,technical?:string,retry?:Workspace3):void{
  // The quiet line's dot is green only while the real editor is ready; loading is not success (R4-04).
  const settled=ready&&!transitioning;
  const signature=[kind,text,title??'',technical??'',retry??'',context.language(),settled].join('\u0000');if(signature===statusSignature)return;statusSignature=signature;
  if(kind==='quiet'){status.className=settled?'phase3-status is-ready':'phase3-status';status.replaceChildren(text);return;}
  status.className=kind==='error'?'phase3-status error pn-banner pn-banner--danger':'phase3-status unmodeled pn-banner pn-banner--unknown';
  const body=h('div',{class:'pn-banner__body'});if(title)body.append(h('p',{class:'pn-banner__title',text:title}));body.append(h('p',{text}));
  if(technical){const more=h('details',{class:'pn-disclosure'},h('summary',{text:c('details')}),h('div',{class:'pn-disclosure__body'},h('p',{class:'rule-origin',text:technical})));body.append(more);}
  // The way forward is a button, not a sentence: the same mode change once more.
  if(retry)body.append(h('div',{class:'phase3-status__actions'},button({label:c('engineRetry'),testid:'phase3-retry',variant:'secondary',size:'sm',icon:'reset',onClick:()=>{void configure(retry).catch(error=>say(String(error),true));}})));
  status.replaceChildren(icon(kind==='error'?'xCircle':'helpCircle'),body);
 }
 const engineAlert=():boolean=>!transitioning&&(lastMessage.error||!!lastMessage.operation);
 const displayStatus=():void=>{
  // In Create the panel itself shows that the drawing surface opens; the quiet line would only push the page down.
  if(transitioning){paintStatus('quiet',c('preparing'));status.hidden=mode==='author';paintHead();return;}
  const language=context.language();
  if(mode==='author'&&view&&!lastMessage.error&&!lastMessage.operation)paintStatus('quiet',view.recording.active?c('recording'):readyText());
  else if(lastMessage.operation)paintStatus('unmodeled',`${lastMessage.operation==='other'?c('unmodeledOther'):c('unmodeledReason').replace('{operation}',operations[language][lastMessage.operation])} ${c('unmodeledNext')}`,c('unmodeled'));
  else if(lastMessage.code)paintStatus('error',errors[language][lastMessage.code]+(lastMessage.relatedProjects?.length?' '+lastMessage.relatedProjects.join(', '):''),c('error'),lastMessage.code);
  else if(lastMessage.key)paintStatus(lastMessage.error?'error':'quiet',c(lastMessage.key),lastMessage.error?c(lastMessage.key==='prepareFailed'||lastMessage.key==='restoreFailed'?'engineFailedTitle':'error'):undefined,undefined,lastMessage.key==='prepareFailed'?retryTarget:undefined);
  else if(lastMessage.retry)paintStatus('error',c('retry'),c('error'),lastMessage.technical);
  else paintStatus(lastMessage.error?'error':'quiet',lastMessage.literal??'',lastMessage.error?c('error'):undefined);
  // An unrestored editor in Create speaks once, in its own panel (title, project kept, Try again); no banner above the page.
  status.hidden=mode==='author'&&(recoveryRequired||(!lastMessage.error&&!lastMessage.operation));paintHead();
 };
 const say=(text:string,error=false):void=>{
  retryTarget=undefined;
  if(text.includes('Project edits cannot remove source recordings'))lastMessage={key:'sourcesRetained',error:true};
  else{
   const key=(Object.keys(copy.en) as Key[]).find(key=>copy.en[key]===text||copy.de[key]===text);
   const code=(Object.keys(errors.en) as Array<keyof typeof errors.en>).find(code=>text.includes(code));
   const technical=text.match(/\b[a-z]+(?:_[a-z]+)+\b/)?.[0];
   const relatedProjects=code==='recording_in_use'?(text.split('first: ')[1]??'').split(', ').filter(id=>/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)).slice(0,32):[];
   lastMessage=code ? {code,error:true,...(relatedProjects.length?{relatedProjects}:{})} : key ? {key,error} : error ? {retry:true,error:true,...(technical?{technical}:{})} : {literal:text,error};
  }
  displayStatus();
  // One message at a time: a new engine alert replaces whatever the guide was showing.
  if(mode==='author'&&view&&engineAlert())recovery.render();
 };
 const sayUnmodeled=(message:Record<string,unknown>):void=>{lastMessage={operation:unknownOperation(message),error:false};displayStatus();};
 let headSignature='';
 function paintHead():void{
  const author=mode==='author',recordingActive=author&&!!view?.recording.active;
  // A retry after a failure shows the loading state while it runs, not the old failure.
  const failed=(recoveryRequired||fontBootstrapFailed||initialBootFailed)&&!transitioning,loading=!failed&&(transitioning||!ready),scene=author&&!!view?.project;
  nativeObjects.toggleAttribute('data-waiting',loading||failed);
  const signature=[author,recordingActive,ready,loading,failed,scene,context.language()].join('|');if(signature===headSignature)return;headSignature=signature;
  // While recording, the floating bar is the one place that says so; on failure the panel itself says it.
  // The state chip speaks about a scene; before one is prepared the panel only says where it will open.
  engineChip.replaceChildren(...(scene&&!recordingActive&&!failed?[chip(c(loading?'chipLoading':'chipReady'))]:[]));
  engineState.hidden=!loading&&!failed;engineState.dataset.kind=failed?'error':'loading';
  // A failure in the danger tone, in one place: what happened, what is kept, the way forward.
  if(failed)engineState.replaceChildren(h('div',{class:'engine-state__card',attrs:{role:'alert'}},h('span',{class:'engine-state__glyph',attrs:{'aria-hidden':'true'}},icon('xCircle')),h('p',{class:'engine-state__title',text:c('engineFailedTitle')}),
   ...(author||fontBootstrapFailed||initialBootFailed?[h('p',{class:'engine-state__text',text:c('engineFailedKept')})]:[]),
   button({label:c('engineRetry'),testid:'engine-retry',variant:'secondary',icon:'reset',onClick:()=>{try{void Promise.resolve(initialBootFailed?retryInitialBoot():fontBootstrapFailed?retryFontBootstrap():configure(mode)).catch((error:unknown)=>say(String(error),true));}catch(error){say(String(error),true);}}})));
  // Nothing stale stays behind in a live region once the surface is open.
  else if(!loading)engineState.replaceChildren();
  else engineState.replaceChildren(h('div',{class:'engine-state__card',attrs:{role:'status'}},h('div',{class:'engine-state__skeleton',attrs:{'aria-hidden':'true'}},h('span',{class:'pn-skeleton engine-state__bar'}),h('span',{class:'pn-skeleton engine-state__bar'}),h('span',{class:'pn-skeleton engine-state__bar'})),h('p',{class:'engine-state__text',text:c('engineLoading')})));
 }
 function syncEditor():void{
  // Without a project the guide shows the coming scene; the real editor stays loaded but hidden (never reparented).
  const drawing=currentWay()==='draw';
  const editorVisible=mode!=='author'||(drawing?drawStarted:!!view?.project)||advanced.open;
  iframe.hidden=!editorVisible;nativeScroll.hidden=!editorVisible;nativeObjects.hidden=!editorVisible;swipe.hidden=!editorVisible;emptyScene.hidden=editorVisible||drawing;drawEmpty.hidden=editorVisible||!drawing;syncBounds();
 }
 const showNative=():void=>{enginePanel.hidden=false;iframe.hidden=false;nativeScroll.hidden=false;nativeObjects.hidden=false;swipe.hidden=false;emptyScene.hidden=true;drawEmpty.hidden=true;/* Where the panel repeats the three changes (narrow Create), they come into view with the editor. */(engineTasks.offsetParent&&engineTasks.textContent?.trim()?engineTasks:nativeScroll).scrollIntoView({block:'start',behavior:'instant'});const rect=iframe.getBoundingClientRect();if(rect.width<=0||rect.height<=0||rect.top>=innerHeight||rect.bottom<=0)throw new Error(c('surfaceInvisible'));};
 const command=(type:string,data:Record<string,unknown>={}):Promise<Record<string,unknown>>=>{if(['configure','resync','start'].includes(type))showNative();const commandPort=port,commandGeneration=portGeneration,current=()=>port===commandPort&&portGeneration===commandGeneration;return new Promise<Record<string,unknown>>((resolve,reject)=>{
  if(!commandPort||!ready){reject(new Error(c('font')));return;}const id=++sequence;const timer=setTimeout(()=>{requests.delete(id);reject(new Error('Engine input timeout'));},10_000);requests.set(id,{resolve,reject,timer,port:commandPort,generation:commandGeneration});commandPort.postMessage({type,id,...data});
 }).then(async message=>{if(!current())throw new Error(c('font'));if(type==='language')nativePresentation={language:message.language==='de-DE'?'de':'en',theme:String(message.theme)};if(type==='configure')nativeMode=data.mode as typeof nativeMode;if(['configure','resync'].includes(type))nativeCanUndo=data.canUndo===true;if(['configure','resync','stop'].includes(type))await refreshObjects(current);if(!current())throw new Error(c('font'));return message;});};
 // The list follows the drawing as it is drawn: a light read of the editor's scene while the surface is shown.
 let refreshing=false,drawingEmpty=true;
 setInterval(()=>{
  if(mode==='board'||!ready||transitioning||recoveryRequired||changing||refreshing||iframe.hidden||document.hidden)return;
  refreshing=true;
  // Display only: a failed read leaves the last list; the engine status reports a broken surface on its own path.
  refreshObjects().catch(()=>undefined).finally(()=>{refreshing=false;});
 },1200);
 async function refreshObjects(sourceCurrent:()=>boolean=()=>true):Promise<void>{
  const reply=await command('snapshot');if(!sourceCurrent())return;const elements=reply.elements as RawElement[];
  const live=elements.filter(e=>!e.isDeleted),stepName=(id:unknown):string|undefined=>{if(!id)return undefined;const step=live.find(e=>e.id===id&&SHAPES.has(e.type));if(!step)return undefined;return String(live.find(e=>e.type==='text'&&e.containerId===id)?.originalText??c('unnamed'));};
  const list:HTMLElement[]=[];
  for(const e of live){
   if(SHAPES.has(e.type))list.push(h('li',{class:'native-object',attrs:{'data-shape':String(e.type)}},h('span',{class:`native-object__step native-object__step--${String(e.type)}`,attrs:{'aria-hidden':'true'}}),h('span',{text:stepName(e.id)??c('unnamed')}),h('span',{class:'sr-only',text:` (${c(e.type==='ellipse'?'shapeEllipse':e.type==='diamond'?'shapeDiamond':'shapeRectangle')})`})));
   if(e.type==='arrow'){const from=stepName((e.startBinding as {elementId?:string}|null)?.elementId),to=stepName((e.endBinding as {elementId?:string}|null)?.elementId);list.push(h('li',{class:from&&to?'native-object':'native-object is-loose'},icon('arrowRight','sm'),h('span',{text:`${from??c('looseEnd')} → ${to??c('looseEnd')}`})));}
  }
  objectsList.replaceChildren(...(list.length?list:[h('li',{class:'native-object native-object--empty',testid:'native-objects-empty',text:c('objectsEmpty')})]));
  // "Use the drawing as start" is only offered for a drawing with something in it.
  const empty=!live.some(e=>SHAPES.has(e.type)||e.type==='arrow');if(empty!==drawingEmpty){drawingEmpty=empty;twoScenes?.render();}
 }
 const api=async<T>(route:string,payload?:unknown,signal?:AbortSignal):Promise<T>=>{const result=await context.request<T>(route,payload,signal);if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value;};
 const action=(label:string,id:string,fn:()=>Promise<void>|void,disabled=false,variant:ButtonVariant='secondary',glyph?:IconName):HTMLButtonElement=>button({label,testid:id,variant,size:'sm',...(glyph?{icon:glyph}:{}),disabled,onClick:()=>{void Promise.resolve().then(fn).catch(error=>say(String(error),true));}});
 const fresh=async(sourceCurrent:()=>boolean=()=>true):Promise<void>=>{const next=await api<AuthorView>('author');if(!sourceCurrent())return;view=next;renderAuthor();await recovery.loadRecordings();};
 const recovery=createRecovery(guided,{language:context.language,errorMessage:reason=>{const code=reason.split(':',1)[0];if(code==='evidence_required'&&reason.includes('Project edits cannot remove source recordings'))return c('sourcesRetained');return Object.hasOwn(errors[context.language()],code!)?errors[context.language()][code as keyof typeof errors.en]:undefined;},ready:()=>ready&&!transitioning&&!recoveryRequired,interrupted:()=>interruptedRecording,showEditor:()=>{showNative();nativeScroll.focus({preventScroll:true});},command:async(type,data)=>{if(transitioning||recoveryRequired)throw new Error('session_busy');if(type==='resync'||type==='start'){const theme=document.documentElement.dataset.theme??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');await command('language',{language:context.language(),theme});}return command(type,data);},api,refresh:fresh,stopped:async()=>{await gestureTail;},setView:next=>{view=next;if(!next.recording.active)interruptedRecording=false;},showSample:()=>configure('board'),emptyScene,recordingTasks:engineTasks,recordingDock,engineFailed:()=>recoveryRequired&&!transitioning,focusEngine:()=>{const retry=engineState.querySelector<HTMLButtonElement>('button');retry?.focus({preventScroll:true});(retry??enginePanel).scrollIntoView({block:'center'});},engineAlert,clearEngineAlert:()=>{if(!engineAlert())return;lastMessage={key:'ready',error:false};displayStatus();}});
 twoScenes=createTwoScenes(twoScenesRoot,{language:context.language,drawingEmpty:()=>drawingEmpty,ready:()=>ready&&!transitioning&&!recoveryRequired&&!view?.recording.active,command:(type,data)=>{if(transitioning||recoveryRequired)throw new Error('session_busy');return command(type,data);},api,revision:()=>view?.revision??0,showEditor:()=>{drawStarted=true;showNative();nativeScroll.focus({preventScroll:true});},announce:text=>say(text)});
 async function scene():Promise<RawElement[]>{return api<RawElement[]>('editor/scene');}
 async function synchronize(sourceCurrent:()=>boolean=()=>true):Promise<void>{if(mode!=='editor'||!ready||!sourceCurrent())return;const elements=await scene();if(!sourceCurrent())return;await command('resync',{elements,canUndo:context.current().step>0});if(sourceCurrent())lastRevision=context.current().revision;}
 function blank():RawElement[]{return [{id:'demo-frame',type:'frame',name:'Demonstration',x:40,y:40,width:1100,height:650,isDeleted:false,frameId:null,boundElements:[],angle:0,strokeColor:'#1e1e1e',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],roundness:null,seed:1,version:1,versionNonce:1,updated:1,link:null,locked:false}];}
 function workspacePanels():void{document.body.dataset.workspace=mode;enginePanel.hidden=mode==='board';authorPanel.hidden=mode!=='author';ways.hidden=mode!=='author';guided.hidden=mode!=='author'||currentWay()!=='record';twoScenesRoot.hidden=mode!=='author'||currentWay()!=='draw';renderWays();advanced.hidden=mode!=='author'||currentWay()!=='record';note.textContent=mode==='author'&&currentWay()==='draw'?c('nativeLimitsDraw'):(mode==='author'?c('local')+' ':'')+c('nativeLimits');engineTitle.textContent=c(mode==='author'?'engineTitle':'editorTitle');if(mode!=='author'){emptyScene.hidden=true;drawEmpty.hidden=true;nativeScroll.hidden=false;nativeObjects.hidden=false;swipe.hidden=false;}headSignature='';paintHead();syncBounds();}
 function setTransitionBusy(busy:boolean):void{transitioning=busy;if(mode==='author')queueMicrotask(()=>twoScenes?.render());headSignature='';nativeScroll.setAttribute('aria-busy',String(busy));nativeScroll.inert=busy||recoveryRequired||fontBootstrapFailed||fontBootstrapRetryPending||initialBootFailed||!ready;guided.inert=busy;advanced.inert=busy;for(const item of document.querySelectorAll('#practice-mount > *'))item.toggleAttribute('inert',busy);updateNav();}
 function rejectOwnEngineRequests():void{for(const request of requests.values()){clearTimeout(request.timer);request.reject(new Error(c('font')));}requests.clear();}
 function clearInitialBoot():void{if(initialBootAttempt){clearTimeout(initialBootAttempt.timer);initialBootAttempt=undefined;}}
 function failInitialBoot(attempt:InitialBootAttempt):void{
  if(initialBootAttempt!==attempt||iframe!==attempt.frame||initialBootSequence!==attempt.generation)return;
  clearInitialBoot();initialBootFailed=true;portGeneration++;port?.close();port=undefined;ready=false;stopBounds();rejectOwnEngineRequests();
  // No Host/Author request, scene write, workspace change or recording action.
  setTransitionBusy(false);enginePanel.hidden=false;iframe.hidden=false;nativeScroll.hidden=false;lastMessage={key:'engineFailedTitle',error:true};displayStatus();
 }
 function initialDeadlineOpen():boolean{
  const attempt=initialBootAttempt;if(attempt&&performance.now()>=attempt.deadline){failInitialBoot(attempt);return false;}
  return !initialBootFailed;
 }
 function beginInitialBoot(freshFrame=false):void{
  clearInitialBoot();stopBounds();portGeneration++;port?.close();port=undefined;ready=false;rejectOwnEngineRequests();
  if(freshFrame){const previous=iframe;iframe=createEditorFrame();iframe.hidden=previous.hidden;previous.replaceWith(iframe);}
  initialBootFailed=false;const frame=iframe,generation=++initialBootSequence;
  const attempt:InitialBootAttempt={frame,generation,deadline:performance.now()+INITIAL_EDITOR_BOOT_TIMEOUT_MS,timer:setTimeout(()=>failInitialBoot(attempt),INITIAL_EDITOR_BOOT_TIMEOUT_MS)};initialBootAttempt=attempt;
  // Timer precedes navigation. New WindowProxy excludes every old-document advertisement.
  frame.src=engineOrigin+'/editor.html#parent='+encodeURIComponent(location.origin);
  // A booting editor document is loading: inert and announced as busy until ready or failed (both call setTransitionBusy(false)).
  nativeScroll.inert=true;nativeScroll.setAttribute('aria-busy','true');lastMessage={key:'font',error:false};displayStatus();
 }
 function retryInitialBoot():void{
  if(!initialBootFailed||transitioning||changing)return;
  // This path is solely before genuine readiness; it cannot restart a live recorder.
  beginInitialBoot(true);
 }
 function failFontBootstrap(attempt?:FontRetryAttempt):void{
  if(attempt&&fontRetryAttempt!==attempt)return;
  clearInitialBoot();
  if(fontRetryAttempt){const currentAttempt=fontRetryAttempt;clearTimeout(currentAttempt.timer);fontRetryAttempt=undefined;currentAttempt.controller.abort();}
  // Retire all callbacks captured by this document/Port epoch, even if the Port remains alive for explicit Retry.
  portGeneration++;ready=false;stopBounds();fontBootstrapFailed=true;fontBootstrapRetryPending=false;rejectOwnEngineRequests();
  setTransitionBusy(false);enginePanel.hidden=false;lastMessage={key:'engineFailedTitle',error:true};displayStatus();
 }
 async function retryFontBootstrap():Promise<void>{
  if(!fontBootstrapFailed||fontBootstrapRetryPending||transitioning||changing||!port)return;
  const retryPort=port,retryGeneration=++portGeneration;
  const attempt:FontRetryAttempt={id:++fontRetrySequence,controller:new AbortController(),postSent:false,timer:setTimeout(()=>failFontBootstrap(attempt),10_000)};fontRetryAttempt=attempt;
  const current=():boolean=>fontRetryAttempt===attempt&&port===retryPort&&portGeneration===retryGeneration;
  fontBootstrapRetryPending=true;ready=false;rejectOwnEngineRequests();setTransitionBusy(true);say(c('font'));
  try{
   if(!current())return;
   if(context.authorEnabled){
    const author=await api<AuthorView>('author',undefined,attempt.controller.signal);if(!current())return;
    if(author.recording.active){failFontBootstrap(attempt);say(c('stopFirst'),true);return;}
   }
   if(!current())return;
   fontBootstrapFailed=false;attempt.postSent=true;
   // The same single click-bound deadline covers the genuine Author precheck and subsequent authenticated navigation request.
   try{retryPort.postMessage({type:'retry-font-bootstrap'});}catch{failFontBootstrap(attempt);}
  }catch{if(current())failFontBootstrap(attempt);}
 }
 async function configure(next:typeof mode,restoring=false,sourceCurrent:()=>boolean=()=>true):Promise<void>{
  if(!sourceCurrent())return;
  if(next==='author'&&!context.authorEnabled)throw new Error('author_required');
  if(transitioning||changing)throw new Error('session_busy');
  if(view?.recording.active&&!restoring)throw new Error(c('stopFirst'));
  if(next!=='board'&&!ready)throw new Error(c('font'));
  const previous=mode,previousFocus=document.activeElement as HTMLElement|null,position={x:scrollX,y:scrollY};
  const previousNativeMode=recoveryCheckpoint?.mode??nativeMode,previousPresentation={...(recoveryCheckpoint?.presentation??nativePresentation)},previousCanUndo=recoveryCheckpoint?.canUndo??nativeCanUndo;let snapshot:RawElement[]|undefined=recoveryCheckpoint?.elements,modified=false,presentationAttempted=false;
  setTransitionBusy(true);say(c('preparing'));status.hidden=mode==='author';
  try{
   if(recoveryRequired&&recoveryCheckpoint){showNative();presentationAttempted=true;await command('language',previousPresentation);modified=true;await command('configure',{mode:previousNativeMode,elements:recoveryCheckpoint.elements,canUndo:previousCanUndo});const recovered=(await command('snapshot')).elements as RawElement[];if(stable(nativeContent(recovered))!==stable(nativeContent(recoveryCheckpoint.elements)))throw new Error('Engine recovery differs');}
   if(ready)snapshot=(await command('snapshot')).elements as RawElement[];
   if(!sourceCurrent())return;if(next==='author')await fresh(sourceCurrent);if(!sourceCurrent())return;
   if(next!=='board'){
    showNative();
    presentationAttempted=true;await command('language',{language:context.language(),theme:document.documentElement.dataset.theme??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')});
    const target=next==='editor'?await scene():view?.scene??blank();if(!sourceCurrent())return;modified=true;await command('configure',{mode:next,elements:target,canUndo:context.current().step>0});const actual=(await command('snapshot')).elements as RawElement[];if(stable(nativeContent(actual))!==stable(nativeContent(target)))throw new Error('Engine scene differs from requested scene');
    lastRevision=context.current().revision;
   }
   if(!sourceCurrent())return;mode=next;recoveryRequired=false;recoveryCheckpoint=undefined;workspacePanels();
   if(restoring&&mode==='author'&&view?.recording.active)interruptedRecording=true;
   context.workspaceChanged?.(mode);renderAuthor();say(readyText());
  }catch(error){
   if(!sourceCurrent())return;let restored=!recoveryRequired;
   if(presentationAttempted||modified)try{showNative();await command('language',previousPresentation);if(modified&&snapshot){await command('configure',{mode:previousNativeMode,elements:snapshot,canUndo:previousCanUndo});const actual=(await command('snapshot')).elements as RawElement[];if(stable(nativeContent(actual))!==stable(nativeContent(snapshot)))throw new Error('Engine restoration differs');}restored=true;}catch{restored=false;}
   if(!sourceCurrent())return;mode=previous;recoveryRequired=!restored;recoveryCheckpoint=!restored&&snapshot?{elements:snapshot,presentation:previousPresentation,mode:previousNativeMode,canUndo:previousCanUndo}:undefined;workspacePanels();renderAuthor();
   if(!restored){enginePanel.hidden=false;iframe.hidden=false;nativeScroll.hidden=false;say(c('restoreFailed'),true);}
   else{say(c('prepareFailed'),true);retryTarget=next;statusSignature='';}
   scrollTo(position.x,position.y);(previousFocus?.dataset.testid?document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(previousFocus.dataset.testid)}"]`):previousFocus)?.focus({preventScroll:true});return;
  }finally{if(sourceCurrent()){setTransitionBusy(false);displayStatus();
   // The guide was drawn while the transition ran; its actions that wait for the editor are usable only now.
   if(mode==='author'&&view)recovery.render(view);
   if(lastMessage.error){const target=engineState.querySelector<HTMLButtonElement>('[data-testid=engine-retry]')??status.querySelector<HTMLButtonElement>('button')??status;target.tabIndex=target.tabIndex<0?0:target.tabIndex;target.focus({preventScroll:true});target.scrollIntoView({block:'center'});}
  }}
  if(sourceCurrent()&&mode!=='board'&&!iframe.hidden){showNative();nativeScroll.focus({preventScroll:true});}
 }
 function updateNav():void {if(mode==='author')twoScenes?.render();nativeScroll.setAttribute('aria-label',c('scroll'));swipe.textContent=c('swipe');objectsTitle.textContent=c('objectsTitle');objectsHelp.textContent=c('objectsHelp');objectsWaiting.textContent=c('objectsWaiting');advancedSummary.textContent=c('advanced');heading.textContent=c('workbench');if(mode==='author')renderWays();note.textContent=mode==='author'&&currentWay()==='draw'?c('nativeLimitsDraw'):(mode==='author'?c('local')+' ':'')+c('nativeLimits');engineTitle.textContent=c(mode==='author'?'engineTitle':'editorTitle');paintHead();context.navChanged?.();}
 async function readRecording(id:string):Promise<Recording>{return api<Recording>('recording?id='+encodeURIComponent(id));}
 async function submitGesture(gesture:RecordedGesture):Promise<void>{if(!view?.recording.active)throw new Error('recording_inactive');try{view=await api<AuthorView>('record/gesture',{expectedRevision:view.revision,gesture});renderAuthor();await refreshObjects();}catch(error){await fresh();if(!view?.recording.active)await command('stop');throw error;}}
 async function editorInput(message:Record<string,unknown>):Promise<void>{
  if(transitioning||recoveryRequired)return;
  changing=true;
  try {
   const reply=await context.request<MutationReply>('editor',{expectedRevision:context.current().revision,before:message.before,after:message.after,boundary:message.boundary});
   if(reply.ok){context.absorb(reply.value.view);say(reply.value.view.history.at(-1)?.description[context.language()] ?? readyText());}
   else {if(reply.error.code==='unmodeled')sayUnmodeled(message);else say(reply.error.code==='editor_divergence'?c('divergence'):`${c('error')}: ${reply.error.code}`,true);context.absorb(await api<HostView>('observe'));}
   await synchronize();context.redraw();
  } finally {changing=false;}
 }
 const handshake=():void=>{
  if(!initialDeadlineOpen()||(initialBootAttempt&&port))return;
  stopBounds();port?.close();rejectOwnEngineRequests();ready=false;const channel=new MessageChannel(),acceptedPort=channel.port1,generation=++portGeneration;port=acceptedPort;
  if(fontRetryAttempt){fontRetryAttempt.acceptedPort=acceptedPort;fontRetryAttempt.acceptedGeneration=generation;}
  const current=():boolean=>port===acceptedPort&&portGeneration===generation;
  acceptedPort.onmessage=event=>{
   if(!current()||fontBootstrapFailed||!initialDeadlineOpen())return;
   const message=event.data as Record<string,unknown>;
   if(typeof message.id==='number' && requests.has(message.id)){const request=requests.get(message.id)!;if(request.port!==acceptedPort||request.generation!==generation)return;clearTimeout(request.timer);requests.delete(message.id);if(message.type==='error')request.reject(new Error(String(message.message)));else request.resolve(message);return;}
   if(message.type==='ready'){if(message.fontsReady!==true)return;const initial=initialBootAttempt;const attempt=fontRetryAttempt;if(attempt&&(!attempt.postSent||attempt.acceptedPort!==acceptedPort||attempt.acceptedGeneration!==generation))return;ready=true;if(initial){clearInitialBoot();setTransitionBusy(false);if(mode==='board')workspacePanels();}if(attempt){clearTimeout(attempt.timer);fontRetryAttempt=undefined;attempt.controller.abort();fontBootstrapRetryPending=false;setTransitionBusy(false);if(mode==='board')workspacePanels();}syncBounds();updateNav();say(readyText());if(restorationPending){restorationPending=false;void configure(context.restoredWorkspace!,true,current).catch(error=>{if(current())say(String(error),true);});}else if(mode!=='board')void configure(mode,true,current).catch(error=>{if(current())say(String(error),true);});}
   else if(message.type==='recorded'){gestureTail=gestureTail.then(()=>{return current()?submitGesture(message.gesture as RecordedGesture):undefined;}).catch(error=>{if(current())say(String(error),true);});}
   else if(message.type==='editor-gesture'){gestureTail=gestureTail.then(()=>{return current()?editorInput(message):undefined;}).catch(error=>{if(current())say(String(error),true);});}
   else if(message.type==='undo'){gestureTail=gestureTail.then(async()=>{if(!current())return;await context.undo();if(current())await synchronize(current);}).catch(error=>{if(current())say(String(error),true);});}
   else if(message.type==='unmodeled'){sayUnmodeled(message);void synchronize(current);}
   else if(message.type==='error'){if(message.id===undefined&&message.message==='Engine fonts are not ready')failFontBootstrap(fontRetryAttempt);else say(String(message.message),true);}
  };acceptedPort.start();iframe.contentWindow!.postMessage({type:'practonaut-engine/1'},engineOrigin,[channel.port2]);
 };
 const editorAdvertisement=(event:MessageEvent):void=>{if(event.source===iframe.contentWindow&&event.origin===engineOrigin&&event.data?.type==='practonaut-engine-ready/1')handshake();};
 window.addEventListener('message',editorAdvertisement);
 // Only the owned pending initial attempt is retired on pagehide. Keep the
 // listener for an explicit Retry after back/forward restoration; live ready
 // and the existing FontRetry lifecycle are outside this initial cleanup.
 window.addEventListener('pagehide',()=>{const attempt=initialBootAttempt;if(attempt)failInitialBoot(attempt);});

 // ---------- Advanced: the technical author path (manual recorder, raw events, rule hypotheses, JSON project) ----------
 const evidenceKind=(status:'proposed'|'confirmed'|'refuted'):EvidenceKind=>status==='proposed'?'hypothesis':status;
 function field(label:string,id:string,value:string):{root:HTMLElement;input:HTMLInputElement}{return textField({id,testid:id,label,value,required:true,maxLength:1024});}
 function renderWays():void{
  ways.setAttribute('aria-label',c('waysLabel'));
  drawEmpty.replaceChildren(h('div',{class:'engine-empty__inner'},h('span',{class:'engine-empty__glyph',attrs:{'aria-hidden':'true'}},icon('pencil')),h('p',{class:'engine-empty__title',text:c('drawEmptyTitle')}),h('p',{class:'engine-empty__text',text:c('drawEmptyText')})));
  const chosen=currentWay(),focused=(document.activeElement as HTMLElement|null)?.dataset.testid;
  ways.replaceChildren(...(['draw','record'] as const).map(id=>{
   const card=h('button',{class:'create-way',testid:`create-way-${id}`,attrs:{type:'button','aria-pressed':String(chosen===id)}},h('span',{class:'create-way__glyph',attrs:{'aria-hidden':'true'}},icon(id==='draw'?'pencil':'record')),h('span',{class:'create-way__text'},h('span',{class:'create-way__title',text:c(id==='draw'?'wayDraw':'wayRecord')}),h('span',{class:'create-way__lead',text:c(id==='draw'?'wayDrawLead':'wayRecordLead')})));
   // A running recording keeps its way; switching would hide its only Stop.
   card.disabled=id!==chosen&&!!view?.recording.active;
   card.addEventListener('click',()=>{if(currentWay()===id)return;way=id;workspacePanels();if(ready&&mode==='author')say(readyText());if(view)renderAuthor();if(id==='draw')twoScenes?.render();ways.querySelector<HTMLElement>(`[data-testid="create-way-${id}"]`)?.focus();});
   return card;
  }));
  if(focused?.startsWith('create-way-'))ways.querySelector<HTMLElement>(`[data-testid="${focused}"]`)?.focus({preventScroll:true});
 }
 function renderAuthor():void{
  if(mode!=='author'||!view)return;recovery.render(view);displayStatus();enginePanel.hidden=false;syncEditor();
  const focused=(document.activeElement as HTMLElement|null)?.dataset.testid;
  const existing=new Map([...authorPanel.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')].map(input=>[input.dataset.testid,input.value]));
  const active=view.recording.active;
  // Manual recorder
  const name=field(c('authorName'),'record-author',existing.get('record-author')??c('defaultAuthor')),license=field(c('license'),'record-license',existing.get('record-license')??'CC0-1.0'),consent=field(c('consent'),'record-consent',existing.get('record-consent')??c('defaultConsent'));
  const source=selectField({id:'record-source',testid:'record-source',label:c('source'),value:authorPanel.querySelector<HTMLSelectElement>('[data-testid="record-source"]')?.value??'scripted',options:(['scripted','human'] as const).map(v=>({value:v,label:c(v)}))});
  const recorder=card({title:c('recorderTitle'),level:3,class:'create-adv-card'},h('p',{class:'create-footnote',text:c('local')}),h('div',{class:'create-fields create-fields--two'},name.root,license.root,consent.root,source.root),
   h('div',{class:'create-actions'},
    action(c('start'),'record-start',async()=>{if(!name.input.reportValidity()||!license.input.reportValidity()||!consent.input.reportValidity())return;const started=await command('start');try{view=await api<AuthorView>('record/start',{expectedRevision:view!.revision,initial:started.initial,fontsReady:started.fontsReady,metadata:{author:name.input.value,license:license.input.value,consent:consent.input.value,demonstration:source.select.value}});renderAuthor();say(c('recording'));}catch(error){await command('stop');throw error;}},active,'secondary','record'),
    action(c('stop'),'record-stop',async()=>{await command('stop');await gestureTail;const stopped=await api<{view:AuthorView;recordingId:string}>('record/stop',{expectedRevision:view!.revision});view=stopped.view;review=await readRecording(stopped.recordingId);renderAuthor();say(c('saved'));},!active,'secondary','stop'),
    action(c('load'),'author-load-scene',async()=>{await command('resync',{elements:await scene(),canUndo:context.current().step>0});},active,'plain'),
    action(c('clear'),'author-new-scene',async()=>{await command('resync',{elements:blank()});},active,'plain')),
   h('p',{class:'create-footnote t-tabular',text:active?`${c('recording')} · ${count(view.recording.gestures,'changeOne','changeCount')}`:c('recorderOff')}));
  // Recordings
  const rows=h('ul',{class:'create-rows'});
  if(!view.recordings.length)rows.append(h('li',{class:'create-footnote',text:c('empty')}));
  for(const item of view.recordings){
   const remove=action(c('delete'),'delete-'+item.id,()=>{
    const sheet=openSheet({title:c('deleteConfirm'),text:c('deleteText'),testid:'record-delete-dialog',restoreFocus:()=>authorPanel.querySelector<HTMLElement>(`[data-testid="delete-${item.id}"]`),actions:[
     {label:c('delete'),variant:'danger-solid',testid:'record-delete-confirm',onClick:()=>{void (async()=>{view=await api<AuthorView>('record/delete',{expectedRevision:view!.revision,id:item.id});review=undefined;compiled=undefined;sheet.close();renderAuthor();})().catch(error=>say(String(error),true));}},
     {label:c('cancel'),testid:'record-delete-cancel',onClick:()=>sheet.close()}]});
   },active,'danger','trash');
   rows.append(h('li',{class:'create-row recording-row'},h('div',{class:'create-row__body'},evidence('observed',c('observedState')),h('p',{class:'create-row__meta t-mono',text:`${item.id} · ${c(item.demonstration)} · ${c(item.status==='quarantined'?'quarantined':'review')}`})),
    h('div',{class:'create-row__actions'},action(c('review'),'review-'+item.id,async()=>{review=await readRecording(item.id);renderAuthor();},false,'plain'),remove)));
  }
  for(const [entries,key] of [[view.unavailableRecordings,'unavailableRecordings'],[view.unavailableDerivedOutputs,'unavailableDerived']] as const)if(entries?.length){
   const entriesList=h('ul',{class:'create-rows'},...entries.map(entry=>h('li',{class:'create-footnote',text:entry.id})));
   rows.append(h('li',{},banner({tone:'warning',text:c(key),testid:key},entriesList)));
  }
  const recordingsCard=card({title:c('recordings'),level:3,class:'create-adv-card',actions:[action(c('refresh'),'record-refresh',fresh,false,'plain','reset')]},rows);
  // Semantic events of the reviewed recording
  const events=card({title:c('events'),level:3,class:'create-adv-card'});
  if(!review)events.append(h('p',{class:'create-footnote',text:c('eventsEmpty')}));
  if(review){
   events.append(h('p',{class:'create-footnote',text:`${review.manifest.author} · ${review.manifest.license} · ${c(review.manifest.demonstration)} · ${review.manifest.coalescingVersion}`}));
   for(const g of review.gestures)events.append(h('details',{class:'pn-disclosure create-adv-event'},h('summary',{},evidence('observed',c('observedState')),h('span',{class:'t-tabular',text:`#${g.index+1} · ${g.boundary} · ${count(g.events.length,'eventOne','eventCount')} · ${g.unmodeled.length} ${c('unknownCount')}${g.quarantined?' · '+c('quarantined'):''}`})),h('div',{class:'pn-disclosure__body'},h('pre',{class:'author-data',text:JSON.stringify({events:g.events,unmodeled:g.unmodeled,quarantineReasons:g.quarantineReasons},null,2)}))));
  }
  // Rule hypotheses, explicit evidence selection, the raw project and compilation
  const hypotheses=card({title:c('hypotheses'),level:3,class:'create-adv-card'},h('p',{class:'create-footnote',text:c('ruleNeed')}),h('div',{class:'create-actions'},action(c('analyze'),'author-analyze',async()=>{view=await api<AuthorView>('author/analyze',{expectedRevision:view!.revision});renderAuthor();},active)));
  const project=view.project;
  if(project){
   for(const hy of project.hypotheses){
    const row=h('section',{class:'hypothesis '+hy.status,testid:'hypothesis-'+hy.id},h('h4',{class:'hypothesis__title'},evidence(evidenceKind(hy.status),c(hy.status==='proposed'?'proposed':hy.status)),h('span',{class:'t-mono',text:hy.id})),h('p',{text:ruleStatement(hy,context.language())}));
    for(const q of project.questions.filter(q=>hy.status!=='refuted'&&hy.status==='proposed'&&q.status==='open'&&q.hypothesisIds.includes(hy.id)))row.append(h('p',{class:'create-footnote',text:`${c(q.status)}: ${q.demonstration[context.language()]}`}));
    row.append(h('p',{class:'create-footnote t-tabular',text:`${count(hy.proposedFrom.length,'observedOne','observed')} · ${count(hy.confirmingEvidence.length,'confirmationOne','confirmationCount')} · ${count(hy.refutingEvidence.length,'counterexampleOne','counterexamples')}`}));
    if(hy.status==='proposed'){
     const select=selectField({id:'evidence-'+hy.id,testid:'evidence-'+hy.id,label:c('evidence'),value:view.recordings[0]?.id??'',options:view.recordings.map(r=>({value:r.id,label:r.id}))});
     const index=textField({id:'gesture-index-'+hy.id,testid:'gesture-index-'+hy.id,label:c('gestureIndex'),value:existing.get('gesture-index-'+hy.id)??'0',type:'number',min:0});
     row.append(h('div',{class:'create-fields create-fields--two'},select.root,index.root),h('div',{class:'create-actions'},action(c('confirm'),'confirm-'+hy.id,async()=>{const recording=await readRecording(select.select.value),gesture=recording.gestures[Number(index.input.value)];if(!gesture)throw new Error('evidence_missing');view=await api<AuthorView>('author/confirm',{expectedRevision:view!.revision,confirmation:{hypothesisId:hy.id,evidence:{recordingId:select.select.value,gestureIndex:gesture.index,sha256:await hash(gesture)}}});renderAuthor();say(c('confirmed'));})));
    }
    hypotheses.append(row);
   }
   const area=textArea({id:'author-project',testid:'author-project',label:c('project'),value:dirtyProject&&projectDraft!==undefined?projectDraft:JSON.stringify(project,null,2),rows:16,mono:true,onInput:value=>{projectDraft=value;dirtyProject=true;}});
   hypotheses.append(area.root);
   if(dirtyProject)hypotheses.append(banner({tone:'warning',text:c('dirtyProject')}),h('div',{class:'create-actions'},action(c('reloadProject'),'author-reload-project',()=>{dirtyProject=false;projectDraft=undefined;renderAuthor();},false,'plain')));
   hypotheses.append(h('div',{class:'create-actions'},
    action(c('saveProject'),'author-save-project',async()=>{view=await api<AuthorView>('author/project',{expectedRevision:view!.revision,project:{...(JSON.parse(area.input.value) as object),hypotheses:view!.project!.hypotheses,questions:view!.project!.questions}});dirtyProject=false;projectDraft=undefined;renderAuthor();}),
    action(c('compile'),'author-compile',async()=>{compiled=await api<AuthorCompileReply>('author/compile',{expectedRevision:view!.revision});renderAuthor();say(c('compileReady'));})));
  }
  if(compiled)hypotheses.append(tagged(node('pre',JSON.stringify(compiled,null,2),'author-data'),'compile-result'));
  authorPanel.replaceChildren(h('h2',{class:'sr-only',text:c('advanced')}),h('div',{class:'create-adv-grid'},recorder,recordingsCard,events,hypotheses),h('p',{class:'create-footnote',text:c('unknown')}));
  if(focused)authorPanel.querySelector<HTMLElement>(`[data-testid="${CSS.escape(focused)}"]`)?.focus();
 }
 function update():void{updateNav();if(mode==='author')twoScenes?.render();
  // A language change during a transition reaches the guide too; the engine follows once the transition ends.
  if(transitioning){displayStatus();if(mode==='author'&&view)recovery.render(view);return;}displayStatus();renderAuthor();const theme=document.documentElement.dataset.theme??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),presentation=context.language()+theme;if(ready&&!iframe.hidden&&mode!=='board'&&lastEnginePresentation!==presentation){lastEnginePresentation=presentation;void command('language',{language:context.language(),theme}).then(()=>refreshObjects()).catch(error=>say(String(error),true));}if(mode==='editor'&&ready&&!changing&&!recoveryRequired&&context.current().revision!==lastRevision)void synchronize().catch(error=>say(String(error),true));}
 enginePanel.hidden=true;authorPanel.hidden=true;ways.hidden=true;guided.hidden=true;twoScenesRoot.hidden=true;advanced.hidden=true;updateNav();say(c('font'));beginInitialBoot();return{update,select:(next:'board'|'editor'|'author')=>configure(next),mode:()=>mode,canSelect:(value:'board'|'editor'|'author')=>!(transitioning||(value!=='board'&&!ready)||(value==='author'&&!context.authorEnabled))};
}
