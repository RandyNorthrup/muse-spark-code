# MSM9M35 certification — M9 + M35: dictation in other editors; Muse Voice

Lane branch `ms/msm9m35`, worktree `/Users/randy/lanes/MSM9M35`, rig `macmini`.
Base: `rigs/macbook/c/m35-2` (`d9470349b`); merged `main-now` (`3d30a7321`),
m9-linux (`1437fc9c5`), m35-mic (`05a5636b6`).

## What was merged from which branch

- `7f74e57f6` — main-now. Main's test-overhaul deletions stay deleted
  (9 fake/mock suites removed at merge, incl. `dictation`,
  `museVoice`, `voiceBundle`, `dictationHost`, `paidConsent`,
  `recorderHelper`, `usageRecording`, `conversationController`,
  `referenceGenerator` tests). Append-only files keep both sides;
  generated files (reference, roadmap, host-api) regenerated.
- `2daadc75e` — m9-linux: offline Linux dictation (whisper.cpp helper +
  tiny.en model as consented same-tag release assets, D140 — renumbered
  from the branch's D106, which main already uses for the MCP connector
  draft; renumbered in PLAN, CHANGELOG, Q67 row and 8 source/script
  comments). The branch's fake/mock suites
  (`linuxDictation*`, `linuxHelperPins`, `dictationChild` fake,
  `linuxDictation.real` e2e, wav fixtures, C probes) stay out per owner
  rules. One real fix at merge: `linuxDictation.reset` awaits the driver
  dispose, `dispose` marks it `void` (hook-caught
  `@typescript-eslint/no-floating-promises`).
- `465a5c56d` — m35-mic: ACP/CLI browser-page microphone held behind
  `COMPANION_VOICE_RELEASE` (`isReady: false`, `src/shared/companionVoice.ts:7`);
  `dictate.ps1` ships in the ACP package; `/dictate` is announced only when
  its factory is bound (`src/acp/agent.ts:573`); the stereo mix happens in
  float space before PCM clipping (`src/shared/companionWav.ts:31`);
  companion Send stays inert until admission (`src/runtime/companion/voiceHandler.ts:156`).
  Candidate fake suites (`companionVoice*`, drills, browser/cli/page/paid/system)
  stay out. Merge resolutions: `availableCommands()` keeps the dictate entry;
  `main.ts` keeps HEAD's `sharingDeps()` and gains `runtimeDictation()`;
  accounting keeps HEAD's per-scope daily cap; `voiceCompanion.js` joins the
  central `ACP_BUNDLES` list instead of a hardcoded copy. Four branch
  stragglers whose fake helpers main deleted (`museVoiceSocket`,
  `voiceRecorderAdmission`, `fakeHelperChild`, `fakeParentSession`) removed —
  they broke `typecheck:unit`.
- `1824d3271` — `dist/voiceLinux.js` split (D6, D140): the combined drivers
  pushed `dist/voice.js` 1.1 KiB over its unchanged 50 KiB cap
  (52,376 B). Linux's driver, helper/model acquisition and pins now load on
  the first Linux recording via `voiceLinuxLoader`
  (`src/host/voice/voiceBundle.ts:76`); `voice.js` is 43,347 B again.
  New bundle 35,907 B measured, 50 KiB budget by formula; no existing cap
  changes. Registered in build, deferredBundles, size/split/host-globals/
  notices gates, `.vscodeignore`, `REPORT_PACKAGE_FRAME_PATHS`, knip,
  lazy registry, release pins path (`--bundle dist/voiceLinux.js`).
- `f30aff390` — `test/unit/companionWav.test.ts`: pure float-space mix,
  canonical mono round-trip, shape refusals through the real module, no
  stand-ins. Red drills: int-space mix fails the first case; inverted
  channel check fails two cases; both restores byte-exact (sha256
  `e52d1eee…cb04c`).
- `ce34d417f` — removes `linuxHelperBytes`, orphaned by the fake-test
  deletion (knip).
- `4eada1533` — companion tunables move `src/shared/constants.ts` →
  `src/shared/companionVoice.ts` (D6 activation diet; ~60 B).
