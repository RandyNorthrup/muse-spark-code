# M110 OS2 image side: RAUC one-shot trials, EFI and Pi tryboot, rollback (REDESIGN, FIXM110OS2)

Lane FIXM110OS2, worktree `/home/randy/lanes/FIXM110OS2`, branch `m110/os2-fix`
from M110 OS2I `cb4ed70bd`. Redesign of the OS2I code against review
RVM110OS2I (2 P1, 11 P2, 4 P3), implementing the lead's decided design
items 1–9 with the two deviations noted below (timeout watchdog,
EEPROM tokens), both forced by sandbox evidence and recorded as
qualification gaps, not claims.

No image builds or boots were run here: no network downloads, no build.py,
no mkosi, no qemu, no RAUC binary, no sudo. No OS1 file was edited
(os/mkosi*, os/build.py, os/pi/compose.py, os/pins.json, repart): OS1-side
changes are handoffs only. No credentials were printed, stored or
committed. Tests created throwaway RSA keys in `$TMPDIR` with openssl and
removed them after (each test file cleans its temp dirs in `afterEach`).

Committed here (hooks on, explicit paths):

| Commit      | What                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `3f4080076` | Pi backend: RAUC-faithful one-shot trials, device-tree current, flock   |
| `bcc68f19b` | Valid RAUC configs, parser-rule checker, exact slot map and sizes       |
| `c53c9e36b` | Trial-only mark-good, monotonic deadline, per-call limits, unit bounds  |
| `5558ca5e8` | Signed-channel honesty and strict state; real EEPROM write-protect gate |

Files (all under `os/update/`, plus tests and this record):

| File                          | Lines | SHA-256                                                            |
| ----------------------------- | ----- | ------------------------------------------------------------------ |
| `pi-tryboot-backend`          | 397   | `531cb310e0a9f980d2095f9910f7d280c728ac110ac175f4ddbf9723fc20a500` |
| `mark-good`                   | 326   | `3d5ddda074f10653422839ce67f767e7bef9cb0deb78110e983e57ae3492a095` |
| `channel.py`                  | 203   | `36433bfbd7b455c3c336e7f3f5d5696ff17ca20271f8391f85240b9c0e8cbba6` |
| `pi-eeprom-check`             | 200   | `f9bd424a2eeb82bbb773d0c06efdad4580b8d95eb052e80eeeeb70722599fed2` |
| `check-rauc-conf.py` (new)    | 90    | `c335db1043d2f925ec32f53728d8ae21d119b2dbc7e9b1b4d580e2a429808e32` |
| `muse-mark-good.service`      | 30    | `b857db92233a84b14c163e336e5f510c09d6c370dc88426f275df892926686de` |
| `system-pi.conf`              | 72    | `44f92a1ca114e217756f562554ec153cd9165946eaea6b4e58082de9b7b15aae` |
| `system-efi.conf` (unchanged) | 54    | `c37cdf563e99d4e35003fac7db447bfc4b882913f33173304ee1d3fec1768f46` |

Tests: `test/unit/osImageBuildUpdateTryboot.test.mjs` (22),
`test/unit/osImageBuildUpdateSlots.test.mjs` (15),
`test/unit/osImageBuildUpdateMarkGood.test.mjs` (22),
`test/unit/osImageBuildUpdateChannel.test.mjs` (20),
`test/unit/osImageBuildUpdateEeprom.test.mjs` (14).

## 1. RAUC protocol, faithfully (P1-2, P2-6)

The Pi custom backend implements RAUC's own calls with one-shot trial
semantics. RAUC 1.13 behaviour below is taken from the review's captured
sources (no network in this lane): install.c invokes `r_mark_active` after
writing the slot (with the default `activate-installed=true`); mark.c routes
`mark-active` through `r_boot_set_primary` and `mark-good/mark-bad` through
`r_boot_set_state`; bootchooser.c dispatches the custom backend verbs
`set-primary <slot>`, `get-primary`, `set-state <slot> <good|bad>`,
`get-state <slot>` (and `get-current`); main.c defaults an omitted
`mark-*` slot identifier to `booted`. The retired `set-state <slot> active`
verb belonged to the previous design only; RAUC never sends it and the
backend refuses it with `PI_TRYBOOT_BAD_STATE`.

