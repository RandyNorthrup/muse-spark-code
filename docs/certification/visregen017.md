# VISREGEN017 — quote-menu repair and 0.17.0 visual refresh

The restored-question capture race is repaired. The lead-approved editorial
repair preserves every 0.17.0 change while bringing packaged notes within
unchanged bounds. Complete capture review, regenerated pixels and final gate
results follow below; the historical ten-run proof is preserved.

Linux rig `linuxlt`, branch `rel017/visregen2`, base `8f0a75ea1`. Prior commits
`7aeadf624`, `7fad4643d` and `c2d70ac64` remain intact. Editorial input commit
`53fb033b49635ec95e0d5fa26dbed5248db445e8` is the new manifest's reconstructible
source. Artifact commit `ff064335f125f420e38748cfdfc700195554e6a6`
passes installed hooks; all eleven committed blobs match staged/tested bytes
and the worktree exactly. Hooks stay `.husky/_`; no merge, rebase, push, install, external
network request or live/paid model call. Browser traffic is loopback only.

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

The original build hold required **diagnostic browser receipts** for this
root-cause proof. Those receipts remain historical diagnosis, separate from
the standard production-build and complete-matrix replay recorded below.
The diagnostic compiles the repository’s exact
production browser graph, then uses the real capture driver with DOM
measurement callbacks. It prepares only the requested ordinary harness scenes;
unrelated What’s New fixture preparation is excluded from this diagnostic.
The standard gates run independently; their final results follow below.

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

## Release-content repair

The lead's resume decision authorizes editorial tightening of 0.17.0 only,
with every listed change, all five Highlights and the section structure
preserved. The rewritten notes retain all sixteen sections in order. One
previously orphaned diagnostics sentence becomes its own bullet. Unreleased,
0.16.0 and every older release remain byte-exact. No internal lane names,
review IDs, SHAs or test counts are added to the release notes.

The two-release writer falls from **79,510 to 68,401 decoded bytes**, below
the lead's 72,000-byte target and unchanged 76,800-byte bound. Encoded output
is **25,347 bytes**, below its unchanged 40 KiB bound. 0.17.0 contributes
32,621 decoded bytes, 0.16.0 remains 35,753, and outer JSON contributes 27.
Both notes owners pass: two files, eighteen tests, repository deadlines.
Commit `53fb033b49635ec95e0d5fa26dbed5248db445e8` contains this repair alone
with its plan update. The installed hook passes; committed text and plan are
reread and the rewritten section matches the reviewed text byte-for-byte.

## Complete current-head changed-scene review

The earlier review from `502013afa:docs/certification/visregen017.md` is
carried forward below and independently rechecked on source `53fb033b4`.
The original baseline is `484964c46c307b48a5f00b127c4bf358dd27aebf`.
All **9,792 frames** are captured and compared: 136 scenes, 185 audited
renderers, six themes, both widths and all six states. There are 2,696
byte-different frames and **1,704 over-allowance frames in 25 scenes**.
The original 23 scenes account for the same 1,596 frames as the earlier
review; the complete current notes add 108 frames in two scenes.

| Scenes                                                                                                                                                                                                                                                                                            | Changed frames per scene | Reviewed cause                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------: | -------------------------------------------------------------------------------------------------------- |
| `agents-details`                                                                                                                                                                                                                                                                                  |                       48 | 75% status mark; high-contrast narrow mark remains obscured by the existing dialog.                      |
| `team-cards`                                                                                                                                                                                                                                                                                      |                       36 | 75% status mark at 690 px; narrow view does not show the working row.                                    |
| `approval-moved`, `approval-narrow`, `approval-several`, `column`, `elicitation-narrow`, `judge-narrow`, `long-patch`, `markdown`, `muse-shell`, `muse-tools`, `muse-workflow`, `paid-image`, `question`, `question-filled`, `status-heartbeat-narrow`, `thinking`, `todo`, `tools`, `tools-open` |                       72 | 75% mark and 4 px reduction in the working row's occupied width.                                         |
| `chat-tool-menu-narrow`, `quote-menu`                                                                                                                                                                                                                                                             |                       72 | Longest-label pill widths, existing fan and edge clamps; settled vertical pointer origin.                |
| `whats-new`                                                                                                                                                                                                                                                                                       |                       36 | Approved complete 0.17.0 notes and tightened first Changed entry; visible at 690 px.                     |
| `whats-new-footer`                                                                                                                                                                                                                                                                                |                       72 | Approved complete 0.17.0 notes and shorter content; retained Security section now visible at the footer. |

