# RLM77 — M77 session board and best-of-N: land msm77 (D49)

Date: 2026-10-21. Worktree: `C:/Users/Randy/Coding/mx-app-rlm77`,
branch `rec/rlm77`. Base `c7bdd3e943` (0.19.0); merged source tip
`2a76aafdcf` (`src/RLM77/01-rv-msm77`, which contains `02-c-m77-1` at
`5b0f766cae` and `03-rv-cm771` at `5d7343314b`).

This record is the current-tree evidence. The source lanes' own receipts
are historical: [m77.md](m77.md) (C-M77-1, 2026-10-10) and
[msm77.md](msm77.md) (finish lane, Linux rig). No model or paid request
ran in this lane; the paid end-to-end best-of-N run waits for the
owner's go.

## What landed

One merge, resolved by meaning for current main:

- C-M77-2: each attempt keeps its own reported spend on the run
  (`src/shared/bestOfN.ts` gains optional `reportedInputTokens`,
  `reportedOutputTokens`, `reportedCostUsd`, `hasUnreportedCost`;
  `src/core/bestOfN/attemptUsage.ts` sums validated per-response deltas;
  `src/core/bestOfN/bestOfNRunner.ts` folds each delta into the attempt
  and publishes). The comparison names each attempt's reported tokens
  and, when the provider reported one, its reported cost; the take
  notice names the taken attempt's reported use and complete reported
  cost. Both sentences live in the shared
  `src/shared/bestOfNAttemptText.ts` so host and webview name the same
  figures. A partial total says more is pending; unknown requests stay
  unknown and the aggregate Account & usage row is unchanged.
