# CC-WINFIX4 — hosted CI run 41561620943, the Windows reds left (2026-11-02)

Claude Code lane `CC-WINFIX4`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch `cc/winfix4` from `cc/winfix3` at `029e7ae4af`,
the commit the run tested, on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**. Muse requests: **0**. Nothing was
pushed, rebased, stashed, reset or tagged. "Hosted shape" is as in `cc-winfix3.md`.

**Nothing of the vault ran here this time.** No vault or credential-store suite, no scratch script that starts a broker, and nothing
that loads the keyring. Both vault reds below were worked out from the logs and the code, so **hosted CI is their first proof**. The
only related thing run here is one scratch check of how a junction is removed, on an empty folder of its own.

The run showed what the last round's vault fix did: 48 jobs passed, no Windows shard hung, and `windowsBrokerClient`, `windowsVaultPanelFlow`
and `windowsPipeRelay` passed on hosted Windows for the first time since D243.

## 1. The reds

| Red                                                 | Shard | Cause                                                                                                | Shown or inferred                                               | Side    |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| `vaultStoreScope`, Windows: `scoped checkpoint`     | 16    | A first-party read writes no audit row, so the case waited for a checkpoint nothing writes           | Shown by the code; the log shows the wait                       | test    |
| `vaultStoreScope`, behind it: not yet seen in a log | 16    | The next audited use after a pre-scoping checkpoint fails: `prepare` reads only the scoped account   | Read from the code; **no log has reached it**                   | product |
| `vaultStoreScope`, macOS: `scoped anchor`           | 16    | The staged broker has no keyring binding, so it uses its file anchor: Windows' red of the run before | The same words; the Windows fix took it past that line          | test    |
| `vaultStoreScope`, macOS: `No access`               | 16    | The case's two slots take `Date.now()` apart, and a slot's record binds its creation time            | The log's line 152 is that comparison; the time is read         | test    |
| `credentialMigrationStore`, 3 cases                 | 3     | The suite shares one vault, and the retire case before them leaves the same slot retired             | The first red's words name it; the other two follow, read       | test    |
| `osImageBuildUpdateChannel`, wrong keyid            | 14    | The "wrong" keyid is the key's own when the throwaway key's id begins `00`, 1 run in 256             | **Inferred**: the log prints no keyid. Drill T1 gives its words | test    |
| `privateDirectory`, first real case                 | 15    | The shard's first Windows PowerShell start is cold                                                   | **Inferred**: 15,007 ms, then 956 to 2,196 ms a case            | test    |

**One cause for the Windows and macOS legs of `vaultStoreScope`?** No, three, and the suite had never passed anywhere it ran: `origin/main`
does not hold it, and it was written in a container that could not run it (`rlvaultanchor.md`). Each OS was stopped at a different line:

- **The binding** stopped macOS, as it stopped Windows in the run before.
- **The audit row** stopped Windows, and would have stopped macOS next.
- **`createdAt`** is macOS's alone only because that case skips Windows.

This lane fixed all three, in the suite and in `posixPanelFixture.ts`, since the two legs share the flow. RLF-CIFIXC holds the macOS reds, so
these two files may meet at the merge.

## 2. `vaultStoreScope`

**What a first-party read writes.** The case read a first-party row and waited 60 s for the audit checkpoint: `the read audited`. The broker
never audits one. `state.ts` sends a `private` command to `release` with no `audit` step; `audit()` is reached only from a requester's uses and their
tickets; and a record's `kind` names no first-party read, so D89.3's "first-party uses stay in the host" and D89.11's record agree. The test was wrong,
not the product.

**What the case does now.** A real requester registers on its own connection, reports its provenance and asks to use a handle no item has. The
broker refuses that (`scope`) and records it, whatever the person's policy says, and it answers only after the row and the checkpoint are written.
This needed `vaultPolicy.js` in both fixtures: registration reads it, and the staged packages did not carry it.

**The product fault behind it.** The case then moves the checkpoint to the pre-scoping account and expects the next audited use to migrate it. As
written that use fails. `read()` takes the legacy record as its base, so the new head is generation _g_ + 1; `prepare()` read only the scoped
account, got generation 0, and the pending schema refuses a next head that is not previous + 1. So **a vault with a pre-scoping checkpoint could
not record a use, and an audited use that cannot be recorded fails**. `prepare()` now reads the same base as `read()`. No hosted run has reached
this; the case's migration step is its first proof.

**macOS.**

- `posixPanelFixture` takes `osStore`, as the Windows fixture does: a link beside `dist`, where a package that ships the binding has it.
- `slots wrap scoped references` takes one `createdAt`. Its second slot was built later, with a later `Date.now()`, against a record that carried the first.

**The failure path in the Windows fixture.** A case that fails disposes the fixture a second time, and `unlink` on the gone junction would have thrown
over the real failure. It is `rm` with `force` now. Checked on an empty scratch folder: the link goes, the target stays whole, and a second removal
does not throw.

## 3. `credentialMigrationStore`

`expected [ 'museSpark.provider.chatgpt' ] to deeply equal []` is `driveUndoRetiredCase` finding its slot already retired. On Windows all eight cases
share one vault (`fresh: false`), and `retires the legacy entry` runs first with the same codec. On POSIX each of these cases has a client of its own
(`withClient`, `fresh: true`). The cases had never run on hosted Windows: this shard hung, or failed at its hook, in the two runs before.

