# CC-WINFIX6 — hosted CI run 41578891657, the two reds left (2026-11-02)

Claude Code lane `CC-WINFIX6`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch `cc/winfix6` from `cc/winfix5` at `acf08703d9`,
on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**. Muse requests: **0**. Nothing was pushed, rebased, stashed,
reset or tagged. "Hosted shape" is as in `cc-winfix3.md`. No vault or credential-store suite, broker or keyring ran here.

Two things outside the usual shape, both read-only for anything but this worktree. Earlier runs' passing job logs came from the hosted run (`gh run view`), into this
worktree's `temp/`. And the owner's stopped `archlinux` WSL distro ran Linux Node 22.23.4 from this worktree's `temp/`, because the first fault cannot happen on Windows.

## 1. The reds

| Red                                                 | Job       | Cause                                                                                                               | Shown or inferred                                                                                                                                    | Side |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `judgeP2Delivery`, 7 cases                          | ubuntu 7  | The gate's report lost its tail: a line at a time, then `process.exit`, which drops what a POSIX pipe has not taken | The cut is **shown**: the report says 230 and stops at the 197th. The late reader behind it is **inferred** for that run, and reproduced under Linux | gate |
| `teamModelsFirstPaint`, `Hook timed out in 60000ms` | windows 2 | The start hook ran out on a stalled VM, before any page                                                             | **Inferred**: the log names no step. No page was involved, by the code                                                                               | test |
| `teamModelsFirstPaint`, `Hook timed out in 30000ms` | windows 2 | Teardown waits on a promise nothing settles when the hook made no server                                            | **Shown**: drill T1 gives the same words                                                                                                             | test |
| `teamModelsFirstPaint`, first case, RLF-CIFIXC's    | macos 2   | Chrome's first page is a one-time cost, and it passes a case's 5 s there                                            | **Inferred** from four runs' times                                                                                                                   | test |

**One cause with `makerReviewBrowser`?** Not that I can see. Its `globalThis.sent` is undefined in the page straight after a reload (line 574). Neither of these two involves page state.

## 2. `judgeP2Delivery`: the report lost its tail

**The 230 are all planted.** The child split run plants 46 sources, each into 4 parents and out of its own child: 46 × 5 = 230. So the shared gate runs were right, and no other file changed `dist/`. The suite now asserts that count.

**The cut.** The log's report is its header plus 197 problems, ending on a line boundary after `dist/extension.js carries .../lint/syntax.ts`. The whole report is 20,708 bytes. The seven failed cases are exactly the ones whose lines come after that point, and every case before it passed.

**Why.** The gate wrote each problem with `console.error` and called `process.exit(1)` straight after. Node makes stdout and stderr pipes synchronous only on Windows. On POSIX a write queues once the pipe's buffer is full, and `process.exit` drops the queue.

**Why it is new.** CC-WINFIX3's speedup. One fault per gate run made reports of a few lines, and one run holding a whole family's faults makes one of 230. So that lane exposed this, though the gate's fault is older.

**Why it comes and goes.** Whether the parent reads during the child's burst. It passed on Ubuntu the run before. Inferred, from these measurements under Linux, with the real gate and the planted faults:

| Reader                                               | Listed of 230               |
| ---------------------------------------------------- | --------------------------- |
| `spawnSync`, as the suite reads it, idle machine     | 230                         |
| `spawnSync`, parent and gate pinned to one CPU       | 230                         |
| A parent that does not read until the gate has ended | **170**, the same run twice |
| That parent, with this fix                           | 230                         |

I could not make `spawnSync` itself lose lines on demand, so the hosted run is the only time that has been seen. WSL's 170 against hosted's 197 is the two kernels' buffers (inferred). **The hosted shape on this PC cannot show it**: Windows pipes do not queue. Here the suite passed before and after.

**The fix is in the gate**, because the gate is what was wrong: a report that loses its tail hides real problems from whoever reads it. The report is now one write, and the exit waits for its callback.

**The suite stays fast and each case proves what it did.** The same gate runs, none added. All 103 cases are unchanged. A 104th needs no gate run: each shared run's report holds exactly the problems it planted, so a report cut short now says that instead of reading as guards that did not fire.

**Left as they are:** nine other `scripts/check-*.mjs` have the same `process.exit` shape. None of them is asked to print a burst this long, and I did not change them.

## 3. `teamModelsFirstPaint`: slow or stuck?

**The page is neither, and no product fault shows.** On Windows the failure never reached a page: the start hook, as it stood, opened none. On this PC, in the hosted shape, the page paints in about half a second, and the first is no slower than the rest (navigation 73 to 123 ms, the button 429 to 606 ms).

**The hook is usually quick.** On hosted Windows this file took 15.7 to 17.3 s in the three runs before, about 11 s of that in cases, so the hook took 5 to 6 s. Here: bundle 1,745 to 2,137 ms, rig 22 to 28 ms, Chrome launch 302 to 460 ms.

