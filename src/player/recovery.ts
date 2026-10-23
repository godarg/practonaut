/**
 * Create workspace: the guided flow from a prepared template to a checked exercise.
 *
 * Six steps (Plan, Record, Review, Confirm, Goal, Finish) in a vertical stepper. Exactly one step is
 * open: the current one, or the one the author opened (opening another closes it); after every action
 * the flow shows the current step again. The stepper never runs backwards: the confirming
 * demonstration is recorded from Confirm. The host owns every decision that matters (evidence,
 * readiness, compilation); this module renders its view, keeps form drafts across re-renders and
 * sends explicit author actions. Author and recorded text is data and goes through textContent only.
 * Design: design-language §10.4; review r2 findings ER-01..ER-22.
 */
import type { AuthorView, AuthorCompileReply, AuthorPreparedReply, AuthorLaunchReply } from '../host/author-protocol.ts';
import type { Recording, RecordedGesture, SemanticSnapshot } from '../adapters/excalidraw/recorder-types.ts';
import type { RepairIntent } from '../authoring/recovery-types.ts';
import type { RuleHypothesis } from '../authoring/types.ts';
import type { Language } from './messages.ts';
import type { State } from '../world/types.ts';
import { banner, button, checkField, chip, disclosure, evidence, h, icon, openSheet, selectField, statusIcon, textField } from './ui/components.ts';
import type { ButtonVariant, Child, IconName } from './ui/components.ts';
import { miniature, slotOrder } from './ui/miniature.ts';
import type { MiniGraph } from './ui/miniature.ts';
import { step, stepper } from './ui/stepper.ts';
import type { StepState } from './ui/stepper.ts';

