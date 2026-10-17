# MG87c: merge main (activation diet, Dependabot) into M81 (2026-10-04)

Lane: `feature/m81-browser`, PR #87, worktree `muse-extension-m81`.
Only this worktree was edited. No origin push, rebase, stash or gate bypass.
No live model call was made: the tests run against fakes.

## Source binding

- Branch parent: `a84ffce4` (M81 after MG87b).
- Merged main: `048d153f` (PR #109, the activation diet, PLAN.md D6
  2026-10-03; PR #105, the production dependency bump; with them 0.12.0,
  0.12.1 and CIFLOW, PR #110).
- Merge commit: the commit containing this record.

## Conflict resolutions

| File                                         | Resolution                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/constants.ts`                    | Main's text blocks. M81's browser check words by reader: 42 that activation reads (`core/browser/browserTool.ts`, Muse Code's `ide` call) in `MODEL_TEXT`; the three only `browserCalls.ts` says (Model API only) in `MODEL_API_MODEL_TEXT`. `importedRules*` stays main's. |
| `src/core/backends/modelapi/ModelApiHost.ts` | Main's sorted imports plus the two browser subject kinds.                                                                                                                                                                                                                   |
| `src/extension.ts`                           | Main's lazy web fetch (`webFetchBundle`) replaces `createWebFetcher`; M81's browser imports and wiring kept.                                                                                                                                                                |
| `scripts/third-party-notices.mjs`            | Header names main's `dist/webFetch.js` and M81's two browser bundles and `dist/bundledSkills.js`.                                                                                                                                                                           |
| `THIRD_PARTY_NOTICES.txt`                    | Regenerated from the production build on Kubuntu (`third-party-notices.mjs --write`, 83 packages); differs from main only in the header.                                                                                                                                    |
| `package.json`                               | `cycles`: main's entries, `webFetchEntry.ts` among them, plus both browser entries.                                                                                                                                                                                         |
| `package.nls.json` and 14 tables             | Three-way key merge: M81's five browser setting strings, main's new `bundledSkills` description; every translation as each side had it.                                                                                                                                     |
| `CHANGELOG.md`                               | `changelog-rebase.py`: main's file plus M81's three Unreleased bullets (two Added, one Fixed); released sections byte-identical to main.                                                                                                                                    |
| `PLAN.md`                                    | Both §7 entries (MG87b and CIFLOW).                                                                                                                                                                                                                                         |

## Integration fixes

Main's split check rejects a computed `MODEL_TEXT[…]` read at activation and
any `MODEL_TEXT` key no activation file reads by name. M81's
`browserRefusal` looked its 23 fixed failures up by key, so its table now
holds each failure's model words read by name and its UI key, which is
looked up when the failure is worded. The words did not change: a bundle of
`constants.ts` at both parents and in the tree has every key of both in one
block with the same value (374 keys: main's 329 and M81's 45).

`test/unit/modelApiHost.test.ts`: M81's policy-change regression reads
`MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange`, where main moved it.

Main's shipped-bundle text test (the diet's P3-2) looks for every
`MODEL_TEXT` value's longest plain run in a lazy bundle. Three M81 values
share words with a block such a bundle reads by design: the browser check's
page markers are web fetch's (`<<<page {marker}>>>`,
`<<<end of page {marker}>>>`), and `{count} more not shown` is inside code
intelligence's `[{count} more not shown]`. Neither bundle carries
`MODEL_TEXT` (no key of it is in either). `shippedTextCases` now takes the
blocks a bundle reads, and a run may occur only as often as their values hold
it. A carried `MODEL_TEXT` still fails, by its keys and by the extra copy.

## Red drills

Kubuntu slot `m81diet-merge`, snapshot `92a8f393`; each break made in the
slot, the one test run (`-t "carries its own model text"`), then
`git checkout -f` and a clean `git status` checked
(`scratchpad/rig-gate/logs/m81diet-merge-drills.log`).

| #   | Broken on purpose                                                           | Exit | What caught it                                              |
| --- | --------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| D1  | `codeIntelEntry.ts` exports a read of `MODEL_TEXT.fileNotText`              | 1    | `codeIntelBundle.test.ts`: `bundledSkillRoot:` key found    |
| D2  | `webFetchEntry.ts` exports a read of `MODEL_TEXT.webFetchDeclined`          | 1    | `webFetchBundle.test.ts`: `bundledSkillRoot:` key found     |
| D3  | `webFetchEntry.ts` exports one more `'<<<end of page {marker}>>>'` (no key) | 1    | `webFetchBundle.test.ts`: `browserCheckClose`: 2, at most 1 |
| D4  | `webFetchBundle.test.ts` passes no blocks the bundle reads                  | 1    | `webFetchBundle.test.ts`: `browserCheckOpen`: 1, at most 0  |
| —   | Control, unchanged                                                          | 0    | both tests pass                                             |

## Gates

| Check                                                                  | Result                                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build and its checks, Kubuntu slot `m81diet-merge`          | Exit 0: every budget, the split check (107 `MODEL_TEXT` keys, each read at activation; every block in its readers only), host globals, notices |
| 37 owning test files, Kubuntu slot `m81diet-merge`                     | First run: 2 failed (the text test above), 1,086 passed, 8 skipped; after the fix the three affected files pass 30 of 30                       |
| `node scripts/check-l10n.mjs`, `check-host-api.mjs`, `exec-schema.mjs` | 14 tables, 0 problems; 277 APIs, 0 problems; schemas match                                                                                     |
| Prettier on every hand-resolved file                                   | Exit 0                                                                                                                                         |

The eight skips are the live browser suites (`browserCheckLive`,
`browserCheckR51`), which need the pinned runtime and run in
`browser-check.yml`. The full quality gate runs on this commit on a rig after
this record; its result is in the lead's report.

## Sizes

Production build, Kubuntu, KiB (budget): `dist/extension.js` 572.6 (600),
`dist/modelApi.js` 441.9 (475), `dist/webFetch.js` 47.4 (75),
`dist/browserCheck.js` 51.0 (75), `dist/browserRuntime.js` 37.3 (50),
`dist/codeIntel.js` 55.4 (100), `dist/uiText.js` 110.8 (125),
`dist/acp.js` 792.8 (850). MG87b's 610.2 KiB activation is now 27.4 KiB
under its budget. No budget changed.
