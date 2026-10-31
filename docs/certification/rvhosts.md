# RVHOSTS — independent check of RLF-HOSTSLAND before it merges

Review lane on rig `linuxlt` (hostname randy-lt), worktree
`/home/randy/lanes/RVHOSTS`, branch `rv/hostsland` from `rec/rlf-hostsland`
at `f04ef7107`. No model call, no Muse request, nothing pushed, rebased,
stashed or tagged. Production `node scripts/build.mjs --production` exit 0;
`dist/acp.js` is this tree's build.

## Real runtime

| Host       | Command                                                                                                                        | Exit    | Talks to this tree's `panel --stdio`                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JetBrains  | `node test/hostApi/run.mjs jetbrains`                                                                                          | 0       | Yes. 14 process-list samples of `/home/randy/nd/bin/node /home/randy/lanes/RVHOSTS/dist/acp.js panel --stdio` during the run. Outcome `waiting`, protocol `mhp/1.5.0`, 9 results (musecode and modelapi diff-hunks, diagnostics, settings, panel-order; modelapi checkpoint), 13 waiting. |
| Eclipse    | `node test/hostApi/run.mjs eclipse`                                                                                            | 0       | Yes. 15 samples of the same argv, and no other `panel --stdio` argv in that sample. Same 9 results and 13 waiting. Maven 3.9.11 under `$TMPDIR`, Xvfb, JDK 21.                                                                                                                            |
| Emacs      | `emacs --batch -Q -L hosts/emacs -l hosts/emacs/test/muse-spark-test.el -f ert-run-tests-batch-and-exit`                       | 0       | No. 3/3 passed. `muse-real-child-cleanup-and-duplicate-refusal` sets `muse-spark-command` to `("/bin/cat")` (`hosts/emacs/test/muse-spark-test.el:26`). Emacs 30.1.                                                                                                                       |
| Neovim     | pinned binary `$TMPDIR/nvim-linux-x86_64/bin/nvim` (v0.12.6) `--headless -i NONE -u NONE -l hosts/neovim/test/check.lua`       | 0       | No. 19 PASS. The harness replaces `vim.system` (`hosts/neovim/test/check.lua:44`). The rig's system nvim 0.10.4 exits 1 at `check.lua:178` because `-i NONE` makes `wshada!` a no-op on 0.10, so the sentinel history entry is not restored. The README requires Neovim 0.12.             |
| Zed        | `python3 -m unittest discover -s hosts/zed/test`                                                                               | 0       | No. 6 tests. Launch uses `os.execvpe` (`hosts/zed/launch.py:37`). The tests drive a handwritten agent, not `dist/acp.js`.                                                                                                                                                                 |
| Qt Creator | `nvim --headless -i NONE -u NONE -l hosts/qtcreator/test/check.lua` and `python3 -m unittest discover -s hosts/qtcreator/test` | 0 and 0 | No. Lua harness green on system nvim 0.10.4; 4 Python tests. `os.execvpe` in `hosts/qtcreator/musespark/launch.py:62`. Qt Creator itself is not installed.                                                                                                                                |

`MhpBoundaryTest` (Gradle, IntelliJ 2025.3.3) passed, including
`presentedHtmlCannotRunAPeerScriptOrKeepAForeignPolicy`. Eclipse
`PresentedDocumentTest` passed (JUnit 4, JDK 21, no SWT).

## Nothing dropped

Lane records were read from the source tips. A piece is "here" only when
the file or symbol is on this branch.

- **A** (`lanes/rlf-m104a`, `docs/certification/rlf-m104a.md`): M123 panel
  git, checkout environments, editor GitHub leases, the shared approval
  card, lazy `runtimePanelGit`, checkpoint degradation. `auth/githubLease`
  is on the MHP method list. `assemblePanelGit` is absent.
  `src/runtime/panel/git/gitEntry.ts` is absent. `boardSharing` is absent.
  Hostsland's record says A adds nothing under `hosts/` beyond GL. That
  host claim holds. The runtime pieces were not replaced by an equivalent
  on this branch. They stay on A's branch. Not a silent host-plugin drop.
- **B** (`lanes/rlf-m104b`): MHP 1.6 theme message, session board,
  `hosts/mhp-python`, bridge CLI, browser worker, Jupyter, NetBeans,
  Spyder, RStudio spec. Contract on this branch is `mhp/1.5.0` with
  exclusive bound `1.6.0` (`src/shared/constants.ts`). Those editors are
  absent. Hostsland recorded this as a D212 decision and as work outside
  the nine hosts. Not superseded.
