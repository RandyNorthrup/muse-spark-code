# The session-spend reservation lock on Windows

2026-10-12. Branch `fix/session-lock-windows`, from main `898a26c5e3` (release 0.18.2).

## What a person could see

Two requests that reserve session spend at the same moment (two windows, or
a main turn and a side call) on Windows: one of them could end with "The
session spend ledger could not be read or saved. No new request can be sent
until it is available." Nothing was wrong with the ledger.

## How it was found

Hosted CI, pull request 154, head `0b620d9e81`, run 38335188453, job
`build / tests (windows-latest, shard 8)`:
`test/unit/sessionBudgetJournal.test.ts > the real-disk session budget journal (M82) > publishes both independent liabilities before either final sum, with no winner election`
failed with that sentence, caused by
`EPERM: operation not permitted, mkdir '…\budget-intents\…\session-1.lock'`
(errno -4048) at `withReservationLock`. The same test had failed once before
on another head and passed on the next run of the same code.

## Cause, measured

The lock is a directory: `mkdir` takes it, `rmdir` releases it, and a taker
that finds it held waits `DAILY_BUDGET_LOCK_WAIT_MS` (10 ms) and tries again,
up to `DAILY_BUDGET_LOCK_ATTEMPTS` (100) times. Only `EEXIST` counted as
"held"; every other answer was reported at once as "the ledger is
unavailable".

Measured on Windows 11 (build 26200), Node 24.20.0, with no product code
(two holders taking and releasing one lock directory as fast as they can):

| Holders | Takes  | `mkdir` answered `EEXIST` | `mkdir` answered `EPERM` | `rmdir` failed |
| ------- | ------ | ------------------------- | ------------------------ | -------------- |
| 2       | 6,000  | 6,119                     | 494                      | 0              |
| 4       | 12,000 | 25,869                    | 688                      | 0              |

How long a spell of `EPERM` lasts, 105 spells in 6,000 takes: median
0.253 ms, 99th percentile 7.480 ms, longest 8.641 ms. The same holds for a
lock FILE taken with an exclusive create (`open(…, 'wx')`, released with
`unlink`): 667 `EPERM` beside 7,220 `EEXIST` in 6,000 takes.

So on Windows a name whose last holder is still removing it answers `EPERM`
for up to a few milliseconds, not `EEXIST`. Holding a handle on the directory
does not reproduce the state (measured: `mkdir` then answers `EEXIST` or
succeeds), so it cannot be produced on purpose in a test.

Through the product's own module on a real folder (two real journals, 400
meetings of two reservations each; the temporary measurement is not in the
tree):

| Product code | Wait between attempts                           | Reservations refused, per run of 400 meetings |
| ------------ | ----------------------------------------------- | --------------------------------------------- |
| main         | none (the stand-in the existing test file uses) | 4, 4, 6 (each `EPERM`)                        |
| main         | the product's 10 ms                             | 0                                             |
| this branch  | none                                            | 0, 0, 0                                       |
| this branch  | the product's 10 ms                             | 0                                             |

With the product's real wait the refusal is rare (none in 400 meetings on
main), because a taker that waited 10 ms has outlasted the spell; it remains
possible for a taker whose FIRST attempt lands in a spell. One earlier run on
this branch with no wait between attempts did exhaust all 100 attempts inside
one spell (a few milliseconds): with no wait the bound is not the product's.

## The change

`src/host/backend/sessionBudgetJournal.ts`: `isReservationLockHeld(code, platform)`
says which `mkdir` answers mean "held right now": `EEXIST` everywhere, and
`EPERM` on Windows. `withReservationLock` waits on exactly those, within the
same bound, and when the bound is used up it reports the last answer as the
cause (before, the cause was dropped). Any other answer is reported at once,
as before. `EACCES` is not waited on: it was not measured.

## Proof

- `test/unit/reservationLock.test.ts`: the decision, through the real module
  (pure logic). Red drill: with the Windows branch removed
  (`return code === EXISTS`) the file exits 1
  (`AssertionError: expected false to be true`, 1 failed, 2 passed); restored,
  it exits 0 (3 passed).
- The measurements above.
- Not proven here: the hosted Windows job itself. The existing real-disk test
  that failed there runs with no wait between attempts; on this branch it was
  not refused in 1,200 meetings on this machine, and one earlier run was.

## The same pattern elsewhere (not changed here)

An exclusive create that only treats `EEXIST` as "taken", on a name that is
created and removed repeatedly: `src/runtime/providersCommands.ts`
(`withUserFileLock`: one `mkdir`, no wait) and
`src/core/orchestration/playbook/journal.ts` (`mkdirSync(lock)`, no wait).
Both fail fast by design when the lock is held; on Windows they can also fail
when it has just been released. `src/core/locks/fileLease.ts` creates its lock
file through a port whose Windows behaviour in that state was not measured.
The spend-ledger redesign (branch `fix/spend-ledger`) replaces this
directory lock; this change is for the release before it.

## Records

CHANGELOG: one entry under Unreleased, Fixed. PLAN.md: no row in this pull
request: the file is within a few hundred bytes of its size limit until its
closed history is archived; the row goes in with the archive.