The old baseline's 0.17.0 section has no Security heading: those entries were
still under Unreleased. Release head `8f0a75ea1` already moved them into
0.17.0. The lead's instruction preserves them; this lane introduces no
additional feature or unrelated content. All five Highlights remain exact.
The footer controls keep their geometry and interaction states.

Every one of the 43 labelled before/after counted-region sheets is inspected,
covering all 1,704 over-allowance frames across themes, widths and states.
The bounding-mask calculation verifies its count against the repository's
unchanged pixel comparison for every frame. Identical pairs are grouped by
exact crop bytes; no failed pose is substituted. The numeric comparison also
retains 21 within-allowance frames in `goal-edit` and `tasks-tab`, totaling
26 counted pixels, at most three per frame. Two additional sheets inspect
all 21 of these frames: unchanged goal focus/selection edges and task-title
glyph edges, with identical geometry and labels. Their exact counted masks
are verified too. Total review: 45 sheets covering every nonzero comparison.
Remaining hash differences have zero counted pixels under the existing antialiasing policy.

The accepted causes also include the owner's heartbeat tick, activity loop
and shorter fork labels. The reduced-motion, frozen matrix does not show
the loop or ticking; their owning suites are replayed independently. README
captures show the updated heartbeat and fork labels. No product positioning
or responsive/accessibility behavior is changed by the harness fix.

## Reviewed baseline, README and source records

The repository's reviewed-update flow captures all 9,792 images with review
`VISREGEN2-0.17.0-status-menu-and-notes-2026-10-09`, from committed source
`53fb033b49635ec95e0d5fa26dbed5248db445e8`. Full PNGs remain outside Git in
`/var/tmp/l-VISREGEN2/visregen2-reviewed-final`: **446,665,174 bytes**, below
512 MiB. The tracked manifest retains source revision, byte hashes,
dimensions, browser/rasterization metadata, applied states and renderer
coverage. Its policy remains threshold 0.1, antialiasing excluded, ratio
0.0001 and maximum twelve changed pixels.

A separate complete comparison checks all 9,792 reviewed-capture PNGs
against the updated archive, verifies bytes and dimensions, and asserts
identical renderer and applied-state lists. It has zero failures, 31 counted
pixels total and at most three in an image. All 72 quote-menu frames have
**zero counted changes**; twenty PNG hash differences have zero counted
pixels. This current-head receipt supplements the strict historical ten-run
byte-equality proof; it does not replace it. The normal gate replay is
recorded separately below.

`npm run readme:shots -- --out temp/visregen2-resume-readme-preview`
regenerates all nineteen configured screenshots. Review accepts eight:
`agents`, `approval`, `question`, `quote`, `rewind`, `turn`, `open-question`
and `resources`. They show only intended status, heartbeat, fork-label and
pill geometry changes, plus the generator's fresh row timestamps in its two
menu shots. Nine are byte-identical. `history` changes only a fixture date;
`deterministic-report` changes only the report's source digest. Their
original images are retained after inspection. The excluded banner stays
byte-exact. Final twenty-PNG set: **1,504,644 / 2,097,152 bytes**.

