# Muse Spark Code (Unofficial) for JetBrains

This plugin embeds the repository's shared React panel in JCEF and implements
the frozen MHP 1.1 host contract. It declares IntelliJ Platform 2025.3–2026.2,
JDK 21 for development, and the `muse-spark-code-acp` executable on PATH. The
runtime is developed separately in M104 lane B. No credential is accepted by
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
Native theme values cover every token consumed by the current shared CSS,
with `--muse-` aliases for the forthcoming shared bridge. Commands, status
widgets and progress indicators are scoped to the project and disposed with it.

Native document reads use open buffers. Edits require workspace trust, a
matching document version, a clean writable buffer and non-overlapping UTF-16
ranges, and run in one undo command. All child environments remove credential
variables. Runtime stderr is drained without copying its contents into logs.
The shared browser entries are bundled from the built React assets and loaded
through JCEF's public HTML loader. Scripts use a nonce; CSS stays inline;
network connections, remote assets, ordinary file navigation, popups and
developer tools are refused. This avoids the stalled native resource/network
loading path found on the qualification rig.

The plugin advertises only implemented native capability groups. Other groups
use the fallbacks declared in the frozen contract, including runtime settings
and storage, the React diff and terminal pages, and LSP code intelligence.

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
The owner signals process handles with a two-second stop deadline, terminates
containment and bounds worker joins. POSIX launches establish a process group
through the system Perl/POSIX launcher; Windows assigns a gated command launcher
to a kill-on-close job before releasing it to start the runtime. A parent exit
also fails the connection, even when its worker keeps stdout open. Containment
retains workers after parent-first exit; a missing launcher or failed job
assignment refuses startup. Transport failure removes native commands, widgets,
panels and Tab bindings. Reconnect creates a new epoch, and closed-epoch work,
surface callbacks and replies cannot target the replacement. Runtime failure
text is validated and replaced with fixed words before it can reach Tab's
platform error logger.
Only insertion ranges at the unchanged caret are offered. Other replacements
are rejected rather than applied to the wrong buffer.

JCEF absence, construction failure or the readiness deadline selects
`panel --companion`; the runtime opens its fresh launch URL through the frozen
`ui/openExternal` method and the IDE's browser. The tool window retains visible
status. The real companion/controller implementation is not present at this
branch's base, so its assembled qualification remains an integration item.

A runtime offering `hostMetadata` and a range containing `mhp/1.2.0` receives
IDE identity/version, locale, theme tokens, workspace folders and trust in
`initialize.result.hostMetadata`. Other peers receive the exact legacy 1.1
result. Metadata collection runs outside the actor with a two-second deadline; failure
tears down the entire connection attempt and displays a failure. Shutdown
cancels initialization and late metadata cannot reopen it. Wire coordinates
are checked before integer narrowing, so oversized positions cannot wrap into
valid edits.
The native resource build measures the shipped inline main script against
950 KiB (the unchanged shared startup 900 KiB plus deferred 50 KiB), and
What's New against its existing 25 KiB. The shared startup gate still applies.
This local proposal is specified in PLAN D84; the frozen shipped 1.1
schema and other hosts are unchanged.

This is a development artifact, not a usable or supported Marketplace release. The
qualification evidence, F1–F56 coverage and outstanding integration work are
in [the follow-up certification](../../docs/certification/m104-e3.md) and
[the lifecycle redesign record](../../docs/certification/m104-e-redesign.md). Distribution,
signing, the all-IDE verifier matrix and end-to-end runtime qualification are
owned by lanes I and J.
