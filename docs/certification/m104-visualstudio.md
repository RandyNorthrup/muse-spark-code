# M104g — Visual Studio receipt

Lane CC-M104GW. Base: `rv/hosts2` `4be695f75`. Rig: the owner's Windows PC
(Windows 11 Pro 26200), Visual Studio Community 2022 17.14.25, .NET SDK 10.0.403,
Node 24.20.0, WebView2 156. No pushes, paid calls, live model calls or credential
reads. Date: 2026-11-02.

**Status: waiting — the 13 runnable legs are green, 9 legs wait.**
`node test/hostApi/run.mjs visualstudio` exits 0. It builds the VSIX, packs this
tree's agent, installs both where a person's would go (the VSIX into an
experimental instance under the root suffix `MuseConf`, the agent in a PATH
folder's `node_modules`, found by the product's own locator), opens the panel with
the real View menu command and drives `test/hostApi/scenarios/contract.json`:

- settings over the live pipe to the live runtime;
- dirty-buffer and atomic-edit on real text buffers, with an edit a person types,
  the editor's own undo and per-document 1-based versions;
- diff-hunks through `documents/applyEdits` and `documents/save`, then the node
  driver's revert;
- diagnostics through the Error List's own provider API and `diagnostics/settled`;
- checkpoint through the node driver (Model API only);
- panel-order on the production channel.

Before any leg the suite proves the panel itself: the runtime opened its chat
surface in the tool window, the real WebView2 page shook hands with it and shows
the sign-in state its scratch home really has, its fatal card is absent, and the
page is painted (`MHP_PANEL_FATAL_CARD`, `MHP_PANEL_UNREADABLE` otherwise).
Record: `m104-visualstudio.json`. Plain `dotnet test` on `Test/`: 26 of 26, without
an editor, including this tree's runtime through the job helper.

The waits are the contract's: conversation, approval, session-reload and
tab-completion need live model calls, and checkpoint on Muse Code is refused by
the product. The extension-development workload is not installed and was not
needed: NuGet's `Microsoft.VSSDK.BuildTools` builds the VSIX and an experimental
instance needs no workload. Adding it takes a UAC prompt, which is the owner's.

Visual Studio 2026 is not on this PC, so the manifest's `[17.0,19.0)` range is
proven at 17.14.25 only. Full account, drills and open items:
[`cc-m104gw.md`](cc-m104gw.md); what this does not prove:
`docs/real-life/unproven.md`.
