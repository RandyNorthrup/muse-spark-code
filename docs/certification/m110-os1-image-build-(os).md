# M110-OS1 image build (os)

Kubuntu, 2026-10-06/07, `/home/randy/lanes/M110OS1`, branch `m110/os1`,
base `989077534`. Scope: D90.24, only OS1. Model attempts: **0**.
No credential access, paid/live model call, push, merge, rebase, other-lane
edit, new npm dependency or gate weakening. Hooks existed and ran unchanged.

## Delivered recipes and inputs

Debian 13/trixie snapshot `20261005T000000Z`, epoch `1791158400`, fixed
repart seed; digest-pinned Node **24.18.0** and ACP **0.14.0** package.
The runtime package SHA-256 is
`2ade7e967f7c791fedcb9cdfa76d7a28ddb080bb4446f7618e6dce623241cc6f`.
Both upstream Node hashes and the mkosi source pin live in `os/pins.json`.
The Pi manifest records the signed archive index, public signing fingerprint,
firmware `1:1.20260915-1` and board kernels `6.18.50+rpt-rpi-v8` / `2712`.
The archive signature was verified against that fingerprint, and all three
package bytes matched their index SHA-256s before staging.

UEFI media has a 260 MiB ESP, 128 MiB read-only root, paired 1536 MiB usr
and 64 MiB hash slots, and 2 GiB persistent var. Inactive usr/hash slots are
empty, equally sized and NoAuto. Installer media omits persistent var and
uses tmpfs under a volatile root overlay. Pi media replaces the ESP with two
260 MiB native FAT slots; slot A carries firmware, board DTB, overlays,
unchanged package kernel, initrd and verity cmdline. `boot-a.raw` is extracted
again after native assembly; checksums are recomputed after all writes.

The immutable service runner requires C's actual binding and on-device state.
A missing binding or state skips the product unit. There is no production
mock, implicit listener, Muse CLI, Chrome, sign-in, setup code, SSH host key,
TLS key or machine identity in the recipe. Node and tools use distinct
61100/61101 UIDs/GIDs and private 0700 roots. Shared root/kernel limitations
remain H16; `/var` encryption and trusted signed boot remain OS4.

## Executed build and boot commands

The actual composer calls used `python3 os/build.py <target>` with the pinned
runtime/package digest, mkosi 27.1 wrapper and explicit locally extracted
systemd tool search paths. Targets: x86-64 and arm64, each with and without
`--installer`, then pi4 and pi5. Full command/tool receipts stay in `temp/`
on the rig. Package build: `npm run build`, `node scripts/package-acp.mjs`.
`python3 os/build.py --help` and `python3 os/check.py` were run successfully.

Qualification runs `python3 test/e2e/os-image-boot.py <image> <architecture>`;
installer runs add `--optical`, and the corruption drill adds `--corrupt-usr`.
The harness clones media and injects only test code/units into its root.
It never repairs mount points, fstab, libraries, verity or initrd in a clone.
It runs the installed NodeService and nodeHealth with test-only synthetic
state, sealed boot, no sessions and no auth/engine/tools binding. A real
loopback HTTP GET must return ready, usr must be a read-only mapper mount,
networkd and resolved must each be active, and tools UID must fail to read
node's private canary. Every positive run powers itself off.

No `/dev/kvm` exists; VM receipts use **TCG**, OVMF/AAVMF and no NIC.
ARM uses Cortex-A72; the first `max` CPU run stalled in firmware and hit
its existing 600-second bound. X86 uses `max` and a 300-second bound. One raw two-vCPU run panicked
at the kernel timer/APIC check before initrd; the same image passed on the
one-vCPU retry. The optical pass used two vCPUs; the successful raw/corrupt
receipts record one. The original failed receipt is retained.
These are explicit native e2e bounds, not increased Vitest timeouts.

## Findings and corrections

- Declare explicit groups before numerical users; copy `/efi` as well as
  `/boot` to the ESP; retain empty root mount points by excluding directory
  contents rather than the directories. Each came from a real repart/boot
  failure and has a policy test.
- Include `libstdc++6`: upstream Node refused to start without it. Require
  `/var/tmp` before Debian resolved's private namespace; the original raw
  journal showed `226/NAMESPACE`. Both final network checks are separate.
