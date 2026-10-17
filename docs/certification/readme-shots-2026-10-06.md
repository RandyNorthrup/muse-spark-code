# README screenshots — SHOTS, 2026-10-06

Kubuntu, branch `docs/readme-shots-1006`, base `582af0470` (0.14.3).
All work and commands ran directly in this worktree. No dependency installed,
model attempt, paid call, credential access, merge or push.

The Chrome CLI stalled on the first page, including a bounded direct-binary
retry. Playwright rendered the same page successfully. The README runner now
uses the existing `withSizedPage` helper, the declared viewport, focus emulation
and the harness's readiness/scan result. A harness error prevents capture.
Every original scenario is unchanged. Only `readme-open-question` and
`readme-help` were appended, both using `whenFound`; Help searches for
**Next open question**, and the question scene reopens the dock from its chip.
No shipped command, setting or feature changed; the reference catalog stays current.

## Visual comparison

Each committed image and its new dev capture was inspected. The complete final
preview contains all 17 mapped shots; four existing PNGs and the two new shots
were then rendered directly into `media/readme`. Dynamic timestamps, fixture
relative dates, animation phases and minor rendering differences do not count
as UI changes. Unchanged PNGs retain their committed bytes.

| Image              | Verdict                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| agents.png         | Unchanged: same Agent map, nodes, token/duration detail and composer; waveform phase differs.                                           |
| approval.png       | Unchanged: same approval dock, choices and transcript; waveform phase differs.                                                          |
| history.png        | Unchanged: same search, archive toggle and session rows; relative fixture date differs.                                                 |
| languages.png      | Unchanged: the German Account & usage capture is pixel-identical.                                                                       |
| modes.png          | Unchanged: same modes and effort; minor rendering differences only. Caption no longer claims single-line descriptions.                  |
| paid.png           | Unchanged: same paid search, sources and composer badge; final preview is pixel-identical.                                              |
| paid-always.png    | Refreshed: paid usage now shows Tab's daily budget, Model hooks and Judge; the older total/Ask-again area is below the visible portion. |
| palette.png        | Refreshed: Git and pull request actions now follow Context, moving Model/effort lower and Customize below the visible portion.          |
| question.png       | Refreshed: question card now appears in both transcript and attention dock, with Open question labels and accent bars.                  |
| quote.png          | Unchanged: same three context-menu pills; message timestamp differs.                                                                    |
| rewind.png         | Unchanged: same three fork/rewind pills; message timestamp differs. Alt text now describes the visible menu only.                       |
| slash-commands.png | Refreshed: /commit ranks first for /co, and /help is visible in the results.                                                            |
| turn.png           | Unchanged: same open steps, diff, reply and tally; only waveform phase differs.                                                         |
| usage.png          | Unchanged: the English Account & usage capture is pixel-identical.                                                                      |
| voice.png          | Unchanged: the listening composer capture is pixel-identical.                                                                           |
| banner.png         | Unchanged, excluded: SVG render, outside the harness mapping.                                                                           |
| open-question.png  | New: a deferred question reopened in the dock, its folded transcript row, answer chip and Previous/Next arrows.                         |
| help.png           | New: Help & Reference search, question-handling details, deferral setting and navigation-command links.                                 |

All existing entries keep light theme and 690×760 dimensions; German stays
`lang=de`. New open-question is light 690×760; Help is light 1000×760. Both
READMEs describe the actual views and retain one What's New section for 0.14.3.

## Verification

- `npm run build:dev`: pass. `node scripts/readme-shots.mjs --out
temp/readme-preview-final`: 17/17 captures, exit 0. The six changed/new
  images were rendered with `--only palette,question,slash-commands,paid-always,open-question,help`, exit 0.
- `node scripts/readme-shots.mjs --list` and `npm run readme:shots -- --list`:
  pass; no missing or unreferenced images.
- `npx vitest run test/unit/readmeShots.test.mjs test/unit/readmeVersion.test.ts
test/unit/whatsNewContent.test.ts --maxWorkers=3`: 34 passing tests.
  `npx vitest run test/unit/vsixPackaging.test.mjs --maxWorkers=3`: 20 passing
  tests. Final runs use repository timeouts, with no `--testTimeout` override.
- `node scripts/a11y.mjs readme-open-question readme-help`: 8 pages across
  light, dark, hc-dark and hc-light; zero violated/undecided rules, exemptions
  or missing results. Axe cannot measure contrast on 16 obscured/offscreen and
  8 glyph-only elements; these are the gate's existing reported limitations.
- `npm run typecheck`: all five projects pass. Scoped ESLint and Prettier pass.
  Plain `npm run deadcode` passes (two existing configuration hints);
  `npx jscpd` reports zero clones. Localization: 14 tables, 0 problems.
  Reference: current, 53 features, 46 commands, 60 settings, 26 slash and 122 CLI
  entries. Host API: 0 problems. `git diff --check`: pass.
- `npm run build`: all size, split, host-global and notice checks pass.
  Extension 441.6/600 KiB, Model API 447.3/475 KiB, ACP 823.6/850 KiB,
  webview startup 733.1/900 KiB, original deferred group 32.1/50 KiB,
  question UI 19.7/25 KiB, Help browser 37.2/50 KiB and Node 99.5/100 KiB.

## Red controls

The new capture tests failed against the original runner (3 failures). These
additional deliberate mutations proved each capture requirement and the new
scene's failure reporting; all source was restored SHA-256-exact.

| Mutation                                                      | Observed failure                                                               | Restored SHA-256                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Disable scan-error rejection                                  | 2 tests fail: errored pages incorrectly resolve and permit capture.            | `c37ffb7258c543b38677c29645d7ddacb591a13a787cfb07ead22038b1ddbe13` |
| Remove await on harness readiness                             | 1 test fails: screenshot occurs while readiness remains pending.               | same runner hash                                                   |
| Reduce viewport height by 1                                   | 1 test fails: declared viewport differs from the requested dimensions.         | same runner hash                                                   |
| Replace the new dock-chip selector with a nonexistent control | Accessibility exits 1; all 4 theme pages report never-rendered harness errors. | `6c38a7ba258845403660d4a0a36757b15bea516065a51ba106bd9d50da2d85c5` |

Final restored unit tests and both new accessibility scenes pass.

## Package comparison and remaining lead checks

Production `node scripts/package-vsix.mjs` passes before and after; exact staged
localization and badge/version checks run. External badge requests were skipped
with `BADGE_CHECK_SKIP_NETWORK='SHOTS brief forbids external network calls'`.

| Same-content Linux VSIX |     Bytes |      KiB |
| ----------------------- | --------: | -------: |
| Before                  | 2,289,534 | 2235.873 |
| After                   | 2,289,788 | 2236.121 |
| Change                  |      +254 |   +0.248 |
| Existing cap            | 2,457,600 |     2400 |

ZIP inspection finds no `media/readme` members: screenshots are external URLs.
Only `extension/readme.md` and `extension/changelog.md` change; every packaged
runtime member is byte-identical. The macOS dictation helper is absent in both
packages because this Linux checkout cannot build it. Universal packaging,
external badge checks and full integrated quality stay with the lead, as
recorded in PLAN §7 and required by the shared rig brief. Existing gates and
budgets are unchanged.
