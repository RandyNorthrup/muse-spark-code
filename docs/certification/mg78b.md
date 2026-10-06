# MG78b: current-main merge, 2026-10-04

Scope: join `origin/main` `77800e8f17a485558824dc4a2f4df5708e91791f` into
`feature/m71-git-prs`, starting at `8a796842`. The lane has a hard 60-minute
box and reserves full quality, hosted/editor certification and publication
for the lead. No origin push, live/paid calls, budget changes or gate bypass.

## Conflict resolutions

| File                                              | Resolution                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/build.yml`                     | Retain every main VSIX member and add conversationGit.js.                                                                                                  |
| `.vscodeignore`                                   | Ship Git plus all main lazy bundles.                                                                                                                       |
| `PLAN.md`                                         | Keep both milestone/deferral records and escape-hatch rows; use main budgets plus Git. No decision IDs collide.                                            |
| `README.md`                                       | Describe both Git and Review lazy loading; retain bundled-skills installer in layout.                                                                      |
| `THIRD_PARTY_NOTICES.txt`                         | Retain main package notices and add Git to artifact list; regeneration checked after build.                                                                |
| `docs/certification/README.md`                    | Keep M71 and main M82 entries.                                                                                                                             |
| `docs/ide-compatibility/host-api.md`              | Regenerate from merged source.                                                                                                                             |
| `knip.jsonc`                                      | Union all lazy entry points.                                                                                                                               |
| `l10n/ui.cs.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.de.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.es.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.fr.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.hu.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.it.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.ja.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.ko.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.pl.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.pt-br.json`                              | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.ru.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.tr.json`                                 | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.zh-cn.json`                              | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/ui.zh-tw.json`                              | Three-way JSON helper: main object plus branch key additions/changes, retaining real translations.                                                         |
| `l10n/untranslated.json`                          | Union allowed English keys without duplicates.                                                                                                             |
| `package.json`                                    | Keep both command sets and all cycle entry points; retain main dependency pins.                                                                            |
| `scripts/build.mjs`                               | Build/watch/report every main bundle plus Git.                                                                                                             |
| `scripts/check-bundle-size.mjs`                   | Keep main budgets (including uiText 125 KiB) and Git 150 KiB; activation remains 600 KiB.                                                                  |
| `scripts/check-bundle-split.mjs`                  | Keep Git isolation checks and main installer/first-use/review checks.                                                                                      |
| `scripts/check-host-globals.mjs`                  | Check every main bundle plus Git.                                                                                                                          |
| `scripts/lib/harnessServer.mjs`                   | Keep four Git scenarios plus main Auto reviewer scenarios.                                                                                                 |
| `scripts/third-party-notices.mjs`                 | Enumerate every main artifact plus Git.                                                                                                                    |
| `src/core/redact.ts`                              | Keep broader seven-prefix M71 Slack pattern, including xoxe; main changes elsewhere retained.                                                              |
| `src/extension.ts`                                | Keep Git and Review/board/skills wiring; remove duplicate popup import; pass native guard after stdin slot.                                                |
| `src/host/conversation/conversationController.ts` | Keep Git generation submission/completion, shared acceptSubmission and reviewer note; held-worktree refusal precedes main mode-selection/Plan-hold fences. |
| `src/host/git.ts`                                 | Preserve untrusted argsBefore and automatic program checks; preserve stdin, prepare and final synchronous ownership guard.                                 |
| `src/shared/constants.ts`                         | Union Git, Review and bundled-skills state/constants/commands.                                                                                             |
| `src/shared/protocol.ts`                          | Keep Git messages and Review pane messages.                                                                                                                |
| `src/webview/state/uiState.ts`                    | Keep Git form and Review card/pane actions.                                                                                                                |
| `test/e2e/modelApi.live.e2e.test.ts`              | Keep both captured Git draft and Review cases/imports. Live tests remain opt-in; no paid run.                                                              |
| `test/unit/App.test.tsx`                          | Keep complete Git and best-of-N refusal groups with separate closures.                                                                                     |
| `test/unit/conversationController.test.ts`        | Keep both fixture ports/imports and complete Git/Review suites.                                                                                            |
| `test/unit/git.test.ts`                           | Keep both untrusted-checkout and automatic-Git suites; move M71 guards to fifth argument.                                                                  |
| `test/unit/paletteRegistry.test.ts`               | One test title describes both Git and Review order; both expectations retained.                                                                            |

The main runner gained a stdin parameter before its native-entry guard.
M71 held/own-PR calls and native fixture forwarding use that fifth argument;
the worktree adapter keeps its existing four-argument API and passes an
empty stdin slot at the process boundary. Its activation assertion follows
the new signature. No new abstraction, dependency, product setting or UI key.

## Verification

Checks pending; this record is not certification yet. The first Win11 full
configured run uses slot `mg78b`, snapshot `066dfc95`; 210 direct test owners
import the conflicted constants/protocol, exceeding the brief's 30-file
threshold. Existing live/platform skips remain unchanged.

The first host typecheck exposed the signature seam and duplicate popup
import before correction. Local `npm ci` completed using main's lockfile:
898 packages installed, 11 advisories (2 low, 9 high). No dependency repair
or audit suppression is attempted in this merge lane.

Changelog helpers keep five branch-added bullets; independent comparison
confirms released sections byte-identical to main. Every parent manifest
command and main lazy bundle is retained.

