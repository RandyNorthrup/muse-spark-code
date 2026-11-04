# CC-INT12FIX — a refused landing says why, everywhere (2026-11-04)

Lane `CC-INT12FIX`, worktree `C:/Users/Randy/Coding/mx-cc-small3`, branch `cc/int12` from `45edc0c346`, on the owner's Windows PC, with a
throwaway Linux checkout in WSL. Nothing pushed. No Muse request, no paid call, no real `muse`, `MUSE_TEST_REAL_CLI` unset, no vault or
credential-store file run or imported, no budget, bound or timeout raised, scratch in the worktree's `temp/`. Every vitest run named its
files, `--maxWorkers=4`.

## The red, and what was behind it

`acpTeamSession` > `says a card that failed for real…`: "timed out waiting for the failed card's sentence", reproduced alone.

**The coordinator's read, checked.**

| The read                                                             | What the code does                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A held lock is now an answer, not a throw, so the catch never speaks | **Right.** `merges.merge` returns, `decideMerge` returns cleanly, `askMerge` says nothing                                                                                                                                                                     |
| ...and that answer is `{status:'rework', refusal:{kind:'busy'}}`     | **Not so.** `TeamLanding.land` asks `knownHolder` first, and a bare lock is a known holder: `branched`, with a real branch `agents/landing/<uuid>` and `holder:{kind:'lock',path,owner:null}`. Printed from the real run                                      |
| `busy` is what a person meets                                        | Only when an earlier landing's record is open (`hasOpenLanding`) or a lock appears between the holder check and the take. A real lander process paused mid-landing makes it here                                                                              |
| `askMerge` ignores the refusal, manual and bypass                    | **Right**, both                                                                                                                                                                                                                                               |
| `mergeRefusal(taskId)` is the source                                 | **Right, with one guard.** It is set before `decideMerge` returns, on both paths. It also stays recorded through a later Discard, so ACP reads it only after a Merge. Drill I3                                                                                |
| The model's tool answer carries the refusal                          | Not in this path: the merge tool answers `{task_id, position}` at once, and the merge flow's own answer goes to `decideMerge`. The refusal's kind reaches the model through the queue's `returned` event (`teamHost.ts:987`). Not changed; named for the lead |

A `busy` refusal also carried no holder at all, so "name the holder" had nothing to read. The port (`teamLandingEntry.ts`) now reads what holds
the repository at that moment and attaches it. `TeamLanding`'s own logic is untouched.

## 1. ACP tells the person

`WorkspaceTeam.sayRefusedLanding` after the landing's `decideTeamMerge`, on the manual path and the bypass path, once per refused landing, as an
`agent_message_chunk`. ACP has no Undo Merge, and `changedDuringLanding` offers one, so `changed` has its own sentence
(`changedDuringLandingNoUndo`, all 14 tables) through `refusedLandingText`.

**Named, not changed:** the `team/merge/<id>` tool call still ends `completed` when the landing was refused, so an editor may show a finished call
beside the sentence. That status is the card's (`status:'completed'` on every outcome) and the brief asked for the message.

## 2. One source for the words

`src/core/team/teamMergeRefusalWords.ts`, `mergeRefusalSentence`, read by `teamMergeFlow.ts` for the card, by `teamTrafficProjection.ts` for
Traffic (its `describeMergeRefusal` is gone) and by ACP. English and all 14 tables. Each sentence says what to do next.

| Refusal                     | The person reads (English)                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stale`                     | The workspace changed after this merge was checked, so nothing landed. Land it again to check it against your current files.                                                                                                                     |
| `denied`                    | This landing was not approved, so nothing landed. Land it again to be asked again.                                                                                                                                                               |
| `busy`, nothing holds it    | An earlier landing is still open, so nothing landed. Recover it, then land this one again.                                                                                                                                                       |
| `busy`, another landing     | Another landing holds Git's lock at `{path}`. Wait for it to finish; if its window is gone, remove that file yourself and recover the landing. Nothing landed: land it again after that.                                                         |
| `branched`, a bare lock     | Git's lock is held at `{path}`. If no Git command is running, remove that file yourself: Muse Spark Code never removes a lock it did not take. Nothing landed in your files: the change is kept on branch `{branch}`, ready to merge after that. |
| A Git operation in progress | A Git operation is in progress (`{path}`). Finish or abort it. ...                                                                                                                                                                               |
| Another window              | Another window is landing in this repository. Wait for it to finish. ...                                                                                                                                                                         |

The holder is read by its shape and never printed as it came, and the sentence gives the branch's short name, the one a person types. The
technical detail goes to the log through `mergeRefusalForLog`, in kinds and ids: `Team landing refused: branched, holder lock, landing <id>,
window <id>, branch <ref>`. No path in the log, rule 18; the sentence has the path, because the person has to act on it.

## 3. The tests

- **The red case keeps its purpose:** the task's copy is removed while the person decides, so the landing really throws, and the session reads
  `actionFailed`. Drill I5 shows what the filter is keeping out.
- **A real held lock, manual and bypass:** real git, the real team host. The person reads the bare-lock sentence once, naming the lock and the real
  branch; their file is untouched. **A real lander process mid-landing, manual and bypass:** the busy sentence, naming the landing.
- **A refused landing then a Discard** says one sentence, not two.
- **`teamHostRealParts`:** the card's `teamDecision` and Traffic's `reason` are that same sentence over a real held lock.
- `teamMergeRefusalWords.test.ts`: every holder comes from the real probes over real folders; the German table; the log line.

`teamLandingPause`'s exact refusal moved: a busy refusal now names its holder, and the case says so.

## 4. The two named items

**The headless board.** `execTeamEntry.ts` shares `core/team/teamBoardFile.ts` with the ACP agent. **What this does not change today:** the team
host latches `saveFailure` after a failed save of its tasks, and nothing else in a headless run writes after it, so a poisoned chain had no later
write to poison on this path. What can be shown there, and is: a failed write takes its temporary with it, and the run's end reports the failure,
`EISDIR`. That a failed write does not reach the next is `teamBoardFile.test.ts`, over the same code.

**`--mcp-always-load <server>`.** No design call was needed: repeated as `--untrusted-file` is, beside `--mcp-defer-tokens`, refused off the Model
API as it is. A blank name is refused in words (`execServerNameEmpty`, all 14 tables). On the built agent: `node dist/acp.js exec --backend modelApi
--max-budget-usd 1 --mcp-always-load " " task` says `--mcp-always-load needs the name of an MCP server.`, exit 2; with `--backend museCode`,
`These options require the Model API backend (--backend modelApi): --mcp-always-load.`, exit 2. **Its reaching the host:** `backends.ts` passes it where it
passes the threshold, by reading and type-check only; no run here declares tools, since that needs a model call.

## Hosted red A: `lands the change on the editor's approval`, and what it found

