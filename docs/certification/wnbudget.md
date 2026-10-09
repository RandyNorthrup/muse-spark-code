# WNBUDGET — What's New fits its budget by itself

Linux rig `linuxlt`, branch `fix/whatsnew-budget`, base `a0b3f55c9`
(the 0.17.0 release head). No cap, budget or timeout changes; no push,
merge or rebase. No paid or live model calls.

## Why

0.17.0's release build failed: two full releases decoded to 79,510 bytes,
above the unchanged `WHATS_NEW_CONTENT_DECODE_MAX_BYTES` (76,800). The
notes were hand-tightened for 0.17.0 instead. This lane makes the writer
budget-aware so a long release can never fail the build again, without
hiding the newest release.

## What changed

- `scripts/lib/whatsNewContent.mjs`: new `selectWhatsNewReleases`
  (newest always in full; older window releases newest first while the
  decoded total fits, else Highlights only with a link to their full notes
  in CHANGELOG on GitHub, else left out; the standing newest-earlier-
  Highlights rule holds subject to the same budget; `shortened` only when
  the budget changed what ships). Refusal names the release, its size and
  the bound. The bound comes from `src/shared/constants.ts` through
  `scripts/lib/l10nSource.mjs` (no duplicated literal).
- `src/core/whatsNew/whatsNewContent.ts`: optional top-level `shortened`.
- `src/host/whatsNew/whatsNewHtml.ts` + `whatsNewPanel.ts`: the page shows
  `UI_TEXT.whatsNewEarlierNotes` ("Earlier notes: see the full changelog")
  when the content is shortened; new key in `src/shared/l10n/en.ts` and all
  14 `l10n/ui.*.json` (`check:l10n` 0 problems).
- `scripts/package-vsix.mjs`: `packagedChangelog(text, plan, repository)`
  ships the writer's own plan, so the packaged notes agree with the page;
  without a plan the legacy slice is byte-identical. `stageVsix` computes
  the plan from the same parse (which also validates Try its at pack time).
- Round 2 (review RVWNBUDGET, four P2 findings): the selection measures the
  shipped envelope with its `shortened` flag (an exact-fit newest release
  with a predecessor left out gets the named refusal, never the encoder's
  generic one); a shortened release without Highlights ships as its
  full-notes link, exactly as the page shows it; packaging shared the
  writer's own `RELEASE_SECTION_LINE` (prereleases such as 2.0.0-beta.1
  included) but still inventoried heading lines itself; the retained earlier
  Highlights enter the plan with the full-notes link, so the page and the
  packaged notes agree in every case (the exclusion this note stated in
  round 1 is removed).
- Round 3 (review RVWNBUDGET2, two P2 findings): one parser, so the class
  cannot recur. `parseChangelog` returns each release's source range
  (whole `## ` section offsets, `### Highlights` subsection offsets, and
  the `[Unreleased]` Highlights content span on the returned array) as
  non-enumerable metadata that never enters an envelope, an artifact or any
  JSON (`scripts/lib/whatsNewContent.d.mts` types it); `packagedChangelog`
  and `stageVsix` take the parsed releases and slice those ranges —
  `RELEASE_SECTION_LINE`, the heading inventory, the `### ` split and
  `highlightsMarkdown` are deleted from `scripts/package-vsix.mjs`, which
  matches no heading of its own. Selection admits each candidate iff the
  envelope exactly as shipped fits, with the `shortened` flag set as that
  decision leaves it (`canShip`): admitting the retained earlier Highlights
  is measured with the flag as it stands, reserving nothing.

## Behaviour → test map

