# MRG78: merge main into M71 on the Win11 rig

Scope: merge `main-sync` `244d5905` into `feature/m71-git-prs`, starting
at `cb00e78f` (including FIX78B). The rig brief allows merge repairs only,
requires direct serial rig checks and a local hook-on commit, and reserves
publication and full quality for the lead. No push or live/paid model call.

## Conflicts and resolutions

| File                                              | Resolution                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PLAN.md`                                         | Preserve both gate/deferral records and both escape-hatch rows; add this merge's scope and browser-size blocker.                                                                                                                                                         |
| `package.json`                                    | Keep main's web-fetch cycle entry and M71's conversation-Git entry. All main dependency pins and CI scripts remain.                                                                                                                                                      |
| `scripts/third-party-notices.mjs`                 | Enumerate every main artifact plus M71's Git bundle and the bundled-skills installer.                                                                                                                                                                                    |
| `THIRD_PARTY_NOTICES.txt`                         | Regenerate with the notices script from production metafiles; never hand-merge.                                                                                                                                                                                          |
| `docs/ide-compatibility/host-api.md`              | Regenerate with `node scripts/check-host-api.mjs --write`.                                                                                                                                                                                                               |
| `src/extension.ts`                                | Retain combined project trust for web fetch, plus main's lazy URL checker.                                                                                                                                                                                               |
| `src/host/conversation/conversationController.ts` | Retain Git port types and main's tasks-tab port; preserve Git draft cleanup and submission accounting; preserve queued-message methods; combine the revert admission fence with held-worktree review refusal; clear Git session state and end the tasks tab at sign-out. |
| `src/webview/App.tsx`                             | Render both the diff tally and Git panel above the goal pane.                                                                                                                                                                                                            |

Automatic merges retain all active localization keys and real translations,
all lazy bundle build/watch/package entries, tiered CI, release reuse and M80
receipt workflows. Changelog reconciliation moves all seven branch-only
bullets into the matching Unreleased subsections; released sections come
byte-for-byte from `main-sync`. There is exactly one Unreleased section.
All 147 M71 key additions retain their exact translations in each of the
14 tables. Main's three obsolete keys (`showHiddenSteps`, `hideHiddenSteps`,
`contextPercent`) stay removed with their replaced UI.

## Merge repairs

- Main's model-text split gate initially rejected the existing `GIT_MODEL_TEXT`
  block as unregistered. Register its commit/PR sentinels with
  `dist/conversationGit.js` as the sole reader; keep the prompts and callers
  unchanged.
- Main's native identity lint gate failed on five direct `dev`/`ino` reads in
  `gitExtension.ts`. Use the existing exact BigInt samplers, `fileIdentityKey`
  and `sameFile`; preserve canonical cwd, synchronous lexical/canonical
  rechecks and sticky ownership loss. No suppression or gate change.
- The Git panel uses M87's shared column gutter so it aligns with the other
  panes at wide and narrow widths.
- The initial owning sweep found two compatibility failures. M71's held-review
  assertion now includes main's `disposition: started` acknowledgement field.
  Its four Git palette rows reuse their translated details as M87 tooltips.
  Both formerly failing files and the affected App file pass after repair.

## Bounded verification

All checks run directly in `C:/lanes/MRG78` on `win11`. JavaScript lint covers
the union of merge-changed files and M71's delta from main (239 files).
Vitest runs whole owning files, serial batches of at most three, with
`--maxWorkers=3 --testTimeout=120000`. Exact commands, owning files, per-file
counts, bundle bytes and hashes are in [mrg78-verification.json](mrg78-verification.json).

The final five-project typecheck passes. Localization reports 14 tables,
122 manifest strings, 455 source files and zero problems. Scoped JavaScript
lint passes after the native identity repair; stylesheet lint passes.
Generated notices cover 83 bundled packages.

| Check                               | Result                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scoped formatting                   | Exit 0 on 338 affected files; released changelog bytes independently match main.                                                                       |
| Five TypeScript projects            | Exit 0 after the final repairs.                                                                                                                        |
| JavaScript lint                     | All 239 affected files pass; the three later-repaired files pass again.                                                                                |
| CSS lint                            | Exit 0, all source stylesheets.                                                                                                                        |
| PowerShell lint (additional check)  | Exit 1 before analysis: the rig has no pinned PSScriptAnalyzer 1.25.0 module. No native PowerShell file changed. No global install, downgrade or skip. |
| Knip, jscpd, cycles                 | Exit 0; duplication reports zero clones.                                                                                                               |
| Localization                        | Exit 0, zero problems in all 14 tables.                                                                                                                |
| Host API inventory                  | Regenerated, then checked with exit 0.                                                                                                                 |
| Production build                    | Exit 1 solely at the browser-size budget. All Node bundle size budgets pass.                                                                           |
| Bundle split, host globals, notices | Each run separately after the size failure: exit 0.                                                                                                    |
| Owning tests                        | 45 files, 1,580 passed, zero failed, three existing skips after repair.                                                                                |

Existing skips are the genuine Windows short-name workspace fixture, the
Windows-disabled broken-file-symlink append fixture, and the Bash-dependent
CIFLOW aggregate assertion (Bash is unavailable here). No skip or test filter
was introduced. Initial controller/palette failures remain in the working
logs; the final record replaces their results with the passing whole-file
rerun, including the affected App file.

## Negative controls

Two model-text split controls are green → red → restored green. One injects
the commit sentinel into `dist/extension.js`; the gate rejects Git text in
activation. The other removes that sentinel from `dist/conversationGit.js`;
the gate rejects missing text in the reader. Each restored bundle is
byte-identical by SHA-256. The native ownership comparator is also drilled:
comparing the captured identity to itself instead of the current identity
fails five real-junction ownership cases. The whole file passes after
byte-exact SHA-256 restoration. This source drill preceded final import-only
formatting; the final compilers and repaired-file lint pass. Exact receipts
are in the verification JSON.

## Open browser-size gate

The final merged production browser bundle is 935,470 bytes (913.5 KiB) against
the unchanged 900 KiB cap. A read-only Git-source overlay build of
`main-sync` with the same production browser options emits 910,023 bytes
(888.7 KiB). The combined features add 25,447 bytes. Every Node bundle fits
its existing cap; the split gate passes after registration.

Activation is 584,274 bytes (570.6/600 KiB), the Model API is 439,716 bytes
(429.4/475 KiB), and conversation Git is 103,617 bytes (101.2/150 KiB).

The lane stops this size-repair path under the shared bounded-scope rule:
an unrelated browser refactor or new browser loading architecture belongs
to the lead. No feature, cap, threshold, timeout, hook or gate is weakened.
This merge is not aggregate-green or ready to release while the browser
size gate fails. Full quality, hosted/native editor proof and publication
remain lead-owned.
