# Muse Spark for Xcode (Unofficial)

A macOS 14+ SwiftUI companion app with a WKWebView and an embedded Xcode
Source Editor Extension. This is a native-host prototype awaiting M104's
complete runtime feature/editor-service/Tab qualification. Its owning relay
now adopts the reviewed MHP 1.5 contract. It is not a supported Xcode release.
There are no model calls in its tests.

Build and package on a Mac with the accepted Xcode license:

```sh
bash hosts/xcode/Scripts/build.sh
```

The zip is `temp/m104x/Muse-Spark-for-Xcode.zip`. Build products and generated
resources remain untracked. The default build uses local ad-hoc signing and
does not select an account or provision implicitly. An explicit development
team can be supplied with `--team TEAM_ID`. The script never
accepts a license or terms. Personal-team/local signing is not notarized
Developer ID distribution.

Unzip, move **Muse Spark for Xcode.app** into `/Applications`, and open it once.
Then enable **Muse Spark** in System Settings → Privacy & Security → Extensions
→ Xcode Source Editor. The owner must make that enablement click. Xcode may
need to restart before its Editor menu lists the commands. Ad-hoc builds must
still be installation-qualified on the owner's Mac; compilation alone does
not prove Xcode will accept an extension's signature.

Choose the installed `muse-spark-code-acp` executable and a workspace folder,
`.xcodeproj`, or `.xcworkspace`. Project/workspace bundles resolve to their
containing folder. The executable is found on PATH, `/opt/homebrew/bin`,
`/usr/local/bin`, or `~/.local/bin`, or chosen explicitly. Nothing is downloaded
or installed automatically. Optional launch arguments are `--runtime <path>`
and `--workspace <path>`; equivalent startup variables are
`MUSE_XCODE_RUNTIME` and `MUSE_XCODE_WORKSPACE`. Credentials are never startup
arguments or variables for this app.

The app spawns `panel --companion` in the selected workspace with private
stdin/stdout pipes. The editor initiates MHP 1.5 with the app's product version,
installed language, current light/dark/increased-contrast appearance, workspace folder and explicit
trust state. Only a validated, correlated `ui/openExternal` request supplies the
one-use loopback launch link. Older versions and raw-URL launchers fail visibly.
The app validates native traffic against the reviewed schema snapshot generated
from `src/shared/hostApi/mhp-v1.1.schema.json`; that legacy filename carries 1.5
and includes both editor and panel channels. Invalid requests receive the frozen
error code; panel faults affect their channel and preserve the owning companion
relay. Request IDs retain a bounded completed window while pending IDs cannot
be evicted. Malformed transport and incompatible initialization still end the
connection.

The authenticated portable browser renderer and UI bridge are implemented.
WKWebView uses an ephemeral data store, confines navigation to the current
origin, and consumes its launch fragment into the shared bootstrap's private
fetch closure. New/fork/switch/trust transitions may open fresh links on the
same origin; every link gets a fresh native generation and reload. Runtime
output and stderr are never logged or stored by the app. Stop in the menu bar,
app menu, toolbar, or Cmd+. terminates the runtime process group independently
of the panel or a permission dialog. Closing the app also stops the runtime.

The native relay advertises lifecycle, UI and window services. Notifications,
clipboard, external HTTPS/HTTP links, status/progress and attention are native;
confirm/pick/input and file selection/export use cancellable AppKit sheets.
The reviewed `ui/openFile` returns the user's actual selected file URI;
`ui/saveText` exports the supplied report text atomically only after Save.
Deny/cancellation, write failure and stale dialog callbacks never report a
successful export. File and permission sheets share one admission slot. A
write already admitted to the filesystem cannot be undone by a later Stop. Paid choices return the
runtime's opaque ids once: the runtime owns price, consent persistence and the
hard daily ledger. Cancellation or Stop dismisses the sheet and rejects late
answers. A status item requiring an unimplemented command refuses explicitly.
The new `ui/showSetting` still refuses pending the shared settings-view
contract; complete UI-group qualification remains open. Other capability
groups are omitted until their complete adapters qualify.
The companion's paid popup still uses the shared browser UI, without a second
native consent prompt.

Trust starts off and applies only to the selected workspace. The native Trust
control confirms the existing project-rules/hooks/MCP warning before granting
it, sends a validated `workspace/didChangeTrust` notification when connected,
and can revoke it. Choosing another workspace clears the grant. Signing in
separately never grants workspace trust.

The Xcode Editor menu offers:

