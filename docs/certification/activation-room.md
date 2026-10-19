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

## The moves (landed)

1. New first-use bundle `dist/commands.js` (29,962 B; new 50 KiB budget:
   29,962 × 1.15 = 34,456 B, rounded up to the next 25 KiB multiple) from
   `src/host/commands/commandsEntry.ts`: `museConfigCommands.ts` (6,911),
   `skillsCommands.ts` (3,021), `worktreeCommands.ts` (3,606),
   `memoryCommands.ts` (2,192), `planCommands.ts` (523). Readers
   (`cliFeatures`, `worktreeFeatures`, `memoryFeatures`, `planFeatures`)
   take it through a dynamic `import('./commands/commandsEntry')` inside
   each command method (redirected to `./commands.js` by the
   `deferredCohort` plugin, as `conversationController` does for
   `reportEntry`); each entry factory installs the caller's table before
   delegating (the `rulesFileEntry` shape). None of the five imports
   `vscode` (verified: only core/shared/node imports plus type-only editor
   types), and the build fails a stray import there.
2. `src/core/support/report.ts` (3,476) into the existing `dist/report.js`
   (19,904 → 23,539 B, budget unchanged at 75 KiB): Diagnostics and Report
   a Problem both take the report bundle on first use (new
   `renderSupportReport` export on `reportEntry.ts`, same table-installing
   shape), instead of carrying the builder.

Measured production `npm run build` after:

- `dist/extension.js` **564,253 → 539,818 B** (−24,435 B).
- Budget test: baseline 561,352 B, current 539,818 B, growth **−21,534 B**;
  headroom **24,606 B (≈ 24.0 KiB)** — twice the 12 KiB aim.
- No existing cap moved; the only new budget line is `dist/commands.js`
  at 50 KiB per D6's rule.

## Proof per moved unit

- Repository gates, all green on the final tree: `check-bundle-split`
  (prints `ok dist/commands.js: loads only on the first CLI-backed or
workspace command` and the updated report line), `check-bundle-size`
  (extension 527.2/600, commands 29.3/50, report 23.0/75 KiB),
  `gen-lazy-registry --check` (100 bundles, `commands.js` requested by the
  four facades, `report.js` additionally by activation),
  `check-host-globals` (commands 0 `navigator` refs), `packagedBundles`
  (8/8: the real VSIX carries the new bundle and every lazy load
  resolves), `modelsActivationBudget` (growth −21,534 B), and the moved
  files' suites: `museConfigCommands` + `supportReport` + `reportProblem`
  (79), `skillsCli` + `worktrees` + `worktreeConversations` (32),
  `modelsSubscriptionsBundle` + `modelsPanelBundle` + `memoryIo` (17),
  `lazyBundleFiles` (13) + `rulesFileBundle` (6).
- First-use drill through the built `dist/` (`temp/drill-activation-room.mjs`,
  gitignored): both bundles require with every moved export; the
  Diagnostics text renders (`Muse Spark diagnostics`, `extension: …`);
  the Plans picker dismisses and opens; MCP/Hooks pickers reach their
  first pick; skills flows refuse without a CLI; worktree flows exit
  cleanly without git; memory reaches its empty pick with no error.
  Result: `DRILL PASS: every moved unit loads and works on first use`.
- Typechecks (host, webview, unit, e2e, integration), eslint zero
  warnings, prettier, knip, cycles, duplication, `check:plan`,
  `check:l10n`, `check:reference`, `check:host-api`, SAST and audit: exit
  0 (SAST/audit lines below).

## Grok review findings (PR #245, accepted; fixed in this lane)

- CHANGELOG had no Unreleased entry for this split: added one under
  Pending in the activation-budget style.
- `commandsOptions` kept `external: ['vscode']` from
  `conversationGitOptions`, so its "a stray import fails this build" claim
  held nothing: it now spreads `common` with the same plugins and no
  `vscode` external, like `reportOptions`. Probed: a planted
  `import … from 'vscode'` in the bundle fails esbuild with
  `Could not resolve "vscode"` (exit 1); with the old external it built.
  Production `npm run build` is byte-identical
  (extension 539,818, commands 29,962, report 23,539 B).
- The record named only Diagnostics on `dist/report.js`: Diagnostics and
  Report a Problem both load it on first use
  (`src/extension.ts` Diagnostics command, `conversationController`
  `openReport`), now said in the record, `reportEntry.ts` and `build.mjs`.
