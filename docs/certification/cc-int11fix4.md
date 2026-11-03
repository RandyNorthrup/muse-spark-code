# CC-INT11FIX4 — hosted run 41723994114 on `20c19c7f4`

Lane `CC-INT11FIX4`, branch `cc/int11fix4` from `cc/int11fix3`. 63 jobs passed, 15 failed, 1 cancelled. Nothing pushed.
No Muse request, no paid call, no real `muse`, `MUSE_TEST_REAL_CLI` unset here, no vault or credential-store file
imported, no budget or timeout raised. Every run named its files through `temp/vt2.ps1`.

## The cancelled job, and what is a real red

**Cancelled: `build / static gates (macos-latest, lint)`.** GitHub's annotation says `The job has exceeded the maximum
execution time of 25m0s`. The same job was cancelled on run 41677635406 too, so **macOS lint has not finished on either
run**, and "every static gate is through" was not quite so. `format:check` took 4 minutes and `lint:js:main` 19, and
`lint:js:tests`, `lint:css` and `lint:ps` never started. **This is a real red**, fixed below without touching the 25.

| Job                                                     | Real?                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| tests: ubuntu 5, windows 6 and 14, macos 4, 7, 8, 9, 12 | Real: the files below                                                              |
| `desktop / compositor session in guest (x86_64)`        | **Real, two failures**, item 6                                                     |
| `static gates (macos-latest, lint)`                     | **Real**, cancelled at 25 minutes                                                  |
| `platform release artifacts`                            | Roll-up: its log reads `CHECKS: cancelled`, so the job above                       |
| `quality` (3), `dictation helper`, `package`            | Roll-ups: each log reads `CHECKS: cancelled`, `UNIT: failure`, `PACKAGES: failure` |

Last round's other jobs held: `harness suites (arm64)` is not in the failed list now, so its Chromium install works, and
`static gates (macos-latest, build)` passed with `typecheck:e2e`'s 4 GB.

Fix: `format:check` and `lint:js:tests` move to the `unit lint` part, which took 11 minutes on macOS. `lint` keeps
`lint:js:main`, `lint:css` and `lint:ps`, about 22 of its 25 minutes on macOS. That is thin: it stays under by about 3
minutes on this run's times, and the next growth in `lint:js:main` needs another split. Every gate still runs in exactly
one part, and drill P1 shows `manifest` holds that.

## 1. `externalOrchestrator` (Windows): a real product fault

**Shown, not inferred.** On this PC a child's stdout ends about 2 ms before its exit is reported, in every variant I
measured (`stdout-end@37 exit@39`). The failed turn comes from the first of those, when the connection closes. A resume
asked right then found `this.live` still set and answered from what the host held, so the person's earlier messages,
which the agent holds, were missing. A new session at that moment died with `ACP connection closed`.

`settleEndedProcess` waits the agent out, and ends it if its output closed but it did not, before a resume or a new
session. Two new cases ask from the turn's own listener, which makes the order certain.

My first two guesses were wrong and I took them out, so they are not in the code: that a replay and its answer arriving in
one read let the answer overtake (a fixture forcing it stayed green), and that closing the agent's pipe forces this order
(Windows keeps it open until the process ends).

## 2. `makerWindowEngine` (Windows): last round's reading was short

**The printed first-start times:** shard 6: PowerShell 3057 ms, compiler 1913 ms, Chrome 5997 ms. Shard 14: 3574, 2286, 5273. So they were paid before any worker, and **this case still timed out**. For it, last round's cause did not hold as
written: the warm-up queried `Win32_Process`, and the case lists ports through `Win32_PnPEntity`. `m96dCoordinatorEndpoint`,
`runtimePullRequestRecords` and Windows `feedbackBrowser` did clear, so the reading held for those (inferred from their
green).

Now the port list's class is warmed too, with a line of its own, `Windows port list cold start`. **Still inferred:** no log
times that query. The next log says: a large number there confirms it, and if the case times out after a small one, the
cause is elsewhere.

## 3. Hooks on macOS and Ubuntu

The warm start was Windows only, yes. Read from the logs:

- `feedbackBrowser`, Ubuntu: `chromium.launch` passed its 10 s hook. Chrome's first start now happens in global setup on
  every system.
- `nodeBrowserWorkspace`, macOS: one 10 s hook held the build, the server and the Chrome launch. The build moves to global
  setup, as the Models first paint's did, under the folder the server serves, and Chrome gets its own hook. It still never
  writes `dist/webview/node`.
- `feedbackBrowser`, macOS: not a hook. The first case took over 5 s against about 3 s for the rest: the first real page
  compiles the bundle. It loads in a hook now, in both suites.

Causes inferred from the logs' timings. No deadline moved, and the new lines print each time.

## 4. `teamProcessWorkers` (macOS): two real product faults

- **The bare code.** `TEAM_HOST_BUSY` reached the person as the failure. A launch failure now says what happened and what to
  do, keeps the code as its cause and logs it, and no other `TEAM_*` code from the lifetime reaches a person bare.
- **Why it was busy.** The load guard compared `os.freemem()` with a 2 GiB floor, and the guard's first sample has no
  processor reading, so in these 200 ms cases only memory could trip it: the runner read under 2 GiB. On macOS that figure is
  free pages alone (from libuv's source as I know it; `system.ts` records the same of the older available-memory call), which
  leaves out all the system can reclaim. So a Mac in ordinary use could read as short of memory, and its team agents and check
  slots were refused. The guard now reads macOS's headroom from libuv 1.52 and otherwise says unknown, which is not pressure,
  the machine governor's own rule. The processor half of the guard stands.

**Limit:** hosted macOS has libuv 1.51, so there the guard's memory half is now silent, and a Mac truly short of memory on an
older libuv is no longer held by this guard, only by the machine governor. `process.availableMemory()` ran only on this PC; a
Mac with 1.52 is not in reach here. RLF-CILIN's case on Linux stands, and the two `--no-user-mcp-servers` and arguments cases
need the next macOS log.

## 5. `makerSerial`, `makerSerialAdapters` (macOS)

**The log still does not say.** The test started socat with `stdio: 'ignore'`, and the product keeps the helper's stderr out
of its logs. `serial-helper-ended-before-ready` needs a close with no status line, which `serial.py`'s own failure path
(`serial-unavailable`) does not give, so the python process itself may be dying (inferred).

Added: a failed case now reports socat's exit, its `-d -d` log, whether its device is still there, and the raw helper run once
more by hand with its exit and stderr. `SOCAT` also finds Intel Homebrew's `/usr/local/bin/socat`, where it used to skip on the
Mac mini.

`makerSerialAdapters` is separate: 5 s on the first `/usr/bin/python3` of a shard (inferred). Global setup now runs that shim
once and prints `macOS python3 cold start`.

**What to do with the $4: nothing yet.** The next hosted log carries all of this free. Only if it does not settle it, one small
run on the Mac mini, on this head, no model involved:

```sh
brew install socat
npm ci
npx vitest run test/unit/makerSerial.test.ts --maxWorkers=1
```

Leave `MUSE_TEST_REAL_CLI` unset and paste the whole failure. It is Intel, hosted is Apple silicon, so a green there says the
fault is the hosted machine's. RLF-CIMAC's own note stands: installing socat changes that machine, and it is your call.

## 6. `compositor session in guest`: two failures, one hiding the other

Upload: the container runs as root and swtpm keeps its log private, hence `EACCES`. A step with `if: always()` gives the folder
to the runner before the upload.

**The session itself failed and that stands:** `qemu-desktop-test: eof (qemu exit 0)` and exit 1, before the upload. The guest
powered off without printing `M111QA-SESSION-OK`. The failed upload had taken `serial.log` with it, so nothing says why. On
failure the job now prints the end of `serial.log`, and it uploads. Last round's `curl -fSL` and `chmod` got it this far: the
image downloaded, 325 MB. Not run here: hosted decides, and the next log should name the guest's real fault.

## Drills

Each restored byte-exact (sha256 compared), files named.

| Drill | Break                                       | Red                                                                                                |
| ----- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| X1    | a resume does not wait out the ended agent  | exit 1: `expected [ 'go' ] to include 'earlier ask'`, **the hosted red's own words**               |
| X2    | a new session does not either               | exit 1: `Error: ACP connection closed`                                                             |
| G1    | the guard reads macOS's free pages again    | exit 1: `expected 10528661504 to be undefined`                                                     |
| G2    | an unknown reading counts as pressure       | exit 1: `expected true to be false`                                                                |
| W1    | the bare code reaches the person again      | exit 1: `expected Error: TEAM_HOST_BUSY to have property "message"`, and the same for another code |
| P1    | `format:check` in no part of the static job | exit 1, `manifest`: `expected [ 'build', 'check:art', …(31) ] to deeply equal [ …(32) ]`           |
| N1    | the node page ignores the suite's own build | exit 1, `nodeBrowserWorkspace`: `Hook timed out in 30000ms`, no page without `?build=`             |

In one X1 run the older `die` case failed the same way too, under the load of a drill, with no forcing. That is the hosted red
on this PC. The serial evidence, the macOS gates and the guest job have no drill here: they need macOS or Linux.

## Gates

On `11979245e`, one after another, Node 22.23.4. Every exit is 0.

| Gate                                                                                                 | Exit |
| ---------------------------------------------------------------------------------------------------- | ---- |
| `format:check`, `lint`, `typecheck`                                                                  | 0    |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                         | 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches` | 0    |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`           | 0    |
| `check:workflow-scripts`, `deadcode`, `cycles`, `duplication`, `build`, `security:audit`             | 0    |

The pinned semgrep over the files this lane changed: 0 findings, exit 0. Budgets all under: `dist/resourceGovernor.js` 124.8 of
125, `dist/teamProcess.js` 367.0 of 375.

Changed suites on that head, files named: `team/externalOrchestrator`, `teamLoadGuard`, `teamProcessWorkers`,
`teamProcessLifetime`, `makerWindowEngine`, `feedbackBrowser`, `nodeBrowserWorkspace`, `nodeWorkspaceBuild`, `makerSerial`,
`makerSerialAdapters`, `manifest`: 108 passed, 19 skipped by platform, 0 failed. The keyring refusal never fired. The first-start
lines here: PowerShell 366 ms, compiler 207, port list 450, Chrome 577. The whole unit suite did not run here.

**Only hosted CI decides:** whether macOS lint now finishes; the macOS team cases; the Ubuntu and macOS hooks; `makerWindowEngine`;
what the serial evidence says; what the guest's serial log says.