- `14b1520ae` — `voiceLinuxEntry`, companion `voiceEntry` and webview
  companion registered in `cycles.json`, spawn inventory and the INT0170
  combined record.
- `4bf0e74c3` — PLAN §7 deferral entry (see Gates).
- Diet attempt reverted: moving the Linux download-consent card into
  `dist/voiceLinux.js` saved 456 B of activation but broke `npm run build`
  (`vscode` is deliberately not external to deferred bundles — a stray
  import fails the build by design) and fought the M93 precedent (host
  capabilities arrive as parameters, here `LinuxDictationDeps.consent`).
  Reverted byte-identical; consent stays an activation closure.
- `4a8279e10` — every UI table's key order matches EN recursively
  (companion block, `muse-voice` cli option, museVoice block); the archive
  restores in EN order, so the vsix round-trip failed until this.
- RVMSM9M35FIX activation attribution (2026-10-17, linuxlt): the budget
  test builds `src/extension.ts` with the test's own externals, so only
  modules reachable from activation count. Rebuilding that bundle with
  each lane-changed activation file reverted to `main-now` `3d30a7321`
  (minified bytes; scratch scripts, since removed) attributes the lane's
  4,351 B exactly (reverted tree builds 564,215 B, the recorded main-now
  number; lane tree 568,566 B). Single-file revert savings:
  `src/host/voice/dictationHost.ts` 1,507 (source 8,005 B:
  `createDictationSetup` with the Linux disabled-model cleanup and
  `canDownloadLinuxModel` consent card, plus `createMuseVoiceSetup`);
  `src/extension.ts` 1,364 (M35 paid-scope wiring: `museVoiceSetup`,
  `ownedVoiceBudgetScope`/`voiceAccountId` closures, dictation setup
  call); `src/core/voice/helperLocation.ts` 298 (source 10,203 B: Linux
  probe additions); `src/host/settings.ts` 81; `src/core/paid/paidFeatures.ts` 21. `src/host/voice/voiceBundle.ts` (source 5,650 B: `voiceLinuxLoader`,
  `ownedMetaVoiceBudgetScope`), `src/shared/constants.ts` (lane adds the
  `LINUX_DICTATION` block, `VOICE_LINUX_BUNDLE_FILE`, `MUSE_VOICE_FRAME_*`
  /`MAX_*` tunables, two `linuxDictationModel` settings rows) and
  `src/shared/paid.ts` are structurally coupled to the others and cannot
  revert alone; they hold the ~1,080 B remainder. Already off the
  activation path (verified absent from the bundle metafile): the
  `dist/voice.js` drivers, the `dist/voiceLinux.js` driver/acquisition/
  pins (`linuxHelperPins.ts` included), `companionVoice.ts`/`companionWav.ts`
  (companion/ACP side only), and all `en.ts` strings (externalised to
  `dist/uiText.js` by the test). The 3,072 B cap is a project rule
  (PLAN.md lane-K budget, Q-M78b the revisit precedent), not an
  owner-set limit.

## What was finished (connections, file:line)

- Free dictation, panel: composer microphone → `createDictationSetup`
  (`src/extension.ts:1531`) → OS engine on Windows/macOS, offline Whisper
  tiny.en on local Linux x64/arm64 after one consent card
  (`src/host/voice/dictationHost.ts:98`), `linuxDictationModel` on by
  default, `false` removes helper+model+partials.
- Paid Muse Voice, panel: bounded realtime on the Model API backend
  (CM352, carried): one owner per recording, 3-minute bound, paid-gate +
  budget/account/context admission, settle from reported duration.
- Other editors: ACP `/dictate` + `muse-voice` CLI flag exist but stay
  UNRELEASED behind `COMPANION_VOICE_RELEASE.isReady = false`; only the
  lead removes the hold after mic receipts (breakdown note). ACP/headless
  have no realtime microphone surface of their own.
- Help reference (`docs/reference.md`, generated) and README carry the
  Linux offline behavior, the `linuxDictationModel` row and the hold.

