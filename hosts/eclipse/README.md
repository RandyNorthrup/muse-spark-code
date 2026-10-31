# Muse Spark Code (Unofficial) for Eclipse

The native host for the frozen MHP 1.5 panel carrier. The plugin owns
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
view with its Window-menu command: it activates the runtime's owned surface,
or starts the runtime so its initial surface opens. A view opened directly
from Window > Show View carries no runtime session and shows the start-failure
page instead of a dead panel. The Window-menu Open command replaces that
unbound page with the runtime's owned view. The completion
command is bound to Alt+backslash; Tab accepts a displayed suggestion, and
Escape rejects it. Trust starts off and is granted by the user's Window-menu
command after the localized warning. Opening a folder imports it as an Eclipse
project (creating `.project` if absent), and optionally opens a workbench window.

The launch interface targets an installed `muse-spark-code-acp panel --stdio`.
The editor initiates initialization with product version, installed language,
theme, folders, trust and its supported editor services. The first folder is
the exact runtime working directory. The runtime replies with its independently
supported services; legacy 1.1/1.2 selections are refused. There is no
automatic installation or download. Credential variables are removed before
launch. Discovery uses only absolute PATH directories and resolves regular,
executable files before launch, with `panel` and `--stdio` as separate arguments.

On Windows, discovery accepts a native `muse-spark-code-acp.exe` or npm's
`muse-spark-code-acp.cmd` in the global prefix. The shim is resolved to
`node.exe` and `<prefix>/node_modules/muse-spark-code-acp/dist/acp.js`; the
shim's contents are never read or executed. Node must be a regular executable
beside the shim or in an absolute PATH directory. The script and package.json
must resolve inside that package, and package.json must name
`muse-spark-code-acp`. Discovery requires the package at its expected path
under the canonical shim prefix, with no symbolic link or junction from that
prefix through the package's `dist` directory. A missing, relocated or spoofed
layout refuses before launch.

`MUSE_SPARK_RUNTIME` overrides discovery with an absolute native executable
or npm shim path. It also accepts a strict JSON array of exactly two absolute
paths, Node followed by the installed ACP script; for example,
`["C:/Program Files/nodejs/node.exe","C:/Users/you/AppData/Roaming/npm/node_modules/muse-spark-code-acp/dist/acp.js"]`.
Forward slashes avoid JSON backslash escaping on Windows. The same pair form
works on Linux/macOS with the native `node` executable. The explicit pair
keeps canonical package resolution, including linked package ancestors;
script/package identity checks still apply, and the host appends `panel`,
`--stdio`. Command strings,
extra arguments and arbitrary batch files are refused; no shell is started.
Release lane I supplies the installed runtime and platform Node fragments;
lane B supplies panel mode and lane D the embedded UI bridge.

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
`repository/target/`. Native chat and Tasks surfaces are advertised. Native
confirmation, input, selection, clipboard, external browsing, notifications,
status and progress are window-owned. Confirmation returns the exact opaque
choice ID; cancellation and window retirement close dialogs and refuse consent.
Dynamic native commands are window-scoped and removed on teardown; suggested
keybindings currently return an explicit unavailable failure.
File open/save uses the absolute path returned by SWT's dialog. Settled
diagnostics wait for prior workspace analysis and a build of the saved bytes;
pending analysis stays unchecked while the runtime polls within its settle
budget. Runtime-setting shortcuts explicitly report unavailable because
Eclipse's preferences do not expose those keys; the runtime displays the
failed action to the user.
Runtime surface closure and window teardown dispose native browsers. Auxiliary
kinds without the A/C asset/binding adapter return an explicit unavailable
failure before creating a view.

The retained `surfaceHtml` seam implements the Eclipse side of the rejected
What's New proposal: bounded complete HTML, one approved local
script, the native nonce CSP, per-binding click indices, fresh rendering on
reload and rejection of stale/disposed replies. It is unconnected and is not
offered on the wire. A/C must supply the frozen auxiliary asset/binding contract.

The source is not a supported full product until the
shared lanes are integrated and every feature in the certification is qualified.
See [the parity checkpoint](../../docs/certification/m104-pe.md) for current
receipts and named gaps.

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

## Update site and Marketplace listing

The installable feature id is `io.musespark.eclipse.feature`
(source: `hosts/eclipse/feature/feature.xml`); the plugin id inside it is
`io.musespark.eclipse`. The build targets Eclipse 2025-12 (4.38), set as
`eclipse.release` in `hosts/eclipse/pom.xml`, with Eclipse 2026-03 (4.39)
as the second qualification target. The build produces three platforms,
read from the `<environments>` of `target-platform-configuration` in
`hosts/eclipse/pom.xml`: Linux on 64-bit Intel/AMD, Windows on 64-bit
Intel/AMD, and macOS on Apple silicon. That means macOS on Intel and
Linux on ARM are NOT built. The plugin requires Java 21
(`Bundle-RequiredExecutionEnvironment: JavaSE-21` in
`hosts/eclipse/plugin/META-INF/MANIFEST.MF`). The licence is MIT: the
full text of the repository's root `LICENSE` file is embedded in the
`<license>` element of `hosts/eclipse/feature/feature.xml`, and Eclipse
shows it in the install dialog with Accept/Reject before anything is
installed. The update site's public address is not decided yet; the lead
and the owner decide where the p2 repository is hosted. Nothing is
listed on the Marketplace before installed runs in Eclipse pass.
