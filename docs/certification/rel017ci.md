# REL017CI — make 0.17.0's hosted CI green by root fixes

Lane on `rel017/ci-fixes` (worktree `mx-rel017ci`), 2026-10-08. Input: the
failed hosted run 37866831774 on PR #145 (head `01ee6233b`); the branch
started from the INT0170 bundle fixes (`bdd6abab0`) and merged the moved
release head `45554edd8` (`b92ce5bb9`, no conflicts), whose own run
37883970931 added three failures (semgrep, execTestLauncher, the visual
inventory). Heavy runs went to Kubuntu and the Win11 VM through
`rig-test.sh` slots `ci017*`; the Windows host ran only git. No timeout,
threshold or size cap was raised; nothing was skipped to pass; no model
calls. One commit per cause, except two causes whose first commit carried
a lint error the pre-commit hook reported but did not stop (`95467436b`
then `b3faeb8a5`; `5e44b5ef4` then `912ce65ec`), and the dead reference
plugin, whose deletion was staged early and landed in `3329ee7c3`.

Classes: **(a)** fixed by the INT0170 bundle commits (`69b0e152b` …
`bdd6abab0`, then `f74dc661b`); **(b)** a regression from the 0.17 lane
merges (product or test); **(c)** environment, runner or rig specific, or
timing.

## Workflow jobs and gates

