# VISREGEN017 — quote-menu instability repaired; release refresh held

The quote-menu timing defect is repaired and reproduced with exact prior
failure counts. The complete 0.17.0 golden/README refresh is still blocked:
release head `8f0a75ea1` cannot build its packaged What’s New content within
the existing decoded-content bound. No golden or README update is accepted.

Linux rig `linuxlt`, branch `rel017/visregen2`, base `8f0a75ea1`. Fix commit
`7aeadf624102fdd47df12100844dc52c04172396`. No merge, push, dependency install,
external network request, live or paid model call. All browser requests stay
on loopback. Hooks remain `.husky/_`; policy, deadlines and budgets are unchanged.

## Root cause and ordered hypotheses

The harness replaces the init-script API stub with its real fake host. That
host saves webview state in `sessionStorage`. The full matrix visits
`questions-open` immediately before `quote-menu`, so the quote scene restores
its question row. Ten isolated quote runs omit that row and cannot reproduce
the full-matrix race; adding the actual preceding scene restores it.

`DeferredQuestionUi` initially draws `QuestionLoadingCard` with
`data-question-slot` and `aria-busy="true"`. It does not use
`data-deferred-loading`. The existing capture loop therefore proceeds while
that lazy question is still loading. At 320 px its placeholder is 25 px high;
its settled question row is 39 px high. The passage moves down 14 px after
its synthetic context click, while the pointer-origin menu correctly retains
the supplied coordinates. The race belongs to capture readiness.

| Hypothesis                   | Measured result                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Scrollbar after measurement  | Body and document client widths remain 320 px; passage width remains 272 px. No 14 px scrollbar loss.                              |
| Font after measurement       | `document.fonts.status` remains `loaded`; font set size is zero; no loading-done event. Pill and passage font/width remain stable. |
| Quoted text wrapping late    | Passage height remains 39 px and width 272 px. Its top moves; its wrapping does not.                                               |
| Capture before stable layout | Confirmed: restored question grows 25 → 39 px while its busy marker disappears.                                                    |

A controlled request hold on the real `QuestionUi` chunk exposes the race
in ten repetitions. With the original readiness selector, the replay happens
at passage/menu Y = 207 px. After the question settles the passage is at
221 px while the menu remains at 207 px. This produces the **exact** six
narrow failures recorded in the earlier rejected refresh:

| State         | Changed pixels | Allowance |
| ------------- | -------------: | --------: |
| default       |          9,603 |        12 |
| hover         |          9,603 |        12 |
| focus-visible |          9,603 |        12 |
| pressed       |          9,533 |        12 |
| disabled      |          9,600 |        12 |
| selected      |          9,600 |        12 |

At 690 px the same controlled omission also fails all six states, with
9,586–9,682 changed pixels. Full DOM measurements and per-state results are
in [the stability receipt](visregen017-stability.json).

## Fix, tests and failure drill

`test/harness/goldens/capture.mjs` now calls `waitForDeferredPaint` before
resize/refitting and context replay. Its existing bounded loop also watches
`[data-question-slot][aria-busy="true"]`. An unresolved row fails with the
existing explicit scene error. Product positioning, focus, accessible names,
responsive geometry, animation and the before-paint pill measurement are
unchanged. No pixel allowance or timeout is raised.

`test/unit/visualReadiness.test.mjs` runs a real Chromium page at the
repository deadlines. It covers the observed 25 → 39 px late row, ordinary
deferred loading, and a never-settled question. Fresh pages isolate timers
between tests. The old-selector drill yields two failures and one pass:
the passage is measured before moving, and an unresolved question is
incorrectly accepted. Restoring the selector makes all three tests pass.

The tested capture file is restored byte-exact after the drill:
`fd80e56a32a0368dcbdd253ded59a4566ec691cf0b43842564aed03969121a93`.
The hook’s final committed source has that same SHA-256. Both staged and
committed diffs are reread. No escape hatch is introduced.

## Repetition proof

The full build and fixture writer fail before browser setup, so these are
explicitly **diagnostic browser receipts**, not a green production build or
complete visual certification. The diagnostic compiles the repository’s exact
production browser graph, then uses the real capture driver with DOM
measurement callbacks. It prepares only the requested ordinary harness scenes;
unrelated What’s New fixture preparation is excluded from this diagnostic.
The standard gates are run independently and their failures remain below.

- Ten cold isolated runs: all six states at 320/690 px are byte-identical;
  these explain why the earlier isolated investigation missed the restored row.
- Ten controlled old-selector runs: real lazy question delivery after replay
  leaves a 14 px stale origin and reproduces the previous narrow pixel counts.
- Ten consecutive fixed-selector runs with a delayed real chunk request:
  **120 quote frames**, both widths and all six states, are byte-identical
  within every state/width group. Settled passage and menu Y match.
