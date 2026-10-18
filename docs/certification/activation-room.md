# Activation room (lane ACTIVATIONROOM, PLAN.md D6)

Worktree `/home/randy/lanes/ACTIVATIONROOM`, branch `fix/activation-room`,
base `81dacaf5a7`. No behaviour change: first-use code moves off the
activation path as whole files into lazily required bundles; the budget
(`test/unit/modelsActivationBudget.test.ts`, at most 3 KiB over the
immutable pre-K production bundle) never moves.

## Budget math

`npx vitest run test/unit/modelsActivationBudget.test.ts` on this base:

- baseline 561,352 B, current 564,253 B, growth **+2,901 B** (budget 3,072 B).
- Headroom left: **171 B**. Target: **at least 12 KiB of headroom**, i.e.
  growth at most 3,072 − 12,288 = −9,216 B, so about **12.1 KiB net** must
  leave `dist/extension.js`.

Production `npm run build` agrees: `dist/extension.js` is 564,253 B from
257 inputs (`dist/meta/extension.json`). `bytesInOutput` below is minified
bytes per input, ranked.

## Size-ranked inventory (top 45 of 257)

Why = the activation reader that forces the input onto the path, verified by
importer search on this base. `STAYS` = needed at activation or on the
per-turn hot path. `MOVE` = first-use only, the lane's target set.

|  Bytes | Input                                           | Why                                                                                                                                                                  |
| -----: | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 68,778 | `src/extension.ts`                              | STAYS: the entry; registration and adapter wiring                                                                                                                    |
| 40,074 | `src/core/backends/musecode/MuseCodeHost.ts`    | STAYS: Muse Code backend started at activation, per-turn host                                                                                                        |
| 36,123 | `src/shared/constants.ts`                       | STAYS: hundreds of activation readers (UI text, ids, files)                                                                                                          |
| 16,693 | `src/host/auth/authService.ts`                  | STAYS: startup auth check and backend auth wiring                                                                                                                    |
| 14,826 | `src/host/backend/toolIo.ts`                    | STAYS: per-turn tool IO for every controller                                                                                                                         |
| 11,739 | `src/core/paid/paidFeatures.ts`                 | STAYS: paid gate read at activation and per paid use                                                                                                                 |
| 10,124 | `src/host/backend/modelApiBackendManager.ts`    | STAYS: backend manager built at activation                                                                                                                           |
|  9,951 | `src/host/tab/tabBundle.ts`                     | STAYS: Tab activation/consent wired at activation                                                                                                                    |
|  9,040 | `src/host/settings.ts`                          | STAYS: settings read at activation and per turn                                                                                                                      |
|  9,000 | `src/host/processTree.ts`                       | STAYS: RESOURCE_LAUNCH_SHARED; helpers/MCP at activation                                                                                                             |
|  8,679 | `src/host/backend/museCodeBackendManager.ts`    | STAYS: backend manager built at activation                                                                                                                           |
|  8,212 | `src/core/memory/memoryStore.ts`                | STAYS: memory backends built at activation                                                                                                                           |
|  8,153 | `src/core/paid/paidAuthority.ts`                | STAYS: paid authority at activation                                                                                                                                  |
|  7,845 | `src/core/paid/paidConsent.ts`                  | STAYS: paid consent gate on the paid path                                                                                                                            |
|  7,798 | `src/host/editor/verifyEditor.ts`               | STAYS: per-turn verify editor                                                                                                                                        |
|  7,363 | `src/core/backends/musecode/mapNotification.ts` | STAYS: per-turn notification mapping                                                                                                                                 |
|  7,297 | `@muse-code/sdk connection.js`                  | STAYS: third-party CLI transport, per turn                                                                                                                           |
|  6,911 | `src/host/commands/museConfigCommands.ts`       | MOVE: only reader is `cliFeatures.ts` (`showMcpServers`, `showHooks`, on command)                                                                                    |
|  6,502 | `src/host/git.ts`                               | STAYS: checkpoint store + process git at activation                                                                                                                  |
|  5,883 | `src/host/paid/paidHost.ts`                     | STAYS: paid host wired at activation                                                                                                                                 |
|  5,846 | `src/core/browser/browserTool.ts`               | STAYS: browser tool definitions on the per-turn path                                                                                                                 |
|  5,297 | `src/host/fsAtomic.ts`                          | STAYS: atomic writes under checkpoint leases, per turn                                                                                                               |
|  5,266 | `@muse-code/sdk spawn.js`                       | STAYS: third-party CLI transport, per turn                                                                                                                           |
|  4,972 | `src/host/backend/mcpProcess.ts`                | STAYS: MCP servers started from activation (`mcpServers.ts`)                                                                                                         |
|  4,525 | `src/host/checkpoints/checkpointHost.ts`        | STAYS: turn recording on the per-turn path                                                                                                                           |
|  4,309 | `src/host/cliFeatures.ts`                       | STAYS (facade): builds command deps at activation; its command implementations move                                                                                  |
|  4,308 | `src/core/schedules/sessionOwner.ts`            | STAYS: schedule ownership on the session path (verify at drill)                                                                                                      |
|  4,157 | `src/host/backend/mcpJobLaunch.ts`              | STAYS: RESOURCE_LAUNCH_SHARED by design                                                                                                                              |
|  3,716 | `src/shared/paid.ts`                            | STAYS: paid shapes read at activation                                                                                                                                |
|  3,606 | `src/host/commands/worktreeCommands.ts`         | MOVE: only reader is `worktreeFeatures.ts`, on worktree command                                                                                                      |
|  3,566 | `src/core/backends/modelapi/imageGeneration.ts` | STAYS: paid image path readers across backends                                                                                                                       |
|  3,552 | `src/host/backend/fileScheduleStore.ts`         | VERIFY: reader is activation (`createFileScheduleStore`) — check first-use before moving; not in the target set                                                      |
|  3,476 | `src/core/support/report.ts`                    | MOVE: only value reader is activation's Diagnostics command (`renderSupportReport`); types only in `networkPosture.ts`                                               |
|  3,442 | `src/host/resources/museResourceLaunch.ts`      | STAYS: backend start path (`museCodeBackendManager`, `accountHost`)                                                                                                  |
|  3,412 | `src/host/auth/deviceSignIn.ts`                 | STAYS: startup sign-in flow (`authService`, activation)                                                                                                              |
|  3,406 | `src/host/codeIntel/languageServices.ts`        | STAYS: constructed at activation as the tools' service (per-turn calls)                                                                                              |
|  3,389 | `src/core/codeIntel/definitions.ts`             | STAYS: tool list registered at activation (M67: list stays, answers are lazy)                                                                                        |
|  3,387 | `src/core/backends/musecode/launch.ts`          | STAYS: backend launch/shell quoting at activation                                                                                                                    |
|  3,251 | `src/core/context/recordingReader.ts`           | STAYS: workspace context via `environment.ts` at backend start                                                                                                       |
|  3,060 | `src/host/resources/resourceWindow.ts`          | STAYS: constructed and message-wired at activation                                                                                                                   |
|  3,021 | `src/host/commands/skillsCommands.ts`           | MOVE: only reader is `cliFeatures.ts` (`manageSkills`, `importSkills`, on command)                                                                                   |
|  2,841 | `src/host/auth/accountHost.ts`                  | STAYS: startup account sessions                                                                                                                                      |
|  2,736 | `src/core/plans/planStore.ts`                   | VERIFY: readers `planFeatures` (activation), `planCommands`, lazy `conversationController`; move only if the activation reader goes lazy too — not in the target set |
|  2,696 | `src/core/backends/musecode/promptLedger.ts`    | STAYS: per-turn prompt ledger                                                                                                                                        |
|  2,670 | `src/host/skills/bundledSkills.ts`              | STAYS: skills offer wired at activation (installer already lazy)                                                                                                     |
|  2,567 | `src/host/web/pageConverter.ts`                 | STAYS: converter constructed at activation; verify first-use before any move — not in the target set                                                                 |
|  2,192 | `src/host/commands/memoryCommands.ts`           | MOVE: readers `memoryFeatures.ts` + `checkpointedMemory.ts`, on memory command                                                                                       |
|  2,187 | `src/host/auth/cliAccount.ts`                   | STAYS: startup CLI sign-in check                                                                                                                                     |
|  2,164 | `src/host/whatsNew/whatsNew.ts`                 | STAYS: update check and claim at activation (page already lazy)                                                                                                      |
|  2,124 | `src/host/views/tasksPanel.ts`                  | VERIFY: constructed on tasks-tab open; move only with its opener — not in the target set                                                                             |
|  1,847 | `src/host/planFeatures.ts`                      | STAYS (facade): plan IO built at activation; its command (`planCommands.ts`, 523 B) moves with the target set                                                        |
|    523 | `src/host/commands/planCommands.ts`             | MOVE: only reader is `planFeatures.ts`, on plan command                                                                                                              |