- D121/D208 preserved: the source's min/max attempt and ceiling bounds
  were dropped at merge (main's person-choice validation stands); the
  source's journal/reservation paragraphs stay historical. No cap,
  timeout, retry count or default of ours was added.
- Main's deleted stand-in suites stay deleted
  (`bestOfNManager`, `bestOfNSnapshot`, `modelApiAttemptBudget`,
  `bestOfNAttempts`, `bestOfNRunner`, `sessionBoardHost`,
  `worktreeConversationHost`, `helpers/bestOfN`, `git`,
  `BestOfNDialog`, `SessionBoardDialog`): the merge restores none.
- Narrow harness scenes (`board-narrow`, `bestofn-narrow` in
  `scripts/lib/harnessServer.mjs` and `test/harness/index.html`).
- The reference catalog marks `best-of-n` VS Code-only (`['vscode']`
  with the C-M77-3 row named as work, not a claim).
- Docs: README's Session board and best-of-N section, one
  `[Unreleased]` CHANGELOG entry, the M77 roadmap summary, four UI
  strings in English plus all 14 tables.

Conflict resolutions (5 files, all verified against both sides before
staging): `src/shared/bestOfN.ts` and
`src/webview/components/BestOfNDialog.tsx` keep main's D121 validation
and exact-money formatting with the source's spend fields; the take
notice in `src/host/conversation/conversationController.ts` is the
source's hunk on main's file; `CHANGELOG.md` takes main's 0.19.0 notes
with this lane's own entry added after; `ROADMAP.md` regenerated.

## Current-tree proof

- `test/unit/bestOfNAttemptUsage.test.ts`: accumulation through the
  real module replaying recorded provider replies (M106 u10/u8,
  2026-10-05; OR-UNSUP, 2026-10-13 UTC). No request is sent.
- `test/unit/bestOfNAttemptText.test.ts` (new): the exact comparison
  and take sentences over recorded figures, including the sticky
  partial (a later receipt never clears an earlier gap).
- `test/unit/bestOfN.test.ts`: real Git worktrees in a disposable
  repository — immutable binary snapshot, staged application without a
  commit, later attempt edits not followed, a changed target refused.
- Local looks (exit 0 each; PNGs in gitignored `temp/ui-look/`, SHA-256
  below): `bestofn`, `bestofn-narrow`, `board`, `board-narrow`, light
  and dark. The comparison shows all three spend states (complete,
  partial, none); narrow scenes hold 320 px with no page overflow.

| Picture                  | SHA-256                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| bestofn.light.png        | FA1E40F43FF7B8632AD677BF5B8171B9A10AE4467D6A7666EB9930F323A1196F |
| bestofn.dark.png         | DDD356867F9C61940CA78E150477B40DAAF41F5215AF78318F7C8BC3B09A799A |
| bestofn-narrow.light.png | A148749D672F134320004336A694B41CCA3F6046ECE8A3FDA76B00472C5D618E |
| bestofn-narrow.dark.png  | 87B8B2C93E4899008E8A48B0B1120C6633B643082F8C883A74CC9BD7717E83B1 |
| board.light.png          | 71D9C377E773CE11C90F20894A93A60AAC39CA3A57171990C16E290C0B908857 |
| board.dark.png           | 8B9DF5DB9E3D6DFC78FEE68C33A7F7B071F20D86F11E2BD47BCFBEB49807D299 |
| board-narrow.light.png   | 61AB8DFC3BDC036C70411D2F99A45F4F24EE97DA00EE645100EB05CC400D60B1 |
| board-narrow.dark.png    | CFAF30E9538D019BCACE35A5706E160131B15B7A4EBCB3D0E66BC3C41DA41FF3 |

## Red/restored-green drills

Each drill broke the file below, ran its owning suite (non-zero exit,
named failure), restored byte-exact (SHA-256 matched), and ran green.

| Drill            | Break                                                                   | Red                                                   | Restored                     |
| ---------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| partial sentence | `bestOfNAttemptText.ts`: partial branch uses the complete cost template | exit 1, `says more is pending…` fails, 5 pass         | `14B415CE…`, exit 0, 6 pass  |
| sticky partial   | `attemptUsage.ts`: drop `hasPartial` from the flag                      | exit 1, `keeps exact reported spend…` fails, 1 passes | `0FE5C53D…`, exit 0, 2 pass  |
| staged take      | `bestOfN.ts`: drop `--index` from take args                             | exit 1, worktree take + args shape fail, 14 pass      | `F0905F38…`, exit 0, 16 pass |

The sticky-partial drill first stayed green: the pre-existing cases
never sent a receipt after a gap, so the mutation passed. The gap-first
case (recorded u10 then OR-UNSUP, total stays partial at `0.00000091`)
was added to the same test before re-running the drill; the drill
above is against the strengthened test.

## Gates (final tree, real exits)

Prettier on touched files 0; ESLint `--max-warnings 0` on touched
sources 0; typecheck (all five projects) 0; `check:l10n` 0 problems;
`check:reference` current; `check:host-api` 0 problems; `check:plan`
222 milestones, 0 drift; `check:roadmap` current; `check:catches`
matches baseline (GENERIC 266, one runner site reclassified by the
merge's reported-catch change); duplication 0 clones; cycles none;
deadcode 0; build 0 with budgets holding (activation 424.8/600 KiB,
Model API 521.0/525 KiB, conversation 247.3/300 KiB, sessionBoard
49.5/75 KiB); SAST exit 2 (semgrep-core fails its own rule validation
before scanning any target: `RPC subprocess failed`, a broken install on
this machine, not a finding); `security:audit` 0.

Suites: `bestOfN` 16/16, `bestOfNAttemptUsage` 2/2,
`bestOfNAttemptText` 6/6. `vitest related` over the eight changed
sources: 707 files passed, 21,991 tests passed; 7 failed, all in
unrelated files at symlink creation (`EPERM: operation not permitted,
symlink`) or the vault TEMP guard — this account's limits, not the
change. The TEMP-guard file passes with the lane's `TEMP` override;
the six symlink failures are left to hosted CI.

Two local findings, both handled in this lane: (1) a stale
gitignored `dist/traffic-harness/` from an earlier look run fails the
build's lazy-registry check; it was removed (regenerated on demand)
before the final build. (2) `tail.exe` in a pipeline masks the real
exit code; every exit above was captured from `$LASTEXITCODE` with no
native pipe.

## What remains

- C-M77-1 current VS Code proof beyond this record: the 2026-10-10
  receipts stand as history (the canonical-path refusal bodies they
  exercised are byte-identical on this tree, verified across
  `src/RLM77/01-rv-msm77` → 0.19.0). A fresh packed-product pass and
  the axe gate are lead-run.
- C-M77-3 per-editor bindings: verified still true on this tree — the
  board's ACP binding is `session/list`, `session/resume`,
  `session/close`; `ACP_PAID_FEATURES` has no best-of-N flag
  (autoCompaction, webSearch, imageGeneration, voice); native hosts
  wait on M60–M66. The bindings themselves are unbuilt.
- C-M77-4 three-OS/editor qualification, independent review, and the
  paid end-to-end run: lead/owner items. The paid run is named and
  waits for the owner's go; this lane sent no provider request.
