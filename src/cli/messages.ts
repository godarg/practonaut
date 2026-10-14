import { invocationName } from './invocation.ts';
/** User-authored CLI copy. Machine fields/codes and upstream diagnostic details are data. */
export const CLI_CATALOG = {
  "sceneTooLarge": {
    "en": "scene {path} exceeds 10 MiB",
    "de": "Szene {path} ist größer als 10 MiB"
  },
  "tasksOutputLink": {
    "en": "{path} is a symbolic link or junction; from-scenes does not write through links. Choose another --out folder",
    "de": "{path} ist ein symbolischer Link oder eine Junction; from-scenes schreibt nicht durch Links. Anderen --out-Ordner wählen"
  },
  "tasksOutputNotFolder": {
    "en": "--out {path} is a file, not a folder; from-scenes writes a folder with world/ and oracle.json. Choose a new or existing folder",
    "de": "--out {path} ist eine Datei, kein Ordner; from-scenes schreibt einen Ordner mit world/ und oracle.json. Einen neuen oder vorhandenen Ordner wählen"
  },
  "tasksOutputExists": {
    "en": "{path} already exists; add --force to replace it",
    "de": "{path} existiert bereits; --force ersetzt die Datei"
  },
  "tasksListHead": {
    "en": "Excalidraw task library: {count} {count:task|tasks} (world {world} {version})\n",
    "de": "Excalidraw-Aufgabenbibliothek: {count} {count:Aufgabe|Aufgaben} (Welt {world} {version})\n"
  },
  "tasksAction": {
    "en": "action ",
    "de": "Aktion "
  },
  "tasksActions": {
    "en": "actions",
    "de": "Aktionen"
  },
  "tasksListFoot": {
    "en": "Difficulty ●○○ to ●●●; actions = length of the reference solution.\nOpen one: {cli} play <task-id>   Details: {cli} tasks show <task-id>\n",
    "de": "Schwierigkeit ●○○ bis ●●●; Aktionen = Länge der Referenzlösung.\nÖffnen: {cli} play <Aufgaben-ID>   Details: {cli} tasks show <Aufgaben-ID>\n"
  },
  "tasksUnknown": {
    "en": "unknown library task: {id} (see {cli} tasks list)",
    "de": "unbekannte Bibliotheksaufgabe: {id} (siehe {cli} tasks list)"
  },
  "tasksShowHead": {
    "en": "{id} — {title} (difficulty {difficulty}/3)\n\n",
    "de": "{id} — {title} (Schwierigkeit {difficulty}/3)\n\n"
  },
  "tasksShowGoal": {
    "en": "Goal conditions:",
    "de": "Zielbedingungen:"
  },
  "tasksShowFacts": {
    "en": "\nHints: {hints} · error classes: {errors} · variants: {variants} · reference solution: {actions} {actions:action|actions} · near misses: {near}\n",
    "de": "\nHinweise: {hints} · Fehlerklassen: {errors} · Varianten: {variants} · Referenzlösung: {actions} {actions:Aktion|Aktionen} · Beinahe-Treffer: {near}\n"
  },
  "tasksShowPlay": {
    "en": "Open it: {cli} play {id}\n",
    "de": "Öffnen: {cli} play {id}\n"
  },
  "tasksUsage": {
    "en": "usage: {cli} tasks list | show <task-id> [--oracle] | from-scenes <start.excalidraw> <goal.excalidraw> --out <dir>",
    "de": "Verwendung: {cli} tasks list | show <Aufgaben-ID> [--oracle] | from-scenes <start.excalidraw> <ziel.excalidraw> --out <Verzeichnis>"
  },
  "tasksScenesUsage": {
    "en": "usage: {cli} tasks from-scenes <start.excalidraw> <goal.excalidraw> --out <dir> [--task <id>] [--layout relative] [--align] [--tolerance <px>] [--force] [--json]",
    "de": "Verwendung: {cli} tasks from-scenes <start.excalidraw> <ziel.excalidraw> --out <Verzeichnis> [--task <id>] [--layout relative] [--align] [--tolerance <px>] [--force] [--json]"
  },
  "tasksScenesDone": {
    "en": "Task written: {steps} {steps:step|steps}, {arrows} {arrows:arrow|arrows}, {frames} {frames:frame|frames} in the goal; {clauses} goal {clauses:condition|conditions}, {errorClasses} error {errorClasses:class|classes}.\nChecked: the goal scene passes, the start scene fails; the reference solution ({actions} {actions:action|actions}) passes; {near} near {near:miss fails|misses fail}.\n",
    "de": "Aufgabe geschrieben: {steps} {steps:Schritt|Schritte}, {arrows} {arrows:Pfeil|Pfeile}, {frames} Rahmen im Ziel; {clauses} {clauses:Zielbedingung|Zielbedingungen}, {errorClasses} {errorClasses:Fehlerklasse|Fehlerklassen}.\nGeprüft: Die Zielszene besteht, die Startszene nicht; die Referenzlösung mit {actions} {actions:Aktion|Aktionen} besteht; {near} Beinahe-Treffer {near:fällt|fallen} durch.\n"
  },
  "tasksScenesIgnored": {
    "en": "Not modelled and ignored: {n} {n:element|elements} ({kinds}).\n",
    "de": "Nicht modelliert und ignoriert: {n} {n:Element|Elemente} ({kinds}).\n"
  },
  "tasksScenesPlay": {
    "en": "Practise it: {cli} play {path}\n",
    "de": "Üben: {cli} play {path}\n"
  },
  "playTaskConflict": {
    "en": "a library task id already names the task; drop --task",
    "de": "eine Bibliotheksaufgabe legt die Aufgabe schon fest; --task weglassen"
  },
  "recordingMissing": {
    "en": "Recording does not exist in the local store",
    "de": "Aufnahme ist im lokalen Speicher nicht vorhanden"
  },
  "recordingInUse": {
    "en": "Recording retained. First explicitly delete the saved projects that reference it, or the damaged entries whose references cannot be read: {ids}.",
    "de": "Aufnahme erhalten. Zuerst die referenzierenden gespeicherten Projekte oder beschädigten Einträge mit unlesbaren Verweisen ausdrücklich löschen: {ids}."
  },
  "projectStoreFailure": {
    "en": "The managed project store could not be accessed safely; recording retained.",
    "de": "Auf den verwalteten Projektspeicher konnte nicht sicher zugegriffen werden; Aufnahme erhalten."
  },

  "pairStateMismatch": {"en": "Native artifact does not encode the bound Session state", "de": "Nativer Export bildet den gebundenen Sitzungszustand nicht ab"},
  "pairNativeRequired": {"en": "--pair requires an unannotated native Excalidraw artifact", "de": "--pair benötigt einen nativen Excalidraw-Export ohne nachträgliche Metadaten"},
  "pairInvalid": {"en": "Export pair manifest or artifact binding is invalid", "de": "Exportpaar-Manifest oder Artefaktbindung ist ungültig"},
  "nativeRoutingRequired": {"en": "Unbound native checks require explicit --seed and --task, or use --pair with the export manifest", "de": "Ungebundene native Prüfung benötigt --seed und --task; alternativ --pair mit dem Exportmanifest verwenden"},
  "languageInvalid": {
    "en": "--lang requires en or de before the command",
    "de": "--lang verlangt en oder de vor dem Befehl"
  },
  "optionValue": {
    "en": "option {option} needs a value",
    "de": "Option {option} benötigt einen Wert"
  },
  "optionUnknown": {
    "en": "unknown option {option}",
    "de": "Unbekannte Option {option}"
  },
  "validateUsage": {
    "en": "validate needs exactly one <package> argument",
    "de": "validate benötigt genau ein <package>-Argument"
  },
  "readFailed": {
    "en": "cannot read {path} ({code})",
    "de": "{path} kann nicht gelesen werden ({code})"
  },
  "regularFile": {
    "en": "{path} is not a regular file",
    "de": "{path} ist keine reguläre Datei"
  },
  "packUsage": {
    "en": "pack needs exactly one <source-dir> argument",
    "de": "pack benötigt genau ein <source-dir>-Argument"
  },
  "packOutput": {
    "en": "pack needs --out <file>",
    "de": "pack benötigt --out <file>"
  },
  "sourceFailed": {
    "en": "cannot read source {path} ({code})",
    "de": "Quelle {path} kann nicht gelesen werden ({code})"
  },
  "writeFailed": {
    "en": "cannot write {path} ({code})",
    "de": "{path} kann nicht geschrieben werden ({code})"
  },
  "doctorUsage": {
    "en": "doctor takes no arguments",
    "de": "doctor nimmt keine Argumente an"
  },
  "versionUsage": {
    "en": "--version takes no arguments",
    "de": "--version nimmt keine Argumente an"
  },
  "commandUnknown": {
    "en": "unknown command {command}",
    "de": "Unbekannter Befehl {command}"
  },
  "helpHint": {
    "en": "Run 'practonaut --help' for usage.",
    "de": "Hinweise: practonaut --lang de --help."
  },
  "optionDuplicate": {
    "en": "duplicate option {option}",
    "de": "Doppelte Option {option}"
  },
  "inputUsage": {
    "en": "exactly one input path is required",
    "de": "Genau ein Eingabepfad ist erforderlich"
  },
  "seedUsage": {
    "en": "seed must be a safe integer",
    "de": "Seed muss eine sichere Ganzzahl sein"
  },
  "checkerTimeout": {
    "en": "checker exceeded 10 s wall limit",
    "de": "Checker hat die Grenze von 10 Sekunden überschritten"
  },
  "checkerOutput": {
    "en": "checker output exceeds limit",
    "de": "Checker-Ausgabe überschreitet die Grenze"
  },
  "checkerProcess": {
    "en": "checker process failed",
    "de": "Checker-Prozess fehlgeschlagen"
  },
  "checkerFailed": {
    "en": "checker failed: {detail}",
    "de": "Checker fehlgeschlagen: {detail}"
  },
  "runUsage": {
    "en": "run requires --seed and --actions",
    "de": "run benötigt --seed und --actions"
  },
  "actionsSize": {
    "en": "action file too large",
    "de": "Aktionsdatei ist zu groß"
  },
  "actionsArray": {
    "en": "actions must be an array of at most 10000 actions",
    "de": "Aktionsdatei muss ein Array mit höchstens 10000 Aktionen sein"
  },
  "mirrorUsage": {
    "en": "--mirror must be auto, required or off",
    "de": "--mirror muss auto, required oder off sein"
  },
  "nativeExport": {
    "en": "native export requires the real engine",
    "de": "Nativer Export benötigt die echte Engine"
  },
  "checkerRejected": {"en":"Checker rejected the bounded input ({code})", "de":"Checker hat die begrenzte Eingabe verweigert ({code})"},
  "checkUsage": {
    "en": "check requires --world <world.pnworld>",
    "de": "check benötigt --world <world.pnworld>"
  },
  "exportContext": {
    "en": "export evaluation context does not match world",
    "de": "Evaluationskontext des Exports passt nicht zur Welt"
  },
  "exportContradiction": {
    "en": "explicit context contradicts export evaluation context",
    "de": "Expliziter Kontext widerspricht dem Evaluationskontext des Exports"
  },
  "serveUsage": {
    "en": "serve takes at most one world (source directory or .pnworld)",
    "de": "serve nimmt höchstens eine Welt (Quellverzeichnis oder .pnworld)"
  },
  "projectFile": {
    "en": "Author project must be a bounded regular JSON file",
    "de": "Autorenprojekt muss eine begrenzte reguläre JSON-Datei sein"
  },
  "projectChanged": {
    "en": "Author project changed during read",
    "de": "Autorenprojekt wurde während des Lesens geändert"
  },
  "recordUsage": {
    "en": "record list | review <id> | delete <id>",
    "de": "record list | review <id> | delete <id>"
  },
  "compileDuplicate": {
    "en": "Duplicate compile option",
    "de": "Doppelte compile-Option"
  },
  "compileValue": {
    "en": "Compile option needs a value",
    "de": "compile-Option benötigt einen Wert"
  },
  "compileUsage": {
    "en": "compile <project.json> --out <world.pnworld> [--checker <bundle.pncheck>]",
    "de": "compile <project.json> --out <world.pnworld> [--checker <bundle.pncheck>]"
  },
  "compilePaths": {
    "en": "World and checker outputs must be different files",
    "de": "Welt und Checker müssen in unterschiedliche Dateien geschrieben werden"
  },
  "fixtureDuplicate": {
    "en": "Duplicate --fixture-client",
    "de": "Doppeltes --fixture-client"
  },
  "unsealedDuplicate": {
    "en": "Duplicate --unsealed",
    "de": "Doppeltes --unsealed"
  },
  "evalOption": {
    "en": "Unknown or duplicate evaluation option",
    "de": "Unbekannte oder doppelte Evaluationsoption"
  },
  "evalValue": {
    "en": "Evaluation option requires a value",
    "de": "Evaluationsoption benötigt einen Wert"
  },
  "evalUsage": {
    "en": "eval requires one world, --bundle, --task, --seed, --out and an explicit absolute --client",
    "de": "eval benötigt eine Welt, --bundle, --task, --seed, --out und einen ausdrücklichen absoluten --client"
  },
  "evalInteger": {
    "en": "Evaluation integer is invalid",
    "de": "Evaluations-Ganzzahl ist ungültig"
  },
  "evalPosix": {
    "en": "POSIX identity is required",
    "de": "Eine POSIX-Identität ist erforderlich"
  },
  "evalClient": {
    "en": "--client requires an absolute path",
    "de": "--client benötigt einen absoluten Pfad"
  },
  "setupHelp": {
    "en": "Usage: {cli} setup\nExplicitly download the pinned Playwright Chromium runtime, or reuse its existing cache.\n",
    "de": "Verwendung: {cli} setup\nGepinntes Playwright-Chromium ausdrücklich herunterladen oder vorhandenen Cache verwenden.\n"
  },
  "setupUsage": {
    "en": "{cli} setup takes no arguments.\n",
    "de": "{cli} setup nimmt keine Argumente an.\n"
  },
  "setupMissing": {
    "en": "setup: the pinned Playwright runtime is unavailable. Reinstall locked dependencies.\n",
    "de": "setup: Gepinnte Playwright-Laufzeit fehlt. Gelockte Abhängigkeiten erneut installieren.\n"
  },
  "setupStart": {
    "en": "setup: explicit Chromium provisioning; download sources and cache locations follow.\n",
    "de": "setup: Chromium ausdrücklich bereitstellen; Downloadquellen und Cache-Pfade folgen.\n"
  },
  "setupDoneAt": {
    "en": "setup: Chromium is ready in {path} ({size} MB for the browser and its headless shell). Practice can now run offline with the real Excalidraw mirror.\n",
    "de": "setup: Chromium liegt bereit in {path} ({size} MB für Browser und Headless-Shell). Üben läuft nun offline mit echter Excalidraw-Spiegelung.\n"
  },
  "setupDone": {
    "en": "setup: Chromium provisioning completed. Runtime may now operate offline.\n",
    "de": "setup: Chromium bereitgestellt. Die Laufzeit kann nun offline arbeiten.\n"
  },
  "mcpInput": {
    "en": "Practonaut MCP: protocol input rejected\n",
    "de": "Practonaut MCP: Protokolleingabe verweigert\n"
  },
  "mcpRefused": {
    "en": "Practonaut MCP refused: {code}\n",
    "de": "Practonaut MCP verweigert: {code}\n"
  },
  "benchUsage": {
    "en": "bench needs --agent <oracle|random|claude-code|\"command … {mcp_config} …\">; see {cli} bench --help",
    "de": "bench braucht --agent <oracle|random|claude-code|\"Befehl … {mcp_config} …\">; siehe {cli} bench --help"
  },
  "benchNumber": {
    "en": "{option} must be a whole number from 1 to {max}",
    "de": "{option} muss eine ganze Zahl von 1 bis {max} sein"
  },
  "benchTasks": {
    "en": "--tasks needs all or a comma-separated list of distinct library task ids",
    "de": "--tasks braucht all oder eine durch Kommas getrennte Liste verschiedener Bibliotheksaufgaben"
  },
  "benchKeepEnv": {
    "en": "--keep-env needs comma-separated environment variable names (letters, digits and _)",
    "de": "--keep-env braucht durch Kommas getrennte Namen von Umgebungsvariablen (Buchstaben, Ziffern und _)"
  },
  "benchKeepEnvPreset": {
    "en": "--keep-env applies only to a preset agent (claude-code); built-in agents and command templates get your environment unchanged",
    "de": "--keep-env gilt nur für einen voreingestellten Agenten (claude-code); eingebaute Agenten und Befehlsvorlagen bekommen Ihre Umgebung unverändert"
  },
  "benchWithheld": {
    "en": "practonaut bench: the {agent} preset does not pass {names} to the agent (a provider key would switch it from its login to API billing); --keep-env <name> passes one on\n",
    "de": "practonaut bench: die Voreinstellung {agent} gibt {names} nicht an den Agenten weiter (ein Anbieterschlüssel würde ihn von seiner Anmeldung auf API-Abrechnung umstellen); --keep-env <Name> gibt einen weiter\n"
  },
  "benchStart": {
    "en": "practonaut bench: {runs} {runs:run|runs} with agent {agent}, {mode}\n",
    "de": "practonaut bench: {runs} {runs:Lauf|Läufe} mit Agent {agent}, {mode}\n"
  },
  "benchWritten": {
    "en": "\nReport: {path}\nRun logs and artifacts: {logs}\nRender it: {cli} report <report.json> --html <out.html>   Re-judge it: {cli} report <report.json> --verify --runs {logs}\n",
    "de": "\nBericht: {path}\nLaufprotokolle und Artefakte: {logs}\nDarstellen: {cli} report <bericht.json> --html <out.html>   Nachrechnen: {cli} report <bericht.json> --verify --runs {logs}\n"
  },
  "reportUsage": {
    "en": "report needs one bench report: {cli} report <bench.json> [--verify [--runs <dir>]] [--html <out.html>] [--json]",
    "de": "report braucht einen Bench-Bericht: {cli} report <bench.json> [--verify [--runs <Ordner>]] [--html <out.html>] [--json]"
  },
  "benchInterrupting": {
    "en": "\npractonaut bench: stopping — ending the agent, closing its session, writing a partial report … (press Ctrl+C again to stop at once)\n",
    "de": "\npractonaut bench: wird beendet — Agent wird gestoppt, Sitzung geschlossen, Teilbericht geschrieben … (erneut Strg+C beendet sofort)\n"
  },
  "benchForcedStop": {
    "en": "practonaut bench: stopped at once (second interrupt); the agent was killed and no report was written. The run directory may hold an unfinished run.\n",
    "de": "practonaut bench: sofort beendet (zweiter Abbruch); der Agent wurde beendet, kein Bericht geschrieben. Das Laufverzeichnis kann einen unfertigen Lauf enthalten.\n"
  },
  "benchInterrupted": {
    "en": "\nInterrupted: this partial report holds {runs} of {planned} planned runs; the run in progress was not scored.\n",
    "de": "\nAbgebrochen: Dieser Teilbericht enthält {runs} von {planned} geplanten Läufen; der laufende Lauf wurde nicht bewertet.\n"
  },
  "benchInterruptedEmpty": {
    "en": "practonaut bench: interrupted before the first run finished; no report written (run logs: {logs}).\n",
    "de": "practonaut bench: abgebrochen, bevor der erste Lauf endete; kein Bericht geschrieben (Laufprotokolle: {logs}).\n"
  },
  "reportRunsNeedsVerify": {
    "en": "--runs names the run directory for --verify; add --verify",
    "de": "--runs nennt das Laufverzeichnis für --verify; --verify ergänzen"
  },
  "reportTooLarge": {
    "en": "the bench report is larger than {size} MiB",
    "de": "der Bench-Bericht ist größer als {size} MiB"
  },
  "reportConsistencyOnly": {
    "en": "\nConsistency-checked, not re-verified: every pass and aggregate follows from the verdicts in the file. Re-judge the run artifacts with --verify.\n",
    "de": "\nAuf Stimmigkeit geprüft, nicht nachgerechnet: Jedes Bestehen und jede Kennzahl folgt aus den Urteilen in der Datei. --verify beurteilt die Laufartefakte neu.\n"
  },
  "reportReverified": {
    "en": "\nRe-verified: {runs} {runs:run|runs} re-judged by the checker from their artifacts; every verdict matches ({unjudged} not judged).\n",
    "de": "\nNachgerechnet: {runs} {runs:Lauf|Läufe} vom Prüfer aus den Artefakten neu beurteilt; jedes Urteil stimmt ({unjudged} nicht bewertet).\n"
  },
  "reportJson": {
    "en": "the bench report is not bounded valid JSON",
    "de": "der Bench-Bericht ist kein begrenztes gültiges JSON"
  },
  "reportHtml": {
    "en": "HTML: {path}\n",
    "de": "HTML: {path}\n"
  },
  "reportReverifiedWorld": {
    "en": "\nRe-verified: {runs} {runs:run|runs} re-judged by the checker from their artifacts, against the world stored in the bench folder ({world} {version}); every verdict matches ({unjudged} not judged); {references} {references:reference|references} re-checked.\n",
    "de": "\nNachgerechnet: {runs} {runs:Lauf|Läufe} vom Prüfer aus den Artefakten neu beurteilt, mit der im Bench-Ordner gespeicherten Welt ({world} {version}); jedes Urteil stimmt ({unjudged} nicht bewertet); {references} {references:Referenz|Referenzen} neu geprüft.\n"
  },
  "benchSeedsExclusive": {
    "en": "--seeds and --seed-list exclude each other: --seeds <n> runs seeds 1 to n, --seed-list names them",
    "de": "--seeds und --seed-list schließen sich aus: --seeds <n> fährt die Seeds 1 bis n, --seed-list nennt sie einzeln"
  },
  "benchSeedList": {
    "en": "--seed-list needs distinct whole numbers from 0 to 999999999, comma-separated (at most 1000)",
    "de": "--seed-list braucht verschiedene ganze Zahlen von 0 bis 999999999, durch Kommas getrennt (höchstens 1000)"
  },
  "benchLabel": {
    "en": "--label needs a text of 1 to {max} characters",
    "de": "--label braucht einen Text mit 1 bis {max} Zeichen"
  },
  "benchOracleNeedsWorld": {
    "en": "--oracle names the reference solution of a task in your own world; add --world <dir|.pnworld> (library tasks bring their own)",
    "de": "--oracle nennt die Referenzlösung einer Aufgabe Ihrer eigenen Welt; --world <Ordner|.pnworld> ergänzen (Bibliotheksaufgaben bringen ihre eigene mit)"
  },
  "benchOracleMissing": {
    "en": "the oracle agent plays each task's reference solution; give --oracle <file> for {tasks} (tasks from-scenes writes it as oracle.json beside the world)",
    "de": "der Agent oracle spielt die Referenzlösung jeder Aufgabe; --oracle <Datei> für {tasks} angeben (tasks from-scenes schreibt sie als oracle.json neben die Welt)"
  },
  "benchWorldOwn": {
    "en": "practonaut bench: world {world} {version} (your own), {refs} of {tasks} benched {tasks:task has|tasks have} a validated reference\n",
    "de": "practonaut bench: Welt {world} {version} (Ihre eigene), {refs} von {tasks} {tasks:bewerteten Aufgabe hat|bewerteten Aufgaben haben} eine geprüfte Referenz\n"
  },
  "benchWorldRejected": {
    "en": "the world {path} was rejected ({code}): {detail}",
    "de": "die Welt {path} wurde abgelehnt ({code}): {detail}"
  },
  "benchWorldTaskUnknown": {
    "en": "task {id} is not in world {world}",
    "de": "Aufgabe {id} gibt es in der Welt {world} nicht"
  },
  "benchTaskCase": {
    "en": "tasks {a} and {b} differ only in case; their run folders would collide. Bench them separately",
    "de": "die Aufgaben {a} und {b} unterscheiden sich nur in Groß- und Kleinschreibung; ihre Laufordner würden kollidieren. Getrennt bewerten"
  },
  "benchFileTooLarge": {
    "en": "{path} is larger than {size} MiB",
    "de": "{path} ist größer als {size} MiB"
  },
  "benchOracleJson": {
    "en": "{path} is not bounded valid JSON, so it is not an oracle file",
    "de": "{path} ist kein begrenztes gültiges JSON und damit keine Oracle-Datei"
  },
  "benchOracleFormat": {
    "en": "{path} is not a practonaut.task-oracle/1 file (as tasks from-scenes writes it): {issue}",
    "de": "{path} ist keine practonaut.task-oracle/1-Datei (wie tasks from-scenes sie schreibt): {issue}"
  },
  "benchOracleWorld": {
    "en": "{path} is the oracle of world {world}, not of {expected}",
    "de": "{path} ist das Oracle der Welt {world}, nicht von {expected}"
  },
  "benchOracleTask": {
    "en": "{path} is the oracle of task {task}, which is not benched (see --tasks)",
    "de": "{path} ist das Oracle der Aufgabe {task}, die nicht bewertet wird (siehe --tasks)"
  },
  "benchOracleTwice": {
    "en": "two --oracle files are for task {task}; give one",
    "de": "zwei --oracle-Dateien gehören zur Aufgabe {task}; eine angeben"
  },
  "benchReferenceOther": {
    "en": "the reference given for task {task} belongs to another task or world",
    "de": "die Referenz für die Aufgabe {task} gehört zu einer anderen Aufgabe oder Welt"
  },
  "benchReferenceRejected": {
    "en": "the reference of task {task} does not pass the checker: with seed {seed} its action {index} is rejected ({code})",
    "de": "die Referenz der Aufgabe {task} besteht den Prüfer nicht: mit Seed {seed} wird ihre Aktion {index} abgelehnt ({code})"
  },
  "benchReferenceChecker": {
    "en": "the reference of task {task} does not pass the checker: with seed {seed} the checker refuses it ({code})",
    "de": "die Referenz der Aufgabe {task} besteht den Prüfer nicht: mit Seed {seed} lehnt der Prüfer sie ab ({code})"
  },
  "benchReferenceFails": {
    "en": "the reference of task {task} does not pass the checker: with seed {seed} it does not reach the goal",
    "de": "die Referenz der Aufgabe {task} besteht den Prüfer nicht: mit Seed {seed} erreicht sie das Ziel nicht"
  },
  "benchReportSchemaUnknown": {
    "en": "report does not match {first} or {second}: its schema field names neither",
    "de": "der Bericht passt weder zu {first} noch zu {second}: sein Feld schema nennt keines von beiden"
  },
  "benchReportTaskCase": {
    "en": "settings name tasks {a} and {b}, which differ only in case",
    "de": "die Einstellungen nennen die Aufgaben {a} und {b}, die sich nur in Groß- und Kleinschreibung unterscheiden"
  },
  "benchReportIsolation": {
    "en": "an agent of kind {kind} has isolation level {expected}; the report says {given}",
    "de": "ein Agent der Art {kind} hat die Isolationsstufe {expected}; der Bericht nennt {given}"
  },
  "benchReportModelSource": {
    "en": "the report names a model without its source, or a model source without a model",
    "de": "der Bericht nennt ein Modell ohne Quelle oder eine Modellquelle ohne Modell"
  },
  "benchReportAgentField": {
    "en": "an agent of kind {kind} cannot have this {field}",
    "de": "ein Agent der Art {kind} kann dieses Feld {field} nicht haben"
  },
  "benchReportReferenceTask": {
    "en": "the references name task {task} twice, or a task that is not benched",
    "de": "die Referenzen nennen die Aufgabe {task} doppelt oder eine Aufgabe, die nicht bewertet wurde"
  },
  "benchReportReferenceSource": {
    "en": "a reference from {source} does not fit a world of source {world}",
    "de": "eine Referenz aus {source} passt nicht zu einer Welt der Quelle {world}"
  },
  "benchReportLibraryReference": {
    "en": "a library bench has a reference for every task; {task} has none",
    "de": "ein Bibliotheks-Bench hat für jede Aufgabe eine Referenz; {task} hat keine"
  },
  "benchReportGenerated": {
    "en": "the generator metadata names task {task} twice, or a task that is not benched",
    "de": "die Generator-Angaben nennen die Aufgabe {task} doppelt oder eine Aufgabe, die nicht bewertet wurde"
  },
  "benchReportRunId": {
    "en": "run {id} is not named after its task, seed and repeat ({expected})",
    "de": "der Lauf {id} ist nicht nach Aufgabe, Seed und Wiederholung benannt ({expected})"
  },
  "verifyMutationsFormat": {
    "en": "run {run}: mutations.jsonl is not a mutation log",
    "de": "Lauf {run}: mutations.jsonl ist kein Änderungsprotokoll"
  },
  "verifyMutationsCounters": {
    "en": "run {run}: the mutation log does not agree with the run's counted act, undo and reset calls",
    "de": "Lauf {run}: das Änderungsprotokoll passt nicht zu den gezählten Aufrufen von act, undo und reset des Laufs"
  },
  "verifyTrace": {
    "en": "run {run}: the checker does not re-derive the stored condition trace from the session and the mutation log",
    "de": "Lauf {run}: der Prüfer leitet den gespeicherten Bedingungsverlauf nicht aus Sitzung und Änderungsprotokoll her"
  },
  "benchReportBoard": {
    "en": "run {id} binds a picture of the real engine, but the bench ran without the mirror",
    "de": "Lauf {id} bindet ein Bild der echten Engine, die Bench lief aber ohne Spiegelung"
  },
  "benchReportTraceError": {
    "en": "run {id}: a condition trace and a trace error must not appear together, and a missing trace needs its error",
    "de": "Lauf {id}: Bedingungsverlauf und Verlaufsfehler dürfen nicht zusammen stehen, und ein fehlender Verlauf braucht seinen Fehler"
  },
  "benchReportMutations": {
    "en": "run {id}: the mutation log holds {entries} entries, but the run counted {calls} act, undo and reset calls",
    "de": "Lauf {id}: das Änderungsprotokoll hat {entries} Einträge, der Lauf zählte aber {calls} Aufrufe von act, undo und reset"
  },
  "benchReportClientTiming": {
    "en": "run {id}: client timing comes only from Practonaut's own client (built-in agents)",
    "de": "Lauf {id}: Client-Zeiten stammen nur vom eigenen Client von Practonaut (eingebaute Agenten)"
  },
  "benchReportClient": {
    "en": "run {id}: client figures come only from an external agent's own output, with the source its kind ({kind}) allows",
    "de": "Lauf {id}: Client-Angaben stammen nur aus der Ausgabe eines externen Agenten, mit der Quelle, die seine Art ({kind}) erlaubt"
  },
  "benchReportRunReference": {
    "en": "run {id} names a reference of {given} actions; the report's references give {expected}",
    "de": "der Lauf {id} nennt eine Referenz von {given} Aktionen; die Referenzen des Berichts ergeben {expected}"
  },
  "benchReportArtifacts": {
    "en": "run {id}: a judged run binds its artifacts and a run that was not judged binds none",
    "de": "Lauf {id}: ein bewerteter Lauf bindet seine Artefakte, ein nicht bewerteter keine"
  },
  "verifyWorldMissing": {
    "en": "the stored world {file} is missing or unreadable in the bench folder (if the report was moved without its folder, point --runs at the bench folder)",
    "de": "die gespeicherte Welt {file} fehlt im Bench-Ordner oder ist nicht lesbar (wurde der Bericht ohne seinen Ordner verschoben, --runs auf den Bench-Ordner richten)"
  },
  "verifyWorldHash": {
    "en": "the stored world {file} does not match the hash the report binds",
    "de": "die gespeicherte Welt {file} passt nicht zum Hash, den der Bericht bindet"
  },
  "verifyWorldPackage": {
    "en": "the stored world {file} is not a valid world package ({code})",
    "de": "die gespeicherte Welt {file} ist kein gültiges Weltpaket ({code})"
  },
  "verifyWorldIdentity": {
    "en": "the stored world is {world} {version} (content {hash}…), the report names {expectedWorld} {expectedVersion} (content {expectedHash}…)",
    "de": "die gespeicherte Welt ist {world} {version} (Inhalt {hash}…), der Bericht nennt {expectedWorld} {expectedVersion} (Inhalt {expectedHash}…)"
  },
  "verifyWorldGenerated": {
    "en": "the generator metadata of the stored world's tasks differs from the report's",
    "de": "die Generator-Angaben der Aufgaben in der gespeicherten Welt weichen vom Bericht ab"
  },
  "verifyWorldTask": {
    "en": "task {task} is not in the stored world",
    "de": "die Aufgabe {task} gibt es in der gespeicherten Welt nicht"
  },
  "verifyArtifactMissing": {
    "en": "run {run}: artifact {name} is missing or unreadable in the run directory (if the report was moved, point --runs at its bench folder)",
    "de": "Lauf {run}: das Artefakt {name} fehlt im Laufordner oder ist nicht lesbar (wurde der Bericht verschoben, --runs auf seinen Bench-Ordner richten)"
  },
  "verifyArtifactHash": {
    "en": "run {run}: artifact {name} does not match the hash the report binds",
    "de": "Lauf {run}: das Artefakt {name} passt nicht zum Hash, den der Bericht bindet"
  },
  "verifyReferencesMissing": {
    "en": "the stored references {file} are missing or unreadable in the bench folder",
    "de": "die gespeicherten Referenzen {file} fehlen im Bench-Ordner oder sind nicht lesbar"
  },
  "verifyReferencesHash": {
    "en": "the stored references {file} do not match the hash the report binds",
    "de": "die gespeicherten Referenzen {file} passen nicht zum Hash, den der Bericht bindet"
  },
  "verifyReferencesFormat": {
    "en": "the stored references {file} are not a practonaut.bench-references/1 file",
    "de": "die gespeicherten Referenzen {file} sind keine practonaut.bench-references/1-Datei"
  },
  "verifyReferenceTask": {
    "en": "the stored references do not hold exactly the tasks the report names (task {task})",
    "de": "die gespeicherten Referenzen enthalten nicht genau die Aufgaben, die der Bericht nennt (Aufgabe {task})"
  },
  "verifyReferenceLength": {
    "en": "task {task}: the report names a reference of {given} actions; the stored reference has {actual}",
    "de": "Aufgabe {task}: der Bericht nennt eine Referenz von {given} Aktionen; die gespeicherte Referenz hat {actual}"
  },
  "verifySessionOther": {
    "en": "run {run}: the session artifact belongs to another task or seed",
    "de": "Lauf {run}: das Sitzungsartefakt gehört zu einer anderen Aufgabe oder einem anderen Seed"
  },
  "verifyActions": {
    "en": "run {run}: the report counts {given} actions; the session's final history holds {actual}",
    "de": "Lauf {run}: der Bericht zählt {given} Aktionen; die letzte Historie der Sitzung enthält {actual}"
  },
  "verifyCheckerSession": {
    "en": "run {run}: the checker rejects the session artifact",
    "de": "Lauf {run}: der Prüfer lehnt das Sitzungsartefakt ab"
  },
  "verifyCheckerNative": {
    "en": "run {run}: the checker rejects the native export",
    "de": "Lauf {run}: der Prüfer lehnt den nativen Export ab"
  },
  "verifyNativeState": {
    "en": "run {run}: the native export does not show the session's final state",
    "de": "Lauf {run}: der native Export zeigt nicht den Endzustand der Sitzung"
  },
  "verifyCheckerStored": {
    "en": "run {run}: the stored checker output differs from the re-run",
    "de": "Lauf {run}: die gespeicherte Prüferausgabe weicht von der erneuten Prüfung ab"
  },
  "verifyVerdict": {
    "en": "run {run}: the report's verdict differs from the re-run checker (re-run: {result})",
    "de": "Lauf {run}: das Urteil im Bericht weicht vom erneut gestarteten Prüfer ab (erneut: {result})"
  },
  "evalRemoved": {
    "en": "eval was replaced by {cli} bench (independent scoring of any MCP agent on the task library); see {cli} bench --help",
    "de": "eval wurde durch {cli} bench ersetzt (unabhängige Bewertung beliebiger MCP-Agenten an der Aufgabenbibliothek); siehe {cli} bench --help"
  },
  "mcpUsage": {
    "en": "mcp needs --task <library-task|world> (starts its own session) or --host <http://127.0.0.1:port> --token-file <path> (attaches to a running one)",
    "de": "mcp braucht --task <Bibliotheksaufgabe|Welt> (startet eine eigene Sitzung) oder --host <http://127.0.0.1:port> --token-file <Pfad> (bindet an eine laufende an)"
  },
  "mcpReady": {
    "en": "Practonaut MCP: task {task} (world {world}), seed {seed}, {mode}\n",
    "de": "Practonaut MCP: Aufgabe {task} (Welt {world}), Seed {seed}, {mode}\n"
  },
  "mcpWatch": {
    "en": "Watch in your browser (one-use link, valid 5 minutes, keep it private): {url}\n",
    "de": "Im Browser mitsehen (Link gilt einmal und 5 Minuten, nicht weitergeben): {url}\n"
  },
  "taskUnknown": {
    "en": "unknown task {id} in this world",
    "de": "unbekannte Aufgabe {id} in dieser Welt"
  },
  "mcpStart": {
    "en": "Practonaut MCP could not start\n",
    "de": "Practonaut MCP konnte nicht starten\n"
  },
  "packageOk": {
    "en": "OK  world package  {id} {version}",
    "de": "OK  Weltpaket  {id} {version}"
  },
  "packageArchive": {
    "en": "archive  {path}  {size} bytes  sha256 {hash}",
    "de": "Archiv  {path}  {size} Bytes  sha256 {hash}"
  },
  "packageDeclaredRights": {
    "en": "Declared world rights: {license}; no redistribution grant verified.",
    "de": "Deklarierte Weltrechte: {license}; keine Weitergabeerlaubnis geprüft."
  },
  "packageManifest": {
    "en": "manifest schema {schema}, entry {entry}",
    "de": "Manifest-Schema {schema}, Eintrag {entry}"
  },
  "packageSkipped": {
    "en": "not packed (source documentation): {files}",
    "de": "Nicht gepackt (Quelldokumentation): {files}"
  },
  "source": {
    "en": "source",
    "de": "Quelle"
  },
  "package": {
    "en": "package",
    "de": "Paket"
  },
  "packageRejected": {
    "en": "REJECTED  {what} {path}: {code}: {detail}{entry}",
    "de": "VERWEIGERT  {what} {path}: {code}: {detail}{entry}"
  },
  "packageEntry": {
    "en": " (entry: {entry})",
    "de": " (Eintrag: {entry})"
  },
  "hostOrigin": {
    "en": "Host origin: {origin}\n",
    "de": "Host-Origin: {origin}\n"
  },
  "hostToken": {
    "en": "Token file: {path}\n",
    "de": "Token-Datei: {path}\n"
  },
  "hostMode": {
    "en": "Mode: {mode}\n",
    "de": "Modus: {mode}\n"
  },
  "hostWorld": {
    "en": "Practonaut is running: “{title}” (world {world}, task {task})\n",
    "de": "Practonaut läuft: „{title}“ (Welt {world}, Aufgabe {task})\n"
  },
  "hostLink": {
    "en": "Open: {url}\n",
    "de": "Öffnen: {url}\n"
  },
  "hostOpen": {
    "en": "The link works once and expires after 5 minutes. Type o and Enter for a new link; Ctrl+C stops the session.\nConnect an agent: {cli} mcp --host {origin} --token-file {path}\n",
    "de": "Der Link gilt einmal und läuft nach 5 Minuten ab. o und Enter erzeugt einen neuen Link; Ctrl+C beendet die Sitzung.\nAgent anbinden: {cli} mcp --host {origin} --token-file {path}\n"
  },
  "mirrorFallback": {
    "en": "practonaut: Chromium is not installed, so this session runs model-only: actions are not mirrored into the real Excalidraw and results are never practice evidence. Run {cli} setup once to enable the mirror.\n",
    "de": "practonaut: Chromium ist nicht installiert, daher läuft diese Sitzung nur im Modell: Aktionen werden nicht ins echte Excalidraw gespiegelt und Ergebnisse sind nie Übungsbelege. Einmal {cli} setup ausführen, um die Spiegelung einzuschalten.\n"
  },
  "openFailed": {
    "en": "practonaut: could not open a browser; open this link yourself: {url}\n",
    "de": "practonaut: Browser konnte nicht geöffnet werden; diesen Link selbst öffnen: {url}\n"
  },
  "openStarted": {
    "en": "practonaut: asked your browser to open the session. If no Practonaut page appears (some sandboxed browsers cannot read local files), open this link yourself: {url}\n",
    "de": "practonaut: Der Browser soll die Sitzung öffnen. Erscheint keine Practonaut-Seite (manche abgeschotteten Browser lesen keine lokalen Dateien), diesen Link selbst öffnen: {url}\n"
  },
  "linkBudget": {
    "en": "practonaut: no more links can be issued for this session; restart it.\n",
    "de": "practonaut: für diese Sitzung können keine weiteren Links erzeugt werden; neu starten.\n"
  },
  "closeFailed": {
    "en": "practonaut: the session could not be closed completely within its deadline.\n",
    "de": "practonaut: die Sitzung konnte innerhalb der Frist nicht vollständig beendet werden.\n"
  },
  "worldMissing": {
    "en": "world not found: {path}",
    "de": "Welt nicht gefunden: {path}"
  },
  "mirrorStartFallback": {
    "en": "practonaut: Chromium is installed but did not start ({detail}), so this session runs model-only: actions are not mirrored into the real Excalidraw and results are never practice evidence.\n{advice}",
    "de": "practonaut: Chromium ist installiert, startet aber nicht ({detail}), daher läuft diese Sitzung nur im Modell: Aktionen werden nicht ins echte Excalidraw gespiegelt und Ergebnisse sind nie Übungsbelege.\n{advice}"
  },
  "browserStartFailed": {
    "en": "Chromium is installed but did not start ({detail}), and this command needs the real Excalidraw mirror.\n{advice}Or use --mirror off for a model-only session.",
    "de": "Chromium ist installiert, startet aber nicht ({detail}), und dieser Befehl braucht die echte Excalidraw-Spiegelung.\n{advice}Oder --mirror off für eine reine Modellsitzung."
  },
  "browserAdviceLinux": {
    "en": "On Linux this is usually one of two causes. Missing system libraries: run npx playwright install --with-deps chromium (needs sudo). The Chromium sandbox: Ubuntu 23.10 and later restrict unprivileged user namespaces with AppArmor; see docs/getting-started.md, section \"Chromium does not start\". Check again with {cli} doctor --adapter.\n",
    "de": "Unter Linux liegt das meist an einer von zwei Ursachen. Fehlende Systembibliotheken: npx playwright install --with-deps chromium ausführen (braucht sudo). Die Chromium-Sandbox: Ubuntu ab 23.10 beschränkt unprivilegierte User-Namespaces mit AppArmor; siehe docs/getting-started.md, Abschnitt \"Chromium does not start\". Erneut prüfen mit {cli} doctor --adapter.\n"
  },
  "browserAdviceOther": {
    "en": "Run {cli} setup again to repair the download, then check with {cli} doctor --adapter.\n",
    "de": "{cli} setup erneut ausführen, um den Download zu reparieren, dann mit {cli} doctor --adapter prüfen.\n"
  },
  "chromiumStartName": {
    "en": "chromium start",
    "de": "Chromium-Start"
  },
  "chromiumStarts": {
    "en": "starts (headless, sandbox on)",
    "de": "Startet (headless, Sandbox an)"
  },
  "chromiumStartsUnsandboxed": {
    "en": "starts (headless, sandbox off: this Linux system does not allow Chromium's sandbox; set PRACTONAUT_CHROMIUM_SANDBOX=require to refuse instead)",
    "de": "Startet (headless, Sandbox aus: dieses Linux erlaubt die Chromium-Sandbox nicht; PRACTONAUT_CHROMIUM_SANDBOX=require verweigert den Start stattdessen)"
  },
  "sandboxFallbackNotice": {
    "en": "practonaut: Chromium runs without its sandbox because this Linux system does not allow it (unprivileged user namespaces, AppArmor); the mirror only loads the bundled Excalidraw. Set PRACTONAUT_CHROMIUM_SANDBOX=require to refuse instead.\n",
    "de": "practonaut: Chromium läuft ohne Sandbox, weil dieses Linux sie nicht erlaubt (unprivilegierte User-Namespaces, AppArmor); die Spiegelung lädt nur das mitgelieferte Excalidraw. PRACTONAUT_CHROMIUM_SANDBOX=require verweigert den Start stattdessen.\n"
  },
  "chromiumStartFails": {
    "en": "installed but does not start: {detail}",
    "de": "Installiert, startet aber nicht: {detail}"
  },
  "unexpectedFailure": {
    "en": "unexpected failure: {detail}",
    "de": "unerwarteter Fehler: {detail}"
  },
  "modelOnly": {
    "en": "model-only (never practice evidence)",
    "de": "model-only (kein Übungsbeleg)"
  },
  "exit": {
    "en": "exit {status}",
    "de": "Exit {status}"
  },
  "chromiumPresent": {
    "en": "present (real Excalidraw mirror available)",
    "de": "Vorhanden (echte Excalidraw-Spiegelung verfügbar)"
  },
  "chromiumAbsent": {
    "en": "not installed: practice runs model-only (run {cli} setup; explicit download)",
    "de": "Nicht installiert: Übung läuft nur im Modell ({cli} setup ausführen; ausdrücklicher Download)"
  },
  "browserRuntimeMissing": {
    "en": "Chromium is not installed, but this command needs the real Excalidraw mirror. Run {cli} setup once (an explicit download), then retry, or use --mirror off for a model-only session.",
    "de": "Chromium ist nicht installiert, dieser Befehl braucht aber die echte Excalidraw-Spiegelung. Einmal {cli} setup ausführen (ausdrücklicher Download) und erneut versuchen, oder --mirror off für eine reine Modellsitzung."
  },
  "playwrightAbsent": {
    "en": "playwright-core not installed",
    "de": "playwright-core nicht installiert"
  },
  "nodeRequired": {
    "en": "{version} (need >= {minimum})",
    "de": "{version} (benötigt >= {minimum})"
  },
  "notFound": {
    "en": "not found ({detail})",
    "de": "Nicht gefunden ({detail})"
  },
  "gitleaksAbsent": {
    "en": "not found ({detail}); optional, the pre-commit hook then skips the secret scan",
    "de": "Nicht gefunden ({detail}); optional, der Pre-Commit-Hook überspringt dann den Secret-Scan"
  },
  "dockerServer": {
    "en": "server {version}",
    "de": "Server {version}"
  },
  "dockerOptional": {
    "en": "not available (optional; current tests do not use Docker)",
    "de": "Nicht verfügbar (optional; aktuelle Tests verwenden Docker nicht)"
  },
  "doctorPassed": {
    "en": "doctor: all required checks passed",
    "de": "doctor: Alle Pflichtprüfungen bestanden"
  },
  "doctorFailed": {
    "en": "doctor: {count} required {count:check|checks} failed",
    "de": "doctor: {count} {count:Pflichtprüfung|Pflichtprüfungen} fehlgeschlagen"
  },
  "chromiumName": {
    "en": "playwright chromium (cache)",
    "de": "Playwright-Chromium (Cache)"
  },
  "dockerName": {
    "en": "docker (optional)",
    "de": "Docker (optional)"
  },
  "gitleaksName": {
    "en": "gitleaks (optional)",
    "de": "gitleaks (optional)"
  },
  "checkFail": {
    "en": "FAIL",
    "de": "FEHLER"
  },
  "checkWarn": {
    "en": "warn",
    "de": "WARNUNG"
  },
  "checkOk": {
    "en": "ok",
    "de": "ok"
  }
} as const;
export type CliLanguage = 'en' | 'de';
let language: CliLanguage = 'en';
export function setCliLanguage(value: CliLanguage): void { language = value; }
export function getCliLanguage(): CliLanguage { return language; }
/** Plural form for a count in the CLI language (`one` or `other`, Intl.PluralRules). */
export function pluralForm(count: number, one: string, other: string, lang: CliLanguage = language): string {
  return new Intl.PluralRules(lang).select(count) === 'one' ? one : other;
}
/** `{name}` inserts a value; `{name:one|other}` inserts the word form for the count in `name`. */
export function cliText(key: keyof typeof CLI_CATALOG, values: Record<string, string | number> = {}): string {
  // `{cli}` is how the user started the CLI (`practonaut` or `npx practonaut`), so suggestions can be pasted back.
  values = Object.hasOwn(values, 'cli') ? values : { ...values, cli: invocationName() };
  return CLI_CATALOG[key][language].replace(/\{([A-Za-z]+)(?::([^{}|]*)\|([^{}]*))?\}/g, (_match, name: string, one: string | undefined, other: string | undefined) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing CLI catalog parameter: ${key}.${name}`);
    if (one === undefined) return String(values[name]);
    const count = Number(values[name]);
    if (!Number.isFinite(count)) throw new Error(`Plural parameter is not a number: ${key}.${name}`);
    return pluralForm(count, one, other!);
  });
}
