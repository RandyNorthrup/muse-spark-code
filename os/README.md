# Muse Spark Code Node OS (Unofficial)

OS1 composes Debian 13 from the `20261005T000000Z` snapshot with
`SourceDateEpoch=1791158400` and a fixed repart seed. Node 24.18.0 is pinned
by architecture and SHA-256 in `pins.json`; Debian's Node 20 is not installed.
No npm dependency, Muse Code CLI, Chrome, sign-in or machine identity is baked in.

The image contains separate `muse-node` and `muse-tools` users, private state
and workspace directories, and the ACP runtime from an explicitly digest-pinned
package. The immutable runtime lives under `/usr/lib`, covered by `/usr`'s
dm-verity tree. The initial `/usr` slot is populated; its equally sized inactive
data/hash slots are reserved and marked `NoAuto`. OS2 owns populating them and
choosing a new UKI after a verified update. `/var` holds persistent state and
workspaces and can grow. OS4 owns encryption and the complete hardening policy.

Run the local input-policy gate with `python3 os/check.py`. This command has
been run on the Kubuntu rig. `build.py --help` lists the composer inputs; it
requires mkosi 27.1 and the SHA-256 of the ACP package produced from this tag.
Installer builds additionally need systemd-repart 261 or newer for El Torito.
The build host is the container `builder/Dockerfile` describes: Debian 13
by digest with the systemd suite, veritysetup, the FAT/ext4 tools, the
Debian keyring and the mkosi release pinned in `pins.json` (its SHA-256 is
checked before it installs); the Dockerfile's header gives the two commands
that build and run it, privileged because mkosi assembles disks with loop
mounts. Cross-architecture builds also need the host's `qemu-aarch64`
binfmt entry registered with the fixed-binary flag. A host install is not
the supported route: Ubuntu 24.04 (the hosted runner) has no
`systemd-boot-tools` and no `systemd-repart` package candidate (measured
2026-10-24), and its systemd is 255 where the recipe was proven on 257. The Pi
composer extracts pinned packages without executing their installation scripts.
Pi builds additionally need host `gpgv`, Python 3.14 or newer (the stdlib
`compression.zstd` decodes zstd data members; older interpreters refuse
them instead of calling a host extractor) and the Raspberry Pi archive keyring:
export the key whose fingerprint equals the manifest's
`archiveSigningFingerprint` from a trusted host (for example
`gpg --export <fingerprint> > pi-keyring.gpg`) and pass
`--pi-keyring pi-keyring.gpg --pi-keyring-sha256 <digest>`; the composer
verifies the InRelease clearsign signature against that fingerprint, takes
the pinned Packages index digest from the verified Release listing,
downloads that index, takes each .deb's Filename, SHA-256 and Size from its
stanzas (the manifest pin must agree), and only then extracts through
member admission.
Build products, package manifests, checksums and input receipts go only into
`out/<architecture>/`; intermediates are removed after each build. Pinned
downloads and package caches are reused and removed after qualification.

Installer media boots with a volatile overlay and no persistent `/var` partition.
The initrd rebinds verified `/usr` read-only above that overlay before
switch-root; its vendor dependency survives mkosi's final unit presets.
It never writes a target disk on boot. OS3 owns the authenticated browser's
disk selection and write; OS1 supplies the bootable media and raw disk payload.
Secure Boot is off pending the owner's signing ceremony (OS4); dm-verity
detects block corruption but an unsigned UKI is not a trusted boot chain.

The `pi4` and `pi5` targets use Raspberry Pi's native EEPROM boot path, not
UEFI. `pi/manifest.json` pins the trixie archive's signing fingerprint, the
`main/binary-arm64/Packages.gz` index file with its SHA-256, and the
firmware and board-specific kernels (each bound to its stanza). Two 260 MiB FAT partitions precede the shared root, A/B `/usr`
and persistent `/var`. Slot A includes firmware, the correct DTB, overlays,
`kernel8.img` or `kernel_2712.img`, an initrd and a single-line verity command
line. Slot B is reserved for OS2; initial `autoboot.txt` selects A. The Pi recipe clears the inherited repart
list and places its definitions first, so the native slot replaces the common
ESP. ESP partitions do not support `NoAuto`; firmware selects the boot FAT,
while the inactive usr/hash slots retain their valid `NoAuto` flags. Composition
never changes EEPROM, burns OTP fuses or enrolls Secure Boot keys. Physical
Pi and ARM server qualification belongs to Q and is explicitly waiting here.

Debian's early DNS resolver explicitly waits for `/var/tmp` to mount before
creating its private namespace. The Node service also needs `libstdc++6` for
the pinned upstream binary. Both requirements came from real QEMU failures.

The offline qualification harness is `test/e2e/os-image-boot.py`, with its
test-only probe in `test/unit/helpers/osBootProbe.mjs`. It runs the installed
Node lifecycle and readiness function against synthetic state in a disposable
image copy; no authentication, engine, tools binding or setup page is claimed.
It checks sealed keys, no sessions, read-only verified `/usr`, network service
startup and denial of private state to the tools UID. Optical and block-corrupt
variants exercise actual devices. The rig has no KVM; these receipts use TCG. ARM qualification uses the
Cortex-A72 CPU; the rig's `max` CPU stalled in firmware. `test/e2e/os-image-postinst.py`
executes the actual final shell admission checks against isolated empty and
forbidden-content fixtures.
The certificate contains executed commands, image sizes/digests and red drills.

Two clean x86 builds before the final installer-initrd fix matched for root, `/usr`, verity, UKI, kernel and initrd,
but differed in `/var` and thus the whole raw image. The images remain **not
yet reproducible**; OS6 owns the blocking comparison once it demonstrates
identical whole images.

## Integration bindings

- **OS1-C-SERVICE:** `--binding <module> --binding-sha256 <digest>` supplies
  the immutable `service-binding.mjs`, exporting N's `NodeServiceBinding`.
  Without it the systemd unit does not start the service; no production fake
  or guessed engine/authentication protocol is shipped. C supplies the real
  two-user tools launcher and peer-UID verification.
- **OS1-OS3-SETUP:** OS3 initializes state and credentials on the installed
  machine, then explicitly selects the listener and activates the node. No
  LAN listener or setup code is generated by image composition.
- **OS1-OS2-SLOTS:** labels `muse-usr-a`, `muse-usr-a-verity`, `muse-usr-b`,
  `muse-usr-b-verity`, `muse-root`, `muse-efi`, `muse-var`; inactive slots
  initially contain no filesystem or accepted verity digest.
  Native Pi boot labels are `muse-pi-boot-a` and `muse-pi-boot-b`; published
  `.boot-a.raw` is the exact populated FAT payload. The UEFI `.efi` artifact
  contains the `/usr` verity digest. OS2 must replace boot payloads as well as
  the paired data/hash partitions and qualify rollback before enabling updates.
- **OS1-OS6-RELEASE:** OS6 supplies source-package publication, signed release
  assets, SBOM/provenance, repeated-build comparison and ongoing boot CI.
  No local unsigned image is a supported release.
- **OS1-J-DOCS:** README/CHANGELOG/PLAN/help-reference integration belongs to
  J/the lead. The base lacks `featureCatalog.ts`. Register the OS composer,
  image targets and prerequisites after integration; no editor path changes.

All editors reach the same installed node; OS1 adds no editor-specific behavior.
H16 remains: the host/root can read service memory and disks, and this lane
does not claim disk encryption or protection against a compromised kernel.