RAUC call → backend action → autoboot.txt state (stable A, installing B):

| RAUC call                                      | Backend action                               | autoboot.txt after                                                    |
| ---------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| install → `set-primary B`                      | ARM one-shot trial of B; stable untouched    | `[all] boot_partition=1 muse_trial=B` `[tryboot] boot_partition=2`    |
| `get-primary`                                  | print stable `[all]` selection               | unchanged                                                             |
| `get-state S`                                  | print record (default: good iff S is stable) | unchanged                                                             |
| `get-current`                                  | print firmware booted slot (§4)              | unchanged                                                             |
| `get-trial` (lane extension, RAUC ignores it)  | print `muse_trial` for mark-good             | unchanged                                                             |
| mark-good → `set-state B good` while running B | PROMOTE B to stable, trial off               | `[all] boot_partition=2 muse_trial=none` `[tryboot] boot_partition=1` |
| `set-state B good` anywhere else               | record good only, no promotion               | trial kept                                                            |
| `set-state B bad` with trial B                 | record bad, clear trial, stable kept         | `[all] boot_partition=1 muse_trial=none` `[tryboot] boot_partition=1` |
| `set-state B bad` with no trial on B           | record bad only                              | unchanged                                                             |
| `set-primary A` (already stable)               | clear any trial, nothing to try              | `muse_trial=none`, `[tryboot]` standby                                |
| `rauc status mark-active X` → `set-primary X`  | same arming rules as install                 | as above                                                              |

Every `rauc status mark-good/mark-bad` call from mark-good names its slot
explicitly (`boot.0`/`boot.1` on Pi, `usr.0`/`usr.1` on EFI — the slots that
carry the A/B bootnames on each target) and never relies on the `booted`
default: after a fallback the booted slot is the stable one, not the failed
trial. The exact identifier→boot-entry binding still needs hardware proof
(Q-M110-OS2-RAUC).

## 2. Valid RAUC config (P2-3)

`system-pi.conf` moves `bootloader-custom-backend` under `[handlers]` and
drops `bootname` from the `usr.*` children (children carry `parent` and no
bootname; A/B live on `boot.0`/`boot.1` and are inherited). `system-efi.conf`
already satisfies the rules and is unchanged. `os/update/check-rauc-conf.py`
asserts the config_file.c invariants with no RAUC binary: handler section,
unique bootnames, no child bootname, resolvable parents, complete slots; the
Slots suite runs it against both files and feeds it four negative fixtures
(handler under `[system]`, duplicate bootname, child bootname, dangling
parent — each refused with its own code).

## 3. Controller partition (P2-4) — handoff OS2-OS1-CONTROLLER

`autoboot.txt` lives on a dedicated small controller FAT that is NOT a RAUC
slot; boot-a/boot-b stay separate FATs and the only boot slots. The backend
and slot maps assume the post-handoff layout: `MUSE_PI_BOOT_DIR`
(`/boot/firmware`) mounts the controller label, and no slot device
references it (asserted). Exact layout change for the OS1 lane (controller
first, so the firmware keeps finding `autoboot.txt` on the first FAT):

