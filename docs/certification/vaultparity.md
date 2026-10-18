# Lane VAULTPARITY — certification record

Branch starts at PR #216 (ms/msm109). Outcome: the vault stores, reads and
brokers credentials on Windows, macOS and Linux the same way.

## Parity survey (2026-10-18, lane start; `now` = surveyed, `after` = this lane)

- Windows broker channel — now: `startVaultBrokerProcess`
  ([brokerProcess.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/brokerProcess.ts))
  and `createVaultBrokerBindings`
  ([brokerBindings.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/brokerBindings.ts))
  throw `noAccess` on win32; the pipe-helper relay contract
  ([windowsPipe.ts](/home/randy/lanes/VAULTPARITY/src/core/vault/broker/windowsPipe.ts))
  and `MuseSparkVaultPipe.cs` design exist but no TS relay wires them into the
  channel. After: one `buildBrokerChannel()` body serves POSIX and Windows
  starters; Windows supplies pipe-relay files, DPAPI/CNG/Hello slots,
  claim-file claim/epoch locks and the guarded helper listener
  (`a7ece1345`; `windowsBrokerProcess.ts`, `windowsHost.ts`).
- Windows slot wiring — now: `WindowsVaultSlot` (DPAPI/CNG/Hello)
  ([windowsVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/windowsVaultSlot.ts))
  exists but nothing imports it; the broker entry defaults to
  `PosixVaultSlots`. After: `defaultBrokerSlots()` dispatches per platform;
  Windows gets DPAPI always and CNG/Hello where probed (`6ff6bca9`,
  `windowsVaultSlots.ts`).
- macOS Secure Enclave slot — now: `MacVaultSlot`
  ([macVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/macVaultSlot.ts))
  exists but nothing imports it; storage is `OsStoreVaultSlot` (login Keychain)
  only via `PosixVaultSlots`. After: `MacVaultSlots` offers the Keychain slot
  plus the Secure Enclave slot where probed (`6ff6bca9`, `macVaultSlots.ts`).
- macOS presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence reflects a fresh Secure Enclave unwrap, fail-closed.
- Linux TPM2/systemd-creds — now: Secret Service only; D89 promises a TPM2
  sealed object via `systemd-creds --user` or tpm2-tools where `/dev/tpmrm0`
  opens. After: `LinuxTpm2Slot` seals via `systemd-creds encrypt --user -T`
  where the device opens and systemd ≥ 256; presence stays refused after a
  real probe (no platform prompter on Linux; the passphrase prompt owns
  presence) (`6ff6bca9`, `linuxTpm2Slot.ts`, `linuxVaultSlots.ts`).
- Linux presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence reflects the TPM2 capability (PIN/lockout) where
  present instead of a constant.
- Keyring-absent broker — found mid-lane: the staged `.vsix` carries no
  `node_modules`, so `import('@napi-rs/keyring')` fails and the broker
  refused startup on every platform. After: the bindings degrade to a
  per-operation storeUnavailable factory and choose the owner-only file
  anchor (same record, same rollback rules, inherited from the keyring
  anchor) when the binding is missing; the OS store stays preferred wherever
  it is installed. The Windows broker handle carries its claim location like
  the POSIX one (`e813a4e3`, `fileAnchor.ts`, `brokerBindings.ts`,
  `keyringAnchor.ts`, `windowsBrokerProcess.ts`).
- Packaging — now: the universal VSIX carries every platform's native
  helpers but no keyring binaries at all (verified: vsce lists zero
  `node_modules` files); staging them would need 4,716,310 bytes compressed
  (PLAN.md D3 record) against ~380–540 KB of headroom, so no package can
  carry them under the unchanged 3700 KiB budget. After: `package-vsix
--target` packs one `.vsix` per VS Code target platform, each with only
  its own native pieces within budget; CI packs and asserts all six
  (own helpers only, TargetPlatform in the manifest). Keyring stays out by
  measurement: the linux-x64 binary alone deflates to 1,368,682 bytes
  (3,201,632 raw) vs 377,276 headroom on the measured linux-x64 package.

## Proofs (real code on each platform)

- Linux: direct runs in this worktree (`npx vitest run`, typecheck, build).
  - `slotProviders.test.ts` 9 passed; `windowsPipeRelay.test.ts` 6 passed;
    `fileAnchor.test.ts` 3 passed; `brokerWithoutKeyring.test.ts` 1 passed;
    `brokerSession.test.ts` 4 passed; `writerCrashPosix.test.ts` 17 passed;
    `vaultHarnessScenarios.test.ts` + `windowsPipeRelay` re-passed;
    `vsixTargets.test.mjs` 7 passed (all with the repo-default 5 s timeout).
  - Gate-fire: `brokerWithoutKeyring` fails on the pre-fix tree (broker
    refuses startup, no ready message) and passes with the fix.
  - Targeted pack, real production build on this rig:
    `muse-spark-code-linux-x64-0.18.2.vsix` = 3,411,524 bytes (budget
    3,788,800), `TargetPlatform="linux-x64"`, zero foreign helpers, all
    vault bundles present, x64 helpers built here (`muse-created` 43,208
    bytes, `muse-vault-peer` 14,544 bytes).
  - Rig env the vault suites need here: `TMPDIR=$PWD/temp`
    (the harness TMPDIR is ~130 chars; the broker's home-fallback socket
    must fit 107 bytes) and `XDG_RUNTIME_DIR=$PWD/temp/xdg` (HOME is
    read-only). Root-caused 2026-10-18: deep TMPDIR → fallback socket
    108+ bytes → broker correctly refuses → client launch loop hits its
    5 s deadline; verified byte-identical bundles behave identically, and
    the suite passes with a fitting TMPDIR.
  - Pre-existing, not this lane: `brokerSocketDirectory.test.ts`
    "refuses a symlink…" fails identically with and without this lane's
    changes (verified on the wiring commit); `brokerSession`/`writerCrash`
    need the TMPDIR/XDG env above on this rig.
- Windows/macOS: no spare hosts on this rig — proof is the lead's
  Windows/macOS run of the same suites plus the per-platform package install;
  recorded here when it lands. The Windows pipe helper compiles for net48
  with zero warnings (`dotnet build`); the C# targets the user's Framework
  `csc.exe` path at first use, to be confirmed on Windows CI.
- Bundle budgets moved with measured numbers (working rule 2):
  `dist/vaultBroker.js` 168,477 bytes → 193,749 budget (Windows broker,
  host, file anchor); `dist/vaultBrokerBindings.js` 33,159 → 38,133
  (anchor choice). Split manifest swaps deleted `posixVaultSlots.ts` for
  the three platform slot providers.
