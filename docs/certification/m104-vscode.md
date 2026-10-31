# M104g — VS Code receipt (run blocked by the agent sandbox)

Recovery lane RLF-M104G. Base: main at 0.19.0 (`4ecbbd9cc5`). Rig: `macmini`
macOS 15.7.4 Intel (worktree `/Users/randy/lanes/RLF-M104G`). Downloaded
VS Code 1.143.1 (x64) via vscode-test; the `.vscode-test/` cache was
removed afterwards (it breaks `npm run build`'s legal scan, which walks
it) and re-downloads on the next run. No pushes, paid calls, live model
calls, or credential reads. Date: 2026-10-23.

**Status: pending — the driver is built but no run is claimed.** The
in-process conformance driver (`test/integration/m104Conformance.test.ts`,
15 tests: the waiting-leg pin plus 7 scenarios × 2 backends) is written,
typechecked (`tsc -p test/integration/tsconfig.json`), linted, formatted
and committed, and `npm run build:dev` bundles it. It has never executed:
every Electron launch in this agent shell stalls before the test host
starts (below). Nothing below is a green claim.

## The block (5 identical stalls)

In every configuration tried, the VS Code child writes `Local State`
(57 bytes) to its fresh profile and then produces zero output and zero
further profile changes, for 6+ minutes each:

1. `npx vscode-test --label stable --grep "M104g"` (55 min, killed).
2. Same after `xattr -dr com.apple.quarantine` on the download (25 min,
   killed). Quarantine was a red herring: node-written downloads never
   carry it, and the stall is byte-identical with and without.
3. Direct `Contents/MacOS/Code --verbose ... --list-extensions` (90 s+).
4. Same plus `--password-store=basic` (Keychain ruled out).
5. Same plus `--headless`, then plus `--disable-crash-reporter
--no-first-run` (windows, crashpad and first-run tasks ruled out).

Child spawn and loopback TCP verified working in the same shell; `/bin/ps`
and writes outside the sandbox home are denied (`Operation not
permitted`). A sixth attempt via the sanctioned unsandboxed-escalation
path stalled byte-identically 6+ minutes past download, so the block is
deeper than the shell sandbox (this headless agent session's GUI
context). Conclusion: only a real interactive session can run Electron
here. Per the rig's sandbox rule no workaround was built; the lead runs
this part outside the sandbox.

## Unblock

Outside the sandbox on this Mac (fresh profile recommended:
`rm -rf .vscode-test/user-data`), after `npm run build:dev`:

```sh
npx vscode-test --label stable --grep "M104g"
npx vscode-test --label minimum --grep "M104g"
```

Each green run writes `temp/m104-vscode-observations.json` (report plus
`vscodeVersion`/observed-at provenance); the second overwrites the first,
so save each file before the next run. Then `npm run
editor-matrix:generate` refreshes `m104-vscode.json` and the matrix row.

## Findings for that run

- `@vscode/test-electron` always passes `--disable-workspace-trust`, so
  the driver's `isTrusted` assertion holds without launch-flag changes.
- The musecode legs need the `muse` CLI on PATH (present here:
  `Muse Code 1.4.11`); its wrapper's update-check write is denied under
  the sandbox but the version still prints.
- The diagnostics legs pay one ~12 s cold JSON-server settle on the first
  backend (M68's proven timing, inside the 20 s mocha timeout).
