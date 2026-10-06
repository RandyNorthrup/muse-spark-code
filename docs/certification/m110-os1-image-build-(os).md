# M110-OS1 image build (os)

2026-10-06, Kubuntu, `/home/randy/lanes/M110OS1`, branch `m110/os1`,
base `989077534`. Scope is D90.24's OS1 recipes, partition layouts and boot
manifests. Model attempts: **0**. No credential access, paid/live call, push,
merge, rebase, other-lane edit, gate weakening or new npm dependency.

The rig/common rules reserve the full quality run to the lead. Local hooks
are present and remain unchanged. Other-lane code is read only; all shared
documentation changes are named handoffs in `os/README.md`.

## Initial piece: immutable input policy

`test/unit/osImageBuild.test.mjs`: **14 passed**, repository-default timeouts,
on this rig. Checks cover the fixed snapshot/epoch, matched verity partitions,
read-only `/usr`, equal inactive slots, their `NoAuto` flag, non-root service,
archive traversal (Windows separators included), unexpected package members,
symlinks refused before any writes, and corrupt pinned downloads with cleanup.
`python3 os/check.py`: **0 problems**. Red drills deliberately remove each
tested guard, run the complete owned suite, require a named failure, and restore
the exact original SHA-256; receipts are `m110-os1-input-drills.json`.

| Control                                                   | Threat row    | Red receipt                                          |
| --------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| Fixed snapshot/epoch; digest-checked Node/package input   | H17           | snapshot pin, source epoch pin, pinned asset digest  |
| Matched dm-verity hash tree, read-only `/usr`             | H11, H17      | usr integrity, read-only usr                         |
| Equal inactive slots excluded from auto-discovery         | H15, H17      | inactive slot admission, equal slots                 |
| Separate users, node service drops root                   | H11           | non-root service; OS permission receipt follows      |
| Whole-archive validation before extraction; bounded input | H09, H10, H17 | archive path/type boundary, package member allowlist |

The product service requires C/A1/M104's actual injected service binding and
OS3's on-device setup. No successful sign-in, listener or `/readyz` is claimed
without that binding. Test-only boot qualification must identify any injected
synthetic state/service adapter separately from a product-service receipt.

## Build host tools

Pre-approved apt install: mkosi 26-3, QEMU x86 10.2.1, OVMF 2025.11,
systemd-container/ukify 259.5, qemu-user/binfmt, xorriso,
debian-archive-keyring, python3-venv, systemd-repart and cryptsetup-bin.
Already present: QEMU aarch64, AAVMF, dosfstools, mtools, squashfs-tools.
mkosi 27.1 runs from its digest-checked source tarball under `temp/` because
Ubuntu's package is older and PyPI has no mkosi distribution.
Debian systemd-repart 262-1 and libsystemd-shared 262-1 are extracted locally,
not installed over the host's systemd. Their package-index SHA-256s were checked.
No `/dev/kvm` exists on this rig; QEMU qualification uses TCG and says so.

## Work in progress receipts

Build, boot, final gates, artifact sizes/digests, Pi manifest and named waiting
hardware receipts will be appended in the next piece. The recipe and input
policy are reviewable independently of those expensive builds.

## Native findings (before the final image set)

- The first repart run refused the service's numerical GIDs: explicitly
  declare both groups before their users. No shared UID/GID is used.
- The first image lacked the EFI fallback loader because `/efi` was absent
  from the ESP copy list; copy both `/boot` and `/efi` into the ESP.
- Excluding `/usr` removed the mount point and stranded the verified initrd
  mount. Exclude directory contents (`/usr/`, `/var/`, `/boot/`, `/efi/`),
  retaining the empty mount points. The policy test rejects the old recipe.
- The upstream Node binary then refused to start without `libstdc++.so.6`;
  explicitly compose Debian's `libstdc++6`. The real binary later ran.
- Raw boot passed the actual installed `NodeService.boot`/`nodeHealth` probe,
  sealed/unattended state and a tools-UID private-state denial. The synthetic
  fixture never opened auth, engine or tool sessions. This was **test-only**,
  not a production service-binding or setup-page receipt.
- Its journal showed DNS failing at `226/NAMESPACE`: Debian's early
  `PrivateTmp=disconnected` resolver attempted `/var/tmp` before `var.mount`.
  `RequiresMountsFor=/var/tmp` fixes the ordering and retains the namespace.
  The final probe checks resolver and networkd separately, not the aggregate
  status of multiple units (which succeeds if any one is active).
- El Torito ISO construction succeeded. Actual optical boot exposed a wrong
  `losetup` executable path; the initrd contains `/usr/sbin/losetup`, not
  `/usr/bin/losetup`. The rule was corrected, not the qualification image.
- Two clean builds had identical root, usr/hash, UKI, kernel, initrd and
  package manifest. `/var`, and therefore raw and checksums, differed:
  `alternatives.log` contained build wall-clock timestamps despite clamped
  file metadata. Exclude that composition log and compare again. The earlier
  comparison is retained in `m110-os1-repro.json`; it is not a claim that the
  final recipe is reproducible.

## Second piece checks

Owned suite: **47 passed** with repository-default Vitest timeouts and
`--maxWorkers=3`. **44 source-removal/action-change drills** each failed a
named test and restored the byte-exact SHA-256; the JSON receipt replaces
this first piece's narrower initial record. The Pi EOF drill changes refusal
into premature success (not an infinite loop) and the named truncation test
rejects it. Native block corruption also produced `data block 0 is corrupted`
and no readiness marker; the untouched input artifact was never overwritten.

`npm run typecheck` passed all five projects. ESLint passed both changed MJS
files. Black checked the four Python files. Localization: **14 tables, 164
manifest strings, 613 source files; 0 problems**. `check:host-api` reports one
inherited stale record in `docs/ide-compatibility/host-api.md`: Node built-in
counts already differ on base `989077534`; this lane changes no `src/**`,
`scripts/**`, package manifest or host API document. Regeneration/review is a
named J/lead integration handoff, not an owned-file fix or a weakened gate.
