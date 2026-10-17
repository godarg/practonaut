# Manual accessibility checks

Automated tests scan the Player with axe-core, keyboard scripts, reflow at 320 px and reduced
motion (`npm run test:a11y`). They cannot tell whether a screen reader user can actually do a task.
That needs a person. One run has been done so far (see [Runs](#runs)); reports from other screen
readers, browsers and from regular screen-reader users are very welcome (open an issue with your
findings).

## Setup (about 30 minutes)

Run `npx practonaut play` (or `node dist/cli/main.js serve examples/worlds/flow-diagram --task T3`
from a checkout). Turn on your screen reader (VoiceOver, NVDA, JAWS or Orca). Note OS, browser,
screen reader and Practonaut version. No audio or screen recording is needed.

## Path

1. Read the task and the goal conditions. Find the board and the keyboard help. Is the difference
   between the model board and the real-engine mirror understandable?
2. Tab to the board, pick a step with arrows, Enter to pick up, move with the arrow keys, Enter to
   place. Start a second move and cancel it with Escape; is the cancellation announced?
3. Find Connections, pick the arrow from the first to the middle step, use Rewire end, choose the
   last step and confirm. Are source, destination and action number spoken?
4. Rewire the start of a connection and undo it. Delete the middle step while its second
   connection remains; is the loose-arrow consequence announced, and is the next safe action
   findable?
5. Undo. Open one hint at a time. Reset (cancel first, then confirm); where does focus return?
   Switch to a new variant; did labels, task and conditions change?
6. Finish task T3: rewire the first arrow to the last step, remove the other arrow, delete the
   middle step. Run Check result and read every condition.
7. Repeat the main controls at **200 % browser zoom**, light and dark: focused controls and the
   pending instruction stay visible, all text is readable, every action works without dragging.
8. With `npx practonaut` (the bundled example without a world argument), use **Watch a
   demonstration**. Is each action announced with its number and whether the real Excalidraw
   confirmed it, and does Escape stop it? At the end, is the verdict read as the demonstration's,
   and is **Start your own attempt** reachable from where the focus lands?

Use the visible buttons when screen-reader quick navigation conflicts with the C/R shortcuts, and
say whether the shortcut help was confusing.

## What to report

| Field | Observation |
|---|---|
| Date, versions | |
| Spoken labels, relations and consequences | |
| Keyboard reach, cancellation, restored focus | |
| Live updates (no missing or duplicate announcements) | |
| 200 % zoom: all controls and text available | |
| Light/dark, focus visibility, reflow | |
| Findings: step, expected, observed, severity | |

## Runs

| Date | Who | OS, browser, assistive technology | Practonaut | Path | Result |
|---|---|---|---|---|---|
| 2026-10-17 | maintainer | macOS 27.0.1, Chrome 155.0.8059.80 (arm64), VoiceOver; 200 % browser zoom | 0.2.0 | the path above, as reported | every step worked with VoiceOver; at 200 % all controls and text stayed visible and readable; no findings |

Not covered yet: NVDA, JAWS and Orca, Safari and Firefox, and a person who uses a screen reader
every day — one run by the maintainer is evidence that the path works, not that it is comfortable.
