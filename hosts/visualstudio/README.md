# Muse Spark Code (Unofficial) for Visual Studio

This is the M104c in-process VSSDK host for Visual Studio 2022 and 2026.
It targets .NET Framework 4.8 and embeds the shared React bundle in WPF
WebView2. The status is **Prototype, qualification pending**.

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
edit/completion planners, message inbox and asset/environment policy. A fake
runtime runs through the production Windows job helper and creates a real
descendant; shutdown must terminate both. It negotiates 1.1 and exchanges panel
and lifecycle frames through the actual process transport. Browser tests cover
the injected API, JSON state, listener removal, reload, vocabulary isolation,
ordering and transport budgets. Tests inspect the built VSIX and its
localized pages. All fakes are confined to `Test/`.

Native editing and undo, ghost text, Error List integration, rendering,
accessibility and reload qualification require a VS experimental instance.
The declared VS 17/18 and x64/arm64 range is build metadata, not a qualification
claim. The certification lists all F1–F56 statuses and their follow-ups. The
prototype must not be published as Supported before those receipts exist.
