# RLF-M120UI — the M120 panel editor surface

Branch `rec/rlf-m120ui`, base `int/recovery` at `397aca3dd` (main plus the
fifteen merged recovery lanes). Written on the owner's Windows PC and the
MacBook (2026-10-22/23, committed `ef03db166`…`1583e77c1`) and finished on
linuxlt (2026-10-24, `4918edb36` and later). PLAN.md D103, D212 and M120.
No push, rebase, merge, tag, paid call or Muse request: Muse's allowance is
used up until 2026-10-25 17:00 Pacific, and this lane made none.

## What a person gets

Over the core RLM120 landed (`preferences.ts`, `codingRoles.ts`,
`handoff.ts`, `board.moveToRole`), in the Models & Agents panel:

- **Roles → a role → Borrow timers**
  (`src/webview/models/sections/roles/RoleEditor.tsx`): five timers in
  whole seconds (demand wait, lookahead, finish grace, recall wait,
  cooldown), starting at the plan's defaults. A demand wait under 60 s is
  refused with its own sentence ("The demand wait cannot go below 60
  seconds."); any other bad timer is refused as invalid. Nothing is saved
  until **Save**.
- **Roles → a role → Reorder this pool automatically…**: the per-role
  auto-order opt-in (nothing reorders unless it is ticked).
- **Roles → a pool entry → Also helps with**
  (`src/webview/models/sections/roles/PoolEditor.tsx`): the agent's main
  role and its ordered secondary roles. Add from the list, remove with the
  row's Remove, reorder by dragging or with Alt+Up / Alt+Down. Templates
  seed D212's default secondary roles for the roles the team staffs;
  removing a role or an entry removes the rows that name it, and an
  imported file whose rows name an agent or role the team lacks cannot be
  saved (it says why).
- **Agent map → a waiting task → Move to…**
  (`src/webview/components/TeamTree.tsx`): one "Move to <role>" button per
  other role and Cancel; focus goes to the first role when it opens and
  back to Move to… when it closes. The host moves only a waiting task,
  links the handoff chain with the `user` trigger (from the old role to
  the new role's first pool entry), and says why it refuses a running task, a finished task, an
  unknown role, the same role or a role with no staffed pool
  (`src/core/team/teamHost.ts` `moveTask`).
- Every sentence is English plus all 14 tables (`teamBorrow*`,
  `teamAutoOrder`, `teamSecondary*`, `teamRoleUnknown`, `teamMove*`).

What is still not true: the editor writes the saved team document, but no
installed host reads its timers, secondary roles or auto-order yet (the
host bindings wait for RLM104), and the whole team surface stays behind the
release latch. The README is byte-identical to the base, and
`test/unit/cx1r2Truth.test.ts` (17 tests) is green.

## Real use

None through the packed product: the team surface is dormant (no person
can reach it in an installed build) and Muse requests are barred until
2026-10-25 17:00 Pacific. The real runs behind the claims are the
real-code suites below and one local look of each scene from the built
bundle in headless Chrome on linuxlt (`TMPDIR=<worktree>/temp npm run
ui:look -- models-roles` and `-- models-agents`, light and dark, exit 0
each). Pictures: `rlf-m120ui-models-roles-{light,dark}.png` (borrow timers
at 90/600/300/120/180 s, auto-order ticked) and
`rlf-m120ui-models-agents-{light,dark}.png` (a queued task with Move to
opened, focus on "Move to Code Review"). The first look of the Agent map
showed bare role names beside Open Transcript; that was changed to the
labelled buttons above and looked at again.

## Proof (real code, no stand-ins)

| Suite                                                                           | What it drives                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `test/unit/team/teamPanelPreferences.test.ts` (8)                               | the panel controller over a real store: timers, floor, auto-order, secondary roles, cleanup, import    |
| `test/unit/teamHostService.test.ts` (Move to…, 2 of its tests)                  | the host service on the real board: move, chain, persisted record, launch under the new role, refusals |
| `test/unit/teamRolesSection.test.tsx` (lane P describe, plus the Agent-map rig) | the real React editor and tree: seconds, auto-order, drag and keyboard order, Move to… and focus       |

Run on the final tree at the repository's own timeouts (no
`--testTimeout`): `teamPanelPreferences` 8 passed, `teamHostService` 78
passed, `teamRolesSection` 56 passed, `cx1r2Truth` 17 passed.

## Red/green drills (break on purpose, non-zero exit, restore, green)

Each break was one edit, run through its owning test, then the file was
restored from a copy and the same test run again. `red` and `green` are
vitest exit codes.

| Break                                                               | Test that caught it                                   | red   | green |
| ------------------------------------------------------------------- | ----------------------------------------------------- | ----- | ----- |
| the floor check `demandWaitMs < 60 s` made `< 0` (`teamPanel.ts`)   | "refuses a below-floor demand wait with its sentence" | 1     | 0     |
| the running-task refusal removed (`teamHost.ts` `moveTask`)         | "says each refusal" (service)                         | 1     | 0     |
| `await persist()` removed from `moveTask`                           | "moves a waiting task, chains the move…"              | 1     | 0     |
| removing a role no longer drops its main-role rows (`teamPanel.ts`) | "drops assignments with their entry or role"          | 0 → 1 | 0     |
| the dangling-assignment issue disabled (`teamPanelViews.ts`)        | "blocks saving an import whose assignments dangle"    | 1     | 0     |
| timers posted as seconds, not milliseconds (`RoleEditor.tsx`)       | "edits borrow timers in seconds…"                     | 1     | 0     |
| Alt+Up moved the secondary role down (`PoolEditor.tsx`)             | "reorders secondary roles from the keyboard"          | 1     | 0     |
| Move to… no longer moves focus (`TeamTree.tsx`)                     | "moves a waiting task from the Agent map…"            | 1     | 0     |
| Move to… buttons show the bare role name (`TeamTree.tsx`)           | same test                                             | 1     | 0     |
| `teamMoveToRole` deleted from `l10n/ui.fr.json`                     | `node scripts/check-l10n.mjs`                         | 1     | 0     |

The main-role row drill first stayed green (exit 0): the test only removed a
secondary role. The test now also removes a main role that owns a row, and
the same break then fails (1) and passes on restore (0).

## Gates (linuxlt, 2026-10-24, final tree)

| Gate                                                                                                           | Exit    | Note                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| prettier --check, touched files                                                                                | 0       |                                                                                                                                                                                                                                                  |
| eslint --max-warnings 0, touched files                                                                         | 0       |                                                                                                                                                                                                                                                  |
| `npm run typecheck` (five projects)                                                                            | 0       |                                                                                                                                                                                                                                                  |
| `node scripts/check-l10n.mjs`                                                                                  | 0       | 14 UI tables, 0 problems                                                                                                                                                                                                                         |
| `npm run check:reference`                                                                                      | 0       |                                                                                                                                                                                                                                                  |
| `npm run check:host-api`                                                                                       | 0       |                                                                                                                                                                                                                                                  |
| `npm run check:roadmap`                                                                                        | 0       | regenerated after the PLAN.md change                                                                                                                                                                                                             |
| `npm run check:plan`                                                                                           | 1       | PLAN.md is over the 85 % budget; the base `397aca3dd` fails the same way (3,668,951 bytes; this lane adds 948)                                                                                                                                   |
| `npm run check:catches`                                                                                        | 0       |                                                                                                                                                                                                                                                  |
| `npm run duplication`                                                                                          | 0       | 0 clones                                                                                                                                                                                                                                         |
| `npm run cycles`                                                                                               | 0       |                                                                                                                                                                                                                                                  |
| `npm run deadcode`                                                                                             | 0       |                                                                                                                                                                                                                                                  |
| `npm run build`                                                                                                | 1       | stops at the size check: `dist/modelApi.js` 540,355 B (budget 537,600, +2,755), `dist/resourceAdmission.js` 25,639 B (+39), `dist/vaultActions.js` 25,606 B (+6). All three are byte-identical to the base's build (`cmp`); no budget was raised |
| rest of the build chain, run by hand (bundle split, lazy registry, host globals, notices, legal build records) | 0 each  | from a clean `dist`                                                                                                                                                                                                                              |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                                                         | 0       | 0 findings                                                                                                                                                                                                                                       |
| `npm run security:audit`                                                                                       | 1       | three high advisories (`@azure/msal-node`, `undici`, `zod`) and a stale exception; `package.json` and the lockfile are identical to the base                                                                                                     |
| the three touched suites, repository timeouts                                                                  | 0       |                                                                                                                                                                                                                                                  |
| `cx1r2Truth`                                                                                                   | 0       | 17 passed                                                                                                                                                                                                                                        |
| `vitest related` on the changed source files                                                                   | 1 and 0 | see below                                                                                                                                                                                                                                        |

`vitest related` ran in five groups (`--maxWorkers=3`, repository
timeouts): team host files 3 passed, panel files 63 passed, host bindings
2 passed, webview files 7 passed, plan/harness files 26 passed with the
vault failure below, and `protocol.ts` 106 passed with the connector
failure below. Both failures were measured on the untouched base:

- `test/unit/vault/vaultPanelBuild.test.ts` (explicit-action bundle cap):
  fails on `vaultActions.js` at 25.006 KiB; the base builds the same bytes.
- `test/unit/connectorStorageGuard.test.ts` (3 of 8): the same 3 fail on
  the base worktree and on this tree.

`src/shared/l10n/en.ts` is read by nearly every suite; its `related` run
is the whole battery, which this lane did not run. The l10n gate, the
table-order and the UI text region suites it feeds were run.

## Open

- Installed host bindings (the scheduler reading the saved timers,
  secondary roles and auto-order) wait for RLM104.
- The packed-product run of this surface, and any real conversation,
  wait for that binding and for Muse's allowance (2026-10-25 17:00
  Pacific); none was made.
- The three bundle overruns, the PLAN.md size and the audit advisories
  are the integration branch's and are listed above with their numbers.
