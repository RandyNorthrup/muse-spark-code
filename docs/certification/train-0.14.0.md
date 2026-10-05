# TRAIN14A — Start the 0.14.0 release batch

Worktree `/home/randy/lanes/TRAIN14A`, branch `release/train-0.14.0`.
Base `7820bd30` (0.13.0 batch / PR #120). All commands run directly on Kubuntu.
The brief requires scoped checks only; the full quality, coverage, installed-editor
and hosted-platform gates belong to the later completed train. No push, rebase,
main merge, credential reads or paid/live calls. Existing caps stay unchanged.

## Ordered integration

| Source                        | Source head | Conflicts and resolution                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/m94-tab`             | `c70facee`  | 38 files: union PLAN decisions/milestones, constants, Knip roots, commands/settings, 14 UI tables and 15 manifest tables; retain D78's current descriptions and availability policy with Tab available on either backend. Combine D78 default availability and M94 first-use consent in the gate/host/tests. Retain the prior deferred UsageDialog. Regenerate the host API record. Start fresh Unreleased notes for Tab; released bytes stay identical to base. |
| `feature/m71-git-prs`         | `d992534f`  | 31 files: preserve the paid policy, Tab commands, current manifest descriptions and 15 translated manifest tables; union PLAN, README, workflow inventory and budgets. Retain all seven deferred surfaces and shared validation. Keep central redaction plus M71 PEM/Slack handling, secret approvals and git draft routing. Regenerate host API and notices. Update stale trust and bundle fixtures without changing guards.                                    |
| `feature/m100-multi-device`   | `0331ce14`  | 2 files: retain both sides of all three PLAN regions, adding D80, M100 acceptance and its lane receipts without renumbering. Add only the new docs-only connectivity note to Unreleased; released sections remain unchanged.                                                                                                                                                                                                                                     |
| `fix/checkpoint-copies-flake` | `424b6bff`  | 2 files: union PLAN open questions/scope, keep the deterministic real-filesystem test unchanged, and insert only its new Fixed note into Unreleased. Preserve the branch receipt and released bytes.                                                                                                                                                                                                                                                             |

## Production measurements

Budgets: activation 614,400 bytes; Model API 486,400; webview startup 921,600
including every eager chunk; optional webview JS 51,200; VSIX 2,252,800.

| After merge | extension.js | modelApi.js | Webview startup | Deferred JS |                      VSIX |
| ----------- | -----------: | ----------: | --------------: | ----------: | ------------------------: |
| M94         |      612,308 |     440,150 |         901,805 |      40,575 | 2,135,855 (helper absent) |

`npm run package` exits 0, including production size/split/global/notices gates
and the localization check on exact staged bytes. This archive lacks the macOS
helper and is **not** a CI-shaped size certificate. The previous train's actual
helper contributed 119,342 compressed bytes plus 164 bytes of ZIP overhead;
adding that contribution estimates 2,255,361 bytes, 2,561 over the unchanged cap.
The helper location has been requested because shared rules prohibit network
retrieval and reading another lane without authorization. CI-shaped certification remains pending; no placeholder helper is used.
The following repair supplies headroom before the next feature merge.

## Scoped checks

All Vitest invocations use at most three complete files with
`--maxWorkers=3 --testTimeout=120000`; commands run serially.

- M94: all 27 changed unit-test files pass, **992 tests**, no skips. The
  complete file list is the M94 diff's `test/unit/*.test.*` (helpers are
  typechecked and linted); provider/bundle/status run first, then the remaining
  suites in three-file batches. Changelog/version, What's New content and
  VSIX packaging add 30 passing integration checks.
- All five TypeScript projects, changed-source ESLint, localization (14 tables,
  152 manifest strings, zero problems), regenerated host API (322 APIs, zero
  problems), plain Knip and jscpd pass. Existing Knip configuration hints remain;
  duplication reports zero clones. No threshold/ignore is changed.
- Released CHANGELOG sections starting at 0.13.0 compare byte-identical against
  `7820bd30`; every later merge repeats this check. Unreleased has one Highlights
  block with only contributed-command Try markers and one each of Added,
  Changed, Fixed and Security.

## Integrated paid-policy drills

Both mutations run the whole `paidFeatures.test.ts`, exit 1, and restore the
source byte-exact. Restored paidFeatures/paidConsent/paidHost pass all 77 tests.

| Mutation                                             | Expected failure                         |
| ---------------------------------------------------- | ---------------------------------------- |
| Remove D78's default-availability branch from `isOn` | Default-on availability assertions fail. |
| Make `asksOnFirstUse` always return false            | Tab's no-turn-on-modal assertions fail.  |

Both before/after SHA-256 values for `src/core/paid/paidFeatures.ts`: `0c7efee68cb9af5bf5befb47a8d8532ce612b913911c4b07398335dd6a9b61b0`.

## M94 size recovery before M71

The prepared M71 tree exceeded activation and shared-English caps. Abort that
uncommitted merge, keep its resolved files privately, and first repair M94's
shared startup/package cost. The paid HTTP client now uses the existing checked,
retryable lazy loader; Tab and image calls create it when needed and never read
a stored key while constructing it. Production Node English and staged UI tables
use lossless Brotli compression; source/browser/ACP JSON stays unchanged. Decode
is bounded to 1 MiB, corrupt packed tables fall back to English through the
existing error path, and packaged localization compares exact decoded values.
No dependency, cap, locale, UI key, setting or command changes.

| Repaired M94 | extension.js | modelApi.js | Webview startup | Deferred JS | uiText.js | VSIX without helper | Estimated with prior helper |
| ------------ | -----------: | ----------: | --------------: | ----------: | --------: | ------------------: | --------------------------: |
| Before M71   |      603,473 |     440,260 |         901,818 |      40,575 |    47,353 |           2,071,485 |                   2,190,991 |

`npm run package` passes every existing build gate and staged localization;
all five TypeScript projects, changed-file lint/format, localization, host API,
Knip and jscpd pass. Recovery suites pass 113 tests across
modelApiBundle, ideImageTools, tabBundle, hostL10n, vsixPackaging, l10n and
deferredBundles. The actual universal-helper package is still unverified.

The following faults fail their whole owning test files, then restore exact
source bytes; restored tests pass. Factory validation: one failure; lost client
cache: three; doubled decode bound: one; ignored corrupt packed file: two;
compiled English replaced with an empty object: one.

| Fault               | File                                 | Before and restored SHA-256                                        |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| client-factory      | `src/host/backend/modelApiBundle.ts` | `e4fe62648b92e8376e698732183f665da7f12944d4c224ee2f4a281f06c8d198` |
| client-cache        | `src/host/backend/modelApiBundle.ts` | `e4fe62648b92e8376e698732183f665da7f12944d4c224ee2f4a281f06c8d198` |
| decoded-table-bound | `src/host/l10n.ts`                   | `011e2cc8f6c998f95022521958ab467059496ff37b9b8794753ec3b76e1bfe67` |
| corrupt-table       | `src/host/l10n.ts`                   | `011e2cc8f6c998f95022521958ab467059496ff37b9b8794753ec3b76e1bfe67` |
| english-roundtrip   | `scripts/build.mjs`                  | `43754943dc2f7c65920699c8bfe8f67fe0e7067eb6c4dbd98218ba8e9836a231` |

The packaged-table exact-value and paid-client activation split guards also fail
when their actual staged table/metafile is altered, then pass after byte-exact
restoration. Their receipts:

| Fault                | Artifact                               | Before and restored SHA-256                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| packaged-table-exact | `dist/vsix-package/l10n/ui.de.json.br` | `d268f44b9367227e9944173fd3f371f025764fe4e6e30d6807e4c2d0b10c7c98` |
| paid-client-split    | `dist/meta/extension.json`             | `22654eda4cef7fb26df8b6ada6119d8141a1cff8ac879be0cdcf75a947b46251` |

## M71 final integration

All **37 complete changed unit-test files pass: 1,524 tests**, plus one existing
Windows short-path-alias conditional skip in gitWindowFileSystem (not runnable
on Kubuntu). The restored trust guard adds six passing assertions. All five
typecheck projects, changed-source ESLint, CSS lint, format, localization,
regenerated host API (328 APIs), Knip, jscpd and production package pass.
No duplicate keys occur in the 29 translated tables. Released changelog bytes
remain equal to the base. Source branches' live/paid probes are not rerun.

The inherited trust wiring test first failed on the added Tab/web-fetch trust
inputs. The initial allowlist kept both; final review found that Tab runs git
and corrects its binding below. Web-fetch availability remains a non-git input;
its request path separately uses project trust. Retain the exact allowlist and
held-project checks. The
inherited webview fixture first failed on missing What's New assets, an optional
950 KiB fixture exceeding the prior train's 50 KiB cap, and the old missing-file
wording. Include the real extra page inventory, use a 49 KiB optional fixture
(still proving exclusion from startup), and assert ENOENT plus the missing path.
No production guard is loosened. The central redactor first failed two M71 PEM
assertions; union its whole-block-first behavior and Slack prefix with M92's
existing shared token detection. Redact/approval-secret suites then pass 139.

At Brotli quality 8, the helperless package was 2,161,281 bytes; its estimated
CI shape exceeded the cap by 27,987. Set the same lossless compressor to quality
11; decoded values do not change. Round-trip, host-language and package suites
pass 38 tests at that level, and exact staged localization remains mandatory.

| Final M71   | extension.js | modelApi.js | Startup | Deferred JS | uiText.js | VSIX without helper | Estimated with prior helper |
| ----------- | -----------: | ----------: | ------: | ----------: | --------: | ------------------: | --------------------------: |
| Before M100 |      612,879 |     442,609 | 918,663 |      49,761 |    46,653 |           2,116,109 |                   2,235,615 |

The real-helper estimate fits by 17,185 bytes; actual CI-shaped certification remains open.

New integration checks are proved red, restored byte-exact, then green:

| Fault                 | File                     | Before and restored SHA-256                                        |
| --------------------- | ------------------------ | ------------------------------------------------------------------ |
| git-constants-owner   | `dist/meta/webview.json` | `0489b0e1ea647ecdf903d7fbf403000bf93b1017c5169a81cc847c8b2f7ab3a0` |
| git-eager-ui          | `dist/meta/webview.json` | `0489b0e1ea647ecdf903d7fbf403000bf93b1017c5169a81cc847c8b2f7ab3a0` |
| git-held-native-trust | `src/extension.ts`       | `c51640c10603aeb419791b486163f0802c4f95253b01eda4eca7107f16151100` |

## M100 documentation integration

Only PLAN, its research record and the Unreleased documentation note change.
All five typecheck projects, changelogVersion/whatsNewContent, document format,
localization, host API and production package pass. Source lint/Knip/jscpd are
unchanged from the passing M71 tree. No pairing or remote execution is shipped;
D80's runtime, gate-fire and device/firewall acceptance remain future work.

| After M100      | extension.js | modelApi.js | Startup | Deferred JS | VSIX without helper | Estimated with prior helper |
| --------------- | -----------: | ----------: | ------: | ----------: | ------------------: | --------------------------: |
| Before DEFLAKE3 |      612,879 |     442,609 | 918,663 |      49,761 |           2,116,351 |                   2,235,857 |

## DEFLAKE3 integration

The complete checkpointCopies/checkpointRetention/checkpointHost suites pass
**60 tests**, no skips. All five typecheck projects, scoped ESLint, document/test
formatting, localization, host API and production package pass. Product code and
budgets do not change. The imported branch's 300 Windows passes and mutation
receipts are preserved as its own evidence, not claimed as runs in this lane.

| After DEFLAKE3 | extension.js | modelApi.js | Startup | Deferred JS | VSIX without helper | Estimated with prior helper |
| -------------- | -----------: | ----------: | ------: | ----------: | ------------------: | --------------------------: |
| Fourth merge   |      612,879 |     442,609 | 918,663 |      49,761 |           2,116,480 |                   2,235,986 |

The Tab/held-PR trust overlap found during final review is corrected below;
the earlier M71 wiring allowlist was too broad.

## Final held-project integration fix and handoff

Tab's `git check-ignore` and language-service context must use M71's project
trust, including the held-PR state, even if VS Code trusts the folder. Pass
`isProjectTrusted` to the Tab factory and recheck it through the existing Git
runner's `beforeRun` at native entry. The new whole-file wiring test first fails
against the merged implementation (two failed / five passed), then passes with
the correction. Wiring/provider/Git-runner suites pass **89 tests**, no skips.
The four final faults below fail the complete owning files, restore SHA-256
exactly, and then pass (89 trust-path tests plus six copy tests).

| Fault                  | Result while broken | File         | Before and restored SHA-256                |
| ---------------------- | ------------------- | ------------ | ------------------------------------------ |
| tab-held-admission     | 2 failed            | 5 passed (7) | `src/extension.ts`                         | `1ffe966ecaea4d95254feb2b41096ef92b018681e5e4a40e0b700b8421553fa0` |
| tab-native-refusal     | 1 failed            | 6 passed (7) | `src/extension.ts`                         | `1ffe966ecaea4d95254feb2b41096ef92b018681e5e4a40e0b700b8421553fa0` |
| checkpoint-copy-bound  | 1 failed            | 5 passed (6) | `src/host/checkpoints/checkpointCopies.ts` | `b472a9493c2f296738a004fe397b391f1bc746c8f6c9e1524e824375ff6c9859` |
| checkpoint-copy-cursor | 1 failed            | 5 passed (6) | `src/host/checkpoints/checkpointCopies.ts` | `b472a9493c2f296738a004fe397b391f1bc746c8f6c9e1524e824375ff6c9859` |

All five typecheck projects, scoped ESLint/format, Knip, jscpd, localization,
host API, production size/split/global/notices checks and staged exact-value
localization pass on the corrected tree. Remove only sixteen identical escape
hatch rows produced by the PLAN union; every distinct entry stays. Decision IDs
are preserved without renumbering; the five duplicate milestone headings were
already present in the base. Released CHANGELOG bytes still equal `7820bd30`.

The four source heads are retained by ordered two-parent merges:

| Item     | Merge commit | Parents                |
| -------- | ------------ | ---------------------- |
| M94      | `fa4800b3`   | `7820bd30`, `c70facee` |
| M71      | `601ab7a1`   | `25617048`, `d992534f` |
| M100     | `be86029d`   | `601ab7a1`, `0331ce14` |
| DEFLAKE3 | `6929223a`   | `be86029d`, `424b6bff` |

`25617048` supplies M94's common size repair before M71. The final train fix
supplies Tab's held-project admission and native-entry check. Every commit
runs normal hooks. No dependency, threshold, ignore, timeout, production copy
budget, explicit paid preference or released changelog section is changed.

Exact production bytes at each stage (the archive column omits the absent
helper; the final column adds its prior measured ZIP contribution):

| Stage                 | extension.js | modelApi.js | Startup | Deferred JS | VSIX without helper | Estimated CI-shaped VSIX |
| --------------------- | -----------: | ----------: | ------: | ----------: | ------------------: | -----------------------: |
| Initial M94 merge     |      612,308 |     440,150 | 901,805 |      40,575 |           2,135,855 |         2,255,361 (over) |
| M94 repair before M71 |      603,473 |     440,260 | 901,818 |      40,575 |           2,071,485 |                2,190,991 |
| M71                   |      612,879 |     442,609 | 918,663 |      49,761 |           2,116,109 |                2,235,615 |
| M100                  |      612,879 |     442,609 | 918,663 |      49,761 |           2,116,351 |                2,235,857 |
| DEFLAKE3              |      612,879 |     442,609 | 918,663 |      49,761 |           2,116,480 |                2,235,986 |
| Final trust fix       |      612,921 |     442,609 | 918,663 |      49,761 |           2,116,560 |                2,236,066 |

Final shared English: 46,653 / 128,000 bytes. Estimated VSIX headroom: 16,734 bytes.

**Open:** the actual universal macOS helper is absent. No authorized artifact
location was supplied, and the shared rules prohibit network retrieval and
reads from another lane. Package checks pass on the helperless archives;
these estimates are not actual CI-shaped archive certificates. Q-TRAIN14 in
PLAN records this limitation. No fake helper is used. Full quality, coverage,
accessibility and installed/hosted-platform certification remain the later
completed train's gates, explicitly outside this scoped brief. No push, main
merge, rebase, credential read, live/paid call or network call was made.

Kubuntu logs and byte-exact drill receipts remain in ignored `temp/train14/`.
The lane runs sixteen deliberate mutations in total, all red then restored;
imported branch receipts are labeled separately. The final local work completes
inside the 100-minute time box.

## Round 2 — TRAIN14B (2026-10-05, Kubuntu)

The rig brief authorizes this completed train's full quality run and reads of
the checksum-listed 0.13.0 VSIX. Earlier round-one exclusions above remain
historical. Local hook-on commits preserve all branch heads; unready m94/kw
and ci/refresh-badges are left for the lead. No push, rebase or paid/live call.

### Ordered joins

| Source                | Head     | Conflicts and resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| origin-main / PR #121 | 8c894b60 | CHANGELOG: union only Unreleased Fixed notes, retaining released bytes. Merge 5a929caa; README/changelog/What's New suites: 17 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M91 + M91b            | 10080407 | 21 files: union Tab/hook paid features, consent, tally, translations, model-text guards and cycle roots; keep held-project trust in Best-of-N, packed translation validation and duplicate-key checks. Regenerate notices and host API. Remove unused runtime import. Merge 90e1fc3d; five typecheck projects, localization (0 problems), 147 focused tests passed. Restore the original shared-English 125-KiB cap, closing the provisional exception. Production activation 628,114 bytes exceeds its cap pending the authorized startup repair; other measured core bundles: Model API 482,079, English 49,169, ACP 837,886. |

| M93 | 97bcc9c4 | 27 files: union report/recorder and Tab/hooks translations, protocol/palette rows, lazy build inventory, activation/controller and ACP lifecycle. Retain M93’s zod/mini parse skip, fix elicitation test callbacks and CSS order without changing declarations. Merge 623b3c96; 127 focused tests and all five TypeScript projects pass. |
| Knip constants | 5b3f2614 | CHANGELOG, PLAN, execSchema test: retain M91 named imports and the owned 44-constant assertion; add namespace/dead-export checks. Merge ced8d7c0; 26 focused tests and Knip pass. |
| DEFLAKE4 | 0ff60b72 | CHANGELOG, PLAN, build, split gate, deferred suite: extend the shared production guard to all merged cohorts, preserve M93’s parse skip, keep in-memory fixtures and remove the 120-second table override. Move the plugin-host exclusion into the shared guard so its mutation fires. Merge 389c420c; 20 split tests pass in about one second with no raised timeout. |
| M98 phase 1 | b3af59f9 | Union Judge with current paid consent, Tab window grants, hooks observers, M71 held-project trust, report protocol/UI, translations, bundle inventories and persistent accessibility harness. Keep current golden bodies and older release bytes. Add the missing translated palette tip caught by its owning guard. Merge ee2dc336; 185 focused tests, five TypeScript projects and localization pass. |

The follow-up D78 adapter uses the existing account/local-day journal. Actual
Judge source/client tests prove one reservation, complete settlement,
uncertain liability and non-send refunds; another window’s image claim
reduces Judge’s available budget. Subscription-only judging receives the
real adapter but asks no price and reserves nothing. Four regressions were
red before the adapter; the final owning trio passes 33 tests. Two deliberate
cap/day bypasses fail and restore source bytes exactly (SHA-256 recorded in
m98.md). No second client reservation, copied ledger or paid/live call.

### Actual-package repair before ACTDIET

The checksum-verified universal-helper baseline is **2,436,399 bytes**, over
the unchanged 2,252,800-byte cap. Its fourteen individual UI Brotli payloads
occupy 605,236 ZIP bytes. A language-major matrix shares keys and measures
434,140 Brotli bytes; all fourteen source tables have the same key order.
The staged package stores that matrix once. Runtime and the package gate
use the same zod-validated decoder, preserve the per-table 1-MiB bound, and
bound the aggregate decode by the fourteen table limits. Source and ACP
JSON and older individual compressed-table compatibility remain.

VSIX staging and host localization: **32 passed** on Kubuntu. Deliberately
bypassing matrix width, the selected-table byte bound and aggregate Brotli
bound makes each owning suite exit 1, followed by exact restoration:

| Drill                        | File                            | Before/restored SHA-256                                          |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Matrix width; selected bytes | src/shared/l10n/tableArchive.ts | 416619fb20d703855fd9cff753ec885ba9c7327422ce828906d5a09d463fc39f |
| Aggregate bytes              | src/host/l10n.ts                | f4fec626b8c2c3e60dbbb12f08ba2358a2bcf4b4ece9f99402df85f0e21a3521 |

The ACTDIET handoff file is checked from 18:15 through 18:45 UTC and remains
absent. Continue from preview/actdiet’s four commits and its committed
certification, preserving this tree’s M71/M98 behavior and DEFLAKE4 fixtures.

### Adapted ACTDIET prototypes and final split repair

The absent handoff report was checked every few minutes for 30 minutes. The
committed prototype record supplied the fallback, after every ordered merge.

| Prototype | Adapted commit | Conflict files and retained behavior                                                                                                                                                  |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dc3e3690  | 7a06a5b3       | 9: first-surface conversation factory, eager restart helper, caller language, M71 trust and Judge dependencies; structural MSP failure checks across bundles; pure DEFLAKE4 fixtures. |
| 8079c5df  | 0baa10d9       | 7: descriptor-preserving regional English, Windows paths, per-region/core Brotli adapted to this train’s packed fallback; original 125-KiB cap.                                       |
| b4b1c1ca  | fdbf0f23       | 5: shared recorder before ACP reports/startup, factory before Tasks allocation, preserved current shared guards and in-memory drills.                                                 |
| 6e711d04  | fed44e0c       | 3: browser-only review-comment block, UTF-8 output, lazy Report focus snapshot, existing Git/Judge behavior and pure deferred fixtures.                                               |

Two measured adaptations finish the prototype on the complete tree: the
review-comment reader is the actual shared ESM constants chunk, and Share
and Session Board remain eager to fit the unchanged deferred cap. The
browser’s entire English fallback stays synchronous and inline, encoded
losslessly with a build-only fragment dictionary over values and label keys.
A real generated bundle round-trips every canonical key, value, nested label
and plural form. Reserved-token collisions refuse at build time.

Existing Node protocol/agent-event schemas move once to `dist/wire.js`
(41,370 bytes, new 50-KiB cap from D6’s measured sizing rule); all consumers
share their existing zod parsers, while browser/integration retain theirs.
Packaging, licenses, cycles, globals and split guards cover this new artifact.
No existing cap, timeout, retry, ignore, user copy or dependency changes.

| Production bytes                  | After ordered merges/D78 | After adapted startup/package repair |
| --------------------------------- | -----------------------: | -----------------------------------: |
| Activation                        |                  644,937 |                              447,165 |
| Model API                         |                  487,729 |                              457,238 |
| Shared core English               |                   50,593 |                               49,133 |
| ACP                               |                  884,025 |                              836,141 |
| Browser startup, all eager chunks |                  953,851 |                              914,566 |
| Browser deferred JS               |                   50,263 |                               50,846 |

Conversation is 197,720 bytes under its new 250-KiB prototype cap. Every
production size and split check passes. App/English/deferred: 183 tests pass;
then restored English/deferred/conversation: 37 pass. Host TypeScript and
changed-source lint pass after fixing typed RegExp iteration.

Local new-guard drills (each exits 1, followed by SHA-identical restoration):

| Drill                  | File                                        | Restored SHA-256                                                 |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| wire-guard             | scripts/lib/deferredBundles.mjs             | 8a442a5a0f7355928a511cfd485d0591bbb5732a582e5635c30e73bbb0b5f29c |
| browser-decode         | src/shared/l10n/compactEnglish.ts           | 7ae67aebfae122d0ea239764502fc8fe1b927c8c570df271606137414606a781 |
| browser-collision      | src/shared/l10n/compactEnglish.ts           | 7ae67aebfae122d0ea239764502fc8fe1b927c8c570df271606137414606a781 |
| english-direct-import  | dist/meta/extension.json                    | 69e3a8ac5a56fa07e03e418a4d2a2937669ec1f50e8d9616a9c79530d519c019 |
| english-missing-region | dist/meta/uiTextRuntime.json                | 64d65fe148dff508a4e2e8c4b0848eb113d7eba9fa401e8b3c3483a111959616 |
| english-missing-link   | dist/meta/uiText.json                       | 47104106ce6d6e98bf562ee561544fa2e5be947c3f78e0a81384db2e269a2691 |
| acp-recorder-link      | dist/meta-acp/acp.json                      | 903a2831305578ed582aced54fd79f389c96f2c068e48d0eac1aeceef526db68 |
| conversation-eager     | dist/meta/extension.json                    | 69e3a8ac5a56fa07e03e418a4d2a2937669ec1f50e8d9616a9c79530d519c019 |
| review-comment-node    | dist/modelApi.js                            | 87c4f4df182faa8c637531b055b5fd9a3d1df9e6c0a292fa334ad56685d6cf20 |
| conversation-factory   | src/host/conversation/conversationBundle.ts | acbd77bd6b023c9fa1a0013b77351c193578dbf66cc35591dd08f31247c7c850 |

Metafile drills mutate emitted `outputs[*].inputs`, the production guard’s
actual byte map. An initial scratch attempt removed only a source inventory
row, which leaves emitted code intact; another named a nonexistent source.
Those attempts are not counted as gate-fire receipts. All originals were
restored; the corrected emitted-code mutations give the recorded refusals.

### Release artifact follow-ups

The package-parity recorder test first fails for twelve missing exact bundle
paths. Registering those newly merged and split files retains their package-only
stack frames; no user path or glob is admitted. Recorder/report/deferred:
100 tests pass. Unit typecheck also catches the missing `sharedWire` declaration
in the tool module’s `.d.mts`; adding its actual Plugin export restores types.

The generated 0.14.0 plus 0.13.0 full notes initially occupy 60,873 bytes,
over the unchanged 40-KiB artifact cap. Small plain files remain compatible;
larger generated trees use a zod-validated lossless Brotli envelope. The file
stays under 40 KiB before ZIP compression, with a new 75-KiB decoded bound
(measured size plus 15%, rounded to 25 KiB). Both complete release trees
round-trip exactly; no release notes or older changelog bytes are dropped.
The final encoded artifact is 21,667 bytes. Three new cases cover the actual
release round-trip, malformed/oversized input and expansion refusal.
Initial regressions fail; restored release/content/README trio: 20 pass.

Both deliberate bound bypasses make the owning suite exit 1 and restore
`src/core/whatsNew/whatsNewContent.ts` byte-identically at SHA-256
`41d384f451d7714e5e2c92b6af21c7a6bd38e9732aa851e3294a17679b5a5c3a`.
Knip exits 0; duplication reports zero clones. Actual universal VSIX:
**2,246,885 / 2,252,800 bytes**; full artifact membership, binary checksum and
executable-mode checks pass. Full quality continues below.

The first full attempt linted ignored scratch probes/round-one snapshots.
Those non-product files are retained as `.snapshot.txt`; no gate ignore,
rule, threshold, test or source exclusion changes. The second attempt reaches
unit typecheck and finds the missing declaration above. Both attempt logs
remain in `temp/train14b/`; the next run is the full unchanged command.

### Final gate integration regressions

The third aggregate attempt detects stale host API counts after bounded
What’s New decoding; regenerate and review only the buffer/zlib count rows.
The fourth reaches all unit suites: 486 files and 10,805 tests pass, but
seven files fail. ACP packaging fixtures lack the newly required real split
modules; update both fixture layouts and preserve every package-refusal test.
The fake launcher builds real adjacent modules; its first adaptation wrongly
externalizes English entry points, and excluding entry-point resolutions fixes
that fixture. ACP package guards: 36 pass; launcher/trust wiring: 13 pass.

The lazy Report dialog now needs its actual asynchronous opening awaited:
handoff assertions remain unchanged and pass. VSCE’s actual listFiles API
replaces CLI startup for the same complete archive-membership assertion.
The build-only English codec counts/replaces fragments without split-array
allocation and reuses its TextEncoder; output remains lossless, all 16
English/browser-package tests pass. No timeout, coverage threshold or guard
is relaxed.

The trust-wiring regression also catches M91’s new extension-hook callbacks
using raw VS Code trust. Both load admission and the runner now use M71’s
existing held-project predicate. The new exact assertions fail before the
source repair, then the complete wiring suite passes.

Judge activation’s legacy fixture evaluates too many newly added callback
fields and omits D78’s default-setting callback. Narrowing its extracted field
removes the undefined-variable error; adding backend availability alone leaves
three subscription-default assertions failing. Per common.md’s two-fix stop
rule, that path is paused pending explicit permission for one default-callback
fixture correction. No production default or consent rule is changed.

### Final source and artifact receipts

The complete fifth full `VITEST_MAX_WORKERS=3 npm run quality` exits 1 at
unit tests after every static gate passes. Its unfiltered V8 run reports:

```text
Test Files  2 failed | 491 passed | 7 skipped (500)
Tests       4 failed | 10837 passed | 71 skipped (10912)
Duration    317.12s
ERROR: "test:unit" exited with 1.
ERROR: "quality:gates" exited with 1.
```

Three failures are the paused Judge fixture above. The fourth is VSCE
traversing other suites’ growing temporary trees for 11.4 seconds. The final
fixture copies every real emitted browser file plus the actual manifest and
`.vscodeignore` into its owned tree and runs VSCE there, preserving exact
membership assertions and timeouts. Restored trust/English/browser trio:
23 pass; changed-source ESLint exits zero. The full gate has **not** exited
zero on the final tree and this train is **not ready for merge or release**.
The one-line proposed Judge fixture patch is reviewable at
`temp/train14b/judge-fixture-correction.patch.txt`; it is not applied without
the requested override of common.md’s two-fix stop rule.

Both deliberate extension-hook trust bypasses exit 1 in the complete wiring
suite and restore `src/extension.ts` exactly at SHA-256
`33b6152e6c84609d059856dfe0712d9ecb47d97a9a1e91b99909fc396c36271f`.

Final production sizes, superseding intermediate diet measurements:

| Artifact            | Before startup repair | Final bytes |
| ------------------- | --------------------: | ----------: |
| extension.js        |               644,937 |     447,145 |
| modelApi.js         |               487,729 |     457,264 |
| uiText.js           |                50,593 |      49,133 |
| acp.js              |               884,025 |     836,424 |
| Browser startup     |               953,851 |     914,592 |
| Deferred browser JS |                50,263 |      50,846 |

Conversation is 197,746 bytes, shared wire 41,396 and the lossless full-notes
artifact 21,731. `npm run package` and `npm run package:acp` exit zero; all
production size, split, host-global, notices, packaged-locale and schema
checks pass. The shared-English cap is the original 125 KiB, activation is
also below the brief’s 600,000-byte target, and every existing cap is retained.

Actual CI-shaped universal VSIX: **2,246,965 / 2,252,800 bytes**, 5,835 bytes
headroom; SHA-256
`d2d91ab9ee81622c1ef09ab556d2ec3f3c129957928ca8ff18abab86d31c9120`.
Both manifest versions are 0.14.0, all emitted browser scripts and new Node
modules are present and byte-identical to the final build. The universal
helper is executable, x86_64 plus arm64, 289,568 bytes, SHA-256
`f42e757a0d78a6bc6a6af22c3bcf34fc7d082eb9e8130d9336024a55c19f0f36`;
it contributes 81,327 ZIP bytes. It comes only from the authorized published
0.13.0 VSIX, verified against SHA256SUMS; no substitute or estimate is used.

ACP production tarball: 1,294,661 bytes, SHA-256
`2551eac59306c91772829d024e3e9dd7eb17024451669f998d1841e04f9f917e`.
The separate unsigned/private fake-only tarball is 1,367,196 bytes, SHA-256
`1764361ef76616b901c61a0dcddbc8698384d74d148eae03a764caeb1360668b`.
Both contain exact recorder/wire/English-region modules; only the latter
contains and names the test launcher. Nothing is published.

The source release structure and all ten ready-head ancestry checks pass.
Older released sections remain exactly 231,798 bytes at SHA-256
`173a34f5738cc4ac49fb3774496161a795a97ada37f9b8f6a15ea7ca7883f0e9`.
The full dependency audit exits zero with the existing braces exception and
one low advisory. Gitleaks scans 1,519 commits / 370.89 MB and finds no leaks.
Accessibility and SAST receipts follow when their unchanged gates finish.
The complete PR description is `docs/certification/train-0.14.0-pr.md`.

SAST exits zero: 529 rules on 1,148 tracked targets, approximately 99.9%
parsed lines, zero findings; only the existing script/config exclusions apply.
