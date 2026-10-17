# WNBUDGET — What's New fits its budget by itself

Linux rig `linuxlt`, branch `fix/whatsnew-budget`, base `a0b3f55c9`
(the 0.17.0 release head). No cap, budget or timeout changes; no push,
merge or rebase. No paid or live model calls.

## Why

0.17.0's release build failed: two full releases decoded to 79,510 bytes,
above the unchanged `WHATS_NEW_CONTENT_DECODE_MAX_BYTES` (76,800). The
notes were hand-tightened for 0.17.0 instead. This lane makes the writer
budget-aware so older notes cannot invalidate a feasible final plan,
without hiding the newest release. A newest release that cannot fit still
gets a named refusal, including an encoded artifact that is too large.

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

## Round 4 plan (2026-10-09, linuxlt)

1. Complete: enumerate complete feasible plans with the real encoder;
   add the RVWNBUDGET3 exact-bound predecessor/fallback regression and an
   exhaustive random-size preference oracle (32 seeded sizes/Highlight
   combinations; every candidate's byte boundary minus one, exact and plus
   one, plus a random bound). The oracle also checks input preservation.
2. Complete: enforce the ATX LF/CRLF heading contract, return heading/body
   spans, and package only parsed spans. Regress CR-only, Setext, fenced
   and indented headings. The six new parser cases failed before the fix;
   all 36 content, 13 HTML and 10 panel tests now pass.
3. Complete: all eight drills fired and restored byte-exact; focused tests
   and requested static/build checks pass. Code committed with installed
   hooks; staged and committed patches compared byte-exact and re-read.
   Full quality and universal release qualification remain lead-owned,
   per the rig brief.

Round 4 supersedes round 3's provisional-admission and heading-boundary
claims above; the earlier sections record historical work and results.

The current selector enumerates every complete plan in lexicographic
preference order: full, Highlights + full-notes link, omitted; compare the
newest release first, then the next. The newest is always full. The
full-notes window is two releases total. Its standing earlier fallback
ships only Highlights + link, or is omitted, and is needed only when no
retained window release has Highlights. That keeps at most three releases
and at most 27 plans (six with the current window and a needed fallback).
Each candidate's exact final JSON includes `shortened: true` only for a
window reduction/omission or omission of a needed fallback. No flag bytes
are reserved when keeping the standing fallback alone. A candidate must
fit the decoded bound and succeed with `encodeWhatsNewContent`; the first
feasible plan wins, with all plans still measured. The writer uses that
same envelope constructor. No greedy/provisional admission remains.

Release headings must be ATX `## [version] - YYYY-MM-DD`, terminated by LF
or CRLF. Markdown's one to three leading spaces are accepted (the heading
span starts at `##`); fenced and four-space indented examples stay code.
Lone CR anywhere and Setext release headings get named refusals, as do
noncanonical or unterminated release headings. Each parsed release carries
non-enumerable whole-section, heading (terminator included), body, and
Highlights spans. Packaging slices parsed spans only, with no heading
regex or newline search. The Unreleased and legacy full-window paths keep
their parsed ranges. No runtime UI markup or localized text changes.

Round 4 packaging baseline: 89 packaging + 2 changelog-version tests pass.
The packaged shortened heading is checked through mdast: the link after
Highlights is valid package prose, while source Highlights validation
requires only its curated list.

### Round 4 finding to test map

