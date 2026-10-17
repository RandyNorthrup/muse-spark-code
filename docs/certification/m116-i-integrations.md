# M116-I — panel and planner integrations

2026-10-07, Kubuntu rig, branch `m116/i`, base `f908a788d`
(lane 0 + P policy module). Baseline commit `418ff42c7`.
This record certifies lane I's panel bindings and the injected
ports the planner owners bind as they merge. It does not certify
M96/M96c, M110, M115w or M113, none of which are on this base.

## Scope

The panel's own orchestration runs through the frozen P policy
before any effect: subagent spawns (`dispatchPlaybookSubagent`
in `subagentTools.ts`, the dispatch region lane I owns),
`delegate` follow-ups, best-of-N starts, and the `/review` loop
on the same files, which offers Plan a redesign at the third
round via `offerRedesign`. No frozen contract, string table,
prompt, request builder or other lane's file changed. No new
dependency, install, escape hatch, cast, ignored lint rule,
model call, network call or paid feature. All doubles live in
`test/**`; production holds no fake implementation.

New shared-core modules (no `vscode` import):

| File                                            | Responsibility                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/orchestration/playbookIntegration.ts` | One seam for the panel, M96/M96c, M110's runtime host and M115w: `start` (admission, command guard, work lease), `pick` (M96c order, unmerged next), `merge`, `check` (governed offload target), `verify`/`push` receipts, renewal timers, owner-first notes and the redesign offer.                                  |
| `src/core/orchestration/panelPlaybook.ts`       | Panel port: dispatch binds the policy lease, records the brief and waits for outcome receipts; reviews normalize Windows paths, admit one generation lease, attach K's prior round, count only the bound completed turn with exactly one well-formed review block, and refuse a fourth patch with the redesign offer. |
| `src/core/orchestration/playbookBrief.ts`       | G3/G4 brief envelope: named required sections, recorded base commit, SHA-256 digest; malformed briefs refuse before dispatch.                                                                                                                                                                                         |
| `src/core/orchestration/playbookReports.ts`     | M113 `playbook`/`milestone`/`fleet` rows: duplicate ids refuse, the policy order (owner/residual and failure rows first) applies in all editors, payloads preserved.                                                                                                                                                  |

Regions in owned files: `conversationController.ts` (the
`playbook` dep, best-of-N/delegate-followup dispatch, the
review ticket lifecycle, fail-closed factory), `subagentTools.ts`
(the spawn/follow-up dispatch helper).

## Acceptance evidence

| Lane item                                      | Evidence                                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagent spawns, `delegate`, best-of-N         | Every kind binds the same policy lease and waits for completion receipts (`playbookIntegrations.test.ts`: six kinds; controller follow-ups refuse laundered retries before `subagent/followupTask`).                 |
| `/review` loop, redesign at round three        | Three full reviews on the same files count rounds 1–3, a fourth patch refuses, and Plan is offered the redesign; redesign closes only on `impossible`, `caught`/`remains` stay user-first (`panelPlaybook.test.ts`). |
| M96 planner and M96c pick                      | `pick` orders dependency, then estimate, then id over the whole board and returns the first unmerged lane; dispatch re-reads contracts and prerequisites after the pick.                                             |
| M110 orchestrator host                         | Same `PlaybookIntegration` module; the runtime host supplies its own registry, brief and completion waiter (named handoff, below).                                                                                   |
| M115w orchestrate step                         | `dispatch`/`check`/`merge` entrypoints with the fix-module lease (named handoff).                                                                                                                                    |
| M113 `playbook` kind, milestone and fleet rows | `collectPlaybookReport` orders owner/residual and failure rows first for all three kinds, preserving payloads.                                                                                                       |
| Windows paths                                  | Backslash capture paths normalize to `/` before the module lookup; CI on Windows compares normalized paths.                                                                                                          |
| Nothing else changes                           | 577 controller tests pass unmodified in behavior; old `muse-review` blocks still parse (P contracts).                                                                                                                |

## Named integration handoffs (not on this base)

| Owner                           | Binding                                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel host (W/integration)      | Supply `ConversationDeps.playbook`: build `PanelPlaybook` with the P policy, a `FilePlaybookJournal`, K's charter `reviewParts`, transcript notes, and the Plan-redesign offer UI. Until installed, orchestration runs exactly as before. |
| Model API spawn owner (M48/M76) | Call `dispatchPlaybookSubagent` immediately before a new child/follow-up starts, after paid consent and tool admission; idempotent `command_id` retries start no work.                                                                    |
| Muse Code native spawn owner    | Bind `PanelPlaybookPort` at its dispatch boundary the same way.                                                                                                                                                                           |
| M96/M96c planner                | Supply `PlaybookPlanPort.readBoard` with trusted merged/reviewed facts; call `start`/`pick`/`merge` immediately before effects.                                                                                                           |
| M110 runtime host               | Reuse `PlaybookIntegration` with a runtime registry and runner-backed `waitForCompletion`.                                                                                                                                                |
| M115w watchdog                  | Call `dispatch`/`check` under the fix-module lease in its orchestrate step.                                                                                                                                                               |
| M113 collector                  | Feed current `playbook`/`milestone`/`fleet` rows (with residual register and Needs-you facts) to `collectPlaybookReport`.                                                                                                                 |
| M107/governor                   | Back `checkAdmission.admit` with real capacity; denial refuses, never silently runs elsewhere.                                                                                                                                            |
| Permissions owner               | Record actual permission/classifier failures with `recordRefusal`, normalizing effect/subject across delegate/tool/spelling.                                                                                                              |
| W bundles                       | No lazy entry added here: nothing shipped imports the new modules yet, so `dist/extension.js` is unchanged. Wire `dist/playbook.js` (later the team bundle) at install and measure the 1 KiB activation allowance.                        |

## Red drills (each: break, named failure, byte-exact restore)

Baseline SHA-256 recorded before the first drill; `sha256sum -c`
passes on all six files after the last restore.

| Guard                    | Mutation                                  | Named failure                                                                                  |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Command guard in `start` | Skip `beforeCommand`, `void` the command  | `refuses hook bypass and same-effect delegated retries before starting work`                   |
| Windows normalization    | `replaceAll('\\', '/')` → identity        | `counts three independent full reviews on the same files and offers Plan a redesign`           |
| Unmerged pick            | `!lane.merged` → `lane.merged`            | `M96c picks dependency then estimate and keeps original prerequisites`                         |
| Report order             | `rows: sorted` → `rows`                   | `M113 playbook puts owner/residual and failure rows first`                                     |
| Brief validation         | Throw → return a broken digest            | `G3/G4 renders required brief sections structurally and records its base/hash before dispatch` |
| Spawn binding            | `playbook.dispatch` → call `start` direct | `refuses hook bypass and same-effect delegated retries before starting work`                   |
| Fail-closed factory      | Swallow factory throw, return `undefined` | `M116 refuses a configured playbook that cannot load before any review request`                |

## Verification (repo default timeout, no `--testTimeout`)

| Command                                                                                                | Result                                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `npx vitest run test/unit/panelPlaybook.test.ts test/unit/playbookIntegrations.test.ts --maxWorkers=3` | 33 passed (Kubuntu rig)                                                          |
| `npx vitest run test/unit/conversationController.test.ts --maxWorkers=3`                               | 577 passed (Kubuntu rig)                                                         |
| `npm run typecheck`                                                                                    | clean (also fixed an `exactOptionalPropertyTypes` error on the new optional dep) |
| `npx eslint --max-warnings=0` on all ten lane files                                                    | clean                                                                            |
| `npx prettier --check` on all ten lane files                                                           | clean                                                                            |
| `npm run deadcode` (knip)                                                                              | clean                                                                            |
| `node scripts/check-l10n.mjs`                                                                          | 0 problems (lane I adds no strings)                                              |
| `npm run check:reference`                                                                              | clean (lane I adds no commands/settings)                                         |
| `npm run build`                                                                                        | clean, caps unchanged                                                            |

Open: the handoff table above; W's docs/help, host-API record,
axe scenes and full gate on the integrated result.
