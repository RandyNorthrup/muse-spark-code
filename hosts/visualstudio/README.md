# Muse Spark Code (Unofficial) for Visual Studio

This is the M104c in-process VSSDK host for Visual Studio 2022 and 2026.
It targets .NET Framework 4.8 and embeds the shared React bundle in WPF
WebView2. The status is **Prototype, qualification pending**.

The reviewed MHP 1.2 contract is
[`mhp-v1.1.schema.json`](../../src/shared/hostApi/mhp-v1.1.schema.json), consumed
directly by the C# validator (the filename is retained from the replaced contract).
The editor initiates initialization with its installed version, display language,
theme, solution folder, trust and implemented capability groups. The launcher expects the shared runtime's panel
entry and lane-I verified Node distribution under `assets/runtime`. Those
distribution inputs are not present in this standalone prototype. The plugin
does not collect or store API keys.

The in-process relay uses the export's panel envelopes, immutable surface bindings,
direction checks and independent sequence numbers. WebView2 loads the portable
React entry with the host's initial theme kind and mapped CSS tokens. Its inbox
is bounded by both message count and UTF-8 bytes; responses already in flight
remain valid during reload. Chat and Tasks have native containers; the surfaces capability remains
undeclared until all auxiliary kinds and placements are implemented. The runtime
therefore refuses an assembled native panel at this checkpoint. Solution trust
starts false; native trust transitions still need their adapter. See
[the Windows parity record](../../docs/certification/m104-pd.md).

Build from the repository root on Windows with the VS 2022 extension-development
workload, .NET SDK and .NET Framework 4.8 targeting pack. These commands have
passed on the win11 rig:

```powershell
npm.cmd run build
node hosts/visualstudio/build-assets.mjs
& 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe' hosts/visualstudio/MuseSpark.VisualStudio.csproj /restore /p:Configuration=Release /v:minimal
dotnet test hosts/visualstudio/Test/MuseSpark.VisualStudio.Test.csproj --no-restore
$rigRoot = (Get-Location).Path
$rigSources = @(rg --files "$rigRoot/hosts/visualstudio" -g '*.cs')
dotnet format whitespace "$rigRoot/hosts/visualstudio" --folder --include $rigSources --verify-no-changes
```

The package is `bin/Release/net48/MuseSpark.VisualStudio.vsix`. It includes the
shared React bundle, all 15 language tables and localized entry pages, the
unchanged schema, native job helper and dependency notices. SDK and WebView2
references are pinned; package caches remain under the repository's ignored
`temp` directory. Browser binaries are supplied by the installed WebView2
runtime; this build does not download Node or a browser.

The View → Other Windows menu contains Muse Spark Code (Unofficial). Once the
runtime and panel provider are integrated, automatic completion follows
`tab/register`; Ctrl+Space invokes it when enabled, Tab accepts visible ghost
text and Esc dismisses it. Acceptance checks the captured snapshot and caret,
and uses one native undo transaction. Agent edits refuse dirty or changed
buffers before opening a transaction.

The headless suite exercises the actual MHP peer, exported-schema validator,
edit/completion planners, message inbox and asset/environment policy. A fake
runtime runs through the production Windows job helper and creates a real
descendant; shutdown must terminate both. Tests inspect the built VSIX and its
localized pages. All fakes are confined to test directories.

The Windows namespace also exercises real WPF consent dialogs: the supplied
price/budget and all choices are visible, Deny preserves its opaque ID, there
is no default Allow button, and cancellation closes the dialog. UI services
include input, selection, clipboard, external links, status and progress;
runtime command registration owns removable native key bindings and a menu.
These are component receipts, not installed-editor or paid-ledger qualification.

Native editing and undo, ghost text, Error List integration, rendering,
accessibility and reload qualification require a VS experimental instance.
The declared VS 17/18 and x64/arm64 range is build metadata, not a qualification
claim. The certification lists all F1–F56 statuses and their follow-ups. The
prototype must not be published as Supported before those receipts exist.
