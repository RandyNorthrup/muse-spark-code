# Muse Spark Code (Unofficial) for Visual Studio

This is the M104c in-process VSSDK host for Visual Studio 2022 and 2026.
It targets .NET Framework 4.8 and embeds the shared React bundle in WPF
WebView2. The status is **Prototype, qualification pending**.

The reviewed MHP 1.5 contract is
[`mhp-v1.1.schema.json`](../../src/shared/hostApi/mhp-v1.1.schema.json), consumed
directly by the C# validator (the filename is retained from the replaced contract).
The editor initiates initialization with its installed version, display language,
theme, solution folder, trust and implemented capability groups. The launcher expects the shared runtime's panel
entry and lane-I verified Node distribution under `assets/runtime`. Those
distribution inputs are not present in this standalone prototype. The plugin
does not collect or store API keys.

The in-process relay uses the export's panel envelopes, immutable surface bindings,
direction checks and independent sequence numbers. A frame that breaks one
channel's protocol closes only that channel with its frozen `panelError` code,
logged by identifier; the session keeps reading. Documents are matched by the
file the system resolves (file index or final path), so `\\?\`, 8.3, junction
and other-drive spellings of an open file reuse its buffer. WebView2 loads the portable
React entry with the host's initial theme kind and mapped CSS tokens. Its inbox
is bounded by both message count and UTF-8 bytes; responses already in flight
remain valid during reload. Chat and Tasks have native containers; the surfaces capability remains
undeclared until all auxiliary kinds and placements are implemented. The runtime
therefore refuses an assembled native panel at this checkpoint. Solution trust
starts false; native trust transitions still need their adapter. See
[the Windows parity record](../../docs/certification/m104-pd.md).
The C# validator consumes the unchanged frozen
[`MHP 1.0`](../../src/shared/hostApi/mhp-v1.schema.json) and additive
[`MHP 1.1`](../../src/shared/hostApi/mhp-v1.1.schema.json) exports directly.
The runtime initializes the host; an explicit minor-range offer negotiates
1.1, while a legacy wide offer keeps 1.0. Panel traffic requires 1.1.

WebView2 installs `window.museHost` before page scripts. Its payloads use the
shared zod boundaries, bound opaque surfaces, independent ordered sequences,
bounded stdio writes and opened/ready/reloaded/hidden/closed lifecycle frames.
Saved JSON UI state and sequence counters survive a reload. The reload's state
request is replayed once by the runtime. A compatibility adapter connects the
frozen React entry to the same API until lane D selects its embedded bridge.
No external MEF panel-channel provider is required.

Install Node 22 or later and the ACP npm package in the usual global npm
location, with their directories on PATH. The extension discovers an installed
`node.exe`, checks its version without a shell or credential environment,
then locates `muse-spark-code-acp/dist/acp.js` and launches `panel --stdio`.
An assembled ACP package can also be placed at `assets/runtime/package` by the
distribution lane. The package must include lane B's panel command; the older
ACP release cannot serve it. Missing inputs produce `MHP_NODE_22_REQUIRED`,
`MHP_ACP_PANEL_PACKAGE_REQUIRED` or `MHP_JOB_HELPER_NOT_INSTALLED` in the
localized startup error. No Node download is attempted: the runtime pin
manifest is absent on this baseline, and its consented acquisition remains
**M104c/F/node-pin (I)**. The plugin never collects or stores API keys.
See [the certification](../../docs/certification/m104-f.md).

Build from the repository root on Windows with the VS 2022 extension-development
workload, .NET SDK and .NET Framework 4.8 targeting pack. These commands have
passed on the win11 rig:

```powershell
npm.cmd run build
node hosts/visualstudio/build-assets.mjs
& 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe' hosts/visualstudio/MuseSpark.VisualStudio.csproj /restore /p:Configuration=Release /v:minimal
dotnet test hosts/visualstudio/Test/MuseSpark.VisualStudio.Test.csproj --no-restore
node --test hosts/visualstudio/Test/embedded-bridge.test.mjs
$rigRoot = (Get-Location).Path
$rigSources = @(rg --files "$rigRoot/hosts/visualstudio" -g '*.cs')
dotnet format whitespace "$rigRoot/hosts/visualstudio" --folder --include $rigSources --verify-no-changes
```

The package is `bin/Release/net48/MuseSpark.VisualStudio.vsix`. It includes the
shared React bundle and zod browser bridge, all 15 language tables and localized
entry pages, both unchanged schemas, native job helper and dependency notices. SDK and WebView2
references are pinned; package caches remain under the repository's ignored
`temp` directory. Browser binaries are supplied by the installed WebView2
runtime; this build does not download Node or a browser.

The View → Other Windows menu contains Muse Spark Code (Unofficial). Once the
panel-mode runtime is installed, automatic completion follows
`tab/register`; Ctrl+Space invokes it when enabled, Tab accepts visible ghost
text and Esc dismisses it. Acceptance checks the captured snapshot and caret,
and uses one native undo transaction. Agent edits refuse dirty or changed
buffers before opening a transaction.

The headless suite exercises the actual MHP peer, exported-schema validator,
edit/completion planners, panel channel, bounded writer and asset/environment policy. A fake
runtime runs through the production Windows job helper and creates a real
descendant; shutdown must terminate both. Tests inspect the built VSIX and its
localized pages. All fakes are confined to test directories.

The Windows namespace also exercises real WPF consent dialogs: the supplied
price/budget and all choices are visible, Deny preserves its opaque ID, there
is no default Allow button, and cancellation closes the dialog. UI services
include input, selection, clipboard, external links, status and progress;
runtime command registration owns removable native key bindings and a menu.
These are component receipts, not installed-editor or paid-ledger qualification.

MHP 1.5 also adds fresh version-attested diagnostics, command execution,
file-open/save and settings UI. Their complete native groups remain undeclared
alongside auxiliary surfaces until these new methods are implemented. Existing
Error List, menu and WPF prompt components remain present; the runtime must use
its reviewed fallbacks or return an explicit unavailable result. They do not
qualify the complete 1.3 capability groups.
descendant; shutdown must terminate both. It negotiates 1.1 and exchanges panel
and lifecycle frames through the actual process transport. Browser tests cover
the injected API, JSON state, listener removal, reload, vocabulary isolation,
ordering and transport budgets. Tests inspect the built VSIX and its
localized pages. All fakes are confined to `Test/`.

Native editing and undo, ghost text, Error List integration, rendering,
accessibility and reload qualification require a VS experimental instance.
The declared VS 17/18 and x64 range is build metadata, not a qualification
claim. The certification lists all F1–F56 statuses and their follow-ups. The
prototype must not be published as Supported before those receipts exist.

## Marketplace listing

The manifest (`source.extension.vsixmanifest`) carries the listing fields:
`DisplayName`, a `Description` of what the extension does (it names no build
label or protocol version), `MoreInfo` (the repository URL), `License`
(`LICENSE.txt`), `ReleaseNotes` (the changelog URL), `Icon` and
`PreviewImage` (`icon.png`), and `Tags`. The icon is the product's own mark,
linked from `media/icon.png` (128 by 128 px) by the project file; no image
file was added to the repository. The ARM64 installation target was removed
on 2026-10-11 because no Windows ARM64 machine exists to qualify it; it
returns with one. A 200 by 200 px preview image (the schema's recommended
size for `<PreviewImage>`) is still owed, rendered from
`media/marketplace-icon.svg` by a lane that can run
`scripts/render-images.mjs` (it needs Chrome). Nothing is uploaded before an
installed run in Visual Studio passes.
