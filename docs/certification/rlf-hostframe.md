# RLF-HOSTFRAME — the JetBrains and Eclipse panels, looked at

Lane RLF-HOSTFRAME. Base: lanes/cc-m104gw (`94e2f3e07`). Rig: linuxlt (Linux,
JDK 21, Xvfb, WebKitGTK, JCEF from the IntelliJ 2025.3.3 JBR). Started in Muse
Spark Code, finished in Claude Code on 2026-11-02. No model request, no paid
call, no credential read: the panels render their signed-out state on a
scratch data home, which proves the page without a conversation.

The question from CC-M104GW: Visual Studio's first real run found its panel on
its fatal card on every run and black text on black, while its suites passed,
because nothing looked at what the panel showed. Did JetBrains and Eclipse
have the same defects?

## What ran, what it showed, what was wrong

| Host      | What ran                                                                                                                                          | What it showed                                                                                                                           | What was wrong                                                                                                                                                                                                                | Fixed in                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| JetBrains | `PanelConformanceSuite`: the production `RuntimeConnection` on `dist/acp.js panel --stdio`, `PanelSurface` + `EmbeddedPanel` in a real JCEF frame | Before: the payload check refused the runtime's first frame (the theme)                                                                  | `JsonBoundary` picked the payload group by surface kind, so the MHP 1.6 theme frame was refused (`MHP_PANEL_INVALID_PAYLOAD`)                                                                                                 | `883301290`              |
| JetBrains | the same suite, after that fix                                                                                                                    | The page rendered, theme `light`, `--vscode-foreground` empty, body text `rgb(0, 0, 0)` on a transparent surface: `MHP_PANEL_UNREADABLE` | The theme frame named VS Code tokens (`--muse-foreground`), never the roles the theme port reads (`--muse-text`). The bridge pointed every VS Code alias at an empty role: text lost its colour, black on black in a dark IDE | `542bba0c0`              |
| JetBrains | `node scripts/gen-editor-matrix.mjs --hosts jetbrains`                                                                                            | First run `MHP_CONFORMANCE_HARNESS_FAILED`: the diagnostics leg never finished                                                           | `run.mjs` ran every suite in one native-UI JVM; the diagnostics leg drives the headless daemon. The legs now run headless, then the panel natively                                                                            | `c75972187`              |
| JetBrains | the plugin's declared build (`test detekt ktlintCheck buildPlugin`)                                                                               | detekt: 6 weighted issues, exit 1, on the base                                                                                           | The package never built through its own command                                                                                                                                                                               | `8c21448f5`              |
| Eclipse   | `ConformanceIT` with its new panel leg: the view the runtime's `surfaces/open` raised, WebKitGTK under Xvfb                                       | The page rendered (`Muse Spark`, `Getting Started`); no fatal card; text `rgb(228, 231, 237)` on `rgb(24, 24, 24)`                       | The payload check refused the theme frame by surface kind (`883301290`). The suite looked at no page at all (`814dca3a3`). Open: the page paints Muse's own dark palette whatever the IDE theme is (below)                    | `883301290`, `814dca3a3` |

Runtime requests never served: the runtime-to-host methods of every capability
each host declares were read against each host's dispatch. JetBrains serves
each by name; Eclipse serves `editor/replaceSelection` and
`editor/insertAtCursor` through its generic edit branch
(`Documents.request`). None found unserved. Launch arguments: JetBrains and
Eclipse launch `panel --stdio`, which the runtime accepts.

### The shim hosts

Sublime, Emacs, Neovim, Zed and Qt Creator embed no page: their panel command
starts `[supervise] panel --companion`, and the runtime refuses it on this tree
(`Unknown option --companion for 'panel': panel accepts --stdio, --workspace,
--verbose, --help`, run here on `dist/acp.js` in an empty workspace). Each shim
says the refusal (`EPANEL_EXIT`; Neovim's `test/check.lua` asserts it is
visible), and PLAN §6 lists the `panel --companion` transport as remaining
(RLF-HOSTS2). The fatal-card and readability checks apply to them once that
transport serves a page. Xcode embeds a WKWebView and runs on macOS only.

## The checks Visual Studio has, now on JetBrains and Eclipse