| Finding                                                                                                | Regression and result                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVWNBUDGET3: full predecessor provisionally fits at 76,800 bytes, fallback omission then adds 17 bytes | `reconsiders a full predecessor ...`: failed on round 3 with named 76,817-byte refusal; now chooses newest full, predecessor link, fallback Highlights + link, encoded successfully.                                                      |
| RVWNBUDGET2: exact-bound fallback lost because an absent flag was reserved                             | Existing `keeps fitting earlier Highlights at the exact bound ...` passes unchanged at 76,800 bytes, with flag absent.                                                                                                                    |
| RVWNBUDGET: exact-bound newest, link-only patch, prerelease and page/package fallback mismatch         | Existing exact-fit refusal, highlight-less packaging, prerelease packaging, retained-fallback plan and package tests all remain covered.                                                                                                  |
| Final-plan preference across different note sizes and Highlight presence                               | `chooses the best feasible complete plan ...`: exhaustive independent list for 32 seeded cases, every plan's minus-one/exact/plus-one bound and a random bound; selected content, plan and flag equal the best feasible candidate.        |
| Decoded fit may exceed encoded budget                                                                  | `rejects decoded fits that the real encoder cannot ship ...`: deterministic high-entropy detail is under 76,800 decoded bytes but refused by the real 40 KiB encoder; older notes become a link, newest-only gets a named refusal.        |
| RVWNBUDGET3: CR-only and Setext heading divergence                                                     | Parser and packaging pipeline refuse both by name. LF/CRLF heading/body spans include exact terminators; unsupported spelling and unterminated headings are refused.                                                                      |
| RVWNBUDGET2: fenced and indented heading divergence                                                    | Existing full-note regressions plus six shortened LF/CRLF + 0/1/3-space cases pass; fenced example stays code, old detail absent, both real headings remain Markdown headings. Parser also checks two-space headings and four-space code. |

### Round 4 red drills

Every drill runs its entire owned test file with repository timeouts and
`--maxWorkers=3`, with no test filters. Backups and logs:
`$TMPDIR/wnbudget-r4-drills/`. Every mutation fails a behavior assertion,
then a finally block restores original bytes and compares SHA-256.

| Drill      | Mutation                                                | Observed failure                                                                                |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Flag       | Measure final candidate with `shortened` forced absent  | 3 tests fail: exact-fit newest refusal, full-predecessor/fallback overflow, exhaustive oracle.  |
| Preference | Replace first feasible choice with last feasible choice | 11 tests fail, including full-note retention and oracle.                                        |
| Encoder    | Substitute JSON parsing for real encoder admission      | High-entropy encoded-budget regression fails.                                                   |
| CR         | Remove lone-CR guard                                    | Named line-ending refusal regression fails.                                                     |
| Setext     | Remove Setext guard                                     | Named Setext refusal regression fails.                                                          |
| Contract   | Remove ATX/terminator guard                             | Unterminated/noncanonical heading regression fails.                                             |
| Spans      | Extend parsed heading span to file end                  | LF, CRLF and indented heading-span regressions fail.                                            |
| Packaging  | Extend the packaged heading through its body span       | Four tests fail: writer's-plan agreement, link-only patch, LF and CRLF shortened-heading cases. |

Writer restored SHA-256 after each of these seven drills:
`923ce107bba78868bfaa5ed3ad5e2c30aed79af1ae37feb6ba26b464926ab605`.
Packager restored SHA-256:
`339bdbc329fecc49ff3dad13e738b70b06f86a83943dfbe62bf69147b75a3e08`.
All eight drills fired; final gates pass.

### Round 4 final gates (linuxlt)

- Repository timeouts, no `--testTimeout`, at most three files per run:
  `npx vitest run test/unit/whatsNewContent.test.ts
test/unit/whatsNewHtml.test.ts test/unit/whatsNewPanel.test.ts
--maxWorkers=3`: 36 + 13 + 10 = 59 passed.
  `npx vitest run test/unit/vsixPackaging.test.mjs
test/unit/changelogVersion.test.ts --maxWorkers=3`: 89 + 2 = 91 passed.
  Total: 150 passed. Packaging baseline preceded its deliberate mutation;
  its SHA-256 restore establishes the same passing bytes afterward.
- `npm run typecheck:unit`: pass (one tsc project, includes source and tests).
- Prettier on all nine changed files: pass. ESLint `--max-warnings=0` on
  all five changed code/declaration files: pass.
- `npm run check:l10n`: 14 UI tables, 14 usage tables, 0 problems.
- `npm run check:reference`: current (77 features, 71 commands, 100
  settings, 29 slash, 257 CLI); sharing reference current. No new runtime
  command, setting, surface or feature-catalog behavior.
- `npm run check:roadmap`: 207 entries current, with existing planned/partly
  shipped notices. No milestone status, label, release or roadmap entry
  changed; D79's selection and source-heading contracts are the plan change.
