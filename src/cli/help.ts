// Help texts for `practonaut --help` and `practonaut <command> --help` (English and German).
import type { CliLanguage } from './messages.ts';

type Text = Record<CliLanguage, string>;

const EXIT: Text = {
  en: `Exit codes:
  0  success
  1  usage error (bad command, option or path; validate needs a regular file)
  2  package or source rejected (named code), failed check, rejected bench report, incomparable reports
     or (compare --fail-on-regression) an instance regression
  3  environment missing (for example Chromium for --mirror required) or session shutdown failure`,
  de: `Exit-Codes:
  0  Erfolg
  1  Bedienfehler (unbekannter Befehl, Option oder Pfad; validate braucht eine reguläre Datei)
  2  Paket oder Quelle abgelehnt (benannter Code), nicht bestandene Prüfung, abgelehnter Bench-Bericht,
     nicht vergleichbare Berichte oder (compare --fail-on-regression) eine Instanz-Regression
  3  Umgebung fehlt (etwa Chromium für --mirror required) oder Sitzung nicht sauber beendet`,
};

const TOP: Text = {
  en: `practonaut - a local practice gym for AI agents on real apps

Usage:
  practonaut                      start the bundled example world (same as: practonaut play)
  practonaut [--lang en|de] <command> [options]
  practonaut <command> --help     help for one command
  practonaut --version

Practice:
  play [world|task]  start a practice session and open it in your browser
  tasks list|show    the bundled Excalidraw task library (play <task-id> opens one)
  serve [world]      same as play; for scripts use --no-open
  mcp --task <task>  MCP server (stdio) with its own session, for any MCP agent
  bench --agent <a>  score an agent on the task library or your own world (independent checker)
  report <file>      show a bench report as a table or a static HTML page
  compare <a> <b>    compare two bench reports instance by instance (instance regressions, McNemar)
  setup              download Chromium once for the real Excalidraw mirror
  doctor             check the environment

Worlds and results:
  validate <package>        validate a world package
  pack <source-dir>         pack a world source directory into a .pnworld
  run <world.pnworld>       replay an action log headlessly
  check <export|state>      independent end-state check
  tasks from-scenes <start> <goal> --out <dir>   make a task from two Excalidraw drawings
  record list|review|delete manage local author recordings
  compile <project.json>    compile an author project into a world

Errors are printed as text; add --json for machine-readable output.
Local data lives in ~/.practonaut (override with PRACTONAUT_HOME).

${EXIT.en}`,
  de: `practonaut – ein lokales Übungsgelände für KI-Agenten an echten Apps

Verwendung:
  practonaut                      startet die mitgelieferte Beispielwelt (wie: practonaut play)
  practonaut [--lang en|de] <Befehl> [Optionen]
  practonaut <Befehl> --help      Hilfe zu einem Befehl
  practonaut --version

Üben:
  play [Welt|Aufgabe] Übungssitzung starten und im Browser öffnen
  tasks list|show    die mitgelieferte Excalidraw-Aufgabenbibliothek (play <Aufgaben-ID> öffnet eine)
  serve [Welt]       wie play; für Skripte --no-open verwenden
  mcp --task <Aufg.> MCP-Server (stdio) mit eigener Sitzung, für jeden MCP-Agenten
  bench --agent <a>  Agenten an der Aufgabenbibliothek oder eigener Welt bewerten (unabhängiger Prüfer)
  report <Datei>     Bench-Bericht als Tabelle oder statische HTML-Seite zeigen
  compare <a> <b>    zwei Bench-Berichte Instanz für Instanz vergleichen (Instanz-Regressionen, McNemar)
  setup              Chromium einmalig für die echte Excalidraw-Spiegelung laden
  doctor             Umgebung prüfen

Welten und Ergebnisse:
  validate <Paket>          Weltpaket prüfen
  pack <Quellverzeichnis>   Weltquelle zu einer .pnworld packen
  run <welt.pnworld>        Aktionsprotokoll ohne Oberfläche abspielen
  check <Export|Zustand>    unabhängige Endzustandsprüfung
  tasks from-scenes <Start> <Ziel> --out <Verz.>   Aufgabe aus zwei Excalidraw-Zeichnungen erzeugen
  record list|review|delete lokale Autorenaufnahmen verwalten
  compile <project.json>    Autorenprojekt zu einer Welt kompilieren

Fehler erscheinen als Text; --json liefert maschinenlesbare Ausgabe.
Lokale Daten liegen in ~/.practonaut (änderbar mit PRACTONAUT_HOME).

${EXIT.de}`,
};

