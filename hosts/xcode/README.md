# Muse Spark for Xcode (Unofficial)

A macOS 14+ SwiftUI companion app with a WKWebView and an embedded Xcode
Source Editor Extension. This is a native-host prototype awaiting M104's
runtime panel/UI/Tab integration. It is not a supported Xcode release.
There are no model calls in its tests.

Build and package on a Mac with the accepted Xcode license:

```sh
bash hosts/xcode/Scripts/build.sh
```

The zip is `temp/m104x/Muse-Spark-for-Xcode.zip`. Build products and generated
resources remain untracked. The build uses Xcode's selected personal team
when its public selected-team preference is available, or local ad-hoc signing.
An explicit team can be supplied with `--team TEAM_ID`. The script never
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

The runtime must implement lane H's `panel --companion` convention: stdout
starts with one loopback launch-link line from `startCompanionServer.launchUrl()`.
The current base's CLI does not implement `panel`. An older runtime therefore
fails visibly instead of showing a fake conversation. Its launch-link fragment
is consumed by the shared companion bootstrap; the bearer stays in that page's
fetch closure. WKWebView uses an ephemeral data store, blocks navigation to other
origins, and requires a fresh runtime launch after Stop/reopen. Runtime output
and stderr are never logged or stored by the app. Stop in the menu bar, app
menu, toolbar, or Cmd+. terminates the whole runtime process group independently
of the panel or an approval. Closing the app also stops the runtime.

The Xcode Editor menu offers:

| Command                  | Behavior                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ask Muse about selection | Opens selection context in the app; enter the question and send it through the companion.                                                                                                                                |
| Explain selection        | Prepares the shared English explanation prompt; send it through the companion.                                                                                                                                           |
| Fix selection            | Prepares a replacement-only prompt. Copy the proposed code from the panel, paste it into the app's replacement editor, and explicitly approve. Only the original selection changes, in one XcodeKit command transaction. |
| Insert Tab completion    | Refuses explicitly until the shared Tab endpoint and budget protocol land. It never substitutes another model request.                                                                                                   |
| Open panel               | Opens/focuses the companion app; select a workspace if none is open.                                                                                                                                                     |

Ask/Explain/Fix dispatch requires the runtime to admit the repository's existing
`sendMessage` payload at `/post`; MHP wrapping remains an integration decision
for lanes B/D. The native host does not define another controller protocol.
No production model result or runtime launch receipt is claimed here.

XcodeKit does not disclose the current file URL or workspace, expose a panel,
observe background editor changes, or implement a completion provider. The app
therefore asks for the workspace, receives a command's single selection and
buffer snapshot, and opens files with `xed` through **Open in Xcode**. Native
`openInXcode(file,line:)` accepts workspace files only, including symlink checks.
The companion/MHP file-opening route still needs integration. Multiple selections,
invalid UTF-16 positions, stale buffers/selections, denied edits, and late/cancelled
commands cannot apply a replacement.

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

This runs all core XCTest cases and app-hosted UI tests against the actual
companion server with a fake runtime. The UI test checks authenticated rendering
and the real Stop menu action. The `NativeCore` Xcode scheme runs the complete
core suite independently for regression drills. A separate ad-hoc XCUITest runner
was attempted and failed its library signature check; no test is skipped in the
final scheme and no product entitlement is widened. Receipts, limitations and
feature parity are in [the certification record](../../docs/certification/m104-h.md).
Apple feedback text is in [apple-feedback.md](apple-feedback.md).
