# INFRA015 — Screenshot and test infrastructure integration (2026-10-06)

Rig: `linuxlt`, worktree `/home/randy/lanes/INFRA015`, branch
`chore/infra-0150`, starting main `8c6351d73`. Work is local; no push, rebase,
live/paid model attempt, credential access, dependency install or gate change.
The shared lane rules prohibit aggregate quality/full-unit runs; the lead owns
full quality, coverage and hosted cross-platform certification after handoff.
The rig note explicitly authorizes only the three merges below, overriding
common.md's stale instruction to merge an unrelated integration branch.

## Integration

| Step                     | Incoming head | Merge commit | Resolution                                                                                                                                                                                               |
| ------------------------ | ------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/test-warm-deferred` | `af0c21c0`    | `297c2f30`   | PLAN and CHANGELOG: retain the integration/warm-up plans and main's orchestration documentation; keep already released fixes in their release section without duplicate Unreleased bullets.              |
| `fix/harness-waits`      | `933abb82`    | `eac6f6b9`   | PLAN and CHANGELOG: retain both plans and both unique test infrastructure entries; retain contributor guidance on readiness and explained timers.                                                        |
| `docs/readme-shots-1006` | `1ef04ccb`    | `f86940d3`   | PLAN milestone and gate notes plus CHANGELOG: keep both. Harness auto-merges HARNESSWAIT conversions and SHOTS' two appended scenes. Both new scenes already use nested `whenFound`; no new fixed timer. |

All merges use `git merge --no-ff`, in the brief's order. Main's AGENTS.md and
orchestration register are retained. The warm-up is test-only; product source,
manifest, dependency pins, wire shapes and feature catalog are unchanged.

## npm STAR line and deliberate failure

`docs/npm-readme.md` now carries the owner's exact linked sentence immediately
before Install. `test/unit/acpNpmReadme.test.ts` checks the exact text and URL in
the introduction, in addition to its existing packaging/link/manifest checks.
New test first fails against the unchanged README (exit 1), then passes after
the line is added. A separate removal drill also exits 1 with the STAR test
failing; the original README is restored byte-exact and all four tests pass.
README SHA-256 before and after:
`dc6421d34edff6a9c681ceb0aee3b870bf35662eeadb8430dad386d8f118bef1`.
Logs: `temp/infra015-star-before.log`, `infra015-star-after.log`,
`infra015-star-drill-red.log`, `infra015-star-restored.log`; hash receipt:
`temp/infra015-star-drill.json`. Commit `f27f3e77` runs lint-staged and gitleaks.
The incoming guards' red receipts remain in `testwarm.md`, `harness-waits.md`
and `readme-shots-2026-10-06.md` in this directory.

## Build and accessibility receipts

Production build passes all unchanged size/split/host-global/notice gates:
extension 441.6/600 KiB, Model API 447.3/475 KiB, ACP 823.6/850 KiB,
webview startup 733.1/900 KiB. Default-timeout integration batches pass:
App/Transcript/questionApp, 228 assertions; harness waits/capture/warm-up guard,
23 assertions; merged scenes/readme capture/waits, 36 assertions.

Full `node scripts/a11y.mjs` passes: 724 pages (181 scenarios × four themes),
zero violated/undecided rules, zero exemptions and zero pages without results.
Axe reports its existing contrast-measurement limits: 2,404 obscured/offscreen
and 84 glyph-only elements. Receipt: `temp/infra015-a11y-final.log`.
An earlier full process exited 143 (SIGTERM) before writing a result; no pass
was claimed. The unmodified complete sweep was rerun alone and exits 0.

All final owning tests, screenshot comparisons, static checks and package
checks pass as recorded below. Current logs stay in gitignored `temp/`.

## Screenshot comparison

`node scripts/readme-shots.mjs --out temp/readme-preview` captures all 17 mapped
shots successfully using the merged harness and production webview. Dimensions
and themes match the committed mapping; the banner remains excluded. Pixel
comparison finds seven exact matches and only 17–314 changed pixels (at most
0.060% of an image) in the other ten. Side-by-side inspection covers the six
refreshed/new incoming images and every non-identical pair. Captured content,
controls, menus, layouts and captions match; differences are animated waveform
phase, caret/border paint, fixture-relative dates or localized timestamps.
No additional PNG refresh is needed. The incoming six refreshed/new PNGs stay
committed. Preview, paired images and quantitative receipt remain in
`temp/readme-preview/`, `temp/readme-comparison/` and
`temp/infra015-shot-comparison.json`.

| Image              | Changed pixels | Verdict                                                              |
| ------------------ | -------------: | -------------------------------------------------------------------- |
| agents.png         |            302 | Same Agent map; animated waveform phase only.                        |
| approval.png       |            314 | Same approval card and choices; waveform and minor textarea paint.   |
| history.png        |             52 | Same session rows; old fixture date and caret paint differ.          |
| languages.png      |              0 | Pixel-identical.                                                     |
| modes.png          |             17 | Same mode/effort choices; minor composer paint.                      |
| paid.png           |              0 | Pixel-identical.                                                     |
| paid-always.png    |             20 | Same paid tallies, Tab budget, hooks and Judge; minor paint.         |
| palette.png        |              0 | Pixel-identical.                                                     |
| question.png       |            148 | Same transcript/dock question controls; waveform/caret paint.        |
| quote.png          |             81 | Same three quote actions; local message timestamp/caret paint.       |
| rewind.png         |             81 | Same three fork/rewind actions; local message timestamp/caret paint. |
| slash-commands.png |              0 | Pixel-identical.                                                     |
| turn.png           |            282 | Same open steps/diff/output; waveform phase only.                    |
| usage.png          |              0 | Pixel-identical.                                                     |
| voice.png          |              0 | Pixel-identical.                                                     |
| open-question.png  |            144 | Same reopened dock/chip/navigation; waveform/caret paint.            |
| help.png           |              0 | Pixel-identical.                                                     |

## Integrated guard drills

Two inherited guards were also challenged in the merged tree. Each complete
owning file exits 1 on its deliberate mutation, and final default-timeout tests
run after SHA-256-exact restoration. No drill remains in the final diff.

| Mutation                                                           | Failure                                                | Restored SHA-256                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Remove SignIn from the test-only deferred warm-up helper.          | Warm-up import-set equality fails.                     | `e37ee3c076443d4ec8497769b203db64350ffbcf72d6bf3a4a5cc516770cf649` |
| Add an unexplained fixed-delay focus to the new README Help scene. | The scene-timer source guard reports delayed DOM work. | `759eaec275355eecac8ff100b1b6781cbdaa49f96feacb773c25688c43db3bbb` |

Logs and exact hash receipts: `temp/infra015-{warm,harness}-drill-{red.log,json}`.

## Final default-timeout tests

All 30 complete files pass in ten sequential batches of at most three files,
with `npx vitest run <files> --maxWorkers=3`. No `--testTimeout`, hook timeout,
query timeout, retry, filter or skip change is used. Total: **506 passing
assertions, zero failures and zero skips**. Existing jsdom canvas diagnostics
also occur in the incoming behavior-suite baseline; they are not test failures.
Per-batch logs: `temp/infra015-final-tests-01.log` through `-10.log`; receipt:
`temp/infra015-final-tests.json`.

Each name below is under `test/unit/`; suffix `.test.tsx` unless shown.

| Complete files                                                       | Passing tests | Seconds |
| -------------------------------------------------------------------- | ------------: | ------: |
| App, Transcript, questionApp                                         |           228 |   14.68 |
| toolRows, rowMenus, WorkflowRun                                      |            63 |    4.94 |
| handoffDialog, planActions, reviewUi                                 |            35 |    7.49 |
| secretPromptDialog, store, QuoteMenu                                 |            12 |    3.66 |
| ReferencePage, reportProblemDialog, attentionDock                    |            60 |    8.52 |
| MarkdownView, renderCost, warmDeferredSurfaces.test.ts               |            10 |    4.88 |
| harnessWaits.test.ts, harnessCapture.test.mjs, readmeShots.test.mjs  |            36 |    2.74 |
| readmeVersion.test.ts, whatsNewContent.test.ts, acpNpmReadme.test.ts |            24 |    5.16 |
| vsixPackaging.test.mjs, AppLazy, DeferredSurface                     |            35 |   14.22 |
| CodeBlockLazy, deferredQuestionUi, deferredQuestionFailure           |             3 |    3.87 |

## Final static and package gates

| Command                                                        | Result                                                                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prettier --check <changed files>`                         | All 38 changed text files, including HTML and certification, pass.                                                                                                         |
| `git diff --check`                                             | No whitespace or conflict-marker errors.                                                                                                                                   |
| `gitleaks git --redact --no-banner --log-opts=8c6351d73..HEAD` | All integrated commits before the receipt commit pass; the final existing staged hook checks the receipt itself.                                                           |
| `npm run typecheck`                                            | All five compiler projects pass (73.50 s).                                                                                                                                 |
| `npm run lint`                                                 | Complete JS/TS ESLint and CSS Stylelint pass with zero warnings/errors (188.90 s). PSScriptAnalyzer retains its repository-defined Linux skip; Windows CI owns that check. |
| `npm run deadcode`                                             | Plain Knip passes (2.95 s), with two existing configuration hints.                                                                                                         |
| `npx jscpd`                                                    | 1,235 files, zero clones (0.93 s).                                                                                                                                         |
| `node scripts/gen-reference.mjs --check`                       | Current: 53 features, 46 commands, 60 settings, 26 slash and 122 CLI entries.                                                                                              |
| `node scripts/check-l10n.mjs`                                  | 14 tables, 169 manifest strings, 629 source files; zero problems.                                                                                                          |
| `node scripts/check-host-api.mjs`                              | 332 VS Code APIs, 32 VS Code importers, 25 Node built-ins, 61 theme variables; zero problems.                                                                              |
| `npm run build`                                                | Production size, split, host-global and 83-package notices pass under all existing caps.                                                                                   |
| `npm run package`                                              | Repeats production gates, checks exact staged localization and badge/version data, then packages below the unchanged VSIX cap.                                             |

