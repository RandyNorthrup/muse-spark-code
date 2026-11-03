# CC-M104GW — Visual Studio and the VS Code family, qualified on the owner's PC

Lane `CC-M104GW`, branch `cc/m104gw`, base `rv/hosts2` `4be695f75`. Rig: the owner's
Windows PC (Windows 11 Pro 26200), Visual Studio Community 2022 17.14.25, .NET SDK
10.0.403, Node 24.20.0. Model attempts: **0** of the 4 allowed: no leg needed one, and
the panel's conversation legs wait in the contract. Provider calls: **0**. Nothing
pushed, rebased or tagged. No vault or credential-store suite ran. The runtime's
user data, in every run, lay in a scratch home under the worktree's `temp/`.

## The VSSDK workload

`Microsoft.VisualStudio.Workload.VisualStudioExtension` is not installed (`vswhere
-requires` returns nothing; `MSBuild\Microsoft\VisualStudio\v17.0\VSSDK` is absent).
This shell's token is not elevated and `ConsentPromptBehaviorAdmin` is 5, so
`setup.exe modify` would raise a UAC prompt on the owner's desktop. That step stopped
there and was not started. It turned out not to be needed: NuGet's
`Microsoft.VSSDK.BuildTools` supplies `VSToolsPath`, the VSIX builds with it, and an
experimental instance needs no workload. If the owner wants it, in an elevated prompt:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" modify --installPath "C:\Program Files\Microsoft Visual Studio\2022\Community" --add Microsoft.VisualStudio.Workload.VisualStudioExtension --passive --norestart
```

## What the first real run found

The host had compiled only as far as its test project; nothing under `MusePackage` had
been built, and nothing had ever talked to this tree's runtime. Each of these was found
by running it, in this order, and is fixed in `565eb2ebb`, `d057f63d2` or, the last row,
`890faa1ba`:

| Defect                                                                                                                                              | Seen as                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `MusePackage.cs` assigned an undeclared `panel`                                                                                                     | MSBuild `CS0103`, so no VSIX could exist                   |
| The VSIX licence kept its source name, not the manifest's                                                                                           | `VSSDK1310`                                                |
| `panel --stdio --host visual-studio`: this tree's CLI refuses `--host`                                                                              | every launch exits 2                                       |
| `MhpPeer` gated a runtime request on what the _runtime_ serves, so `surfaces/open` and every document request refused                               | `MHP_UNSUPPORTED_CAPABILITY` on the first request          |
| Seven `PanelCarrierTests` drove an inbound `initialize` the contract forbids; the code behind them was dead                                         | 7 of 22 red on the first `dotnet test`                     |
| `MuseToolWindow` had no content when the shell created it                                                                                           | `CreateToolWindow` `0x8000FFFF`                            |
| Replacing the pane's content left WebView2 with no loaded parent                                                                                    | `EnsureCoreWebView2Async` never returned                   |
| `NativeSurfaces` gave its channel the schema without the panel export                                                                               | `MHP_SURFACE_UNAVAILABLE`                                  |
| The theme frame sits in the last payload group, which the surface-kind lookup never read                                                            | `MHP_PANEL_INVALID_PAYLOAD` on the runtime's first frame   |
| A snapshot's version counts the editor's load, so a document opened at 2                                                                            | observed versions 3 and 4, contract 2 and 3                |
| The page's `<style>` for the theme had no nonce under the page's strict `style-src`, and a refused theme is fatal on the portable entry             | **`The Panel Hit an Error` over every page, green or not** |
| The page never linked `theme.css`, and the host's tokens named no role                                                                              | black text on black                                        |
| A start failure before the `try` vanished into `FileAndForget`, and a host failure reached the runtime with no local trace                          | three blind runs                                           |
| `scripts/package-vsix.mjs` fails on this tree: `dist/webview` decodes past its 4,000,000-byte bound since the portable bundle landed in that folder | `ERR_BUFFER_TOO_LARGE`                                     |

The last is not raised: the VSIX leaves the portable bundle out, as PLAN M104 already
says it should ("the plugins carry the bundle and the VSIX does not"). 4,371,795 bytes
against a 4,915,200 budget.

The old carrier (`MhpPanelChannel`, `embedded-bridge.mjs`, its test) was what `MusePackage`
half-used, with a session id the runtime never issued. The runtime opens its own chat
through `surfaces/open` now, so it is deleted, with `IPanelChannel`.

## The lead's four questions

**1. Drills that no longer need Visual Studio.** All ten below ran on plain `dotnet
test` in 6 to 16 seconds, against 60 to 265 seconds in the instance:

| Break                                             | Caught by                                                                     | Exit | Time |
| ------------------------------------------------- | ----------------------------------------------------------------------------- | ---- | ---- |
| `EditPlan` no longer refuses a dirty buffer       | `RefusesStaleOrDirtyBuffersBeforeMutation`                                    | 1    | 16 s |
| `EditPlan` no longer refuses a stale version      | the same, and `RefusesAStaleMovedInvisibleOrUnrelatedCompletion`              | 1    | 9 s  |
| Panel sequence check removed                      | `ARefusedFrameClosesOnlyItsOwnChannelWithItsFrozenCodeBeforeDelivery`         | 1    | 7 s  |
| `--host` back in the job helper's launch          | `ThisTreesRuntimeAnswersOverTheJobHelperAndItsTreeEndsWithTheHost`            | 1    | 6 s  |
| `--host` back in the start info                   | `LaunchesWithoutShellOrCredentialEnvironmentAndQuotesWindowsPaths`            | 1    | 12 s |
| Runtime requests gated on what the runtime serves | `ServesTheRuntimesRequestsOnWhatThisHostOfferedNotOnWhatTheRuntimeOffersBack` | 1    | 6 s  |
| The initialize answer no longer read              | `ThisTreesRuntimeAnswersOverTheJobHelperAndItsTreeEndsWithTheHost`            | 1    | 6 s  |
| Theme frame admitted only by the surface group    | `AdmitsTheThemeFrameOnEverySurfaceKindAndRefusesAMalformedOne`                | 1    | 7 s  |
| Ready marked after its write                      | `AdmitsTheRuntimesFirstFramesWhileItsReadyIsStillBeingWritten`                | 1    | 7 s  |
| A reloaded page sends ready twice                 | `BindsReadyReloadHiddenAndCloseToOneSession`                                  | 1    | 7 s  |

Each restored byte-exact; `dotnet test` 26 of 26 after them. The wrong-schema drill went
away by design: `PanelChannel` takes its schema from its peer now. A ready-order break
hung the first version of its test (the refusal queued behind the blocked write), so the
test reads before it drains. Only what needs a real Visual Studio API still needs the
instance: real text buffers and undo, the Error List, the tool window, the WebView2 page.

**2. What the owner was seeing.** Pictures of this lane's own window only (`PrintWindow`
on its handle, never the desktop), and the instance's Output panes and Error List, which
the suite now writes to `temp/vs-ide-logs/ide-state.txt`:

- _Visual Studio opening repeatedly_: this lane's runs, about 35, one per attempt or drill.
- _An error each time_: **a real defect, on every run including the green ones.** The
  panel opened on `The Panel Hit an Error / Could not open the panel` over an inert page
  (the nonce row above). The suite passed because it read the signed-out text under the
  card. Fixed; the suite now fails on the card (`MHP_PANEL_FATAL_CARD`) and on an unpainted
  page (`MHP_PANEL_UNREADABLE`). One small look at the result, dark theme, the only one
  this hive has (a light one was not taken):
  [`cc-m104gw/visual-studio-panel-dark.png`](cc-m104gw/visual-studio-panel-dark.png).
- _A dialog, on some runs_: `That did not work (the Muse Spark log has the details)`,
  modal, from `ui/notify` after a refused `surfaces/open`. Only the two drills that break
  that path on purpose raise it; a green run does not. Left as is and named below: a
  notice with Continue and Cancel, for a result that is `null`, is wrong, but only a failed
  start reaches it.
- _The huge list_: Visual Studio's own **Code Snippet Output** pane, 75 lines (148 on the
  final run's new hive) of
  `...\Web\Snippets\HTML\1033\HTML\*.snippet: Missing or unspecified Language attribute`,
  from its snippet index. It is not ours: the host has no Output pane (`OutputWindow`
  appears nowhere under `hosts/visualstudio`), and these are Visual Studio's installed
  files. The harness forces a rebuild each launch (`/clearcache`, `/updateconfiguration`,
  `/resetsettings`), which is why it showed every time. Whether a person would see it
  once after installing any VSIX was not measured (a run without our VSIX would take
  another launch).

On a green run, separated from what the drills caused:

| Where               | Green run                                                                                                                                                                          | Ours?      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Error List          | 0 entries                                                                                                                                                                          | —          |
| Output panes        | Code Snippet Output (75 lines), GitHub Copilot (`You are not signed into GitHub`), Source Control - Git (`Root element is missing`, on this worktree's repository); the rest empty | No         |
| `ActivityLog.xml`   | 4 errors, 19 warnings: a UI library, the Xamarin and LiveShare MEF assemblies, one solution option, and Copilot's broker lines. **0 from `Muse Spark Code`**                       | No         |
| On the drills' runs | `surfaces/open MHP_UNSUPPORTED_CAPABILITY`, `ui/notify MHP_UNSUPPORTED_CAPABILITY`                                                                                                 | On purpose |

That `ActivityLog.xml` is from a run at 19:51 UTC, the paint drill's restored green. The
final run (20:43 UTC, 13 of 13, a new hive) wrote none before the harness closed it, so its
own Output panes and Error List are what it leaves: the table's, 148 snippet lines, 0
errors, no Muse pane.

**3. `suite exit 0` beside a thrown failure.** My scratch `temp/conf-quick.ps1` printed
`exit N` as text and returned 0, and every drill line above read that. `conformance.ps1`
does not lose it: it exited 1 on three failing runs, and `node test/hostApi/run.mjs
visualstudio` exited 1 on a failing suite (`MHP_CONFORMANCE_HARNESS_FAILED`). After the
scratch fix a failing run shows `suite exit 1`. A failing suite exits non-zero on its own.

**4. Instances.** The harness closes each instance it starts; after each run the process
list showed no `devenv`, `testhost`, `muse-panel-job` or MuseConf `msedgewebview2`. One was
stopped by hand, pid 29864, recorded and matched by its root suffix: a loop of mine on
`ITextUndoHistory.CanUndo`, which answers true on an empty stack here. The one hung test
host (pid 13540, the ready drill's first form) was stopped the same way, after its parent
chain was read. The owner's Visual Studio was not open and was not touched. `run.mjs`
refuses to start while `devenv`, `VSIXInstaller`, `VsJITDebugger`, `DbgCLR` or `dexplore`
runs, because the harness installs with `/shutdownprocesses` and ends the last three by
name (drill below). Pictures the harness takes on a failure are deleted after each run,
unread.

## Visual Studio

`node test/hostApi/run.mjs visualstudio`: **13 of 13 runnable legs green, 9 waiting**,
exit 0. `Conformance/ConformanceSuite.cs` is one `[IdeFact]` in an experimental instance
under the root suffix `MuseConf`, so the owner's hive and any `Exp` hive stay untouched.
It opens a saved solution, raises the real View menu command, and the packed agent (this
tree's tarball in a PATH folder's `node_modules`, found by the product's own locator)
starts under the real job helper. The runtime opens the chat; the page shakes hands and
renders; the editor's context reaches the composer. Legs: `m104-visualstudio.md`.

`Test/`: 26 of 26. `RuntimeProcessTests` is the real-runtime replacement for the deleted
`RuntimeAndPackageTests`: this tree's `dist/acp.js` through the job helper, a settings
round trip on a scratch home, the process tree gone after close. **ProtocolTests does not
exist on this tree**: RLF-HOSTSLAND deleted it (a hand-written `FakeHost`), and it stays
deleted; the peer's paths are covered above and against the real runtime. `fake-runtime.mjs`
is gone too. No echo child and no answering host remains: `PanelCarrierTests`' host now
throws if a service is ever reached.

**The listing drift** does not exist here: `listing.test.mjs` is 7 of 7 at 0.19.0, and
`build.ps1` now runs it. The drift that was real is in the host's README, which described
fakes and capabilities it no longer has. Rewritten.

## VS Code and the family

`test/integration/m104Conformance.test.ts` (not on this tree before; from
`rec/rlf-m104gl`, reworked): 9 of 9 on 1.144.0 (stable) and 1.99.0 (floor).
`m104-vscode.md` says why dirty-buffer and atomic-edit wait for VS Code here. The edit-review
leg drives `vscodeReviewPorts`, the two ports `src/extension.ts` now takes from the same
module, so the leg cannot drift from what the extension wires.

That extraction and `test/unit/helpers/ownerWrite.ts` came last: `npm run duplication`
exited 1 on two clones this driver had brought in (18 lines of `extension.ts`, 13 of the
checkpoint driver), now 0. Both only move code. VS Code's two versions and Visual Studio's
one final run came after them, so their receipts are this tree's. The family below ran just
before them and was not repeated.

The family rows with a portable Windows archive, each downloaded to its own folder under
`temp/family`, with its own data and extensions folders, so nothing was installed on the
machine (hashes checked where the feed gives one; VSCodium's floor is a pinned URL):

| Editor        | Version     | Built on        | `.vsix` install, list | M104g legs |
| ------------- | ----------- | --------------- | --------------------- | ---------- |
| VSCodium      | 1.99.32846  | VS Code 1.99.3  | exit 0, exit 0        | 9 of 9     |
| VSCodium      | 1.143.17232 | VS Code 1.143.1 | exit 0, exit 0        | 9 of 9     |
| Devin Desktop | 3.11.238    | VS Code 1.126.0 | exit 0, exit 0        | 9 of 9     |
| Positron      | 2026.10.2   | VS Code 1.134.0 | exit 0, exit 0        | 9 of 9     |

These are two separate proofs, as on the fork runners (`hosts.md`): the 0.19.0 `.vsix` of
this tree installs and lists with the editor's own CLI, and the legs run the development
extension through `test/hosts/installed.vscode-test.mjs`. No conversation ran in any of
them. The first attempt never started: Git's `tar`, first on PATH, took `C:` for a host;
Windows' own `tar.exe` reads the zip.

**code-server 4.144.0 (Code 1.144.0, Node 24.22.1)** now publishes a Windows archive, so
this row ran too, in a scratch home with its own data folders, on loopback, with a headless
Chrome on its own profile. The `.vsix` installs and lists with its CLI, the extension
activates on `onStartupFinished` in 196 ms, the activity bar carries Muse Spark, and its
panel renders the real sign-in page with 0 page errors. Voice says it is unavailable in a
remote window, as it should. No conversation; the M104g legs need Electron and do not run
there. Its log has one warning on activation, `OpenRouter Connect recovery failed`, a logged
line a person never sees; its cause was not looked into, because that path is the credential
store this lane stays out of on this PC. The first try gave `?folder=` a `C:\` path, which
the web client refuses: my script's error, not the product's.

Not run here, and why:

- **Cursor and Kiro** have no portable Windows archive: Cursor's feed gives a user setup
  exe, which changes the machine, and Kiro's answered 403. Their records stay
  `forks.yml`'s Linux runs.
- **Eclipse Theia**: its 2026-10-22 record stands. It is built from npm, too heavy for the
  owner's PC for no new claim.
- **Codespaces, Che, Firebase Studio**: an account or a cluster, as their rows say.

**Arduino IDE 2** waits for M103f's VSIX: `scripts/package-arduino.mjs` is on
`refs/rigs/macmini/rec/rlm103` and not on this tree. Arduino IDE 2.3.10 is installed on this
PC, so the row can run here once that lands.

## Red/green drills in the instance

`validate` is the runner's own `validateReport` over the run's observations. Each break
restored byte-exact (`git diff` exit 0). The middle column is what the suite itself threw,
when it threw; an observation that merely differs is the validator's to refuse, as on the
JetBrains and Eclipse runners.

| Case         | Break                                                 | Suite threw                                | validate | Time  |
| ------------ | ----------------------------------------------------- | ------------------------------------------ | -------- | ----- |
| dirty-buffer | `EditPlan` refuses no dirty buffer                    | —                                          | 1        | 71 s  |
| atomic-edit  | `EditPlan` refuses no stale version                   | —                                          | 1        | 69 s  |
| diff-hunks   | `applyEdits` drops every edit but the first           | `MHP_CONFORMANCE_DRIVER_FAILED hunks`      | 1        | 64 s  |
| diagnostics  | The Error List read loses the error severity          | —                                          | 1        | 77 s  |
| checkpoint   | The driver restores a turn it never recorded          | `MHP_CONFORMANCE_DRIVER_FAILED checkpoint` | 1        | 69 s  |
| settings     | The peer forgets the initialize answer                | `MHP_UNSUPPORTED_CAPABILITY`               | 1        | 62 s  |
| panel-order  | The channel checks no sequence                        | —                                          | 1        | 71 s  |
| launch       | `--host` put back                                     | `MHP_DISCONNECTED`                         | 1        | 62 s  |
| peer gate    | Runtime requests gated on what the runtime serves     | `MHP_PANEL_NOT_READY`                      | 1        | 265 s |
| surfaces     | The channel reads the schema without the panel export | `MHP_PANEL_NOT_READY`                      | 1        | 248 s |
| ready order  | Marked after its write                                | **stayed green, 13 legs**                  | 0        | 72 s  |

The ready order is a race the real page did not lose here; the plain test above makes it
deterministic. New checks, and their reds:

| Check                  | Red                                                                                                                                   | Green                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `MHP_PANEL_FATAL_CARD` | The real page before the nonce fix: suite exit 1                                                                                      | After the fix                                                            |
| `MHP_PANEL_UNREADABLE` | Pre-fix tokens and no theme link: `{"theme":"dark","foreground":"","text":"rgb(0, 0, 0)","surface":"rgba(0, 0, 0, 0)"}`, suite exit 1 | Restored. Removing the link alone stays green: the tokens paint the text |
| `run.mjs` refusal      | A real process named `dexplore.exe` (a copy of `ping`, pid 22192, stopped by that pid): exit 3, `...with dexplore.exe closed first`   | Runs when none is open                                                   |
| `check:editor-matrix`  | A tampered report: `MHP_MATRIX_REPORT:visualstudio:MHP_CONFORMANCE_OBSERVATION:musecode:dirty-buffer:text`, exit 1                    | Restored, exit 0                                                         |
| Unknown waiting host   | `hosts: ["nonesuch"]`: `MHP_CONFORMANCE_WAITING_HOST`, exit 1                                                                         | Restored, exit 0                                                         |
| `--hosts`              | `--hosts nope`: `matrix: nope is not in the matrix`, exit 1                                                                           | `--hosts vscode` writes that row alone                                   |
| VS Code panel-order    | `surface.inputSeq` no longer advances: 2 of 9 fail on `MHP_PANEL_OUT_OF_ORDER`, suite exit 1                                          | Restored                                                                 |
| VS Code diagnostics    | A lower-case drive letter: the loop reads `changed` (the run that found it), suite exit 1                                             | Canonical path                                                           |
| `package-vsix.mjs`     | Natural, before the fix: `ERR_BUFFER_TOO_LARGE`, exit 1. Not repeated by hand                                                         | 4,371,795 bytes; the archive holds 238 members, 0 of them portable       |

Two more natural reds, from the first gate round on this lane's own code: `npm run
duplication` (2 clones, exit 1, then 0 clones, exit 0) and `npm run deadcode`'s
`Unlisted binaries: tasklist hosts/visualstudio/run.mjs` (gone once listed with its reason).

## Still open

1. **JetBrains and Eclipse, by reading, not run.** `JsonBoundary.payload`
   (`hosts/jetbrains/.../JsonBoundary.kt:66`) and `Contract.payload`
   (`hosts/eclipse/.../Contract.java:53`) pick the payload group by surface kind, exactly
   as this host did, and the theme frame is the runtime's first frame on every ready. Their
   suites open no real surface, so nothing shows it. Their real panels likely close on
   `MHP_PANEL_INVALID_PAYLOAD`. Same fix as `SchemaContract.ValidatePayload`; it needs a
   machine with their toolchains and a real page. Not changed here, unproven.
2. A failed start's `ui/notify` is a modal with Continue and Cancel for a `null` result.
3. A refused theme is fatal on the portable entry (`reportBridgeFailure`), while its own
   comment says it should leave the generated palette. The nonce removes the known cause;
   any other refusal still blanks the panel.
4. Solution trust is always `false`; a native trust adapter and the `workspace` group are
   owed. `surfaces/presentHtml` and the other presentation kinds refuse by name.
5. The modal dialogs, Tab ghost text, the theme re-colour, reload in a real page, high
   contrast and a real conversation: `docs/real-life/unproven.md`.
6. Visual Studio 2026 is not on this PC. The Marketplace upload and its account are the
   owner's. The workload above needs the owner's UAC, and nothing here needs it.
7. Hosted-runner reliability of the archived `[IdeFact]` harness (0.1.800-beta, from the
   public `vssdk` Azure feed, mapped to its own package ids) is unmeasured; it runs here.
8. `OpenRouter Connect recovery failed` on activation in code-server with a scratch home:
   a logged warning, cause not looked into (the credential store, which this lane stays out
   of on this PC). The Windows VS Code family's desktop runs do not read that log.

## Gates on the final tree

One at a time; nothing was re-run hoping for green. No timeout, budget or bound was raised.
`check:host-api` went red on this lane's new adapter file, and its record was regenerated
and read: one more file, the same 392 APIs. The base's reds are as `rvhosts2.md` records them.

| Gate                                                                   | Exit  | Note                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier and eslint, on every file this lane touched                   | 0, 0  |                                                                                                                                                                                                                                 |
| `npm run typecheck`                                                    | 0     |                                                                                                                                                                                                                                 |
| `check-l10n`, `check:reference`, `check:host-api`                      | 0     |                                                                                                                                                                                                                                 |
| `check:plan`, `check:roadmap`, `check:catches`                         | 0     |                                                                                                                                                                                                                                 |
| `check:mhp`, `check:editor-matrix`                                     | 0     |                                                                                                                                                                                                                                 |
| `npm run duplication`, `npm run cycles`                                | 0, 0  | 0 clones                                                                                                                                                                                                                        |
| `npm run deadcode`                                                     | **1** | The base's, none from this lane: unused `test/hostApi/listings.test.mjs`, `test/hostApi/vitest.config.mjs`, exports `XCODE_HOST`, `XCODE_MODEL_TEXT`. Three fewer than the base's review: this lane listed the runners' entries |
| `npm run build`                                                        | **1** | Stops at the base's three budgets, unchanged: `teamRunners` 78.4 of 75 KiB, `teamHost` 140.2 of 130, `teamScheduler` 76.5 of 75                                                                                                 |
| The build's later steps, each run alone                                | 0     | `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records`                                                                                                     |
| `node scripts/package-vsix.mjs --target win32-x64`                     | 0     | `npm run package` itself stops at the build's budgets                                                                                                                                                                           |
| `dotnet test` on `Test/`                                               | 0     | 26 of 26                                                                                                                                                                                                                        |
| `dotnet format whitespace --verify-no-changes`                         | 0     |                                                                                                                                                                                                                                 |
| `listing.test.mjs`                                                     | 0     | 7 of 7                                                                                                                                                                                                                          |
| `npm run security:sast`                                                | **1** | 693 rules, 16 findings in 13 files, **none in a file this lane touched**. The base's review recorded 6 on its rig; the other ten here are 9 `detect-child-process` and 1 `remote-property`, not examined                        |
| `npm run security:audit`                                               | **1** | The base's: high `GHSA-mrwp-f3q8-3g9p` in `follow-redirects`, no fixed version. This lane changed no npm dependency. An exception is a reviewed, dated decision and was not added                                               |
| `vitest related` on this lane's sources, `--maxWorkers=4`              | 0     | 6 of 6 (`conformanceDrivers`); vault and credential-store suites excluded                                                                                                                                                       |
| `vsixTargets`, `packagedBundles`, `--maxWorkers=4`                     | 0     | 24 of 24                                                                                                                                                                                                                        |
| `vscode-test --grep M104g`, minimum and stable                         | 0, 0  | 9 of 9 each, after the last code change                                                                                                                                                                                         |
| `node test/hostApi/run.mjs visualstudio`, through the matrix generator | 0     | 13 of 13, 9 waiting, after the last code change                                                                                                                                                                                 |

No full unit run: the owner's PC stays light and hosted CI is the gate for merges. No
real-life run through the packed product either: it would need model calls no leg here needs.