Remaining ~212 inputs are each under ~2.1 KiB (next: `shared/l10n/check.ts`,
`diagnostics.ts`, `tasksPanel` followers) and all on the activation or
per-turn path by the same reader rule; none is honestly movable without
changing when its reader runs, item by item as above.

## The moves (target set, ~19.7 KiB gross)

1. New first-use bundle `dist/commands.js` from
   `src/host/commands/commandsEntry.ts`: `museConfigCommands.ts` (6,911),
   `skillsCommands.ts` (3,021), `worktreeCommands.ts` (3,606),
   `memoryCommands.ts` (2,192), `planCommands.ts` (523) — 16,253 B gross.
   Readers (`cliFeatures`, `worktreeFeatures`, `memoryFeatures`,
   `planFeatures`) require it on the first command through a
   `commandsBundle.ts` loader (`lazyBundleLoader`, cached). None of the five
   imports `vscode` (verified: only core/shared/node imports plus
   type-only editor types), so the bundle stays host-safe like
   `dist/rulesFile.js`.
2. `src/core/support/report.ts` (3,476) into the existing `dist/report.js`:
   activation's Diagnostics command loads the report bundle on first use
   instead of carrying the builder. `dist/report.js` is 19,904 B against a
   75 KiB budget — fits with room.

Net target after loader shims (one loader per facade, entry re-exports):
about **19 KiB freed**, growth about **−16 KiB**, headroom about **19 KiB**.

## Proof per moved unit

- Repository gates: `check-bundle-split` (moved files in the lazy bundle,
  never in activation), `check-bundle-size` (new budget + existing report
  budget), `gen-lazy-registry --check`, `packagedBundles` suite,
  `modelsActivationBudget` suite, suites of the moved files' readers.
- First-use drill per moved unit through the built `dist/`: require the
  lazy bundle from `dist/` and exercise one real call path per reader
  facade (MCP-servers/hook pickers via a headless command shim,
  skills manage/import planning, worktree command planning, memory command,
  plan command, diagnostics report render), recorded below when run.
