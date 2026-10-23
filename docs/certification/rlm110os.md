# RLF-M110OS — Muse Node OS lanes OS3 to OS7

2026-10-23, linuxlt, worktree `/home/randy/lanes/RLF-M110OS`,
branch `rec/rlf-m110os`, base `583c1a9f4e6ec9840c764672faaeb3d61eeff33b`
(main 0.19.0). OS1, OS2, A1 and M110a are absent from the base, so
everything here stands alone and names what waits for them.
Model attempts: **0**; inference spend: **0**.

Commits (all with hooks on, explicit paths, contributor trailer):

- `fbad2fbad` l10n foundation (`nodeOs` group, 14 tables)
- `da82e645b` OS3: setup code, seed reader, setup store
- `aaee7a994` OS3: setup server, pages, console display
- `a5052ad30` OS7: Chrome consent gate, key check, add-on manifest
- `7b677f4d42` OS4: firewall, sysctl, threshold gate, crypt, signing
- `f0c73fab` OS5: add-on layer, NVIDIA add-on, base firmware
- `f675b829` OS6: boot driver, repro check, node-os pipeline

## Live captures (recorded real exchanges)

- Google signing key, 2026-10-23 (`test/fixtures/nodeos-chrome/`):
  `dl.google.com/linux/linux_signing_key.pub` fetches, the `stable`
  Release carries a good signature from subkey
  `0E225917414670F4442C250DFD533C07C264648F`, `Architectures:
amd64 arm64`. Pinned primary
  `EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796`.
- NVIDIA CUDA Debian 13 key, 2026-10-23
  (`test/fixtures/nodeos-nvidia/`): `8793F200.pub` fetches, the
  `x86_64` and `sbsa` InRelease files both verify good against
  `02182E60104FCDC26EAE1B8597A5D4CB8793F200`
  (`Kitmaker (Debian 13 Trixie)`). Repos carry nvidia-driver and
  nvidia-open 595.45.04-1 (x86_64), 595.58.03-1 (sbsa).
- Debian snapshot firmware responses, 2026-10-23
  (`test/fixtures/nodeos-firmware/`): all 7 packages resolve,
  first-listed `20260916-1` throughout.
- QEMU proving boots, 2026-10-23
  (`test/fixtures/nodeos-boot/`): Alpine `vmlinuz-virt` 6.18.58-0
  (`17fbd3ef…00e85`) plus a one-file initramfs, emulated
  x86-64, marker in 9367 ms; the panic boot fails fast on
  `Kernel panic - not syncing`.
- Terms pages returned HTTP 200 on 2026-10-23: Google Chrome
  terms, NVIDIA license. Threshold semantics measured against
  systemd 257 (`--threshold` takes tenths 0–100, fails past
  it); sysext `/usr`+`/opt` merge and the extension-release
  match rules read from the installed manual.

## Red/green drills (each guard broken on purpose)

- T1 threshold gate: `--threshold 0` on a planted insecure unit
  exits 1; `100` exits 0.
- S1 boot signing: `sbverify` of an unsigned EFI exits 1;
  `sbsign` then `sbverify` exits 0; a tampered copy exits 1;
  a failed sign leaves no output.
- A1 add-on check: a planted manifest violation exits 2;
  shipped manifests exit 0; a VERSION_ID-mismatched tree
  exits 1.
- F1 firmware check: an unknown package exits 1; the recorded
  set resolves with exit 0.
- B1 boot driver: the proving boot exits 0 on its marker; a
  never-printed marker times out with exit 1; a panicking
  guest fails fast with exit 1.
- R1 repro check: identical trees exit 0; a tampered byte
  exits 1 naming the file.

## Gate exits on the finished tree

- `test:unit` for the lane's suites: all pass (OS3 36, OS7 9+1,
  OS4 16 with 2 block-device skips, OS5 13, OS6 14).
- `typecheck` (host, webview, unit, e2e, integration): 0.
- `eslint --max-warnings=0` on touched files: 0.
- `prettier --check` on touched files: 0.
- `check:l10n`: 0. `check:reference`, `check:roadmap`: 0.
- `check:catches`: exit 1, measured pre-existing: the pristine
  base `583c1a9f` fails identically (same 64 judge-file sites),
  zero findings in this lane's files.
- `security:secrets` (gitleaks): 0 after two false-positive
  fingerprints (the kernel's public cert ID in boot logs).

## What this machine cannot run

- No `/dev/kvm`, no `qemu-system-aarch64`, no AAVMF: aarch64
  boots and KVM boots are composed and dry-run here, proven
  where the hardware exists.
- No `mkosi`, `cryptsetup`, `clevis`, `ukify`: image builds,
  live LUKS enrollment, Tang binding and UKI assembly wait
  for a provisioned builder.
- No TPM, UEFI console or Secure Boot enrollment: MOK and
  enrollment run on owner hardware.
- No Windows/macOS runners, browsers or editors beyond this
  rig: platform-gated tests skip visibly.

## Waiting, named

- Threat-model acceptance by Codex and Claude (merge-blocked).
- OS1's recipe (`os/images/`), OS2, A1, M110a.
- The owner's key ceremony (image signing) and the SPDX SBOM
  (needs OS1's package set).
- Owner hardware for the Pi and bare-metal matrix rows.
