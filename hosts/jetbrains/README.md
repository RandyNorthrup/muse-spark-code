# Muse Spark Code (Unofficial) for JetBrains

This plugin embeds the repository's shared React panel in JCEF and implements
the frozen MHP 1.5 host contract. It declares IntelliJ Platform 2025.3–2026.2,
JDK 21 for development, and the `muse-spark-code-acp` executable on PATH. The
shared runtime owns conversation, providers and paid admission. No credential is accepted by
the plugin; credentials remain in the runtime's operating-system store.

Build from the repository root:

```sh
npm run build
./hosts/jetbrains/gradlew -p hosts/jetbrains test detekt ktlintCheck buildPlugin --no-daemon
node --test hosts/jetbrains/test/embedded.test.mjs hosts/jetbrains/test/bundle-size.test.mjs
```

The ZIP in `hosts/jetbrains/build/distributions/` contains the shared panel,
the frozen exported schemas, all 15 language tables and generated chat,
Tasks and What's New pages. Install the ZIP through the IDE's plugin installer.
The right-hand Muse Spark Code tool window starts the runtime in the project's
directory. When JCEF is unavailable, the plugin requests the runtime's
companion route instead.

Native surfaces have tool-window, editor-tab and modeless-window placements.
The runtime can close each correlated placement. Auxiliary kinds without a
native asset/binding adapter fail explicitly instead of opening a chat page.
Native theme values cover every token consumed by the current shared CSS,
with `--muse-` aliases for the forthcoming shared bridge. Commands, status
widgets and progress indicators are scoped to the project and disposed with it.

Native document reads use open buffers. Edits require workspace trust, a
matching document version, a clean writable buffer and non-overlapping UTF-16
ranges, and run in one undo command. All child environments remove credential
variables. Runtime stderr is drained without copying its contents into logs.
The shared portable module graph runs through a native asset bridge. The bridge
returns only paths present in the packaged manifest; the browser verifies byte
lengths, SHA-256 and import offsets before executing modules. Static imports share
one cached module instance and dynamic imports remain deferred. Every script
starts from the native nonce with `strict-dynamic`; network connections,
ordinary file navigation, popups and developer tools remain refused.

The plugin advertises only implemented native capability groups. Other groups
use the fallbacks declared in the frozen contract, including runtime settings
and storage, the React diff and terminal pages, and LSP code intelligence.
Runtime-setting shortcuts explicitly report unsupported because the IDE's
generic settings dialog cannot edit those keys; the runtime displays the
failed action to the user. Settled diagnostics attest a version only after its
PSI is committed and the daemon has finished every analysis scope. Replacement
HTML uses the same native bridge, nonce and packaged asset preparation as
initial pages, including What's New actions.

