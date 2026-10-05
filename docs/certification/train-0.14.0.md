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