| Behaviour                                                                           | Test                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Newest alone over budget refuses, naming release, size, bound                       | `whatsNewContent`: refusal test (80 KB fixture at the real bound, exact message; small-bound variant)                                    |
| Second fits fully / only Highlights fit / nothing fits                              | `whatsNewContent`: three selection tests (plan, link section, envelopes within bound)                                                    |
| Newest-with-Highlights fallback still holds, within budget or skipped               | `whatsNewContent`: fallback test (kept + skipped-shortened)                                                                              |
| Determinism (byte-identical)                                                        | `whatsNewContent`: determinism test + real-CHANGELOG double-select                                                                       |
| Real CHANGELOG ships the same releases as today                                     | `whatsNewContent`: real-CHANGELOG parity test (versions, full, not shortened)                                                            |
| Page Earlier-notes line only when shortened, translated at render time              | `whatsNewHtml`: two tests; `whatsNewPanel`: content-flag test                                                                            |
| Packaged notes agree (full / Highlights+link / omitted; legacy parity)              | `vsixPackaging`: writer's-plan test + real-CHANGELOG legacy-equality test                                                                |
| Exact-fit newest + omitted predecessor gets the named refusal (flag bytes measured) | `whatsNewContent`: exact-fit test (envelope exactly the bound; alone ships, with predecessor refuses by name, never the generic failure) |
| Shortened release without Highlights ships as its full-notes link                   | `vsixPackaging`: highlight-less test (plan `full: false`, packaged heading + link, old detail absent)                                    |
| Prerelease predecessor packages through the writer's own pattern                    | `vsixPackaging`: prerelease test (`2.0.0-beta.1` parsed, planned and packaged)                                                           |
| Retained earlier Highlights enter the plan with the link; page and package agree    | `whatsNewContent`: plan-entry test + updated fallback/page tests; `vsixPackaging`: fallback-agreement test                               |
| Parser returns each release's source range; ranges never enter the JSON             | `whatsNewContent`: source-range test (keys unchanged, slices tile end to start, Highlights and Unreleased spans exact)                   |
| Fenced example heading selects and packages the real section, identically           | `vsixPackaging`: fenced-example test (writer versions, full plan, real beta Highlights/details packaged)                                 |
| Indented (one leading space) heading selects and packages identically               | `vsixPackaging`: indented-heading test (writer versions, full plan, real beta packaged, no throw)                                        |
| Exact-bound fallback keeps fitting earlier Highlights, flag absent                  | `whatsNewContent`: exact-bound test (both fixes full + fallback short serialise to exactly 76,800 bytes; kept, `shortened` false)        |

## Red drills (each broke on purpose, failed, restored byte-exact)

Baselines recorded before breaking (`sha256sum`, backups under
`$TMPDIR/wnbudget-bak`); after each restore `sha256sum -c` reported OK for
all three files.

| #   | Break                                                                                               | Failing test (observed)                                                                                | Restore        |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | `selectWhatsNewReleases`: `if (canFit(candidate, false))` → `if (true)` (budget ignored)            | `ships the second release as its Highlights only …` — 1 failed, 22 skipped                             | OK `6518db7a…` |
| 2   | `whatsNewHtml`: Earlier-notes paragraph → `''`                                                      | `points at the full changelog only when older notes were shortened or left out` — 1 failed, 12 skipped | OK `f79de62d…` |
| 3   | `packagedChangelog`: `if (plan === undefined)` → `if (plan === undefined \|\| true)` (plan ignored) | `ships the writer's plan …` — failed                                                                   | OK `36753de8…` |

Round 2 (RVWNBUDGET findings; baselines `5d04db82…` `f22fd730…`,
backups under `$TMPDIR/wnbudget-r2-bak`; `sha256sum -c` OK for both
files after every restore):

| #   | Break                                                                                             | Failing test (observed)                                                                                                       | Restore        |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | `selectWhatsNewReleases`: `if (finalBytes > maxDecodeBytes)` → `&& false` (flag bytes unmeasured) | `measures the shipped envelope with its shortened flag …` — `expected [Function] to throw an error`, 1 failed, 24 skipped     | OK `5d04db82…` |
| R2  | `packagedChangelog`: highlight-less branch → `throw … no Highlights section for …`                | `ships a shortened release without Highlights …` — `packagedChangelog: no Highlights section for 1.0.3`, 1 failed, 83 skipped | OK `f22fd730…` |
| R3  | `packagedChangelog`: `RELEASE_SECTION_LINE` → old `/^## \[\d+\.\d+\.\d+\].*$/gm`                  | `packages a prerelease predecessor …` — `packagedChangelog: no released section for 2.0.0-beta.1`, 1 failed, 83 skipped       | OK `f22fd730…` |
| R4  | `selectWhatsNewReleases`: fallback `plan.push(…)` removed                                         | `enters the retained earlier Highlights in the plan …` — plan 2 entries vs 3, 1 failed, 24 skipped                            | OK `5d04db82…` |

Round 3 (RVWNBUDGET2 findings; baselines `b4e77665…` `79ec5e35…`,
backups under `$TMPDIR/wnb3-bak`; `sha256sum -c` OK for both
files after every restore):