- `npm run build`: pass, including tokens, artifact writing, all bundle-size
  and split gates, host globals and third-party notices. Current measured
  What's New host 21,552 / 51,200 bytes; browser JS 713 / 25,600 bytes;
  content 25,347 / 40,960 encoded bytes and 68,401 / 76,800 decoded bytes.
- Direct built-artifact assertion: decoded artifact equals the chosen
  complete plan exactly. Real releases 0.17.0 + 0.16.0 stay full with flag
  absent; real package equals the legacy slice byte-for-byte. Package
  SHA-256 `80884cbd6619f27d7da8dedf8b777570494ab8c186894f8037f98c978b2547fd`.
- `git diff --check`: pass. No dependency, cap, timeout, visual markup,
  localization, credential or paid/model-call changes.

Next: lead reviews this round, integrates it, and runs full quality and
universal VSIX release qualification. No code blocker found in the focused
checks. Those broader release gates were not run: the rig brief prohibits
lane-wide quality; the universal package remains lead-owned. Installed
hooks and committed-diff verification passed for code commit
`4b60b7ae2fbd80c5d68693ba1078e394350e0530`: unchanged
`.husky/_` ran ESLint fix, Prettier and staged gitleaks (no leaks).
The saved staged patch and committed patch compared byte-for-byte equal;
both source SHA-256 values above remained unchanged. The staged and
committed diffs were re-read, and the worktree was clean afterward. This
final record is committed separately with the same installed hooks.

## Round 5 plan (2026-10-09, linuxlt)

1. Complete: round-4 regression run failed nine tests (seven content,
   two packaging). Uppercase HTTPS in newest Highlights refused as size;
   predecessor Highlights were omitted; predecessor Added notes were
   shortened. Invalid newest content was mislabeled as size; invalid
   predecessor content was silently omitted. Typed-result tests also failed.
2. Complete: encoder returns `encoded` with text, or `over-budget` with
   actual bytes and bound, for decoded/encoded overflow only. JSON, schema
   and compression exceptions propagate to selection's named failure,
   listing candidate releases and preserving the original error as `cause`.
   Selection stops immediately; it cannot discard those candidates or ask
   to trim notes. The writer handles the same typed result.
   Normalize HTTP/HTTPS schemes only, preserving path/query/fragment case.
   Absolute, relative and anchor links share that normalization and
   allowlist; unsupported schemes remain text, matching the artifact schema.
3. Complete: seven deliberate guard mutations failed their owning file,
   at repository timeouts with no test filters; every restore was byte-exact.
4. Complete: final owning suites, scoped static/build gates and exact
   built-artifact/package parity checks pass.
5. Complete: installed hooks passed; staged/committed patches byte-identical,
   source hashes unchanged, diffs re-read and worktree clean.

No new runtime surface, command, setting, dependency, cap or gate. Aggregate
quality and universal release qualification remain lead-owned under the
rig/common rules; this brief prohibits merge, push and rebase.

### Round 5 red drills

Backups, full logs and result JSON: `$TMPDIR/wnbudget-r5/`. Every run was
`npx vitest run test/unit/whatsNewContent.test.ts --maxWorkers=3`, all
48 tests, without timeout overrides or filters. Each mutation was restored
in `finally`; both source files were compared by SHA-256 after every drill.

| Guard             | Mutation                                        | Observed failures                                                        |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| URL normalization | Return the original scheme                      | 6: uppercase fitting plans and relative/anchor/mixed-case links          |
| URL allowlist     | Allow a resolved non-HTTP/HTTPS repository link | 1: emitted-link schema compatibility                                     |
| Fatal errors      | Swallow encoder exceptions                      | 2: newest/predecessor schema failures                                    |
| Decoded overflow  | Ignore the decoded bound                        | 1: typed decoded-size result                                             |
| Encoded overflow  | Ignore the encoded bound                        | 1: high-entropy typed encoded-size result                                |
| Size admission    | Admit the encoder's overflow result             | 1: full high-entropy predecessor wrongly retained                        |
| Schema validation | Parse JSON without validating content           | 3: named newest/predecessor failures and direct invalid-schema rejection |

