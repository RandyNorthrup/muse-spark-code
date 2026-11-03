# CC-WINFIX3 — hosted CI run 41516831678, the Windows part (2026-11-02)

Claude Code lane `CC-WINFIX3`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch `cc/winfix3`, base `87d424f577`
(`cc/winfix2`, the commit the run tested), on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**. Muse
requests: **0**. Nothing was pushed, rebased, stashed, reset or tagged. The vault and credential-store suites
(`test/unit/vault/**`, `keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`) were never run here. Scratch
files stayed in the worktree's ignored `temp/`.

"Hosted shape" is CC-CIFIXW's: Node 22.23.4, started from PowerShell, `TEMP` spelled through an 8.3 name (here
`C:\Users\Randy\Coding\MX37CC~1\temp\rt`), an empty `GIT_CONFIG_GLOBAL`, `CI` and `GITHUB_ACTIONS` set, `--maxWorkers=4`.

**Two things this lane ran that sit near a rule, named so they can be judged.** Neither is a vault suite, and neither reaches the
OS store:

- `windowsPipeRelayChild.ts`, the relay suite's child, started by a scratch script. Its helper "holds no secret, key or
  credential logic" and the child imports no keyring.
- The real broker's start, as `startWindowsBrokerFixture` does it, from a scratch script without the fixture's store cleanup:
  all four bundles alias `@napi-rs/keyring` to an absent file, so the broker runs on its file anchor, and only `snapshot` was
  asked. No setup, no slot, no CNG key. Each scratch start stopped its broker and removed its folder.

**One mistake.** An edit script of mine failed and the command after it still ran: the old `ends a spawn flood past 16,384
births` ran once on this PC, 60 s of real spawns against the brief's "keep it light". The flood ended with its case. Later runs
of that suite check the edit first. A drill that piped a scratch start into `Select-Object -First` also left its broker alive
for a few minutes; it was this lane's own process, found by its folder name and ended.

## 1. How the shards ended

All four were cancelled at the 20-minute job limit (`timeout-minutes: 20`, 20:11 to 20:31). A cancelled job's log ends before
vitest's summary, so it holds **no error text at all** for any red in it. Which file held each shard was computed: vitest's
own shard hash and its largest-first order over this tree. Checked on the complete shards 4, 5 and 16: 92 of 92 files placed,
no foreign name.

| Shard | Last file printed             | Silent for | The file holding it                       | Why                                   |
| ----- | ----------------------------- | ---------- | ----------------------------------------- | ------------------------------------- |
| 3     | `teamAutofill` (11,233 bytes) | 14 min     | `vault/credentialMigrationStore` (11,050) | the broker never answered (section 2) |
| 6     | `vaultHostIdentity` (2,193)   | 11 min     | `vault/windowsVaultPanelFlow` (2,163)     | the same                              |
| 9     | `acpElicitation` (2,864)      | 10 min     | `vault/windowsBrokerClient` (2,863)       | the same                              |
| 14    | `nodeLifecycle` (17,246)      | 13 min     | `judgeP2Delivery` (16,938)                | not a hang: section 3                 |

**This was not new.** The lead's copy of run 41214393586 has no logs for Windows 6, 9 and 14, which read as green, and
`cc-winfix2.md` says "the sibling suites pass on it" on that footing. They were **cancelled** in that run too, and their logs
(`gh run view --log`) end at the same three files. Shard 3 joined them when CC-CIFIXW gave `credentialMigrationStore`'s hook
no limit; in that run it failed at 30 s. None of these suites has passed on hosted Windows in either run.

## 2. The vault could not be reached on Windows (product)

`vaultStoreScope`'s 180 s on shard 16, the three hung shards and `windowsPipeRelay`'s 15 s on shard 6 are **one cause, and it
reproduces at once on this PC**:

```
relay fixture refused: [ { "code": "unrecognized_keys", "keys": [ "parentProcessId" ], "path": [ "server" ], ... } ]
```

`19c1227d5d` (D243, 2026-10-30) added `parentProcessId` to the helper's `ProcessRecord`. `OnServer` shares that record, and the
server answer's contract is the strict client record, so `inspectWindowsPipeServer` threw on every call. Discovery and the dial
both go through it: **since D243 no client on Windows could reach a broker**, so the vault did not work there at all. Nothing
said so, for two reasons in the harness:

- The fixture's `for (;;) { try { snapshot } catch { retry } }` swallowed the error on every attempt.
- The relay child set an exit code and kept running, held open by the serve helper's pipes, so its parent waited out its budget.

**The fix.** Only a process answer carries the parent; a server answer is the client record's exact shape again.

| Measured here, hosted shape                      | Before                       | After                                 |
| ------------------------------------------------ | ---------------------------- | ------------------------------------- |
| The relay child's whole run                      | refused, then no end         | 61 to 77 ms, 200 dials, 0 missed      |
| The real broker's first answer, helpers included | `$ZodError` on every attempt | 3.9 s on attempt 1, state `uncreated` |

**A fixture that fails.** `awaitFirstBrokerAnswer` retries only what a starting broker says (`brokerBlocked`, `noAccess`), fails at
once on anything else, and at 120 s fails naming what it waited for, how many attempts ended and what the last said. The bound
also covers an attempt that never returns. It is the harness, not the person's vault, and it sits under the 180 s of the one suite
that starts its broker inside a case. The relay child now ends when it fails, so that case reports these words instead of a timeout.

**The hooks on this road end too, and this narrows a word of the owner's on a word of the lead's.** The five Windows vault hooks had no
limit at all (the owner, 2026-10-16: the helper builds take as long as the machine needs), so anything else on that road that never
ended would still hold a shard. The brief says a test must fail, not hang, and that this puts no limit on the person's work, so they now
have `WINDOWS_VAULT_HOOK_TIMEOUT_MS`, 300 s, far past the builds. `PLAN.md` section 8 records it with the two other new bounds.

**`vaultStoreScope`'s Windows case had a second red waiting (read, never run).** Its first store read expects the scoped anchor in
the OS store, and the fixture's broker has no keyring binding, so it would read null: the same words the macOS leg failed with in
this run (`posix: scoped anchor exists`). `startWindowsBrokerFixture` now takes `osStore`, which only that case passes: the
bundles keep their bare import, and a junction beside `dist` is the `node_modules` a package with the binding has. My first
try aliased the import to the binding's absolute path, and a build showed why not: esbuild keeps it as `import("C:\\...")`, which
Node refuses, so the broker would have stayed on its file anchor. Checked here with no entry opened, so no store: a bare import from
a staged `dist` through the junction finds `AsyncEntry`, and removing the stage leaves the checkout's package whole. The default
alias to an absent file refuses by that same road, and stays. The POSIX fixture is the Mac lane's.

## 3. `judgeP2Delivery` outlasted every job, on all three OSes

Windows 14, macOS 14 and Ubuntu 7 of this run were cancelled here, and the file is in shard 14 of 16 and shard 7 of 8 by the same
hash. Its controls run while the file is collected (`60156df99d`, 2026-10-24), so no case starts and nothing prints: one real
gate per mutation.

| Gate                 | Runs before | Each, here | Runs now |
| -------------------- | ----------- | ---------- | -------- |
| `check-bundle-split` | 282         | 9 to 10 s  | 5        |
| `vsce ls`            | 9           | 60 s       | 2        |

That was about 50 minutes here, and no shard on any OS finished it inside its 20 minutes in this run. A gate reports every problem it finds, so one run proves
all the mutations of its kind. The file now takes **188 s here, the same 103 cases**, each still asserting its own message, the
run's exit and the byte-exact restoration, against real gates and a real listing. A gate still running after 5 minutes fails the
file by name.

**What this gives up:** each case no longer proves that its one mutation alone turned the gate red. It proves the gate named that
mutation, in a run that exited 1. Drill T10 shows a source the gate stops guarding still fails its own cases, and only those.

## 4. The other reds the cut logs hid

Each had no error text in the log; the cause is reproduced here where the table says so.