**The VM was not.** Against the run before, the same shard's files summed to 421 s instead of 207 s, and the files just after this one ran far slower: `processTreeJobStop` 1.4 s to 23.0 s, `deviceJournal` 2.0 s to 12.9 s, `nodeGitLocalBare` 1.9 s to 12.4 s. So a stall is the inference. Whether the hook was slow in it or stuck, and at which step, **the logs do not say**. They narrow it only this far: teardown's 30 s means no server existed yet (or `browser.close()` hung), so the hook stopped at or before the Chrome launch. I also cannot rule out that a hung hook slowed those later files, rather than the other way round.

**The 30 s is a separate fault, and a real one.** `await new Promise((resolve) => runtime.server?.close(resolve))` never settles with no server.

**What changed, with no budget raised or lowered:**

- **The bundle builds in global setup.** It is 81% to 84% of the hook here. This is RLF-CIFIXM's `2566d30494` (on `refs/rigs/macmini/rec/rlf-cifixm`, not on `main`), with its helper and setup hunk as they stand. That commit also dropped the hook's `60_000`, and I kept it, since this very run shows what a stall does. **Merging that branch will meet this line.**
- **Chrome's first page is now the hook's.** See below.
- **Teardown** closes only a server that exists.
- **A hook that did not finish says where it was**, for example `the start hook did not finish: it was at the Chrome launch`. The next stall names the step these logs cannot.

**macOS: not one cause, but the same hook.** macOS never had a hook failure. It fails the first page case at its 5 s in all four runs read, with the pages after it at 2.0 to 4.2 s. That page costs more than the later ones on every OS (Ubuntu 2.0 to 3.7 s against 1.6 to 1.9 s, Windows 2.8 to 3.0 s against 1.5 to 1.8 s). One-time cold costs belong in a hook, and the hook is here, so I moved it. **That is in RLF-CIFIXC's area**, so they should know. It may not be all of it: in run 41561620943 the second page also failed, at its 2 s locator.

No CHANGELOG line: gates and tests only, and no person can see any of this.

## 4. Drills

Each line broken on purpose, in the hosted shape unless named, restored byte-exact (the tool compared hashes), run again.

| Drill                                                               | Red                                                                                         | Green                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| J1: the gate's report stops at the hosted run's 198th line          | exit 1, 8 failed, 96 passed: the hosted seven with their words, and the new case: `got 197` | exit 0, 104 passed                                                  |
| L1: the gate reports line by line again, **under Linux**, read late | header 230, **170 listed**                                                                  | header 230, **230 listed**                                          |
| T1: the old teardown line, with no Chrome to launch                 | exit 1: `Chrome unavailable` and `Hook timed out in 30000ms`, the hosted words              | exit 1 by design, `Chrome unavailable` alone; with Chrome, 9 passed |
| T2: the first page never paints what the hook waits for             | exit 1 at the 60 s: `it was at Chrome's first page`                                         | exit 0, 9 passed                                                    |
| T3: global setup stops providing the bundle                         | exit 1: `Models first-paint build missing from global setup`, `it was at the bundle`        | exit 0, 9 passed                                                    |

L1's gate exits 1 both ways, by design, since the faults are planted. Its red and green differ in what reaches the reader.

## 5. Gates

Node 22.23.4, on `3ce71879be` (this record's commit adds only this document):

| Gate                                                                                                 | Exit   |
| ---------------------------------------------------------------------------------------------------- | ------ |
| `npm run format:check`                                                                               | 0      |
| `npm run lint`                                                                                       | 0      |
| `npm run typecheck`                                                                                  | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap` | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                          | 0 each |
| `npm run check:host-api`                                                                             | 0      |
| `npm run build`                                                                                      | 0      |
| `teamModelsFirstPaint`, `browserEnglish`, `judgeP2Delivery` together (hosted shape), first run       | **1**  |
| `judgeP2Delivery` alone (hosted shape), second run                                                   | **0**  |

**The first run's exit 1 is reported, not hidden.** `teamModelsFirstPaint` passed 9 and `browserEnglish` passed 3, and `judgeP2Delivery` failed while collected: `spawnSync ... ETIMEDOUT` at `vsce ls`, which is CC-WINFIX3's 300 s hung bound. The PC was loaded by something other than this lane: that run took 577 s against 272 s for the same suites before it (`browserEnglish` aside), and `format:check` straight after it took 580 s against 157 s. Measured alone with the PC idle, one listing took 62 s. The bound did its job, and no budget moved. I ran the suite once more because of that named cause: **104 passed**, with the PC at 9% load. Whether a hosted runner can reach that bound is open; none has.

Not run: the whole unit suite, the vault and credential-store suites, the packed product's real-life run (it spends money, and the brief makes no provider request) and hosted CI.

## 6. Only hosted CI can decide

- **The gate under the hosted parent.** I could not force `spawnSync` to lose lines, so "it no longer happens" rests on L1 and on one write reaching the pipe whole. If a report is cut again, the new case says so in words.
- **Whether a Windows stall comes back, and at what step.** The hook now does less, and the line will say where it stopped. If it names the Chrome launch, this lane's move did not reach the cause.
- **Whether the first page in the hook cures macOS's first case.** Inferred, and not reproducible here.
- **The bundle in global setup on all three hosted OSes.** It passed here and, per its record, on the macmini.

**Not settled:** which step of the hook stalled, why the VM stalled, and whether the slow files after it were cause or effect.
