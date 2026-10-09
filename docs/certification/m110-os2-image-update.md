# M110 OS2 image side: RAUC, EFI and Pi tryboot, trial boot, rollback (code and unit tests only)

Lane M110OS2I, worktree `/home/randy/lanes/M110OS2I`, branch `m110/os2i`
from M110 OS1 `c28697c0f`. Low priority on the shared kubuntu rig, inside
the Muse sandbox. No image builds or boots were run here: no mkosi, qemu,
`rauc` against real slots, sudo, apt, docker or `reboot`. No credentials
were printed, stored or committed; the bundle-signing CA stays the owner's
(Q-M110). Tests created throwaway RSA keys in `$TMPDIR` with openssl 3.5.5
and removed them after (each test file cleans its temp dirs in `afterEach`).

## Scope kept

New files only, per the brief. No existing file was edited.

| File                                            | Item | What it does                                                                              |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `os/update/system-efi.conf`                     | 1    | RAUC slots for UEFI: shared ESP plus A/B usr data and verity hash pairs, `bootloader=efi` |
| `os/update/system-pi.conf`                      | 1    | RAUC slots for Pi: boot-a/boot-b FAT plus the same usr pairs, `bootloader=custom`         |
| `os/update/pi-tryboot-backend`                  | 2    | RAUC custom backend over `autoboot.txt` (executable)                                      |
| `os/update/mark-good`                           | 3    | Trial-boot mark-good on `/readyz` (executable)                                            |
| `os/update/muse-mark-good.service`              | 3    | Oneshot unit, once per boot after `muse-node.service`                                     |
| `os/update/pi-eeprom-check`                     | 4    | EEPROM/bootloader readiness, machine codes only (executable)                              |
| `os/update/channel.py`                          | 5    | TUF channel check with fail-closed openssl verify                                         |
| `test/unit/osImageBuildUpdateSlots.test.mjs`    | 1    | 7 tests                                                                                   |
| `test/unit/osImageBuildUpdateTryboot.test.mjs`  | 2    | 14 tests                                                                                  |
| `test/unit/osImageBuildUpdateMarkGood.test.mjs` | 3    | 7 tests                                                                                   |
| `test/unit/osImageBuildUpdateEeprom.test.mjs`   | 4    | 9 tests                                                                                   |
| `test/unit/osImageBuildUpdateChannel.test.mjs`  | 5    | 9 tests                                                                                   |

## Item evidence

1. **RAUC slots.** Every slot `device=/dev/disk/by-partlabel/<label>` was
   checked against the labels in `os/repart/*.conf` and `os/pi/repart/*.conf`;
   the map covers `muse-efi`, `muse-usr-a/-b`, `muse-usr-a-verity/-b-verity`
   and `muse-pi-boot-a/-b`, and leaves `muse-root`/`muse-var` out. Both files
   share `compatible=Muse Node OS 1`, carry a keyring path only
   (`/etc/rauc/keyring.pem`), and contain no key material (asserted).
2. **Tryboot backend.** Accepts OS1's initial `autoboot.txt` byte shape
   (`[all] tryboot_a_b=1 boot_partition=1` with dormant `[tryboot]
boot_partition=2`). Trial flow certified in tests: `set-state B active`
   keeps A stable, `set-state B good` promotes only while running B, and an
   install-time good marking records without promoting. Eight malformed
   shapes (unknown key/section, comment, disabled flag, bad partition,
   duplicate, missing section, CR) are refused with `PI_TRYBOOT_*` codes.
   Writes are temp-file, `sync`, rename, directory `sync`.
3. **Mark-good.** No trial exits 0 without touching RAUC. Trial running here
   plus passing probe marks good (backend promotes, `rauc status mark-good`
   mirrors). Probe error, missing probe, or timeout marks bad and reboots
   into the untouched stable slot. A boot that already fell back (current !=
   trial) marks bad with no reboot, even when the probe passes. EFI targets
   (no `autoboot.txt`) mirror through RAUC only. Timeout 300 s and interval
   5 s are named (`MUSE_MARK_GOOD_TIMEOUT_SEC/_INTERVAL_SEC`); tests run 0/0.
4. **EEPROM checks.** Pi 4 `Rev 1.0`/`1.1` (Model line or hex fallback)
   report `PI4_EEPROM_WRITE_REQUIRED` (exit 3). Pi 5 compares the
   `vcgencmd bootloader_version` date against 2025-03-10:
   `PI5_BOOTLOADER_TOO_OLD` (exit 4) or `OK`. Anything unparseable, old-style
   revisions, or a missing source reports `CANNOT_DETERMINE` (exit 2). Stdout
   carries exactly one token; user text is a handoff below.
5. **Channel.** `check` prints one code and exits nonzero on refusal.
   Covered: lower version refused even when signed; equal version with higher
   metadata version accepted; expired metadata refused; non-increasing
   metadata version refused; one-field tampering and wrong-key/corrupt
   signatures refused; missing signature refused; malformed JSON refused.
   Tests fail loudly when openssl is absent, never skip.

## H-row mapping (threat model untouched)

- H17 (malicious image/update): RAUC X.509 keyring (path only, OS2-SIGNING
  provisions it), `channel.py` signature/downgrade/expiry/stale rules.