- **C** (`rec/rlf-m104c`): questions on the real bridges, `attachments/*`
  (MHP 1.5.1), native schedule hold. `questions/open` and `attachments/`
  do not appear under `hosts/`. Hostsland recorded the attachment binding
  as not ported because int's panel shape lacks it, and the fake-harness
  migrations as deleted with the fakes. The 1.5.1 move is not on this
  branch. Disclosed, not superseded.
- **G** (`lanes/rlf-m104g`, `docs/certification/m104-g.md`): Eclipse host,
  matrix generator, per-host runners. Present: `hosts/eclipse/`,
  `scripts/gen-editor-matrix.mjs`, `hosts/*/run.mjs`. G's full WebKit
  feature matrix is not re-proven here.
- **GX** (`lanes/rlf-m104gx`): Xcode `ConformanceTests` target and
  `hosts/xcode/run.mjs` are present. `hosts-native.yml` is absent, named
  in `docs/real-life/unproven.md`.
- **GL** (`rec/rlf-m104gl`): JetBrains and Eclipse conformance runners,
  `src/runtime/features/checkpoints.ts` (`createRuntimeCheckpoints`),
  Emacs ERT, `fakeLsp.ts` deleted, matrix present. `checkpointsFor` is
  not a symbol on this branch. The modelapi checkpoint leg did run in
  both native suites. Hostsland already says int's conversation port
  still reports checkpoints off.

`hosts/neovim/test/lsp.lua` still names the deleted fake LSP service.
`hosts/neovim/README.md` says that check stays unrunnable. It is not a
proof, and `temp/native-fake-lsp.js` is absent.

## Security of the boundary

- **JetBrains JCEF.** Before this review, `EmbeddedPanel.present` loaded
  runtime HTML and rewrote every `nonce="..."` to the host nonce, so a
  peer script or a foreign content-security policy could run.
  `PresentedHtml.admit` strips scripts, frames, foreign policy, refresh,
  links and event handlers, and `seal` installs the host policy.
  The JSQuery handler returns `MHP_PANEL_BRIDGE_REFUSED` unless
  `policy.navigationAllowed` accepts `browser.cefBrowser.url`. Linux
  launch is Perl `setsid` plus `exec`, not a shell. The Windows path
  uses `cmd.exe /d /s /c` only after rejecting quotes and newlines in
  the argv (`RuntimeProcess.kt`). That Windows path was not executed.
- **Eclipse SWT.** `presentHtml` used to write the runtime string to the
  page file. It now writes `PresentedDocument.compose`, whose strict
  policy has no `file:` and no remote URL. The `BrowserFunction` throws
  `MHP_PANEL_BRIDGE_REFUSED` unless `Assets.navigationAllowed` matches
  the loaded page. A query string on that file is refused
  (`BrowserTest`). The initial chat page still uses the asset document,
  which needs its stylesheet. Messages are accepted only for that page.
- **Visual Studio WebView2** (`PanelView.cs`): navigation that is not an
  asset URI is cancelled; frames are cancelled; a web message whose
  source is not the asset URI returns without posting. `AssetPolicy`
  starts children with `UseShellExecute = false`. `UseShellExecute =
true` is only `Process.Start` of an http(s) URI the person opens.
  No `presentHtml`. Suites are net48 and were not run.
- **Xcode WKWebView** (`PanelWebView.swift`): navigation is cancelled
  unless `LaunchLink.sameOrigin` matches the loaded origin. Not run
  (needs macOS XCTest).
- **Shims.** Emacs `make-process` and Neovim `vim.system` pass an argv.
  Zed and Qt Creator panel/lsp/stop use `os.execvpe`. Sublime
  `subprocess.Popen(..., shell=False)`. Zed tasks use `/bin/sh` or
  PowerShell because Zed tasks are shell text; arguments are quoted
  (`hosts/zed/register.py`). No review found a secret written into an
  editor log: stderr is discarded or ignored, and failures surface as
  fixed words (`EPANEL_EXIT`, `EPANEL_LAUNCH`, `EPANEL_STOP`).
  CodeCompanion's adapter sets credential variables to `""` rather than
  unsetting them (`hosts/neovim/lua/muse/init.lua`). The harness asserts
  that empty string.

