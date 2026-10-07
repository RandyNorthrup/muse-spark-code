# INT0160UX — 0.16.0 UI integration on the 0.15.0 head

Rig: `linuxlt`; worktree `/home/randy/lanes/INT0160UX`; branch `int/0160-ux`.
Release base: `9d1ab33c3`. Version stays 0.15.0. No push, rebase, unlisted
merge, live/paid model call, new dependency, timeout or gate relaxation.

## Integration and current-path audit

1. `git merge --no-ff --no-commit -m "Merge QPIN dcac54ea5: pin questions above the composer" dcac54ea5`,
   then hooks-on commit `f68e7512`. Retained both PLAN gate records.
2. `git merge --no-ff --no-commit -m "Merge FIXAGENTOUT c79cd749a: agent activity, outcomes and recovery" c79cd749a`.
   Retained current provider, usage, compaction, compact/legal/usage ACP commands,
   prompt/question commands and the lazy team tree alongside incoming outcomes.
   Localization applies the incoming change from its merge base to current tables:
   18 keys per language, no divergent translations, all 14 tables retained.
   Generated reference files are regenerated with `node scripts/gen-reference.mjs`.

The current agent map still loads `TeamUi` lazily and renders the team tree
in its overview. The integration regression follows that overview into a
failed child's details and dispatches Continue through the current controller.
ACP collision coverage now includes both `/compact` and `/agents` while retaining
question commands. Current usage-budget and automatic-compaction paths remain;
the latter keeps `autoCompact.noteTodos` alongside the new turn-scoped completion
declaration. Receipt patch reads use the owning session and the controller's
existing bounded slots/stale-generation fence. Native RPCs reuse the captures
listed in [agent-outcomes.md](agent-outcomes.md), with no new wire field or call.
The redundant child-budget terminal assignment and displaced method comments
are removed; the shared workflow parser remains the single implementation.

Golden fixture regeneration uses the existing test's explicit update mode:
`MUSE_SPARK_UPDATE_GOLDEN_REQUESTS=1 npx vitest run test/unit/modelApiGoldenRequests.test.ts --maxWorkers=3`.
Only `06-subagent-child.json` changes, and only its third request changes for
the child's task instruction, task tool and derived cache key. The other
fixtures retain their SHA-256 hashes. The stale merged fixture first failed
nine replay assertions; regeneration passed all 77 tests.

## Default-timeout owning verification before the second merge commit

All commands run directly on the rig with `npx vitest run <files> --maxWorkers=3`;
no `--testTimeout`, test-name filter or test skip is added.

| Complete files                                                     | Result                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `questionApp`, `QuestionCard`, `attentionDock`                     | 35 passed                                                                                                                                   |
| `deferredQuestionUi`, `deferredQuestionFailure`, `elicitationCard` | 8 passed                                                                                                                                    |
| `agentOutcome`, `AgentMap`, `WorkflowRun`                          | 43 passed                                                                                                                                   |
| `acpAgent`, `acpQuestionDeferral`, `AgentMap`                      | 205 passed; new integration fixture initially failed because details correctly replace the overview; test now follows overview then details |
| `AgentMap`, `modelApiGoldenRequests`, `modelApiHost`               | 748 passed; nine expected stale child-fixture failures, repaired by explicit regeneration                                                   |
| Restored `AgentMap`, `questionApp`, `acpQuestionDeferral`          | 110 passed                                                                                                                                  |
| `modelApiGoldenRequests`, `MuseCodeHost`, `conversationController` | 823 passed in normal comparison mode                                                                                                        |
| `node scripts/check-l10n.mjs`                                      | 14 UI tables, 14 usage tables, 197 manifest strings, 972 source files; zero problems                                                        |
| `npm run typecheck:host`                                           | Passed                                                                                                                                      |

## Gate-fire drills

Each drill runs its complete owning file. Source bytes are saved and restored
in `finally`, and the before/after SHA-256 is compared. No mutation is retained.

| Deliberate mutation                                          | Result                                                      | Restoration SHA-256                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Hide the lazy team tree in `AgentMapContent.tsx`             | New overview/recovery regression fails: 1 failed, 16 passed | `cc3560bbd195d13b7f864407000780af691446f660623399e054e0517eaa252d` |
| Add `isDockCard` to the transcript question in `ToolRow.tsx` | Single-card/focus/terminal guards fail: 6 failed, 10 passed | `53de14bf1e5e0221257a531cfdbaf4c91887d11f87376e0e3cf143672383d0bd` |

Restored combined owning run passes 110 tests. Logs and restoration data are
ignored local artifacts under `temp/`.

## Fresh-clone CI verification

Pending after the second hooks-on merge commit: fresh clone, `CI=true npm ci`,
all five typecheck projects, full lint/format, plain knip, duplication,
reference, localization, unchanged build caps, four coverage shards at
repository deadlines and merged coverage thresholds. Then the full
accessibility harness and README screenshot regeneration/comparison.
