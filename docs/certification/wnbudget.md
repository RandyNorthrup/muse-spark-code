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
- Scope note: the standing-rule fallback entry still ships link-free in the
  page and is still absent from the packaged notes, as before; only the
  budget-shortened window was brought into agreement.

## Behaviour → test map

| Behaviour                                                              | Test                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Newest alone over budget refuses, naming release, size, bound          | `whatsNewContent`: refusal test (80 KB fixture at the real bound, exact message; small-bound variant) |
| Second fits fully / only Highlights fit / nothing fits                 | `whatsNewContent`: three selection tests (plan, link section, envelopes within bound)                 |
| Newest-with-Highlights fallback still holds, within budget or skipped  | `whatsNewContent`: fallback test (kept + skipped-shortened)                                           |
| Determinism (byte-identical)                                           | `whatsNewContent`: determinism test + real-CHANGELOG double-select                                    |
| Real CHANGELOG ships the same releases as today                        | `whatsNewContent`: real-CHANGELOG parity test (versions, full, not shortened)                         |
| Page Earlier-notes line only when shortened, translated at render time | `whatsNewHtml`: two tests; `whatsNewPanel`: content-flag test                                         |
| Packaged notes agree (full / Highlights+link / omitted; legacy parity) | `vsixPackaging`: writer's-plan test + real-CHANGELOG legacy-equality test                             |

## Red drills (each broke on purpose, failed, restored byte-exact)

Baselines recorded before breaking (`sha256sum`, backups under
`$TMPDIR/wnbudget-bak`); after each restore `sha256sum -c` reported OK for
all three files.

| #   | Break                                                                                               | Failing test (observed)                                                                                | Restore        |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| 1   | `selectWhatsNewReleases`: `if (canFit(candidate, false))` → `if (true)` (budget ignored)            | `ships the second release as its Highlights only …` — 1 failed, 22 skipped                             | OK `6518db7a…` |
| 2   | `whatsNewHtml`: Earlier-notes paragraph → `''`                                                      | `points at the full changelog only when older notes were shortened or left out` — 1 failed, 12 skipped | OK `f79de62d…` |
| 3   | `packagedChangelog`: `if (plan === undefined)` → `if (plan === undefined \|\| true)` (plan ignored) | `ships the writer's plan …` — failed                                                                   | OK `36753de8…` |

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
- `node scripts/check-l10n.mjs`: 0 problems.
- `node scripts/gen-reference.mjs --check`: pass (no command/setting/feature touched).
- `npm run build` (production, includes the writer end-to-end,
  `check-bundle-size`, `check-bundle-split`, `check-host-globals`): pass.
  `dist/whatsNew.json` 25,347 bytes (40 KiB budget),
  `dist/whatsNew.js` 21,552 bytes (50 KiB budget).
- `npx prettier --check`, changed-file ESLint (`--max-warnings=0`),
  `tsc -p tsconfig.json --noEmit`, `tsc -p test/unit/tsconfig.json
--noEmit`: pass.