## Gates (exit codes, final tree)

- `npm run build`: 0 (`voice.js` 42.3 KiB ≤ 50, `voiceLinux.js` 35.1 KiB ≤ 50).
- `npm run typecheck` (all 5 projects): 0.
- Lint: `lint:js:unit`, `lint:js:tests`, `lint:css`, `lint:ps`: 0;
  whole-repo `lint:js:main` did NOT complete on macmini (V8 OOM, below),
  so `npm run lint` as a whole has no green result on this lane;
  `prettier --check .`: 0. Review RVMSM9M35 re-ran ESLint on all 50
  lane-changed TypeScript files on linuxlt: 0 problems.
- `npm run deadcode` (knip): 0. `node scripts/cycles.mjs`: 0, no cycles.
  `jscpd`: 0 clones.
- `node scripts/check-l10n.mjs`: 0 problems. `gen-reference --check`: 0.
  `check-host-api`: 0. `check-plan`: 0 drift. `gen-roadmap --check`: 0.
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: 0, 533 rules,
  0 findings (needs `SSL_CERT_FILE=/etc/ssl/cert.pem` on this rig: the
  bundled CA store is empty, semgrep crashes without it).
- `npm run security:audit`: 0 (2 advisories, 1 exceptioned).
- Touched suites: `companionWav` 3/3; vsix/packagedBundles/manifest/
  helperLocation/acpPackageFixtures 172/172; `usagePackaging` 9–11/12 —
  remaining failures are 5 s-timeout flakes on 7–10 s packaging cases;
  unmodified main fails the same 5 cases on this rig (environmental).
- `test/e2e/acpStdio`: 13/13. `test/e2e/execStdio`: 46/46 pass; the
  file-level `afterAll` cleanup hook exceeds its 10 s timeout on this rig
  (environmental, unrelated to the product).
- New-gate fire proof: the `companionWav` red drills above; the l10n
  round-trip failures (15) caused by this lane's own merges, fixed by
  `4a8279e10`; knip's `linuxHelperBytes` flag from the fake-test deletion.
- GREEN since RVMSM9M35FIX (PLAN §7 deferral closed, no cap change):
  `test/unit/modelsActivationBudget.test.ts` — baseline 561,352 B,
  current 563,929 B, growth 2,577 B vs the 3,072 B lane-K cap (495 B
  headroom). The setups moved off activation into the new
  `dist/dictation.js` (13,032 B measured, 25 KiB budget by the
  measured-plus-15% rule): `dictationEntry.ts` (entry),
  `dictationHost.ts` (host capabilities as parameters, the M93 precedent —
  deferred bundles keep no `vscode` import), `voiceBundle.ts` and
  `helperLocation.ts` (whole, with their pre-existing bytes);
  `LINUX_DICTATION` moved to `src/shared/linuxDictationConstants.ts`
  (re-exported, the browser-check precedent). Per-module attribution came
  from rebuilding the budget-test bundle with each lane-changed activation
  file reverted to `main-now` (scratch scripts, since removed: reverting
  all eight builds exactly the recorded 564,215 B; single-file savings
  dictationHost 1,507, extension wiring 1,364, helperLocation 298,
  settings 81, paidFeatures 21). Activation keeps only
  `dictationBundle.ts` (loader, ~2.7 KB source) plus the same calls at the
  same construction points with the installed table, so timing and
  behaviour are unchanged; a bundle that cannot load leaves both
  microphones unavailable (`dictationNotLoaded`, the log has the cause).
  Split-gate fire drill: a value import of the entry from the activation
  shim fails `npm run build` with "`dist/extension.js` carries
  `src/host/voice/dictationEntry.ts`, which loads only on the window
  dictation setup construction"; reverted byte-exact, green again.
  Real-use proof (scratch Node script against the built bundles, since
  removed; outputs: `DICTATION_BUNDLE_OK`): the built `dist/dictation.js`
  required in Node constructs both setups — Linux without recorders reports
  its honest unavailable reason, win32 reports available with a driver
  factory, Muse Voice constructs; `dist/extension.js` carries none of
  `removeLinuxDictationModel`, `createLinuxDictation`,
  `locateDictationHelper`, `muse-dictate` or `dictation-linux`.