| File                                   | Shard | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                            | Side    | Seen here             |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------- |
| `judgeHardware`                        | 9     | The video probe starts PowerShell with an empty environment and names cmdlets: cause C of `cc-winfix2.md`, one of the scripts that record left. Two scans at its 10 s bound pass the case's 15 s. Under a module folder of that weight: **14,609 ms before, 220 to 246 ms after**; the real probe through its real empty environment here, 338 ms. Also: for one card `ConvertTo-Json` writes a bare object, and the parser reads only an array. | product | Yes, under the weight |
| `windowsRecording`                     | 6     | `denyWrites` leaves removal allowed: it takes DELETE on the child or delete-child on the parent. The three lock cases never met a lock on Windows. `denyRemoval` denies those, for real.                                                                                                                                                                                                                                                         | test    | Yes, the three names  |
| `resourceForkProtection`, 512 children | 9     | `timeout.exe` refuses a stdin that is no console and exits at once, so its children never added up. Behind it: Node throws the job's refusal from `spawn`, so the flood died with no marker; and live children hold their parent, so the flood's root lived for their whole sleep. A runner starts about 30 processes a second, so 513 and the settle pass 30 s.                                                                                 | test    | Yes, each in turn     |
| `resourceForkProtection`, spawn flood  | 9     | 16,384 births in 15 s is 1,092 a second, which a hosted runner cannot start, nor this PC (both past 60 s with the flood running).                                                                                                                                                                                                                                                                                                                | test    | Yes                   |
| `fileLease`                            | 6     | `canReadProcessBirth` asked PowerShell with a 5 s limit and read a slow cold start as "no process table", though the product stopped reading birth through PowerShell. Inferred: only the suite's first case failed, at 8,660 ms, later calls passed, and the whole file passed in the run before. A false answer gives this case's red (drill T6).                                                                                              | test    | Not the cold start    |
| `pathGuardSpawns`                      | 3     | CC-CIFIXW's `reg.exe` start and CC-WINFIX2's reader through `windowsPowerShell` were never recorded. Every OS is red on it.                                                                                                                                                                                                                                                                                                                      | test    | Yes, the two lines    |
| `connectorServe`                       | 5     | A cold first PowerShell: past 15 s on the first case, about 2 s on each later one, and the first PowerShell user of its shard.                                                                                                                                                                                                                                                                                                                   | test    | No, warm here         |
| `devicesPhase2Harness`                 | 5     | A cold Chrome: 5.4 and 5.0 s for the first two scenes, 1.1 s after.                                                                                                                                                                                                                                                                                                                                                                              | test    | No, warm here         |
| `makerReviewBrowser`                   | 4     | A cold Chrome: 5.4 s to the first approval, 3 s lost on its first scroll, about 1.3 s a case after. Throttled 20 times here, the case fails at 3 s and passes with a longer wait, so the scroll is slow, not lost.                                                                                                                                                                                                                               | test    | By throttle           |
| `feedbackBrowser`                      | 9     | Its one hook wrote the pseudo table, started the server and launched Chrome, and passed 30 s; in the run before, the whole file took 8.9 s. Which of them is not settled; Chrome's start is now a hook of its own under the same 30 s, so the next log says.                                                                                                                                                                                     | test    | No, warm here         |

**No case's or hook's budget rose, and the job limit is untouched.** The cold starts moved into hooks, as `checkCommands` and the broker
fixture already do. `connectorServe`'s new hook uses the repository's `FIXTURE_HOOK_TIMEOUT_MS`. `fileLease`'s probe lost its clock by
asking something that starts no process. The fork cases' bounds went down, to the default 15 s. One thing to judge: splitting
`feedbackBrowser`'s hook keeps each hook at 30 s, but its preparation as a whole may now take longer than 30 s.

**The fork cases' narrowing.** `ResourceWindowsJob.forkCaps` is the same seam as `ResourceLaunchHost.forkCaps` on POSIX: production
leaves it unset and enforces the shared constants. The helper, the kernel's count, the flood and the typed stop are all real.
What this gives up: no Windows run now reaches the product's own 512 and 16,384. Those two values reach the helper through
`ATTESTED_JOB`, read here, and no test watches them arrive.

## 5. `quality (windows-latest)`

It has no step of its own to fix. It is the roll-up in `build.yml`: `CHECKS` was success, and it exits 1 at `test "$UNIT" = success`
(`UNIT: failure`, `ACCESSIBILITY: failure`). Every Windows job of its own passed: `static gates` lint, build and unit lint, and
`integration`. So its red is the unit shards above, and the accessibility job, which is in the Mac lane's part of the brief.

## 6. What the cut logs never reached

The hung shards left **196 files that never ran** on hosted Windows in this run: 80 of shard 3, 84 of shard 14, 13 of shard 6 and 19
of shard 9. The last three shards' 116 did not run in the run before either. Any of them may hold another red, so this lane ran what it
may: **185 files: 177 passed, 5 skipped, 3 failed** (6,804 cases passed, 29 skipped, 785 s).

