# Muse Spark Code (Unofficial) for Eclipse

Lane G's native host for the frozen MHP 1.1 panel carrier. The plugin owns
SWT containers and editor services; the shared runtime owns the conversation,
providers, permissions, paid consent and daily ledger. Authentication stays in
the runtime OS credential store, through `auth set` in the user's terminal.

The p2 site is built against Eclipse 2025-12 (4.38). Eclipse 2026-03 (4.39)
is the second qualification target. Espressif-IDE, STM32CubeIDE and MCUXpresso
use the same plugin and require Java 21. Their individual product receipts,
Windows and macOS receipts, signing, Node fragments and runtime packaging
are tracked in the lane certification; they are not inferred from the Linux
platform tests.

Install the built p2 site through Help > Install New Software. Open the Muse
view from Window > Show View, or use its Window-menu command. The completion
command is bound to Alt+backslash; Tab accepts a displayed suggestion, and
Escape rejects it. Trust starts off and is granted by the user's Window-menu
command after the localized warning. Opening a folder imports it as an Eclipse
project (creating `.project` if absent), and optionally opens a workbench window.

The launch interface targets an installed `muse-spark-code-acp panel --stdio`.
The frozen export declares runtime-to-host initialization: the plugin waits
for that request and returns the selected version and supported capabilities.
The native host collects product version, installed language, theme, folders
and trust for the exact MHP 1.2 `hostContext` proposal in PLAN D84. Frozen
1.1 has no field for that handoff. An absolute
`MUSE_SPARK_RUNTIME` executable path overrides PATH discovery. There is no
automatic installation or download. Credential variables are removed before
launch. Release lane I supplies the installed runtime and platform Node
fragments; lane B supplies panel mode and lane D the embedded UI bridge.

Windows explicitly requests `SWT.EDGE` and refuses an Internet Explorer
fallback. Linux and macOS explicitly request `SWT.WEBKIT`. On Linux,
WebKitGTK is required. There is no local HTTP server: assets are extracted
from the installed bundle into its state directory. Navigation is limited to
the exact panel document, popups and context menus are blocked, and the CSP
allows only bundled file assets, nonce scripts and SWT's private native bridge.

Java 21, Apache Maven 3.9.11, Node with this repository's installed build
packages, Xvfb and WebKitGTK are used on kubuntu. The rig's distro Maven
3.9.12 hit the Tycho injection failure documented upstream; the verified
Apache distribution works. With Apache Maven on PATH, from `hosts/eclipse`:

```sh
xvfb-run -a mvn -B verify
xvfb-run -a mvn -B verify -Declipse.release=2026-03
```

First run the repository's documented `npm run build` from the repository
root. Maven's resource preparation then embeds `dist/webview`, the frozen
JSON Schema, the existing English table and every real translation. It also
extracts native tunables and credential names from shared constants. No npm
dependency or shared source file is changed. Gson is supplied by Eclipse's
pinned target; the manifest requires 2.11 or later for strict parsing. Tycho 5.0.4, the Maven execution plugin and Checkstyle plugin
versions are pinned in the POMs.

`verify` includes Checkstyle, the asset-freshness regression test and all native
JUnit tests through Tycho's UI harness. Tests use a private authored fake runtime; they never invoke a model
or charge an account. The update site and its ZIP are under
`repository/target/`. Native `surfaces` is unadvertised in frozen 1.1. The
capability-checked MHP 1.2 `surfaceHtml` port implements the Eclipse side of
the proposed What's New renderer: bounded complete HTML, one approved local
script, the native nonce CSP, per-binding click indices, fresh rendering on
reload and rejection of stale/disposed replies. B/D and lane 0 must approve
and connect that port before it is offered on the wire. Auxiliary pages use
the declared companion-tabs fallback after B/C integration.

The source is not a supported full product until the
shared lanes are integrated and every feature in the certification is qualified.

Review repairs cover bounded shutdown even for an unreading runtime, forced
cleanup of captured descendants, owner cleanup after transport loss and
bounded late cancellation replies. Completions use standard language IDs and
full-document offsets in folded/restricted views. Recursive includes/excludes
cover project-root files; admitted panel deliveries retain their reservation
across reload and resume on ready. Asset bootstraps support apostrophes in
state/workspace paths. The native singleton API adapter also boots the shipped
chat and Tasks bundles and forwards their message events; both are exercised
in real WebKit. Saved text containing bootstrap substitution names is retained
literally. See the FIXM104G tests and red drills in
`../../docs/certification/m104-g.md`.