export interface RecoveryContext {
  language(): Language;
  errorMessage?(reason: string): string | undefined;
  ready(): boolean;
  command(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
  api<T>(route: string, payload?: unknown): Promise<T>;
  refresh(): Promise<void>;
  stopped(): Promise<void>;
  setView(view: AuthorView): void;
  showSample(): Promise<void>;
  showEditor(): void;
  interrupted?(): boolean;
  /** Mount in the engine panel that shows the coming scene while there is no project yet. */
  emptyScene?: HTMLElement;
  /** Mount in the engine panel head for the three changes while a recording runs (narrow layouts). */
  recordingTasks?: HTMLElement;
  /** Stage-level mount for the recording bar (top of the guide column, sticky under the app bar). */
  recordingDock?: HTMLElement;
  /** True while the drawing surface failed to open again; its panel then holds the one message and Try again. */
  engineFailed?(): boolean;
  /** Brings the failed drawing surface and its Try again into view (narrow layouts, where it sits below the steps). */
  focusEngine?(): void;
  /** True while the engine status shows an alert; the guide then holds back its own message. */
  engineAlert?(): boolean;
  /** A new author action clears an engine alert, so only one message is visible at a time. */
  clearEngineAlert?(): void;
}

const en = {
  eyebrow: 'Create exercise', heroTitle: 'Turn your demonstration into an exercise',
  heroLead: 'Demonstrate how the process is repaired. Practonaut turns it into an exercise with a checked result.',
  sample: 'Try the prepared exercise', local: 'Local on this computer', stepsLabel: 'Steps to your exercise',
  position: 'Step {n} of {total}, {state}.', stateDone: 'done', stateCurrent: 'current step', stateUpcoming: 'not started', stateLocked: 'not available yet', afterPlan: 'After planning',
  plan: 'Plan', record: 'Record', review: 'Review', evidence: 'Confirm', build: 'Goal', finish: 'Finish',
  // Plan
  planLead: 'Name your project and the three steps of the process. In the exercise, the middle step is removed and the other two are connected.',
  projectName: 'Project name', projectHint: 'Shown in your saved projects.', author: 'Author', authorHint: 'Stored as the source of every recording.',
  stepsLegend: 'The three steps', stepsHint: 'Give each step its own short name.', first: 'First step', middle: 'Step to remove', last: 'Last step',
  beforeCaption: 'Before', goalCaption: 'Goal', planFigure: 'Prepared template. The rules come from your demonstrations.',
  prepare: 'Prepare my scene', resume: 'Saved projects', open: 'Open', emptyProjects: 'Projects you save appear here.', savedAt: 'Saved {date}',
  preparedLabel: 'Your scene is ready in the drawing surface.', defaultTitle: 'Process repair', defaultFirst:'Collect draft', defaultMiddle:'Review draft', defaultLast:'Publish draft',
  // Field errors (shown at the field, replacing its hint) and their live summary at the action
  errTitle: 'Name the project.', errAuthor: 'Enter the author.', errLabel: 'Name this step.', errLabelDup: 'This name is already used.',
  errSource: 'Choose who demonstrates.', errConsent: 'Recording starts only with this permission.', consentName: 'Permission',
  fixOne: 'Fill in the marked field: {fields}.', fixMany: 'Fill in the marked fields: {fields}.',
  // Record
  recordLead: 'Start the recording, then make three changes in the drawing surface:', recordAgain: 'You record further demonstrations in Confirm, which reloads the starting scene for you. Here works too: reload the starting scene, then record.',
  task1: 'Delete {middle}.', task2: 'Connect {first} to {last} with one of the arrows.', task3: 'Delete the arrow that is left over.', recordThen: 'Then stop in the bar at the top and review the recording.',
  gestureHelp: 'How to do this in Excalidraw', gestureSteps: 'Select an arrow with the selection tool (V). Drag its end to the edge of the remaining step until Excalidraw highlights that step, then release. To delete a step, select it near a corner and press Delete. Select the extra arrow and delete it too. If an end stays loose, fix it before you stop.',
  rights: 'I release my recording freely (CC0).', rightsMore: 'What this means', rightsText: 'The recording stays on this computer. CC0-1.0 means that what you demonstrate here may be reused without conditions, including in the exercise it creates.',
  source: 'Who demonstrates?', sourceName: 'Demonstrator', chooseSource: 'Choose', human: 'A person', scripted: 'A program (automated)',
  start: 'Record demonstration', stop: 'Stop and review', reload: 'Reload starting scene', editorLink: 'Go to the drawing surface', editorLinkFailed: 'The drawing surface did not open – show',
  recordingLabel: 'Recording', waiting: 'The editor is still loading. Recording stays off.',
  progress1: '1 change recorded so far', progressN: '{n} changes recorded so far', progress0: 'No change recorded yet',
  recordingHint: 'Stop in the bar at the top when you are done.', recordingLead: 'Make three changes in the drawing surface:', narrowHint: 'Here the drawing surface sits below the steps; the three changes are listed there again. A wider window shows both side by side.',
  change1: '1 change', changeN: '{n} changes', reloaded: 'Starting scene reloaded.',
  interrupted: 'Recording was on when the page reloaded. Completed changes are kept; only a change that was still unfinished at the reload can be missing. Stop and review this recording; recording does not restart on its own.',
  unavailableProjects:'Some saved projects are damaged or unsafe and cannot be opened. They are kept unchanged. Healthy projects and a new exercise remain available.', openQuestion:'Question to resolve', deleteProject:'Delete project',deleteProjectTitle:'Delete this saved project?',deleteProjectText:'Only this saved project is removed. Recordings and compiled packages stay on this computer. This cannot be undone.',deleteProjectError:'The project could not be removed safely. It is kept unchanged.',cancel:'Cancel',ignoredMetadata:'The .DS_Store system entry is ignored; it is not a project.',
  // Review
  reviewLead: 'This is what the recording saw. Check that each change is right.', demo: 'Demonstration {n}', observed: 'Observed', excluded: 'Excluded',
  excludedWhy: 'Contains a change that is not modeled yet. It is kept but not used.', beforeLabel: 'Before', afterLabel: 'After',
  stepRemoved: 'Step {a} removed', arrowRemoved: 'Arrow {a} → {b} removed', looseArrowTo: 'Loose arrow into {b} removed', looseArrowFrom: 'Loose arrow from {a} removed', arrowConnected: 'Arrow reconnected: {a} → {b}', loose1: '1 arrow with a loose end', looseN: '{n} arrows with a loose end',
  noChange: 'No recognized change', loose: 'loose end', details: 'Technical details', analyze: 'Derive rules', stopped: 'Recording saved. Review the changes now.', stoppedConfirm: 'Recording saved. Choose the matching changes below.',
  noRecords: 'No demonstration yet', noRecordsText: 'Record one in the step before. It appears here with before and after.',
  // Confirm
  need: 'Only another demonstration counts as confirmation.', confirmedLabel: 'Confirmed',
  confirmedBy: 'Confirmed by demonstration {n}', chooseEvidence: 'Choose a new demonstration that shows this:', confirm: 'Use', confirmedProgress: '{c} of {n} rules confirmed.',
  notUsable: 'Not usable here', proposal: 'From the recording that suggested this rule; it cannot confirm it.', excludedReason: 'Excluded: contains a change that is not modeled yet.',
  confirmLead: 'Each rule needs another demonstration. Practonaut reloads the starting scene for it.', confirmRecord: 'Record confirmation',
  refuted: 'Contradicted by a demonstration', refutedLabel: 'Refuted',
  refutedWhy: 'A recorded counterexample does not fit. It is kept; this rule is not used.', blockedTitle: 'Not yet modelled', noRules: 'Derive rules in the step before. They appear here.',
  // Goal
  intent: 'Decide what the exercise asks for. The goal is your intent, not evidence of behavior.', dirty: 'You changed the goal. Update the preview, then check the examples again.',
  goalTitle: 'Title and change', goalVariants: 'Variants', goalExamples: 'Check the examples',
  taskEn: 'Title in English', taskDe: 'Title in German', remove: 'Step to remove', beforeStep: 'Previous step', afterStep: 'Next step',
  variantsHint: 'A variant practises the same task with other step names. Name them yourself or let Practonaut suggest names.', variant: 'Variant {n}', samePlan: 'Same as your process', sameVariant: 'Same as variant 1', sameHint: 'Change the names so this variant practises something different.',
  editNames: 'Change names', doneNames: 'Done', suggestNames: 'Suggest names', namesSuggested: 'Both variants have new step names. Update the preview.', variantError: 'Check the names of this variant.', variantField: '{field} of variant {n}',
  examplesLead: 'Prepared independently of your demonstrations. The checker tests your goal against them.',
  reference: 'Valid result', alternative: 'Another valid result', nearMiss: 'Near miss', valid: 'valid', invalid: 'not valid', stale: 'Not checked since the change',
  referenceText: 'Arrow A now points to {last}.', alternativeText: 'Arrow B now starts at {first}.', nearMissText: 'The extra arrow is still there, so this result does not count.',
  exKeeps: 'Arrow {t} stays', exLoose: 'Arrow {t} stays, loose', exRemoved: 'Arrow {t} removed',
  taskEnEmpty: 'Leave empty to use the German title.', taskDeEmpty: 'Leave empty to use the English title.',
  reviewExamples: 'I reviewed the three examples. They show the result I want.', examplesNeeded: 'Review the examples and tick the box first.',
  configure: 'Update preview', acceptExamples: 'Accept examples', acceptHint: 'Check the three examples below and tick the box.', save: 'Save project', saved: 'Project saved on this computer.', previewUpdated: 'Preview updated.',
  savedLine: 'Saved {time}', notSaved: 'Not saved yet',
  taskNeeded: 'Derive rules from your demonstrations first.', defaultTaskEn: 'Remove a step and reconnect the process', defaultTaskDe: 'Schritt entfernen und Ablauf verbinden',
  // Finish
  finishLead: 'Practonaut checks everything once more and builds your exercise.', checkRecord: 'Demonstrations recorded', checkEvidence: 'Rules confirmed', checkTask: 'Goal and examples reviewed',
  met: 'done', openItem: 'open', compile: 'Check and create exercise', launch: 'Open my exercise', launchAgain: 'Open the exercise again',
  completeTitle: 'Exercise created', complete: 'The rules of the exercise rest on your demonstrations. Tasks, solutions and examples passed the check.', noProject: 'Prepare your scene first.',
  // Summaries of closed steps
  sumPlanNone: 'Name the process', sumPlan: '{title} · 3 steps named', sumRecord0: 'No demonstration yet', sumRecord1: '1 demonstration', sumRecordN: '{n} demonstrations', sumRecording: 'Recording',
  sumReview0: 'After recording', sumReviewPending: 'Ready to review', sumReview1: '1 rule derived', sumReviewN: '{n} rules derived',
  sumEvidence0: 'After review', sumEvidence: '{c} of {n} rules confirmed', sumBuild0: 'After confirming', sumBuildOpen: 'Examples not reviewed yet', sumBuild: 'Goal set · examples reviewed',
  sumFinish0: 'Last step', sumFinishReady: 'Ready to create', sumFinishOpen1: '1 item open', sumFinishOpenN: '{n} items open', sumFinish: 'Exercise created',
  // Engine panel empty state
  sceneTitle: 'The drawing surface opens here', sceneText: 'As soon as you prepare your scene, the real editor opens with your three steps.',
  // Status
  error: 'This step could not be completed.', retry: 'Your entries are kept. Check what is missing and try again.', busy: 'Working locally…',
} as const;
type W = keyof typeof en;
const de: { [K in W]: string } = {
  eyebrow: 'Übung erstellen', heroTitle: 'Aus deiner Vorführung wird eine Übung',
  heroLead: 'Zeige vor, wie der Ablauf repariert wird. Practonaut macht daraus eine Übung mit geprüftem Ergebnis.',
  sample: 'Vorbereitete Übung ausprobieren', local: 'Lokal auf diesem Rechner', stepsLabel: 'Schritte zu deiner Übung',
  position: 'Schritt {n} von {total}, {state}.', stateDone: 'erledigt', stateCurrent: 'aktueller Schritt', stateUpcoming: 'noch nicht begonnen', stateLocked: 'noch nicht verfügbar', afterPlan: 'Nach dem Planen',
  plan: 'Planen', record: 'Aufnehmen', review: 'Prüfen', evidence: 'Bestätigen', build: 'Ziel', finish: 'Fertigstellen',
  planLead: 'Benenne dein Projekt und die drei Schritte des Ablaufs. In der Übung wird der mittlere Schritt entfernt und die beiden anderen werden verbunden.',
  projectName: 'Projektname', projectHint: 'Erscheint in deinen gespeicherten Projekten.', author: 'Autor', authorHint: 'Wird als Quelle jeder Aufnahme gespeichert.',
  stepsLegend: 'Die drei Schritte', stepsHint: 'Gib jedem Schritt einen eigenen, kurzen Namen.', first: 'Erster Schritt', middle: 'Zu entfernender Schritt', last: 'Letzter Schritt',
  beforeCaption: 'Vorher', goalCaption: 'Ziel', planFigure: 'Vorbereitete Vorlage. Die Regeln kommen aus deinen Vorführungen.',
  prepare: 'Meine Szene vorbereiten', resume: 'Gespeicherte Projekte', open: 'Öffnen', emptyProjects: 'Projekte, die du speicherst, erscheinen hier.', savedAt: 'Gespeichert {date}',
  preparedLabel: 'Deine Szene liegt bereit in der Zeichenfläche.', defaultTitle: 'Ablauf reparieren', defaultFirst:'Entwurf sammeln', defaultMiddle:'Entwurf prüfen', defaultLast:'Entwurf veröffentlichen',
  errTitle: 'Gib dem Projekt einen Namen.', errAuthor: 'Gib den Autor an.', errLabel: 'Gib diesem Schritt einen Namen.', errLabelDup: 'Dieser Name kommt schon vor.',
  errSource: 'Wähle, wer vorführt.', errConsent: 'Ohne diese Erlaubnis startet keine Aufnahme.', consentName: 'Erlaubnis',
  fixOne: 'Fülle das markierte Feld aus: {fields}.', fixMany: 'Fülle die markierten Felder aus: {fields}.',
  recordLead: 'Starte die Aufnahme und mach dann in der Zeichenfläche drei Änderungen:', recordAgain: 'Weitere Vorführungen nimmst du im Schritt Bestätigen auf; dort wird die Ausgangsszene für dich neu geladen. Hier geht es auch: Ausgangsszene neu laden, dann aufnehmen.',
  task1: 'Lösche {middle}.', task2: 'Verbinde {first} mit {last} über einen der Pfeile.', task3: 'Lösche den Pfeil, der übrig bleibt.', recordThen: 'Stoppe danach in der Leiste oben und prüfe die Aufnahme.',
  gestureHelp: 'So geht es in Excalidraw', gestureSteps: 'Wähle einen Pfeil mit dem Auswahlwerkzeug (V). Ziehe sein Ende an den Rand des verbleibenden Schritts, bis Excalidraw ihn hervorhebt, und lass los. Zum Löschen wähle den Schritt nahe einer Ecke und drücke Entf. Wähle auch den überflüssigen Pfeil und lösche ihn. Bleibt ein Ende lose, korrigiere es vor dem Stoppen.',
  rights: 'Ich stelle meine Aufnahme frei zur Verfügung (CC0).', rightsMore: 'Was das heißt', rightsText: 'Die Aufnahme bleibt auf diesem Rechner. CC0-1.0 heißt: Was du hier vorführst, darf ohne Bedingungen weiterverwendet werden, auch in der Übung, die daraus entsteht.',
  source: 'Wer führt vor?', sourceName: 'Vorführende Person', chooseSource: 'Bitte wählen', human: 'Ein Mensch', scripted: 'Ein Programm (automatisch)',
  start: 'Vorführung aufnehmen', stop: 'Stoppen und prüfen', reload: 'Ausgangsszene erneut laden', editorLink: 'Zur Zeichenfläche', editorLinkFailed: 'Zeichenfläche nicht geöffnet – ansehen',
  recordingLabel: 'Aufnahme läuft', waiting: 'Der Editor lädt noch. Die Aufnahme bleibt aus.',
  progress1: 'Bisher 1 Änderung aufgenommen', progressN: 'Bisher {n} Änderungen aufgenommen', progress0: 'Noch keine Änderung aufgenommen',
  recordingHint: 'Stoppe in der Leiste oben, wenn du fertig bist.', recordingLead: 'Mach in der Zeichenfläche drei Änderungen:', narrowHint: 'Die Zeichenfläche liegt hier unter den Schritten; die drei Änderungen stehen dort noch einmal. In einem breiteren Fenster siehst du beides nebeneinander.',
  change1: '1 Änderung', changeN: '{n} Änderungen', reloaded: 'Ausgangsszene neu geladen.',
  interrupted: 'Die Aufnahme lief, als die Seite neu geladen wurde. Abgeschlossene Änderungen bleiben erhalten; fehlen kann höchstens eine Änderung, die beim Neuladen noch nicht fertig war. Stoppe und prüfe diese Aufnahme; sie startet nicht von selbst neu.',
  unavailableProjects:'Einige gespeicherte Projekte sind beschädigt oder unsicher und lassen sich nicht öffnen. Sie bleiben unverändert erhalten. Intakte Projekte und eine neue Übung sind weiter verfügbar.', openQuestion:'Offene Rückfrage', deleteProject:'Projekt löschen',deleteProjectTitle:'Dieses gespeicherte Projekt löschen?',deleteProjectText:'Nur dieses gespeicherte Projekt wird entfernt. Aufnahmen und kompilierte Pakete bleiben auf diesem Computer. Das lässt sich nicht rückgängig machen.',deleteProjectError:'Das Projekt ließ sich nicht sicher entfernen. Es bleibt unverändert erhalten.',cancel:'Abbrechen',ignoredMetadata:'Der Systemeintrag .DS_Store wird ignoriert; er ist kein Projekt.',
  reviewLead: 'Das hat die Aufnahme gesehen. Prüfe, ob jede Änderung stimmt.', demo: 'Vorführung {n}', observed: 'Beobachtet', excluded: 'Ausgeschlossen',
  excludedWhy: 'Enthält eine Änderung, die noch nicht modelliert ist. Sie bleibt erhalten, wird aber nicht verwendet.', beforeLabel: 'Vorher', afterLabel: 'Nachher',
  stepRemoved: 'Schritt {a} entfernt', arrowRemoved: 'Pfeil {a} → {b} entfernt', looseArrowTo: 'Loser Pfeil zu {b} entfernt', looseArrowFrom: 'Loser Pfeil von {a} entfernt', arrowConnected: 'Pfeil neu verbunden: {a} → {b}', loose1: '1 Pfeil mit losem Ende', looseN: '{n} Pfeile mit losem Ende',
  noChange: 'Keine erkannte Änderung', loose: 'loses Ende', details: 'Technische Details', analyze: 'Regeln ableiten', stopped: 'Aufnahme gespeichert. Prüfe jetzt die Änderungen.', stoppedConfirm: 'Aufnahme gespeichert. Wähle unten die passenden Änderungen aus.',
  noRecords: 'Noch keine Vorführung', noRecordsText: 'Nimm im Schritt davor eine auf. Sie erscheint hier mit Vorher und Nachher.',
  need: 'Nur eine weitere Vorführung zählt als Bestätigung.', confirmedLabel: 'Bestätigt',
  confirmedBy: 'Bestätigt durch Vorführung {n}', chooseEvidence: 'Wähle eine neue Vorführung, die das zeigt:', confirm: 'Verwenden', confirmedProgress: '{c} von {n} Regeln bestätigt.',
  notUsable: 'Hier nicht verwendbar', proposal: 'Aus der Aufnahme, die diese Regel vorgeschlagen hat; sie kann die Regel nicht bestätigen.', excludedReason: 'Ausgeschlossen: enthält eine Änderung, die noch nicht modelliert ist.',
  confirmLead: 'Jede Regel braucht eine weitere Vorführung. Practonaut lädt dafür die Ausgangsszene neu.', confirmRecord: 'Bestätigung aufnehmen',
  refuted: 'Von einer Vorführung widerlegt', refutedLabel: 'Widerlegt',
  refutedWhy: 'Ein aufgezeichnetes Gegenbeispiel passt nicht dazu. Es bleibt erhalten; diese Regel wird nicht verwendet.', blockedTitle: 'Noch nicht modelliert', noRules: 'Leite im Schritt davor Regeln ab. Sie erscheinen dann hier.',
  intent: 'Lege fest, was die Übung verlangt. Das Ziel ist deine Absicht, kein Beleg für Verhalten.', dirty: 'Du hast das Ziel geändert. Aktualisiere die Vorschau und prüfe die Beispiele dann erneut.',
  goalTitle: 'Titel und Änderung', goalVariants: 'Varianten', goalExamples: 'Beispiele prüfen',
  taskEn: 'Titel auf Englisch', taskDe: 'Titel auf Deutsch', remove: 'Zu entfernender Schritt', beforeStep: 'Schritt davor', afterStep: 'Schritt danach',
  variantsHint: 'Eine Variante übt dieselbe Aufgabe mit anderen Schrittnamen. Benenne sie selbst oder lass Namen vorschlagen.', variant: 'Variante {n}', samePlan: 'Gleich wie dein Ablauf', sameVariant: 'Gleich wie Variante 1', sameHint: 'Ändere die Namen, damit diese Variante etwas anderes übt.',
  editNames: 'Namen ändern', doneNames: 'Fertig', suggestNames: 'Namen vorschlagen', namesSuggested: 'Beide Varianten haben neue Schrittnamen. Aktualisiere die Vorschau.', variantError: 'Prüfe die Namen dieser Variante.', variantField: '{field} in Variante {n}',
  examplesLead: 'Unabhängig von deinen Vorführungen vorbereitet. Der Prüfer testet dein Ziel daran.',
  reference: 'Gültiges Ergebnis', alternative: 'Anderes gültiges Ergebnis', nearMiss: 'Beinahe-Treffer', valid: 'gültig', invalid: 'nicht gültig', stale: 'Seit der Änderung nicht geprüft',
  referenceText: 'Pfeil A zeigt jetzt auf {last}.', alternativeText: 'Pfeil B beginnt jetzt bei {first}.', nearMissText: 'Der überflüssige Pfeil ist noch da, deshalb zählt dieses Ergebnis nicht.',
  exKeeps: 'Pfeil {t} bleibt', exLoose: 'Pfeil {t} bleibt, lose', exRemoved: 'Pfeil {t} entfernt',
  taskEnEmpty: 'Leer lassen, dann gilt der deutsche Titel.', taskDeEmpty: 'Leer lassen, dann gilt der englische Titel.',
  reviewExamples: 'Ich habe die drei Beispiele geprüft. Sie zeigen das Ergebnis, das ich will.', examplesNeeded: 'Prüfe zuerst die Beispiele und setze das Häkchen.',
  configure: 'Vorschau aktualisieren', acceptExamples: 'Beispiele übernehmen', acceptHint: 'Prüfe die drei Beispiele unten und hake sie ab.', save: 'Projekt speichern', saved: 'Projekt auf diesem Rechner gespeichert.', previewUpdated: 'Vorschau aktualisiert.',
  savedLine: 'Gespeichert {time}', notSaved: 'Noch nicht gespeichert',
  taskNeeded: 'Leite zuerst Regeln aus deinen Vorführungen ab.', defaultTaskEn: 'Remove a step and reconnect the process', defaultTaskDe: 'Schritt entfernen und Ablauf verbinden',
  finishLead: 'Practonaut prüft alles noch einmal und erzeugt daraus deine Übung.', checkRecord: 'Vorführungen aufgenommen', checkEvidence: 'Regeln bestätigt', checkTask: 'Ziel und Beispiele geprüft',
  met: 'erledigt', openItem: 'offen', compile: 'Prüfen und Übung erzeugen', launch: 'Meine Übung öffnen', launchAgain: 'Übung erneut öffnen',
  completeTitle: 'Übung erzeugt', complete: 'Die Regeln der Übung stützen sich auf deine Vorführungen. Aufgaben, Lösungen und Beispiele haben die Prüfung bestanden.', noProject: 'Bereite zuerst deine Szene vor.',
  sumPlanNone: 'Ablauf benennen', sumPlan: '{title} · 3 Schritte benannt', sumRecord0: 'Noch keine Vorführung', sumRecord1: '1 Vorführung', sumRecordN: '{n} Vorführungen', sumRecording: 'Aufnahme läuft',
  sumReview0: 'Nach der Aufnahme', sumReviewPending: 'Bereit zum Prüfen', sumReview1: '1 Regel abgeleitet', sumReviewN: '{n} Regeln abgeleitet',
  sumEvidence0: 'Nach dem Prüfen', sumEvidence: '{c} von {n} Regeln bestätigt', sumBuild0: 'Nach dem Bestätigen', sumBuildOpen: 'Beispiele noch nicht geprüft', sumBuild: 'Ziel festgelegt · Beispiele geprüft',
  sumFinish0: 'Letzter Schritt', sumFinishReady: 'Bereit zum Erzeugen', sumFinishOpen1: '1 Punkt offen', sumFinishOpenN: '{n} Punkte offen', sumFinish: 'Übung erzeugt',
  sceneTitle: 'Hier öffnet sich die Zeichenfläche', sceneText: 'Sobald du deine Szene vorbereitest, öffnet sich hier der echte Editor mit deinen drei Schritten.',
  error: 'Dieser Schritt ließ sich nicht abschließen.', retry: 'Deine Eingaben bleiben erhalten. Prüfe, was fehlt, und versuche es erneut.', busy: 'Lokale Verarbeitung…',
};
const words: Record<Language, { [K in W]: string }> = { en, de };

/** One statement form for every rule (display only; the host's own wording stays in Technical details). */
const ruleTexts: Record<Language, Record<string, string>> = {
  en: {
    'delete-keeps-arrows': 'When a step is deleted, its connected arrows stay, each with a loose end.',
    'delete-removes-arrows': 'When a step is deleted, its connected arrows are deleted too.',
    'reconnect': 'A moved arrow end connects another step; the other end stays where it was.',
    'disconnect': 'A deleted arrow no longer connects any steps.',
  },
  de: {
    'delete-keeps-arrows': 'Wird ein Schritt gelöscht, bleiben seine verbundenen Pfeile stehen, jeweils mit losem Ende.',
    'delete-removes-arrows': 'Wird ein Schritt gelöscht, werden auch seine verbundenen Pfeile gelöscht.',
    'reconnect': 'Ein umgehängtes Pfeilende verbindet einen anderen Schritt; das andere Ende bleibt, wo es war.',
    'disconnect': 'Ein gelöschter Pfeil verbindet keine Schritte mehr.',
  },
};
/** The rule as one plain statement (display only; the host's template wording stays in Technical details). */
export const ruleStatement = (hy: RuleHypothesis, language: Language): string => ruleTexts[language][hy.id.replace(/-v\d+$/u, '')] ?? hy.explanation[language];
const ruleText = ruleStatement;

/**
 * Step names for "Suggest names": a small fixed catalogue per language (no model call, PADR-0008).
 * Every name occurs once per language, so three names of the process exclude at most three entries.
 */
const nameCatalog: Record<Language, ReadonlyArray<readonly [string, string, string]>> = {
  en: [['Receive order', 'Check stock', 'Ship order'], ['Write article', 'Edit article', 'Publish article'], ['Open ticket', 'Sort ticket', 'Close ticket'],
    ['Collect applications', 'Screen candidates', 'Send offer'], ['Create invoice', 'Approve invoice', 'Pay invoice'], ['Build release', 'Test release', 'Ship release']],
  de: [['Bestellung annehmen', 'Lager prüfen', 'Bestellung versenden'], ['Artikel schreiben', 'Artikel redigieren', 'Artikel veröffentlichen'], ['Ticket öffnen', 'Ticket einordnen', 'Ticket schließen'],
    ['Bewerbungen sammeln', 'Bewerbungen sichten', 'Angebot senden'], ['Rechnung erstellen', 'Rechnung freigeben', 'Rechnung bezahlen'], ['Version bauen', 'Version testen', 'Version ausliefern']],
};
/** Deterministic: the first catalogue entries that share no name with the process or with each other. */
export function suggestVariantNames(language: Language, taken: readonly string[], count: number): Array<[string, string, string]> {
  const used = new Set(taken.map(name => name.trim().toLocaleLowerCase(language)));
  const out: Array<[string, string, string]> = [];
  for (const entry of nameCatalog[language]) {
    if (out.length === count) break;
    if (entry.some(name => used.has(name.toLocaleLowerCase(language)))) continue;
    out.push([...entry]);
    for (const name of entry) used.add(name.toLocaleLowerCase(language));
  }
  return out;
}

type Stage = 'plan' | 'record' | 'review' | 'evidence' | 'build' | 'finish';
const STAGES: readonly Stage[] = ['plan', 'record', 'review', 'evidence', 'build', 'finish'];
const ENTRANCE_MS = 400;

const fill = (template: string, values: Record<string, string | number>): string => template.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? ''));
const quote = (language: Language, text: string): string => language === 'de' ? `„${text}“` : `“${text}”`;
const plural = (language: Language, n: number, one: string, other: string): string => new Intl.PluralRules(language).select(n) === 'one' ? fill(one, { n }) : fill(other, { n });
function canonical(v: unknown): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; const o = v as Record<string, unknown>; return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'; }
async function digest(v: unknown): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v)))), b => b.toString(16).padStart(2, '0')).join(''); }

