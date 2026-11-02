# Muse Spark Code (Unofficial) for Visual Studio

This is the M104c in-process VSSDK host for Visual Studio 2022 and 2026.
It targets .NET Framework 4.8 and shows the shared React panel in WPF WebView2.
The status is **Prototype**: see the
[editor matrix](../../docs/ide-compatibility/matrix.md) and the
[receipt](../../docs/certification/m104-visualstudio.md) for what has run.

The reviewed MHP 1.6 contract is
[`mhp-v1.1.schema.json`](../../src/shared/hostApi/mhp-v1.1.schema.json), consumed
directly by the C# validator (the filename is retained from the replaced contract).
The editor starts the handshake with its installed version, display language,
theme, solution folder, trust and implemented capability groups, and refuses a
range that does not hold `mhp/1.6.0` (`MHP_INCOMPATIBLE_VERSION`). A request the
runtime sends is served on what this host offered; a request to the runtime needs
what the runtime named in its answer. Offered: lifecycle, documents, editor,
diagnostics, ui, surfaces, commands, tab, window. A method of an offered group
with no native route answers `MHP_UNSUPPORTED_CAPABILITY`. Solution trust starts
false; a native trust adapter (and with it the `workspace` group) is still owed.

Once the handshake is answered the runtime opens its chat through
`surfaces/open`. Each surface is one `PanelChannel` behind one WebView2 page:
`window.museHost` is installed before page scripts, envelopes are validated
against the frozen vocabulary of the surface's kind, sequences are independent per
direction, and a frame that breaks one channel's protocol closes only that channel
with its frozen `panelError` code, logged by identifier; the session keeps
reading. Documents are matched by the file the system resolves (file index or
final path), so `\\?\`, 8.3, junction and other-drive spellings of an open file
reuse its buffer. Browser data and the scratch folder live in the running hive's
local folder, so an experimental instance never shares them with the person's own.
What's New and the other presentation surfaces are refused by name
(`MHP_AUXILIARY_RENDER_UNAVAILABLE`) until they have a native page.

Install Node 22 or later and the ACP npm package in the usual global npm
location, with their directories on PATH. The extension discovers an installed
`node.exe`, checks its version without a shell or credential environment,
then locates `muse-spark-code-acp/dist/acp.js` and launches `panel --stdio`
through the job helper, so the runtime's whole process tree ends with the window.
An assembled ACP package can also be placed at `assets/runtime/package`.
The package must carry the `panel` command at this MHP version; an older ACP
release cannot serve it. Missing inputs produce `MHP_NODE_22_REQUIRED`,
`MHP_ACP_PANEL_PACKAGE_REQUIRED` or `MHP_JOB_HELPER_NOT_INSTALLED` in the
localized startup error. No Node download is attempted. The plugin never
collects or stores API keys.

Build from the repository root on Windows with Visual Studio 2022 and the .NET
SDK. The VSSDK build tools come from NuGet (`Microsoft.VSSDK.BuildTools`), so the
extension-development workload is not needed to build or to test here:

```powershell
node scripts/build.mjs --production
& 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe' hosts/visualstudio/MuseSpark.VisualStudio.csproj /t:Restore /p:Configuration=Release /v:minimal
node hosts/visualstudio/build-assets.mjs
& 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe' hosts/visualstudio/MuseSpark.VisualStudio.csproj /p:Configuration=Release /v:minimal
dotnet test hosts/visualstudio/Test/MuseSpark.VisualStudio.Test.csproj
node --test hosts/visualstudio/Test/listing.test.mjs
```

The package is `bin/Release/net48/MuseSpark.VisualStudio.vsix`. It includes the
shared React bundle, all 15 language tables and localized entry pages, both
schemas, the native job helper and dependency notices. SDK and WebView2 references
are pinned; package caches remain under the repository's ignored `temp` directory.
Browser binaries are supplied by the installed WebView2 runtime; this build does
not download Node or a browser.

The View → Other Windows menu contains Muse Spark Code (Unofficial).
Automatic completion follows `tab/register`; Ctrl+Space invokes it when enabled,
Tab accepts visible ghost text and Esc dismisses it. Acceptance checks the captured
snapshot and caret, and uses one native undo transaction. Agent edits refuse dirty
or changed buffers before opening a transaction.

## Tests

`Test/` runs on the real peer, channel, planners, writer and validator over the
exported schema, without an editor. `RuntimeProcessTests` starts this tree's
`dist/acp.js panel --stdio` through the shipped job helper, shakes hands, round-trips
a setting on a scratch home and proves the whole process tree ends with the host.
It needs the production build and `build-assets.mjs` first.

`Conformance/` holds the MHP conformance cases: `[IdeFact]` tests
(`Microsoft.VisualStudio.Extensibility.Testing.Xunit`, pinned; upstream archived it
and moved the code into dotnet/roslyn, so hosted-runner reliability is unmeasured).
They install the VSIX into an experimental instance under the root suffix
`MuseConf`, open the panel through the real command, wait for the real page's
handshake with the real runtime, and drive `test/hostApi/scenarios/contract.json`
through the production `VisualStudioHost`. Run them with
`node test/hostApi/run.mjs visualstudio`, which refuses while a Visual Studio
window or a named debugger is open: the harness installs with `VSIXInstaller
/shutdownprocesses` and ends `VsJITDebugger`, `DbgCLR` and `dexplore` by name. On a
failure the harness writes a desktop screenshot; `conformance.ps1` keeps its log
folder under the ignored `temp/` and removes every picture after the run.

## Marketplace listing

The manifest (`source.extension.vsixmanifest`) carries the listing fields:
`DisplayName`, a `Description` of what the extension does (it names no build
label or protocol version), `MoreInfo` (the repository URL), `License`
(`assets\LICENSE.txt`, written by `build-assets.mjs`), `ReleaseNotes` (the
changelog URL), `Icon` and `PreviewImage` (`icon.png`), and `Tags`. The icon is the
product's own mark, linked from `media/icon.png` (128 by 128 px) by the project
file; no image file was added to the repository. The ARM64 installation target
was removed on 2026-10-11 because no Windows ARM64 machine exists to qualify it; it
returns with one. A 200 by 200 px preview image (the schema's recommended size
for `<PreviewImage>`) is still owed, rendered from `media/marketplace-icon.svg` by
a lane that can run `scripts/render-images.mjs` (it needs Chrome). Nothing is
uploaded before an installed run in Visual Studio passes. The marketplace account
and its upload are the owner's.
