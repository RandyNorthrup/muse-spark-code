# CC-INT11FIX5 — hosted run 41738951665 on `55ced1044`

Lane `CC-INT11FIX5`, branch `cc/int11fix5` from `cc/int11fix4`. 66 jobs passed, 14 failed, 0 cancelled. Nothing pushed. No Muse
request, no paid call, no real `muse`, `MUSE_TEST_REAL_CLI` unset here, no vault or credential-store file imported, no budget or
timeout raised. Every vitest run named its files through `temp/vt2.ps1`. `gh` was used read-only, for job times.

**Last round's split held:** `static gates (macos-latest, lint)` finished in 18.9 of its 25 minutes, `unit lint` in 15.3.

**What the job rows are.** Real: the seven test shards below, accessibility, the guest session. Roll-ups: quality (3), dictation
helper, package: each log reads `CHECKS: success`, `UNIT: failure`, `ACCESSIBILITY: failure`, and nothing else failed in them.

**The brief's items 5 to 7 had their words and shards rotated.** The log says: `externalOrchestrator`, shard 14, `kill EPERM`;
`nodeOsAddons`, shard 4, `Test timed out in 5000ms`; `judgeLocalDarwin`, shard 15, `expected false to be true`.

## Fails on one run and passes on another

Five runs, by run number. `F` is failed, `.` is not in that run's failed list.

| File (system)                 | 41590781372 | 41619068707 | 41677635406 | 41723994114 | 41738951665 | Reading                                        |
| ----------------------------- | ----------- | ----------- | ----------- | ----------- | ----------- | ---------------------------------------------- |
| `makerSerial` (macOS)         | F           | F           | F           | F           | F           | Every time: not intermittent                   |
| `makerWindowEngine` (Windows) | .           | .           | F           | F           | F           | Every run since the suite landed, after 298f07 |
| `judgeLocalDarwin` (macOS)    | F           | F           | .           | .           | F           | **Intermittent**: the suite did not change     |
| `playbookContainedJob` (Win)  | .           | .           | .           | .           | F           | **Intermittent**: same code on the last three  |
| `serveHandshakeWait` (Win)    | .           | .           | .           | .           | F           | **Intermittent**: same code on the last three  |
| `nodeOsAddons` (macOS)        | .           | .           | .           | .           | F           | **Intermittent**: a third party's speed        |

Each intermittent one now waits on the event itself, or left the suite. None got a wider bound.

## 1. `makerWindowEngine` (Windows): the wait is named, and it was already measured

**The first-start lines, shard 6:** PowerShell 10,860 ms, compiler 2,227, port list **457**, Chrome 5,316. As last round's record
said it would read: a small number there and a timeout after it mean the cause is elsewhere. Twice I warmed the wrong thing.

**The case was not stuck, and the wait is not new.** One step is this case's alone: `listDevices` with hardware on, which runs
the port list. `docs/certification/m51.md` measured what that waits on, on the hosted runner: a cmdlet not yet loaded makes
Windows PowerShell analyse every module on its path, and a start that does not carry the machine variable
`PSModuleAnalysisCachePath` pays **22,295 to 28,901 ms**, against 214 to 233 ms with it. The image holds AWSPowerShell, 40
`Microsoft.Graph` modules and SqlServer. The fixture starts the child with `{ PATH, SystemRoot }` (`runtimeMakerNative`), so the
variable is gone. The warm-up ran under the worker's whole environment, which carries it: hence 457 ms there and past 15 s here.
My own `cc-winfix2.md` named `listPorts` among the scripts left to pay for this; I should have read it first.

**Shown:** the script's cost follows the module folder. Under a folder of the image's weight on this PC, as `cc-winfix2.md` built
it (200 script modules, 108 MB, no cache): the old script 5,411 and 5,988 ms, the new one 2,188 and 569 ms. My filler is comments, so
it is lighter than that record's 16 to 18 s; the direction is what it shows. **Still inferred:** no hosted log times this very case. If it fails again, its failure now prints which step it reached and when.

**Also a product fault, stated plainly.** A person with large modules waited that long on the Maker panel's list, and with those
cmdlets a module on the path exporting `Get-CimInstance` answered the list instead of Windows (seen here with real PowerShell: one
empty row from that module, no ports).

**The fix.** The script goes through .NET alone, `[wmisearcher]`, `Registry.GetValue` and `JavaScriptSerializer`, as the video
probe, the project reader and the storage guard already do, and it has M51's proof. My first fix named each command's module; that
still needs modules to load and could not pass the proof, so `4ee887acc` was replaced by `the Windows port list names no cmdlet`.
That first commit's message also calls the list "the one PowerShell child" that drops the environment. That is wrong:
`judge/hardware/probes.ts` and `teamProcessWorkers.ts` take the file alone too, and the environment was not the fault. This record
corrects it, and `nativeSerial.ts` is back as it was.

