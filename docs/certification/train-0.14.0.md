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
| `feature/m71-git-prs`         | `d992534f`  | Pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `feature/m100-multi-device`   | `0331ce14`  | Pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `fix/checkpoint-copies-flake` | `424b6bff`  | Pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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
retrieval and reading another lane without authorization. CI-shaped certification
and size recovery remain pending; no placeholder helper is used.

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
