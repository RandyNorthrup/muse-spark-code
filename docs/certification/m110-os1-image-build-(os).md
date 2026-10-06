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