**Left, by name:** `runtime/tokenFile.ts`, `core/resources/sampler/optionalProbes.ts`, `host/media/recordingLatest.ts` and
`runtime/schedules/nativeBackground.ts` still name cmdlets, as `cc-winfix2.md` listed. `listSerialPorts`' comment calls its runner
bounded and `nativeSerial` gives it no bound: I did not add one, since a slow first start would then fail a list that now
succeeds, and the owner's rule is no invented limit. Not settled.

## 2. `playbookContainedJob` (Windows): `expected true to be false`

**What makes it intermittent (inferred):** the check runs the moment the call returns. The helper is gone by then, but kill-on-close
is the system's asynchronous end of the job's members: each is gone when its threads have run down. Here I measured it: 25 of 25
were already gone at the return, on a quiet PC. It failed once in five runs on a loaded runner.

The case now waits to see them gone, under the suite's existing 5 s for a stray. It still proves that only the system can have
ended them: drill C1 takes kill-on-close away and the case goes red. **Not a product change, and its limit is named:** `retire`
sees the helper's end, not each member's, and no handle here can see those, so its comment now says so.

## 3. `serveHandshakeWait` (Windows): `expected 1 to be greater than or equal to 2`

**What makes it intermittent:** the case answered after 35 ms and wanted two 10 ms notices. Windows' timers are coarser than that and
the runner was loaded (inferred from the numbers). It now answers after the second notice, whenever that is.

## 4. The accessibility job: more than the Models scenes, and all of it reproduced here

**Models scenes: not a panel that cannot paint.** `offers[0]` in the fixture lacks `worker`, required since D250 (`302c0cf64`, the
orchestrator slot). The panel refuses the state, as it must, and stays on `Connecting to the extension host…`. A stale fixture,
surfaced when the maker scenes stopped hiding it. The panel paints once the fixture is whole (looked at, both scenes). A page without
a result now also says what the webview refused (`✖ Invalid input → at state.roles`), instead of only `never became ready`.

**The log held three more things that keep this job red, which the brief did not list:**

- **`node-editor`, `nested-interactive`, a real fault.** The close control was a button inside `role="tab"`: one interactive control
  in another, which a screen reader cannot tell apart. The mark stays for the pointer, `aria-hidden`. A focused tab closes with
  Delete, says so through `aria-keyshortcuts`, and gives its focus to the tab that follows. The key is in the reference and the
  tables.
- **`node-editor` in High Contrast Light, `color-contrast`, 1.17:1, a real fault.** A pressed `Minimap`: the theme sets the
  selection's background without its text, whose fallback is white. It uses the same pair the other High Contrast surfaces do.
- **The 26 undecided elements: a harness fault and a misreading.** `node.html` read axe's reasons from `reason.messageKey` instead of
  `check.data.messageKey`, so every reason came back empty and `sortIncomplete` could sort nothing it was meant to. The `1:1` rows are
  xterm's screen reader mirror, `color: transparent` over the painted rows, measured `rgba(0, 0, 0, 0)`: **this corrects
  `rlf-cifixc.md`'s reading** of a theme-bridge gap (the terminal looked at here is dark on light, as it should be). The mirror now says
  it is unseen, `opacity: 0%`, and a screen reader still reads it. That also lets axe see the painted rows it reported as overlapped,
  and it now measures them in all four themes (10.5, 8.8, 21 and 13 to 1 by hand from their colours). As that record asked, nothing was
  sorted into `a11yIncomplete`. The active line's one digit: axe answers "too short" for a single character it cannot pass, so
  `node.html` now has it decide (`ignoreLength`), the stricter reading.

**Here, on the six scenes, four themes each:** 24 pages, 0 rules violated, 0 undecided, 0 pages without a result, exit 0. The other
337 scenes were clean in the hosted log. The whole gate did not run here, and `test:legal-a11y`, the job's next step, has been behind
this one: run here, exit 0, 96 checks.

## 5. `makerSerial` (macOS): the evidence reads, and it points at the rig

```
socat exit 0 signal null, device gone
N socket 1 (fd 5) is at EOF
N exiting with status 0
raw helper by hand: status 1 ... serial-unavailable
```

The relay died by itself inside the second the case began, because the device side reached EOF **though the case holds that device
open**, and the raw helper's `serial-unavailable` only says the device had gone. So last round's `serial-helper-ended-before-ready`
was not the helper's fault, and RLF-CIMAC's hold could not have helped.

**Cause (inferred, no macOS here, and I am reading XNU from memory):** the rig's setup ran `/bin/stty -f left` through
`startSerialProcess`, whose `detached: true` makes it a session leader. On macOS a session leader's `open` of a terminal without
`O_NOCTTY` makes it its controlling terminal, and that leader's exit revokes every other open of it, the holder's included. Hence
EOF at the master. `serial.py` itself opens with `O_NOCTTY`.