| Command                  | Behavior                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ask Muse About Selection | Opens selection context in the app; enter the question and send it through the companion.                                                                                                                                |
| Explain Selection        | Prepares the shared English explanation prompt; send it through the companion.                                                                                                                                           |
| Fix Selection            | Prepares a replacement-only prompt. Copy the proposed code from the panel, paste it into the app's replacement editor, and explicitly approve. Only the original selection changes, in one XcodeKit command transaction. |
| Insert Tab Completion    | Refuses explicitly until the shared Tab endpoint and budget protocol land. It never substitutes another model request.                                                                                                   |
| Open Panel               | Opens/focuses the companion app; select a workspace if none is open.                                                                                                                                                     |

Ask/Explain/Fix sends the existing shared `sendMessage` through the portable
page's `window.musePanel.postMessage` bridge, which wraps and authenticates it
for `/panel/message`. The native app defines no second conversation protocol.
Current app-hosted receipts use a fake runtime; they do not qualify all shared
features or either production model backend.

XcodeKit does not disclose the current file URL or workspace, expose a panel,
observe background editor changes, or implement a completion provider. The app
therefore asks for the workspace, receives a command's single selection and
buffer snapshot, and opens files with `xed` through **Open in Xcode**. Native
`openInXcode(file,line:)` accepts workspace files only, including symlink checks.
The companion/MHP file-opening route still needs integration. Multiple selections,
invalid UTF-16 positions, stale buffers/selections, denied edits, and late/cancelled
commands cannot apply a replacement.

Command listener startup is single-use. Cancellation before queued startup and
closing a command client before its exchange return cancellation without opening
another owner. The command's cancellation token also fences the queued app
launch and the actual buffer write. Approved writes recheck the command digest
and selection, then commit once; cancellation cannot undo a write already
admitted. Native focus state requires the bound window to be key while the app
is active. File navigation passes a canonical regular workspace file to xed;
directories, nonlocal/credential-bearing URLs, escapes and invalid lines refuse.
Every xed process stays owned until termination; a launch error or nonzero exit
shows the translated file-open failure. Stop terminates pending navigation and
keeps tracking it until the process is reaped; retired callbacks cannot report
into a replacement session. Malformed remote panel errors on unbound stdio
channels are dropped without cancelling unrelated native requests.
These have core component receipts; actual Xcode commands, undo, focus and
permission interaction still need the owner at the console.

The extension starts an ephemeral **127.0.0.1-only** callback listener for each
invocation. It sends a one-use launch code in the app URL fragment. The app
exchanges that code for an invocation-specific memory bearer before receiving
context. The listener accepts exactly one authenticated reply, bounds frames and
connections, expires unexchanged links after 15 seconds, and expires the command
after 180 seconds. Xcode cancellation closes the channel. No token file,
app-group entitlement, cookie, clipboard credential, UserDefaults entry, or
unauthenticated privileged local port is used. Same-user process inspection and
URL-scheme registration are outside the boundary; neither a launch URL nor a
bearer should be copied into a log or issue.

All native labels come from the English table and all 14 translations. Native
limits and credential exclusions are generated from `src/shared/constants.ts`;
model prompts are from the native-only `XCODE_MODEL_TEXT` block. The app never
opens the OS credential store; inherited credential variables are removed
before it starts the runtime or xed. Sign in with the runtime's existing
OS-store/CLI commands separately. This does not guarantee memory zeroization
or hide a process's initial environment from the same operating-system user.

Run the complete native suite:

```sh
bash hosts/xcode/Scripts/test.sh
```

For a console-free core regression run (no app/UI automation or privacy prompt):

```sh
node hosts/xcode/Scripts/generate.mjs
node hosts/xcode/Scripts/prepare-tests.mjs
xcodebuild -project hosts/xcode/MuseSpark.xcodeproj -scheme NativeCore -configuration Debug -derivedDataPath temp/m104pf5/DerivedData -destination 'platform=macOS' test CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=NO
node test/m104/mac/nativeDrills.mjs --pf5
```

Compile the app, extension and their test bundles without running UI tests:

```sh
xcodebuild -project hosts/xcode/MuseSpark.xcodeproj -scheme MuseSpark -configuration Debug -derivedDataPath temp/m104pf5/DerivedData -destination 'platform=macOS' build-for-testing CODE_SIGNING_ALLOWED=NO
```

The drill runs the complete core scheme after each deliberate mutation and
restores source bytes exactly. App/UI scenarios still need the owner at the
console before they can supply installation or interaction receipts.

This runs all core XCTest cases and app-hosted UI tests against the actual
companion server with a fake runtime. The UI test checks authenticated rendering
and the real Stop menu action. The `NativeCore` Xcode scheme runs the complete
core suite independently for regression drills. A separate ad-hoc XCUITest runner
was attempted and failed its library signature check; no test is skipped in the
final scheme and no product entitlement is widened. Receipts, limitations and
feature parity are in [the parity certification record](../../docs/certification/m104-pf.md).
Apple feedback text is in [apple-feedback.md](apple-feedback.md).

[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)