| Job / gate                                                                                  | Class | Root cause                                                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| static gates (ubuntu): `lint:js` out of heap at 6144 MiB                                    | b     | One `eslint .` keeps every TypeScript program. Kubuntu, project service instrumented: src under tsconfig.json + src/webview ≈ 2.0 GB heap, test/unit's program (all src again + 1,458 tests) +3.5 GB, other test programs +0.3 GB = 5.9 GB after GC. No outlier file, no missing ignore; 0.17's +433 unit tests and +232 src/core files crossed the cap from the 5.5 GB release-base peak. | `14cc887cd`: `lint:js:main` (all but test/) then `lint:js:tests`, each with the unchanged 6144 MiB flag. Same files/rules, 0 problems. Peak RSS 4,224,304 / 5,706,768 KiB. |
| static gates (windows) `build`; Hosts packages; Forks vsix; Browser check captures ×3       | a     | extension.js 1,009.1 KiB > 600, headless.js 110.6 > 100 KiB.                                                                                                                                                                                                                                                                                                                               | INT0170.                                                                                                                                                                   |
| Action check: fake-only test package (`check-l10n --packaged-acp`)                          | b     | SECWINPATH put three keys out of en.ts order in 14 tables; the archive restores en.ts order.                                                                                                                                                                                                                                                                                               | `66b71d9eb` (the release's `f74dc661b` made the same reorder; merged byte-identical).                                                                                      |
| visual regression shards 1–6 (`runners`, dist/traffic-harness 404)                          | b     | Without a stored archive the baseline is replayed from a snapshot root; `serveRepo(snapshot)` built the traffic harness into the working folder.                                                                                                                                                                                                                                           | `abe1ca304`.                                                                                                                                                               |
| visual shards on `45554edd8`: "Renderer inventory coverage differs from the current matrix" | b     | STARTUP017 listed `money.tsx` in componentAuditInputs without an audit row.                                                                                                                                                                                                                                                                                                                | `44f8ef306` (component row), `3b1a70d2b` (72 manifest captures list it; metadata only).                                                                                    |
| semgrep on `45554edd8`                                                                      | b     | M122's roadmap built a RegExp from ids (blocking detect-non-literal-regexp).                                                                                                                                                                                                                                                                                                               | `912ce65ec`: a scan, no data-built pattern.                                                                                                                                |
| compile dictation helper (macos), dictation helper (macos)                                  | b     | `macVaultCapture.py` asserted pre-Q-M109; M109W set `enclaveCertified = true`.                                                                                                                                                                                                                                                                                                             | `6c2483693`. Hosted macOS to confirm.                                                                                                                                      |

## Test files

| File                                                                                        | OS       | Class      | Root cause                                                                                                                                         | Fix / state                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| e2e/execStdio, vsixPackaging, runtimeChatGptPackage                                         | all      | b          | Packaged tables differ from source.                                                                                                                | `66b71d9eb`. Win11: vsixPackaging 79/79; the other two hit 60 s build hooks on the VM (c).                                 |
| e2e/execTestLauncher (on `45554edd8`)                                                       | lin      | b          | `f74dc661b` made dist/resourceJournal.js required by the test packer; the e2e fixture never built it.                                              | `59e7b5be2`. Kubuntu 6/6.                                                                                                  |
| museCodeSdk142 (7)                                                                          | all      | b          | M108's lease fence refuses a reply racing close; tests expected the admission parsed and one abort listener.                                       | `c4904e66e`. Kubuntu, Win11 pass.                                                                                          |
| modelApiLoopGuarantees (5)                                                                  | lin, mac | b          | `scheduledIo` (`01f2bc002`) copies `runHook` at session start; cases set it later.                                                                 | `b0fe79f4b`. Kubuntu 42/42.                                                                                                |
| modelApiHost scheduled leases (2)                                                           | lin, mac | b          | The int/0170 merge resolution (`1e5dc24cb`) holds one occurrence's slot before claim; the 0.16 test expected a second admission and claim.         | `b6f34ffae` (test states the merged design; design call for the lead). Kubuntu 19/19 schedule cases.                       |
| vault/requestTaint                                                                          | all      | b          | Money ports approve hosted search only with the returned quote; consent answered `true`.                                                           | `6461344fc`. Kubuntu 10/10.                                                                                                |
| m114ConversationReview (`.tool-toggle`)                                                     | all      | b          | Lazy tool rows (`2ae80ffb9`); the 24 px case counted too early.                                                                                    | `7246b40c4`. Kubuntu 89/89.                                                                                                |
| visualCapture                                                                               | lin, win | b          | Needs dist/webview; a clean checkout has none.                                                                                                     | `377d76f12` (builds it, as visualStability). Kubuntu 11/11.                                                                |
| browserEnglish (2)                                                                          | all      | b          | Resource-only English (M107 U-C1) is never loaded by the probe.                                                                                    | `f9dbd343b`. Kubuntu (after merge), Win11 pass.                                                                            |
| developerLocalFiles (13)                                                                    | mac      | b, product | Root realpath ≠ spelled path refused roots below any link (macOS /var).                                                                            | `52f02ddf5` + case. Kubuntu pass; hosted macOS to confirm.                                                                 |
| runtimeEstimatorPorts                                                                       | win      | b, product | `fleetFromHost` passed `win32` through and refused it.                                                                                             | `3329ee7c3` + case. Win11 pass.                                                                                            |
| teamStartup                                                                                 | all      | a + b      | After INT0170 still 621,252 B vs 608,906 B: the test built with a copied plugin list lacking sharedResourceAdmission and sharedModelApiBoundaries. | `1b85dc09e`: scripts/lib/hostPlugins.mjs shared by build.mjs and both budget tests. Kubuntu 5/5.                           |
| modelsActivationBudget                                                                      | all      | **open**   | With the production plugins: +16,377 B over the immutable pre-K baseline vs lane K's 3 KiB — real activation growth since lane K.                  | Left for the bundle owner / lead (diet or a recorded ratchet decision); no cap raised.                                     |
| deferredBundles (3), codeIntelBundle, teamHarness #23                                       | all      | a          | Size-gate fallout, MODEL_TEXT leak.                                                                                                                | INT0170. Kubuntu: 113/113, 9/9.                                                                                            |
| slashCommandsBundle                                                                         | all      | b          | `a704f711c` folded the "/" list into the palette registry; the test (45dee1e3b) still wanted its own entry.                                        | `9b9119fdb` + follow-up (the owner chunk is the registry's entry or a chunk it imports). Win11 re-run pending at hand-off. |
| noticesInput                                                                                | all      | b          | Fonts lane: ACP notices need meta-acp/fontsInstall.json and the font pack; fixture had neither.                                                    | `2ce585f36`. Kubuntu 3/3.                                                                                                  |
| m106Build                                                                                   | all      | b          | Tested the dead compressedReference.mjs; generator moved the schema.                                                                               | `225ca89f4`, `1a84e699e`. Kubuntu, Win11 pass.                                                                             |
| autoCompact                                                                                 | all      | b          | Plan archive (`e5f3bdb55`) dropped M73's packing default from PLAN.md.                                                                             | `e16a4d2bd`. Kubuntu, Win11 pass.                                                                                          |
| e2e/reports (html)                                                                          | all      | b          | `f496720d9` refreshed one golden's SHA-256, not the CLI golden's.                                                                                  | `a9eeb4e33`. Kubuntu 9/9; Win11 8/9 (VM symlink privilege, c).                                                             |
| m114Audit                                                                                   | lin, mac | b          | Lanes changed audited files after the audit; chip, W2 and STARTUP017 added files.                                                                  | `b84dce5c1`, `44f8ef306`. Kubuntu 7/7.                                                                                     |
| resourceHarness, resourceHistoryHarness                                                     | all      | b          | harnessServer imported scene names from a module that imports temp/m115-v build output.                                                            | `0e5b4b903`. Kubuntu pass.                                                                                                 |
| actionManifest                                                                              | all      | b          | `\|` literal path list in action-check.yml.                                                                                                        | `5d073cdb6`. Kubuntu, Win11 pass.                                                                                          |
| memoryStore                                                                                 | lin, mac | b          | SECWINPATH: `nul.md` is an ordinary Windows 11 name.                                                                                               | `bdc8c1d64`. Kubuntu, Win11 pass.                                                                                          |
| tokenFile                                                                                   | lin, mac | b          | SECWINPATH2 needs SystemRoot; the win32 simulation had none.                                                                                       | `2652eb654`. Kubuntu, Win11 pass.                                                                                          |
| mediaConvert (4)                                                                            | win      | b          | `aix` simulations used a `C:\` path; relative cases crossed drives.                                                                                | `e1d67dc36`. Win11, Kubuntu pass.                                                                                          |
| recordingLatest                                                                             | win      | b          | Linux discovery admits only POSIX roots.                                                                                                           | `31c7de17f`. Win11, Kubuntu pass.                                                                                          |
| playbookOutcomes (executable)                                                               | win      | b          | No execute bit on Windows.                                                                                                                         | `d4a8bce6a`. Kubuntu: 8 Husky cases fail only for the rig's `--ignore-scripts` install (c).                                |
| vault/channel                                                                               | win      | b          | File-wide beforeAll compiled peer.c with /usr/bin/cc.                                                                                              | `9f3648dfb`. Win11, Kubuntu pass.                                                                                          |
| nativeScheduleBackground (drop-in)                                                          | lin      | c          | Hosted node lives in world-writable /opt/hostedtoolcache.                                                                                          | `0a2950ef5` (private node copy). Kubuntu pass.                                                                             |
| treesMacNative, treesLifecycleNative                                                        | mac      | b          | Fixture copied 4 files; build.sh now needs the whole folder, l10n tables and node.                                                                 | `95467436b`+`b3faeb8a5`. Hosted macOS to confirm.                                                                          |
| readmeShots (pixel-input digest)                                                            | all      | b          | Pixel inputs changed after the last recapture (and harnessServer.mjs again here).                                                                  | UIHOOK017 below: recaptured and reviewed; resources.png replaced, digest refreshed.                                        |
| resourceHistoryDisposal                                                                     | —        | c          | Load-sensitive 3 s wait (lead's note).                                                                                                             | Kubuntu pass (4.9 s run); not changed.                                                                                     |
| visualStability                                                                             | lin, mac | c          | Capture hook over 10 s on hosted runners.                                                                                                          | Not changed.                                                                                                               |
| nativeScheduleBackground (timeout), scheduleFs, judgeWindow, vault/execFence, reportHistory | win      | c          | Hosted Windows timing (PowerShell cold start, 15/30 s deadlines), Windows rename locking; judgeWindow and execFence pass on Win11.                 | Not changed; hosted Windows to confirm.                                                                                    |
| accountsPanel.a11y (light, 320 px link)                                                     | win      | c          | Axe audited the dialog mid-fade (opacity < 0.86): link 4.06:1 at 0.80, 5.93:1 settled.                                                             | UIHOOK017 below: settled-frame audit, link on `--ms-info`.                                                                 |
| outputSchema, m114Panel, scheduleRuntime                                                    | mac      | c          | Timing on the hosted macOS runner.                                                                                                                 | Not changed.                                                                                                               |

Windows shard 1 was cancelled in run 37866831774, so its files had no
Windows result there.

## Run 37883970931 (release head `45554edd8`) — further classes

| Job / file                                                                              | Class   | Root cause                                                                                                                                                                                                              | Fix / state                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| static gates ubuntu + windows: `lint:js` heap again                                     | b       | The release head still ran one `eslint .`; W2/STARTUP017 grew it further.                                                                                                                                               | `14cc887cd` then `dfb8cc6f9`: three processes. Kubuntu peaks 4,374,192 (main) / 5,375,528 (unit) / 2,055,336 KiB (other tests).                                                                 |
| static gates (macos): cancelled at 25 min inside `lint:js`                              | b + c   | Same heap pressure (GC thrash) on the slowest runner.                                                                                                                                                                   | Same split; hosted macOS must show the gate inside 25 min.                                                                                                                                      |
| semgrep                                                                                 | b       | M122 roadmap RegExp built from ids.                                                                                                                                                                                     | Release `808a73ee3` (lead); this branch's `912ce65ec` superseded in the merge `634b24c86`.                                                                                                      |
| tests windows shards 1, 3, 4                                                            | c (+ b) | Windows runs files sequentially (`fileParallelism: false` on win32) and `--shard` splits by file count, not time. Shard 1 held modelApiHost.test.ts (242 s) and scheduleJournal's 10,000-fire case (164 s).             | CITIME017 below: three product hotspots fixed (`f727b060d`, `82ebc8b6b`, `8bbe763dd`); estimate still 18.3 / 14.2 / 20.0 / 18.0 min with four shards. **Open: shard count is the lead's call.** |
| quality ×3, package (.vsix), dictation helper (macos), merged coverage                  | derived | The `required` aggregator jobs test upstream results (`CHECKS`, `VISUAL`, `UNIT`, `HELPER` …); coverage is skipped when a shard fails.                                                                                  | Follow the upstream fixes.                                                                                                                                                                      |
| compile dictation helper (macos)                                                        | b       | Swift `guard let` warnings are only warnings; the failure is `macVaultCapture.py` (test_probe "True is not false", KeyError `code`).                                                                                    | `6c2483693`.                                                                                                                                                                                    |
| e2e/execStdio (ubuntu, macos)                                                           | b       | Past the l10n check for the first time, the guard parsed the packed (format 1) table archive as the old keyed matrix (ZodError on `keys`).                                                                              | `45b668ed3` (reads German with `readArchivedUiTable`). Kubuntu 44/44.                                                                                                                           |
| e2e/execTestLauncher (ubuntu)                                                           | b       | Fixture lacked the new shared dist/resourceJournal.js.                                                                                                                                                                  | `59e7b5be2`. Kubuntu 6/6.                                                                                                                                                                       |
| visual shards: renderer inventory                                                       | b       | money.tsx listed without an audit row.                                                                                                                                                                                  | `44f8ef306`, `3b1a70d2b`.                                                                                                                                                                       |
| e2e/acpStdio (2, ubuntu)                                                                | b       | A race, not the host: a turn finishing before its turn/start reply released the delivered answer instead of committing it; the fixture also lacked dist/schedules.js (host refused on every OS). Reproduced on Kubuntu. | `993789c4c` (CITIME017 below).                                                                                                                                                                  |
| conversationController handoff refusals (ubuntu, macos)                                 | b       | Each streamed string rebuilt the key's secret matcher (9 of 11 s).                                                                                                                                                      | `8bbe763dd`: 10.9 → 1.3 s; back on the default deadline (CITIME017 below).                                                                                                                      |
| webviewBundle (2), uiTextRegions, resourceHistoryReview, museCodeBackendManager (macos) | c       | Hook/test deadlines (5–10 s) on loaded hosted runners while building; one usage observer race.                                                                                                                          | Not changed.                                                                                                                                                                                    |

Pre-commit hook: on three commits lint-staged printed ESLint errors and
"Reverting to original state", yet the commit landed (`95467436b`,
`5e44b5ef4`, `dfb8cc6f9`, the last also carrying the slash test's
intermediate loop). Each was corrected by the next commit and the Kubuntu
`eslint test/unit` run is clean of them (`7612acb6a`). Root cause and fix
below (UIHOOK017).

## UIHOOK017 — the pre-commit hook fails closed

Lane `rel017/uihook` (worktree `mx-uihook`, from `506ae2375`), Windows 11
host, Git 2.52.0.windows.1, husky 9.1.7, lint-staged 17.6.0.

**Root cause.** All three landed commits were made from PowerShell as
`git commit … 2>&1 | Select-String … | Select-Object -First N`, and in each
the N matching lines ended before husky's "pre-commit script failed" line;
the lane's other failed commits, whose output was not cut short, were
refused. `Select-Object -First` closes the pipe once it has N lines, while
`git commit` keeps running. Then:

1. husky's runtime (`.husky/_/h`) runs `.husky/pre-commit`, gets status 1
   and prints `husky - pre-commit script failed`; the write hits the closed
   pipe and SIGPIPE kills the shell.
2. An MSYS2 process killed by a signal exits with the signal number in the
   second byte: `sh -c 'kill -PIPE $$'` gives exit code 3328 (13 << 8),
   SIGTERM 3840.
3. Git for Windows keeps only the low byte of a hook's exit code, so a hook
   killed by any signal counts as a pass. In a throwaway repository a
   pre-commit hook of `kill -PIPE $$` (or `exit 256`) lets the commit
   through; `exit 1` stops it.

The reflog shows the order: lint-staged's `reset: moving to HEAD` (its
revert, 21:11:35) is followed by the commit `95467436b`.

**Reproduced** in this worktree before the fix: a staged
`a == 2` and an unused variable in `scripts/lib/roadmap.mjs`, committed as
`git commit -q -m … 2>&1 | Select-String 'error|✖|failed' | Select-Object -First 3`,
landed as `932b81647` (reverted by `643437288`; no reset in a lane). The same
commit from Git Bash with the whole output read was refused (`husky -
pre-commit script failed (code 1)`). A minimal copy of husky's layout in a
temporary repository (hook prints, sleeps 2 s, exits 1) landed with
`Select-Object -First 2`; adding `trap '' PIPE` inside `.husky/pre-commit`
did not help (the shell that dies is husky's outer one); adding it to the
outer shell did.

**Fix.** `prepare` is now `node scripts/install-git-hooks.mjs`: husky's own
install, then each per-hook stub in `.husky/_` (husky 9.1.7's two-line
`. "$(dirname "$0")/h"`, matched exactly; any other shape stops the install)
is rewritten to ignore SIGPIPE, turn HUP, INT and TERM into exits 129, 130
and 143, export `MUSE_GIT_HOOK_STUB=fail-closed`, and then source husky's
unchanged runtime. A write to a closed stream now fails with EPIPE and the
hook exits with its own status. `.husky/pre-commit` gains `set -e` and
refuses to run without that marker ("run `npm run prepare` here"), so a
worktree still on husky's bare stubs, or any other launcher, cannot commit.
Both checks it ran stay: `npx lint-staged --concurrent 1 --max-arg-length
6000`, then gitleaks. On Linux and macOS a signal death already failed the
hook; the stubs make the outcome the same on every OS.

**Proof after the fix.** The same staged lint error and the same
`Select-Object -First 3` pipeline: lint-staged failed and reverted, and after
the commit process exited (no `index.lock`, no git/sh/node left) HEAD was
unchanged at `643437288`.

**Regression.** `test/unit/gitHookStubs.test.mjs` (unit suite, every OS)
installs the hooks with the real installer into a throwaway repository under
`temp/`, then: a hook that writes, waits until the test has closed its end
of Git's stderr, writes again and exits 1 must leave no commit and a non-zero
exit; a passing hook commits; the repository's own `.husky/pre-commit` under
husky's bare stub is refused with the `npm run prepare` message. 3/3 on the
host (2.7 s), on Kubuntu (585 ms) and on the Win11 VM (slowest case 2.5 s,
under the 15 s Windows deadline).

| Red drill                                         | Result                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Drop `trap '' PIPE` from the installed stub       | "keeps a hook failure after the output reader has gone" fails: git exit 0 |
| Drop the `MUSE_GIT_HOOK_STUB` guard from the hook | "refuses the repository's pre-commit…" fails: the commit landed           |
| Both restored                                     | 3/3                                                                       |

Every existing worktree keeps husky's bare stubs until `npm run prepare`
runs there; on a branch with this change its pre-commit says so and refuses.
Upstream: Git for Windows' reading of signal deaths as success and husky's
unguarded failure echo are worth reports (not filed from this lane).

## UIHOOK017 — accountsPanel.a11y, light dialog at 320 px

The hosted failure (run 37866831774, `tests (windows-latest, shard 2)`):
`light dialog at 320px`, axe `color-contrast` on one `a`, the source-policy
link in the confirmation dialog. The same case passed in run 37883970931 and
34/34 on this Windows host.

**Cause.** No token is below AA once the dialog has settled. Settled link
contrast (axe, 320 px, dialog surface):

| Theme    | Link      | Surface   | Ratio  |
| -------- | --------- | --------- | ------ |
| light    | `#005fb8` | `#f8f8f8` | 5.93:1 |
| dark     | `#4daafc` | `#202020` | 6.57:1 |
| hc-light | `#0f4a85` | `#ffffff` | 8.98:1 |
| hc-dark  | `#21a6ff` | `#0c141f` | 7.01:1 |

The modal fades in (`panel-open`, opacity 0 to 1 over `--ms-motion-base`,
180 ms), and Playwright's `waitFor` counts it visible at opacity 0. Axe
weighs opacity, and the document timeline moves only between frames, so a
slow runner can audit an early frame. With the fade frozen at each point
(light, 320 px): opacity 0.88 gives the link 4.68:1, 0.80 gives 4.06:1 (fail),
0.69 gives 3.23:1. Light has the least margin of the four themes, which is
why only that case failed.

**Fix.** The test waits for every finite animation in the document to
finish before running axe, so it audits the frame users read; nothing is
excluded from axe and no rule or threshold changed. The accounts link now
takes its colour from the design token role `--ms-info` (the role every
other webview link uses) instead of the raw `--vscode-textLink-foreground`;
`--ms-info` resolves to that same host colour, so the values above are
unchanged.

**Proof.** Red drill: the wait replaced with the fade frozen at 40%
(72 ms, opacity 0.80) fails exactly the hosted case, `light dialog at
320px`, `color-contrast` on `a` (1 failed, 33 passed). Restored: 34/34
(32.5 s) on this Windows host.

## UIHOOK017 — README screenshots (readmeShots digest)

The committed set was reviewed as a Linux render (LEFT017, headless Chrome
153.0.8010.52; `int0170-combined.md`). A capture on this Windows host
changed all 19 images (Segoe UI instead of the set's fonts), so it was used
for nothing. The capture of record ran the one-command script on the Linux
laptop rig, which has that same Chrome 153.0.8010.52: `git archive` of
`abc82f12f`, the gate base for this lockfile (`a8920e925b0d831f`)
hard-linked, `npm run build:dev`, then
`node scripts/readme-shots.mjs --out temp/readme-linux`. Each image was
compared with the committed one by decoded pixels, and every changed region
was viewed side by side, zoomed.

| Image                                                                                     | Result                                                                                                                                                                                          | Kept         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| help, history, languages, modes, paid, paid-always, palette, slash-commands, usage, voice | byte-identical                                                                                                                                                                                  | committed    |
| agents, approval, turn                                                                    | 163–170 px in the animated heartbeat trace (its faded tail); capture-frame timing                                                                                                               | committed    |
| open-question                                                                             | 229 px: the heartbeat caught at a flat frame; the committed frame shows the waveform                                                                                                            | committed    |
| question                                                                                  | heartbeat frame plus two anti-aliasing pixels on the card's accent bar                                                                                                                          | committed    |
| quote, rewind                                                                             | the message time is the capture's clock (6:19 AM / 6:20 AM against 10:42 PM)                                                                                                                    | committed    |
| deterministic-report                                                                      | only the printed report SHA-256 differs                                                                                                                                                         | committed    |
| resources                                                                                 | the committed image was the set's only Windows capture (`fe34f6509`, Segoe UI, a dot where the turn spinner goes); same content, labels and values; now in the set's fonts and with the spinner | **replaced** |

`resources.png`: 27,518 → 37,156 bytes, SHA-256
`5c5349ab54c88873cfc0c2d8696742f501232b9fd6c97378197faed60f47a765`.
Curated media total 1,176,937 / 2,097,152 bytes. No other image changed.
None of the token, stylesheet or harness changes since the last recapture
shows in a README scene. The pixel-input digest is refreshed to
`b1d68ff977e7e661bb2609e5839840d5e308a163ed5ea02bf306dc5f616d5b62`;
`test/unit/readmeShots.test.mjs` 17/17.

## Needs the hosted run

macOS: developerLocalFiles, trees native fixture, both dictation helper
jobs, visualStability, outputSchema, m114Panel, scheduleRuntime. Windows:
execFence, judgeWindow, reportHistory, scheduleFs, accountsPanel.a11y, the
nativeScheduleBackground timeout, execStdio and runtimeChatGptPackage (VM
too slow to build them), shard wall times against the 20 min limit. Ubuntu:
acpStdio, conversationController. All: check:visual shards end to end and
the split lint's wall time inside the static-gate deadline.

## CITIME017 — Windows shard time, acpStdio, the handoff case (2026-10-08)

Lane `rel017/citime` from `506ae2375`, on Kubuntu directly (10 cores, shared
with other lanes; loads 4–12 during the runs). No limit, deadline or cap was
raised; one named deadline was removed. No model calls. Hosted evidence:
`gh run view` logs of runs 37883970931 and 37866831774 (Windows jobs for
both, Ubuntu jobs for the newer one).

### 1. Windows shards over 20 minutes

Profiles: `node --cpu-prof` on the vitest fork (`--pool=forks --execArgv`).

| Hotspot                                      | Root cause                                                                                                                                                                                | Fix                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| scheduleJournal 10,000 fires                 | `journal.read` spent its time in `structuredClone` of every cached delta and zod revalidation; the store built a new journal per call, so the validated-bytes caches never hit (product). | `f727b060d`: one journal per workspace in the store; a read folds over shallow copies and clones once. Bytes are still reread and compared.    |
| (same case)                                  | The property (journal and audit bounded, fences linear) is flat after the first compaction; 10,000 fires proved nothing 1,000 do not.                                                     | Same commit: 1,000 fires (10× the 100-record audit cap, ~150 compactions), production constants unchanged; named limit 240 s → 60 s.           |
| modelApiHost: `installLanguage` 18 of 52 s   | Every recorded context read loaded schedulesEntry and reinstalled the caller's whole table (2,905 descriptors, seven Intl formatters, ~3.8 ms), in production `dist/schedules.js` too.    | `82ebc8b6b`: the entry skips a repeat install of the same table and locale.                                                                    |
| modelApiHost / handoff case: `redactSecrets` | The stream redacted every string of every SSE event with `redactSecrets(text, secrets)`, deriving the key's encoded forms and a new Aho-Corasick matcher per call.                        | `8bbe763dd`: `secretRedactor` builds them once per response, again only when a registered secret changes; output identical to `redactSecrets`. |

Measured on Kubuntu (plain / under `--coverage`):

| File or case                       | Before            | After          |
| ---------------------------------- | ----------------- | -------------- |
| scheduleJournal, 10,000-fire case  | 124 s / 219 s     | 68 s / 142 s   |
| scheduleJournal, the case at 1,000 | —                 | 6.8 s / 12.8 s |
| scheduleJournal.test.ts (file)     | case 124 s + ~6 s | 7.9 s / 29 s   |
| modelApiHost.test.ts               | 49–52 s / 66.5 s  | 31 s / 45.4 s  |
| conversationController.test.ts     | — / 59.0 s        | 27 s / 39.5 s  |
| handoff refusal case               | 10.9 s            | 1.3 s / 1.7 s  |

Estimated Windows shards (`--shard=n/4` assigns by SHA-1 of the path, so the
current 1,264 files were assigned with vitest 5.0.3's own algorithm). Each
file's latest hosted Windows time; 138 files never reached on Windows (shard 1
was cancelled in both runs) use their hosted Ubuntu time × 1.49 (the
Windows/Ubuntu ratio over 1,114 files timed on both); +0.71 s per file of
import/setup overhead (shard 2's 847 s duration minus its file times). The
changed files are scaled by their Kubuntu coverage ratio (journal 0.13,
modelApiHost 0.68, conversationController 0.67); other files that stream
Model API replies also gain from `8bbe763dd` but are not credited. The job's
own checkout and `npm ci` add about a minute.

| Shards    | Shard 1  | Shard 2  | Shard 3  | Shard 4  | Shard 5  |
| --------- | -------- | -------- | -------- | -------- | -------- |
| 4, before | 21.9 min | 14.2 min | 20.3 min | 18.0 min | —        |
| 4, after  | 18.3 min | 14.2 min | 20.0 min | 18.0 min | —        |
| 5, after  | 15.5 min | 13.8 min | 13.4 min | 13.3 min | 14.5 min |

About 70 minutes of serial Windows work cannot fit four 20-minute jobs at any
balance, and shard 3 does not hold modelApiHost, so splitting that file
(the brief's fallback) would not clear it: shard 3 is execStdio (157 s),
checkpointStoreWindows (84 s), teamLanding, scheduleFs and m114Panel. Vitest
5.0.3 has no duration-based sharding; a custom `sequence.sequencer` would
need a committed duration table that goes stale. **Lead's decision, not
changed here:** five Windows shards (`build.yml` `unit` matrix and the
`coverage` job's `for shard in 1 2 3 4` check), or further per-file work. One
found and left: execStdio's E6 (18.5 s of its 43 s on Kubuntu) waits out the
real Model API retry backoff (`MODEL_API_RETRY_BASE_MS` 1 s) because its fake
`fetch` throws; shortening it needs a test-only retry setting in exec.

### 2. acpStdio on hosted Ubuntu

Not hosted-only: the two cases failed together on Kubuntu in two of three
runs of just that pair (`-t` both), identical to the hosted messages.

- **Answer echoed again (product, `993789c4c`).** When the backend finishes a
  turn before its `turn/start` reply is handled, `noteTurnId` settles the
  prompt (`this.pending = undefined`, lease released) before the commit
  check, so the delivered answer stayed queued and the next prompt, or the
  next agent on the same data folder, sent it again. The commit decision now
  runs first and counts an early finish of that turn as delivery. New case in
  acpQuestionDeferral fails before ("called 0 times") and passes after; the
  e2e pair then passed 5/5.
- **"The schedule host could not start" (fixture).** The laid-out package
  never had `dist/schedules.js`, so the host refused on every OS; the loader
  logged `The schedules …/dist/schedules.js could not be loaded: Cannot find
module`, and the text check ignored the notice. Hosted differences named in
  the brief were tried and are not the cause: a world-writable sticky TMPDIR
  and no `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS` both pass. The fixture
  now builds the bundle as the package ships it; the host starts (also with
  no session bus) and registers no user units. The Muse Code case now
  requires no host-unavailable notice and prints the agent's log, which names
  the cause, if one appears.

### 3. conversationController handoff refusals

The over-limit brief streams thousands of strings, each through a rebuilt
secret matcher (profile: 9 of 11 s in `redactWith`). Fixed by `8bbe763dd`
(table above). The case's named 20 s deadline and its PLAN.md §8 row are
removed; at the default 5 s it passes in 1.3 s (1.7 s under coverage).

### Drills (each restored, SHA-256 compared)

| Guard                                                | Break                                        | Result                               |
| ---------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| journal: clones once per read                        | `journal.ts` from `506ae2375`                | "expected 41 to be 2"                |
| journal: store reuses its validated journal          | `store.ts` from `506ae2375`                  | "expected 14 to be less than 5"      |
| journal: callers never get cached values             | `parse(next)` without the clone              | values became `{ b: 2 }`, `{ d: 2 }` |
| recordingReader: language installed once             | `schedulesEntry.ts` from `506ae2375`         | formatter identity differs           |
| acpQuestionDeferral: commit when the turn ends first | test written before the fix                  | `commitQueued` called 0 times        |
| acpStdio: no host-unavailable notice                 | fixture without the schedules bundle         | fails, prints "could not be loaded"  |
| redact: forms derived once                           | rebuild the matcher per call                 | "expected 6 to be 1"                 |
| redact: secret registered mid-stream                 | never rebuild after the first call           | the late secret left unredacted      |
| handoff case at the default deadline                 | transport back to per-string `redactSecrets` | "Test timed out in 5000ms"           |

### Tests run (Kubuntu, repository default timeouts)

scheduleJournal, scheduleStore, scheduler, scheduleMigrate, scheduleOutbox,
scheduleFs, scheduleRestartRecovery (151 passed); recordingReader 69;
modelApiHost 669; acpQuestionDeferral + acpAgent 222; e2e/acpStdio 13;
redact + accountSecrets 204; conversationController 680; modelApiClient,
modelApiProviders, modelApiHostedSearch 143; metaRequestGoldens,
unattendedBackends.
