# RLF-M110OS threat model (OS3 to OS7)

Lane RLF-M110OS, 2026-10-23, rig linuxlt. This file is the threat
model the M110 record requires per phase ("each phase's part ...
reviewed and accepted before that phase's ... code is written").
It was written alongside the code on a solo rig: **acceptance by
Codex and Claude is waiting, routed through the lead, and the merge
waits for it.**

Scope: OS3 first-boot setup, OS4 hardening and disk encryption, OS5
add-ons and firmware, OS6 OS CI and publishing, OS7 Chrome on the
host. OS1 (image build), OS2 (updates), A1 and M110a do not exist in
this tree; everything that needs them names the wait below instead
of assuming them.

## Shared boundaries

- The LAN is hostile: the setup server speaks plain HTTP on it, so
  anything the setup flow carries (the Wi-Fi key, the choices) is
  visible to a LAN eavesdropper. The setup code is the only
  credential on that channel: ~99 bits (20 chars over a 31-char
  alphabet), single-use, dead on use, completion or reboot. No
  cookies, no clock, no retries worth brute-forcing.
- The device's owner is trusted with the recovery key and the MOK
  enrollment; the console is a trusted path for the passphrase.
- Vendor infrastructure (Google, NVIDIA, Debian) is trusted for
  availability, never for integrity without a signature the device
  verifies.
- GitHub-hosted CI is trusted to run the workflow it is given;
  every action is SHA-pinned and the release door (rule 2) reads
  the runs.
- Secrets never touch argv, the environment, files or logs: the LUKS
  passphrase travels on stdin held in memory only, the signing key
  (when the ceremony provides it) travels in a CI secret into gpg,
  and fingerprints are public pins, never keys.

## OS3 — first-boot setup

- A LAN attacker with the setup code owns the setup: the code is
  shown only on the device console (and its QR), is single-use, and
  the server stops offering setup once it completes.
- A hostile seed (USB) cannot smuggle choices past the schema: the
  seed reader accepts cloud-init v2 only, refuses anything else with
  a stable code, and deletes the seed only after a fully validated
  consume.
- A hostile SSH key cannot break the account: keys are validated
  blob-deep per type and sshd remains the final judge; `sk-*`
  keys pass the type name only.
- A wrong disk choice wipes data: the flow shows the detected disks
  and the choice on a review page before anything writes.
- Residual: no TLS on the setup LAN (named above); passkey and
  browser pairing follow the same code-gated channel; orchestrator
  pairing waits for M110a.

## OS4 — hardening and disk encryption

- The firewall defaults to drop on input and forward; only
  loopback, established traffic, SSH and the setup port (deleted at
  setup completion) are open. The ruleset's properties are pinned
  in tests; the real parse happens where netlink exists (the OS6
  boot proves it inside the guest).
- `systemd-analyze security --threshold` runs in tenths (measured
  against the tool: 0 to 100, fail when exposure reads strictly
  greater); the gate script validates the range itself so a tool
  parse error never masquerades as a pass or breach.
- LUKS2 `/var` unlocks by TPM2 bound to PCR 7 and the signed
  policy (updates keep unlocking), with a generated recovery key
  printed once for the owner to record and the console passphrase
  as fallback. The pre-enrollment passphrase arrives on stdin and
  is cleared after use.
- The optional TPM PIN enrolls interactively on the console only.
- Tang binding pins the server's advertised thumbprint (43-char
  base64url) in a validated config; HTTP is the protocol by
  design and the thumbprint is the trust, not TLS.
- Boot binaries are signed with sbsign and verified with sbverify
  before the hook succeeds; any failure leaves no output behind.
- Residual: no TPM anti-rollback counter is enrolled (an old
  signed policy image still unlocks); evil-maid past Secure Boot
  is answered by the owner's recovery-key custody; live
  enrollment and the nft parse wait for hardware and the OS6
  boot (no LUKS, TPM or netlink on this rig).

## OS5 — add-ons and firmware

- Every add-on manifest is strict: unknown fields refuse, sources
  cover exactly the declared architectures, and per-arch package
  versions pin. Chrome and NVIDIA build on the device only
  (their licences forbid redistribution); the manifest declares
  the lane and no CI job builds add-ons, so the routing holds
  vacuously until OS1's image build, which must refuse
  device-lane payloads in CI.
- Vendor keys pin by fingerprint and the install keyring must
  carry every pin; Google's and NVIDIA's repository metadata
  verified with good signatures on 2026-10-23. A rotation is
  re-pinned deliberately, never accepted silently.
- Version matching is declared in the manifest (`osRelease`)
  stamped into the image's extension-release file, and enforced
  by systemd-sysext at merge; the tree check compares the two
  before anything ships. A sysext tree must not ship its own
  os-release.
- NVIDIA serves both module flavours (open for Turing and newer,
  proprietary for Pascal and older) with MOK-signed modules; the
  install needs the user's license click first, and without it
  the node plainly has no NVIDIA driver.
- Base firmware is names resolved against snapshot.debian.org
  (typos and renames break CI, not the base build); versions
  follow OS1's snapshot date.
- Residual: dm-verity roothashes are recorded at OS6 publish,
  which waits for OS1's images; MOK enrollment needs the
  device's UEFI console.

## OS7 — Chrome on the host

- Chrome installs only through the terms-click-evidence machine:
  no install without the license acceptance, no record without
  the click, no record without the version and a pinned key
  fingerprint the install verified against. Each refusal is a
  tested state, not a message.
- The fallback is honest: without Chrome the node uses Chromium
  and says so in the wizard.
- Residual: the dashboard step, repository configuration on the
  device, recommended policies and the kiosk session need OS1's
  runtime and OS2's update layer; they are named waits, not
  stubs.

## OS6 — CI and publishing

- The static job replays every check the tree can run (manifests,
  firmware live, key transcripts, the threshold gate both ways,
  shell syntax). The image jobs run only when OS1's recipe
  exists and skip visibly until then.
- Reproducibility starts recorded: both build hashes are kept as
  artifacts and the compare blocks only after `REPRO_ENFORCE`
  flips, once two builds match.
- Publish checksums every image, writes the asset manifest, and
  either signs with the owner's key or warns loudly and records
  the assets unsigned — never silently unsigned. Provenance is
  attested per release asset.
- Residual: image signing waits for the owner's key ceremony;
  the SPDX SBOM waits for OS1's build to expose the package
  set; aarch64 boots and KVM boots wait for runners/rigs that
  have them (this rig has neither KVM nor aarch64 QEMU).

## Red drills (this lane)

Each drill breaks one guard and watches the owning check fail;
the transcripts are in `docs/certification/rlm110os.md`:

- Threshold 0 on a planted insecure unit fails; 100 passes (T1).
- Verifying an unsigned EFI fails; sign-then-verify passes (S1).
- A planted manifest violation fails; the shipped manifests
  pass; a VERSION_ID-mismatched tree fails (A1).
- An unknown firmware package fails; the recorded set
  resolves (F1).
- A proving boot without its marker times out; with it passes;
  a panicking guest fails fast (B1); a tampered tree
  mismatches (R1).

## Residual risk

Unmerged slice: OS1, OS2, A1 and M110a are absent, so no image,
update, dashboard or orchestrator claim follows. No acceptance by
Codex and Claude yet (waiting, merge-blocked). No owner hardware
has run any of this: QEMU is the authoritative matrix and the Pi
and bare-metal rows wait. Signing and the SBOM wait as named
above.