## Honesty

- "Waiting for its machine" is true for Visual Studio (Windows, VSSDK,
  net48) and Xcode (macOS XCTest). It is not true that Sublime Text
  needs another machine. Build 4200 is installed at `/usr/bin/subl`.
  `timeout 12 xvfb-run -a subl --safe-mode --background` started
  `/opt/sublime_text/sublime_text` and was then stopped. An unregistered
  copy runs in evaluation mode, so a purchased licence is not required
  to start it. What is missing is an in-editor harness.
- `docs/real-life/unproven.md` already listed the deleted fake-runtime
  suites, WebKitGTK, the Windows and Mac waits, the Zed Rust extension,
  and `hosts-native.yml`. This review added the shim-vs-stdio gap, the
  Neovim 0.10.4 failure, the Sublime machine/licence fact, and the
  unported A/B/C pieces.
- CHANGELOG `[Unreleased]` claims 9 checks for JetBrains and Eclipse and
  does not claim those checks for the shims. That matches this run.
  README's install table still says JetBrains "Not yet tested here",
  which is older than the conformance run and does not over-claim.
- The Sublime README told the reader to run `hosts/sublime/test`. That
  directory does not exist (`python3 -m unittest discover` exit 1).
  The README now says the suite was deleted.

## Findings

| Id  | Severity | Finding                                                                                                                                                                           | Evidence                                                             | Disposition                                                                                         |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F1  | P1       | JetBrains and Eclipse could execute a script, or keep a foreign content-security policy, in HTML the runtime asked the surface to show. Eclipse wrote that HTML to a `file:` URL. | `EmbeddedPanel.present` / `MuseView.presentHtml` before `019236048`. | Fixed. `PresentedHtml` and `PresentedDocument`. Tests below.                                        |
| F2  | P2       | Emacs, Neovim, Zed and Qt Creator harnesses pass without this tree's `panel --stdio`.                                                                                             | Commands and files in the table above.                               | Recorded. They are excepted shims (`tool: false` on the runners). Not rewritten into stdio hosts.   |
| F3  | P2       | Sublime README named a test suite that is not in the tree.                                                                                                                        | `hosts/sublime/test` missing; unittest exit 1.                       | Fixed in this record's commit.                                                                      |
| F4  | P3       | The Neovim receipt's command fails on the rig's nvim 0.10.4.                                                                                                                      | exit 1 at `check.lua:178`. v0.12.6 exit 0, 19 PASS.                  | No product change. README already requires 0.12.                                                    |
| F5  | P3       | Lane A runtime git, lane B's 1.6 and extra editors, and lane C attachments are not on this branch.                                                                                | Symbol and path checks above.                                        | Disclosed by hostsland for B and C. Not treated as host-plugin regressions. Left on their branches. |

## Fixes and drills

- `019236048` seals peer HTML and refuses a bridge message whose page is
  not the loaded page.
- `b8fae879d` wraps the Kotlin patterns to the ktlint line limit.
  `ktlint` main source set is clean. The test source set still reports
  pre-existing violations in `ConformanceSuite.kt` and `ScenarioLegs.kt`,
  which this lane did not edit. `./gradlew test` for conformance does not
  run ktlint. `MhpBoundaryTest` passed after the wrap.
- Drill, Eclipse admit, on the committed rule. Replaced
  `SCRIPT.matcher(html).replaceAll("")` with `String document = html`.
  `PresentedDocumentTest` exit 1:
  `IllegalArgumentException: MHP_INVALID_HTML` at `admit` line 23
  (the open-script guard; the `evil()` assertion is not what failed).
  Restored the strip. Same test exit 0. Working tree clean after the
  restore. The open-script guard is why a missed strip fails closed.

## What is sound

JetBrains and Eclipse conformance really drive this tree's
`dist/acp.js panel --stdio` and match the 9-leg claim, including the 13
waiting legs. The shim launch paths that were read do not use a shell
for the agent, except Zed's task shell, which quotes. Visual Studio and
Xcode, from the source, lock navigation to the page they loaded and were
not executed. CHANGELOG does not claim more than the 9 checks and the
unrun editors. README's JetBrains line under-claims rather than
over-claims.

## Gates

Filled in after the final run on this tree. A failing gate stays failing
in that table.