Restored writer SHA-256:
`47c2a8c4ab3a94ca023305cbc166e4602042743fa1832ff378c0b5c1011b03ef`.
Restored encoder SHA-256:
`a52ae3465c3c18e3eae913b09d24b5715dbc99ddeb33471a7dc0deb61f072689`.

The shared duplication gate initially found a pre-existing 65-token clone
between the owning content file's two expected fallback-link assertions.
Both complete assertions now share one static expected fixture; no assertion
or threshold changed. The final `npx jscpd` passes with zero clones.

### Round 5 final gates (linuxlt)

- Repository timeouts, no overrides, at most three files per run:
  `whatsNewContent.test.ts` 48, `whatsNewHtml.test.ts` 13,
  `whatsNewPanel.test.ts` 10, `vsixPackaging.test.mjs` 91 and
  `changelogVersion.test.ts` 2: **164 passed**. Content replay after the
  fixture consolidation: all 48 passed again. Full command logs use
  `npx vitest run <files> --maxWorkers=3` in `$TMPDIR/wnbudget-r5/`.
- One `npm run typecheck:unit` project: pass. Changed-file ESLint
  `--max-warnings=0`, Prettier and `git diff --check`: pass.
- `node scripts/check-l10n.mjs`: 0 problems. `check:reference`,
  `check:roadmap` and `check:host-api`: current, 0 host API problems.
  `npm run deadcode`: pass; final `npx jscpd`: 0 clones.
- `npm run build`: pass, including tokens, artifact writing, bundle
  sizes/splits, host globals and notices; no cap changed. What's New host:
  21,552 / 51,200 bytes; browser entry: 713 bytes, with static imports
  1.3 / 25 KiB. Content: 25,347 / 40,960 encoded bytes and
  68,401 / 76,800 decoded bytes.
- Built decoded artifact equals the selected envelope exactly; production
  encoder validates and reproduces the artifact bytes. Real releases
  0.17.0 and 0.16.0 stay full, flag absent. Packaged notes equal the legacy
  slice byte-for-byte, SHA-256
  `80884cbd6619f27d7da8dedf8b777570494ab8c186894f8037f98c978b2547fd`.

Next: lead reviews/integrates this fix and runs aggregate quality and
universal VSIX qualification. No remaining code blocker in the scoped
checks. Those broader gates remain lead-owned; no merge, push, rebase,
hook/threshold relaxation, credential read or paid/live model call.

Code commit: `3a6f67d65a76fcad9b9a07faeef7a5087894390b`. Unchanged
`.husky/_` ran ESLint fix, Prettier and staged gitleaks (no leaks). Saved
staged and committed binary patches compare byte-for-byte equal; both
production source hashes above still match. Staged and committed diffs were
re-read. This final receipt is committed separately with the same hooks.

## Round 6 plan (2026-10-09, linuxlt)

1. Complete: regress uppercase repository schemes in fitting full,
   shortened predecessor and standing fallback plans; regress unsupported
   repositories before selection can inspect or encode any candidate.
   Before the fix, 7 content and 4 direct-packaging regressions failed;
   139 existing tests passed (repository timeouts, two files).
2. Complete: resolve generated full-notes URLs with the Markdown URL rule,
   validate once before selection, and share the result with packaging.
3. Complete: deliberate guard mutations, byte-exact restorations, owned
   What's New/packaging tests, one tsc, lint/format and production build.
4. Complete: commit with installed hooks, re-read staged/committed diffs,
   and report the head, receipts, remaining lead-owned gates.

No new runtime surface, command, setting, dependency, budget or gate.
No merge, push, rebase, paid or live calls. Aggregate quality and universal
release qualification remain lead-owned under the rig/common rules.

### Round 6 finding and repair

RVWNBUDGET5G's generated predecessor/fallback links bypassed `resolveHref`.
An uppercase repository could invalidate a later candidate after the full
plan encoded; unsupported repositories failed inside the same search.
`fullNotesHref` now resolves `CHANGELOG.md` through that existing rule and
throws a named repository error when refused. Selection resolves it once,
before its empty return or any candidate read, and every generated link
uses that result. Direct packaging uses the same helper. HTTP/HTTPS scheme
case is normalized; the remainder is preserved.