- Optical initrd uses actual `/usr/sbin/losetup` and discovers the ISO's GPT
  through a read-only loop device. Debian 257's volatile overlay then hid
  the child usr mount: bind verified usr read-only above the overlay before
  switch-root. mkosi removed the first `/etc` enablement during final presets;
  the same unit's dependency now lives under vendor `/usr` and survives.
  [systemd v257 implementation](https://raw.githubusercontent.com/systemd/systemd/v257/src/volatile-root/volatile-root.c).
- Pi staging first exposed host depmod's `/lib/modules` default against a
  package extracted into `/usr/lib/modules`. Explicit `--moduledir` selects
  the real tree; no synthetic symlink or host module path is used.
- Repart directory precedence initially selected the common EFI partition
  instead of Pi boot A; native assembly refused the missing label. Reset the
  inherited directory list and put Pi first. Both FAT slots use the effective
  260 MiB size. ESP does not support NoAuto: remove its ineffective setting;
  firmware selects boot A/B, while usr/hash B keep NoAuto.
- Bound decoded tar reads/seeks and member enumeration before allocation,
  validate every member before writes, reject links/special files and unsafe
  POSIX/Win32 components, admit only exact runtime paths. Partial downloads
  and failed staging are cleaned; outputs exclude aliases and self-references.
- Earlier two-build comparison matched all immutable pieces but not var/raw.
  Excluding the wall-clock alternatives log did not make var deterministic.
  Both comparisons are retained in `m110-os1-repro*.json`. They precede the
  final installer-initrd correction. Whole-image reproducibility remains
  **unproven**; no comparison gate or threshold was weakened.

## Gates and deliberate failures

`npx vitest run test/unit/osImageBuild.test.mjs --maxWorkers=3`: **59 passed**,
repository-default timeout, no filtering/skips. `python3 test/e2e/os-image-postinst.py`:
empty root admitted, all three forbidden-content fixtures refused.
**53 source drills** have named nonzero failures and byte-exact restoration;
all source hashes were checked again after the unchanged hooks.
ESLint passes all three MJS files (the runner and both test files). Black passes five Python files.
Prettier passes changed Markdown/JSON/MJS. `npm run typecheck` passes all five
projects. `npm run deadcode` passes; `npx jscpd` finds **0 clones**.
Localization: **14 tables, 164 manifest strings, 613 source files; 0 problems**.
`npm run build` passes unchanged split/global/notice/size checks:
extension **437.0/600 KiB**, Model API **447.0/475 KiB**, checkpoint store
**77.2/225 KiB**, node **64.9/75 KiB**, webview **896.2/900 KiB**.
`node scripts/package-acp.mjs` passes with the digest recorded above.

`npm run check:host-api` reports **one inherited stale-record problem**:
base Node built-in import counts differ from `docs/ide-compatibility/host-api.md`.
OS1 changes no src/script/package manifest/host-API record. J/lead must
regenerate/review the shared document. Rig/common rules reserve full
`npm run quality` to the lead; it was not run or weakened here.

| Control                                                     | Threat rows   | Evidence                                                                         |
| ----------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| No implicit listener or preconfigured state                 | H01, H17      | policy/source drills; actual shell refusal fixtures; missing binding is explicit |
| Pinned snapshot, epoch, seed, Node, runtime and Pi inputs   | H17           | digest/version/admission source drills and captured signed archive metadata      |
| Bounded download/tar metadata, count, expansion and cleanup | H09, H10, H17 | named source-drill failures, decoded-boundary and malformed archive fixtures     |
| Normalized paths, no links or pre-validation writes         | H10, H11      | Win32/POSIX and no-filesystem-write fixtures; source-removal failures            |
| Verified read-only usr, paired slots and inactive admission | H11, H15, H17 | policy drills, real boot mount checks and actual corrupted data-block refusal    |
| Separate non-root users and private state                   | H11           | source drills, real setpriv tools-UID denial and fixture-UID refusal             |
| No automatic Chrome/CLI or machine sign-in                  | H17           | real shell refusal fixtures and individual source mutation/restoration           |

An initial unchanged pre-commit scanner rejected the public fingerprint field
`archiveKeyFingerprint`. It was renamed `archiveSigningFingerprint`; no
scanner rule or hook was changed, and the subsequent commit passed.

Every source receipt records the named failure, nonzero exit and identical
before/restored SHA-256. The native corruption receipt records the damaged
copy's original/restored SHA-256 and requires verity corruption with no ready
marker. The input artifact is never changed. All drills use fake fixtures or
disposable copies. No live Muse/Model API/paid request was made.

## Build host tools and cleanup

Pre-approved apt installs: mkosi 26-3, QEMU x86 10.2.1, OVMF 2025.11,
systemd-container/ukify 259.5, qemu-user/binfmt, xorriso,
debian-archive-keyring, python3-venv, systemd-repart and cryptsetup-bin.
QEMU aarch64/AAVMF, dosfstools, mtools and squashfs-tools were already present.
mkosi 27.1 runs from the source archive pinned in `os/pins.json`.
Installer El Torito needs repart 261+: Debian repart/shared 262-1 packages
were digest-verified and extracted under this worktree, never installed over
host systemd. Repart package SHA-256:
`99f9f642131c13053e9fe1f8f36833746bd97348d9b24860a01af1610e2852b8`;
shared package SHA-256:
`66978b0102d1da834afa5ec670f8f6a1ded893be9fbe08fa2a5c95c152f90b51`.
No global npm or Python package was installed. Download/package caches,
scratch directories and disposable fixture media under out were removed
after qualification; final media, partition payloads,
manifests, checksums, input receipts and boot logs remain under ignored out.

The first Pi precedence failure is retained as
`temp/os1-pi4-priority-failed.log`; the original module-path refusal was
`depmod: could not open directory .../overlay/lib/modules/...`. The fixed
compositions succeed and their native payloads verify.

## Named integration handoffs

- OS1-C-SERVICE and OS1-C-LOCAL-CONTROL: real NodeServiceBinding, authenticated engine/tools port and control/key input are absent on this base. Product unit skips until immutable binding and on-device state exist; no fake production implementation. The probe uses installed NodeService/nodeHealth with test-only state and no model attempts.
- OS1-OS3-SETUP: first-boot authenticated browser, seed/network import, selected target disk and image write are outside OS1. Installer boot media has volatile /var and never writes a target disk.
- OS1-OS2-SLOTS: publish paired active/inactive usr/hash partition labels, unsigned UEFI UKI and populated native Pi boot-a.raw; OS2 supplies updates, tryboot/EEPROM policy and rollback trials.
- OS1-OS4-HARDENING: unsigned UKI is not a trusted boot chain; /var is not encrypted. Separate UID/private-state read denial is qualified; ptrace/socket-peer/environment isolation and hardening threshold remain C/OS4.
- OS1-OS6-RELEASE: whole-image reproducibility still unproven despite matching immutable components. Repeated builds, source packages, signatures, SBOM/provenance and boot CI remain OS6.
- OS1-Q-HARDWARE: miniPC, old x86 desktop, ARM SystemReady server, Pi4 and Pi5 physical boot receipts are waiting. No KVM on this rig; all recorded VM boots use TCG.
- OS1-J-DOCS: integrate README/CHANGELOG/PLAN/help catalog and inherited host-API record. Base has no featureCatalog.ts. Full quality is reserved for lead; no gate or hook changed.

Physical receipts are assigned to Q as `Q-M110-OS1-X86-MINIPC`,
`Q-M110-OS1-X86-DESKTOP`, `Q-M110-OS1-ARM-SYSTEMREADY`,
`Q-M110-OS1-PI4` and `Q-M110-OS1-PI5`; all are waiting for hardware.

## Final artifacts

All six builds exit 0. Four final UEFI boot probes and one real corrupted-usr
drill pass; Pi media pass native FAT/kernel/verity inspection. Physical boot
remains waiting. Source/boot/Pi/artifact JSON receipts accompany this record.

| Media                                       | Logical bytes | SHA-256                                                            |
| ------------------------------------------- | ------------: | ------------------------------------------------------------------ |
| `out/x86-64/muse-node-x86-64.raw`           | 5,910,839,808 | `37455f0766f19a62db87a2bf37cfab956fab6aec2bb9a3b38d9b1c44977bcbd4` |
| `out/x86-64/muse-node-x86-64-installer.iso` | 3,763,356,160 | `24ab27cc800d17d3ca1fe3f963850a2383d2e0cd2aef3aa23ef79b65dfe3fc6b` |
| `out/arm64/muse-node-arm64.raw`             | 5,910,839,808 | `1035010955837bc56891d56d3e4ca15a28ac4980732ce0d9a6cb5e87c28b8fca` |
| `out/arm64/muse-node-arm64-installer.iso`   | 3,763,356,160 | `7240688f22490e22dbdf039e48295daa81bd66e435f0dd73dc41b5cf06351976` |
| `out/pi4/muse-node-pi4.raw`                 | 6,183,469,568 | `8044fda90056cfae2d9f97970ea33ece6214d988297292a522de0835ef6efd14` |
| `out/pi5/muse-node-pi5.raw`                 | 6,183,469,568 | `6f19cf611a53ec00ee2a5c356b1541c0e5a248c51174c7c1ef3b2e19cebc7552` |

Images and complete split/input/package/checksum/boot receipts are retained
under ignored `out/`; no binary media are committed or published.

Local commits before this final record: `8d017f1c7`, `b7f7cf3c5`,
`0df3da70c`, `905ad6b30`, `0d6d85d6e`, `1a8dfb09e`.