The package command scopes
`BADGE_CHECK_SKIP_NETWORK='INFRA015 shared lane rules forbid external network calls'`
to that invocation. The existing local option validates 36 HTTPS image targets
and staged badge/version contents; external requests remain explicitly deferred,
as the shared brief forbids them. No CI environment, hook or gate is altered.

| Artifact                      |     Bytes |      KiB |      Cap |
| ----------------------------- | --------: | -------: | -------: |
| `muse-spark-code-0.14.3.vsix` | 2,290,386 | 2236.705 | 2400 KiB |

SHA-256: `88cfe46f77d5d160bdbabea7c2f5176f2e3e41580e3ec489e1d1220d01a3fa41`.
The actual ZIP's manifest version is 0.14.3; its localized English display name
retains Unofficial, its README retains the quiet star line plus Help and
open-question image references, and no README PNG is packaged. Receipt:
`temp/infra015-package.json`; command log: `temp/infra015-package.log`.
The Linux artifact has no macOS dictation helper, matching the incoming SHOTS
lane's local measurements; universal packaging remains with the lead.

## Handoff

All authorized local implementation and acceptance checks are complete.
No new dependency, escape hatch, feature, command, setting, wire shape or paid
policy was added. Existing hook files were present before the first commit;
every local commit uses lint-staged and redacted gitleaks without overrides.
Changed-file Prettier and final whitespace checks pass. A redacted commit-range
secret scan passes (`temp/infra015-secrets-before-commit.log`); the final existing
staged hook also checks this receipt commit. Source guards and screenshots use
Windows-safe paths.

Next: the lead fetches this local branch, runs integrated full quality/coverage
and hosted cross-platform CI, validates external badges and produces the universal
package with the macOS helper before landing/releasing. No local blocker remains;
those lead-owned gates are not claimed complete by this lane. No push is performed.