**Fix, in the rig:** `stty` runs on the holder's own descriptor with no session of its own. Those setup commands are test-only: the
product refuses approved settings on these adapters. **Not settled:** the product's stty adapter's `/bin/sh` session opens the port
the same way under the same `setsid`. A real device would then be that helper's controlling terminal on a Mac; I have no Mac or device
to see what that costs, and changed nothing.

**The Mac mini, only if the next hosted log is still red here.** No model needed, so a person can paste it, and it needs socat, which
changes that machine: your call.

```sh
brew install socat
socat -d -d PTY,link=/tmp/l,raw,echo=0 PTY,link=/tmp/r,raw,echo=0 &
sleep 1
python3 -c "
import os, time
held = os.open('/tmp/l', os.O_RDWR | os.O_NONBLOCK | os.O_NOCTTY)
if os.fork() == 0:
    os.setsid(); os.open('/tmp/l', os.O_RDONLY | os.O_NONBLOCK); os._exit(0)
os.wait(); time.sleep(1)
print('relay alive' if os.path.exists('/tmp/l') else 'relay ended')"
```

`relay ended` confirms this cause. If it says `relay alive`, the cause is elsewhere: paste the whole output of
`npx vitest run test/unit/makerSerial.test.ts --maxWorkers=1` on this head, `MUSE_TEST_REAL_CLI` unset.

## 6. `externalOrchestrator` (macOS): a regression through my own path, on an older fault

**Read as asked, and yes.** `kill EPERM` from `process.kill(-pid, 'SIGTERM')`, in the two new cases only. macOS refuses a signal to a
group holding only members that have exited and not been reaped, and `settleEndedProcess` asks exactly then. The log shows the throw
in `close()`, from the case's `finally`; the first one, inside the resume, is hidden beneath it (inferred). `close()` had the same
exposure before my change: anyone closing in that instant got the throw. So last round's fix turned a lost history into an error on a
Mac, in the very case it was for. **A product fault, now fixed:** a group that answers `EPERM` has ended, and `child.kill` is the
answer for it, whose failure has a listener.

I also found a hang of my own making in that method: an agent that closes its output and ignores `SIGTERM` held the person's next
step for ever. It now gets `SIGKILL` after `RESOURCE_MUSE_TERMINATE_GRACE_MS`, the two seconds the SDK itself grants. **No drill:** both
need POSIX; on Windows the first signal ends the process. The next macOS log decides.

## 7. `nodeOsAddons` (macOS): `Test timed out in 5000ms`

`resolves the real firmware set live` asks snapshot.debian.org for seven packages, one after another, inside 5 s: that is a third
party's speed. `node-os.yml` has its own step, `base firmware set, live`, on every change under `os/**` and to these suites, which is
when the answer can change. The case and its 8 s probe at import are gone; the same checker over recorded transcripts stays.

## 8. `judgeLocalDarwin` (macOS): `expected false to be true`

**What makes it intermittent (inferred):** Apple's `/bin/sh` re-executes as the shell `/private/var/select/sh` names (`man sh`). The
lease watches for `exec`, and it is right to. A watch set before that first exec sees it and says the process is not the one it
watched; set after, it holds. Which comes first is the scheduler's. The sibling case watches `/bin/sleep`, which has no such exec, and
has never failed. The fixture now says `up` and the lease starts after that word. A product that noticed the exec was doing its job.

## 9. The guest: what stopped the session

```
monitors: MUSE-HEADLESS-1 1920x1080, MUSE-HEADLESS-2 1280x800
M111QA-SESSION-FAIL hyprctl clients -j failed (exit 6): Hyprland IPC didn't respond in time
```

The session started and both outputs came up. The next `hyprctl` gave up after its own wait, and the harness treated that as final, so
the guest powered off, hence `eof (qemu exit 0)`. **Why Hyprland did not answer is inferred:** software rendering of two outputs on two
emulated processors. The wait for the outputs above it already allows dropped replies; the scene client's two calls now do, under the
same `readyTimeoutMs`, and a compositor that never answers still fails in words. The verdict now repeats the guest's line. Not run
here: no drill for the wait, and the next step (`foot`, virtual input, `grim`) has never been reached on hosted, so the next log may
name the next fault.

## Drills

Each restored byte-exact (sha256 compared), files named.