The optional Gradle `privateIdePath` property selects a private copy of the
pinned IDEA 2025.3.3 SDK, avoiding native test writes in Gradle's immutable
cache. `verifyPlugin` rejects every verifier failure category and checks the declared
2025.3.3, 2026.1.5 and 2026.2.3 releases. For an offline run,
`verificationIdePaths` selects installed IDE directories separated by the
platform path separator (`:` on Linux/macOS, `;` on Windows), alongside the
private SDK property. The `nativeUi=true` property runs the real JCEF and paid-dialog checks
under Xvfb. The browser test drives the shared composer, both approval choices and Stop
against a fake stdio runtime. Native Tab uses the platform inline completion
provider: Tab accepts, Escape rejects, and the runtime's empty budget/capability
result creates no suggestion. The runtime owns M94's separate USD 1/day ledger
and model/token/output caps; the plugin makes no provider call or retry.
Cancelling one Tab request sends only its cancellation notification. Its bounded
pending slot stays until the peer's validated result or failure arrives, so a late
reply leaves the shared chat transport alive. A peer that never replies can fill
the existing request bound and receives backpressure until it settles or closes.
A generation-scoped connection actor owns the runtime, protocol and supervised
stream pumps. Host and editor callbacks enqueue bounded messages; a full queue
fails the connection with a visible technical reason. A two-second write
deadline detects a runtime that stops reading stdin. Project disposal marks
the generation closed immediately, cancels its work and requests stream
closure on private workers, so Java's buffered pipe locks cannot stall the IDE.
The owner snapshots descendant handles with their start instants before
signalling, gives the supervising runtime a two-second stop opportunity, then
terminates containment and any remaining verified descendants and bounds worker
joins. A private tracker retains observed descendants while the parent is alive,
including children that start separate POSIX sessions. POSIX launches establish a process group
through the system Perl/POSIX launcher; Windows assigns a gated command launcher
to a kill-on-close job before releasing it to start the runtime. A parent exit
also fails the connection, even when its worker keeps stdout open. The retained identity snapshot reaches observed separate-session workers after
parent-first exit; the process group alone reaches only its own members.
A detached child created and reparented entirely between observations cannot be
discovered afterward; that qualification limit is recorded in the certification.
Containment retains same-group workers after parent-first exit; a missing launcher or failed job
assignment refuses startup. A JVM shutdown hook uses the prepared containment
handle to force termination without stream I/O, and normal cleanup removes it. Transport failure removes native commands, widgets,
panels and Tab bindings. Reconnect creates a new epoch. Each editor request checks its captured native
lifetime and connection owner on the EDT, including the owner's synchronous
closed flag; asynchronous token cancellation is additional cleanup. Native
mutations repeat the check, and document writes check inside the undo command
and before each edit so reentrant retirement also stops further edits. Surface
callbacks and replies retain their originating owner. Runtime failure
text is validated and replaced with fixed words before it can reach Tab's
platform error logger.
Only insertion ranges at the unchanged caret are offered. Other replacements
are rejected rather than applied to the wrong buffer.

JCEF absence, construction failure or the readiness deadline selects
`panel --companion`; the runtime opens its fresh launch URL through the frozen
`ui/openExternal` method and the IDE's browser. The tool window retains visible
status. Assembled native/companion qualification remains an integration item.

The editor initiates `initialize` with identity/version, installed locale,
theme, folders and trust. Only MHP 1.5 is accepted; the rejected `hostMetadata`
proposal and legacy 1.1/1.2 replies are refused. The first folder is the exact runtime
working directory. Metadata collection runs outside the actor with a two-second
deadline; the runtime reply has a separate bounded initialization deadline.
Editor services and runtime services keep independent capability records.
Closing the owner cancels initialization and late metadata cannot reopen it.
The runtime opens the initial surface with its actual session ID.

The native resource build measures the complete static startup graph plus the
native module loader against the existing 950 KiB cap; What's New retains its
25 KiB cap. The shared startup 900 KiB, deferred 50 KiB and complete portable
graph gates remain unchanged. See [the parity checkpoint](../../docs/certification/m104-pe.md)
for current receipts and outstanding F1–F56 qualification.

This is a development artifact, not a usable or supported Marketplace release. The
qualification evidence, F1–F56 coverage and outstanding integration work are
in [the follow-up certification](../../docs/certification/m104-e3.md) and
[the lifecycle redesign record](../../docs/certification/m104-e-redesign.md). Distribution,
signing, the all-IDE verifier matrix and end-to-end runtime qualification are
owned by lanes I and J.

## Marketplace listing

The listing logo `src/main/resources/META-INF/pluginIcon.svg` is generated
from the product's own mark in `media/marketplace-icon.svg` (never redrawn,
never another company's logo). Regenerate it from the repository root with
`node hosts/jetbrains/make-plugin-icon.mjs media/marketplace-icon.svg hosts/jetbrains/src/main/resources/META-INF/pluginIcon.svg`.
The description and change notes live in
`src/main/resources/META-INF/plugin.xml`; the plugin version is read from the
repository's root `package.json` by `build.gradle.kts`.
`test/listing.test.mjs` holds them to the Marketplace approval guidelines:
the logo (1.1), the name (1.2 e/g/h), the description (1.4) and the change
notes (1.5). Nothing is uploaded to the Marketplace before the installed-IDE
runs pass.
