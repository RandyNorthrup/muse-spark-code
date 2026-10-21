# Real drive of the macOS vault through the panel — 2026-10-20 (lane MACVAULTFLOW)

Product: the 0.19.0 tree at **03e60fba80** (hosted CI fully green) in the
`MACVAULTFLOW` worktree, plus the lane's new suites. No product file is
changed by this lane; the work is the POSIX panel-flow suite, its fixture,
and the shared panel-flow driver.
Rig: macmini (Mac mini Intel, macOS 15.7.4, Node v24.21.0). The lane runs
inside the agent sandbox: the lane's own `TMPDIR` is too long for the broker
socket (the suite skips with the socket-fit reason there, as designed), and
`/bin/ps` is blocked (`Operation not permitted`), which is the wall below.
Model calls through the product: **0**. Nothing was written to the person's
real vault folder (`~/Library/Application Support/Muse Spark Code/vault`),
keychain, home or VS Code: every drive used a throwaway folder and the
fixture's own data dir.

## What was driven, and what the product said

1. **macOS native helpers. PASS.** `bash native/darwin/build.sh` (exit 0):
   `dist/native/darwin/muse-vault-arm64` + `muse-vault-x64` (Secure Enclave
   slot helper), `native/darwin/muse-dictate-screen-{arm64,x64}.app`,
   `native/darwin/muse-vault-peer-{arm64,x64}`.
2. **POSIX panel-flow suite (new). BLOCKED at the sandbox wall, red causes
   found and fixed on the way.**
   `test/unit/vault/posixVaultPanelFlow.test.ts` (with
   `test/unit/helpers/vault/posixPanelFixture.ts` and the shared
   `test/unit/helpers/vault/panelFlowDriver.ts`, also now used by the
   Windows suite): the full panel flow — set up, unlock, add through the
   native editor's own code, write and read back a 9.6 KB first-party row,
   lock, unlock, read again — plus the same flow with the working folder at
   `/` (Dock-started VS Code). The client inherits the editor host's own
   `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`.
   - With the lane's default `TMPDIR` the suite skips (socket-fit reason).
     With a short owner-only `TMPDIR` the fixture builds, the real broker
     starts (`vault-broker-ready`), the channel opens, and the first
     snapshot answers `unavailable` / `vaultLost` instead of `uncreated`:
     **red**. Read to its cause: this sandbox blocks `/bin/ps`
     (`Operation not permitted`; `kern.proc.all` is unavailable too), so the
     broker cannot prove process birth (`darwinStartTime`), exact process
     identity is unknown, and the store fail-closes a fresh vault as lost
     (`writerRecovery`'s unknown-owner branch). The refusal is the product
     working as designed on a machine that cannot prove identity — not a
     product defect — and setup cannot proceed past it here (the writer
     lease also requires exact identity). Full diagnosis is in
     `docs/certification/macvault0190.md`.
   - Setup, unlock, add, first-party read-back, lock/unlock and the `/`
     variant are **not proven**: they need process enumeration, which this
     sandbox withholds. The suite carries a collection-time skip for that
     rig (`hasProcessListing`), so it runs where it can and says why where
     it cannot. It must go green on hosted CI or outside the sandbox.
   - The tier question is therefore unanswered: setup never ran, so no
     tier was offered and nothing touched the keychain. The product's macOS
     slots offer the login Keychain (`osStore`) plus the Secure Enclave
     where available; which of those completes without a prompt on a real
     Mac is still to be recorded when the flow runs.
3. **Packed darwin product. Build PASS, package PARTIAL, drive BLOCKED.**
   `npm run build` (exit 0, budgets hold). `node scripts/package-vsix.mjs
--target darwin-x64` produced `muse-spark-code-darwin-x64-0.19.0.vsix`
   (3,737,551 bytes, zlib) but the pinned-zopfli recompress step failed:
   the lane has no `zopfli==0.4.3` (the script refuses the zlib fallback)
   — missing build tool, environmental. The packed layout was verified to
   match what the fixture stages (`dist/vaultBroker.js`,
   `vaultRuntime.js`, `vaultBrokerBindings.js`, `resourceGovernor.js`,
   `resourceAdmission.js`, `resourceStore.js`… `resourceStore.js` is
   `vaultStore.js`, plus `dist/native/darwin/muse-vault-x64` and
   `native/darwin/muse-dictate-screen-x64.app` + `muse-vault-peer-x64`).
   Driving the packed vault through the packed bits needs the same process
   enumeration, so it is blocked at the same wall.
4. **Controls that do pass in this sandbox.** `brokerSession` 4/4 green
   (the session broker launches, serves four concurrent real clients, and
   shuts down cleanly — everything short of store identity works);
   `brokerWithoutKeyring` 1/1 green. `writerCrashPosix` 17/17 red with the
   same wall's signature (writer lease `busy` refusals without exact
   identity); zero product diffs and no import edge from this lane's files,
   so environmental, not a regression.

## Outside the sandbox (the lead, same rig, 2026-10-20)

Run by the lead over SSH on the same Mac mini, outside the agent sandbox
(process listing works there), on the merged final tree (`c33636ea36`, then
`9bd09504d4` and `5a1031c497`), default `TMPDIR`. No model calls; nothing
touched the person's vault folder, keychain items or VS Code.

1. **Source-built layout. FAIL, then PASS.** First run: set up → unlocked,
   Lock → locked, Unlock → unlocked in both variants, then the shared
   driver's Windows-only check failed: `expected 'hardware' to be 'osStore'`.
   This Mac has a Secure Enclave, so setup chose the **hardware** tier
   (stronger than the keychain, and correct). The driver now requires
   Unlock to return to the tier setup chose, never a tier that needs the
   person's input (Windows still requires `osStore`; 9bd09504d4). Rerun:
   `posixVaultPanelFlow` 2/2 (full flow 8.2 s; working folder at `/`
   6.5 s) and `brokerSession` 4/4, exit 0. Setup, unlock, Add through the
   native editor, the 9.6 KB first-party row written and read back, Lock,
   Unlock and the second read all settled with no failure toast and no
   failure in the log, and no prompt of any kind.
2. **Packed darwin bits. PASS.** `npm run build` exit 0;
   `package-vsix.mjs --target darwin-x64` wrote
   `muse-spark-code-darwin-x64-0.19.0.vsix` (3,752,816 bytes, before
   recompression; the zopfli recompress step exits 1 here because the rig
   lacks the pinned `zopfli` package, the same files either way). Unpacked
   to `~/lead-mv-packed` and driven with `MUSE_VAULT_PACKED_ROOT` (the
   fixture then runs the package's own `dist/vaultBroker.js`, its sibling
   bundles, `dist/native/darwin/muse-vault-x64`, the peer helper and the
   created-directory helper, unchanged): 2/2, exit 0, both variants.
   A first attempt unpacked the package under the test's working folder:
   every helper launch was refused ("Governed command unavailable"), which
   is the governor refusing programs inside the workspace as designed; a
   real install lives under `~/.vscode/extensions`, never in a workspace.

What remains unproven on macOS: the keychain (`osStore`) tier on a Mac
without a Secure Enclave, which hosted CI's macOS runner exercises with
this suite.
