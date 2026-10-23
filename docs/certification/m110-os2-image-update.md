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
| `mark-good`                   | 330   | `008e3486b9ae44116ab4511680cd065c52d9105296d1e18ee01e671fe282791b` |
| `channel.py`                  | 203   | `36433bfbd7b455c3c336e7f3f5d5696ff17ca20271f8391f85240b9c0e8cbba6` |
| `channel.py` (round 6, TUF)   | 848   | `ba1758ab648b4d18aaeccf7e43f53c56f097d4e5503dbb67a2e22e01b9fab60f` |
| `pi-eeprom-check`             | 200   | `f9bd424a2eeb82bbb773d0c06efdad4580b8d95eb052e80eeeeb70722599fed2` |
| `check-rauc-conf.py` (new)    | 90    | `c335db1043d2f925ec32f53728d8ae21d119b2dbc7e9b1b4d580e2a429808e32` |
| `muse-mark-good.service`      | 30    | `b857db92233a84b14c163e336e5f510c09d6c370dc88426f275df892926686de` |
| `system-pi.conf`              | 72    | `44f92a1ca114e217756f562554ec153cd9165946eaea6b4e58082de9b7b15aae` |
| `system-efi.conf` (unchanged) | 54    | `c37cdf563e99d4e35003fac7db447bfc4b882913f33173304ee1d3fec1768f46` |

Tests: `test/unit/osImageBuildUpdateTryboot.test.mjs` (22),
`test/unit/osImageBuildUpdateSlots.test.mjs` (15),
`test/unit/osImageBuildUpdateMarkGood.test.mjs` (22),
`test/unit/osImageBuildUpdateChannel.test.mjs` (20; 27 after round 6),
`test/unit/osImageBuildUpdateEeprom.test.mjs` (14).

## Round 3: FIXM110OS3 against RVM110OS2F (2 P1, 7 P2, 2 P3)

Lane FIXM110OS3, worktree `/home/randy/lanes/FIXM110OS3`, branch
`m110/os3-fix` from `49fff2200`, on the kubuntu rig. Simulators and unit
tests only: no image build, no boot, no QEMU, no RAUC binary, no network,
no paid call. The sections below are updated in place where round 3
supersedes them (marked SUPERSEDED / FIXM110OS3).

| Commit      | What                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| `fe453b7b0` | Pi map 1/2/3 + binary DT ints + controller check + own-temp cleanup; bounded mark-good |
| `740bd3fbe` | Channel: negative/signed counters, non-ASCII/over-long digits, overflow, bad UTF-8     |
| `167c3d42f` | EEPROM gate reads upstream `BOOTLOADER:` status, no invented write-protect lines       |
| (this)      | PLAN §9 OS2-TUF row, CHANGELOG entry, this record                                      |

Files after round 3:

| File                                                      | Lines     | SHA-256                                                            |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `pi-tryboot-backend`                                      | 450       | `81b5cbcfcf6c2d9eb7c468eda46cc22c0e90c6a4591e866b804246b007d987eb` |
| `mark-good`                                               | 377       | `e92809e09b17d4ed95665fb9cfa9c41423b24ab9b7b43e8d95858ffd702a4c75` |
| `channel.py`                                              | 218       | `5c64e9c19d422beb9c12d2ddc940ec7682a06367237af1a1a14197ae4a0f858a` |
| `pi-eeprom-check`                                         | 216       | `6fc7976449031fd98a1efd93b3c9f302b5c7057e07e44f4cd196ec40b9d1cb6d` |
| `muse-mark-good.service`                                  | 37        | `16ac595469eea64e1303b3b21505d40c1d567a2baac418721750eca3f656f896` |
| `system-pi.conf`, `system-efi.conf`, `check-rauc-conf.py` | unchanged | as in the table above                                              |