const SERVE: Text = {
  en: `Usage: practonaut play|serve [world-dir|world.pnworld|task-id] [options]

Starts a local practice session on 127.0.0.1 and opens it in your default browser.
Without a world, the bundled flow-diagram example starts. A task id from \`practonaut tasks list\`
opens the bundled task library on that task (an existing path of the same name wins).

Options:
  --task <id>                   task to start with (default: the world's first task)
  --seed <n>                    variant seed (default 42)
  --mirror auto|required|off    real Excalidraw mirror: auto (default) mirrors when Chromium is
                                installed and otherwise runs model-only with a warning; required
                                fails without Chromium; off is model-only (never practice evidence)
  --no-open                     print the link without opening a browser
  --require-offline             refuse to start when outbound network probes succeed

The printed link works once and expires after 5 minutes. Type o and Enter for a new link.
Ctrl+C stops the session. Exports are normal browser downloads.`,
  de: `Verwendung: practonaut play|serve [Weltverzeichnis|welt.pnworld|Aufgaben-ID] [Optionen]

Startet eine lokale Übungssitzung auf 127.0.0.1 und öffnet sie im Standardbrowser.
Ohne Welt startet das mitgelieferte Ablaufdiagramm-Beispiel. Eine Aufgaben-ID aus \`practonaut tasks list\`
öffnet die mitgelieferte Aufgabenbibliothek mit dieser Aufgabe (ein gleichnamiger Pfad hat Vorrang).

Optionen:
  --task <id>                   Startaufgabe (Standard: erste Aufgabe der Welt)
  --seed <n>                    Varianten-Seed (Standard 42)
  --mirror auto|required|off    echte Excalidraw-Spiegelung: auto (Standard) spiegelt, wenn Chromium
                                installiert ist, sonst nur Modell mit Warnung; required scheitert
                                ohne Chromium; off ist nur Modell (nie ein Übungsbeleg)
  --no-open                     Link ausgeben, ohne einen Browser zu öffnen
  --require-offline             Start verweigern, wenn ausgehende Netzproben gelingen

Der ausgegebene Link gilt einmal und läuft nach 5 Minuten ab. o und Enter erzeugt einen neuen Link.
Ctrl+C beendet die Sitzung. Exporte sind normale Browser-Downloads.`,
};

const TASKS: Text = {
  en: `Usage: practonaut tasks list [--json]
       practonaut tasks show <task-id> [--oracle] [--json]
       practonaut tasks from-scenes <start.excalidraw> <goal.excalidraw> --out <dir>
                                    [--task <id>] [--layout relative] [--align] [--tolerance <px>]
                                    [--force] [--json]

list and show describe the bundled Excalidraw task library; --oracle adds the reference solution.
from-scenes turns two drawings into a task: the difference becomes the goal (counts, labels, shapes,
colours, frames, groups and arrows by their end labels; --layout relative adds left-to-right order,
--align keeps aligned rows and columns within --tolerance, default 8 px), with error classes, a
reference solution and near misses. It writes <dir>/world/world.json (practise it with
practonaut play <dir>/world) and <dir>/oracle.json beside it. The goal scene must pass the
independent checker and the start scene must fail, or nothing is written.`,
  de: `Verwendung: practonaut tasks list [--json]
            practonaut tasks show <Aufgaben-ID> [--oracle] [--json]
            practonaut tasks from-scenes <start.excalidraw> <ziel.excalidraw> --out <Verzeichnis>
                                         [--task <id>] [--layout relative] [--align] [--tolerance <px>]
                                         [--force] [--json]

list und show beschreiben die mitgelieferte Excalidraw-Aufgabenbibliothek; --oracle zeigt die Referenzlösung.
from-scenes macht aus zwei Zeichnungen eine Aufgabe: Der Unterschied wird zum Ziel (Anzahlen, Beschriftungen,
Formen, Farben, Rahmen, Gruppen und Pfeile über die Beschriftungen ihrer Enden; --layout relative ergänzt die
Reihenfolge von links nach rechts, --align hält ausgerichtete Zeilen und Spalten innerhalb von --tolerance,
Standard 8 px), mit Fehlerklassen, Referenzlösung und Beinahe-Treffern. Es schreibt <Verzeichnis>/world/world.json
(üben mit practonaut play <Verzeichnis>/world) und daneben <Verzeichnis>/oracle.json. Die Zielszene muss den
unabhängigen Prüfer bestehen und die Startszene muss durchfallen, sonst wird nichts geschrieben.`,
};