| Repart file                                          | Label            | Type          | Size             | Payload change                                                                              |
| ---------------------------------------------------- | ---------------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `os/pi/repart/00-controller.conf` (new)              | `muse-pi-ctl`    | `xbootloader` | 16M min/max      | initial `autoboot.txt` only (today's byte-identical content: A stable, B standby, no trial) |
| `os/pi/repart/01-boot-a.conf` (was `00-esp.conf`)    | `muse-pi-boot-a` | `esp`         | 260M (unchanged) | REMOVE `autoboot.txt` from the FAT payload                                                  |
| `os/pi/repart/02-boot-b.conf` (was `01-boot-b.conf`) | `muse-pi-boot-b` | `esp`         | 260M (unchanged) | unchanged (ships empty)                                                                     |

`os/pi/compose.py` change: write the initial `autoboot.txt` into the
controller staging image instead of `boot/firmware`; mount `muse-pi-ctl` at
`/boot/firmware` on the image; boot-a/boot-b are not mounted at runtime
(RAUC mounts them under `/run/rauc` at install). Recipe must also create
`/run/muse-update/` (tmpfiles.d) for the backend lock file (§6) and seed
`/var/lib/muse-update/{version,metadata_version}` (§7).

## 4. Booted slot (P2-5)

`get-current` reads
`$MUSE_PI_DEVICE_TREE/chosen/bootloader/partition` (default
`/proc/device-tree/...`) and validates the sibling `tryboot` flag when
present (must be `0`/`1`; absence is fine) — never a mount. A dedicated test
plants a screaming `findmnt` on PATH and still gets the device-tree answer.
Missing/unreadable partition refuses `PI_TRYBOOT_NO_CURRENT`; the old
`MUSE_PI_CURRENT_SLOT` seam is removed so every test exercises the
production detector through fixture device trees.

Qualification gap Q-M110-OS2-DT: the partition file is read as the
firmware's booted-partition selector (`1`=A, `2`=B, autoboot.txt numbering).
If Pi hardware reports raw GPT numbers instead, only this mapping (and its
test) changes; everything comparing against it already speaks slots.

## 5. mark-good (P1-1, P2-7, P2-8)

- Port parse uses the dash-correct pattern (`case $port in ''|*[!0-9]*)`
  refuse) plus a length guard and a 1–65535 range check; leading zeros are
  stripped before compare. Covered by tests that run the production
  `probe_once` path with a fake `curl` (no probe override): `8080`/`443`
  reach curl with the exact URL, while `invalid`/empty/`0`/`65536`/huge/
  negative never invoke curl and fail the trial.
- Trial-only: on Pi a missing trial exits 0 without touching RAUC or the
  backend; on EFI the trial marker
  (`/var/lib/muse-update/efi-trial`, one line `A|B`, written by the update
  agent at activation — handoff OS2-RUNTIME) gates everything. No marker
  means an ordinary or first boot: exit 0 even when the probe fails (this is
  the P2-7 fix; the old suite asserted the buggy mark-bad behaviour and was
  rewritten). Corrupt marker or missing `muse.slot=` stamp fails closed with
  no marking. The booted slot must equal the trial slot or the trial is
  recorded bad without promoting.
- Bounds: overall deadline on the monotonic clock (`/proc/uptime`, integer
  seconds, backward steps clamped, unreadable clock fails closed), a
  `MUSE_MARK_GOOD_MAX_ATTEMPTS` cap (default 100), and a per-call limit
  (`MUSE_MARK_GOOD_CALL_TIMEOUT_SEC`, default 30) on every child — probe,
  backend, rauc and curl. The limit is a shell watchdog (background child +
  sleep/kill guard), NOT timeout(1): the rig's `/usr/bin/timeout` (uutils
  0.8.0) cannot spawn any child under the lane sandbox — `timeout 30 echo
hi` fails with `Operation not permitted` — so timeout(1) calls would fail
  every child here and could never be verified; the watchdog needs only
  fork/sleep/kill and is exercised by the hung-probe test (a 30 s sleeper
  resolved in ~1 s, trial marked bad). Unit gains `TimeoutStartSec=360` and
  `FailureAction=reboot` (asserted). A kernel that hangs before the unit
  runs needs the hardware watchdog: named gap Q-M110-OS2-WD, not claimed.

## 6. Backend lock (P2-9)