Run 41794406176, Windows shard 3: red at 4,698 ms, 3,000 of them the suite's poll, so that landing had not finished 3 s after the answer. How much
longer it needed, the log cannot say.

**What a landing really costs.** Real landings through the real team host and real git, timed from the person's answer, git's processes counted at
`runGit`. The timing code lived in a throwaway copy of the suite, deleted after each run.

| Repository  | Where                                                   | Samples | Answer to file in place, ms  | Answer to card closed, ms    | git processes                      |
| ----------- | ------------------------------------------------------- | ------- | ---------------------------- | ---------------------------- | ---------------------------------- |
| 1 file      | this PC, none of my other runs going                    | 6       | 1,574 to 2,555, median 1,845 | 1,736 to 3,759, median 2,047 | 93                                 |
| 1 file      | beside four other real landing suites, `--maxWorkers=4` | 6       | 2,411 to 4,120, median 3,434 | 2,714 to 4,377, median 3,811 | 93                                 |
| 101 files   | this PC                                                 | 2       | 6,951, 9,135                 | 9,110, 11,498                | 493, of them 407 `hash-object`     |
| 1,001 files | this PC                                                 | 2       | 117,172, 123,567             | 145,351, 151,708             | 4,093, of them 4,007 `hash-object` |
| 1 file      | Linux, WSL's own disk                                   | 2       | 205, 237                     | 229, 277                     | 93                                 |
| 1,001 files | Linux, WSL's own disk                                   | 2       | 5,966, 6,002                 | 7,817, 7,864                 | 4,093                              |

So the red reproduces here in kind: four of the six loaded samples had not put the file in place at 3 s, on a 20-thread PC. It was not a slow runner
meeting a fair deadline; the deadline sat inside the real cost. The same 93 processes take about a quarter of a second on Linux, so this is what a process costs on Windows, and only hosted Windows went red. `cc-small3.md` records about 0.7 s for the whole case before the checked landing merged.

**Product finding, not changed here, as briefed: on this base a landing's cost is linear in the size of the tree, one process per file, four times over.**
`StagingCopy.snapshot` (`src/host/team/stagingCopy.ts`) spawns one `git hash-object -w --stdin` per tracked or unignored file, in sequence, and a landing takes four snapshots: the tree, the
merged copy, the tree under the lock, the tree after (`teamLandingEntry.ts`, `TeamLanding.land`). In the 1,001-file repository `hash-object` is 139 to 143 s of the 145 to 151 s, about 35 ms a process.
**Git's real `index.lock` is held across the last two of those: 56 to 67 s there**, and any git command of the person's that needs the index refuses for that long. At this repository's 11,230 tracked files that is about 26 minutes
a landing by arithmetic from the table; I did not run it.

**CC-WINLAND2 found the same thing on its own and has fixed it, on `cc/winland`, not on this branch:** `50fd5c644b` hashes the tree in one `git hash-object --no-filters --stdin-paths`, and its message gives 93 processes at
any size. Read, not run by me. That leaves the 93, which is the 1-file row above and the cost that turned this test red, so this test's fix stands with or without that merge.

**The fix to the test.** Waiting longer would only have moved the number. `eventually` and its deadline are gone from `acpTeamSession.test.ts`: every wait
in the file now ends on something the product itself does. `lands the change` waits for the merge card to close, `team/merge/task-merge` completed, which
`runMergeFlow` sends after the landing and its save have finished, and only then reads the file, so a landing that was refused fails the case rather
than slipping past it (I20). Worker starts resolve when the start reaches its gate, and a refused start's retries are refused at once rather than swept
every 10 ms. **What is still a clock:** each case's own limit, unraised: 15 s on Windows, 5 s elsewhere. A landing that stops answering ends there, named by
the case (I19). I21 is the proof it left the clock: with a real 6 s wait in front of the landing, the case as it stood goes red and the case as it stands stays green.
`waits for an aborted worker`'s 500 ms stays: it is a negative wait, nothing is being timed. Other suites with the same 3 s shape
(`connectorApprovalButtons`, `connectorRuntime`, `githubClientAbort`) land nothing and were left alone.

**The two earlier unread reds** in `cc-small3.md` (`asks for a merge` at 23,227 ms, `lands the change` at 20,903 ms) stay unread. Those are past the case's own
limit, not the poll, and the numbers above do not reach them. **This round caught that shape with its output kept:** I10's first green ran 324 s rather than about 90, the suite's
own `beforeAll` past its 30 s and five cases past their 15 s (`Test timed out in 15000ms`), with nothing broken and the next run, 3 s later, normal, while other lanes shared this PC. That is
what the case limit does on a stalled machine, and those two are likely the same thing; likely, not shown.

## Hosted red B: `100,000 lines remain virtual and queued Stop input responds below 100 ms`

Run 41794406176, Linux shard 2: 277.1 ms against the bound of 100. **`4b7dbc192c` did not move it.** Real Chrome, the suite's own launched browser, the one case,
each sample its own browser, on this PC, in alternating blocks. "Before" is `src/host/html.ts`, `src/webview/makerEntry.ts` and the test's fixture at
`4b7dbc192c~1`, written back with sha256 compared. "Quiet" is the same 5 ms interval in the same page with nothing being rendered, the machine alone.

| Condition                                   | Code   | Samples | Longest gap, ms: min, median, max | Quiet, ms: min, median, max |
| ------------------------------------------- | ------ | ------- | --------------------------------- | --------------------------- |
| This PC                                     | before | 10      | 20.8, 21.7, 25.3                  | 6.2, 6.7, 19.8              |
| This PC                                     | after  | 10      | 20.0, 21.4, 24.3                  | 6.1, 11.8, 20.4             |
| Pinned to 4 cores with 3 busy loops on them | before | 4       | 22.3, 23.6, 28.0                  | 6.2, 6.5, 6.6               |
| Pinned to 4 cores with 3 busy loops on them | after  | 4       | 22.4, 23.3, 23.6                  | 6.0, 6.5, 6.6               |
| Chrome's own 4x CPU throttle                | before | 5       | 66.5, 88.6, 121.2                 | 68.2, 101.6, 115.5          |
| Chrome's own 4x CPU throttle                | after  | 5       | 83.3, 99.5, 108.2                 | 61.4, 121.4, 137.4          |

