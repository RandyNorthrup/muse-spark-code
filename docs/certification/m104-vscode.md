# M104g — VS Code receipt

Lane CC-M104GW. Base: `rv/hosts2` `4be695f75`. Rig: the owner's Windows PC.
VS Code 1.144.0 (stable, the latest release that day) and 1.99.0 (the
`engines.vscode` floor), both downloaded by `@vscode/test-electron` into the
worktree's ignored `.vscode-test/`, with their own user data and no other
extensions. No pushes, paid calls, live model calls or credential reads. Date:
2026-11-02.

**Status: waiting — the 9 runnable legs are green on both versions, 13 legs wait.**

```sh
npm run build:dev
npx vscode-test --label minimum --grep "M104g"   # 9 passing, exit 0
npx vscode-test --label stable --grep "M104g"    # 9 passing, exit 0
npm run editor-matrix:generate -- --hosts vscode
```

Each run writes `temp/m104-vscode-observations.json`; the last one (stable) is
`m104-vscode.json`'s report. The driver is `test/integration/m104Conformance.test.ts`.

It runs the contract on what VS Code really runs, wired as `src/extension.ts` wires
it: the product's settings reader over real configuration, the edit review on a
real tool write (diff-hunks), the verify loop on VS Code's own diagnostics beside
the built-in JSON server, the window's checkpoint store on a real journal and git
(Model API only), and the shared panel transport's ordering. No session is bound
and no CLI is started: no leg needs one.

**What this tree does not have.** The driver from `rec/rlf-m104gl` drove lane A's
in-process MHP adapter (`src/host/vscode/hostServices.ts`). That adapter was not
ported (`cc-rlm104.md`, remainder 1), because it needs 800 lines of `extension.ts`
rewritten. VS Code here refuses a dirty or stale edit in its own words, with no MHP
code, so dirty-buffer and atomic-edit wait on both backends with that need
(`contract.json`, `hosts: ["vscode"]`). The other nine waits are every host's: live
model calls, and checkpoint on Muse Code, which the product refuses. Porting the
adapter into the test alone would have tested test code.

The earlier macOS note (5 identical Electron stalls in a headless agent session)
does not apply on this PC: Electron runs here. `Error mutex already exists` on the
floor run is VS Code's own line, from the owner's VS Code running beside it. The
owner's VS Code and its settings were not touched.