| Drill | Break                                               | Red                                                                                                |
| ----- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A1    | the Models offer lacks `worker` again               | exit 1, a11y: `never became ready within 10 s; the webview said: ✖ Invalid input → at state.roles` |
| A2    | the close control is a button inside the tab again  | exit 1, `editorUi`: `expected <button …> to be null`                                               |
| A3    | Delete does not close the focused tab               | exit 1, `editorUi`: `expected <div role="tab" …> to be null`                                       |
| A4    | High Contrast's pressed buttons keep the white text | exit 1, a11y `node-editor`: `color-contrast`, 1 element                                            |
| A5    | xterm's mirror counts as seen text                  | exit 1, a11y `node-terminal`: 1 rule undecided on 4 elements                                       |
| A6    | the node harness reads axe's reasons wrongly again  | exit 1, a11y, narrow scenes: 1 rule undecided on 8 elements                                        |
| L1    | the port list names a cmdlet again                  | exit 1, `makerPorts`: M51's proof, `Command failed`, ConvertTo-Json not recognized                 |
| H1    | the wait's notices stop coming                      | exit 1, `serveHandshakeWait`: `Test timed out in 15000ms`                                          |
| C1    | the contained job's handle does not kill on close   | exit 1, `playbookContainedJob`: `expected false to be true`                                        |
| Q1    | the verdict forgets the guest's words               | exit 1, `harnessQemu`: `expected null to be 'M111QA-SESSION-FAIL hyprctl failed'`                  |

Two first drills stayed green and were re-aimed, not counted: C1 first broke the limit of the other job (`RunTeam`'s), which
this helper does not use; A6 first ran on `node-terminal`, which has nothing left to sort once the mirror is unseen. A drill's strays
were looked for afterwards: none.

No drill here: `externalOrchestrator`'s `EPERM` and `SIGKILL`, `makerSerial`'s rig, `judgeLocalDarwin`'s fixture (POSIX or macOS), the
guest's wait (Linux and Hyprland). `nodeOsAddons` lost a case rather than gaining a guard.

## Gates

One after another, Node 22.23.4, on a PC another agent was also working on (`lint` took 29 minutes here).

**First pass, on `4336335e6`. Two gates were red, and were real:**

| Gate                                                                                                 | Exit  |
| ---------------------------------------------------------------------------------------------------- | ----- |
| `format:check`                                                                                       | **1** |
| `lint`, `typecheck`                                                                                  | 0     |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                         | 0     |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches` | 0     |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`           | 0     |
| `check:workflow-scripts`, `deadcode`, `cycles`                                                       | 0     |
| `duplication`                                                                                        | **1** |
| `build`, `security:audit`                                                                            | 0     |

- `format:check`: `test/harness/index.html`, one expression of mine; the hook does not format that file. Fixed in `c23ae96f4`.
- `duplication`: the new Delete case's setup was a clone of its neighbour's. One helper, `da9f3605b`, its lint through the hook.

**Second pass, with those fixes in the tree:** `format:check` 0, `duplication` 0, `typecheck:unit` 0. On the final head `da9f3605b`: `duplication` 0, `check:plan` 0, prettier on the last changed file 0.

Budgets all under: `dist/resourceGovernor.js` 124.8 of 125, `dist/teamProcess.js` 367.0 of 375, editor 583.7 of 600.

**Semgrep, not clean here, and said so:** the pinned 1.180.0 over this lane's code reports `detect-child-process` four times:
`containedJob.ts:132`, `compositor.mjs:437`, `qemuDesktop.mjs:371` and `:379`. No spawn line in those files changed in this lane (the
diff was read), and the hosted `semgrep` job passed on `55ced1044` with the same lines. I cannot say why `--config auto` differs
between here and there. Nothing else was found, and the hosted job decides.

**The accessibility job's scenes, on the production build:** `node scripts/a11y.mjs models-agents models-roles node-editor
node-editor-narrow node-terminal node-terminal-narrow`: exit 0, 24 pages, 0 violated, 0 undecided, 0 without a result.
`npm run test:legal-a11y`: exit 0.

**Suites on the final code, files named:** `editor/editorUi`, `editor/groupState`, `nodeKeybindings`, `browserKeybindings`, `makerPorts`,
`makerWindowEngine`, `serveHandshakeWait`, `playbookContainedJob`, `nodeOsAddons`, `team/externalOrchestrator`, `desktop/harnessQemu`,
`desktop/harnessCompositor`, `makerSerial`, `judgeLocalDarwin`, `nodeTerminalUi`, `l10n`, `teamHarnessFixture`, `harnessInit`, `manifest`: exit 0,
18 files passed, 1 skipped; 221 passed, 46 skipped by platform, 0 failed. The keyring refusal never fired. First starts here: PowerShell
1,131 ms, compiler 308, port list 643, Chrome 825. The whole unit suite did not run here.

**Only hosted CI decides:** `makerWindowEngine` with the cmdlets gone, and its step line if not; `makerSerial` on macOS; the `EPERM` path
on macOS; `judgeLocalDarwin`'s fixture; the whole accessibility gate; how far the guest gets past `hyprctl`.