- H15 (power loss replays work / loses ordering): one-shot tryboot fallback
  by itself, trial bookkeeping that fails closed after a reset, FAT
  atomicity limits recorded in `pi-tryboot-backend`, metadata monotonicity.
- H10 (malformed input / injection): strict `autoboot.txt`, cpuinfo,
  `bootloader_version` and channel-metadata parsers; unknown content is
  refused, never guessed.

Proposed new rows for the lead (not added here):

- H21 — Downgraded or stale update bundle installed: channel refuses lower
  versions, expired metadata and non-increasing metadata versions; bundles
  verify against the provisioned keyring before RAUC writes.
- H22 — Trial boot bricks the node or never rolls back: one-shot tryboot,
  bounded `/readyz` mark-good, automatic fallback, no good marking on probe
  error.
- H23 — Tryboot update on a Pi that cannot do it: first-boot EEPROM and
  bootloader-date gates with machine-readable codes.

## Red drills (each guard broken, named test failed, restored byte-exact)

| Guard                  | Break                                                 | Named failure      | Restore SHA-256                                                       |
| ---------------------- | ----------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| Slot label map         | `muse-usr-a` to `muse-usr-X` in `system-efi.conf`     | Slots: 2 failed    | `c37cdf563e99d4e35003fac7db447bfc4b882913f33173304ee1d3fec1768f46` OK |
| Standby-only trial     | `!=` to `=` in `NOT_STANDBY` guard                    | Tryboot: 3 failed  | `7084e924e8b8b7493cda679880e267f0b24d0d2d0b10de833bb4394bf5faea25` OK |
| Failure marks bad      | `mark-bad` to `mark-good` in `mark_bad_and_fall_back` | MarkGood: 2 failed | `631eb9578f813a012e53a951485ae26fe0d4d6ec57a07d7b0d0962e5e5da35a2` OK |
| Old bootloader refused | `exit 4` to `exit 0`                                  | Eeprom: 1 failed   | `402614c809dfed3de651c915a2e384714346729c3e391dce4fa64c9cdf95b66d` OK |
| Downgrade refused      | `<` to `>` version compare                            | Channel: 5 failed  | `21fa227356da6eb6d2f52a04826adb5c0126243dbae57478ff5fb9c3e5f6895b` OK |

## Handoffs (named, for the lead)

- **OS2-OS1-RECIPE** (wiring into OS1's recipe, not done here): add `rauc`
  to the image packages; install `os/update/{system-efi.conf,system-pi.conf}`
  as `/etc/rauc/system.conf` per target, `{pi-tryboot-backend,mark-good,
pi-eeprom-check,channel.py}` as `/usr/lib/muse-update/` (backend and
  scripts executable), and `muse-mark-good.service` enabled; provision
  `/etc/rauc/keyring.pem` and `/etc/muse/update-channel.pem` from the
  owner's ceremony (never from the repo); seed `/var/lib/muse-update/
{version,metadata_version}` at compose; keep `compatible=Muse Node OS 1`
  in sync with the bundle builder; keep `bootloader-custom-backend=
/usr/lib/muse-update/pi-tryboot-backend` matching `system-pi.conf`.
- **OS2-SIGNING:** offline root and release-job certificate in an HSM or the
  `marketplace` environment; RAUC bundle X.509 codeSigning binding and the
  channel RSA key distribution/rotation story are the owner's. Nothing here
  names a real key.
- **OS2-OS3-U2-TEXT** (user-facing text for OS3 setup and the U2 dashboard,
  with translations): `PI4_EEPROM_WRITE_REQUIRED` (early Pi 4: make the
  EEPROM writable, then retry), `PI5_BOOTLOADER_TOO_OLD` (update the Pi 5
  bootloader to 2025-03-10 or later, then retry), `CANNOT_DETERMINE`
  (board data unreadable: check wiring/image before enabling updates),
  plus mark-good outcomes (trial failed, fell back to the previous slot,
  reason in the journal).
- **OS2-RUNTIME** (`src/runtime/node/osUpdate.ts`, explicitly not in this
  lane): idle-applied security updates should poll `channel.py check`,
  fetch over HTTPS, install via RAUC, request the one-shot tryboot at
  reboot, and surface trial state to the dashboard update panel (with U2's
  owner). Assumed RAUC core sequence needing hardware proof: trial armed
  with `set-state <slot> active`, never with install-time `set-primary`.

## Must be certified outside the sandbox

RAUC against real slots on both targets; QEMU EFI trial boots with crash
injection; Pi 4/Pi 5 hardware tryboot, EEPROM and bootloader paths; the
firmware tryboot-request handshake at reboot; the RAUC core call sequence
around install (Q-M110-OS2-RAUC); image reproducibility and Secure Boot
(OS4/OS6); physical boot receipts stay with Q.

## Portability notes

- Path compares normalise to `/` before comparing; tests hand POSIX sh
  forward-slash paths on Windows (Git Bash, resolved the way CI does) and
  fail loudly when no shell or no openssl exists.
- Two dash pitfalls found while testing and fixed at the source:
  `????/??/?? ?)`-style trailing-`?` case patterns do not parse, and
  `[^0-9]` is not a negated class in dash (`[!0-9]` is). The `sed` BRE
  `[^0-9]` in `pi-tryboot-backend` is correct and untouched.