Before and after sit on top of each other. Under the throttle the **quiet** control reaches past 100 ms with nothing to render, so that condition says what
the metric does on a slow machine and little about the product. A first try at 2 pinned cores with 3 loops was thrown away: it starved the whole rig (Chrome's cold
start 59 s, the sample past its own 180 s) and proved nothing. No condition here reached 277 ms: I cannot reproduce the hosted number. This first said there was no Linux Chrome sample to be had; WSL had Playwright's Chromium all along and I had not looked. CC-STOPSHAPE below has those samples.

**The hosted history says the same.** The coordinator's logs hold an earlier miss of the same bound by the same clicker, a day before this commit existed: run
41516831678, macOS shard 4, 2026-11-02, `worst-case search with 20000 repeated rows keeps Stop below 100 ms`, 158.7 ms. `m103-u.md` also carries
`M103U-STOP-LATENCY` as an open residual on this bound since 2026-10-06.

**The test was left for the coordinator's call, made below.** What I proposed, the 100 ms untouched:

1. **Best of three in one case.** The same payload three times in the one page; the smallest longest-gap must be under 100 ms. A stall the product causes is there every
   time, and `m103-u.md`'s drill (a 150 ms block in rendering, read at 166.6 ms) would still fail all three; a runner's one hiccup would not. Cheapest, and still wall time.