One exclusive `flock` on `MUSE_PI_LOCK_FILE` (default
`/run/muse-update/pi-tryboot.lock`) spans every read-modify-write
(`set-primary`, `set-state`); readers take no lock. The temp file is created
after the lock is held, so any other temp seen mid-write predates the
transaction and is a crash leftover — the writer removes only strays, never
a live file (the old code cleaned before locking and could delete a
concurrent writer's temp). Tests: 40 serialized writers all succeed with
valid end state; a writer blocks while a foreign holder sleeps on the lock
(red without the `flock` call); a missing lock directory refuses
`PI_TRYBOOT_NO_LOCK`.

## 7. Signed channel, strict state, same bytes (P2-10/11/12, P3-15)

HONESTY: renamed from "TUF" to "signed channel (single key)" in code, tests
and this record. It enforces one detached RSA signature plus
version/expiry/monotonicity policy — no roles, thresholds, rotation or
metadata chain. Follow-up PLAN §9 row for the lead (exact text):

> OS2-TUF: real TUF client (roles, thresholds, root rotation,
> timestamp/snapshot/targets, persisted trusted metadata). The current
> `os/update/channel.py` is a signed channel with a single key only; replace
> its verify-and-policy step with threshold role checks, continuity against
> persisted trusted metadata, and rotation before RAUC ever trusts a bundle.

- Missing/corrupt/unreadable installed state refuses
  `CHANNEL_STATE_INVALID` (exit 5) — including a malformed installed
  version, which used to seed `(0,)` silently. Only `--first-boot`
  explicitly seeds 0.0.0/0 (image compose/first boot).
- The verifier receives the SAME bytes the policy parsed: the in-memory
  buffer is fed to openssl on stdin (argv names only the key and the `.sig`
  file). An in-process probe test captures argv/stdin and asserts
  byte-identity plus the absence of the metadata pathname (red when the path
  is passed back as an operand).
- Every field is type-validated first: numeric `version`, null/numeric
  `expires`, null `bundle` and friends refuse `CHANNEL_MALFORMED` with no
  traceback (asserted on stderr). No new dependency.

## 8. EEPROM gate (P2-13, P3-16)

The whole revision is validated as hex (`*[!0-9a-fA-F]*` refused) before any
arithmetic: `b03111+1` can no longer evaluate to a later PCB, and `b03111x`
no longer crashes without a machine code — both report `CANNOT_DETERMINE`.
Early Pi 4 boards (PCB 1.0/1.1) read the real write-protect state from
`rpi-eeprom-update` status (`MUSE_RPI_EEPROM_CMD`, read-only status mode):
enabled → `PI4_EEPROM_WRITE_REQUIRED`, disabled → `OK`, missing/failed/
silent tool → `CANNOT_DETERMINE` with remediation text on stderr
(`remedy=inspect-write-protect-with-rpi-eeprom-update-make-writable-then-retry`;
user text stays in OS2-OS3-U2-TEXT). The accepted status tokens are
provisional until an on-device capture names the exact wording
(Q-M110-OS2-EEPROM).

## 9. P3s

- Slot→partition mapping is pinned exactly per target (plus the repart sizes
  each label maps onto: ESP 256M, usr 1536M, verity 64M, Pi boot 260M): the
  usr.0/usr.1 swap drill fails the exact-map test while the old
  label-membership predicates passed it.
- `MUSE_READYZ_PROBE`/`MUSE_REBOOT_CMD` expansions are quoted; a test runs
  both from a directory containing spaces.

## H-row mapping (threat model untouched)

- H15 (fallback/ordering under faults): one-shot trials armed by
  set-primary, stable never moved by activation, DT booted-slot, trial-only
  mark-good, FAT limits recorded, monotonic deadline.
- H17 (malicious image/update): valid RAUC configs, controller separation,
  signed-channel policy with fail-closed verify, EEPROM gate.
- H10 (malformed input): strict autoboot/device-tree/cmdline/marker/channel
  parsers, typed fields, hex revision, port validation.
- H09 (liveness bounds): attempt cap, per-call watchdog, unit
  TimeoutStartSec/FailureAction.

## Red drills (each guard broken, named test failed, restored byte-exact)

| Guard                         | Break                                      | Named failure                         | Restore SHA-256                      |
| ----------------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------------ |
| Stable survives activation    | `set-primary B` rewritten to switch stably | Tryboot: arm-trial test failed        | `531cb310…c20a500` OK                |
| One flock, live temps survive | `flock 9` call disabled                    | Tryboot: lock-hold test failed        | `531cb310…c20a500` OK                |
| Exact slot map                | EFI `usr.0`/`usr.1` devices swapped        | Slots: exact-map test failed          | `c37cdf56…68f46` OK (file untouched) |
| Dash port pattern             | `*[!0-9]*` back to `*[^0-9]*`              | MarkGood: production-port test failed | `3d5ddda0…3492a095` OK               |
| EFI trial-only                | no-marker `exit 0` replaced by fail        | MarkGood: no-marker test failed       | `3d5ddda0…3492a095` OK               |
| Per-call limit                | probe run without the watchdog             | MarkGood: hung-probe test failed      | `3d5ddda0…3492a095` OK               |
| No silent zero-seed           | state reader restored to seed 0/0          | Channel: 3 damaged-state tests failed | `36433bfb…c40b9c0e8cbba6` OK         |
| Same-bytes verify             | metadata path passed back to openssl       | Channel: binding test failed          | `36433bfb…c40b9c0e8cbba6` OK         |
| Full-hex revision             | upfront hex check removed                  | Eeprom: 3 non-hex tests failed        | `f9bd424a…70722599fed2` OK           |

(Old zero-seed drill also passes 2 malformed-content cases — those refuse at
parse, as designed. Full SHAs are in the file table above.)

## Handoffs (named, for the lead)

- **OS2-OS1-CONTROLLER** (§3): new `muse-pi-ctl` xbootloader 16M first
  partition, boot FATs shift, `autoboot.txt` moves to the controller image,
  controller mounted at `/boot/firmware`, `/run/muse-update/` created,
  update state seeded. OS1 lane owns the files.
- **OS2-OS1-RECIPE** (update): install `system-*.conf` as
  `/etc/rauc/system.conf` per target, `{pi-tryboot-backend,mark-good,
pi-eeprom-check,channel.py,check-rauc-conf.py}` as
  `/usr/lib/muse-update/`, enable `muse-mark-good.service`; provision
  `/etc/rauc/keyring.pem` and `/etc/muse/update-channel.pem`; keep
  `compatible` and `bootloader-custom-backend` in sync; set RAUC
  `activate-installed=true` (default) so install arms the trial via
  set-primary.
- **OS2-OS1-UKI-SLOT**: stamp `muse.slot=A|B` on each slot's UKI kernel
  command line so EFI mark-good can identify the booted slot.
- **OS2-RUNTIME** (`src/runtime/node/osUpdate.ts`, not in this lane): at
  activation, write the EFI trial marker `/var/lib/muse-update/efi-trial`
  (`A|B`); poll `channel.py check`, fetch over HTTPS, install via RAUC.
- **OS2-SIGNING / OS2-OS3-U2-TEXT**: unchanged from OS2I (owner ceremony;
  user text for the EEPROM/bootloader codes and trial outcomes).
- **OS2-TUF**: PLAN §9 row text in §7.

## Must be certified outside the sandbox

RAUC against real slots on both targets (including the identifier→entry
binding and the install→set-primary→reboot→mark-good sequence receipts);
QEMU EFI trial boots with crash injection; Pi 4/Pi 5 hardware tryboot,
device-tree records (Q-M110-OS2-DT), EEPROM status wording
(Q-M110-OS2-EEPROM) and bootloader paths; watchdog behaviour
(Q-M110-OS2-WD); FAT power-cut behaviour; image reproducibility and Secure
Boot (OS4/OS6). Physical boot receipts stay with Q.

## Portability notes

- Path compares normalise to `/` before comparing; tests hand POSIX sh
  forward-slash paths on Windows and fail loudly when no shell or no
  openssl exists. `flock` is required (fail closed `PI_TRYBOOT_NO_LOCK`
  without it); no `timeout(1)` dependency remains (§5).
- Shell arithmetic inputs are validated as digits/hex before evaluation in
  both scripts (dash octal and expression-injection pitfalls).
- Deviations from the brief, both with sandbox evidence: per-call bound is
  a shell watchdog rather than timeout(1) (§5); EEPROM status tokens are
  provisional pending hardware capture (§8).