| #   | Break                                                                                             | Failing test (observed)                                                                                                                                                | Restore        |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R5  | `selectWhatsNewReleases`: fallback `canShip(…, isShortened)` → `true` (flag bytes reserved again) | `keeps fitting earlier Highlights at the exact bound …` — `expected [ '1.0.4', '1.0.3' ] to deeply equal [ '1.0.4', '1.0.3', '1.0.2' ]`, 1 failed, 26 skipped          | OK `b4e77665…` |
| R6  | `parseChangelog`: release `highlightsStart/End` → `undefined` (no Highlights ranges)              | `reports each release’s source range …` (whole-file slice vs Highlights block) and `ships the writer’s plan …` (`to contain 'Stable highlight stays.'`), 1 failed each | OK `b4e77665…` |
| R7  | `parseChangelog`: section close `finish(start)` → `finish(markdown.length)` (ranges never close)  | `ships the writer’s plan …` — `expected … not to contain 'Old detail goes.'` (later sections leak into earlier slices), 1 failed, 85 skipped                           | OK `b4e77665…` |

Fail-before on the pre-fix head (`13fe73c4c`, old files run from a
scratch mirror): the fenced scenario packages without the real beta
(`has beta fix: false` — the example text wins); the indented scenario
throws `packagedChangelog: no released section for 2.0.0-beta.1`. Both
new regression tests pass on the fixed code. The real CHANGELOG packages
byte-identically before and after (plan and legacy paths, SHA-256
`80884cbd…` both ways).

## Sizes for the real CHANGELOG, before → after

|                                    | Decoded bytes | Bound  | Encoded bytes | Budget |
| ---------------------------------- | ------------- | ------ | ------------- | ------ |
| 0.17.0 release build (failed)      | 79,510        | 76,800 | — (refused)   | 40 KiB |
| This head, before (hand-tightened) | 68,401        | 76,800 | 25,347        | 40 KiB |
| This head, after                   | 68,401        | 76,800 | 25,347        | 40 KiB |

Same releases before and after: 0.17.0 + 0.16.0, both in full,
`shortened` absent (verified by the parity test and a direct
`selectWhatsNewReleases` probe: plan both `full: true`).

## Gates (this rig)

- `npx vitest run` (repo default timeouts, `--maxWorkers=3`):
  `whatsNewContent` 23 passed, `whatsNewHtml` 13 passed,
  `whatsNewPanel` 10 passed, `vsixPackaging` 81 passed.
- Round 2 reruns (repo default timeouts, no overrides):
  `whatsNewContent` 25 passed, `whatsNewHtml` 13 passed,
  `whatsNewPanel` 10 passed, `vsixPackaging` 84 passed.
- `node scripts/check-l10n.mjs`: 0 problems.
- `node scripts/gen-reference.mjs --check`: pass (no command/setting/feature touched).
- `npm run build` (production, includes the writer end-to-end,
  `check-bundle-size`, `check-bundle-split`, `check-host-globals`): pass.
  `dist/whatsNew.json` 25,347 bytes (40 KiB budget),
  `dist/whatsNew.js` 21,552 bytes (50 KiB budget).
- `npx prettier --check`, changed-file ESLint (`--max-warnings=0`),
  `tsc -p tsconfig.json --noEmit`, `tsc -p test/unit/tsconfig.json
--noEmit`: pass.
- Round 2 reruns: `npx prettier --check` (6 files), changed-file ESLint
  (`--max-warnings=0`), `tsc -p tsconfig.json --noEmit`, `node
scripts/check-l10n.mjs` (0 problems), `node
scripts/gen-reference.mjs --check` (current), `npm run build`
  (production): all pass. `dist/whatsNew.json` still 25,347 bytes,
  `shortened` absent; real CHANGELOG ships 0.17.0 + 0.16.0 in full.
- Round 3 reruns (repo default timeouts, no overrides):
  `whatsNewContent` 27 passed, `whatsNewHtml` 13 passed,
  `whatsNewPanel` 10 passed, `changelogVersion` 2 passed,
  `vsixPackaging` 86 passed.
- Round 3: `npx prettier --check` (5 files), changed-file ESLint
  (`--max-warnings=0`, incl. the new `.d.mts` range types),
  `tsc -p test/unit/tsconfig.json --noEmit`, `node
scripts/check-l10n.mjs` (0 problems), `npm run check:reference`
  (current), `npm run build` (production): all pass.
  `dist/whatsNew.json` still 25,347 bytes, `shortened` absent; real
  CHANGELOG ships 0.17.0 + 0.16.0 in full, and the packaged CHANGELOG is
  byte-identical to the pre-fix output (plan and legacy paths,
  SHA-256 `80884cbd…` both ways).
