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
  channel. After: broker starts on win32 over the guarded pipe helper and
  serves the same channel protocol.
- Windows slot wiring — now: `WindowsVaultSlot` (DPAPI/CNG/Hello)
  ([windowsVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/windowsVaultSlot.ts))
  exists but nothing imports it; the broker entry defaults to
  `PosixVaultSlots`. After: the broker entry selects the Windows slot provider
  on win32 with DPAPI always and CNG/Hello where probed.
- macOS Secure Enclave slot — now: `MacVaultSlot`
  ([macVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/macVaultSlot.ts))
  exists but nothing imports it; storage is `OsStoreVaultSlot` (login Keychain)
  only via `PosixVaultSlots`. After: the broker entry selects a macOS slot
  provider offering the Keychain slot plus the Secure Enclave slot where
  probed and certified.
- macOS presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence reflects the Secure Enclave probe (Touch ID/password
  at each unwrap) instead of a constant.
- Linux TPM2/systemd-creds — now: Secret Service only; D89 promises a TPM2
  sealed object via `systemd-creds --user` or tpm2-tools where `/dev/tpmrm0`
  opens. After: a Linux slot provider adds the TPM2 hardware slot where the
  machine has it, Secret Service otherwise unchanged.
- Linux presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence reflects the TPM2 capability (PIN/lockout) where
  present instead of a constant.
- Packaging — now: universal VSIX carries every platform's keyring binaries
  (measured 4,716,310 bytes vs ~0.9 MB headroom, PLAN.md D3 record); the
  `.vsix` budget is never raised. After: per-platform packages (VS Code target
  platforms) each carry only their own native pieces, within budget.

## Proofs (real code on each platform)

- Linux: direct runs in this worktree (`npx vitest run`, typecheck, build).
- Windows/macOS: no spare hosts on this rig — proof is the lead's
  Windows/macOS run of the same suites plus the per-platform package install;
  recorded here when it lands.