/** Visible name of a recorded object; a missing or deleted step reads as a loose end. */
function label(s: SemanticSnapshot, id: string | null, loose: string): string {
  if (!id) return loose;
  const e = s.elements[id];
  if (!e) return loose;
  return String(Object.values(s.elements).find(x => x.type === 'text' && x.attributes.containerId === id)?.attributes.originalText ?? e.attributes.name ?? id);
}
const live = (s: SemanticSnapshot, id: string | null): boolean => !!id && !!s.elements[id] && !s.elements[id]!.attributes.isDeleted;

/** One plain-language line per recorded gesture, plus what it removed and what it (re)connected. Display only. */
function gestureChanges(g: RecordedGesture, language: Language): { text: string; removed: Set<string>; changed: Set<string> } {
  const w = words[language], out: string[] = [], removed = new Set<string>(), changed = new Set<string>(), removedSteps = new Set<string>();
  const name = (s: SemanticSnapshot, id: string | null): string => live(s, id) ? quote(language, label(s, id, w.loose)) : w.loose;
  for (const e of Object.values(g.before.elements)) {
    const a = g.after.elements[e.id];
    if (e.type === 'rectangle' && !e.attributes.isDeleted && (!a || a.attributes.isDeleted)) { out.push(fill(w.stepRemoved, { a: quote(language, label(g.before, e.id, w.loose)) })); removed.add(e.id); removedSteps.add(e.id); }
  }
  let loosened = 0;
  for (const e of Object.values(g.before.elements)) {
    if (e.type !== 'arrow' || e.attributes.isDeleted) continue;
    const a = g.after.elements[e.id];
    const start = e.attributes.start as string | null, end = e.attributes.end as string | null;
    if (!a || a.attributes.isDeleted) {
      const from = live(g.before, start), to = live(g.before, end);
      out.push(fill(from && to ? w.arrowRemoved : to ? w.looseArrowTo : from ? w.looseArrowFrom : w.arrowRemoved, { a: name(g.before, start), b: name(g.before, end) }));
      removed.add(e.id); continue;
    }
    const nextStart = a.attributes.start as string | null, nextEnd = a.attributes.end as string | null;
    if (start === nextStart && end === nextEnd) continue;
    changed.add(e.id);
    const pairs: Array<[string | null, string | null]> = [[start, nextStart], [end, nextEnd]];
    const onlyLoosened = pairs.every(([was, now]) => was === now || (!!was && removedSteps.has(was) && (now === null || removedSteps.has(now))));
    if (onlyLoosened) loosened++;
    else out.push(fill(w.arrowConnected, { a: name(g.after, nextStart), b: name(g.after, nextEnd) }));
  }
  if (loosened) out.push(plural(language, loosened, w.loose1, w.looseN));
  return { text: out.join(' · ') || w.noChange, removed, changed };
}
/** Display only: the server independently replays and validates every evidence reference. */
export function describeGesture(g: RecordedGesture, language: Language): string { return gestureChanges(g, language).text; }

function snapshotGraph(s: SemanticSnapshot): MiniGraph {
  const elements = Object.values(s.elements).filter(e => !e.attributes.isDeleted);
  return {
    steps: elements.filter(e => e.type === 'rectangle').map(e => ({ id: e.id, label: label(s, e.id, ''), x: Number(e.attributes.x ?? 0), y: Number(e.attributes.y ?? 0) })),
    arrows: elements.filter(e => e.type === 'arrow').map(e => ({ id: e.id, from: (e.attributes.start as string | null) ?? null, to: (e.attributes.end as string | null) ?? null })),
  };
}
function stateGraph(state: State, tags: Map<string, string> = new Map()): MiniGraph {
  const objects = Object.values(state.objects).filter(o => !o.deleted);
  return {
    steps: objects.flatMap(o => o.type === 'step' ? [{ id: o.id, label: o.label, x: o.x, y: o.y }] : []),
    arrows: objects.flatMap(o => o.type === 'arrow' ? [{ id: o.id, from: o.from, to: o.to, ...(tags.get(o.id) ? { tag: tags.get(o.id)! } : {}) }] : []),
  };
}
function graphText(graph: MiniGraph, loose: string): string {
  const names = new Map(graph.steps.map(s => [s.id, s.label]));
  return [...graph.steps.map(s => s.label), ...graph.arrows.map(a => `${(a.from && names.get(a.from)) || loose} → ${(a.to && names.get(a.to)) || loose}`)].join(' · ');
}
function family(g: RecordedGesture): string {
  for (const e of Object.values(g.before.elements)) { const a = g.after.elements[e.id]; if (e.type === 'rectangle' && !e.attributes.isDeleted && (!a || a.attributes.isDeleted)) return 'delete_step'; if (e.type === 'arrow' && !e.attributes.isDeleted && (!a || a.attributes.isDeleted)) return 'disconnect'; }
  if (g.events.some(e => e.kind === 'set' && ['start', 'end'].includes(e.field))) return 'reconnect_end';
  return '';
}
/** All snapshots of one demonstration share a row order and the original arrow bindings, so its drawings line up. */
function recordingFrame(r: Recording): { slots: string[]; anchors: Record<string, { from: string | null; to: string | null }> } {
  const slots = slotOrder(snapshotGraph(r.initial), ...r.gestures.flatMap(g => [snapshotGraph(g.before), snapshotGraph(g.after)]));
  const anchors: Record<string, { from: string | null; to: string | null }> = {};
  for (const s of [r.initial, ...r.gestures.map(g => g.before)]) for (const e of Object.values(s.elements)) if (e.type === 'arrow') {
    const known = anchors[e.id], start = (e.attributes.start as string | null) ?? null, end = (e.attributes.end as string | null) ?? null;
    anchors[e.id] = { from: known?.from ?? start, to: known?.to ?? end };
  }
  return { slots, anchors };
}

type FieldId = 'recovery-title' | 'recovery-author' | 'recovery-label-0' | 'recovery-label-1' | 'recovery-label-2' | 'recovery-source' | 'recovery-consent' | `recovery-case-${number}-${number}`;
type FieldGroup = 'plan' | 'recording' | 'cases';