- Final full `npm run test:unit` on the final tree (exit 1): 543 files
  passed, 5 failed; 9,265 tests passed, 9 failed, 91 skipped. The 9 are
  all outside the lane's touch surface (no lane file under
  `src/core/resources`, `src/shared/resources`, or the slots modules):
  `fileLease` 4 (sandbox process-birth inspection),
  `treesLifecycleNative` 2 + `treesMacNative` 1 (native zombie/kill
  process control under the sandbox), `checkSlots` 1 (timing flake —
  passes 18/18 isolated), and the deferred budget test 1. Fixed during
  the lane: `cyclesRoots` 3, `bundleDiet` 1, `spawnInventory` 1 (all green
  isolated now).
- `npm run lint`: `lint:js:unit`, `lint:js:tests`, `lint:css`,
  `lint:ps` all exit 0; `lint:js:main` (whole-repo eslint) aborts twice
  with V8 out-of-memory at its pinned 6 GiB heap on this shared rig, on
  a tree whose sources are byte-identical to the earlier green run
  (only PLAN/cert markdown committed since). Environmental: changed
  files pass the repo's own pre-commit hook on every lane commit.

## Real-life steps for the lead

1. Windows/macOS: press the composer microphone, speak, check the text
   lands; first Muse Voice press shows the paid popup with hourly price
   and daily budget.
2. Linux x64/arm64: press the microphone → one consent card names the
   helper (~7.6 MB, release assets) and model (74 MiB); after download,
   offline dictation works with no network; `linuxDictationModel=false`
   removes both.
3. Packed hold proof (done here): `node dist/acp.js --help` lists no
   `dictate`, no `--muse-voice`; `node dist/acp.js dictate` answers
   `Unknown argument: dictate`.
4. Still owed (lead, physical): mic receipts on Mac and Windows; release
   helper/model assets; then remove `COMPANION_VOICE_RELEASE` hold.

## RVMSM9M35 review addendum (2026-10-17, linuxlt, PR #224)

- Merged current main `81dacaf5a` (`492e1e84e`). One content conflict
  (`build.yml` linux-native-build name/guard: kept both sides) and six
  modify/delete conflicts: main deleted `test/e2e/modelApi.live.e2e.test.ts`,
  `test/unit/{acpPackageFixtures.test.ts, helpers/acpPackageSources.ts,
manifest.test.ts, usagePackaging.test.mjs, vsixPackaging.test.mjs}`
  in `33150b3cf` ("delete every fake test"); the deletions stand and this
  lane's edits to those files are withdrawn with them. The two stand-ins
  the review named lived there (`vi.stubGlobal('fetch', …)` at
  modelApi.live:1472, a `vi.fn()` logger at vsixPackaging:667) and are
  gone with the files. The suite tallies above that cite those files
  (172/172 incl. `acpPackageFixtures`; `usagePackaging` 9–11/12 and its
  APP PROBLEMS row) are historical runs on the pre-merge tree; no
  current claim rests on them.
- The m9-linux merge note above ("`dispose` marks it `void`") is
  superseded: `LinuxDictation.dispose` and the bundle entry's handle now
  return the driver's cleanup promise, and `reset()` publishes `idle`
  (`3bae1ee1e`). The CHANGELOG's "Allow once covers the window" for Muse
  Voice is corrected to one recording (`ab631cd75`; reference
  regenerated, consent `use`).
- PR #224 Codex threads fixed at cause: pin checker after `npm ci`
  (`ab7f92f28`, proven `ERR_MODULE_NOT_FOUND: esbuild` in a clean
  worktree); SHA256SUMS helper basenames (`c91bb467e`, drilled with
  real `sha256sum -c`); recorder ownership after a refused kill
  (`479bcb2a5`); idle after a failed voice stream (`c7a80a94c`).
