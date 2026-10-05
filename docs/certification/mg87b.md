# MG87b: merge main into M81 (2026-10-04)

Lane: `feature/m81-browser`, PR #87, worktree `muse-extension-m81`.
Brief: MG87b/MGMAIN, shared merge-main and common rules; 60-minute limit.
Only this worktree was edited. No origin push, rebase, stash or gate bypass.
Full `npm run quality` is reserved for the lead by the lane brief.

## Source binding

- Branch parent: `217f740fad1bf36924c75332e440903d9e5f6c42`.
- Merged main: `77800e8f17a485558824dc4a2f4df5708e91791f`.
- Full Kubuntu snapshot: `6a01d8a6` (7,105 passed, 64 existing opt-in/platform skips; 356 files passed, six skipped; 362 total). No live or paid call was enabled.
- Restored integration snapshot `84040e45`: 672/672 in three files.
- Final fixture-reuse/style snapshot `e32c5531`: 672/672; final manager callback snapshot `345d22a2`: 19/19.
- Final fixture correction adds only the explicitly required `screenshot: undefined`; the restored three-file run covers that final test source.
- Merge commit: the commit containing this record; both parents above must be present.

## Conflict resolutions

All 50 conflicted files below. No product decision or D-number collision.

| File                                         | Resolution                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/build.yml`                | Union of every main VSIX member and both M81 browser bundles.                                                                                                                                               |
| `.vscodeignore`                              | Ship both browser bundles and main's review and other lazy bundles.                                                                                                                                         |
| `AGENTS.md`                                  | Keep browser/runtime and bundled-skills/review layout descriptions together.                                                                                                                                |
| `PLAN.md`                                    | Keep main's complete budget table and add both M81 budgets; preserve all decisions and milestone records. No decision renumbering.                                                                          |
| `README.md`                                  | Union command and setting tables; keep M81 machine-scoped settings alongside main's skills, budget and paid-feature settings.                                                                               |
| `THIRD_PARTY_NOTICES.txt`                    | Union bundle inventory, including both browser bundles and bundled skills; regenerate from production metadata.                                                                                             |
| `docs/certification/README.md`               | Keep M80 and M89 records plus M81; correct M81 entry to its pinned runtime design.                                                                                                                          |
| `docs/ide-compatibility/host-api.md`         | Regenerate from merged source, then format; no hand-maintained API entries.                                                                                                                                 |
| `knip.jsonc`                                 | Keep browserCheck/browserRuntime entry points and main's review entry point.                                                                                                                                |
| `l10n/ui.cs.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.de.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.es.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.fr.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.hu.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.it.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.ja.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.ko.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.pl.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.pt-br.json`                         | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.ru.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.tr.json`                            | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.zh-cn.json`                         | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `l10n/ui.zh-tw.json`                         | Three-way key merge: main table plus M81 added/changed/deleted keys, with real translations retained.                                                                                                       |
| `package.json`                               | Three-way object merge; command array union by command id; cycles retains every main entry plus both browser entries.                                                                                       |
| `package.nls.cs.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.de.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.es.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.fr.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.hu.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.it.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.ja.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.json`                           | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.ko.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.pl.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.pt-br.json`                     | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.ru.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.tr.json`                        | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.zh-cn.json`                     | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `package.nls.zh-tw.json`                     | Three-way key merge: main manifest strings plus M81 runtime command/settings translations.                                                                                                                  |
| `scripts/build.mjs`                          | Keep all main lazy bundle definitions and builds plus both browser definitions and builds.                                                                                                                  |
| `scripts/check-bundle-size.mjs`              | Keep all main budgets, including uiText 125 KiB and Model API 475 KiB; retain browser 75/50 KiB. No cap changed.                                                                                            |
| `scripts/check-bundle-split.mjs`             | Keep all main split checks and both browser split checks and result messages.                                                                                                                               |
| `scripts/third-party-notices.mjs`            | Union bundle header and retain main's vendored-skill notices.                                                                                                                                               |
| `src/core/backends/modelapi/ModelApiHost.ts` | Keep M81 media-specific leads and browser dispatch alongside main's policy and code-intelligence work; record browser admission for the policy fence. Forced widening retains its session choice in Bypass. |
| `src/core/backends/modelapi/permissions.ts`  | Keep M81's explicit session-consent lookup plus main's structured judge and verdict wrapper.                                                                                                                |
| `src/extension.ts`                           | Union all browser, code-intelligence, voice and Muse Code reviewer imports; keep both sides' activation wiring.                                                                                             |
| `src/host/backend/modelApiBackendManager.ts` | Keep main's host variants and budgets; pass browser check to window variant only, never a best-of-N attempt.                                                                                                |
| `src/host/settings.ts`                       | Union settings interface, validators and runtime reads, preserving main's permissionSettingsOf helper.                                                                                                      |
| `src/shared/constants.ts`                    | Union defaults and machine-scoped settings; keep both sides' constants and main's relocated model text.                                                                                                     |
| `test/unit/modelApiHost.test.ts`             | Keep main's permission/reviewer tests and entire M81 test block; avoid duplicating common M86 helpers and tests. Add browser policy-change regression.                                                      |

The supplied changelog rebase and released-section repair scripts retained
main's text plus M81's two branch additions. `changelog-kept.py` passed;
released sections remain byte-identical to merged main. All main commands
and cycles entries are retained. No unresolved markers remain.

## Integration fixes and test fire