2. **The longest main-thread task by thread time,** from a Chrome trace (`RunTask`'s `tdur`). It does not count time another program took the core, so it measures our
   work and nothing else. It is Chromium-only, the WebKit run would keep the wall-time read, and it no longer says what a person waits on a busy machine.
3. **A control in the same page** (the quiet gap above) that voids a sample when the machine alone misses. Weakest: a void can hide a real miss.

I would take 1, and add 2 only if 1 still flakes. Neither has been built or tried.

## CC-STOPSHAPE: the median of five, the coordinator's call on hosted red B

`100,000 lines remain virtual and queued Stop input responds below 100 ms` now takes five samples in one page, and **the median must be under 100 ms, the bound unchanged**. A failure prints all five. The coordinator's reason, over the best of three I proposed: that one passes when two of three samples stall, and a median fails anything that repeats and still ignores one hiccup. Each sample's lines differ, `G1 X1` to `G1 X5`, because the surface prepares again only when the content changes, and a row of that sample's own line is what says it is on the page. The small warming payload still comes first. Every sample still checks the rows stay virtual, the 2,000,000 px height and that its own Stop clicks landed. The receipt now carries `samples`.

**Drills.** The real Stop handler (`src/webview/maker/StopChip.tsx`) spends 150 ms on the page's own thread at the first click of K samples, written back with sha256 compared (`799e3091382d8150`). The third row is mine, past the brief: the other two would also pass a best-of rule, and this one is what tells a median from it.

| Stalled samples | Exit | The five samples, ms              | Median |
| --------------- | ---- | --------------------------------- | ------ |
| All five        | 1    | 159.9, 158.8, 158.7, 161.9, 158.5 | 158.8  |
| Three of five   | 1    | 159.9, 158.6, 158.6, 19.6, 21.4   | 158.6  |
| One             | 0    | 160.0, 22.3, 21.1, 21.5, 20.3     | 21.5   |
| None, restored  | 0    | 21.6, 21.8, 21.6, 23.4, 21.0      | 21.6   |

Both reds printed all five in the failure's own message: `the five samples, in ms: ...: expected 158.8... to be less than 100`.

**The whole file on Windows, the final code:** exit 0, 17 passed, this case 2,494 ms, samples 21.0, 22.8, 20.1, 24.3, 20.0, median 21.0.

**Does it fit the case's limit, which is not raised?** Most of the time here; twice not.

| Where, and the limit                                                                         | The case   | Duration, ms                                                        |
| -------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| Windows, 15 s, alone                                                                         | one sample | 1,056, 1,076, 1,564                                                 |
| Windows, 15 s, alone                                                                         | five       | 2,923, 3,440, 4,007, then 2,765 and 2,494 in later runs             |
| Linux, real Chromium 153 in WSL, 5 s, alone, PC quiet                                        | one sample | 1,347, 1,425, 1,994                                                 |
| The same, another lane's build holding the PC near 100%                                      | one sample | 4,241, 4,827                                                        |
| The same, PC quiet                                                                           | five       | 2,671, 2,692, 3,186, 3,207                                          |
| The same, under that build                                                                   | five       | **5,026: red, `Test timed out in 5000ms`**                          |
| Linux, the whole file, 5 s, under moderate load                                              | five       | **5,022: red, the same**, the file's other cases about twice normal |
| Linux, the whole file, a wider limit on a throwaway command line, only to read the true time | five       | 2,482, 2,648, 2,670, 3,190                                          |

A sample costs about 0.3 s there (205 to 328 ms, one first sample at 804); the page and the warming payload about 1.1 s. The samples on Linux, all eight passing runs: 17.4 to 25.3 ms, nowhere near 277. **Hosted, by arithmetic and not measured:** this case's one-sample time in the coordinator's logs is 1,484 to 2,217 ms on Ubuntu, 1,370 to 2,940 on macOS and 1,419 to 2,087 on Windows, and five takes about 1.7 times one here, so about 3.8 s on Ubuntu and **up to about 5 s on macOS, which is the limit**. On a loaded machine this case can now fail by time where one sample would have squeaked through at 4.8 s, and it would read as a timeout rather than a latency miss. If hosted shows that, the shape that raises nothing is the five samples in a `beforeAll` of their own, with the file's hook limit (10 s on POSIX, 30 s on Windows) and the case asserting the median; the file already moves cold starts into hooks that way. Not built: that call is the coordinator's.

## CC-STOPSHAPE2: the five samples in a hook of their own, the coordinator's call

The section above is what the case did inside its own 5 s. The samples now sit in a `beforeAll` of their own, under the file's hook limit: 10 s on POSIX, 30 s on Windows, neither raised. **The case asserts the median and prints all five on failure; the bound stays 100 ms.** The hook checks each sample's own facts as it is taken and says which sample and which fact: `sample 3: Stop clicks landed`. A wait that ran out, or the hook's own limit, names only itself, so an `afterAll` throws `the Stop samples stopped in sample N, after: ...`. A failed hook fails the run: the case is skipped and the exit is 1. The receipt now carries `hookMs`.

**Does the hook fit its limit, where the case missed?** Not all the way. Real Linux Chromium in WSL, tests and busy loops pinned to 4 CPUs, a hosted runner's size, limit 10 s. The old one-sample case ran beside it as the yardstick of each rung.

| Busy loops | Old one-sample case, ms | Hook alone, ms              | Hook in the whole file, ms | Median of five, ms  |
| ---------- | ----------------------- | --------------------------- | -------------------------- | ------------------- |
| 0          | 1,395 to 1,415          | 2,368 to 2,597              | 3,205                      | 21 to 23            |
| 2          | 2,034 to 2,088          | 2,733 to 3,869              | 4,296                      | 21 to 23            |
| 4          | 2,236 to 2,363          | 5,663 to 5,792              | 5,676                      | 24 to 29            |
| 6          | 2,307 to 2,357          | 5,775 to 6,363              | 5,543                      | 27 to 36            |
| 8          | 2,846 to 2,987          | 5,807 to 6,435              | 6,166                      | 31 to 38            |
| 12         | 3,121 to 3,346          | 6,445 to 8,059              | 9,075                      | 32 to 47            |
| 16         | 3,339 to 3,904          | 9,099, 9,727, **timed out** | **timed out**              | 44 to 50 where read |

- **What moved:** at 4 loops the hook takes about 5.7 s, which the case's 5 s would have missed and the hook's 10 s does not.
- **Where it misses:** from 16 loops. The earlier in-case misses came with the one-sample case at 4.2 to 4.8 s, heavier than any rung here, so the hook would likely miss there too. That is an inference, not a measurement.
- **The rest of the file misses there too:** in the 16-loop whole-file run, `reload re-fetches large host payloads (JSON expansion false)` also timed out at its 5 s. An earlier pinned run with this PC near 100% from other lanes timed out the hook at sample 4 and two such cases, `worst-case search with 20000 repeated rows` and that same reload case. **The coordinator's call: failing only at a load where other cases in the file already time out is acceptable, and no limit moves.**
- **Less headroom than one sample had:** at 16 loops the one-sample case still passed, at up to 3.9 s of its 5 s, where the hook passed up to 9.7 s of its 10 s and then timed out.
- **The bound itself:** the median stayed under 100 ms on every rung. Only time fails.
- **Windows, limit 30 s:** 2,546 to 2,776 ms.
- **Left out of these runs:** the suite's global setup (cold starts, a production build), only to make room for more runs. Thrown away and not counted: pinned runs under other lanes' 100% load, one with Chrome's cold start at 180 s, apart from the one hook timeout told above.

**Drills on this shape,** on Windows unless said, each written back with sha256 compared. Stalls are 150 ms in the real Stop handler at a sample's first click.

| Break                                         | Exit | What it printed                                                                        |
| --------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| All five stalled                              | 1    | `the five samples, in ms:` 159.6, 159.1, 158.8, 158.7, 158.6                           |
| Three of five stalled                         | 1    | `the five samples, in ms:` 159.9, 159.5, 158.8, 20.2, 23.5                             |
| One stalled                                   | 0    | in the receipt: 160.1, 19.8, 20.6, 21.8, 20.6, median 20.6                             |
| None, restored                                | 0    | in the receipt: 20.9, 20.2, 20.5, 20.9, 21.5, median 20.9                              |
| Rows not virtual                              | 1    | `sample 1: rows on the page: expected 69 to be less than 30`                           |
| Height wrong, `+1000`                         | 1    | `sample 1: height of the rows: expected 2001000 to be 2000000`                         |
| Stop stops landing from sample 3              | 1    | `sample 3: Stop clicks landed: expected 75 to be greater than 75`                      |
| Sample 2 past the 3 s wait                    | 1    | `TimeoutError: locator.waitFor`, then `stopped in sample 2, after: 20.3`               |
| The hook's own limit, Linux, 2.5 s per sample | 1    | `Hook timed out in 10000ms`, then `stopped in sample 4, after: 2511.6, 2508.6, 2508.7` |

**A drill that proved nothing, redone.** The height break was `+1` at first, and it exited 0. **The height check only sees Chrome's six significant digits:** real Chrome reads `2000000px` and `2000001px` alike as `2e+06px`, and `2001000px` as `2.001e+06px`. So a height wrong by less than that passes. The check is left as it was, it has always read this way; `+1000` goes red.

**The whole file on Windows, this shape:** exit 0, 17 passed, hook 2,546 ms, samples 20.6, 20.6, 19.8, 20.3, 24.0, median 20.6.

## CC-WINSHARD: a control for the Stop test, and where Windows' time went

Hosted run 41848189260 on `cf7014723c`: the Stop test failed its median on hosted macOS, shard 14 was cancelled at its 20 minutes, and shard 8 took 16 minutes against 7.

### 1. Stop on hosted macOS

Samples 73.9, 231.8, 136.7, 169.5, 55.7, median 136.7, on a shard that runs its files one at a time. As it stood, the test could not tell a poor instrument from a slow surface.

**What the case does now.** Five controls between the five real samples, in the same Chrome on the same page, nothing rendering: the same 5 ms interval and the same longest gap, 250 ms each. `Stop samples, in ms, Chrome: real ...; controls ...; hook ... ms` goes to the output on every run, passing or failing, so the next hosted run gives macOS's baseline. The case asserts two things, both printing both sets:

1. **The median of the controls is below 100.** Otherwise: `the machine alone misses the bound, so nothing was measured`.
2. **The median of the real samples less the median of the controls is below 100.** The bound stays.

Together those mean a real median of 200 ms or more never passes.

**Two choices of mine, for the coordinator to overrule:**

- **The control clicks nothing.** A slow Stop handler is what the real samples are there to catch, and a control clicking the same handler would subtract it away.
- **The first assertion is not in the brief.** Subtraction alone cannot meet "a stall in the controls must not hide a stall in the real samples": real 159.2 less control 155.2 is 4.0. With it, that run is red in its own words. **The cost: if hosted macOS's controls come back at 100 ms or more, the case stays red, for a reason it names.**

**Is subtracting the wrong shape? On this data it is not wrong, and it does little.** Real Linux Chromium, tests pinned to 4 CPUs, medians in ms, the control as long as the real sample before it. Two of the 33 runs were lost to the case's 3 s wait.

| Condition                  | Runs | Real       | Control, full length | Control, first 250 ms | Real less control |
| -------------------------- | ---- | ---------- | -------------------- | --------------------- | ----------------- |
| Quiet                      | 3    | 22 to 24   | 5                    | 5                     | 17 to 18          |
| 4 busy loops               | 3    | 27 to 28   | 9                    | 7 to 9                | 18 to 19          |
| 8 busy loops               | 2    | 39 to 41   | 10                   | 9 to 10               | 29 to 30          |
| 12 busy loops              | 3    | 36 to 41   | 9 to 13              | 8 to 10               | 26 to 32          |
| 16 busy loops              | 3    | 45 to 64   | 11 to 12             | 10 to 12              | 33 to 52          |
| Chrome's 4x throttle       | 3    | 40 to 45   | 6 to 7               | 6                     | 33 to 39          |
| Chrome's 6x throttle       | 3    | 55 to 57   | 7 to 12              | 6 to 8                | 43 to 49          |
| A real 150 ms stall, quiet | 3    | 159        | 5                    | 5                     | 154               |
| The stall, 8 loops         | 3    | 166 to 168 | 9 to 10              | 8 to 10               | 156 to 158        |
| The stall, 4x throttle     | 3    | 162 to 164 | 7 to 10              | 6 to 7                | 154 to 156        |
| The stall, 6x throttle     | 2    | 164 to 166 | 8 to 13              | 7                     | 153 to 156        |

- **It separates cleanly:** 17 to 52 with no stall, 153 to 158 with one.
- **The control barely moves with load, and the real samples do.** A timer that mostly sleeps wakes promptly on a busy CPU; work that has to run stretches. So subtraction removes 5 to 13 ms here and does not cancel a slow machine. **What it would rescue on macOS is timer jitter, not a slow CPU.** If macOS's controls come back low and its real samples stay high, the honest reading is that the longest task really is long there, not that the instrument is poor. Only the hosted run can say which.
- **Length:** 250 ms reads the same as the full length here. An as-long-as-the-sample control took the hook past 10 s from 4 loops, so it is 250 ms. Spikier noise on macOS would be under-read by a window this short, which leans red, not green.
- **On Windows my earlier 4x throttle read differently:** its quiet gap reached 61 to 137 ms (the CC-STOPSHAPE table). So the control is not low everywhere.

**Drills on this shape,** real Chrome on Windows, each written back with sha256 compared. A real stall is 150 ms in `StopChip.tsx` at a sample's first click; a control's stall is in the test's control.

| Break                                 | Exit  | Real, ms                          | Controls, ms                      | What it says                                             |
| ------------------------------------- | ----- | --------------------------------- | --------------------------------- | -------------------------------------------------------- |
| All five real stalled                 | 1     | 160.1, 159.0, 158.8, 158.9, 159.0 | 6.6, 6.5, 5.9, 6.0, 6.3           | real less control, 152.7                                 |
| Three of five real                    | 1     | 159.8, 159.1, 158.8, 16.2, 24.0   | 6.1, 6.5, 6.0, 6.1, 6.1           | 152.7                                                    |
| One real                              | 0     | 160.5, 18.8, 17.0, 24.6, 21.7     | 6.7, 6.1, 6.0, 6.0, 6.1           | passes                                                   |
| None, restored                        | 0     | 21.8, 20.0, 22.2, 22.2, 20.8      | 6.1, 6.8, 6.9, 6.0, 6.1           | passes                                                   |
| All real, two controls at 150 ms      | 1     | 160.4, 159.1, 158.8, 158.9, 158.8 | 155.3, 155.6, 6.1, 6.0, 6.1       | 152.8: **not hidden**                                    |
| All real, three controls at 150 ms    | 1     | 160.6, 159.4, 158.8, 158.7, 158.9 | 156.3, 156.0, 155.6, 6.8, 6.0     | the machine alone: **not hidden**                        |
| All real, five controls at 150 ms     | 1     | 160.4, 159.1, 159.2, 159.2, 158.7 | 155.3, 155.1, 155.2, 155.1, 157.0 | the machine alone: **not hidden**                        |
| No real, five controls at 150 ms      | 1     | 23.5, 22.0, 21.4, 21.8, 23.9      | 155.5, 156.7, 156.6, 157.0, 155.2 | the machine alone: red with nothing wrong in the product |
| No real, five controls at 60 ms       | 0     | 21.5, 21.7, 24.3, 24.0, 20.8      | 65.2, 66.8, 66.8, 65.8, 65.5      | passes                                                   |
| **All real, five controls at 60 ms**  | **0** | 159.7, 158.6, 158.5, 158.6, 158.5 | 65.3, 65.4, 66.6, 64.9, 65.3      | **passes: hidden**                                       |
| A real 200 ms, five controls at 90 ms | 1     | 210.3, 208.7, 208.6, 208.7, 208.6 | 97.1, 95.6, 95.4, 95.4, 95.0      | 113.3                                                    |

**So what a stall in the controls does:** in up to two of five, nothing. In three or more at 100 ms or over, the case is red and says the machine alone misses. **In three or more under 100 ms it does hide a real stall, of up to 100 ms plus what the controls read: that is what subtracting is, and the row in bold shows it.** It cannot be closed while the credit stands. The printed line shows it on every run.

**The hook against its 10 s.** Linux, the same pinned load table, the suite's global setup left out. "Before" is CC-STOPSHAPE2's. Two batches, the second with nothing else of mine running but another lane's build holding the PC at 80 to 100%.

| Busy loops | Before, ms                     | With controls, alone, ms          | With controls, whole file, ms                                                               |
| ---------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| 0          | 2,368 to 3,205                 | 3,963 to 4,014                    | 4,476                                                                                       |
| 4          | 5,663 to 5,792                 | 7,026 to 7,659                    | 8,132                                                                                       |
| 8          | 5,807 to 6,435                 | 7,327 to 9,856                    | 7,693, 8,962                                                                                |
| 12         | 6,445 to 9,075                 | 7,385, 8,378, **four timed out**  | 9,938, **one timed out**                                                                    |
| 16         | 9,099 to 9,727, then timed out | **all six timed out at the hook** | 9,853 with two other cases past their 5 s; **one timed out**, with three others past theirs |

**The controls move the first miss from 16 loops to 12.** At 16 other cases in the file time out too, in both whole-file runs; at 12 the hook is the first to go. A hook timeout prints how far it got, for instance `stopped in sample 4, after: real 68.6, 47.3, 47.5; controls 8.5, 9.3, 9.3`.

### 2. Windows time

**`judgeP2Delivery.test.ts`, 327 s on hosted Windows beyond its own 12 s, in both logs.** Timed spawn by spawn on this PC, while the file is collected:

| Spawn                                     | Runs before | ms before   | Runs after | ms after   |
| ----------------------------------------- | ----------- | ----------- | ---------- | ---------- |
| `vsce ls`                                 | 2           | 93,685      | 2, staged  | 9,687      |
| `check-bundle-split`                      | 5           | 42,487      | 3          | 26,239     |
| `package-acp`                             | 1           | 2,199       | 1          | 1,594      |
| `check-bundle-size`, `check-host-globals` | 20          | 2,882       | 20         | 2,536      |
| **Total**                                 | **28**      | **141,253** | **26**     | **40,056** |

- **`vsce ls` was two thirds of it.** Its `.vscodeignore` filter matches every file it walks against every line, compiling the glob each time: 12,000 files by 245 lines, 98% of its time in `minimatch`. It now lists a stage of the real `package.json`, `.vscodeignore` and `dist/`, as `scripts/gen-lazy-registry.mjs` already does; `dist/` is the only folder these cases read. The 199 `dist/` lines came out identical to the repository's. That quadratic is vsce's, worth reporting upstream; it is not reported yet.
- **Three planted split runs are one.** The whole-report case now asserts the sum of all three families' problems, which proves no mutation hid another. Each case still asserts its own message.
- **Not cut:** the green split run before and the one after, which are at different moments on purpose. About 3.5 of each split run's 7 s is `siblingExportProblems` parsing with TypeScript.
- **Drills:** a family left out of the shared run, red 47 cases, green 104. `!dist/judgeP2.js` out of the real allowlist, red 2 cases, green 104. Both exit 1 then 0, restored byte-exact.
- **Expect, by proportion and not measured:** 327 s to about 93 s on hosted Windows.

**`paidMoneyStructure.test.ts`, 48 s beyond its own.** The guard walks a real TypeScript program over all of `src`, and it asked every variable's type before reading its name, though only a money-hinted name is ever judged: 10 of 23 s here. It reads the name first. **23.3 s to 12.4 s, with `flagged`, `numeric` and `files` byte-identical** (70, 201, 2,840). Drill: a money-named variable never judged, red 2 cases, green 46.

**Shard 14** was cancelled at 20 minutes, after 13.2 and 18.7. The cuts take about 4 to 5 minutes off it, by the same proportion. The rest of that run's rise is below: it was on the new image.

**Shard 8, 16 minutes against 7. It does not read as one slow runner, and it does not read as our code.** The evidence, from the logs of all sixteen Windows shards and the same shard on the two runs before (read-only):

|                                                     | This run, shard 8    | Run 41824926474 | Run 41794406176 |
| --------------------------------------------------- | -------------------- | --------------- | --------------- |
| Runner image                                        | **20261103.298.1**   | 20261030.294.1  | 20261030.294.1  |
| PowerShell, C#, Chrome cold starts, s               | **26.5, 18.5, 49.0** | 3.5, 2.3, 5.4   | 2.5, 1.6, 3.6   |
| `passes an ordinary burst of 200 quick spawns`      | **15.0, the limit**  | 2.4             | 2.4             |
| `refuses children past its process cap`             | **15.0, the limit**  | 3.9             | 3.7             |
| `ends a spawn flood`                                | **15.0, the limit**  | 0.9             | 1.0             |
| `refuses a boot dir whose path contains whitespace` | **35.3**             | 0.4             | 0.7             |
| `runtimePanelSessions`, file                        | **28.3**             | 3.9             | 6.9             |
| `nodeOsSetupServer`, file                           | **9.4**              | 0.3             | 0.4             |
| In-process: required bundles, s                     | **12.1**             | 13.9            | 12.7            |
| In-process: VSIX file list, s                       | **4.0**              | 5.2             | 5.2             |
| Files over 1 s, ratio to the run before, median     | **0.99**             |                 |                 |

- **Its CPU was not slow.** Bundling and listing were as fast as ever or faster, and the median file over a second did not move. What moved is what starts processes: `hostname.exe` two hundred times, `sh.exe`, and the cold starts before any test file ran. So the fork file's order against `teamCheckProof` was not the cause. The file just before it was `teamPanel` at 119 ms.
- **It reads as the new runner image.** In this run all eleven shards on 20261030.294.1 cold-started PowerShell in 3.0 to 6.1 s and C# in 2.0 to 3.8 s. The five on 20261103.298.1 took 3.7 to 26.5 s and 5.6 to 18.5 s, in the same regions (`westus`: 2.3 s and 2.2 s on the old image, 18.5, 11.8 and 10.8 on the new). Its job times against the run before: shard 8, 7.2 to 16.0 minutes; 13, 9.2 to 13.3; 14, 13.2 to 20.1; 16, 7.3 to 7.9; 11, 8.2 to 6.1. The old-image shards moved by -4.1 to +3.5 minutes.
- **Not one slow machine:** three of five slowed badly, and shard 11 on the same image was faster than its last run. In shard 8 the slowness faded: from about 300 s of test time, files mostly read x0.6 to x1.3 (`nodeOsBrowser`, x2.2, is the exception).
- **Why that image starts processes slowly, I cannot say from a log.** A scanner, or a disk warming on first read, would both look like this. No limit was raised, and nothing here is a fix for it.

### Exit codes

On `8a8e2350ee`, all 0: `format:check`, `lint:js:unit`, `typecheck:unit`, `duplication`, `check:plan`. `makerReviewBrowser`, `judgeP2Delivery` and `paidMoneyStructure` together on Windows: exit 0, 167 passed, that run printing real 27.4, 23.7, 22.3, 17.3, 17.1; controls 9.9, 6.5, 6.1, 6.1, 6.1; hook 7,435 ms. This record's later corrections took prettier on the file and `check:plan`, both 0.

**Not proven:** hosted CI on any of this. What hosted macOS's controls read, which is what this round exists to find, and whether its hook fits 10 s with them. The 93 s for `judgeP2Delivery` on hosted Windows, which is a proportion. Why the new image starts processes slowly. The other four new-image shards were read from their cold starts and job times, not case by case.

## A correction to `cc-small3.md`

That record said my drill runner "keeps everything now". It did not: the patch had failed silently, as I found starting this round. The two reds it
names stay unread either way (see hosted red A). The runner does keep it now, `temp/small3/drills-full.log`, and the sentence there is corrected.

## Drills

Each an exact break, the named files, the exit code, the file written back and its sha256 compared.

| Drill | The break                                                          | Red exit | Cases red | Read by                                                                     | Green exit |
| ----- | ------------------------------------------------------------------ | -------- | --------- | --------------------------------------------------------------------------- | ---------- |
| I1    | `acpTeamEntry.ts`: the manual path says nothing after the landing  | 1        | 1         | tells the person once, manual                                               | 0          |
| I2    | `acpTeamEntry.ts`: the bypass path says nothing                    | 1        | 1         | tells the person once, bypass                                               | 0          |
| I3    | `acpTeamEntry.ts`: the sentence is said on a Discard too (redone)  | 1        | 1         | says a refused landing once                                                 | 0          |
| I4    | `acpTeamEntry.ts`: `changed` keeps the words that offer Undo       | 1        | 1         | offers an editor no Undo Merge                                              | 0          |
| I5    | `acpTeamEntry.ts`: any thrown message reaches the person           | 1        | 1         | says a card that failed for real                                            | 0          |
| I6    | `teamMergeRefusalWords.ts`: the holder printed as JSON             | 1        | 6         | `teamMergeRefusalWords`, the session, `teamHostRealParts`                   | 0          |
| I7    | `teamTrafficProjection.ts`: Traffic has its own words              | 1        | 2         | `teamHostRealParts`                                                         | 0          |
| I8    | `teamMergeFlow.ts`: the card has its own words                     | 1        | 1         | `teamHostRealParts`                                                         | 0          |
| I9    | `teamLandingEntry.ts`: `busy` without its holder                   | 1        | 5         | the session, `teamLandingPause`                                             | 0          |
| I10   | `teamMergeRefusalWords.ts`: a bare lock read as a landing (redone) | 1        | 4         | `teamMergeRefusalWords`, the session                                        | 0          |
| I11   | `teamMergeRefusalWords.ts`: `refs/heads/` in the sentence          | 1        | 7         | `teamMergeRefusalWords`, the session, `teamHostRealParts`                   | 0          |
| I12   | `teamMergeRefusalWords.ts`: a path in the log line                 | 1        | 1         | `teamMergeRefusalWords`                                                     | 0          |
| I13   | `teamBoardFile.ts`: a failed write poisons the next                | 1        | 2         | `teamBoardFile`                                                             | 0          |
| I14   | `teamBoardFile.ts`: the temporary left behind (redone)             | 1        | 2         | `teamBoardFile`, `teamLandingSurfaces`                                      | 0          |
| I15   | `cliOptions.ts`: the flag not repeatable                           | 1        | 1         | `execArgs`                                                                  | 0          |
| I16   | `execArgs.ts`: the flag not handed on                              | 1        | 1         | `execArgs`                                                                  | 0          |
| I17   | `execArgs.ts`: a blank name taken                                  | 1        | 1         | `execArgs`                                                                  | 0          |
| I18   | `execArgs.ts`: the flag allowed on any backend                     | 1        | 1         | `execArgs`                                                                  | 0          |
| I19   | `acpTeamEntry.ts`: the merge card never closes                     | 1        | 1         | `lands the change`: ends at the case limit, 15 s, instead of hanging        | 0          |
| I20   | `teamMerge.ts`: every landing refused while the case waits         | 1        | 1         | `lands the change`: the card closes, the file is not there                  | 0          |
| I22   | `teamBoardFile.ts`: a failed write swallowed (redone)              | 1        | 1         | `takes a failed write`: `promise resolved "undefined" instead of rejecting` | 0          |

**I21, the one that runs the other way:** a real 6 s wait in front of the landing (`teamMergeFlow.ts`), written back, sha256 compared. The case as it stood at
`1de8cef919`: exit 1, "timed out waiting for the landed change". The case now: exit 0.

**What went wrong on the way, in the open.**

- **A whole run stopped by hand.** The first run of these failed I2's green at the suite's 3 s poll in one of my own new cases (`names the landing that holds the lock`, manual, 5,515 ms in all): hosted red A's
  weakness, in my own code. So I moved those cases off the clock too, and ran everything again. A stopped run's numbers are not counted.
- **I3 proved nothing, and was redone.** On the rerun its red went green with the break in: moving that case onto the card's close took away the time its negative check had been resting on, and the session closed
  before the wrong sentence could come. The case now gives it one full turn of the loop. Redone: red exit 1, `expected [ …(2) ] to have a length of 1 but got 2`, green exit 0.
- **I10's green failed with nothing broken, and was redone.** That is the stall told under hosted red A. Redone: red exit 1, 4 cases, green exit 0, 33 passed.
- **My own board case had the same weakness, and my first cure was empty.** Linux showed it (below): a 30 s fall-through hiding that nothing had started. I moved it off the deadline and at first read the temporary after the
  run's end, and I14's red showed the case green with the removal gone, since that end clears the folder. It is read while the run holds the folder now. Redone: red exit 1, that case at its 180 s limit and `fails one write alone`, green exit 0.

## Suites

Named files only, `--maxWorkers=4`, none importing a vault or credential-store module (four name the word in a help or settings table, their imports checked), `MUSE_TEST_REAL_CLI` unset.

**Windows, on `49471a4ea1`, Node 24.20:** exit 1. 1 failed | 30 passed (31). 1 failed | 579 passed (580). **Red: ` test/unit/teamLandingSurfaces.test.ts > the governed git > lands over a person's tree with core.autocrlf and their line endings`.**

That red is not in anything this lane changed, and it can be read only so far on this base: `TeamGitError: git --no-replace-objects exited with code 1`, empty stderr, in `StagingCopy.blob` under the governed, contained git. `processTeamGit` turns any failure into exit 1 here, so what really failed is hidden; CC-WINLAND2's `c6e1a64ef8` ends that on its branch. **The file alone, twice, after it:** first exit 1, both `the governed git` cases at their 180 s, while another lane's linkers held this PC at 100% (seven `link.exe`, read from the process list), with an `EBUSY` on `muse-m96c-landing-*` following from the case still running; the helper was still spawning, so slow, not hung. Then exit 0, 12 passed, 593 s, that load gone. Each git in those two cases goes through the job helper, once per file per snapshot on this base. Not changed here, as briefed.

Files: `acpTeamSession`, `teamMergeRefusalWords`, `teamBoardFile`, `teamHostRealParts`, `teamLandingSurfaces`, `teamLandingPause`, `teamLandingProduct`, `teamLandingKilled`,
`teamMergeCardLanding`, `teamEntries`, `teamAvailability`, `teamChunkPackaging`, `execArgs`, `execExactCount`, `execTeamFlags`, `mcpDefer`, `cliHelp`, `cliHelpConsistency`, `commandHelp`,
`fontCli`, `m105bind`, `providersModels`, `scheduleRestoreSwitch`, `cx1r2Truth`, `cx1r4Truth`, `usageL10nGate`, `accountRestore`, `makerReviewBrowser`, `html`, `packagedBundles`, `bundleExports`.

**Linux, that same tree, a fresh install in WSL's `/tmp` (gone with it), v26.13.0 on Linux 6.18.54.1-microsoft-standard-WSL2:** exit 1. 1 failed | 10 passed (11). 5 failed | 170 passed | 2 skipped (177).

Red: ` test/unit/teamLandingSurfaces.test.ts > a headless run > settles at start what a dead run left, and never under a lock it finds`; ` test/unit/teamLandingSurfaces.test.ts > a headless run’s board > takes a failed write’s temporary away, and the run’s end reports the failure`; ` test/unit/teamLandingSurfaces.test.ts > an ACP session > asks at the first turn about a dead run: Keep leaves it, Recover settles it`; ` test/unit/teamLandingSurfaces.test.ts > the governed git > carries a landing through its contained launcher`; ` test/unit/teamLandingSurfaces.test.ts > the governed git > lands over a person's tree with core.autocrlf and their line endings`. Four of the five are the four hosted Linux and macOS named, CC-WINLAND2's to fix: the test's governor had no created-path helper, and `processTeamGit` read that as "no such ref". **The fifth is this lane's own new case,** `takes a failed write's temporary away`, red for the same reason: nothing could start there, and its 30 s fall-through hid that. That run was before I moved it off the deadline (`941da2d308`); hosted Linux and macOS would have gone red on it too.

**So the same Linux copy took this head merged with `cc/winland` at `3d700480f0`,** the one conflict hunk resolved in the copy, nothing written back. `acpTeamSession` 27 passed, `teamMergeRefusalWords`, `teamBoardFile`, `teamHostRealParts`, `teamLandingPause`, `teamLandingChecks` all passed, and my board case passed at 8,767 ms. **Exit 1: 64 passed, 2 failed:** both `the governed git` cases past their 180 s limit (185 s, 198 s), on nothing but time, and `asks at the first turn` passed at 212 s under its own. The governed git is that slow in WSL at 4 workers; I did not run `cc/winland` alone to compare, and hosted Linux is what will say.
Files: `acpTeamSession`, `teamMergeRefusalWords`, `teamBoardFile`, `teamHostRealParts`, `teamLandingSurfaces`, `teamLandingPause`, `teamLandingProduct`, `teamLandingKilled`, `execArgs`, `mcpDefer`, `superviseOrphan`.

**After that run, `941da2d308` changed one test file, so on the final head:** `teamLandingSurfaces` and `teamBoardFile`, exit 0. 2 passed (2). 15 passed (15). `typecheck:unit` exit 0, `duplication` exit 0, eslint and prettier on that file exit 0.

## Gates

One after another on `49471a4ea1`, status lines 0, Node 22.19.0 (CI's major), nothing of mine touching the tree. **All 28 exit 0.** After it came one test file (under Suites) and this record.

| Gate                                                                                                                 | Exit             |
| -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `format:check`                                                                                                       | 0                |
| `lint:js:main`, `lint:js:unit`, `lint:js:tests`, `lint:css`, `lint:ps`                                               | 0, 0, 0, 0, 0    |
| `typecheck`                                                                                                          | 0                |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                                         | 0, 0, 0, 0, 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches`                 | 0, 0, 0, 0, 0, 0 |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts` | 0, 0, 0, 0, 0    |
| `deadcode`, `cycles`, `duplication`                                                                                  | 0, 0, 0          |
| `build`                                                                                                              | 0                |
| `security:audit`                                                                                                     | 0                |

**Budgets, none raised, none crossed:** `resourceGovernor.js` 124.8 of 125, `modelApi.js` 519.5 of 525, `mcpPool.js` 74.8 of 75, `modelApiMcp.js` 74.8 of 75, `teamTraffic.js` 48.9 of 75, `teamHost.js` 126.5 of 130, `teamEngine.js` 93.8 of 100, `teamLanding.js` 56.2 of 75, `uiText.js` 120.0 of 125, `acp.js` 434.9 of 850, `execTeam.js` 47.8 of 53, `acpTeam.js` 61.2 of 75.

## Not proven, and why

- **The hosted runs.** Local Windows and WSL are not hosted runners. A is for hosted CI to confirm. **B has its shape now (CC-WINSHARD below), with two ways to go red that are not the product:** the hook's own 10 s on POSIX, and a machine whose controls alone miss the bound.
- **The hosted Windows landing's real duration.** Only "over 3 s" is known. The case's 15 s limit still applies, and a landing past it fails by name.
- **The 277 ms itself:** never reproduced, on Windows or on Linux Chromium. **The hook on hosted macOS and Linux inside its 10 s:** arithmetic only, until hosted CI runs it.
- **The two old unread reds** above.
- **The 26-minute figure:** arithmetic from 101 and 1,001 files, never run at 11,230, and about this base; CC-WINLAND2's fix was not run here.
- **`--mcp-always-load` reaching the Model API host in a real run:** read and type-checked. A run that declares tools needs a model call, and none was made.
- **A headless board whose chain was really poisoned, end to end:** that path has no later write (section 4). No-poison is shown in `teamBoardFile.test.ts`.
- **An editor's rendering:** the sentence arrives as an `agent_message_chunk` at the real ACP handler; no real editor was opened. The `team/merge/<id>` call still ends `completed` beside the refusal, as named above.
- **The merge overlap:** `git merge-tree` of this head and `cc/winland` (`3d700480f0`) reports **one conflict, one hunk, the imports of `test/unit/teamLandingSurfaces.test.ts`**: this side adds `type ExecTeam, type ExecTeamDeps`, that side drops `runtimeWindowsJob`. Everything else merges by itself. It is not resolved here, and the merged whole has not been run.