| File                              | What                                                                                                                                                                                      | Now                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `teamWorkerCreateBundle`          | **The next red on hosted Windows.** Its copy sits under a temporary folder spelled through an 8.3 name, and the worker fence refuses that as outside. The product's copies are canonical. | Fixed in the suite (T19): cause D of `cc-cifixw.md`                |
| `createdRegistryQuarantineResume` | Its directory link needs a privilege this PC's account lacks and the hosted one has.                                                                                                      | Runs where `canLinkFiles()` says the account may, as the others do |
| `estimatorPlanSnapshotSource`     | Its "no repository" case is red here only because this lane's `TEMP` sits inside the worktree. It passes with `GIT_CEILING_DIRECTORIES` stopping git at `temp/`.                          | Unchanged: not a hosted red                                        |

Not run: the 10 under the vault rule (`credentialMigrationStore`, `windowsVaultPanelFlow` and `windowsBrokerClient` among them), and `nodeWorkspace.live`, which is a live suite. The list is the tree the run tested: a new test file moves the shard boundaries.

## 7. Drills

Each line broken on purpose, run, restored byte-exact (the tool compared hashes), run again. Every red exited non-zero and every green
exit 0. `P` is a product fix, `T` a test or harness change. Hosted shape.

| Drill                                                                    | Suite                     | Red                                                      | Green                        |
| ------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------- | ---------------------------- |
| P1: the server answer carries the parent again (the state CI ran)        | the relay child, by hand  | exit 2 in 1.5 to 1.9 s, the schema's words on its stderr | exit 0, 61 to 77 ms          |
| P1b: the same                                                            | the broker start, by hand | `$ZodError` on attempt 1, no answer in 25 s              | state `uncreated`, attempt 1 |
| P2: the video probe names a cmdlet again (the state CI ran)              | judgeHardware             | 1 failed, 18 passed, 2 skipped (21)                      | 19 passed, 2 skipped (21)    |
| P3: the video probe answers one card bare (the old shape)                | judgeHardware             | 1 failed, 18 passed, 2 skipped (21)                      | 19 passed, 2 skipped (21)    |
| T1: the fixture's wait retries every error (the state CI ran)            | brokerFirstAnswer         | 1 failed, 4 passed (5)                                   | 5 passed (5)                 |
| T2: the wait has no bound                                                | brokerFirstAnswer         | 3 failed, 2 passed (5)                                   | 5 passed (5)                 |
| T3: a scanner lock gets no retry                                         | windowsRecording          | 2 failed, 9 passed (11)                                  | 11 passed (11)               |
| T4: a lock that never clears retries past its attempts                   | windowsRecording          | 1 failed, 10 passed (11)                                 | 11 passed (11)               |
| T5: the helper denies new entries only (the state CI ran)                | windowsRecording          | 3 failed, 8 passed (11)                                  | 11 passed (11)               |
| T6: the birth probe answers no while the reader works (the hosted red)   | fileLease                 | 3 failed, 31 passed, 1 skipped (35)                      | 34 passed, 1 skipped (35)    |
| T7: the birth reader cannot build while the probe says yes               | fileLease                 | 6 failed, 28 passed, 1 skipped (35)                      | 34 passed, 1 skipped (35)    |
| T8: the `reg.exe` start leaves the reviewed record (the state CI ran)    | pathGuardSpawns           | 2 failed, 5 passed (7)                                   | 7 passed (7)                 |
| T9: a gate hangs at collection                                           | judgeP2Delivery           | the file fails naming the gate, no case runs             | 103 passed (103)             |
| T10: the split gate stops guarding one judge-only source                 | judgeP2Delivery           | 4 failed, 99 passed (103), all four that source's        | 103 passed (103)             |
| T11: the allowlist control leaves one entry in place                     | judgeP2Delivery           | 1 failed, 102 passed (103)                               | 103 passed (103)             |
| T12: the job ignores its narrowed caps (the launch as CI ran it)         | resourceForkProtection    | 3 failed, 4 skipped (7)                                  | 3 passed, 4 skipped (7)      |
| T13: the job's cap sits above the flood                                  | resourceForkProtection    | 1 failed, 2 passed, 4 skipped (7)                        | 3 passed, 4 skipped (7)      |
| T14: the sleeper exits at once again (the suite as CI ran it)            | resourceForkProtection    | 1 failed, 2 passed, 4 skipped (7)                        | 3 passed, 4 skipped (7)      |
| T15: the connector's hook cannot grant                                   | connectorServe            | the hook fails naming the grant, 5 skipped               | 6 passed (6)                 |
| T16: the harness hook waits for a page that never gets ready             | devicesPhase2Harness      | the hook fails naming the locator, 10 skipped            | 10 passed (10)               |
| T17: the maker hook opens no approval                                    | makerReviewBrowser        | the hook fails naming the locator, 16 skipped            | 16 passed (16)               |
| T18: feedback's Chrome hook cannot start Chrome                          | feedbackBrowser           | the hook fails naming the launch, 8 skipped              | 8 passed (8)                 |
| T19: the packaged suite keeps the 8.3 spelling (what a shard would meet) | teamWorkerCreateBundle    | 1 failed (1), the hosted words                           | 1 passed (1)                 |