The initial owning-file run exposed 17 media failures because M81's
`readFileLines` still referenced model text moved by main; the helper now
reads `MODEL_API_MODEL_TEXT`. The existing widening test also failed because
main's fresh Bypass judgment did not remember a forced widening card's
session choice; only that explicit browser-widening card gets the session
choice back. Both existing regressions pass after correction.

Main's exhaustive dispatcher-fence inventory failed until `browser_check`
joined its held-I/O matrix. Its browser cases prove page output is withheld
when a file rule changes, including a deny elsewhere on opaque output.
Browser dispatch records admission just as main's web fetch does. A window
browser check is not passed into a best-of-N worktree host.

Two intentional guard mutations on Kubuntu snapshot `ae0070ac`:

| Guard removed                                                   | Failing tests                                                                  | SHA-256 before and after restore                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Browser admission assignment before check                       | Browser policy-change regression and both dispatcher browser rows (3 failures) | `fff20e2a50a71890fe7dbb389b1e90f10e4cc73ddc7a1078795085da08d4de12` |
| Host variant browser isolation, replaced with window dependency | Best-of-N browser isolation regression (1 failure)                             | `8d39c2a654fa1aba1ba3045ca601323ef206d473f5a6edb5182e59929162d696` |

Four failures, 668 passes; both files restored byte-exact in `finally`.
The first drill launcher selected Windows' WSL bash and never reached tests;
it supplies no test-fire evidence. Explicit Git Bash then ran the real drill.

## Gates

| Gate                                | Result                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All five TypeScript projects        | Exit 0; unit project additionally refreshed after the final fixture correction                                                                                                                                                                                               |
| Prettier on all hand-resolved files | Exit 0; updated certification records formatted before staging                                                                                                                                                                                                               |
| ESLint, zero warnings               | Initial pass found two new test callback shorthand errors; both now braced. Final merge commit runs the required hook lint over all staged code                                                                                                                              |
| Knip                                | Exit 0; one inherited vendor ignore configuration hint, no dead code                                                                                                                                                                                                         |
| Duplication                         | Initial test-fixture clone removed by reusing existing `recordingBrowser`; final gate: zero clones across 870 files, exit 0                                                                                                                                                  |
| Localization                        | 14 tables, 126 manifest strings, 442 source files; zero problems                                                                                                                                                                                                             |
| Host API                            | 277 APIs, 21 importing files, 25 Node built-ins, 59 theme variables; zero problems                                                                                                                                                                                           |
| Production compilation              | All bundles built; size gate exits 1 only for activation (610.2 KiB against 600)                                                                                                                                                                                             |
| Bundle split                        | Exit 0; main's entire lazy bundle inventory and both browser bundles retained                                                                                                                                                                                                |
| Host globals                        | Exit 0; both browser bundles covered                                                                                                                                                                                                                                         |
| Notices                             | Exit 0, 83 bundled packages                                                                                                                                                                                                                                                  |
| Changelog retention                 | Exit 0; released sections unchanged from main                                                                                                                                                                                                                                |
| Accessibility                       | First `node scripts/a11y.mjs tools approval-tool approval-narrow`: 10 of 12 pages returned clean results; two initial light-theme Chrome processes returned no result. Identical retry was still pending when this record was staged. No complete accessibility pass claimed |

Host-globals test fire: `void navigator` appended to built `browserRuntime.js`
failed the gate with one reference, exit 1. The artifact was restored byte-exact
(SHA-256 `d7c85ae615aa380c40e7daf106632775b2de83614862fa7767257ad4be24cbc7`)
and the gate passed again, exit 0.

## Bundle sizes

Budgets are main's existing budgets plus M81's existing budgets. None changed
in this lane.

| Artifact | KiB | Budget KiB |
| -------- | --: | ---------: |

| `dist/extension.js` | 610.2 | 600 |
| `dist/modelApi.js` | 445.2 | 475 |
| `dist/review.js` | 43.8 | 50 |
| `dist/sessionBoard.js` | 62.7 | 75 |
| `dist/reviewer.js` | 61.0 | 75 |
| `dist/planMarkdown.js` | 139.0 | 150 |
| `dist/checkpointStore.js` | 142.1 | 225 |
| `dist/agentImport.js` | 122.1 | 125 |
| `dist/browserCheck.js` | 50.9 | 75 |
| `dist/browserRuntime.js` | 37.3 | 50 |
| `dist/bundledSkills.js` | 23.6 | 50 |
| `dist/codeIntel.js` | 83.3 | 100 |
| `dist/voice.js` | 35.4 | 50 |
| `dist/museCodeReviewer.js` | 49.1 | 75 |
| `dist/uiText.js` | 110.7 | 125 |
| `dist/searchWorker.js` | 18.1 | 50 |
| `dist/pageWorker.js` | 203.2 | 300 |
| `dist/webview/main.js` | 867.3 | 900 |
| `dist/acp.js` | 807.5 | 850 |

## Remaining work

The brief explicitly assigns activation size to the separate activation-diet
lane: this lane must not move code or change its 600 KiB budget. The lead must
integrate that lane and rerun the production size gate. The focused local
accessibility invocation has two missing results, so the lead must obtain a
complete browser gate; its retry receipt is in `temp/mg87b/a11y-retry.log`.
Full quality, hosted/platform/editor acceptance and M81's live pinned-runtime
receipts remain the lead's gates. No origin push was made.

`npm ci --ignore-scripts` refreshed dependencies from main's merged lockfile;
it reported 11 advisories (two low, nine high). This lane added no dependency
or audit exception. The lead's full security gate must assess that inherited
installation result.