The new tests cover full, shortened predecessor and standing fallback plans
for `HTTPS` and `Http`, direct packaged links, unsupported schemes, missing
`//`, bare and empty repositories. Throwing candidate getters and a zero
budget prove repository validation precedes candidate inspection/admission.
The initial regression run failed all eleven added cases (7 content,
4 packaging); all 139 existing cases passed.

Lint rejected a declaration before the empty return and unsafe replacement
values in tests. Resolve into the local string parameter instead, preserving
validation before that return, and use replacement callbacks. No ignore or
rule change; the corrected changed-file ESLint run passes.

### Round 6 red drills

Full logs, JSON receipts and byte backups: `$TMPDIR/wnbudget-r6/`.
Every drill runs its entire owning file with `--maxWorkers=3`, repository
timeouts and no filters. Both production files are compared byte-for-byte
after each restoration, including the final replay after lint repair.

| Guard               | Mutation                                             | Observed failures                                                         |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Full-notes URL rule | Build raw repository URL instead of resolving it     | 7 of 55 content tests: both uppercase schemes and all repository refusals |
| Validation order    | Validate only when creating a shortened link         | 5 of 55 content tests: candidate getters run before repository refusal    |
| Packaged URL rule   | Build raw repository URL instead of using the helper | 4 of 95 packaging tests: uppercase schemes and non-HTTP repositories      |

Restored writer SHA-256:
`852c2061d645a86af4f133da81b4d22f53e8f24ac7bc8e75e3fd8afb8ed3f4d8`.
Restored packager SHA-256:
`8a37d40d11631e351b582e50cd347279170bf46b57ea6905d1dec76c5cb74f75`.

### Round 6 final gates (linuxlt)

- Final replay, repository timeouts with no overrides, at most three files
  per invocation; every invocation uses `npx vitest run <files> --maxWorkers=3`:
  `whatsNewContent`, `whatsNewHtml`, `whatsNewPanel`: **78 passed**;
  `vsixPackaging`, `changelogVersion`, `whatsNewBundle`: **102 passed**;
  `whatsNew`, `whatsNewPage`, `whatsNewVersions`: **31 passed**.
  Total: **211 passed**, nine files. All three drills preceded this replay.
- One `npm run typecheck:unit`: pass. Changed-file ESLint
  `--max-warnings=0`, Prettier and `git diff --check`: pass.
- `node scripts/check-l10n.mjs`: 14 UI and 14 usage tables, 0 problems.
  `check:reference`, `check:host-api`, `check:plan`, `check:roadmap`:
  current, 0 host API problems, 207 milestones with 0 plan drift.
  `npm run deadcode`: pass; `npx jscpd`: 0 clones.
- `npm run build`: pass, including tokens, artifact writing, bundle-size
  and split gates, host globals and notices. What's New host: 21,552 /
  51,200 bytes; browser entry: 713 bytes, 1.3 / 25 KiB with static imports;
  content: 25,347 / 40,960 encoded bytes, 68,401 / 76,800 decoded bytes.
- Production encoder reproduces the built artifact byte-for-byte from the
  chosen envelope. Real 0.17.0 and 0.16.0 stay full, flag absent. Packaged
  notes equal the legacy slice byte-for-byte, SHA-256
  `80884cbd6619f27d7da8dedf8b777570494ab8c186894f8037f98c978b2547fd`.

Changed files: the writer and declaration, packager, content and packaging
tests, D79, Unreleased note, releasing guide and this certification.
No runtime/UI markup, localization key, feature-catalog behavior, milestone
status, release, dependency, budget, gate or timeout changed; no install,
credential read or paid/live model call.

Next: lead reviews/integrates this fix and runs aggregate quality and
universal VSIX qualification. No remaining code blocker in the scoped
checks; those broader gates remain lead-owned under the rig/common rules.

Code commit: `c15d9c47ab45cb0e5da5069668cb9c68bf2ed157`. Unchanged
`.husky/_` ran ESLint fix, Prettier and staged gitleaks (no leaks).
Saved staged and committed binary patches compare byte-for-byte equal;
both production source hashes above still match. Staged and committed
diffs were re-read, and the worktree was clean before this receipt.
This final certification receipt is committed separately with the same
installed hooks; code and its verification bytes are unchanged.