Only after the complete capture, the existing audit reader/digest helper and
README fingerprint procedure refresh the five stale current-source SHA-256
records: `App.tsx`, `GooeyMenuContent.tsx`, `Transcript.tsx`, `gooeyLayout.ts`
and `styles.css`. All 185 audit renderers are present in the capture.
Historical before-image hashes, grades, revision and notebook remain intact;
no current-audit writer is shipped. README's unchanged assertion now pins
`3e6b4f663d2b85c63e52e713ba40a5bbebcf67fd3a97fa538e5bc3f1541816e9`,
replacing the stale `b1d68ff977e7e661bb2609e5839840d5e308a163ed5ea02bf306dc5f616d5b62`
after the actual recapture. No hash gate is weakened.

Production build passes every current size, split, host-global and notice
check. Measured key budgets: activation 550.1 / 600 KiB; Model API
515.8 / 525 KiB; checkpoint store 87.3 / 225 KiB; chat entry plus static
imports 742.2 / 900 KiB. These are the existing source-of-truth caps;
no size rule is edited by this lane.

## Final scoped verification

| Command / owner                                                                                                                                  | Result                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npx vitest run test/unit/visualStability.test.mjs --maxWorkers=3`                                                                               | Exit 0; 1 test passes at repository defaults.                                              |
| `npx vitest run test/unit/visualCapture.test.mjs --maxWorkers=3`                                                                                 | Exit 0; 11 tests pass at repository defaults.                                              |
| `npx vitest run test/unit/readmeShots.test.mjs --maxWorkers=3`                                                                                   | Exit 0; 17 tests pass at repository defaults.                                              |
| `npx vitest run test/unit/m114Audit.test.mjs test/unit/m114Panel.test.mjs test/unit/m114ConversationReview.test.mjs --maxWorkers=3`              | Exit 0; 166 tests pass at repository defaults.                                             |
| `npx vitest run test/unit/visualReadiness.test.mjs test/unit/GooeyMenu.test.tsx test/unit/Transcript.test.tsx --maxWorkers=3`                    | Exit 0; 83 tests pass at repository defaults.                                              |
| `npx vitest run test/unit/HeartbeatTrace.test.tsx test/unit/m114Conversation.test.mjs test/unit/rowMenus.test.tsx --maxWorkers=3`                | Exit 0; 69 tests pass at repository defaults.                                              |
| `npm run typecheck`                                                                                                                              | Exit 0.                                                                                    |
| `npx eslint --max-warnings=0 test/unit/readmeShots.test.mjs test/harness/goldens/capture.mjs test/unit/visualReadiness.test.mjs`                 | Exit 0.                                                                                    |
| `npx prettier --check CHANGELOG.md PLAN.md docs/certification/m114-audit.json test/harness/goldens/manifest.json test/unit/readmeShots.test.mjs` | Exit 0.                                                                                    |
| `npm run deadcode`                                                                                                                               | Exit 0.                                                                                    |
| `npx jscpd`                                                                                                                                      | Exit 1; inherited 51-token clone in windowsTrustedPath.test.ts; no clone in changed files. |
| `npm run check:l10n`                                                                                                                             | Exit 0.                                                                                    |
| `npm run check:reference`                                                                                                                        | Exit 0.                                                                                    |
| `npm run check:host-api`                                                                                                                         | Exit 0.                                                                                    |
| `npm run check:tokens`                                                                                                                           | Exit 0.                                                                                    |
| `npm run check:plan`                                                                                                                             | Exit 0.                                                                                    |
| `npm run check:roadmap`                                                                                                                          | Exit 0.                                                                                    |
| `npm run build`                                                                                                                                  | Exit 0.                                                                                    |
| `npm run check:visual`                                                                                                                           | Exit 0; complete 9,792-frame normal replay, unchanged policy.                              |
| `npm run check:visual:a11y`                                                                                                                      | Exit 0; 1632 pages, zero violated pages; incomplete findings retained.                     |

Six required visual owners pass all 195 tests. Fix and rendering owners add
152 passing tests; the notes owners add eighteen. Total: **365 passing unit
tests**, at most three files/workers per invocation, sequential suite batches,
repository test deadlines and no CLI timeout overrides. Vite's config-loader
warning and jsdom's canvas warning remain visible in logs.

The six-theme axe observation covers light, dark, high-contrast dark,
high-contrast light, One Dark Pro and Dracula at true 320/690 px widths.
It records **1632 pages, zero pages with violations,
315 pages with 315 incomplete findings**.
Every incomplete finding remains in the raw receipt; this scoped WCAG
2.2 AA observation does not claim to replace the broader `test:a11y` gate.

The initial normal visual command deliberately retains the old baseline and
fails on the first expected status change: `agents-details/default/light/320`,
50 pixels against allowance twelve. The reviewed update happens only after
the complete cause review. The final normal command passes all 9,792 frames
with eighteen counted
pixels within unchanged per-image tolerance; its manifest remains unchanged.
The existing hash owners previously failed on stale records; they now pass
after actual capture. No tests, scanner rule, ignore, pixel allowance, content
bound, build cap, hook or timeout is weakened. No new gate is introduced.

The earlier proof-record hook rejected scene identifiers under a field named
`key`. Renaming only that metadata field to `captureGroup` preserved all
values and passed the unchanged scanner. The old-selector red drill remains
two failures/one pass, then all three readiness tests pass after byte-exact
restoration. A resumed drill removes only the ordinary deferred-loading
selector: its named regression fails, while both question cases pass.
Restoring the file to the same SHA-256 makes all three tests pass again at
repository defaults. Every readiness regression has now been observed to
fail. Historical proof and commits are preserved, not redone.

## Remaining blocker and lead handoff

`npx jscpd` still exits 1 on the inherited 51-token clone at
`test/unit/windowsTrustedPath.test.ts:206,279`. It has no clone in the changed
files. This unrelated Windows repair belongs to the lead's integration
pass; PLAN section 7 records the bounded deferral. The finding is neither
ignored nor represented as a green gate. Full quality, broader accessibility,
fresh-clone certification and hosted Windows/macOS/Linux CI remain lead-owned
under the explicit shared lane limits. No cross-platform qualification,
release publication or registry work is claimed here.

The lead can fetch `rel017/visregen2`, integrate the preserved repair/proof
and these refresh commits, resolve the duplication finding and run aggregate
quality plus hosted CI. The previous What's New size blocker is resolved
within the authorized editorial scope. No lane-owned visual gate remains open.

## Evidence

Tracked [stability receipt](visregen017-stability.json) retains root-cause DOM
measurements, exact original failures and ten-run image/geometry proofs.
Tracked [refresh review](visregen017-refresh-review.json) records every
reviewed scene/sheet with its hash and dimensions, current-source coverage,
README decisions and hashes, source-record changes, final command exits and
log hashes, and the complete a11y summary. Documentation formatting,
plan and regenerated roadmap checks pass too (207 entries). Final manifest SHA-256 is
`2e6e6ffd2f5f4b356e5b3cfd4c7d51bfb0112fea120ebfb2c22c79962f5a9ead`.

Full PNGs and intermediate data remain outside Git:

- `/var/tmp/l-VISREGEN2/visregen2-probe/`, `visregen2-prefix/`,
  `visregen2-held-question/`, `visregen2-fixed-question/` and
  `visregen2-fixed-all-themes/`: preserved root-cause and repetition images.
- `/var/tmp/l-VISREGEN2/visregen2-resume-review/`: 9,792 compared images.
- `/var/tmp/l-VISREGEN2/visregen2-counted-review-sheets/`: all 43 reviewed
  sheets and their index.
- `/var/tmp/l-VISREGEN2/visregen2-tiny-review-sheets/`: two reviewed sheets
  covering all 21 within-allowance frames.
- `/var/tmp/l-VISREGEN2/visregen2-reviewed-final/`: accepted 9,792 PNG archive.
- `/var/tmp/l-VISREGEN2/visregen2-readme-review/`: before/after README sheets.
- `temp/visregen2-resume-*.json`, `temp/visregen2-resume-*.log` and
  `temp/m114-s-accessibility.json`: raw comparison, notes/README/source
  receipts, foreground sequential check results and complete axe findings.

No fresh clone is created. No full PNG archive is checked into Git.
