# Muse Spark Code (Unofficial) for Visual Studio

This is the M104c in-process VSSDK host for Visual Studio 2022 and 2026.
It targets .NET Framework 4.8 and embeds the shared React bundle in WPF
WebView2. The status is **Prototype, qualification pending**.

The frozen host-services contract is
[`mhp-v1.schema.json`](../../src/shared/hostApi/mhp-v1.schema.json), consumed
directly by the C# validator. The plugin launches the bundled runtime as
`panel --stdio --host visual-studio`; it does not collect or store API keys.
Use the runtime's `auth set` command in your own terminal for key entry.

The React relay is not specified by that frozen export. Integration must
provide `IPanelChannelFactory` through the Visual Studio component model,
with the runtime's authored relay and both zod message parsers. The extension
reports `MHP_PANEL_CHANNEL_UNDEFINED` while that provider is absent. This is
an explicit integration boundary, not a production fake or a guessed wire
method. See [the certification](../../docs/certification/m104-f.md).

The headless suite runs on Windows with the .NET SDK and .NET Framework 4.8:

```powershell
dotnet test hosts/visualstudio/Test/MuseSpark.VisualStudio.Test.csproj
```

It exercises the actual MHP peer, exported-schema validator, edit planner and
asset/environment policy against fakes. Native editing, undo, rendering,
diagnostics and Tab qualification require a Visual Studio experimental
instance. The feature table in the certification names their follow-ups.
