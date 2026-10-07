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

The reviewed second piece is `b7f7cf3c5`; both hooks passed after the first
pre-commit attempt correctly flagged `archiveKeyFingerprint` as a generic
API-key pattern. That value is the archive's public signing fingerprint;
renaming its field to `archiveSigningFingerprint` made its meaning precise.
The scanner and its configuration were not changed.

Final fixture integration adds a safe refusal test and an explicit exported
entry point consumed by the owned suite. The native harness bundles that
entry point itself and injects the **installed** `NodeService` and
`nodeHealth`; Vitest's state-store mock is never in that native bundle.
The refusal drill reaches that mock, not a host state path. **48 tests** and
**45 source drills** pass; Knip now passes. `npx jscpd` finds **0 clones**.

The post-log-exclusion comparison is `m110-os1-repro-final.json`: immutable
root, usr/hash, boot and kernel artifacts match, persistent `/var` and the
whole raw still do not. OS6 must investigate the remaining mutable-filesystem
difference; no reproducibility claim or blocking comparison is weakened.

## Archive metadata and installer overlay

Archive review found that a content-size sum alone lets the tar library
parse oversized PAX metadata before our member checks. `BoundedArchive`
now checks decoded read lengths and seek positions before calling the decoder;
member enumeration stops at its fixed count limit instead of unbounded
`getmembers()`. Small malformed metadata/seek/member fixtures fail before any
extraction writes, and each guard has a fail-and-restore source drill.

Actual optical boot after the executable-path correction found all six GPT
partitions, mounted the verity-protected usr and applied the overlay, but
failed at switch-root. Debian 257's `make_overlay` covers the root without
preserving child mounts. The initrd now binds `/sysusr/usr` back on top of
`/sysroot/usr`, explicitly read-only, after the overlay and before parsing the
real root/switching. This is a production recipe correction; the qualification
clone still receives only test code and units, never repaired mounts or fstab.
The new initrd post-install hook enables that conditional unit. Source:
[systemd v257 implementation](https://raw.githubusercontent.com/systemd/systemd/v257/src/volatile-root/volatile-root.c).

Current boundary suite: **57 passed** with default timeouts. **48** source
drills have named failures and byte-exact restoration. Oversized metadata,
forward seeks, member count and unsafe Win32 path components are covered before
any extraction write. The initrd's first `/etc` enablement was removed by
mkosi's final presets; the dependency is now registered in the vendor `/usr`
`.wants` directory and awaits the rebuilt optical receipt. ARM raw composition
succeeded; its first QEMU `max` CPU boot timed out in UEFI, so the bounded
Cortex-A72 retry is pending. No product-service or hardware pass is claimed.

The final owned suite is **59 passed** at the repository's default timeout.
The refreshed source receipt includes the read-only installer bind and surviving
vendor dependency, plus three real shell-admission checks. The latter execute
unchanged final statements against isolated roots; removing each statement
made its named test fail, and restored hashes match. The Cortex-A72 ARM raw
boot now passes `/readyz`, verified read-only usr, network-service startup and
tools-UID state denial. Final image rebuilding and optical qualification are
pending; none of these test-only receipts claims C/OS3 production integration.

Final boundary evidence: **59 unit tests pass**, three shell-admission fixtures
pass, and **53 source drills** fail by name and restore exact hashes. The test
HTTP response is parsed with zod before use. All committed source hashes were
rechecked after the last restoration; final media rebuilding follows.

Final x86 raw and optical media now pass native TCG qualification. The
installer's vendor dependency executes and its verified read-only usr bind
survives switch-root. One two-vCPU raw run panicked at the kernel timer/APIC
check, before initrd; the unchanged image passes with one vCPU. The optical
pass used two vCPUs. This is configuration-specific evidence, not a hardware
or KVM receipt. The real usr-block corruption drill withheld readiness and
restored the full disposable copy's exact SHA-256. Receipts are in
`m110-os1-boot.json`; ARM final media and Pi composition are still running.