- Ten further six-theme repetitions with the preceding question scene:
  **720 quote frames / 72 state-theme-width groups**, zero counted pixel
  differences under the unchanged pixel policy. Thirteen groups have PNG
  hash differences confined to pixels the existing AA policy excludes; their
  DOM geometry and menu origin stay constant. The strict single-theme proof
  above retains its byte-equality result separately.

Chrome is `153.0.8010.52`. Captures use the existing fixed English/UTC clock,
320/690 × 760 px, scale 1, reduced motion and disabled animations. Every
archived diagnostic PNG is hash-verified before comparison. No pose is chosen
by replacing a failed golden.

## Carried-forward changed-scene review

This table comes from `502013afa:docs/certification/visregen017.md` and its
initial 9,792-frame comparison on `7973a33ac35d205ae1932e454b2eace93ca8b3bd`.
It preserves the earlier review; **it is not a fresh full-matrix acceptance
on this head**. That review found exactly 1,596 over-allowance frames in these
23 scenes. Its later quote-menu displacement is now explained and reproduced.
The current complete matrix must still be reviewed after the build hold clears.

| Scenes                                                                                                                                                                                                                                                                                            | Changed frames per scene | Cause                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------: | -------------------------------------------------------------------------- |
| `agents-details`                                                                                                                                                                                                                                                                                  |                       48 | 75% status mark; high-contrast narrow mark obscured by the existing dialog |
| `team-cards`                                                                                                                                                                                                                                                                                      |                       36 | 75% status mark at 690 px; narrow capture does not show the working row    |
| `approval-moved`, `approval-narrow`, `approval-several`, `column`, `elicitation-narrow`, `judge-narrow`, `long-patch`, `markdown`, `muse-shell`, `muse-tools`, `muse-workflow`, `paid-image`, `question`, `question-filled`, `status-heartbeat-narrow`, `thinking`, `todo`, `tools`, `tools-open` |                       72 | 75% mark and the 4 px reduction in the working row's occupied width        |
| `chat-tool-menu-narrow`, `quote-menu`                                                                                                                                                                                                                                                             |                       72 | Pills sized to the longest label with the existing fan/edge-clamp geometry |

The authorized causes remain the 75% status mark and loop, heartbeat tick,
shorter fork labels and longest-label pill widths. No new scene is approved
by this lane. Current manifest and all README bytes remain unchanged.

## Current verification

