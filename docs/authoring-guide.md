# Create your own task

There are two ways to make a task. Both end with a world that a person or any MCP agent can
practise and that the independent checker can score.

| Way | You provide | Good for |
|---|---|---|
| **Two drawings** | a start and a goal drawing | most diagram edits: add, remove, rename, restyle, group, frame, connect |
| **Demonstration** | you perform the change in the real editor, twice | teaching a behaviour from observed evidence (bounded: one repair workflow) |

## 1. From two drawings

Draw the start in Excalidraw, save it as `start.excalidraw`; change the drawing into the goal and
save it as `goal.excalidraw`. Then:

```bash
npx practonaut tasks from-scenes start.excalidraw goal.excalidraw --out my-task
npx practonaut play my-task/world        # practise it
npx practonaut mcp --task my-task/world  # or hand it to an agent
```

The same works in the Player: **Create → Or: draw start and goal**. Draw in the embedded editor,
take the drawing as start, change it, take it as goal, then **Create exercise** and **Open my
exercise**. Nothing is recorded on this path.

What becomes the goal is the difference between the drawings: counts of steps and arrows, labels,
shapes, palette colours, frames, groups, arrows identified by the labels at their ends, and the size
(± tolerance) of every step the solution resizes. Without `--task`, world and task are named after
the `--out` folder. The default prompt says what to change ("Fill “Ship” green.", "Resize “Done” to
260 × 120."); a move is only asked for when `--layout` or `--align` checks it.

Limits: at most 200 steps, 400 arrows and 40 frames per drawing (`scene_too_large`); a goal with
more conditions than the checker can evaluate within its budget is refused as `goal_too_complex`
(many distinct steps joined by arrows reach this first); the derivation runs in a worker and stops
after 60 s (`from_scenes_timeout`). `--out` never writes through a symbolic link or junction in the
output folder, its `world` folder or a target file.
Options:

| Option | Effect |
|---|---|
| `--layout relative` | also require the left-to-right order of the steps |
| `--align` | keep aligned rows and columns, within `--tolerance` pixels (default 8) |
| `--task <id>` | task id in the generated world |
| `--force` | overwrite an existing output directory |

Before anything is written, Practonaut checks the result with the independent checker: the goal
drawing must pass, the start must fail, a generated reference solution must pass and generated near
misses must fail. If any of these fails, no task is written and the error says why (for example
`start_accepted`, `goal_not_accepted`, or `oracle_unavailable` when the goal needs an operation the
model does not have yet, such as creating a frame or leaving a loose arrow end).

Output: `my-task/world/world.json` (a `practonaut.world/2` world, see [world format](world-format.md))
and `my-task/oracle.json` beside it (reference solution and near misses; never shown to agents).
Drawing elements the model does not cover (for example images) are reported as ignored.

**Bench it.** Score any MCP agent on your task, with the oracle as its reference
([benchmarks](benchmarks/README.md)):

```bash
npx practonaut bench --agent oracle --world my-task/world --oracle my-task/oracle.json      # solvable through MCP?
npx practonaut bench --agent claude-code --world my-task/world --oracle my-task/oracle.json --repeats 3
npx practonaut report ~/.practonaut/bench/<id>/report.json --verify
```

A task from two drawings has one variant: every seed shows the same board. Run it more often with
`--repeats`, not with more seeds, which would count the same board as several instances (`bench` says
so on stderr, `seeds_share_variant`).

Before any run the checker must accept the oracle for every seed (`bench_oracle_invalid` otherwise);
it never reaches the agent, and the report's efficiency compares each run with its length. Without
`--oracle` a task is benched with "no reference". The bench folder stores the world and the
reference, so `report --verify` re-judges it anywhere, also after `my-task/` was edited or deleted.
Keep `oracle.json` beside the world folder, not inside it: a world folder packs only `world.json`
and allowed assets, and `bench` refuses anything else in it.

The bundled library in `tasks/excalidraw/` is built exactly this way: each task is a folder with
`start.excalidraw`, `goal.excalidraw` and a `task.json` (title and prompt in EN/DE, difficulty,
options, two label variants). After editing one, run `npm run library:write`;
[tasks/excalidraw/README.md](../tasks/excalidraw/README.md) has the details.

## 2. By demonstration

The **Create** view guides you through six steps. Exactly one step is open at a time; finished
steps keep a summary and stay editable.

1. **Plan.** Name the project and the three steps of a process. The before/goal drawing updates
   as you type; the starting scene is prepared from your labels.
2. **Record.** Choose who demonstrates (a person or a program) and release the recording under
   CC0. Start, then in the real editor remove the middle step, reconnect the arrow to the last
   step and remove the spare arrow. Stop with **Stop and review**.
3. **Review.** Each recorded change is shown as a before/after drawing. Derive rules from it.
4. **Confirm.** **Record confirmation** reloads the start and records again. A rule needs this
   second, separate recording: a proposal never confirms itself.
5. **Goal.** Titles (EN/DE), the step to remove, variants with different step names (**Suggest
   names** fills them from a small built-in list) and the examples: two valid results and a near
   miss. Accept the examples after looking at them. Save the project.
6. **Finish.** Check and create the exercise, then open it.

Compilation runs every solution for every variant through a fresh session and the independent
checker. Normal authoring needs no JSON, ids or gesture indices; technical details are under
**Technical authoring details**.

This path covers one bounded workflow: removing the middle step of a three-step process and
reconnecting the rest. It is not general task induction.

### How rules are learned

Recording starts only when you press Start, after the editor's local fonts are ready. Changes
are grouped into gestures at pointer release, a key boundary, 120 ms of quiet, or stop
(`excalidraw-gesture-v1`). Each gesture is compared, as a complete before/after state, against a
closed set of rule templates: create, rename and move a step; create, rewire and remove an
arrow; delete a step. Changes outside the model are kept visible as `unmodeled` and are never
evidence.

When one demonstration cannot tell two explanations apart (deleting an unconnected step does not
show what happens to attached arrows), both stay proposed and Practonaut asks for a new
demonstration that separates them. Evidence references name the recording, the gesture index and
a SHA-256 of the gesture; a source changed after confirmation makes compilation fail. Free-text
notes have no evidence weight.

Authoring works without a language model. An optional provider interface exists but no provider
is configured; model output could only ever become a hypothesis, never a rule.

## 3. Saved projects and local data

| What | Where (inside `~/.practonaut` or `PRACTONAUT_HOME`) |
|---|---|
| Recordings | `recordings/` |
| Named author projects | `projects/` |
| Exercises compiled from the Player | `author/` |

Save the project before closing the browser; unsaved drafts do not survive a restart. After a
restart, open the new link and pick the project under **Saved projects**. Opening re-checks every
source recording; a missing or changed source blocks restoring and compiling. A damaged entry is
shown as unavailable while other projects stay usable; removing it is an explicit action.

```bash
practonaut record list
practonaut record review <id>
practonaut record delete <id>      # refused while a saved project still uses it
practonaut compile project.author.json --out my-world.pnworld [--checker my-world.pncheck]
```

Deleting a recording also removes the compiled exercises built from it in `author/`. Copies you
exported elsewhere must be removed separately. Recordings never leave your machine.

## 4. The author project format (advanced)

`practonaut.author/1` holds the initial state, hypotheses, questions, recording identities,
public tasks, finite variants and notes. Each public task has `solutions` keyed by variant id
(modeled actions) and `checkerFixtures`: an alternative valid state and a near miss, both
specified independently of the solution. Held-out tasks live in `heldOutTasks` with their
solutions in `heldOutSolutions`; their contents go only into the separate `.pncheck` bundle.

`practonaut compile` validates the project, rereads every source recording, requires CC0 rights,
explicit consent, an author and pinned app/adapter provenance, and admits only confirmed rules.
Hypotheses, questions, notes, solutions and fixtures never enter the `.pnworld`. Every solution is
run through a fresh session and the checker, including empty, unchanged-start and wrong-artifact
counter-probes; a missing or failing solution is `variant_unsolved`. The output archives are
deterministic.

## 5. Limits

- One application: Excalidraw 0.18.1. The demonstration path covers one repair workflow; the
  two-drawing path covers the operations listed in section 1.
- The native Excalidraw canvas needs a pointer; the Practice board is the keyboard path.
- Only the bundled Cascadia font (family 3) is supported in recorded workflows.
- Whether practising a task improves a person's skill in the real tool has not been studied.
