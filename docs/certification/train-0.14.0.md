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

The inherited trust wiring test first failed on Tab/web-fetch's two legitimate
non-git trust inputs; keep its exact allowlist and held-project checks. The
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

The Tab/held-PR trust overlap found during final review is being corrected in
a separate train fix; the earlier M71 wiring allowlist was too broad.
