# INT0160UX — 0.16.0 UI integration on the 0.15.0 head

Rig: `linuxlt`; worktree `/home/randy/lanes/INT0160UX`; branch `int/0160-ux`.
Release base: `9d1ab33c3`. Version stays 0.15.0. No push, rebase, unlisted
merge, live/paid model call, new dependency, timeout or gate relaxation.

## Integration and current-path audit

1. `git merge --no-ff --no-commit -m "Merge QPIN dcac54ea5: pin questions above the composer" dcac54ea5`,
   then hooks-on commit `f68e7512`. Retained both PLAN gate records.
2. `git merge --no-ff --no-commit -m "Merge FIXAGENTOUT c79cd749a: agent activity, outcomes and recovery" c79cd749a`.
   Hooks-on merge commit `3f9c647ab6bf9b1c2689655f6e4551ac18973b66`.
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

The first clean checkout of merge commit `3f9c647a`, installed with
`CI=true npm ci` on Node 22.22.2, exposed whole-suite issues that narrow
feature suites did not. No timeout or threshold was changed.

| Failed check | Cause and structural repair                                                                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint         | Unchanged release-base badge token spread violated `unicorn/consistent-conditional-object-spread`; use the rule's equivalent conditional spread, and test empty/absent tokens as well as GitHub-only authorization.                                               |
| Duplication  | The merged `/compact` + `/agents` expectation duplicated the common ACP fixture; allow existing skill commands in that fixture and reuse it without changing inventory/order assertions.                                                                          |
| Shard 1      | ACP usage expected the old command list; retain `/agents` in both exact assertions. The legal-cap drill built an uncompressed Model API fixture; use production's existing prompt-compression plugin, retaining the cap and byte-restored drill.                  |
| Shard 2      | Node 22 synchronous loader hooks make implicit CommonJS `require.cache` unavailable. Both packed wrappers now use explicit `createRequire(__filename)`; add hooked native-import coverage without changing signal deadlines, archive digests, or decoding bounds. |
| Shard 3      | App questions belong in the dock, the warmer follows QPIN's single QuestionUi/elicitation chunk, and map capture must distinguish Map from Side chat. Chunk ownership assertions still require one lazy implementation outside startup.                           |
| Shard 4      | Transcript folding asserts an unfurled marker rather than controls. A submitted marker must become disabled under a real QuestionSurface. Dock radio/Submit/Cancel/Explain remain locked. Crash/reload restores exactly one interactive dock card and its marker. |

The first run completed all four shards at the repository deadlines: 17 failed,
16,680 passed and 75 existing platform/opt-in skips across 825 files. Its
merged coverage passed the unchanged thresholds (92.69% statements, 87.67%
branches, 93.77% functions, 93.31% lines); the run remains failed because
assertions failed. Initial static checks passed all five typechecks, format,
plain knip, reference, localization, host API, cycles and every production
size/split/global gate. Logs are local artifacts under `temp/ci-int0160`.

The first full accessibility gate scanned 1,028 pages (257 scenarios × four
themes): no WCAG violations, undecided rules or exemptions, but `long` never
became ready in all four themes. A single-page Chrome probe demonstrated
MessageChannel completion before delivery of the window's queued deltas:
readiness could report success with only 229 displayed characters. Advance
from receipt of each stream frame instead, preserving all 333 100-character
deltas and waiting for the completed frame. The repaired 690 px probe rendered
35,286 visible characters in 4.489 s within the unchanged 10 s readiness bound.
The new whole-file regression also holds readiness pending after completion
is posted and before it is delivered. The first legal accessibility run passed
96 keyboard/zoom checks plus 24 English/pseudo WCAG pages. The first README
script regenerated all entries successfully; final image selection follows
the fully passing clone.

Repair verification before committing:

| Complete owning files                               | Result                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Transcript`, `store`, `QuestionCard`               | 77 passed                                                                    |
| `deferredBundles`, `vsixPackaging`, `webviewBundle` | 188 passed                                                                   |
| `App`, `harnessCapture`, `warmDeferredSurfaces`     | 178 passed                                                                   |
| `acpAgent`, `acpUsage`, `acpQuestionDeferral`       | 196 passed                                                                   |
| `execStdio.e2e`                                     | 44 passed, including installed credential isolation and signal/pipe shutdown |
| `harnessWaits`, `harnessCapture`                    | 34 passed                                                                    |

The final App/stream owning run passes 201 tests, unit typecheck passes,
and duplication reports zero clones. All six deliberate integration/repair
drills fired and restored their exact hashes.

Final verification remains pending after a hooks-on repair commit: a new fresh
clone, installation, every static check and all four coverage shards, followed
by full accessibility and README screenshot regeneration/comparison.

Additional repair drills ran on Node 22.22.2 at the same default deadlines,
with source saved/restored in `finally` and SHA-256 equality:

| Mutation            | Complete owning suite result | Restored SHA-256                                                   |
| ------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `stream-completion` | 2 failed; 27 passed          | `9d912f184434401dbeba8bee3360098a7078ffc503f78c71bba7ee7e75c92264` |
| `badge-empty`       | 1 failed; 41 passed          | `f0c9f34296e89d9f2c1611c1861494804aa1b7204efc6e153bf3d8cf1eb85d5c` |
| `native-cache`      | 1 failed; 75 passed          | `ab2b4b56dd1c7f14de516b4c039a46a8311e3f0c6c9d51f2e583cdff01461426` |
| `question-lock`     | 2 failed; 68 passed          | `6d9cb62d151632a56abc584dfeb139a19d46af8540733f83bc1978ed2f0f3118` |

Restored guard suites pass 147 tests (`checkBadges`, `vsixPackaging`,
`harnessWaits`) and 70 tests (`Transcript`, `QuestionCard`). Unit types
required a minimal declaration for the existing production compression plugin;
no cast, suppression or dependency was added.