Both suites fail, on a green run too, when the real page shows its fatal card
(`MHP_PANEL_FATAL_CARD`: "The Panel Hit an Error" after a 2 s settle) or is
unreadable (`MHP_PANEL_UNREADABLE`). JetBrains reads, as Visual Studio does,
the theme mode, `--vscode-foreground` and the body's text against its surface,
and also fails on a missing theme frame or any `panelError` it sent back.
Eclipse's page is the shared chat entry, which takes no theme frame: it fails
when the host's text and surface tokens resolve to one colour or the body's
text is painted in its own background.

## Red/green drills

| Check                            | Red (break on purpose)                                                                                                                                 | Green                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| JetBrains `MHP_PANEL_UNREADABLE` | The real pre-fix tokens: `{"theme":"light","foreground":"","text":"rgb(0, 0, 0)","surface":"rgba(0, 0, 0, 0)"}`, Gradle exit 1                         | Role tokens: suite PASSED, exit 0               |
| JetBrains `MHP_PANEL_FATAL_CARD` | `--muse-text` set to `notacolour`: the bridge refuses the theme and the real page shows its fatal card; `MHP_PANEL_FATAL_CARD`, exit 1                 | Restored: PASSED, exit 0                        |
| Eclipse `MHP_PANEL_UNREADABLE`   | `--muse-editor-foreground` painted with the background colour: `{"tokenText":"rgb(255, 255, 255)","tokenSurface":"rgb(255, 255, 255)"…}`, Maven exit 1 | Restored: the receipt run's ConformanceIT green |
| JetBrains JCEF sandbox switch    | `ide.browser.jcef.sandbox.enable` removed from the native-UI test run: `NativeJcefSmokeTest` FAILED, exit 1 (AppArmor's userns restriction)            | Restored: PASSED                                |

Eclipse's `MHP_PANEL_FATAL_CARD` has no red of its own: its page is the shared
chat entry, whose card comes only from a render error in the shared webview,
which no host-side break produces. The same check went red on JetBrains' real
page above and on Visual Studio's (cc-m104gw).

## Receipts

Rewritten by running, never by hand: `node scripts/gen-editor-matrix.mjs
--hosts jetbrains,eclipse`, then `--hosts jetbrains` after the runner fix,
with `JAVA_HOME` the lane's JDK 21, a scratch `HOME` and `TMPDIR` under the
worktree's `temp/`, and `MAVEN_ARGS="-o -Dmaven.repo.local=…"`.
`m104-jetbrains.json`: waiting, 9 legs green, plus the real panel suite.
`m104-eclipse.json`: waiting, its legs green with the panel leg. `check:mhp`
exit 0; `check:editor-matrix` exit 0 (`Matrix: 10 editors; … is current`).

Rig notes for the next run: a killed Gradle run leaves the test sandbox's
index corrupt (`IdIndex has status REQUIRES_REBUILD`), and JCEF then never
starts; deleting `.intellijPlatform/sandbox/…/system-test` heals it. JBR
creates `jbr/lib/extensions` inside Gradle's transformed IDE on every JCEF
run, which trips Gradle's immutable-workspace check on the next build;
removing that empty folder before a run is enough.

## Open

1. **Eclipse ignores the IDE's colours.** The shared chat entry paints from
   `--vscode-*` variables and Muse's generated palette; Eclipse sets only
   `--muse-editor-background` and `--muse-editor-foreground`, which no rule
   reads. Under a light Eclipse the panel is dark (`rgb(24, 24, 24)`).
   Readable, but not the IDE's theme. Options: Eclipse also writes the role
   and `--vscode-*` aliases from its two colours (small, partial theme); or
   Eclipse moves to the portable entry and the theme frame (as JetBrains and
   Visual Studio); or leave it. Recommendation: the portable entry, with a UI
   look in both themes.
2. **The companion transport** (`panel --companion`) for the five shims: PLAN
   §6 already carries it.
3. **The `build` gate fails on this base**, with no source change in this
   lane: `dist/teamRunners.js` 78.4 KiB (budget 75), `dist/teamHost.js`
   140.2 KiB (130), `dist/teamScheduler.js` 76.5 KiB (75). Budgets not raised.
4. **The host packager end to end** (`node scripts/package-hosts/package.mjs
jetbrains`) needs `dist/acp-package`, which the universal runtime package
   writes only with the macOS native helpers (`native/darwin/...`), absent on
   linuxlt. The JetBrains declared build's steps ran one by one instead.