New shared test helper `test/unit/helpers/osPiTryboot.mjs`: reads the
partition map from the backend, builds binary device-tree integers and the
controller mount, runs the scripts under `dash` wherever it exists (the
image's `/bin/sh`), and names the skip when a host lacks `flock` or
`timeout` (stock macOS; F8).

### Closure table: RVM110OS2I findings 1–13 and RVM110OS2F F1–F11

| Finding                                      | Disposition after round 3                         | Evidence (file:line at the round-3 commits)                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1 P1 dash port pattern                     | Closed (unchanged)                                | `mark-good` `probe_once`; MarkGood production-port tests now run under dash                                                                                                                                 |
| I-2 P1 activation switches stable            | Closed (unchanged)                                | backend `set-primary`; Tryboot "arms a one-shot trial" asserts the exact 2/3 file                                                                                                                           |
| I-3 P2 invalid RAUC config                   | Closed (unchanged)                                | `system-pi.conf`, `check-rauc-conf.py`                                                                                                                                                                      |
| I-4 P2 FAT owns controller file              | Closed in the backend; OS1 layout still a handoff | backend `check_controller` (mountinfo source == `muse-pi-ctl` label) before every command; Tryboot "refuses every command unless the controller label is mounted"; OS2-OS1-CONTROLLER now names 1/2/3 bytes |
| I-5 P2 current slot from mount               | Closed in simulation (F1+F2)                      | backend `dt_int`/`current_slot`; binary fixtures; hardware receipt Q-M110-OS2-DT open                                                                                                                       |
| I-6 P2 mark-bad defaults to booted           | Closed (unchanged)                                | explicit `boot.N`/`usr.N`                                                                                                                                                                                   |
| I-7 P2 ordinary EFI boot marks bad           | Closed (unchanged)                                | EFI no-marker test                                                                                                                                                                                          |
| I-8 P2 no enforceable bounds                 | Closed in simulation (F3+F4)                      | `run_limited` = `timeout -k` + group sweep; deadline before/after probe; watchdog Q-M110-OS2-WD open                                                                                                        |
| I-9 P2 concurrent writers / stray temps      | Closed                                            | flock unchanged; writer removes only its own temp (trap), reports others                                                                                                                                    |
| I-10 P2 damaged state seeds zero             | Closed (F7+F10)                                   | `channel.py` `plain_number`, UTF-8 refusal                                                                                                                                                                  |
| I-11 P2 parsed ≠ verified bytes              | Closed (unchanged)                                | same-buffer stdin verify                                                                                                                                                                                    |
| I-12 P2 single signature called TUF          | Closed (F11)                                      | PLAN §9 `OS2-TUF` row added                                                                                                                                                                                 |
| I-13 P2 early Pi 4 can never pass            | Closed in simulation (F6)                         | upstream `BOOTLOADER: up to date` passes after remediation; on-device capture Q-M110-OS2-EEPROM open                                                                                                        |
| F1 P1 A/B mapped to 1/2                      | Fixed                                             | backend `PART_CONTROLLER=1 PART_A=2 PART_B=3`, `to_num`/`to_slot`; tests read the map and pin 1/2/3                                                                                                         |
| F2 P1 DT ints parsed as ASCII                | Fixed                                             | backend `dt_int` (4 bytes BE via od), tryboot flag too; ASCII/3/5-byte/LE refused                                                                                                                           |
| F3 P2 watchdog leaks / no KILL               | Fixed                                             | `mark-good` `run_limited`; tests: TERM-ignoring probe bounded <4 s, leaky backend returns <3 s, no-trial run at default 30 s limit                                                                          |
| F4 P2 success after deadline                 | Fixed                                             | `trial_expired` before and after each probe; late-probe test                                                                                                                                                |
| F5 P2 FailureAction reboots handled fallback | Fixed                                             | `handled` exit 3 + `SuccessExitStatus=3`; failed reboot request stays exit 1                                                                                                                                |
| F6 P2 invented EEPROM status lines           | Fixed                                             | `eeprom_update_state`; invented lines now CANNOT_DETERMINE                                                                                                                                                  |
| F7 P2 negative installed counter             | Fixed                                             | `plain_number` on the installed counter                                                                                                                                                                     |
| F8 P2 tests need host flock                  | Fixed                                             | named `describe.skipIf` (flock, timeout); foreign-holder `flock` spawn only inside the guarded block                                                                                                        |
| F9 P2 promotion before RAUC                  | Fixed                                             | Pi pass path calls only `rauc status mark-good`, then confirms `get-primary`/`get-trial`; fake rauc dispatches like RAUC 1.13                                                                               |
| F10 P3 tracebacks on damaged text            | Fixed                                             | ASCII/length guard, `OverflowError`, `UnicodeDecodeError`                                                                                                                                                   |
| F11 P3 OS2-TUF row missing                   | Fixed                                             | PLAN §9 row; CHANGELOG entry added                                                                                                                                                                          |

Still open (not claimed): every hardware/VM receipt in "Must be certified
outside the sandbox"; the Pi firmware trial-reboot request (`reboot
"0 tryboot"`) stays with OS2-RUNTIME, as the review notes; an unhandled
persistent error (exit 1) on every boot would reboot repeatedly under
`FailureAction=reboot` — each reboot lands on the stable slot, but the
loop itself is bounded only by the owner noticing (recorded residual).

### Round-3 red drills (break, named test fails, restore byte-exact)

Each drill mutated the committed file, ran the named test(s) at the
repository default timeout, then restored and compared SHA-256 (all OK,
equal to the file table above). Logs: `temp/drill-*.log` (gitignored).

| Guard          | Break                                    | Named failure                                                   | Restored SHA-256               |
| -------------- | ---------------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| F1 map         | `PART_A=1 PART_B=2`                      | Tryboot: geometry, partition-3, one-shot file (3 failed)        | `81b5cbcf…d987eb` OK           |
| F2 binary DT   | partition read as ASCII text             | Tryboot: binary read + ASCII records (3 failed)                 | `81b5cbcf…d987eb` OK           |
| I-4 controller | `check_controller` call removed          | Tryboot: controller-label test                                  | `81b5cbcf…d987eb` OK           |
| I-9 own temp   | stray deleted again                      | Tryboot: own-temp test                                          | `81b5cbcf…d987eb` OK           |
| F3 KILL        | `timeout` without `-k`                   | MarkGood: TERM-ignoring probe (30.5 s)                          | `e92809e0…2a4c75` OK           |
| F3 sweep       | group kill removed                       | MarkGood: leftover descendants (30.1 s)                         | `e92809e0…2a4c75` OK           |
| F4 deadline    | after-probe check disabled               | MarkGood: late-probe test                                       | `e92809e0…2a4c75` OK           |
| F5 exit        | `handled` exits 1                        | MarkGood: 4 handled-exit tests                                  | `e92809e0…2a4c75` OK           |
| F5 unit        | `SuccessExitStatus=3` removed            | MarkGood: unit test                                             | `16ac5954…56f896` OK           |
| F9 order       | direct backend promote before RAUC       | MarkGood: RAUC-refuses test                                     | `e92809e0…2a4c75` OK           |
| F7 counter     | `int()` on installed counter             | Channel: negative + signed counter (2 failed)                   | `5c64e9c1…f858a` OK            |
| F10 UTF-8      | `UnicodeDecodeError` handler removed     | Channel: UTF-8 test                                             | `5c64e9c1…f858a` OK            |
| F10 overflow   | `OverflowError` not caught               | Channel: overflow expiry test                                   | `5c64e9c1…f858a` OK            |
| F6 tokens      | write-protect line accepted              | Eeprom: invented-lines test                                     | `6fc79764…d1cb6d` OK           |
| F8 skip        | helper forced to report no flock/timeout | 36 tests skipped under the named reasons, 0 failed, no `ENOENT` | `5b64ad3a…26f3054` (helper) OK |

### Round-3 tests fail on `49fff2200`

The 49fff2200 production file was put back in place under the new tests,
the run recorded, and the round-3 file restored (trap-guarded, SHA-256
compared, all OK):

| Old file                 | New tests                                                     | Result on `49fff2200`                                                                                                      |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pi-tryboot-backend`     | Tryboot (all)                                                 | suite fails to load: the old backend has no partition map for the helper to read (F1); per-guard reds are the drills above |
| `mark-good`              | MarkGood: no-trial at default limit, RAUC refuses, late probe | 3/3 failed (30.0 s guard leak, 60.2 s, 60.2 s; F3/F9/F4)                                                                   |
| `muse-mark-good.service` | MarkGood: unit test                                           | 1/1 failed (no `SuccessExitStatus=3`; F5)                                                                                  |
| `channel.py`             | Channel (all 29)                                              | 6 failed, 23 passed (F7/F10 cases)                                                                                         |
| `pi-eeprom-check`        | Eeprom (all 19)                                               | 4 failed, 15 passed (F6 cases)                                                                                             |

The old mark-good was run only on those three tests: its guard leak makes
every `$(backend …)` call wait the full 30 s limit, and a full-suite run
was stopped by the 10-minute background limit before it finished (the file
was then restored from the saved copy and verified byte-exact; this
incident left no change behind).

### Round-3 verification (kubuntu rig, repository default timeout)

No `--testTimeout`; per-test durations all under 3 s except the 2.5 s
TERM-escalation and 2.5 s lock-holder tests.

- `npx vitest run` Tryboot + MarkGood + Slots (`--maxWorkers=3`): 3 files,
  **77/77 passed** (Tryboot 35, MarkGood 27, Slots 15), 18.6 s.
- `npx vitest run` Channel + Eeprom (`--maxWorkers=2`): 2 files,
  **48/48 passed** (Channel 29, Eeprom 19), 5.7 s.
- Total **125/125**, none skipped on this rig (it has `dash`, `flock`,
  `timeout`); macOS/Windows hosts without `flock`/`timeout` skip only the
  named suites (drill F8).
- `check-rauc-conf.py` both `RAUC_CONF_OK`; `os/check.py` 0 problems;
  `dash -n` on all three scripts OK.
- `npm run typecheck` 0, `eslint --max-warnings=0` and `prettier --check`
  on changed files 0, `npm run deadcode` 0 (knip `ignoreBinaries` gains
  `dash`, `flock`, `openssl`: `flock`/`openssl` were already unlisted at
  `49fff2200`), `npx jscpd` 0 clones. No source under `src/` changed, so
  bundle sizes and l10n are untouched (`npm run build` not run).

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

SUPERSEDED in FIXM110OS3 (F1): the `boot_partition=1/2` bytes in the table
below predate the controller-first map. The controller is partition 1, A is
2, B is 3 (backend `PART_CONTROLLER=1 PART_A=2 PART_B=3`; §3) — read every
`boot_partition=1` below as `2` and every `boot_partition=2` below as `3`.

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

| Repart file                                          | Label            | Type          | Size             | Payload change                                                                                                                                                                    |
| ---------------------------------------------------- | ---------------- | ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `os/pi/repart/00-controller.conf` (new)              | `muse-pi-ctl`    | `xbootloader` | 16M min/max      | initial `autoboot.txt` only: `[all] tryboot_a_b=1 boot_partition=2` `[tryboot] boot_partition=3` (A stable, B standby, no trial; NOT today's 1/2 bytes, superseded in FIXM110OS3) |
| `os/pi/repart/01-boot-a.conf` (was `00-esp.conf`)    | `muse-pi-boot-a` | `esp`         | 260M (unchanged) | REMOVE `autoboot.txt` from the FAT payload                                                                                                                                        |
| `os/pi/repart/02-boot-b.conf` (was `01-boot-b.conf`) | `muse-pi-boot-b` | `esp`         | 260M (unchanged) | unchanged (ships empty)                                                                                                                                                           |

`os/pi/compose.py` change: write the initial `autoboot.txt` into the
controller staging image instead of `boot/firmware`; mount `muse-pi-ctl` at
`/boot/firmware` on the image; boot-a/boot-b are not mounted at runtime
(RAUC mounts them under `/run/rauc` at install). Recipe must also create
`/run/muse-update/` (tmpfiles.d) for the backend lock file (§6) and seed
`/var/lib/muse-update/{version,metadata_version}` (§7).

Partition numbering (FIXM110OS3, F1): controller 1, boot A 2, boot B 3 —
Raspberry Pi's documented autoboot.txt A/B example. `PART_CONTROLLER`,
`PART_A`, `PART_B` at the top of `pi-tryboot-backend` are the one source of
truth: the parser, writer and device-tree decoder use them, the tests read
them from that file (`test/unit/helpers/osPiTryboot.mjs`) and pin them to
1/2/3, and mark-good speaks only slot letters through the backend. Every
backend command first checks that `/boot/firmware` is mounted from the
`muse-pi-ctl` label (`/proc/self/mountinfo` source resolved against
`/dev/disk/by-partlabel/muse-pi-ctl`), refusing `PI_TRYBOOT_NOT_CONTROLLER`
otherwise (earlier row 4).

## 4. Booted slot (P2-5)

`get-current` reads
`$MUSE_PI_DEVICE_TREE/chosen/bootloader/partition` (default
`/proc/device-tree/...`) and validates the sibling `tryboot` flag when
present (must be `0`/`1`; absence is fine) — never a mount. A dedicated test
plants a screaming `findmnt` on PATH and still gets the device-tree answer.
Missing/unreadable partition refuses `PI_TRYBOOT_NO_CURRENT`; the old
`MUSE_PI_CURRENT_SLOT` seam is removed so every test exercises the
production detector through fixture device trees.

FIXM110OS3 (F2): both properties are device-tree integers — exactly four
big-endian bytes (`00 00 00 02` = A, `00 00 00 03` = B), decoded with `od`
as upstream rpi-eeprom-update's readDtInt does — never ASCII. Any other
length, a little-endian or ASCII record, the controller partition or an
unmapped number refuses `PI_TRYBOOT_NO_CURRENT`; a tryboot flag that is not
a 4-byte 0/1 refuses `PI_TRYBOOT_MALFORMED`. Fixtures are binary. The
on-device capture stays hardware receipt Q-M110-OS2-DT.

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
  backend, rauc and curl. SUPERSEDED in FIXM110OS3 (F3): the earlier shell
  watchdog leaked its guard `sleep` (holding command-substitution pipes for
  the full limit) and never escalated past TERM; it was also a sandbox
  workaround that should have been reported instead. The limit is now
  `timeout -k $MUSE_MARK_GOOD_KILL_GRACE_SEC $limit` (coreutils, on the
  image; verified working on this rig): TERM to the child's process group,
  KILL after the grace, then a group sweep after the call returns so no
  descendant outlives it. A missing timeout(1) refuses `no-timeout`. The
  deadline is checked before each probe and after each probe returns (F4):
  a probe passing after the deadline fails the trial. Unit gains
  `TimeoutStartSec=360`, `FailureAction=reboot` and (F5)
  `SuccessExitStatus=3`: handled trial failures exit 3 so a healthy stable
  boot is not rebooted again; unhandled errors exit 1 and reboot. Pi
  promotion happens only through `rauc status mark-good boot.N` (F9),
  then is confirmed. A kernel that hangs before the unit runs needs the
  hardware watchdog: named gap Q-M110-OS2-WD, not claimed.

## 6. Backend lock (P2-9)

One exclusive `flock` on `MUSE_PI_LOCK_FILE` (default
`/run/muse-update/pi-tryboot.lock`) spans every read-modify-write
(`set-primary`, `set-state`); readers take no lock. The temp file is created
after the lock is held, so any other temp seen mid-write predates the
transaction and is a crash leftover. FIXM110OS3 (earlier row 9): a writer
now removes ONLY its own temp file (EXIT/TERM trap until the rename) and
reports any other stray as `PI_TRYBOOT_STRAY left=` without deleting it. Tests: 40 serialized writers all succeed with
valid end state; a writer blocks while a foreign holder sleeps on the lock
(red without the `flock` call); a missing lock directory refuses
`PI_TRYBOOT_NO_LOCK`.

## 7. Signed channel, strict state, same bytes (P2-10/11/12, P3-15)

SUPERSEDED by round 6 below: the single-key channel is replaced by a
real TUF client; the PLAN §9 OS2-TUF row is resolved. The rest of this
section stands as the round-2 record.

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
SUPERSEDED in FIXM110OS3 (F6): the earlier "EEPROM write protect:" tokens
were invented — upstream `rpi-eeprom-update` (raspberrypi/rpi-eeprom,
`printVersions`) prints no write-protect state. Early Pi 4 boards now read
the one status line upstream does print: `BOOTLOADER: up to date` → `OK`,
`BOOTLOADER: update available` → `PI4_EEPROM_WRITE_REQUIRED`
(`remedy=make-eeprom-writable-run-rpi-eeprom-update-a-reboot-retry`, after
which the tool prints up to date and the check passes). Exit 0/1 accepted
(upstream status mode); any other exit, missing tool, no or both BOOTLOADER
lines, or other wording → `CANNOT_DETERMINE`. Residual: write protection
itself is not observable, so a protected but up-to-date board passes. The
upstream wording was taken from the RVM110OS2F review's source read and
upstream's documented status output (no network in this lane); an
on-device capture stays Q-M110-OS2-EEPROM.

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

| Guard                         | Break                                      | Named failure                                         | Restore SHA-256                      |
| ----------------------------- | ------------------------------------------ | ----------------------------------------------------- | ------------------------------------ |
| Stable survives activation    | `set-primary B` rewritten to switch stably | Tryboot: arm-trial test failed                        | `531cb310…c20a500` OK                |
| One flock, live temps survive | `flock 9` call disabled                    | Tryboot: lock-hold test failed                        | `531cb310…c20a500` OK                |
| Exact slot map                | EFI `usr.0`/`usr.1` devices swapped        | Slots: exact-map test failed                          | `c37cdf56…68f46` OK (file untouched) |
| Dash port pattern             | `*[!0-9]*` back to `*[^0-9]*`              | MarkGood: production-port test failed                 | `008e3486…282791b` OK                |
| EFI trial-only                | no-marker `exit 0` replaced by fail        | MarkGood: no-marker test failed                       | `008e3486…282791b` OK                |
| Per-call limit                | probe run without the watchdog             | MarkGood: hung-probe test failed                      | `008e3486…282791b` OK                |
| EFI status capture            | shipped `if !` form (`$?` always 0)        | MarkGood: no-marker test failed + manual repro exit 1 | fixed in `d1e06f9c7`                 |
| Spaces drill re-arm           | second run without a fresh trial           | MarkGood: spaces test failed (status)                 | test-only fix, observed pre-fix      |
| No silent zero-seed           | state reader restored to seed 0/0          | Channel: 3 damaged-state tests failed                 | `36433bfb…c40b9c0e8cbba6` OK         |
| Same-bytes verify             | metadata path passed back to openssl       | Channel: binding test failed                          | `36433bfb…c40b9c0e8cbba6` OK         |
| Full-hex revision             | upfront hex check removed                  | Eeprom: 3 non-hex tests failed                        | `f9bd424a…70722599fed2` OK           |

(Old zero-seed drill also passes 2 malformed-content cases — those refuse at
parse, as designed. Full SHAs are in the file table above.)

## Verification status and one discarded result

`python3 os/check.py` passes (`OS1 image policy: 0 problems`). At the
repository default timeout on the kubuntu rig: Slots 15/15, Channel 20/20,
Eeprom 14/14, Tryboot 22/22. Mark-good on the committed bytes
(`d1e06f9c7`): 20/22 in one exploratory run plus the remaining two
(production-port, spaces) green in individual runs — 22/22 across runs,
all with raised `--testTimeout` (busy-rig allowance, disclosed here: the
shared rig thrashed at load 8–21 with multi-second spawn latency, and the
two slowest tests need ~120 s of it). Manual repros confirm the three
headlines directly: EFI no-marker exits 0 with a failing probe,
marker-B/ booted-B yields `status mark-good usr.1` with the marker
cleared, and a traced production-port run shows the exact curl URL and
promotion. An intermediate background delivery that reported MarkGood
22/22 on pre-fix bytes is DISCARDED: the exploratory run
deterministically exposed two real defects there — the EFI `$?`-after-`!`
dispatch bug (ordinary EFI boots failed instead of exiting 0; P2-7 not
actually fixed) and the spaces test's consumed trial — both fixed in
`d1e06f9c7`. CI must still re-run the suite at the default timeout on a
healthy machine.

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
- **OS2-TUF**: recorded as a PLAN §9 row in FIXM110OS3 (F11).

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
  without it); SUPERSEDED in FIXM110OS3 (F3): `timeout(1)` IS required — the
  per-call bound is `timeout -k` with KILL escalation and a group sweep
  (§5), and a missing timeout(1) refuses `no-timeout` before anything runs.
- Shell arithmetic inputs are validated as digits/hex before evaluation in
  both scripts (dash octal and expression-injection pitfalls).
- Deviations from the brief, both with sandbox evidence: SUPERSEDED in
  FIXM110OS3 (F3) for the per-call bound, which is `timeout(1)` rather than
  the earlier shell watchdog (§5); EEPROM status tokens are provisional
  pending hardware capture (§8).

## Round 4: FIXM110OS4 against RVM110OS3 (2 P2, 1 P3)

Lane FIXM110OS4, worktree `/Users/randy/lanes/FIXM110OS4`, branch
`m110/os4-fix` from `09aed9554`, on the macmini rig. No image build, no
boot, no RAUC binary, no network, no paid call. Tests run under `dash`
at the repository default timeout, at most 3 files per run; no
`--testTimeout` was used.

| Commit      | Finding | What                                                                             |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| `522348b5d` | R1 (P2) | Refused EFI mark-bad keeps the marker and exits 1; the next run retries the mark |
| `2e7fd5dba` | R2 (P2) | Incoming and installed counters share one bound (`MAX_COUNTER`, 2^63-1)          |
| (this)      | R3 (P3) | Stale §1 partition bytes and final portability notes marked SUPERSEDED in place  |

Files after round 4 (`pi-tryboot-backend`, `pi-eeprom-check`,
`muse-mark-good.service`, RAUC configs unchanged from round 3):

| File         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `mark-good`  | `00ec6a582180e5a706c5016617202b3e4d28fd58d453fab6f28a566d76b5e237` |
| `channel.py` | `31f63ce39f06749ffb9fc9e38f33d84ce03aa3c60594e1997029dd870c933729` |

- R1: both EFI refusal branches (fallen-back and probe-failed) keep
  `MUSE_EFI_TRIAL_FILE`, log `keeping-trial-marker for-retry`, and exit 1
  via `fail "rauc-bad slot=..."` — never the handled 3. The probe-failed
  refusal relies on the unit's `FailureAction=reboot` to leave the failed
  trial (documented in the script header). Tests: a refusing-RAUC fake
  yields marker kept + exit 1 on both branches, and the next run with a
  working RAUC retries the mark (second `status mark-bad usr.1`, marker
  cleared, exit 3, reboot requested).
- R2: `valid_counter` (0..2^63-1, bool refused) guards the incoming JSON
  integer; `parse_counter` (ASCII digits, at most 19, then `valid_counter`)
  reads the installed-state file. Test: incoming 2^63-1 accepted
  (`CHANNEL_OK`), persisted verbatim, read back (`CHANNEL_METADATA_STALE`,
  never `CHANNEL_STATE_INVALID`); 2^63 refused as `CHANNEL_MALFORMED` on
  the wire and `CHANNEL_STATE_INVALID` in state.
- R3: the §1 action table carries a SUPERSEDED note (1/2 bytes predate the
  controller-first map; read 1 as 2, 2 as 3) and the final portability
  notes mark the timeout/watchdog passages SUPERSEDED, pointing at the
  round-3 contract (`timeout -k` required).

### Round-4 red drills (break, named test fails, restore byte-exact)

| Guard           | Break                                            | Named failure                                       | Restored SHA-256      |
| --------------- | ------------------------------------------------ | --------------------------------------------------- | --------------------- |
| R1 kept marker  | both `fail "rauc-bad ..."` replaced by `handled` | MarkGood: 2 refusal tests failed (exit 3, not 1)    | `00ec6a58…5e237` OK   |
| R2 shared bound | `valid_counter` upper bound removed              | Channel: round-trip test failed (OK, not MALFORMED) | `31f63ce3…c933729` OK |

### Round-4 verification (macmini rig, repository default timeout)

- `npx vitest run` MarkGood + Channel + Eeprom (`--maxWorkers=3`): 3
  files passed, **57 passed, 21 skipped, 0 failed** — Channel 30/30
  (including the round-trip test), Eeprom 19/19, MarkGood EFI 7/7 plus the
  unit test (including the 2 new refusal tests). The 21 skips are the Pi
  suites, which require `flock(1)` (absent on macOS) and skip under their
  named reasons; the EFI suites ran under `dash` here.
- `dash -n` on all three shell scripts OK; `python3 -B
os/update/check-rauc-conf.py` both `RAUC_CONF_OK`; `python3 -B
os/check.py` 0 problems.
- Rig environment, disclosed: stock macOS ships no `timeout(1)` and this
  rig's Homebrew cannot install coreutils (Cellar unwritable), so
  timeout-dependent suites ran with a private `timeout -k` replacement
  (real TERM-then-KILL process-group escalation, in `$TMPDIR`, never
  shipped or committed). Pi-backend suites requiring `flock(1)` skip under
  their named reasons here; CI must re-run the full files with coreutils
  and util-linux (kubuntu/Windows).

## Round 5: FIXM110OS5, lead review of FIXM110OS4 (1 P2)

Lane FIXM110OS5, worktree `/Users/randy/lanes/FIXM110OS5`, branch
`m110/os5-fix` from `51511b520`, on the macmini rig. No image build, no
boot, no RAUC binary, no network, no paid call. Tests run under `dash`
at the repository default timeout, at most 1 file per run; no
`--testTimeout` was used.

Lead finding (P2) on `522348b5d`: a refused EFI `mark-bad` kept the trial
marker and exited 1, so the unit's `FailureAction=reboot` rebooted; the
next boot ran the stable slot (`booted != trial`), took the fell-back
branch, RAUC refused again, exit 1, reboot — an UNBOUNDED REBOOT LOOP on
an otherwise healthy stable system whenever RAUC refuses persistently.

Fix (keeps the retry, bounds it):

- The EFI trial marker now carries the refused-attempt count:
  `efi_trial_state` reads `<slot> <refused>` (`B 2`; a plain `B` from the
  update agent means 0). Corrupt markers still fail closed (exit 2 path);
  the count is capped at 9 digits so the increment cannot overflow.
- `MUSE_RAUC_BAD_MAX_RETRIES` (default 3, validated like the other
  numeric tunables) bounds refused `mark-bad` attempts per trial across
  both EFI branches (one shared count: a probe-failed refusal and the
  fell-back retries after the reboot accumulate together).
- Attempts 1..3 keep the marker (rewritten atomically via tmp-file plus
  `mv`) and exit 1 with `keeping-trial-marker for-retry slot=...`.
- Attempt 4 gives up: the run writes the durable record
  `$MUSE_EFI_TRIAL_FILE.unreconciled`
  (`trial=B slot=usr.1 refused-mark-bad-attempts=4`, tmp-file plus `mv`),
  clears the marker, logs the distinct `rauc-bad-gave-up slot=usr.1
trial=B attempts=4` line, and exits handled (3) via
  `TRIAL-FAILED-HANDLED rauc-bad-gave-up slot=...` — so `FailureAction`
  never reboots a stable slot more than 3 times for one trial.
- Any later mark RAUC accepts (good, fell-back bad, probe-failed bad)
  clears the marker and the stale record (`efi_reconciled`); an ordinary
  boot with no marker leaves the record alone.

Files after round 5 (`channel.py`, `pi-tryboot-backend`,
`pi-eeprom-check`, RAUC configs unchanged from round 4):

| File                     | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `mark-good`              | `eae74d5ec8e06911b4b06a86d8ab84b12009214855e82718e73b81db7b37819b` |
| `muse-mark-good.service` | (comment only; behaviour unchanged)                                |

(`channel.py` still `31f63ce3…c933729` from round 4.)

### Round-5 red drill (break, named test fails, restore byte-exact)

| Guard           | Break                                | Named failure                               | Restored SHA-256       |
| --------------- | ------------------------------------ | ------------------------------------------- | ---------------------- |
| Give-up exits 3 | give-up `handled` replaced by `fail` | MarkGood: bound test failed (exit 1, not 3) | `eae74d5e…7b37819b` OK |

### Round-5 verification (macmini rig, repository default timeout)

- `npx vitest run test/unit/osImageBuildUpdateMarkGood.test.mjs
--maxWorkers=3`: 1 file passed, **11 passed, 21 skipped, 0 failed** —
  EFI 10/10 (2 updated R1 refusal tests now expecting the `B 1` marker,
  plus 3 new bound tests) and the unit test. The 21 skips are the Pi
  suites, which require `flock(1)` (absent on macOS) and skip under their
  named reasons; the EFI suites ran under `dash` here.
- `dash -n` on `mark-good` OK; `shellcheck -S warning -s sh` clean;
  `npx prettier --check` and `npx eslint --max-warnings=0` on the changed
  test and certification files clean.
- Rig environment, disclosed: same private `timeout -k` replacement as
  round 4 (copied to this lane's own `$TMPDIR/m110os5-hostbin`, never
  shipped or committed). CI must re-run the full file with coreutils and
  util-linux (kubuntu/Windows).

### Round-5 residual: an unreconciled trial needs operator attention

After the give-up the trial slot is NOT recorded bad in RAUC — RAUC was
never told. The operator signal is twofold: the journal line
`rauc-bad-gave-up slot=<slot> trial=<trial> attempts=<n>` (which the
status/health surface can match; `handled` still logs
`TRIAL-FAILED-HANDLED` beside it) and the durable record at
`/var/lib/muse-update/efi-trial.unreconciled`
(`trial=<trial> slot=<slot> refused-mark-bad-attempts=<n>`), which
survives ordinary boots and is cleared only by a later mark RAUC accepts.
There is no automated remediation: reconciling RAUC slot state after a
persistent refusal is an operator step. Adjacent observation (not
changed, pre-existing): a refused `mark-good` on a passing probe also
exits 1 with the marker kept, so a persistently refusing RAUC on the good
path loops the same way — bounding that path is follow-up scope, not
this lane.

## Round 6: RLM110A0 replaces the single-key channel with a real TUF client (OS2-TUF follow-up)

Lane RLM110A0, worktree `/Users/randy/lanes/RLM110A0`, branch
`rec/rlm110a0`, on the macmini rig. No image build, no boot, no RAUC
binary, no network, no paid call. Tests at the repository default
timeout, 1 file per run; no `--testTimeout` was used.

`os/update/channel.py` rewritten (848 lines) as a real TUF client with a
fixed topology: root rotation under dual thresholds (old and new),
timestamp/snapshot/targets thresholds over unique keys, version
monotonicity with no skips at any role, expiry of every role and of the
trusted state against the channel start time, rollback continuity for
timestamp, snapshot and the targets each snapshot names, SHA-256
length-plus-hash parent bindings, bundle bytes/length/name checks
against the targets entry, no-downgrade against installed state,
RSA-PSS verification through the system openssl (no crypto of its own),
a 2048-bit floor with unknown schemes unusable, canonical JSON with
floats refused, every keyid recomputed, `--first-boot` seeding from an
explicit trust anchor, and atomic trusted-state writes. By design there
are no delegations (a targets file that names any is refused), no
consistent snapshots, one signature scheme and one hash; a machine whose
openssl cannot do RSA-PSS refuses the channel outright. No runtime
consumes the channel yet (OS2-RUNTIME is unbuilt); RAUC still verifies
every bundle's X.509 signature before writing.

| Commit      | What                                                        |
| ----------- | ----------------------------------------------------------- |
| `1c5e49574` | TUF client rewrite plus 27 tests with an independent signer |
| (this)      | PLAN §9 OS2-TUF row resolved, CHANGELOG entry, this record  |

Files after round 6 (everything else unchanged from round 5):

| File         | Lines | SHA-256                                                            |
| ------------ | ----- | ------------------------------------------------------------------ |
| `channel.py` | 848   | `ba1758ab648b4d18aaeccf7e43f53c56f097d4e5503dbb67a2e22e01b9fab60f` |

The test signer is independent of the client: its own canonical-JSON
writer, keyid computation and openssl invocations; PSS support is probed
up front and the suite fails loud without it. Throwaway keys live in one
shared `$TMPDIR` dir per run; each test works in its own temp dir.

### Round-6 red drills (break, named test fails, restore byte-exact)

| Guard                   | Break                                 | Named failure                    | Restored SHA-256       |
| ----------------------- | ------------------------------------- | -------------------------------- | ---------------------- |
| 2048-bit floor          | `MIN_RSA_BITS` 2048 back to 512       | Channel: weak-key test failed    | `ba1758ab…b9fab60f` OK |
| Threshold counts unique | duplicate-keyid `continue` removed    | Channel: unique-keys test failed | `ba1758ab…b9fab60f` OK |
| Snapshot rollback       | trusted-version comparison `if False` | Channel: rollback test failed    | `ba1758ab…b9fab60f` OK |

### Round-6 verification (macmini rig, repository default timeout)

- `npx vitest run test/unit/osImageBuildUpdateChannel.test.mjs
--maxWorkers=3`: 1 file passed, **27 passed, 0 failed**. The shared rig
  ran at load ~22 through the run; each test owns one behavior and one
  budget (the six malformed shapes and the four key refusals are separate
  tests sharing one beforeAll-built channel), so every test finished
  inside the 5 s default.
- `python3 os/check.py` still passes (`OS1 image policy: 0 problems`).
- `npx eslint --max-warnings=0`, `npx prettier --check` and `node --check`
  on the test file clean; `channel.py` parses (`ast`) and carries no new
  dependency.