The other two reds (`expected false to be true` in `assertMigratedSlot`) follow by reading: with the slot retired by an earlier case, the case's
`ensureMigrated` does not leave the state it asserts. They have no text of their own to confirm that.

The three cases now run in `windowsRetiredFlow.test.ts`, each with a fixture of its own and `fresh: true`. They are a new file because of the job limit: on
this suite's shard, 3, they failed within 24 s, and that shard still took 16 min 19 s of its 20, with `legalTemplateSlots` and `legalTemplateSlots2` taking 7
of them. Run through for real they could have reached the limit, and a shard held at the limit says nothing. By vitest's own hash the new file lands in shard
2, which took 6 min 18 s, and no other file changes shard (computed from this tree). The case budget is unchanged. Shard 3 is left for the lead to watch:
it has about 4 minutes to spare.

## 4. `osImageBuildUpdateChannel`

`` `00${targetsKeyid.slice(2)}` `` is the key's own id whenever that id begins `00`, and the root is then simply valid: `TUF_OK`. The keys are generated
per run, and the same file passed on hosted Windows in the run before. **Inferred:** the log prints no keyid, and I found no other road to `TUF_OK` in
`channel.py`. Drill T1 forces that state and gives the hosted words. The wrong id now always differs by one digit.

## 5. `privateDirectory`, and why cold starts keep moving

The cold start has now cost a case in three runs, in whichever suite a shard reached first: PR 165 (`checkCommands`), 41516831678 (`connectorServe`) and
this one. A hook in each named suite only moves the red, since a new test file moves the shard boundaries. So:

- `test/unit/globalSetup.mjs` starts Windows PowerShell once before any worker, with the modules the suites read, and prints its time: `Windows PowerShell
cold start: 2416 ms (exit 0)` here. **The next hosted log says how long it really is**, which settles this inference either way.
- A start that never answers is ended at 180 s and said; the run goes on, and the suites that need one report for themselves.
- `privateDirectory`'s describe also takes its first real start in a hook, as `connectorServe` does.

No case's or hook's budget rose.

## 6. Drills

Each line broken on purpose, run in the hosted shape, restored byte-exact (the tool compared hashes), run again. Every red exited 1 and every green 0, except T4,
which is meant to exit 0.

| Drill                                                                     | Suite                     | Red                                                           | Green                     |
| ------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------- | ------------------------- |
| T1: the wrong keyid is the key's own (what a key beginning `00` makes it) | osImageBuildUpdateChannel | 1 failed, 26 passed (27), the hosted `TUF_OK`                 | 27 passed (27)            |
| T2: the channel stops recomputing keyids                                  | osImageBuildUpdateChannel | 1 failed, 26 passed (27), `TUF_BAD_SIGNATURE`                 | 27 passed (27)            |
| T3: the private root's hook reads a folder that is not there              | privateDirectory          | the hook fails naming the command, 12 skipped                 | 37 passed, 7 skipped (44) |
| T4: the warm start cannot start                                           | pathGuardSpawns           | exit 0, 7 passed, and the line says `ENOENT`: the run goes on | 7 passed (7)              |

**The vault changes have no drill here**, by the rule above. T1 and T2 are this PC's.

## 7. Gates

Node 22.23.4, on `bcb097c213` (this record's commit adds only this document):

| Gate                                                                                                 | Exit   |
| ---------------------------------------------------------------------------------------------------- | ------ |
| `npm run format:check`                                                                               | 0      |
| `npm run lint`                                                                                       | 0      |
| `npm run typecheck`                                                                                  | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap` | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                          | 0 each |
| `npm run check:host-api`                                                                             | 0      |
| `npm run build`                                                                                      | 0      |
| **This run's Windows failures this PC may run, with what they touch** (4 files, hosted shape)        | **0**  |

The last set: `osImageBuildUpdateChannel`, `privateDirectory`, `brokerFirstAnswer` and `createdRegistrySaveErrors`, **4 files, 72 passed, 7 skipped.**

Not run: the whole unit suite, the vault and credential-store suites (so `vaultStoreScope`, `credentialMigrationStore` and the new `windowsRetiredFlow`
have not run at this head on any machine), the packed product's real-life run (it spends money, and the brief makes no provider request) and hosted CI.

## 8. Only hosted CI can decide

- **`vaultStoreScope` on Windows and macOS.** Everything after `scoped anchor exists` has never run anywhere: the refused use, the checkpoint, the migration
  through `prepare()`, and the record removal. A refused use on Windows also goes through the audit writer's Windows path (`privateFileWriter`, the claim-file
  lock) on a real checkpoint for the first time.
- **macOS with the real binding.** Whether the broker reaches the login keychain without a prompt. The suite's own probe from the test process does.
- **`credentialMigrationStore`'s three cases in their own vaults.** They have never run on hosted Windows past these reds. `driveUndoCrashCase` kills a real child
  on a real store, and it may meet more.
- **The two inferred causes.** A `TUF_OK` again would mean another road than the one drilled. `privateDirectory` can be read against the printed cold start.

**Not settled:** why the other two `credentialMigrationStore` reds read as they do, beyond following from the shared state.