const COMMANDS: Record<string, Text> = {
  tasks: TASKS,
  play: SERVE,
  serve: SERVE,
  mcp: {
    en: `Usage: practonaut mcp --task <task|world> [--task-id <id>] [--seed <n>] [--mirror auto|required|off] [--open]
       practonaut mcp --host <http://127.0.0.1:port> --token-file <path>
       either form: [--call-log <file>]

With --task, starts its own session (a library task such as excalidraw/connect, or a world path) and
serves it over stdio until the client closes. The real Excalidraw mirror runs when Chromium is installed
(--mirror auto). A one-use link to watch the session in your browser is printed on stderr; --open opens it.
  claude mcp add practonaut -- npx -y practonaut mcp --task excalidraw/connect
With --host and --token-file (both printed by play/serve), attaches to a running session that a person
can use at the same time. stdout carries JSON-RPC only. --call-log <file> appends one JSON line per tool call
(request id, tool, result code, result bytes, bridge time) for measurements; bench uses it for each run.
Tools: observe, list_actions, act, undo, reset, explain_result, check_result; resource practonaut://task; prompt practise.`,
    de: `Verwendung: practonaut mcp --task <Aufgabe|Welt> [--task-id <id>] [--seed <n>] [--mirror auto|required|off] [--open]
            practonaut mcp --host <http://127.0.0.1:port> --token-file <Pfad>
            beide Formen: [--call-log <Datei>]

Mit --task startet eine eigene Sitzung (eine Bibliotheksaufgabe wie excalidraw/connect oder ein Weltpfad), die
über stdio bedient wird, bis der Client schließt. Die echte Excalidraw-Spiegelung läuft, wenn Chromium installiert
ist (--mirror auto). Ein Link zum Mitsehen im Browser (gilt einmal) steht auf stderr; --open öffnet ihn.
  claude mcp add practonaut -- npx -y practonaut mcp --task excalidraw/connect
Mit --host und --token-file (beide gibt play/serve aus) bindet an eine laufende Sitzung an, die ein Mensch
gleichzeitig nutzen kann. stdout trägt nur JSON-RPC. --call-log <Datei> hängt je Werkzeugaufruf eine JSON-Zeile an
(Anfrage-ID, Werkzeug, Ergebniscode, Ergebnisbytes, Bridge-Zeit), für Messungen; bench nutzt es für jeden Lauf.
Werkzeuge: observe, list_actions, act, undo, reset, explain_result, check_result; Ressource practonaut://task; Prompt practise.`,
  },
  bench: {
    en: `Usage: practonaut bench --agent <oracle|random|claude-code|"command … {mcp_config} …">
                        [--world <dir|.pnworld>] [--tasks all|<id,id,…>] [--oracle <file,…>]
                        [--seeds <n> | --seed-list <seed,seed,…>] [--repeats <k>] [--timeout <seconds>]
                        [--max-actions <n>] [--mirror auto|required|off] [--out <report.json>]
                        [--keep-env <name,…>] [--label <text>]

Runs every task × seed × repeat in its own session and its own run folder. The agent
reaches the session only through MCP; a command template gets {mcp_config} (path of a generated MCP
configuration) and {prompt}, and is started without a shell (the prompt is also on stdin). oracle plays the
reference solution, random acts at random; neither uses a language model. Scoring uses only the host's
history and a separate checker after the agent stops. Defaults: the task library, all tasks, seeds 1…n with
--seeds (1), 1 repeat, 300 s, 50 actions.
--world benches your own world (for example one made with tasks from-scenes); --oracle gives a task's
reference solution (the oracle.json beside the world), which the checker must pass before any run and which
never reaches the agent. Without a reference a task has no efficiency. The world and the references are
stored in the bench folder, so report --verify can re-judge it anywhere.
The claude-code preset gets no provider keys, tokens or billing switches (*_API_KEY, *_AUTH_TOKEN,
CLAUDE_CODE_USE_*, …) from your environment, so Claude Code uses the login it has; --keep-env passes named ones on.
Ctrl+C stops after the running agent and writes a partial report; a second Ctrl+C stops at once.
Writes practonaut.bench/2 (schemas/bench.v2.json); see docs/benchmarks/README.md.`,
    de: `Verwendung: practonaut bench --agent <oracle|random|claude-code|"Befehl … {mcp_config} …">
                        [--world <Ordner|.pnworld>] [--tasks all|<id,id,…>] [--oracle <Datei,…>]
                        [--seeds <n> | --seed-list <Seed,Seed,…>] [--repeats <k>] [--timeout <Sekunden>]
                        [--max-actions <n>] [--mirror auto|required|off] [--out <bericht.json>]
                        [--keep-env <Name,…>] [--label <Text>]

Fährt jede Aufgabe × Seed × Wiederholung in eigener Sitzung und eigenem Laufordner. Der
Agent erreicht die Sitzung nur über MCP; eine Befehlsvorlage bekommt {mcp_config} (Pfad einer erzeugten
MCP-Konfiguration) und {prompt} und startet ohne Shell (der Prompt kommt auch über stdin). oracle spielt die
Referenzlösung, random handelt zufällig; beide ohne Sprachmodell. Bewertet wird nur aus der Host-Historie und
mit einem getrennten Prüfer nach dem Ende des Agenten. Standard: die Aufgabenbibliothek, alle Aufgaben, mit
--seeds die Seeds 1…n (1), 1 Wiederholung, 300 s, 50 Aktionen.
--world bewertet Ihre eigene Welt (zum Beispiel eine aus tasks from-scenes); --oracle gibt die Referenzlösung
einer Aufgabe (die oracle.json neben der Welt), die der Prüfer vor jedem Lauf bestätigen muss und die den Agenten
nie erreicht. Ohne Referenz hat eine Aufgabe keine Effizienz. Welt und Referenzen werden im Bench-Ordner
gespeichert, sodass report --verify ihn überall neu beurteilen kann.
Die Voreinstellung claude-code bekommt keine Anbieterschlüssel, -token oder Abrechnungsschalter
(*_API_KEY, *_AUTH_TOKEN, CLAUDE_CODE_USE_*, …) aus Ihrer Umgebung; Claude Code nutzt so seine eigene Anmeldung.
--keep-env gibt genannte weiter.
Strg+C beendet nach dem laufenden Agenten mit Teilbericht; ein zweites Strg+C beendet sofort.
Schreibt practonaut.bench/2 (schemas/bench.v2.json); siehe docs/benchmarks/README.md.`,
  },
  report: {
    en: `Usage: practonaut report <bench.json> [--verify] [--runs <dir>] [--html <out.html>] [--json]

Checks a bench report (practonaut.bench/2 or /1) for consistency (every pass and aggregate is re-derived from
the verdicts in the file; a report that does not add up is rejected with exit 2) and prints a table, or writes
a static HTML page. Consistency is not proof: a consistently edited file passes. Rates are fractions with a
95 % interval; failures come first with why they failed, read from the bench folder (default: the report's
folder; else --runs <bench folder>): the unmet conditions and the action after which each was last lost,
error classes, the trajectory, the final board and the call log. --verify re-judges every run from the
artifacts in that folder: for /2 the stored world and references and every artifact and log against the hashes
the report binds, every reference against the stored world, the independent checker on the session and the
native export, and the condition trace; a /1 report is re-judged against the bundled task library. Any
difference: exit 2, with bench_world_changed, bench_artifact_changed, bench_reference_invalid or
bench_report_invalid.`,
    de: `Verwendung: practonaut report <bench.json> [--verify] [--runs <Ordner>] [--html <out.html>] [--json]

Prüft einen Bench-Bericht (practonaut.bench/2 oder /1) auf Stimmigkeit (jedes Bestehen und jede Kennzahl wird
aus den Urteilen in der Datei neu abgeleitet; ein Bericht, der nicht aufgeht, wird mit Exit 2 abgelehnt) und zeigt
eine Tabelle oder schreibt eine statische HTML-Seite. Stimmigkeit ist kein Beweis: Eine stimmig bearbeitete Datei
besteht. Raten stehen als Brüche mit 95-%-Intervall; nicht bestandene Läufe kommen zuerst, mit dem Grund aus dem
Bench-Ordner (Standard: Ordner des Berichts, sonst --runs <Bench-Ordner>): die nicht erfüllten Bedingungen und
die Aktion, nach der jede zuletzt verloren ging, Fehlerklassen, der Verlauf, die Zeichnung am Ende und das
Aufrufprotokoll. --verify beurteilt jeden Lauf aus den Artefakten dieses Ordners neu: bei /2 gespeicherte Welt,
Referenzen und jedes Artefakt und Protokoll gegen die gebundenen Hashes, jede Referenz gegen die gespeicherte
Welt, der unabhängige Prüfer auf Sitzung und nativem Export und der Bedingungsverlauf; ein /1-Bericht wird gegen
die mitgelieferte Aufgabenbibliothek nachgerechnet. Jede Abweichung: Exit 2, mit bench_world_changed,
bench_artifact_changed, bench_reference_invalid oder bench_report_invalid.`,
  },
  compare: {
    en: `Usage: practonaut compare <baseline.json> <candidate.json> [--html <out.html>] [--fail-on-regression]
                          [--verify] [--json]

Compares two bench reports by the rules of PADR-0039. They must agree on the world content, the grid of tasks
and seeds, the mirror, the action budget and the isolation level; otherwise compare refuses with exit 2
(compare_incomparable) and names every difference. The unit is the instance (task × seed): judged repeats give
one outcome per side (a pass when at least half passed). An instance regression has at least three judged
repeats on each side, all passed on the baseline and all failed on the candidate; with fewer repeats a flip is
listed as a single run, never a regression. The rate verdict uses an exact McNemar test on the instances the
two disagree on: improvement or decline at p < 0.05, otherwise "not distinguishable at this n".
--fail-on-regression exits 2 (instance_regression) when there is an instance regression. --verify re-verifies
each report from its own folder first. --html writes a static page.`,
    de: `Verwendung: practonaut compare <basis.json> <kandidat.json> [--html <out.html>] [--fail-on-regression]
                          [--verify] [--json]

Vergleicht zwei Bench-Berichte nach den Regeln von PADR-0039. Sie müssen im Inhalt der Welt, im Raster aus
Aufgaben und Seeds, in der Spiegelung, im Aktionsbudget und in der Isolationsstufe übereinstimmen; sonst lehnt
compare mit Exit 2 ab (compare_incomparable) und nennt jeden Unterschied. Einheit ist die Instanz (Aufgabe × Seed):
bewertete Wiederholungen ergeben je Seite ein Ergebnis (bestanden, wenn mindestens die Hälfte bestand). Eine
Instanz-Regression hat auf jeder Seite mindestens drei bewertete Wiederholungen, alle bestanden bei der Basis und
alle nicht bestanden beim Kandidaten; mit weniger Wiederholungen ist ein Wechsel ein Einzellauf, nie eine
Regression. Das Urteil über Raten nutzt einen exakten McNemar-Test auf den Instanzen, in denen sich beide
unterscheiden: Verbesserung oder Verschlechterung bei p < 0,05, sonst „bei diesem n nicht unterscheidbar“.
--fail-on-regression endet mit Exit 2 (instance_regression), wenn es eine Instanz-Regression gibt. --verify
rechnet jeden Bericht zuerst aus seinem eigenen Ordner nach. --html schreibt eine statische Seite.`,
  },
  setup: {
    en: `Usage: practonaut setup

Downloads the pinned Playwright Chromium once (or reuses its cache). Without it, practice runs model-only.
Installing Practonaut never downloads a browser by itself.`,
    de: `Verwendung: practonaut setup

Lädt das gepinnte Playwright-Chromium einmalig (oder nutzt den Cache). Ohne Chromium läuft Übung nur im Modell.
Die Installation von Practonaut lädt nie selbst einen Browser.`,
  },
  doctor: {
    en: `Usage: practonaut doctor [--adapter] [--dev] [--json]

Checks Node and Chromium. --adapter makes Chromium required (real mirror, run, adapter tests);
--dev adds the repository tool chain (npm, git, optional gitleaks and Docker).`,
    de: `Verwendung: practonaut doctor [--adapter] [--dev] [--json]

Prüft Node und Chromium. --adapter macht Chromium zur Pflicht (echte Spiegelung, run, Adaptertests);
--dev ergänzt die Werkzeuge des Repositorys (npm, git, optional gitleaks und Docker).`,
  },
  validate: {
    en: `Usage: practonaut validate <package.pnworld> [--json]

Validates archive structure, names, sizes, manifest, hashes and media types, then world semantics,
provenance and rights. Nothing is extracted to disk.`,
    de: `Verwendung: practonaut validate <paket.pnworld> [--json]

Prüft Archivstruktur, Namen, Größen, Manifest, Hashes und Medientypen, danach Weltsemantik,
Herkunft und Rechte. Nichts wird auf die Platte entpackt.`,
  },
  pack: {
    en: `Usage: practonaut pack <source-dir> --out <world.pnworld> [--json]

Packs a world source directory (world.json + assets/) into a deterministic package and validates it.`,
    de: `Verwendung: practonaut pack <Quellverzeichnis> --out <welt.pnworld> [--json]

Packt ein Weltquellverzeichnis (world.json + assets/) deterministisch und prüft das Ergebnis.`,
  },
  run: {
    en: `Usage: practonaut run <world.pnworld> --seed <n> --actions <log.json> [--task <id>]
                      [--state-out <state.json>] [--export <prefix>] [--mirror required|off]

Replays an action log through the core and (default) the real Excalidraw mirror; prints JSON.`,
    de: `Verwendung: practonaut run <welt.pnworld> --seed <n> --actions <log.json> [--task <id>]
                      [--state-out <state.json>] [--export <Präfix>] [--mirror required|off]

Spielt ein Aktionsprotokoll durch den Kern und (Standard) die echte Excalidraw-Spiegelung; Ausgabe JSON.`,
  },
  check: {
    en: `Usage: practonaut check <export|state> --world <world.pnworld> [--bundle <bundle.pncheck>]
                        [--seed <n>] [--task <id>] [--pair <practonaut-session.json>]

Independent end-state check in a separate process. --pair binds a native export to its session export.`,
    de: `Verwendung: practonaut check <Export|Zustand> --world <welt.pnworld> [--bundle <bundle.pncheck>]
                        [--seed <n>] [--task <id>] [--pair <practonaut-session.json>]

Unabhängige Endzustandsprüfung in einem eigenen Prozess. --pair bindet einen nativen Export an seinen Sitzungsexport.`,
  },
  record: {
    en: `Usage: practonaut record list | review <id> | delete <id>

Manages author recordings in ~/.practonaut/recordings (PRACTONAUT_HOME).`,
    de: `Verwendung: practonaut record list | review <id> | delete <id>

Verwaltet Autorenaufnahmen in ~/.practonaut/recordings (PRACTONAUT_HOME).`,
  },
  compile: {
    en: `Usage: practonaut compile <project.json> --out <world.pnworld> [--checker <bundle.pncheck>]
                          [--recordings-root <directory>]`,
    de: `Verwendung: practonaut compile <project.json> --out <welt.pnworld> [--checker <bundle.pncheck>]
                          [--recordings-root <Verzeichnis>]`,
  },
};

export function topHelp(language: CliLanguage): string { return TOP[language]; }
export function commandHelp(command: string, language: CliLanguage): string | undefined {
  return Object.hasOwn(COMMANDS, command) ? COMMANDS[command]![language] : undefined;
}
export const HELP_COMMANDS: readonly string[] = Object.freeze(Object.keys(COMMANDS));