**One drill needed a second try.** T13's first form lowered the children to 8 and stayed green: 32 workers each start one before any
of them counts, so the job still passed its cap. It proved nothing and was replaced by the one above; the suite's own assertion was
right.

**P1 is a drill by hand** because the suite that holds the server answer's proof (`windowsPipeRelay`) is a vault suite: hosted CI runs
it, and this PC runs its child. The cold starts have no drill, since nothing here is cold: T15 to T18 show only that each new hook fails
with words, and hosted CI decides whether the moves were enough.

## 8. Gates

Node 22.23.4, on `42db49461c` (this record's commit adds only this document):

| Gate                                                                                                 | Exit   |
| ---------------------------------------------------------------------------------------------------- | ------ |
| `npm run format:check`                                                                               | 0      |
| `npm run lint`                                                                                       | 0      |
| `npm run typecheck`                                                                                  | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap` | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                          | 0 each |
| `npm run check:host-api`                                                                             | 0      |
| `npm run build`                                                                                      | 0      |
| **This run's Windows failures this PC may run, with what they touch** (14 files, hosted shape)       | **0**  |
| **The files the cut shards never reached** (185 files, hosted shape, before section 6's two changes) | 1      |
| Those three files again, after them (`GIT_CEILING_DIRECTORIES` for the third)                        | 0      |

The first set: **14 files, 266 passed, 7 skipped.** The second's exit 1 is section 6's three.

Not run: the whole unit suite, the vault and credential-store suites, the packed product's real-life run (it spends money, and the brief
makes no provider request) and hosted CI. The Windows vault fix has one use of the real thing, the broker's start from a scratch
script; nothing here has used a vault set up on Windows.

## 9. Open, named for the lead

**Only hosted CI can decide these.** Each is green, unrunnable or unreproducible here:

- **The four broker suites after the fix:** `windowsBrokerClient`, `windowsVaultPanelFlow`, `credentialMigrationStore`, and
  `windowsPipeRelay`'s case. They have not passed on hosted Windows since D243, and what they do after the first answer (setup, DPAPI
  and CNG slots) cannot be run here. That the hosted hang had this cause is itself inferred: its logs hold no text, and it was reproduced
  here. A red there now carries its reason.
- **`vaultStoreScope`'s Windows case with the real binding** is read only: its staging was checked, but the case has never reached its
  first store read on any Windows machine, and may meet more behind it.
- **The inferred causes:** `fileLease` and the four cold starts. If one stays red, its log now has text.
- The hosted account (RID 500, elevated) in `denyRemoval`: a deny on the account's own SID should hold under an elevated token, and
  this PC's account is neither.

**Overlaps with RLF-CIFIXC, which I could not see.** No branch of it is on this repository's refs. Each is a conflict of one small hunk
at the merge, not a difference of fact: `pathGuardSpawns`' two rows and `judgeP2Delivery` (both red on every OS), and
`resourceForkProtection` (this lane changed only the Windows `describe`, plus one type on `launch.ts`).

**Not settled:** whether `feedbackBrowser`'s 30 s went to Chrome; and `parseCimVideo` refuses a whole answer if any card has no driver
version, which reads as an unknown card and which this lane left.

**Left as they are.** `checkCommands`' cold-start hook is synchronous with no limit, so a PowerShell that never ended would hold its
shard; nothing has ever shown that, and it is the owner's word of 2026-10-16. The other cmdlet scripts `cc-winfix2.md` names:
`runtime/tokenFile.ts`, `core/maker/serial/listPorts.ts`, `core/resources/sampler/optionalProbes.ts`,
`host/media/recordingLatest.ts`, `runtime/schedules/nativeBackground.ts`. The judge probe was the one with a red on it.