| Command / owner                                                                                                                     | Result                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/visualReadiness.test.mjs test/unit/GooeyMenu.test.tsx test/unit/Transcript.test.tsx --maxWorkers=3`       | Final sequential run exits 0: 3 files / 83 tests.                                                                                                                                                                                  |
| `npx vitest run test/unit/m114Audit.test.mjs test/unit/m114Panel.test.mjs test/unit/m114ConversationReview.test.mjs --maxWorkers=3` | 165 pass; inherited current-source audit fingerprint fails (166 total). Panel and conversation-review files pass.                                                                                                                  |
| `npx vitest run test/unit/visualStability.test.mjs test/unit/visualCapture.test.mjs --maxWorkers=3`                                 | Both setup hooks fail while invoking the inherited broken notes build; 12 tests do not execute. `execFileSync` reports ENOBUFS from the generated error’s large inline-module stack. Direct build identifies the size guard below. |
| `readmeShots.test.mjs` complete-file replay                                                                                         | 16 pass; inherited pixel-input digest fails (17 total). It requires actual recapture before updating the digest.                                                                                                                   |
| `npm run typecheck`                                                                                                                 | Exit 0: all five projects, including e2e and integration. The previous lane’s e2e deferral is resolved on this base.                                                                                                               |
| Changed-file ESLint / Prettier                                                                                                      | Exit 0.                                                                                                                                                                                                                            |
| `npm run deadcode`                                                                                                                  | Exit 0; plain knip.                                                                                                                                                                                                                |
| `npx --no-install jscpd`                                                                                                            | Exit 1: inherited 51-token clone at `test/unit/windowsTrustedPath.test.ts:206,279`; none in the changed files.                                                                                                                     |
| `npm run check:l10n`                                                                                                                | Exit 0: 14 UI tables, 14 usage tables, 252 manifest strings, zero problems.                                                                                                                                                        |
| `npm run check:reference`                                                                                                           | Exit 0: 77 features / 71 commands / 100 settings / 29 slash / 257 CLI entries.                                                                                                                                                     |
| `npm run check:host-api`                                                                                                            | Exit 0: 375 APIs / 48 VS Code files / 30 built-ins / 71 theme variables.                                                                                                                                                           |
| `npm run check:tokens`                                                                                                              | Exit 0, zero problems.                                                                                                                                                                                                             |
| `npm run check:plan`, `npm run check:roadmap`                                                                                       | Exit 0; roadmap generation runs successfully and remains current.                                                                                                                                                                  |
| `npm run build`                                                                                                                     | Exit 1 at the inherited What’s New decoded-content guard, before bundling and bundle-size checks. No current build-size certification.                                                                                             |
| `npm run check:visual` (normal)                                                                                                     | Exit 1 at the same build guard; no matrix frames are accepted.                                                                                                                                                                     |
| `npm run check:visual:a11y`                                                                                                         | Exit 1 in fixture notes preparation, before axe scans. No clean six-theme a11y result is claimed.                                                                                                                                  |

All unit commands use at most three files and three workers; no CLI timeout
overrides. Vite’s config-loader warning and jsdom’s canvas warning are retained.
An exploratory owning-test batch overlapped another browser batch; its pass
is excluded as the final fix receipt. The isolated sequential 83-test replay
above is the accepted final fix run. The separate M114 browser owners build
in memory and pass, but their stale audit failure remains unwaived.

A proof-record commit first fails the unchanged secret scanner on six
`generic-api-key` findings. Redacted metadata locates only scene identifiers
stored under a field called `key`. The receipt uses the descriptive
`captureGroup` field instead; no value is hidden and no scanner rule, ignore,
threshold or hook changes. The retry passes the same installed hook.

## Blocking dependency and preserved artifacts

The current release notes serialize to 79,510 bytes:
0.17.0 contributes 43,730 bytes and 0.16.0 contributes 35,753 bytes, plus the
outer JSON. `WHATS_NEW_CONTENT_DECODE_MAX_BYTES` is 76,800 bytes (75 KiB),
so the tree exceeds it by 2,710 bytes. The on-disk bound remains 40 KiB.
`writeWhatsNewContent` fails at encoding before the normal build and visual
fixture preparation can complete. The owner/lead must resolve this release
content dependency within approved scope; this lane does not raise bounds or
remove release content to make the gates green.

Current-source audit hashes are stale for App, GooeyMenuContent, Transcript,
gooeyLayout and styles.css from changes already in `8f0a75ea1`. The README
input digest is also stale (`3e6b4f663d2b85c63e52e713ba40a5bbebcf67fd3a97fa538e5bc3f1541816e9`
versus recorded `b1d68ff977e7e661bb2609e5839840d5e308a163ed5ea02bf306dc5f616d5b62`).
They are not recertified before the required current-source full capture.
Goldens/shots/source-record refresh is therefore held as one review unit.

SHA-256 and byte comparison against `8f0a75ea1` verify:

- Original golden manifest:
  `c18961a47c55863b3955e9ddec2b41b25ac6004920b1af63764a0ffb63ea0ae4`.
- All 20 README PNGs, including the excluded banner: **1,504,185 bytes**,
  unchanged and below 2 MiB.

The reviewed-update command, README replacement and a successful normal full
visual/a11y replay remain unfinished. The inherited Windows duplication
finding is also open. Full quality and hosted CI remain lead-owned under the
shared lane rules. No Windows/macOS qualification or publication is claimed.

## Evidence and next work

Tracked [stability receipt](visregen017-stability.json) contains DOM stages,
original exact pixel failures, ten-run PNG hashes, geometry, 720 comparisons,
source commit and raw-receipt digests. Full images stay outside Git:

- `/var/tmp/l-VISREGEN2/visregen2-probe/`: ten cold quote repetitions.
- `/var/tmp/l-VISREGEN2/visregen2-prefix/`: preceding question scenes and quote.
- `/var/tmp/l-VISREGEN2/visregen2-held-question/`: controlled old-selector race.
- `/var/tmp/l-VISREGEN2/visregen2-fixed-question/`: strict ten-run fixed proof.
- `/var/tmp/l-VISREGEN2/visregen2-fixed-all-themes/`: 720 quote PNGs.
- `temp/visregen2-*.json` and `temp/visregen2-*.log`: raw DOM, pixel
  comparisons, artifact-preservation receipt, red drill and all gate results.
- `temp/build-quote-probe.mjs`, `temp/capture-*.mjs` and `temp/quote-*.mjs`:
  exact diagnostic build/capture drivers for reproduction on this rig.

Next: resolve the packaged-notes bound without weakening gates, rebuild,
repeat the standard capture owners, review all 9,792 current-source frames,
run the reviewed golden update and normal replay, regenerate/review README
shots and pinned source records with the repository’s capture tools, then
pass all requested owners and six-theme accessibility. Carry the table above
forward and reject any unexplained scene difference. The root readiness fix
and its proven regression are ready for lead review independently of that hold.
