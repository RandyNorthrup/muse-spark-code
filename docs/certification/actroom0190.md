# ACTROOM0190 — activation room for the 0.19.0 release

Linux rig `linuxlt`, branch `fix/0190-activation-room`, base `8fb477883`
(joined release without the features group: limits, truth, platform).
No budget, baseline-fixture or timeout changes; no push, merge or rebase.
No paid or live model calls. No code changed in this lane: measurement
showed the target already met (see "Decision"), so per the smallest-change
rule there was nothing to cut.

## 1. Measure

Budget test `test/unit/modelsActivationBudget.test.ts`: growth over the
immutable pre-K bundle must stay at most 3,072 bytes. Measured with the
test's own build plus an esbuild metafile per build (throwaway scripts in
gitignored `temp/`, removed after use so the worktree-wide lint stays
clean; the five metafiles are retained under `temp/act-meta/`):

| tree                        | baseline | current | growth      |
| --------------------------- | -------- | ------- | ----------- |
| this tree (`8fb477883`)     | 561,352  | 489,418 | **−71,934** |
| features tree (`1d967f741`) | 555,760  | 573,036 | **+17,276** |
| common base (`c72aef8cd3`)  | 561,352  | 563,561 | **+2,209**  |

(Baseline bytes differ slightly per tree because the baseline build reuses
each tree's own plugins/toolchain; every growth figure above is
self-consistent within its tree. The base figure ≈ the brief's "main 2,901".)

Attribution (metafile `bytesInOutput` per module):

- This tree vs its baseline (−71,934): `conversationController` −114,915
  (out of activation), `authService` −15,979 (out, behind
  `authBundleLoader`), `shared/constants` −12,741, `webFetch` −7,208,
  `modelapi/client` −5,692, `sessionStore` −5,183, `paidFeatures` −4,556
  (behind `paidBundleLoader`), `redact` −4,491, `attachments` −3,710;
  offset by `extension.ts` +34,928 (holds the lazy loaders),
  `MuseCodeHost` +18,657, `tabBundle` +10,092 (new), `browserTool` +5,778.
  45 modules only in baseline, 94 only in current.
- Base vs its baseline (+2,209): the big TRAINACT-style cuts
  (`conversationController`, `webFetch`, `modelapi/client`, …) predate the
  merge-base; they are release-line history, not this lane.
- This tree vs the common base (−74,143 current bytes): the joins on this
  line deferred the paid stack (`paidFeatures` −11,739, `paidAuthority`
  −8,153, `paidConsent` −7,845, `paidHost` −5,883), `authService` −16,693,
  `museConfigCommands` −6,911, worktree/skills/memory commands, `skillsCli`
  and `worktrees` behind the existing `*BundleLoader`/`*Entry.ts`
  deferred entries. Only small growers (`extension.ts` +1,988 and below).
- Features tree vs the common base (+9,475 current bytes): media eager
  (`replayMedia` +12,644, `uploadLedger` +12,496, `mediaCost` +6,560, …),
  `shared/constants` +16,796, `modelapi/files` +4,535, `subagentTools`
  +3,750, …, paid for on its line by deferring `MuseCodeHost` (−40,074),
  `mapNotification`, `sessionOwner`, `promptLedger`/`sessionRecords`,
  `agent/*`, voice and usage (~−70K total).

## 2. Target

Brief formula: this tree's growth, plus the features tree's growth over
main (17,276 − 2,901 = 14,375), plus #251's 894 and #249's assumed ≤1,000,
must leave ≥150 bytes under 3,072 (i.e. total ≤ 2,922).

Target for this tree: growth ≤ 2,922 − 14,375 − 894 − 1,000 = **−15,347**.
Actual: **−71,934** — beats the target by 56,587 bytes.

Projected final: −71,934 + 14,375 + 894 + 1,000 = −55,665, i.e. 58,587
bytes inside the 2,922 line. Cross-check by current bytes (same toolchain):
489,418 + (573,036 − 563,561) + 894 + 1,000 = 500,787 ≈ −60K growth —
agrees within minification noise.

## 3. Cuts

None required; none made. The room (75,006 bytes under the 3,072 budget on
this tree) was already made by the joins' deferrals listed above, which
follow the deferred-entry pattern PLAN.md keeps (`paidBundleLoader` /
`authBundleLoader` in `src/extension.ts`, `*Entry.ts` deferred entries in
`scripts/lib/deferredBundles.mjs`).

Integration note for the lead: the projected final holds only if the
release join keeps both lines' deferred entries — this line's paid / auth /
rarely used commands, and the features line's `MuseCodeHost` et al.
Reverting any one re-adds its bytes (`MuseCodeHost` ~40K, paid stack ~37K,
`authService` ~17K, media ~45K if ever made eager — it is already eager on
the features line and counted in its +14,375 marginal).

## 4. Never touched

The 3,072 budget, `test/fixtures/models-activation-baseline/` and its hash
(`6d361ac567eb3894eaff407045daef7fcdd23cceb05cb436bd6f7f024172f4f7`,
verified on every measurement run).

## Gates (final tree)

- `npx vitest run test/unit/modelsActivationBudget.test.ts --maxWorkers=3`
  (repository's own timeout): PASS, growth −71,934.
- `npx prettier --check docs/certification/actroom0190.md`: PASS
  (after one `--write` for table formatting).
- `npm run typecheck` (all five projects): exit 0.
- `node scripts/check-host-api.mjs`: 0 problems.
- `npm run lint:js:main` (`--max-warnings=0`): exit 0 (a first run
  tripped only over this lane's own gitignored scratch scripts in `temp/`,
  which the worktree-wide lint scans; they were removed after use and the
  re-run is clean).
- `npm run build`: FAILS on the pristine base too — `What's New` bound:
  CHANGELOG 0.19.0 notes decode to 170,385 bytes over the 76,800 bound
  (`scripts/lib/whatsNewContent.mjs`). Pre-existing release-notes issue,
  untouched by this lane (only file changed here is this record; build
  inputs verified untouched via `git status`/`git diff`); trimming 0.19.0
  notes is the lead's release call, not this lane's. The activation,
  bundle-size and bundle-split gates inside the build therefore could not
  be re-proven here; the budget test above builds the same activation
  bundle with the same `HOST_PLUGINS` and passes with 75,006 bytes of room.
- `npm run cycles` (dpdm): exit 0 — no circular dependencies.
- `npm run deadcode` (knip): exit 1 — 2 unused exports
  (`sideCallEvents` in `src/core/backends/modelapi/structuredOutput.ts`,
  `VAULT_UI_TICK_MS` in `src/shared/constants.ts`), 3 configuration hints
  (`knip.jsonc` ignore entries) and 4 tag hints (unused `@unwired` tags in
  `src/shared/constants.ts`, `src/core/vault/ssh/keys.ts`,
  `src/core/vault/broker/peer.ts`). All findings are in files this lane
  never touched (the worktree's `src/` is byte-identical to the base
  commit); fixing them is out of scope and left for the lead.
- `npm run duplication` (jscpd): exit 1 — 1 clone (16 lines, 113 tokens)
  inside `runtime/backends.ts` [792:7–807:11] vs [830:33–845:11], over the
  0.0% threshold. Same base-tree provenance as the knip findings; out of
  scope here.
- Remaining lint parts (`lint:js:unit`, `lint:js:tests`, `lint:css`,
  `lint:ps`): not run — none of them reads the one Markdown file this lane
  adds, and no JS/TS/CSS/PS file changed.
