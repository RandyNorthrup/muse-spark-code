# CC-INT11FIX6 — hosted run 41761798108 on `63590e634`

Lane `CC-INT11FIX6`, branch `cc/int11fix6` from `cc/int11fix5`. 73 jobs passed, 7 failed. Nothing pushed. No Muse request, no paid call,
no real `muse`, `MUSE_TEST_REAL_CLI` unset here, no vault or credential-store file imported, no budget or timeout raised. Every vitest
run named its files through `temp/vt2.ps1`. `gh` was used read-only, for job times and run heads.

**The job rows.** Real: `tests (ubuntu-latest, shard 2)` and `tests (windows-latest, shard 16)`. Roll-ups: quality (3), dictation helper,
package; each log reads `CHECKS: success`, `UNIT: failure`, everything else `success`.

**What last round's fixes did.** On this run `makerWindowEngine`, `makerSerial`, `externalOrchestrator`, `judgeLocalDarwin`,
`nodeOsAddons`, `playbookContainedJob`, `serveHandshakeWait`, accessibility and the guest session are all green. That is one run, so it
supports those readings and does not prove the intermittent ones. macOS `lint` took 16.0 of its 25 minutes.

## 1. `makerReviewBrowser`: `storage-denied reload retains static Stop`, intermittent

| Run                                   | The case                  | Same suite, other cases                                                |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| 41516831678                           | passed                    | macOS `worst-case search`, Windows `CR is visible` (not this)          |
| 41578891657                           | **failed**, macOS, Ubuntu |                                                                        |
| 41590781372 to 41738951665, five runs | passed                    | the suite did not change across them (checked against each run's head) |
| 41761798108                           | **failed**, Ubuntu        |                                                                        |

**What makes it intermittent.** The case read the page at the moment `load` returned, and each time it failed `globalThis.sent` did not
exist: the fixture's module had not run. The case also had 1,000 ms (`hostDelay`) to take its look before a reply it wanted not to have
come, a second clock that never failed but could.

**Not reproduced, and the first clock's mechanism is not shown.** Here, reading the page at `load`: `sent` was there 60 times of 60, and
25 of 25 with the reloaded module held back 400 ms, where `loadEventEnd` read about 440 ms, so a real `load` does wait for it. Playwright's
`load` comes from CDP's `Page.lifecycleEvent` with no check of which document sent it (`coreBundle.js`, `_onLifecycleEvent`), which is a
candidate on a loaded runner and no more than that.

**The fix makes that question not matter.** The reloaded document's own `makerReady`, reaching the host, is now the clock: it is sent
after `sent` exists and the Stop is wired, so the read cannot come first. The host holds its answer until the case says so, so "before
the replay" is a fact and not a race. No bound moved, and the case takes no fixed wait at all (1,356 ms here). If the module truly never runs on a reload, the case now fails by its own timeout instead of misreading, and that would be a
different fault to read.

**An approval card does not lose its state on a reload: not a product fault.** The card is host-owned. `MakerApproval.reopen` replays the
exact frozen request and revokes the old document's review, so Send once starts disabled again, and nothing of it lives in browser
storage, which is why denied storage changes nothing (`reloadPanelSurface.ts`). The case's later lines read that, and drill R3 shows it
depends on that replay.

**One thing near it, stated plainly, not changed.** The Stop that `html.ts` paints has no handler until `listenForMaker` runs. A click in
that window does nothing and says nothing. The window is real: the hosted reads above were inside it. On this quiet PC, three readings: `domInteractive`
at 17 to 22 ms, `load` at 38 to 65 ms. The status bar's Stop (`vscodeMakerHost.ts`) is independent of the page. A fix
means a script of its own ahead of the bundle, under the panel's CSP and its one `acquireVsCodeApi`: a product decision, not this lane's,
and it is your call whether it wants a lane.

## 2. `estimatorPricePackaging`: `Hook timed out in 60000ms`, a thin margin

**Which step: the log does not say.** It has the timeout and `77380ms`, nothing more.

**`AttachConsole failed` is not the cause,** as `cc-int11fix.md` said. It is node-pty's helper from another suite's kill, one of several
files printing into the same shard log. It also prints on 41619068707 and 41677635406, where this suite passed.

**Intermittent, and not stuck.** The same work on every run, the suite and its helper unchanged from 41677635406 to this one:

| System           | Suite time                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| Windows shard 16 | 37.4, 35.0, 31.8, 30.2, 32.7, 44.0 s on six earlier runs, **77.4 s** on this one |
| macOS            | 22 to 31 s                                                                       |
| Ubuntu           | 20 to 22 s                                                                       |

**No build ran in this hook.** The real build already runs in global setup. What ran, timed here with the hook as it stood:

| Step                                                 | Here      |
| ---------------------------------------------------- | --------- |
| Build declarations                                   | 78 ms     |
| A copy of the build's inputs: `src`, `docs`, `test`… | 9,634 ms  |
| The bundles' parse, `requiredBundles`                | 13,939 ms |
| The copy of `dist`                                   | 903 ms    |
| The VSIX builder's file list                         | 5,022 ms  |

All of it but the last step is synchronous, so the hook's timer could not fire until it yielded, which is how a 60 s hook shows 77 s.
**Which step grew on hosted is not known:** this log does not say. The line below prints it from now on.

**The fix.** Nothing in the suite reads those inputs, so that copy is gone. The parse and the file list moved to
`test/unit/helpers/estimatorPackaging.mjs`, run by global setup from the shared build, read only, and only when this suite is selected,
where no deadline applies. There is no hook left to raise, the case takes 3 ms, and each step's time prints on every run:
`estimator packaging inventory: build declarations 138 ms, required bundles 14959 ms, copy of dist 1138 ms, file list 8368 ms`. A failure
there is handed to the suite to say, so the shard's other files still run (drill E2). **The cost:** that shard's global setup is longer by
those seconds, and no other shard pays.

**The same exposure, not changed:** `packagedBundles`' hook makes the same whole copy under its own 60 s, and `devicesPhase2Harness`' under
120 s. Neither has failed that way on the last ten runs. If one does, this is the first place to look.

## Drills

Each restored byte-exact (sha256 compared), files named.

| Drill | Break                                                        | Red                                                                                                   |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| E1    | `.vscodeignore` no longer lists a bundle production requires | exit 1, `estimatorPricePackaging`: `expected [ 'dist/estimatePrices.js' ] to deeply equal []`         |
| E2    | the inventory throws in global setup                         | exit 1: `The inventory was not made: Error: drill: no inventory`; the other file's 5 cases passed     |
| R1    | a reloaded document never says it is ready                   | exit 1, `makerReviewBrowser`: 4 failed, this case among them                                          |
| R2    | the static Stop does nothing                                 | exit 1, 2 failed: `expected { v: 1, type: 'makerReady' } to deeply equal { v: 1, type: 'makerStop' }` |
| R3    | the host does not replay the pending approval                | exit 1, 3 failed, this case among them                                                                |

The original race has no drill: it could not be produced here. Run 41516831678 is named in `285e6683d`'s message by mistake; it failed other
cases of this suite. The comment was corrected in the next commit and this record stands for the message.

## Gates

One after another on `e250e61c1`, the head before this record, Node 22.23.4, every part of the static job. This also covers last
round's two late fixes, which had missed full `lint` and most of `typecheck`. **Every exit is 0.**

| Gate                                                                                                 | Exit |
| ---------------------------------------------------------------------------------------------------- | ---- |
| `format:check`                                                                                       | 0    |
| `lint`: `lint:js` (main, unit, tests), `lint:css`, `lint:ps`                                         | 0    |
| `typecheck`: `host`, `webview`, `desktop`, `unit`, `e2e`, `integration`, `faults`                    | 0    |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                         | 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches` | 0    |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`           | 0    |
| `check:workflow-scripts`, `deadcode`, `cycles`, `duplication`, `build`, `security:audit`             | 0    |

The pinned semgrep 1.180.0 over this lane's five files: 0 findings, exit 0. Last round's four findings are on files this lane did not
touch, and the hosted `semgrep` job passed on `63590e634`.

**Suites on that head, files named:** `estimatorPricePackaging`, `makerReviewBrowser`, `webviewBundleRoot`, `feedbackBrowser`, `manifest`:
exit 0, 5 files, 73 passed, 0 failed. The keyring refusal never fired. The whole unit suite did not run here. On this record's own head:
prettier on the record and `check:plan`.

**Only hosted CI decides:** whether the reload case stays green on Ubuntu and macOS, where only it has failed, and which step of the
inventory takes the time on Windows, which its line now prints.