- PR #224 new Codex threads, all fixed at cause (lane PR224FIX,
  linuxlt, commits `29b48c4ce`..`c5913257c8` plus the test-narrowing
  `3909e2decc`):
  - Double-refused kill (`dictation.ts`): `finishFail` kept the reaping
    on an unobserved exit, `start()` queues behind any reaping, and
    `retainUntilExit` retries the kill until the exit is seen; only
    then idle and the queued press. Proven with
    `test/unit/dictationRefusedKill.test.ts` (scripted host-seam child:
    a real process cannot refuse its kill): the queued-press case
    fails before the fix, the idle-without-pending and clean-quit
    paths are locked. Named 10 s per-test timeout: the failure
    settles only after two sequential 2 s quit-grace waits.
  - Stale cleanup directory (`voiceLinuxEntry.ts`): removal now rmdirs
    the dictation directory with its managed files (ENOENT tolerated,
    anything else loud), so reloads stop relaunching cleanup. Proven
    with `test/unit/linuxDictationRemoval.test.ts` (real filesystem;
    two cases fail before the fix).
  - Unpublished CPU variants (`linuxHelperPins.ts`, both pin scripts,
    both workflows, CMakeLists, D140): all 8 x64 + 8 arm64 Linux
    backends the `GGML_CPU_ALL_VARIANTS` build emits (verified against
    whisper.cpp v1.7.6 `ggml/src/CMakeLists.txt`) are pinned, staged,
    checked and refused from the VSIX; the stamper reads and writes
    prettier's broken pin form. Proven with
    `test/unit/linuxHelperPins.test.mjs` (manifest equals the build's
    install set; all three fail on the five-file manifest) and a stamp
    round-trip drill (prettier-clean under the repo config, idempotent
    restamp, checker shape+values clean on the stamped module). Card
    byte size still the five-file number: D140 records the re-measure
    at release (lead to confirm).
  - Empty download lock (`linuxModel.ts`): an empty `.download-lock`
    is reclaimed instead of busy-forever (Windows, where staging
    rename collides; Linux rename replaces it — confirmed by probe).
    Proven with `test/unit/linuxDownloadLock.test.ts` (real
    filesystem: empty reclaim, live refusal, dead reclaim).
- Gates on the lane tree (exit codes): typecheck 0; ESLint 0 warnings
  on all eleven lane-changed sources; Prettier clean; check:plan 0
  drift; check:l10n 0 problems; build 0 (caps hold);
  modelsActivationBudget 1/1 (growth 2,612 B ≤ 3,072 B cap, unchanged).
  Suites (repo-default timeout, except the named case above):
  dictationRefusedKill+linuxDownloadLock+linuxDictationRemoval 9/9;
  linuxHelperPins+helperLocation+dictationGesture 22/22.
- Gates on the merged tree (exit codes): typecheck 0; ESLint 0 and
  Prettier 0 on every review-changed file plus the three surviving
  lane test files; check-l10n 0; check:reference 0 (after regenerate);
  deadcode 0; cycles 0; duplication 0; check:roadmap 0; check:host-api
  0; check:plan 0; build 0 (`voice.js` 42.3 KiB, `voiceLinux.js`
  35.1 KiB, `dictation.js` 12.7 KiB). Tests (repo-default timeout):
  companionWav+helperLocation+linuxHelperPins 21/21;
  paidMoneyStructure+paidConsentBundle+dictationGesture 50/50;
  modelsActivationBudget 1/1 (growth 2,612 B ≤ 3,072 B cap). Packed
  drill: `node dist/acp.js --help` lists no dictate/`--muse-voice`;
  `node dist/acp.js dictate` → `Unknown argument: dictate` (exit 1).
  Stand-in grep over the surviving lane-changed test files: no hits.

## APP PROBLEMS

- `usagePackaging` cases take 7–10 s on this rig vs the 5 s repo timeout;
  main fails identically — environmental, not a regression. No timeout
  raised (CI default must stand).
- `security:sast` needs `SSL_CERT_FILE=/etc/ssl/cert.pem` here.
- `scripts/l10n-pack-diag.mjs` named in the lane brief does not exist
  in-tree; `check:l10n` + the vsix round-trip cover its ground.