export function createRecovery(root: HTMLElement, context: RecoveryContext): { render(view?: AuthorView): void; loadRecordings(): Promise<void> } {
  let view: AuthorView | undefined, compiled: AuthorCompileReply | undefined, launchUrl: string | undefined;
  let busy = false, busyId: string | undefined, failed = false, errorReason = '', messageKey: W | 'fix' | undefined, messageStage: Stage | undefined;
  /** The one variant whose names are open for editing in Goal (at most one at a time). */
  let openVariant: number | undefined;
  let dirtyIntent = false, scopedProjectId: string | undefined, stageOverride: Stage | undefined, resetStages = true, preparedScene: unknown[] | undefined;
  let rendered = false, successAt: number | undefined, recordingAt: number | undefined, focusCarry: string | undefined, focusAfter: string | undefined, lastDone = new Set<Stage>();
  const drafts = new Map<string, string>(), recordings = new Map<string, Recording>(), opened = new Map<string, boolean>();
  const openedAt = new Map<Stage, number>(), doneAt = new Map<Stage, number>();
  /** Fields that failed validation and the message shown at each; cleared field by field as the author types. */
  const invalid = new Map<FieldId, W>();
  const c = (key: W): string => words[context.language()][key];
  const q = (text: string): string => quote(context.language(), text);
  const count = (n: number, one: W, other: W): string => plural(context.language(), n, c(one), c(other));
  const defaults = (): [string, string, string] => [c('defaultFirst'),c('defaultMiddle'),c('defaultLast')];
  const defaultTitle = (): string => c('defaultTitle');
  const value = (id: string, fallback: string): string => drafts.get(id) ?? fallback;

  // A project transition resets the entire draft scope. Within that scope refreshes
  // preserve typed text; explicit successful goal updates reconcile canonical data.
  function adoptIntent(intent: RepairIntent): void {
    // A title typed in one language reaches the host in both; the field of the other language stays empty
    // (its placeholder says the title is reused) instead of showing, say, German text under "Title in English".
    const copied = intent.title.en === intent.title.de;
    drafts.set('recovery-task-en', copied && context.language() === 'de' ? '' : intent.title.en);
    drafts.set('recovery-task-de', copied && context.language() !== 'de' ? '' : intent.title.de);
    for (const key of ['removedStepId', 'predecessorId', 'successorId'] as const) drafts.set('recovery-' + key, intent[key]);
    intent.cases.forEach((entry, v) => entry.labels.forEach((text, i) => drafts.set(`recovery-case-${v}-${i}`, text)));
    drafts.set('recovery-review-examples', String(intent.reviewedExamples)); dirtyIntent = false;
  }
  function scopeDraft(next: AuthorView): void {
    if (next.project?.id === scopedProjectId) return;
    scopedProjectId = next.project?.id; drafts.clear(); opened.clear(); invalid.clear(); openVariant = undefined; resetStages = true; dirtyIntent = false; compiled = undefined; launchUrl = undefined;
    if (next.project?.repair) { adoptIntent(next.project.repair); drafts.set('recovery-title', next.project.repair.title[context.language()]); drafts.set('recovery-author', next.project.authors[0] ?? ''); ['a','b','c'].forEach((id,i)=>{const step=next.project!.initialState.objects[id];if(step?.type==='step')drafts.set('recovery-label-'+i,step.label);}); }
  }
  function formIntent(repair: RepairIntent): RepairIntent {
    const en = value('recovery-task-en', repair.title.en), de = value('recovery-task-de', repair.title.de);
    return { ...repair, title: { en: en.trim() ? en : de, de: de.trim() ? de : en }, removedStepId: value('recovery-removedStepId', repair.removedStepId), predecessorId: value('recovery-predecessorId', repair.predecessorId), successorId: value('recovery-successorId', repair.successorId), reviewedExamples: false, cases: repair.cases.map((entry, v) => ({ ...entry, labels: entry.labels.map((text, i) => value(`recovery-case-${v}-${i}`, text)) as [string, string, string], offset: { ...entry.offset } })) };
  }
  const planLabels = (): [string, string, string] => { const labels = view?.project ? ['a','b','c'].map(id=>{const step=view!.project!.initialState.objects[id];return step?.type==='step'?step.label:'';}) : defaults(); return [0, 1, 2].map(i => value('recovery-label-' + i, labels[i]!)) as [string, string, string]; };

  // ---------- Validation: the error sits at the field, replaces its hint and goes away as soon as the entry is valid ----------
  const fieldName: Record<string, W> = { 'recovery-title': 'projectName', 'recovery-author': 'author', 'recovery-label-0': 'first', 'recovery-label-1': 'middle', 'recovery-label-2': 'last', 'recovery-source': 'source', 'recovery-consent': 'rights' };
  const stepKeys = ['first', 'middle', 'last'] as const;
  const caseId = (v: number, i: number): FieldId => `recovery-case-${v}-${i}`;
  const caseOf = (id: string): [number, number] | undefined => { const m = /^recovery-case-(\d+)-(\d+)$/u.exec(id); return m ? [Number(m[1]), Number(m[2])] : undefined; };
  const fieldLabel = (id: FieldId): string => { const at = caseOf(id); return at ? fill(c('variantField'), { n: at[0] + 1, field: c(stepKeys[at[1]]!) }) : c(fieldName[id]!); };
  /** The names of one variant as the author sees them (draft or host value). */
  const caseLabels = (v: number): [string, string, string] => [0, 1, 2].map(i => value(caseId(v, i), view?.project?.repair?.cases[v]?.labels[i] ?? planLabels()[i]!)) as [string, string, string];
  /** Each visible variant needs three different, non-empty names (the rule the host also applies). */
  function caseProblems(): Map<FieldId, W> {
    const out = new Map<FieldId, W>();
    for (let v = 0; v < variantCount(); v++) {
      const labels = caseLabels(v).map(text => text.trim());
      labels.forEach((text, i) => { if (!text) out.set(caseId(v, i), 'errLabel'); else if (labels.indexOf(text) !== i) out.set(caseId(v, i), 'errLabelDup'); });
    }
    return out;
  }
  function planProblems(): Map<FieldId, W> {
    const out = new Map<FieldId, W>();
    if (!value('recovery-title', view?.project?.repair?.title[context.language()] ?? defaultTitle()).trim()) out.set('recovery-title', 'errTitle');
    if (!value('recovery-author', view?.project?.authors[0] ?? '').trim()) out.set('recovery-author', 'errAuthor');
    const labels = planLabels().map(v => v.trim());
    labels.forEach((text, i) => { const id = `recovery-label-${i}` as FieldId; if (!text) out.set(id, 'errLabel'); else if (labels.indexOf(text) !== i) out.set(id, 'errLabelDup'); });
    return out;
  }
  function recordingProblems(): Map<FieldId, W> {
    const out = new Map<FieldId, W>();
    if (!value('recovery-source', '')) out.set('recovery-source', 'errSource');
    if (value('recovery-consent', 'false') !== 'true') out.set('recovery-consent', 'errConsent');
    return out;
  }
  const summaryText = (): string => { const names = [...invalid.keys()].map(fieldLabel); return fill(c(names.length === 1 ? 'fixOne' : 'fixMany'), { fields: names.join(', ') }); };
  function markField(id: FieldId, key: W | undefined): void {
    const control = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const field = control?.closest<HTMLElement>('.pn-field, .create-check-field');
    if (!control || !field) return;
    const errorId = `${id}-error`, hint = field.querySelector<HTMLElement>('.pn-field__hint');
    let error = field.querySelector<HTMLElement>(`#${CSS.escape(errorId)}`);
    const described = (control.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(token => token && token !== errorId);
    if (key) {
      if (!error) { error = h('p', { class: 'create-field-error', id: errorId }); const check = control.closest('.pn-check'); if (check) check.after(error); else field.append(error); }
      error.replaceChildren(icon('xCircle', 'sm'), h('span', { text: c(key) }));
      if (hint) hint.hidden = true;
      control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', [errorId, ...described].join(' '));
    } else {
      error?.remove(); if (hint) hint.hidden = false; control.removeAttribute('aria-invalid');
      if (described.length) control.setAttribute('aria-describedby', described.join(' ')); else control.removeAttribute('aria-describedby');
    }
  }
  /** Re-checks the given group after an input and updates the fields and the summary in place (no re-render, focus stays). */
  const groupOf = (id: FieldId): FieldGroup => id === 'recovery-source' || id === 'recovery-consent' ? 'recording' : caseOf(id) ? 'cases' : 'plan';
  const problemsOf = (group: FieldGroup): Map<FieldId, W> => group === 'plan' ? planProblems() : group === 'recording' ? recordingProblems() : caseProblems();
  function revalidate(group: FieldGroup): void {
    const marked = [...invalid.keys()].filter(id => groupOf(id) === group);
    if (!marked.length) return;
    const now = problemsOf(group);
    for (const id of marked) { const key = now.get(id); if (key) invalid.set(id, key); else invalid.delete(id); markField(id, key); }
    if (group === 'cases') for (const node of root.querySelectorAll<HTMLElement>('[data-variant-error]')) node.hidden = !variantInvalid(Number(node.dataset.variantError));
    const status = root.querySelector<HTMLElement>('[data-testid="recovery-status"]');
    if (messageKey === 'fix' && status) {
      if (invalid.size) status.querySelector('.pn-banner__body p:last-child')?.replaceChildren(summaryText());
      else { messageKey = undefined; status.hidden = true; }
    }
  }
  /** Marks every problem of a group and reports whether the group is valid. */
  function validate(group: FieldGroup, stage: Stage): boolean {
    const problems = problemsOf(group);
    for (const id of [...invalid.keys()]) if (groupOf(id) === group) invalid.delete(id);
    for (const [id, key] of problems) invalid.set(id, key);
    if (!problems.size) return true;
    messageKey = 'fix'; messageStage = stage; focusAfter = [...problems.keys()][0];
    // A wrong variant name opens that variant, so the error stands at its field.
    const at = focusAfter ? caseOf(focusAfter) : undefined;
    if (at) openVariant = at[0];
    return false;
  }

  // ---------- Actions ----------
  let building: Stage | undefined;
  interface ActionOptions { variant?: ButtonVariant; icon?: IconName; size?: 'sm' | 'md'; disabled?: boolean; hidden?: boolean }
  function action(text: string, testid: string, fn: () => Promise<void> | void, options: ActionOptions = {}): HTMLButtonElement {
    const stage = building;
    const node = button({ label: text, testid, variant: options.variant ?? 'secondary', ...(options.icon ? { icon: options.icon } : {}), ...(options.size ? { size: options.size } : {}), busy: busy && busyId === testid, disabled: (busy && busyId !== testid) || !!options.disabled, onClick: () => { void run(fn, testid, stage); } });
    if (options.hidden) node.hidden = true;
    return node;
  }
  async function run(fn: () => Promise<void> | void, testid?: string, stage?: Stage): Promise<void> {
    if (busy) return;
    context.clearEngineAlert?.();
    busy = true; busyId = testid; failed = false; messageKey = 'busy'; messageStage = stage; render();
    try { await fn(); if (messageKey === 'busy') messageKey = undefined; }
    catch (error) { failed = true; errorReason = String(error).replace(/^Error: /u, ''); messageKey = 'error'; }
    finally { busy = false; busyId = undefined; render(); }
  }
  async function loadRecordings(): Promise<void> {
    if (!view) return;
    for (const item of view.recordings) if (!recordings.has(item.id)) recordings.set(item.id, await context.api<Recording>('recording?id=' + encodeURIComponent(item.id)));
    for (const id of recordings.keys()) if (!view.recordings.some(r => r.id === id)) recordings.delete(id);
    render();
  }
  async function change(next: AuthorView): Promise<void> { stageOverride = undefined; view = next; context.setView(next); compiled = undefined; launchUrl = undefined; resetStages = true; await loadRecordings(); await context.refresh(); }
  async function stopRecording(): Promise<void> {
    const confirming = hypotheses().length > 0;
    await context.command('stop'); await context.stopped();
    const reply = await context.api<{ view: AuthorView; recordingId: string }>('record/stop', { expectedRevision: view!.revision });
    // A first demonstration is reviewed next; a confirming one stays in Confirm, where its changes are chosen.
    await change(reply.view); stageOverride = confirming ? 'evidence' : 'review'; resetStages = true; messageKey = confirming ? 'stoppedConfirm' : 'stopped';
  }
  async function reloadScene(): Promise<void> {
    if (!preparedScene) { const r = await context.api<AuthorPreparedReply>('author/open', { expectedRevision: view!.revision, projectId: view!.project!.id }); preparedScene = r.scene; await change(r.view); }
    await context.command('resync', { elements: preparedScene });
  }
  async function startRecording(): Promise<void> {
    const header = root.querySelector('[data-stage="record"] > summary');
    if (header) keepInPlace = { selector: '[data-stage="record"] > summary', top: header.getBoundingClientRect().top };
    // The record form folds away while recording. Without a floor the page would get shorter than the
    // reader's scroll position and the browser would pull the step down to the top (R5-01).
    holdFloor = Math.ceil(root.getBoundingClientRect().height);
    root.style.setProperty('--_record-hold', `${holdFloor}px`); root.toggleAttribute('data-record-hold', true);
    const started = await context.command('start');
    try {
      await change(await context.api<AuthorView>('record/start', { expectedRevision: view!.revision, initial: started.initial, fontsReady: started.fontsReady, metadata: { author: value('recovery-author', view!.project?.authors[0] ?? ''), license: 'CC0-1.0', consent: `${c('rights')} ${c('rightsText')}`, demonstration: value('recovery-source', '') } }));
      messageKey = undefined;
    } catch (error) { root.toggleAttribute('data-record-hold', false); await context.command('stop'); throw error; }
  }
  const invalidateReview = (id: string): void => {
    if (!(id.startsWith('recovery-task-') || id.startsWith('recovery-case-') || ['recovery-removedStepId', 'recovery-predecessorId', 'recovery-successorId'].includes(id))) return;
    const first = !dirtyIntent;
    drafts.set('recovery-review-examples', 'false'); dirtyIntent = true; compiled = undefined; launchUrl = undefined;
    root.querySelector('[data-testid="recovery-launch"]')?.remove(); root.querySelector('[data-testid="recovery-practice-link"]')?.remove();
    const check = root.querySelector<HTMLInputElement>('[data-testid="recovery-review-examples"]'); if (check) { check.checked = false; check.disabled = true; }
    if (id.startsWith('recovery-case-')) refreshVariantRows();
    // The examples are now stale and the preview is the one next action: rebuild both parts in place.
    if (first) { building = 'build'; root.querySelector('[data-build-examples]')?.replaceWith(examplesList()); root.querySelector('[data-build-footer]')?.replaceWith(buildFooter()); building = undefined; }
  };

  // ---------- Fields ----------
  function input(key: W, id: string, fallback: string, options: { hint?: W; required?: boolean; onInput?: () => void; group?: 'plan' | 'cases'; placeholder?: W } = {}): HTMLElement {
    const field = textField({ id, testid: id, label: c(key), value: value(id, fallback), maxLength: 256, ...(options.hint ? { hint: c(options.hint) } : {}), ...(options.required ? { required: true } : {}) });
    if (options.placeholder) field.input.placeholder = c(options.placeholder);
    field.input.addEventListener('input', () => { drafts.set(id, field.input.value); invalidateReview(id); options.onInput?.(); if (options.group) revalidate(options.group); });
    return field.root;
  }
  const row = (...children: Child[]): HTMLElement => h('div', { class: 'create-actions' }, ...children);
  const lead = (text: string): HTMLElement => h('p', { class: 'create-lead', text });
  const subhead = (index: number, text: string): HTMLElement => h('h4', { class: 'create-substep__title' }, h('span', { class: 'create-substep__index', text: String(index), attrs: { 'aria-hidden': 'true' } }), h('span', { text }));

  // ---------- Flow state ----------
  const hypotheses = (): RuleHypothesis[] => view?.project?.hypotheses ?? [];
  const rules = (): RuleHypothesis[] => hypotheses().filter(hy => hy.status !== 'refuted');
  const confirmedCount = (): number => hypotheses().filter(hy => hy.status === 'confirmed').length;
  const allConfirmed = (): boolean => confirmedCount() >= 3 || (rules().length > 0 && rules().every(hy => hy.status === 'confirmed'));
  function currentStage(): Stage {
    const v = view!;
    if (stageOverride) return stageOverride;
    if (compiled) return 'finish';
    if (!v.project) return 'plan';
    if (v.project.repair?.reviewedExamples && !v.recording.active) return 'finish';
    if (allConfirmed() && !v.recording.active) return 'build';
    // Once rules exist, further demonstrations belong to Confirm: the stepper never runs backwards.
    if (v.project.hypotheses.length) return 'evidence';
    if (v.recording.active) return 'record';
    if (v.recordings.length) return 'review';
    return 'record';
  }
  function doneStages(): Set<Stage> {
    const v = view!, done = new Set<Stage>();
    if (v.project) done.add('plan');
    if (v.recordings.length && !(v.recording.active && !hypotheses().length)) done.add('record');
    if (hypotheses().length) done.add('review');
    if (allConfirmed()) done.add('evidence');
    if (v.project?.repair?.reviewedExamples) done.add('build');
    if (compiled) done.add('finish');
    return done;
  }
  /** A step whose content cannot be used yet: it stays closed and says when it opens. */
  function locked(stage: Stage): boolean {
    const v = view!;
    if (stage === 'plan') return false;
    if (stage === 'review') return !v.recordings.length;
    if (stage === 'evidence') return !hypotheses().length;
    return !v.project;
  }
  const blockedEvidence = (): boolean => [...recordings.values()].some(r => r.manifest.status === 'quarantined' || r.gestures.some(g => g.quarantined || g.unmodeled.length > 0));
  const demoNumbers = (): Map<string, number> => new Map([...(view?.recordings ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r, i) => [r.id, i + 1]));
  const savedLine = (): string => {
    const saved = view?.savedProjects?.find(p => p.id === view?.project?.id);
    return saved ? fill(c('savedLine'), { time: new Date(saved.savedAt).toLocaleTimeString(context.language(), { hour: '2-digit', minute: '2-digit' }) }) : c('notSaved');
  };
  function stageSummary(stage: Stage): string {
    const v = view!, n = v.recordings.length, found = rules().length;
    switch (stage) {
      case 'plan': return v.project ? fill(c('sumPlan'), { title: q(value('recovery-title', v.project.repair?.title[context.language()] ?? defaultTitle())) }) : c('sumPlanNone');
      case 'record': return !v.project ? c('afterPlan') : v.recording.active && !hypotheses().length ? c('sumRecording') : n === 0 ? c('sumRecord0') : count(n, 'sumRecord1', 'sumRecordN');
      case 'review': return hypotheses().length ? count(found, 'sumReview1', 'sumReviewN') : n ? c('sumReviewPending') : c('sumReview0');
      case 'evidence': return v.recording.active && hypotheses().length ? c('sumRecording') : found ? fill(c('sumEvidence'), { c: confirmedCount(), n: found }) : c('sumEvidence0');
      case 'build': return !v.project ? c('afterPlan') : v.project.repair?.reviewedExamples ? c('sumBuild') : c('sumBuildOpen');
      case 'finish': {
        if (compiled) return c('sumFinish');
        const missing = v.readiness?.missing.length ?? 0;
        return !v.project ? c('afterPlan') : v.readiness?.ready && !blockedEvidence() ? c('sumFinishReady') : missing ? count(missing, 'sumFinishOpen1', 'sumFinishOpenN') : c('sumFinish0');
      }
    }
  }

  // ---------- Figures ----------
  function planFigure(): HTMLElement {
    const [first, middle, last] = planLabels();
    const steps = [{ id: 'p0', label: first, y: 0 }, { id: 'p1', label: middle, y: 1 }, { id: 'p2', label: last, y: 2 }];
    const before: MiniGraph = { steps, arrows: [{ id: 'e0', from: 'p0', to: 'p1' }, { id: 'e1', from: 'p1', to: 'p2' }] };
    const goal: MiniGraph = { steps: [steps[0]!, steps[2]!], arrows: [{ id: 'e0', from: 'p0', to: 'p2' }] };
    const slots = ['p0', 'p1', 'p2'];
    const pair = (narrow: boolean): HTMLElement => h('div', { class: narrow ? 'create-pair create-pair--narrow' : 'create-pair create-pair--wide' },
      miniature(before, { label: `${c('beforeCaption')}: ${graphText(before, c('loose'))}`, caption: c('beforeCaption'), slots, removed: new Set(['p1', 'e1']), narrow }),
      h('span', { class: 'create-pair__arrow', attrs: { 'aria-hidden': 'true' } }, icon('arrowRight')),
      miniature(goal, { label: `${c('goalCaption')}: ${graphText(goal, c('loose'))}`, caption: c('goalCaption'), slots, changed: new Set(['e0']), narrow }));
    return h('div', { class: 'create-figure', attrs: { 'data-plan-figure': '' } }, pair(false), pair(true), h('p', { class: 'create-footnote', text: c('planFigure') }));
  }
  function gesturePair(g: RecordedGesture, frame: ReturnType<typeof recordingFrame>, removed: Set<string>, changed: Set<string>): HTMLElement {
    const before = snapshotGraph(g.before), after = snapshotGraph(g.after);
    const pair = (narrow: boolean): HTMLElement => h('div', { class: narrow ? 'create-pair create-pair--narrow' : 'create-pair create-pair--wide' },
      miniature(before, { label: `${c('beforeLabel')}: ${graphText(before, c('loose')) || c('noChange')}`, caption: c('beforeLabel'), slots: frame.slots, anchors: frame.anchors, removed, narrow }),
      h('span', { class: 'create-pair__arrow', attrs: { 'aria-hidden': 'true' } }, icon('arrowRight')),
      miniature(after, { label: `${c('afterLabel')}: ${graphText(after, c('loose')) || c('noChange')}`, caption: c('afterLabel'), slots: frame.slots, anchors: frame.anchors, changed, narrow }));
    return h('div', { class: 'create-figure' }, pair(false), pair(true));
  }
  function renderEmptyScene(): void {
    const mount = context.emptyScene; if (!mount) return;
    // The plan drawing lives in the guide; here only where the editor will be (no second copy of the plan).
    mount.replaceChildren(h('div', { class: 'engine-empty__inner' },
      h('span', { class: 'engine-empty__glyph', attrs: { 'aria-hidden': 'true' } }, icon('pencil')),
      h('p', { class: 'engine-empty__title', text: c('sceneTitle') }),
      h('p', { class: 'engine-empty__text', text: c('sceneText') })));
  }
  const refreshPlanFigures = (): void => { root.querySelector('[data-plan-figure]')?.replaceWith(planFigure()); };
  function tasks(compact = false): HTMLElement {
    const [first, middle, last] = view?.project?.repair?.cases[0]?.labels ?? planLabels();
    return h('ol', { class: compact ? 'create-tasks create-tasks--compact' : 'create-tasks' }, ...[fill(c('task1'), { middle: q(middle) }), fill(c('task2'), { first: q(first), last: q(last) }), c('task3')].map((text, i) => h('li', {}, h('span', { class: 'create-tasks__index', text: String(i + 1), attrs: { 'aria-hidden': 'true' } }), h('span', { text }))));
  }
  /** While a recording runs, the current step shows what to do and how far it is; the bar holds the one Stop. */
  /** "Go to the drawing surface": after a failure it leads to the panel's Try again instead of the (inert) editor. */
  let keepInPlace: { selector: string; top: number } | undefined;
  let holdFloor = 0;
  const goEditor = (): void => { if (context.engineFailed?.()) context.focusEngine?.(); else context.showEditor(); };
  /** On narrow screens the panel is below the steps: the link itself says that the drawing surface failed (R4-10). */
  const editorLinkLabel = (): string => c(context.engineFailed?.() ? 'editorLinkFailed' : 'editorLink');
  function recordingPanel(): Child[] {
    const v = view!, nodes: Child[] = [];
    if (context.interrupted?.()) nodes.push(banner({ tone: 'warning', text: c('interrupted') }));
    // Status and hint lead the step, so they sit high and the floating bar at the bottom edge never lies on them.
    nodes.push(h('p', { class: 'create-progress' }, h('span', { class: 'create-progress__dot', attrs: { 'aria-hidden': 'true' } }), v.recording.gestures ? count(v.recording.gestures, 'progress1', 'progressN') : c('progress0')),
      h('p', { class: 'create-footnote', text: c('recordingHint') }),
      lead(c('recordingLead')), tasks(),
      h('p', { class: 'create-footnote create-narrow-hint', text: c('narrowHint') }),
      h('div', { class: 'create-actions create-actions--quiet' }, button({ label: editorLinkLabel(), testid: 'recovery-go-editor', variant: 'plain', size: 'sm', onClick: goEditor })));
    return nodes;
  }
  function renderRecordingTasks(): void {
    const mount = context.recordingTasks; if (!mount) return;
    mount.replaceChildren(...(view?.recording.active ? [tasks(true)] : []));
  }

  // ---------- Stages ----------
  function deleteSavedProject(projectId:string):HTMLElement {
    return button({label:c('deleteProject'),testid:'recovery-delete-project-'+projectId,variant:'danger',size:'sm',icon:'trash',disabled:view!.recording.active,onClick:()=>{
      const error=h('p',{class:'create-footnote',testid:'project-delete-error',attrs:{role:'alert',hidden:true}});
      const sheet=openSheet({title:c('deleteProjectTitle'),text:c('deleteProjectText'),body:error,testid:'project-delete-dialog',restoreFocus:()=>root.querySelector<HTMLElement>('[data-stage=plan]>summary'),actions:[
        {label:c('deleteProject'),variant:'danger-solid',testid:'project-delete-confirm',onClick:()=>{
          const confirm=sheet.dialog.querySelector<HTMLButtonElement>('[data-testid=project-delete-confirm]')!;confirm.disabled=true;
          void(async()=>{
            const next=await context.api<AuthorView>('author/delete-project',{expectedRevision:view!.revision,projectId});
            await change(next);if(!next.project)await context.command('resync',{elements:[]});sheet.close();
          })().catch(()=>{error.hidden=false;error.textContent=c('deleteProjectError');confirm.disabled=false;error.tabIndex=-1;error.focus();});
        }},
        {label:c('cancel'),testid:'project-delete-cancel',onClick:()=>sheet.close()},
      ]});
    }});
  }
  function planStage(): Child[] {
    const v = view!, labels = v.project?.repair?.cases[0]?.labels ?? defaults();
    const prepare = action(c('prepare'), 'recovery-prepare', async () => {
      if (!validate('plan', 'plan')) return;
      const result = await context.api<AuthorPreparedReply>('author/prepare', { expectedRevision: view!.revision, title: value('recovery-title', defaultTitle()), author: value('recovery-author', ''), labels: planLabels() });
      dirtyIntent = false; preparedScene = result.scene; drafts.delete('recovery-review-examples');
      await change(result.view); await context.command('resync', { elements: result.scene }); messageKey = 'preparedLabel';
    }, { variant: 'primary', disabled: v.recording.active });
    const steps = h('fieldset', { class: 'create-fieldset' }, h('legend', { class: 'create-fieldset__legend', text: c('stepsLegend') }), h('p', { class: 'create-fieldset__hint', text: c('stepsHint') }),
      h('div', { class: 'create-fields' }, ...(['first', 'middle', 'last'] as const).map((key, i) => input(key, 'recovery-label-' + i, labels[i]!, { onInput: refreshPlanFigures, group: 'plan' }))));
    const saved = h('section', { class: 'create-section', attrs: { 'aria-labelledby': 'create-saved-title' } }, h('h4', { class: 'create-section__title', id: 'create-saved-title', text: c('resume') }));
    if (v.unavailableProjects?.length) saved.append(banner({tone:'warning',text:c('unavailableProjects'),testid:'recovery-unavailable-projects'}, h('ul',{class:'create-rows'},...v.unavailableProjects.map(entry=>h('li',{class:'create-row'},h('span',{class:'create-row__body create-footnote',text:entry.id}),deleteSavedProject(entry.id))))));
    if(v.ignoredProjectEntries?.length)saved.append(h('p',{class:'create-footnote',testid:'recovery-ignored-metadata',text:c('ignoredMetadata')}));
    if (!v.savedProjects?.length) saved.append(h('p', { class: 'create-footnote', text: c('emptyProjects') }));
    else {
      const list = h('ul', { class: 'create-rows' });
      for (const p of v.savedProjects) {
        const when = fill(c('savedAt'), { date: new Date(p.savedAt).toLocaleString(context.language(), { dateStyle: 'medium', timeStyle: 'short' }) });
        const open = action(c('open'), 'recovery-open-' + p.id, async () => {
          const result = await context.api<AuthorPreparedReply>('author/open', { expectedRevision: view!.revision, projectId: p.id });
          drafts.clear(); dirtyIntent = false; preparedScene = result.scene; await change(result.view); await context.command('resync', { elements: result.scene }); messageKey = undefined;
        }, { variant: 'plain', disabled: v.recording.active });
        open.setAttribute('aria-label', `${c('open')}: ${p.title[context.language()]}`);
        list.append(h('li', { class: 'create-row' }, h('span', { class: 'create-row__glyph', attrs: { 'aria-hidden': 'true' } }, icon('folder')),
          h('div', { class: 'create-row__body' }, h('p', { class: 'create-row__title', text: p.title[context.language()] }), h('p', { class: 'create-row__meta', text: when })), h('div',{class:'create-row__actions'},open,deleteSavedProject(p.id))));
      }
      saved.append(list);
    }
    // The primary follows the step fields, without covering any focused field.
    return [lead(c('planLead')),
      h('div', { class: 'create-fields create-fields--two' }, input('projectName', 'recovery-title', v.project?.repair?.title[context.language()] ?? defaultTitle(), { hint: 'projectHint', required: true, group: 'plan' }), input('author', 'recovery-author', v.project?.authors[0] ?? '', { hint: 'authorHint', required: true, group: 'plan' })),
      steps, planFigure(), h('div', { class: 'create-step-footer' }, slot('plan'), row(prepare)), saved];
  }
  function recordStage(): Child[] {
    const v = view!, active = v.recording.active;
    if (active && !hypotheses().length) return [...recordingPanel(), slot('record'), row(hiddenStart())];
    const nodes: Child[] = [];
    if (v.recordings.length) nodes.push(lead(c('recordAgain')));
    else nodes.push(lead(c('recordLead')), tasks(), h('p', { class: 'create-footnote', text: c('recordThen') }));
    nodes.push(disclosure({ summary: c('gestureHelp'), class: 'create-help' }, h('p', { class: 'create-footnote', text: c('gestureSteps') })));
    const consent = checkField({ id: 'recovery-consent', testid: 'recovery-consent', label: c('rights'), checked: value('recovery-consent', 'false') === 'true', onChange: checked => { drafts.set('recovery-consent', String(checked)); revalidate('recording'); } });
    const source = selectField({ id: 'recovery-source', testid: 'recovery-source', label: c('source'), value: value('recovery-source', ''), options: [{ value: '', label: c('chooseSource') }, { value: 'human', label: c('human') }, { value: 'scripted', label: c('scripted') }], onChange: next => { drafts.set('recovery-source', next); revalidate('recording'); } });
    nodes.push(h('div', { class: 'create-group' }, source.root, h('div', { class: 'create-check-field' }, consent.root, disclosure({ summary: c('rightsMore'), class: 'create-help' }, h('p', { class: 'create-footnote', text: c('rightsText') })))));
    // A failed drawing surface says so in its panel; "still loading" would be wrong here.
    if (!context.ready() && !context.engineFailed?.()) nodes.push(h('p', { class: 'create-record-status', text: c('waiting') }));
    nodes.push(h('p', { class: 'create-footnote create-narrow-hint', text: c('narrowHint') }));
    nodes.push(slot('record'));
    // A confirming recording runs from Confirm, which then holds the recording controls; this step shows only its form.
    if (active) return nodes;
    const start = action(c('start'), 'recovery-start', async () => {
      if (!validate('recording', 'record')) return;
      await startRecording();
    }, { variant: v.recordings.length ? 'secondary' : 'primary', icon: 'record', disabled: !context.ready() || !v.project });
    const reload = action(c('reload'), 'recovery-reload', async () => { await reloadScene(); messageKey = 'reloaded'; }, { variant: 'plain', icon: 'reset', size: 'sm', disabled: !v.project });
    const editor = button({ label: editorLinkLabel(), testid: 'recovery-go-editor', variant: 'plain', size: 'sm', disabled: !v.project || busy, onClick: goEditor });
    nodes.push(row(start), h('div', { class: 'create-actions create-actions--quiet' }, reload, editor));
    return nodes;
  }
  /** During a recording the start control stays in the document, disabled and hidden, so it cannot start a second one. */
  function hiddenStart(): HTMLButtonElement { return action(c('start'), 'recovery-start', () => undefined, { variant: 'primary', icon: 'record', disabled: true, hidden: true }); }
  function reviewStage(): Child[] {
    const v = view!, numbers = demoNumbers(), nodes: Child[] = [];
    if (!recordings.size) nodes.push(h('div', { class: 'create-empty' }, h('p', { class: 'create-empty__title', text: c('noRecords') }), h('p', { class: 'create-footnote', text: c('noRecordsText') })));
    else nodes.push(lead(c('reviewLead')));
    const ordered = [...recordings.values()].sort((a, b) => (numbers.get(a.manifest.id) ?? 0) - (numbers.get(b.manifest.id) ?? 0));
    ordered.forEach((r, index) => {
      const key = 'obs:' + r.manifest.id, frame = recordingFrame(r);
      const group = h('details', { class: 'create-obs', attrs: { 'data-keep': key } });
      group.open = opened.get(key) ?? index === ordered.length - 1;
      group.append(h('summary', { class: 'create-obs__summary' },
        h('span', { class: 'create-obs__title' }, h('h4', { text: fill(c('demo'), { n: numbers.get(r.manifest.id) ?? index + 1 }) }), h('span', { class: 'create-obs__meta', text: `${count(r.gestures.length, 'change1', 'changeN')} · ${r.manifest.author} · ${c(r.manifest.demonstration)}` })),
        icon('chevronDown', 'sm')));
      const list = h('ol', { class: 'create-gestures' });
      for (const g of r.gestures) {
        const { text, removed, changed } = gestureChanges(g, context.language());
        const excluded = g.quarantined || g.unmodeled.length > 0;
        const item = h('li', { class: 'create-gesture' },
          h('div', { class: 'create-gesture__head' }, excluded ? chip(c('excluded'), { tone: 'unknown', icon: 'helpCircle' }) : evidence('observed', c('observed')), h('p', { class: 'create-gesture__title', text })));
        if (excluded) item.append(h('p', { class: 'create-footnote', text: c('excludedWhy') }));
        item.append(gesturePair(g, frame, removed, changed));
        const techKey = `tech:${r.manifest.id}:${g.index}`;
        const tech = disclosure({ summary: c('details'), class: 'create-tech' }, h('pre', { class: 'author-data', text: JSON.stringify(g, null, 2) }));
        tech.dataset.keep = techKey; tech.open = opened.get(techKey) ?? false;
        item.append(tech); list.append(item);
      }
      group.append(h('div', { class: 'create-obs__body' }, list)); nodes.push(group);
    });
    nodes.push(slot('review'), row(action(c('analyze'), 'recovery-analyze', async () => { await change(await context.api<AuthorView>('author/analyze', { expectedRevision: view!.revision })); messageKey = undefined; }, { variant: hypotheses().length ? 'secondary' : 'primary', disabled: v.recording.active || !v.recordings.length })));
    return nodes;
  }
  function evidenceStage(): Child[] {
    const v = view!, numbers = demoNumbers(), blocked = blockedEvidence();
    if (v.recording.active && hypotheses().length) return [...recordingPanel(), slot('evidence'), row(hiddenStart())];
    const nodes: Child[] = [lead(c('need'))];
    // A message about the list (new recording saved, progress) stands above it; errors of the action stay at the action.
    const listMessage = !failed && !busy && (messageKey === 'stoppedConfirm' || messageKey === 'confirmedProgress');
    if (listMessage) nodes.push(slot('evidence'));
    if (blocked) nodes.push(banner({ tone: 'unknown', title: c('blockedTitle'), text: context.errorMessage?.('evidence_unmodeled') ?? c('excludedReason') }));
    if (!rules().length) nodes.push(h('p', { class: 'create-footnote', text: c('noRules') }));
    let lacking = false;
    const list = h('ul', { class: 'create-rules' });
    for (const hy of v.project?.hypotheses ?? []) {
      if (hy.status === 'refuted') continue;
      const confirmed = hy.status === 'confirmed';
      const card = h('li', { class: 'create-rule', testid: 'recovery-rule-' + hy.id },
        h('div', { class: 'create-rule__head' }, evidence(confirmed ? 'confirmed' : 'observed', confirmed ? c('confirmedLabel') : c('observed'))),
        h('p', { class: 'create-rule__text', text: ruleText(hy, context.language()) }));
      if (confirmed) {
        const by = hy.confirmingEvidence[0]?.recordingId;
        card.append(h('p', { class: 'create-rule__meta', text: by && numbers.get(by) ? fill(c('confirmedBy'), { n: numbers.get(by)! }) : c('confirmedLabel') }));
      } else {
        lacking = true;
        for(const question of v.project?.questions.filter(question=>question.status==='open'&&question.hypothesisIds.includes(hy.id))??[]) card.append(banner({tone:'warning',title:c('openQuestion'),text:question.demonstration[context.language()],testid:'recovery-question-'+question.id}));
        const eligible: HTMLElement[] = [], unusable: HTMLElement[] = [];
        for (const r of recordings.values()) for (const g of r.gestures) {
          if (family(g) !== hy.action) continue;
          const own = hy.proposedFrom.some(ref => ref.recordingId === r.manifest.id), excluded = g.quarantined || !!g.unmodeled.length;
          const { text, removed, changed } = gestureChanges(g, context.language()), demo = fill(c('demo'), { n: numbers.get(r.manifest.id) ?? 0 });
          const beforeGraph = snapshotGraph(g.before), afterIds = new Set(snapshotGraph(g.after).steps.map(step=>step.id));
          const deletedIds = beforeGraph.steps.filter(step=>!afterIds.has(step.id)).map(step=>step.id);
          const ambiguousRemoval = hy.action === 'delete_step' && !beforeGraph.arrows.some(arrow=>deletedIds.includes(arrow.from ?? '') || deletedIds.includes(arrow.to ?? ''));
          if (own || excluded || blocked || ambiguousRemoval) {
            unusable.push(h('li', { class: 'create-row' }, h('div', { class: 'create-row__body' }, h('p', { class: 'create-row__title', text }), h('p', { class: 'create-row__meta', text: `${demo} · ${own ? c('proposal') : ambiguousRemoval ? (v.project?.questions.find(question=>question.hypothesisIds.includes(hy.id))?.demonstration[context.language()] ?? c('confirmLead')) : c('excludedReason')}` }))));
            continue;
          }
          const use = action('', 'recovery-evidence-' + hy.id + '-' + r.manifest.id + '-' + g.index, async () => {
            await change(await context.api<AuthorView>('author/confirm', { expectedRevision: view!.revision, confirmation: { hypothesisId: hy.id, evidence: { recordingId: r.manifest.id, gestureIndex: g.index, sha256: await digest(g) } } }));
            messageKey = 'confirmedProgress';
          }, { variant: 'plain' });
          use.classList.add('create-evidence');
          // A removal shows the before drawing (what goes away), a reconnection the after drawing.
          const frame = recordingFrame(r), showBefore = removed.size > 0;
          use.replaceChildren(
            h('span', { class: 'create-evidence__figure', attrs: { 'aria-hidden': 'true' } }, miniature(snapshotGraph(showBefore ? g.before : g.after), { label: '', compact: true, slots: frame.slots, anchors: frame.anchors, ...(showBefore ? { removed } : { changed }) })),
            // Named by its content in the order shown (WCAG 2.5.3); the spaces keep the words of the grid
            // cells apart, the grid does not render them.
            h('span', { class: 'create-evidence__body' }, h('span', { class: 'create-evidence__title', text }), ' ', h('span', { class: 'create-evidence__meta', text: demo }), ' ', h('span', { class: 'create-evidence__use', text: c('confirm') })));
          eligible.push(use);
        }
        if (eligible.length) card.append(h('p', { class: 'create-rule__ask', text: c('chooseEvidence') }), h('div', { class: 'create-evidence-list' }, ...eligible));
        else lacking = true;
        if (unusable.length) {
          const key = 'unusable:' + hy.id;
          const more = disclosure({ summary: `${c('notUsable')} (${unusable.length})`, class: 'create-more' }, h('ul', { class: 'create-rows' }, ...unusable));
          more.dataset.keep = key; more.open = opened.get(key) ?? false; card.append(more);
        }
      }
      list.append(card);
    }
    if (list.childElementCount) nodes.push(list);
    const rejected = hypotheses().filter(hy => hy.status === 'refuted');
    if (rejected.length) {
      const more = disclosure({ summary: `${c('refuted')} (${rejected.length})`, class: 'create-more' }, ...rejected.map(hy => h('div', { class: 'create-refuted' }, evidence('refuted', c('refutedLabel')), h('p', { class: 'create-rule__text', text: ruleText(hy, context.language()) }), h('p', { class: 'create-footnote', text: c('refutedWhy') }))));
      more.dataset.keep = 'refuted'; more.open = opened.get('refuted') ?? false; nodes.push(more);
    }
    if (lacking) nodes.push(h('p', { class: 'create-footnote', text: c('confirmLead') }), h('p', { class: 'create-footnote create-narrow-hint', text: c('narrowHint') }));
    if (!listMessage) nodes.push(slot('evidence'));
    if (lacking) {
      nodes.push(row(action(c('confirmRecord'), 'recovery-confirm-record', async () => {
        if (!validate('recording', 'record')) { stageOverride = 'record'; resetStages = true; return; }
        await reloadScene(); await startRecording();
      }, { variant: 'primary', icon: 'record', disabled: !context.ready() || v.recording.active || blocked })));
    }
    return nodes;
  }
  const variantCount = (): number => Math.min(2, view?.project?.repair?.cases.length ?? 2);
  const variantInvalid = (v: number): boolean => [0, 1, 2].some(i => invalid.has(caseId(v, i)));
  function variantFlag(v: number): string | undefined {
    const labels = (n: number): string[] => caseLabels(n).map(text => text.trim());
    const plan = planLabels().map(text => text.trim());
    if (labels(v).join('\u0000') === plan.join('\u0000')) return c('samePlan');
    if (v === 1 && labels(1).join('\u0000') === labels(0).join('\u0000')) return c('sameVariant');
    return undefined;
  }
  /** While the author types, each row keeps showing its chain and whether it repeats the process. */
  function refreshVariantRows(): void {
    for (const node of root.querySelectorAll<HTMLElement>('[data-variant-chain]')) node.replaceChildren(...chainNodes(caseLabels(Number(node.dataset.variantChain))));
    for (const node of root.querySelectorAll<HTMLElement>('[data-variant-flag]')) { const flag = variantFlag(Number(node.dataset.variantFlag)); node.replaceChildren(...(flag ? [chip(flag)] : [])); }
    for (const node of root.querySelectorAll<HTMLElement>('[data-variant-same]')) node.hidden = !variantFlag(Number(node.dataset.variantSame));
  }
  /** A chain of step names that wraps only at its arrows, never inside a name. */
  function chainNodes(labels: readonly string[]): Array<string | HTMLElement> {
    // A line breaks only before an arrow, never inside a name or after an arrow (R4-14, R5-04).
    return labels.flatMap((label, i) => { const name = h('span', { class: 'create-variant__name', text: label }); return i ? [' ', h('span', { class: 'create-variant__link' }, '→ ', name)] : [name]; });
  }
  /** One row per variant: its chain of names, a fact chip when it repeats something, and "Change names" for exactly this variant. */
  function variantList(): HTMLElement {
    const list = h('ul', { class: 'create-variants', attrs: { 'data-build-variants': '' } });
    for (let v = 0; v < variantCount(); v++) {
      const open = openVariant === v, flag = variantFlag(v), fieldsId = `create-variant-fields-${v}`;
      const toggle = button({ label: c(open ? 'doneNames' : 'editNames'), testid: `recovery-variant-edit-${v}`, variant: 'plain', size: 'sm', disabled: busy || !!view?.recording.active, onClick: () => toggleVariant(v) });
      toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-controls', fieldsId);
      toggle.setAttribute('aria-label', `${c(open ? 'doneNames' : 'editNames')}: ${fill(c('variant'), { n: v + 1 })}`);
      const error = h('p', { class: 'create-field-error', attrs: { 'data-variant-error': String(v) } }, icon('xCircle', 'sm'), h('span', { text: c('variantError') }));
      error.hidden = open || !variantInvalid(v);
      const row = h('li', { class: 'create-variant' },
        h('div', { class: 'create-variant__row' },
          h('div', { class: 'create-variant__body' },
            h('p', { class: 'create-variant__title', id: `create-variant-${v}`, text: fill(c('variant'), { n: v + 1 }) }),
            h('p', { class: 'create-variant__chain', testid: `recovery-variant-chain-${v}`, attrs: { 'data-variant-chain': String(v) } }, ...chainNodes(caseLabels(v))),
            h('span', { class: 'create-variant__flag', attrs: { 'data-variant-flag': String(v) } }, ...(flag ? [chip(flag)] : [])),
            error),
          toggle));
      if (open) {
        const same = h('p', { class: 'create-footnote', text: c('sameHint'), attrs: { 'data-variant-same': String(v) } }); same.hidden = !flag;
        row.append(h('div', { class: 'create-variant__fields', id: fieldsId, attrs: { role: 'group', 'aria-labelledby': `create-variant-${v}` } },
          h('div', { class: 'create-fields' }, ...stepKeys.map((key, i) => input(key, caseId(v, i), view?.project?.repair?.cases[v]?.labels[i] ?? planLabels()[i]!, { group: 'cases' }))), same));
      }
      list.append(row);
    }
    return list;
  }
  /** Rebuilds the variant rows in place; focus stays on the control that caused it. */
  function rebuildVariants(focus?: string): void {
    const previous = root.querySelector('[data-build-variants]');
    if (!previous) return;
    building = 'build'; previous.replaceWith(variantList()); building = undefined;
    for (const [id, key] of invalid) if (caseOf(id)) markField(id, key);
    if (focus) root.querySelector<HTMLElement>(`[data-testid="${CSS.escape(focus)}"]`)?.focus();
  }
  function toggleVariant(v: number): void { openVariant = openVariant === v ? undefined : v; rebuildVariants(`recovery-variant-edit-${v}`); }
  /** Fills every variant with names from the catalogue; the goal is then changed and the preview is the next action. */
  function suggestNames(): void {
    const scene = Object.values(view?.project?.initialState.objects ?? {}).flatMap(o => o.type === 'step' ? [o.label] : []);
    const names = suggestVariantNames(context.language(), [...planLabels(), ...scene], variantCount());
    let changed = false;
    names.forEach((labels, v) => labels.forEach((text, i) => { if (value(caseId(v, i), '') !== text) changed = true; drafts.set(caseId(v, i), text); }));
    for (const id of [...invalid.keys()]) if (caseOf(id)) invalid.delete(id);
    if (messageKey === 'fix' && !invalid.size) messageKey = undefined;
    openVariant = undefined;
    if (changed) { invalidateReview(caseId(0, 0)); messageKey = 'namesSuggested'; messageStage = 'build'; }
  }
  /** An example state drawn against the starting scene: arrows it removed come back as dashed ghosts, rewired ones are solid. */
  function exampleGraph(state: State, initial: State, tags: Map<string, string>): { graph: MiniGraph; changed: Set<string>; caption: string } {
    const graph = stateGraph(state, tags), changed = new Set<string>(), notes: Array<[string, string]> = [];
    const alive = new Set(Object.values(state.objects).filter(o => !o.deleted && o.type === 'step').map(o => o.id));
    for (const o of Object.values(initial.objects)) {
      if (o.type !== 'arrow' || o.deleted) continue;
      const now = state.objects[o.id], tag = tags.get(o.id);
      if (!now || now.deleted || now.type !== 'arrow') { graph.arrows.push({ id: o.id, from: o.from, to: o.to, ghost: true, ...(tag ? { tag } : {}) }); if (tag) notes.push([tag, fill(c('exRemoved'), { t: tag })]); continue; }
      if (now.from !== o.from || now.to !== o.to) changed.add(o.id);
      if (tag) notes.push([tag, fill(c(now.from && now.to && alive.has(now.from) && alive.has(now.to) ? 'exKeeps' : 'exLoose'), { t: tag })]);
    }
    return { graph, changed, caption: notes.sort((a, b) => a[0].localeCompare(b[0])).map(([, text]) => text).join(' · ') };
  }
  function examplesList(): HTMLElement {
    const v = view!, repair = v.project?.repair, labels = repair?.cases[0]?.labels ?? planLabels();
    // Examples: the host's independent example states, the retained arrow named A or B. After a goal edit they are stale.
    const tags = new Map<string, string>();
    for (const o of Object.values(v.project?.initialState.objects ?? {})) if (o.type === 'arrow' && repair) { if (o.from === repair.predecessorId && o.to === repair.removedStepId) tags.set(o.id, 'A'); if (o.from === repair.removedStepId && o.to === repair.successorId) tags.set(o.id, 'B'); }
    const anchors: Record<string, { from: string | null; to: string | null }> = {};
    for (const o of Object.values(v.project?.initialState.objects ?? {})) if (o.type === 'arrow') anchors[o.id] = { from: o.from, to: o.to };
    const initialSlots = v.project ? slotOrder(stateGraph(v.project.initialState)) : undefined;
    const [first, , last] = labels;
    const list = h('div', { class: dirtyIntent ? 'create-examples is-stale' : 'create-examples', attrs: { 'data-build-examples': '' } });
    for (const [key, state, valid, sentence] of [['reference', v.examples?.reference, true, fill(c('referenceText'), { last: q(last) })], ['alternative', v.examples?.alternative, true, fill(c('alternativeText'), { first: q(first) })], ['nearMiss', v.examples?.nearMiss, false, c('nearMissText')]] as const) {
      const verdict = dirtyIntent ? statusIcon('pending') : statusIcon(valid ? 'met' : 'unmet');
      const body = h('div', { class: 'create-example__body' }, h('p', { class: 'create-example__title' }, verdict, h('span', { text: c(key) }), h('span', { class: 'sr-only', text: `, ${dirtyIntent ? c('stale') : c(valid ? 'valid' : 'invalid')}` })), h('p', { class: 'create-example__text', text: state ? sentence : c('taskNeeded') }));
      if (dirtyIntent) body.append(h('p', { class: 'create-example__stale' }, statusIcon('stale'), h('span', { text: c('stale') })));
      let figure: HTMLElement | undefined;
      if (state && v.project) {
        // The drawing tells the examples apart without the letters: the kept arrow is solid, a removed one dashed at its old place.
        const { graph, changed, caption } = exampleGraph(state, v.project.initialState, tags);
        figure = miniature(graph, { label: `${c(key)}: ${graphText(stateGraph(state), c('loose'))}. ${caption}`, caption, ...(initialSlots ? { slots: initialSlots } : {}), anchors, changed, narrow: true });
      }
      list.append(h('article', { class: 'create-example' }, figure, body));
    }
    return list;
  }
  function buildFooter(): HTMLElement {
    const v = view!, repair = v.project?.repair, reviewed = !!repair?.reviewedExamples;
    const accept = action(c('acceptExamples'), 'recovery-accept-examples', async () => {
      if (dirtyIntent || !view!.project?.repair || canonical(formIntent(view!.project.repair)) !== canonical({ ...view!.project.repair, reviewedExamples: false }) || value('recovery-review-examples', 'false') !== 'true') throw new Error(c('examplesNeeded'));
      await change(await context.api<AuthorView>('author/configure', { expectedRevision: view!.revision, intent: { ...view!.project!.repair!, reviewedExamples: true } })); messageKey = undefined;
    }, { variant: !dirtyIntent && !reviewed ? 'primary' : 'plain', ...(!dirtyIntent && !reviewed ? {} : { size: 'sm' as const }), disabled: dirtyIntent || !repair || v.recording.active || (!reviewed && value('recovery-review-examples', 'false') !== 'true'), hidden: reviewed && !dirtyIntent });
    const configure = action(c('configure'), 'recovery-configure', async () => {
      if (!view!.project?.repair) throw new Error(c('taskNeeded'));
      if (!validate('cases', 'build')) return;
      const intent = formIntent(view!.project.repair);
      // Variants beyond the visible ones are host data; the same rule still holds for them.
      for (const variant of intent.cases) if (variant.labels.some(text => !text.trim()) || new Set(variant.labels.map(text => text.trim())).size !== 3) throw new Error(c('errLabelDup'));
      const result = await context.api<AuthorView>('author/configure', { expectedRevision: view!.revision, intent });
      if (result.project?.repair) adoptIntent(result.project.repair);
      await change(result); messageKey = 'previewUpdated';
    }, { variant: dirtyIntent ? 'primary' : 'plain', ...(dirtyIntent ? {} : { size: 'sm' as const }), disabled: !v.project || v.recording.active });
    const save = action(c('save'), 'recovery-save', async () => { await change(await context.api<AuthorView>('author/save', { expectedRevision: view!.revision })); messageKey = 'saved'; },
      { variant: 'plain', size: 'sm', disabled: dirtyIntent || !v.project || v.recording.active });
    const footer = h('div', { class: 'create-step-footer', attrs: { 'data-build-footer': '' } });
    if (dirtyIntent) footer.append(h('p', { class: 'create-dirty-note' }, statusIcon('stale'), h('span', { text: c('dirty') })));
    // A greyed primary says what unlocks it; the line goes away with the tick.
    else if (repair && !reviewed) { const hint = h('p', { class: 'create-footnote', testid: 'recovery-accept-hint', text: c('acceptHint') }); hint.hidden = value('recovery-review-examples', 'false') === 'true'; footer.append(hint); }
    footer.append(slot('build'), row(...(dirtyIntent ? [configure, accept] : [accept, configure]), save), h('p', { class: 'create-footnote create-saved-line', text: savedLine() }));
    return footer;
  }
  function buildStage(): Child[] {
    const v = view!, repair = v.project?.repair;
    const steps = Object.values(v.project?.initialState.objects ?? {}).flatMap(o => o.type === 'step' && !o.deleted ? [o] : []);
    const pick = (key: W, id: 'removedStepId' | 'predecessorId' | 'successorId', fallback: string | undefined): HTMLElement => {
      const testid = 'recovery-' + id;
      return selectField({ id: testid, testid, label: c(key), value: value(testid, repair?.[id] ?? fallback ?? ''), options: steps.map(s => ({ value: s.id, label: s.label })), onChange: next => { drafts.set(testid, next); invalidateReview(testid); } }).root;
    };
    const title = h('section', { class: 'create-substep' }, subhead(1, c('goalTitle')),
      h('div', { class: 'create-fields create-fields--two' }, input('taskEn', 'recovery-task-en', repair?.title.en ?? c('defaultTaskEn'), { hint: 'taskEnEmpty' }), input('taskDe', 'recovery-task-de', repair?.title.de ?? c('defaultTaskDe'), { hint: 'taskDeEmpty' })),
      h('div', { class: 'create-fields' }, pick('remove', 'removedStepId', steps[1]?.id), h('div', { class: 'create-fields create-fields--two' }, pick('beforeStep', 'predecessorId', steps[0]?.id), pick('afterStep', 'successorId', steps[2]?.id))));
    const suggest = action(c('suggestNames'), 'recovery-suggest-names', suggestNames, { variant: 'secondary', size: 'sm', disabled: !repair || v.recording.active });
    const variantStep = h('section', { class: 'create-substep' }, subhead(2, c('goalVariants')), h('p', { class: 'create-footnote', text: c('variantsHint') }), variantList(), row(suggest));
    const reviewedBox = checkField({ id: 'recovery-review-examples', testid: 'recovery-review-examples', label: c('reviewExamples'), checked: value('recovery-review-examples', 'false') === 'true', onChange: checked => {
      drafts.set('recovery-review-examples', String(checked));
      const accept = root.querySelector<HTMLButtonElement>('[data-testid="recovery-accept-examples"]');
      if (accept && !busy && !dirtyIntent && view?.project?.repair && !view.recording.active) accept.disabled = !checked && !view.project.repair.reviewedExamples;
      const hint = root.querySelector<HTMLElement>('[data-testid="recovery-accept-hint"]'); if (hint) hint.hidden = checked;
    } });
    reviewedBox.input.disabled = dirtyIntent || !repair;
    const exampleStep = h('section', { class: 'create-substep' }, subhead(3, c('goalExamples')), h('p', { class: 'create-footnote', text: c('examplesLead') }), examplesList(), h('div', { class: 'create-group' }, reviewedBox.root));
    return [lead(c('intent')), title, variantStep, exampleStep, buildFooter()];
  }
  function finishStage(): Child[] {
    const v = view!, blocked = blockedEvidence(), nodes: Child[] = [lead(c('finishLead'))];
    if (!v.readiness) nodes.push(h('p', { class: 'create-footnote', text: c('noProject') }));
    else {
      const list = h('ul', { class: 'create-checklist' });
      for (const [stepKey, key, extra] of [['record', 'checkRecord', undefined], ['evidence', 'checkEvidence', blocked ? context.errorMessage?.('evidence_unmodeled') ?? c('excludedReason') : undefined], ['task', 'checkTask', dirtyIntent ? c('dirty') : undefined]] as const) {
        const missing = [...v.readiness.missing.filter(m => m.step === stepKey).map(m => m.message[context.language()]), ...(extra ? [extra] : [])];
        const met = missing.length === 0;
        const item = h('li', { class: `create-check${met ? ' is-met' : ''}` }, statusIcon(met ? 'met' : 'pending'), h('div', { class: 'create-check__body' }, h('p', { class: 'create-check__title' }, h('span', { text: c(key) }), h('span', { class: 'sr-only', text: `, ${c(met ? 'met' : 'openItem')}` }))));
        if (!met) item.querySelector('.create-check__body')!.append(h('ul', { class: 'create-check__missing' }, ...missing.map(text => h('li', { text }))));
        list.append(item);
      }
      nodes.push(list, h('p', { class: 'create-footnote create-saved-line', text: savedLine() }));
    }
    // Result and primary stay in reach at the bottom edge, like the footers of Plan and Goal.
    const footer = h('div', { class: 'create-step-footer' });
    if (compiled) {
      const fresh = successAt !== undefined ? performance.now() - successAt : Infinity;
      const done = banner({ tone: 'success', title: c('completeTitle'), text: c('complete'), class: `create-success${fresh < ENTRANCE_MS ? ' is-new' : ''}` });
      if (fresh < ENTRANCE_MS) done.style.setProperty('--_elapsed', `${Math.round(fresh)}ms`);
      footer.append(done);
    }
    footer.append(slot('finish'));
    const actions: Child[] = [];
    if (compiled) {
      actions.push(action(c('launch'), 'recovery-launch', async () => {
        const result = await context.api<AuthorLaunchReply>('author/launch', { expectedRevision: view!.revision, worldSha256: compiled!.worldSha256 });
        launchUrl = result.url;
        const link = practiceLink(result.url);
        (root.querySelector('[data-stage="finish"] .create-actions') ?? root).append(link); link.click(); messageKey = undefined;
      }, { variant: 'primary', icon: 'play' }));
      if (launchUrl) actions.push(practiceLink(launchUrl));
    } else {
      actions.push(action(c('compile'), 'recovery-compile', async () => {
        compiled = await context.api<AuthorCompileReply>('author/compile', { expectedRevision: view!.revision }); resetStages = true; successAt = performance.now(); launchUrl = undefined; messageKey = undefined;
        // The next action is the exercise itself: focus (and with it the view) moves to its primary.
        focusAfter = 'recovery-launch';
      }, { variant: 'primary', icon: 'check', disabled: v.recording.active || !v.project || v.readiness?.ready === false || blocked || dirtyIntent }));
    }
    footer.append(row(...actions));
    nodes.push(footer);
    return nodes;
  }
  function practiceLink(url: string): HTMLAnchorElement {
    return h('a', { class: 'create-link', testid: 'recovery-practice-link', attrs: { href: url, target: '_blank', rel: 'noopener' } }, h('span', { text: c('launchAgain') }), icon('external', 'sm'));
  }

  // ---------- Status: one message at a time, beside the action that caused it ----------
  const slots = new Map<Stage, HTMLElement>();
  function slot(stage: Stage): HTMLElement { const node = h('div', { class: 'create-status-slot' }); slots.set(stage, node); return node; }
  function statusNode(): HTMLElement {
    let node: HTMLElement;
    if (failed) {
      const reasonKey = (Object.keys(en) as W[]).find(k => en[k] === errorReason || de[k] === errorReason);
      const text = reasonKey ? c(reasonKey) : context.errorMessage?.(errorReason) ?? c('retry');
      const technical = !reasonKey ? disclosure({ summary: c('details'), class: 'create-tech' }, h('pre', { class: 'author-data', text: errorReason })) : undefined;
      // A missing entry is an instruction, not a failure report: the banner says what to do, the field shows where.
      node = banner({ tone: 'danger', ...(reasonKey ? {} : { title: c('error') }), text, role: 'status', testid: 'recovery-status' }, technical);
    } else if (busy) {
      // The pressed button shows its own spinner; the words are for assistive technology only.
      node = h('p', { class: 'sr-only', testid: 'recovery-status', attrs: { role: 'status' } }, c('busy'));
    } else if (messageKey === 'fix' && invalid.size) {
      node = banner({ tone: 'danger', text: summaryText(), role: 'status', testid: 'recovery-status' });
    } else if (messageKey && messageKey !== 'fix' && messageKey !== 'error' && messageKey !== 'busy') {
      const text = messageKey === 'confirmedProgress' ? fill(c('confirmedProgress'), { c: confirmedCount(), n: rules().length }) : c(messageKey);
      node = banner({ tone: 'neutral', text, role: 'status', testid: 'recovery-status' });
      // A saved project is shown by the saved line in Goal and Finish; the message is only announced.
      if (messageKey === 'saved' || messageKey === 'namesSuggested') node.classList.add('sr-only');
    } else node = h('p', { testid: 'recovery-status', attrs: { role: 'status', hidden: true } });
    node.id = 'recovery-form-status';
    if (context.engineAlert?.()) node.hidden = true;
    return node;
  }

  // ---------- Render ----------
  function focusKey(element: Element | null): string | undefined {
    if (!element || !root.contains(element)) return undefined;
    const testid = (element as HTMLElement).dataset?.testid;
    if (testid) return 't:' + testid;
    const keep = element.tagName === 'SUMMARY' ? (element.parentElement as HTMLElement | null)?.dataset.keep : undefined;
    return keep ? 's:' + keep : '';
  }
  function usable(node: HTMLElement): boolean {
    if (node.hidden || (node as HTMLButtonElement).disabled) return false;
    const closed = node.closest('details:not([open])');
    return !closed || (node.tagName === 'SUMMARY' && node.parentElement === closed);
  }
  function render(next?: AuthorView): void {
    if (next) view = next;
    if (!view) return;
    scopeDraft(view);
    if (view.scene) preparedScene = view.scene;
    const wasOpen = new Set<string>();
    for (const detail of root.querySelectorAll<HTMLDetailsElement>('details[data-keep]')) if (detail.open) wasOpen.add(detail.dataset.keep!);
    // After every action the flow shows its current step; between actions the step the author opened stays open.
    if (resetStages) opened.clear();
    else for (const detail of root.querySelectorAll<HTMLDetailsElement>('details[data-keep]')) opened.set(detail.dataset.keep!, detail.open);
    resetStages = false;
    const active = document.activeElement as HTMLInputElement | null;
    let want = focusKey(active);
    if (want === undefined && focusCarry !== undefined && (!active || active === document.body)) want = focusCarry;
    focusCarry = undefined;
    const selection = active?.tagName === 'INPUT' && active.type === 'text' ? active.selectionStart : null;

    const now = performance.now(), current = currentStage(), done = doneStages();
    for (const stage of done) if (!lastDone.has(stage) && rendered) doneAt.set(stage, now);
    for (const stage of [...doneAt.keys()]) if (!done.has(stage)) doneAt.delete(stage);
    lastDone = done;
    slots.clear();

    const hero = h('header', { class: 'create-hero' },
      h('p', { class: 't-eyebrow', text: c('eyebrow') }),
      h('h1', { class: 'create-hero__title', text: c('heroTitle') }),
      h('p', { class: 'create-hero__lead', text: c('heroLead') }),
      h('div', { class: 'create-hero__row' }, action(c('sample'), 'recovery-sample', context.showSample, { variant: 'secondary', icon: 'play' }), chip(c('local'), { icon: 'shield' })));
    const builders: Record<Stage, () => Child[]> = { plan: planStage, record: recordStage, review: reviewStage, evidence: evidenceStage, build: buildStage, finish: finishStage };
    // Exactly one open step: the one the author opened, otherwise the current one.
    const chosen = STAGES.find(stage => opened.get('stage:' + stage) === true && !locked(stage)) ?? current;
    const steps = STAGES.map((stage, index) => {
      building = stage;
      const body = builders[stage]();
      building = undefined;
      const key = 'stage:' + stage, closed = locked(stage), open = stage === chosen && !closed;
      if (open && !wasOpen.has(key) && rendered) openedAt.set(stage, now);
      if (!open) openedAt.delete(stage);
      const state: StepState = stage === current && !(stage === 'finish' && compiled) ? 'current' : done.has(stage) ? 'done' : 'upcoming';
      const stateWord = state === 'done' ? 'stateDone' : state === 'current' ? 'stateCurrent' : closed ? 'stateLocked' : 'stateUpcoming';
      const since = openedAt.get(stage), finished = doneAt.get(stage);
      return step({
        index: index + 1, title: c(stage), summary: stageSummary(stage), state, open, locked: closed,
        position: fill(c('position'), { n: index + 1, total: STAGES.length, state: c(stateWord) }),
        attrs: { 'data-stage': stage, 'data-keep': key, name: 'create-steps' },
        openedFor: since === undefined ? undefined : now - since,
        doneFor: finished === undefined ? undefined : now - finished,
      }, ...body);
    });
    const list = stepper({ label: c('stepsLabel') }, ...steps);
    // Errors and progress stay with the step that caused them; a result that opens the next step travels with it.
    const status = statusNode();
    const forward = !failed && !busy && (messageKey === 'preparedLabel' || messageKey === 'stopped' || messageKey === 'stoppedConfirm');
    const target = forward ? current : messageStage ?? current;
    const openStage = (stage: Stage): boolean => steps[STAGES.indexOf(stage)]!.open;
    let host = openStage(target) ? slots.get(target) : undefined;
    if (!host) { host = STAGES.filter(openStage).map(stage => slots.get(stage)).find(Boolean); if (!failed && !busy && messageKey !== 'fix') status.classList.add('sr-only'); }
    const fragment = document.createDocumentFragment();
    fragment.append(hero, h('h2', { class: 'sr-only', text: c('stepsLabel') }));
    if (host) host.append(status); else fragment.append(h('div', { class: 'create-status-slot' }, status));
    // Below 72em the failed drawing surface lies under the steps: the open step offers the way to it (its panel says what happened).
    if (context.engineFailed?.() && host && !host.closest('[data-stage]')?.querySelector('[data-testid="recovery-go-editor"]')) host.append(h('div', { class: 'create-actions create-actions--quiet create-narrow-hint' }, button({ label: c('editorLinkFailed'), testid: 'recovery-go-failed-editor', variant: 'plain', size: 'sm', icon: 'arrowDown', onClick: () => context.focusEngine?.() })));
    fragment.append(list);
    if (!view.recording.active) recordingAt = undefined;
    else if (recordingAt === undefined) recordingAt = rendered ? now : now - ENTRANCE_MS;
    const dock = context.recordingDock ?? fragment;
    if (context.recordingDock) context.recordingDock.replaceChildren();
    if (view.recording.active) {
      const since = now - recordingAt!;
      // The one Stop of a recording, and its one status carrier: dot, word and count. It rests in its own row above the
      // hero (nothing lies under it) and sticks under the app bar while the page scrolls, also over the editor.
      dock.append(h('div', { class: `create-recording-bar pn-floating${since < ENTRANCE_MS ? ' is-new' : ''}`, attrs: { role: 'region', 'aria-label': c('recordingLabel') }, vars: { '--_elapsed': `${Math.round(Math.min(since, ENTRANCE_MS))}ms` } },
        h('span', { class: 'create-recording-bar__state' }, h('span', { class: 'create-recording-bar__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'create-recording-bar__label', text: c('recordingLabel') })),
        action(c('stop'), 'recovery-stop-visible', stopRecording, { variant: 'primary', icon: 'stop' })));
    }
    root.replaceChildren(fragment);
    // The bar docks above the guide when a recording starts; the record step stays where it was
    // (browsers without scroll anchoring would let it jump by the bar's height, R5-01).
    if (keepInPlace && view?.recording.active) {
      const { selector, top } = keepInPlace; keepInPlace = undefined;
      // Again two frames later (the bar's measured height can land one frame later on narrow screens) and once
      // more after that: a raised floor takes effect only with the following layout.
      const hold = (): void => {
        const anchor = root.querySelector(selector); if (!anchor) return;
        const delta = anchor.getBoundingClientRect().top - top;
        // The docked bar adds height above the guide; if the page cannot scroll that far, raise its floor by the difference.
        const short = scrollY + delta - (document.documentElement.scrollHeight - innerHeight);
        if (short > 0 && root.hasAttribute('data-record-hold')) { holdFloor += Math.ceil(short); root.style.setProperty('--_record-hold', `${holdFloor}px`); void document.documentElement.scrollHeight; }
        scrollBy(0, anchor.getBoundingClientRect().top - top);
      };
      hold(); requestAnimationFrame(() => requestAnimationFrame(() => { hold(); requestAnimationFrame(hold); }));
    }
    document.body.toggleAttribute('data-recording', view.recording.active);
    if (!view.recording.active && !busy) root.toggleAttribute('data-record-hold', false);
    renderEmptyScene();
    renderRecordingTasks();
    for (const [id, key] of invalid) markField(id, key);

    const pending = focusAfter; focusAfter = undefined;
    if (pending) {
      const target = root.querySelector<HTMLElement>(`[data-testid="${CSS.escape(pending)}"]`);
      // A field with an error (and the next primary after creating) comes to the middle of the view, clear of the sticky step footer.
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    else if (want !== undefined) {
      const target = want.startsWith('t:') ? root.querySelector<HTMLElement>(`[data-testid="${CSS.escape(want.slice(2))}"]`) : want.startsWith('s:') ? root.querySelector<HTMLElement>(`details[data-keep="${CSS.escape(want.slice(2))}"] > summary`) : null;
      if (target && usable(target)) {
        target.focus({ preventScroll: true });
        if (selection !== null && target instanceof HTMLInputElement && target.type === 'text') target.setSelectionRange(selection, selection);
      } else if (busy) focusCarry = want;
      else if (want) {
        // The control that had focus is gone (e.g. Start while recording): continue at the step's next action.
        const fallback = [...root.querySelectorAll<HTMLElement>(`[data-stage="${current}"] .pn-btn--primary`), ...(context.recordingDock ?? root).querySelectorAll<HTMLElement>('.create-recording-bar .pn-btn'), ...root.querySelectorAll<HTMLElement>(`[data-stage="${current}"] > summary`)].find(usable);
        // Stop in the docked bar is already in view; scrolling to its place in the flow would jump to the top (R5-01).
        fallback?.focus({ preventScroll: !!fallback.closest('.create-recording-bar') });
      }
    }
    rendered = true;
  }
  return { render, loadRecordings };
}