## Remaining work

Serial static gates, production build/size report and four M71 axe scenarios
must finish. The brief reserves an activation overflow for the separate
activation-diet lane; this lane must report it without moving code or
changing the cap. Lead still owns full quality, editor/hosted proof and push.

## Duplication repair

The first duplication gate failed on two clones: main's automatic Git
version validation against M71's untrusted Git validation, and M89's
in-memory memento against M71's existing fixture. Both keep the same
behavior: version parsing now has one function in the existing Git module
called by both lanes with their unchanged minimum constants; the existing
memento fixture accepts initial values, and M89 reuses it. No module,
layer, gate exclusion or threshold is added. Owning checks must rerun
after this correction; the first full rig snapshot predates it.

The next unit typecheck exposed two additional four-argument native fixture
assignments in `checkpointWorktrees.test.ts` and `worktreeCommands.test.ts`;
both now bridge the empty stdin slot before forwarding their guard. The
production host and webview projects passed that run. The complete unit,
e2e and integration projects must pass after these fixture corrections.

## Production build on corrected source

`npm run build` exited 0. Every size budget, bundle-split, host-global and
third-party-notices check passed (83 bundled packages). Activation is
612,854 bytes, 598.5 KiB against 600 KiB. No activation move or cap change.

| Artifact                   |  Bytes |   KiB |
| -------------------------- | -----: | ----: |
| `dist/acp.js`              | 820357 | 801.1 |
| `dist/agentImport.js`      | 118805 | 116.0 |
| `dist/bundledSkills.js`    |  23405 |  22.9 |
| `dist/checkpointStore.js`  | 138913 | 135.7 |
| `dist/codeIntel.js`        |  78734 |  76.9 |
| `dist/conversationGit.js`  | 130961 | 127.9 |
| `dist/extension.js`        | 612854 | 598.5 |
| `dist/modelApi.js`         | 441939 | 431.6 |
| `dist/museCodeReviewer.js` |  43729 |  42.7 |
| `dist/pageWorker.js`       | 208040 | 203.2 |
| `dist/planMarkdown.js`     | 142363 | 139.0 |
| `dist/review.js`           |  44171 |  43.1 |
| `dist/reviewer.js`         |  55877 |  54.6 |
| `dist/searchWorker.js`     |  18571 |  18.1 |
| `dist/sessionBoard.js`     |  63504 |  62.0 |
| `dist/uiText.js`           | 117841 | 115.1 |
| `dist/voice.js`            |  35501 |  34.7 |
| `dist/webview/main.css`    |  45663 |  44.6 |
| `dist/webview/main.js`     | 906451 | 885.2 |

The scoped lint attempt was stopped only after verifying its MG78b
process/parent chain, to reserve the hard-box remainder for build and axe.
It is unproved, not green; no rule, threshold or hook is bypassed. The
serial gate driver stopped with it. The rig remains untouched and active.

## Final bounded receipts and blockers

The final unit, e2e and integration TypeScript projects exited 0 after the
fixture corrections. Host and webview projects passed earlier; no behavior
change followed except the shared Git validator already compiled by unit.
Scoped Prettier exited 0. Knip exited 0 with the inherited `vendor/**`
configuration hint. Duplication exited 0 with zero clones (the two-clone
failure above proves that gate fires). Cycles exited 0 for 421 files.
Localization and regenerated host API exited 0. Released changelog bytes
match merged main. `npm run build` and all its component gates exited 0.

`node scripts/a11y.mjs git-held git-commit git-pr git-pr-narrow` exited 0:
16 pages, zero violated/undecided rules, zero pages without a result. Axe
could not measure contrast on 68 covered or scrolled-out elements; this is
its existing reported measurement limit, not a newly added exemption.

Win11 slot `mg78b`, full configured run, snapshot `066dfc95`:
2 files failed, 358 passed, 4 skipped (364 total); 1 test failed, 7,236
passed, 80 skipped (7,317 total), exit 1, duration 2,331.74 seconds. This
run predates the duplication repair and the last two fixture bridges.

- `test/e2e/execStdio.e2e.test.ts`: suite setup throws
  `M80 D guards require installed Bash; no shell was started`.
- `test/unit/execRun.test.ts`: D9 held response deadline expects uncertain
  cost `0.108135` and an upper bound, but receives uncertain cost `0`.

Both failing files are byte-identical to merged main. That does not prove
the failures are unrelated to integration: preserve and resolve them, and
rerun their complete files and the corrected owning Git/fixture files.
Never skip the Bash-dependent suite or change the cost assertion/deadline.

The merge remains uncommitted because rig failures and scoped lint are
open. No origin push, bypass, budget change or partial merge commit.
Resume from this index/MERGE_HEAD; finish scoped lint, owning rig reruns
including the two failures, then commit using the prepared message in
`temp/mg78b/merge-message.txt` with hooks. Full quality and editor/hosted
certification remain the lead's separate gates. All raw logs are under
`temp/mg78b/`.

## Follow-up, 2026-10-04

Scoped lint now passes, and the Codex merge review's P2 (held-worktree trust
for main's Best-of-N, session board and Git review) is fixed in the same
merge commit: see `m71.md`, "2026-10-04 merge review fix". The two Win11
failures above were not rerun there and remain open.
