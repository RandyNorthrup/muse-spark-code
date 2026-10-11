# ACTFLAKE — apply suite cleanup race with the fixture origin

Recorded 2026-10-07 in `mx-actflake`, branch `fix/action-apply-cleanup`, from
`d5bb9f288f3e6ceec206df965c82bd4c105ce437`. Scope: the Action's test
fixtures (`test/unit/helpers/actionFixtures.ts`) and one new test in
`test/unit/actionApply.test.ts`. No production code, model call, credential
or dependency changed. Orchestration register row: G65.

## Failure

Action check run 37727455028, attempt 1, job 113148764307 (ubuntu-24.04
image 20260927.320.1, Git 2.55.0, Node 22.23.3), on PR #142, which only
bumps dev tools:

```text
FAIL test/unit/actionApply.test.ts > the apply sub-action (G25) > prepares the exact patch on the exact head, then ...
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/muse-action-DstXAG/source-1791433586325-9020953695241538.git'
 ❯ Object.cleanup test/unit/helpers/actionFixtures.ts:71:7
```

The failing case took 1,880 ms; its passing runs take 200–400 ms. Node 22's
`rmSync` (the JavaScript rimraf) lists a directory once, removes the listed
children, then retries only `rmdir` on it, sleeping 100 to 500 ms
(`maxRetries: 5`, 1.5 s in all). Failing on the origin's top directory after
that means an entry appeared there after the listing and was still there
1.5 s later.

## Cause

`originRepo` built the bare origin with plain `git clone --bare` and
nothing else. The Action's push (`action/apply/lib/apply.mjs:211-227`,
through `safeGit`) runs with `-c maintenance.auto=false -c gc.auto=0`
(`action/lib/git.mjs:30-42`). A push to a local path runs `git-receive-pack`
in the origin, and Git strips `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`
from that child (`local_repo_env`). The origin reads only its own
configuration and the Action's empty global file, so `receive.autoGc` is on.
After every push receive-pack starts `git maintenance run --auto --quiet
--detach` in the origin. On POSIX that process forks, calls `setsid` and
outlives the push. Its parent's exit lets receive-pack, and then the push,
return.

Git 2.55, the runner's Git, makes this a write race. Measured on the Kubuntu
rig with `strace -f` around one push of the fixture's shape:

- **Git 2.53:** the detached child reads only `objects/17` (the `gc` task's
  loose-object estimate) and exits. Its parent removes
  `objects/maintenance.lock` before exiting.
- **Git 2.55:** `daemonize` reassigns the lock to the detached child, which
  removes it after the push client has exited. Unscheduled maintenance now
  defaults to the `geometric` strategy (`builtin/gc.c`
  `initialize_task_config`). Its `geometric-repack` task is due when
  `objects/17` holds more than `ceil(100 / 256) = 1` loose object, and it runs
  after detaching.

The proposal's blob `first\nsecond\nproposed\n` is
`17ede717730742d989f0961ac04fd49245d62287`, so after each Action push the
origin's `objects/17` already holds one object. One of the three commits
(their ids carry timestamps) landing there too makes the repack due, about
1.2% of pushes. That repack then writes into the origin while `afterEach`
removes it.

Plain Git's own commits in the fixture (`source`, the lease test's `racer`)
start the same detached maintenance in those repositories, because plainGit's
global file did not exist.

## Change

- `originRepo` clones the bare origin with `--config receive.autoGc=false`.
  This is the one setting a local push's receive side honours from the
  origin itself, on every Git version. A hosted origin does its own
  maintenance on its own servers.
- `tempLayout` writes plainGit's global file (`plain-gitconfig`, already named
  by `plainGit`) with `maintenance.auto = false` and `gc.auto = 0`, the same
  pair `GIT_METADATA_OPTIONS` gives the Action's own commands.
- New test `starts no Git maintenance in the fixture repositories: not from a
push, not from a commit`. It sets a witness in the origin and in a plain
  clone: `maintenance.autoDetach=false`, so a run finishes before its command
  returns on every OS, plus `maintenance.commit-graph.enabled=true` and
  `maintenance.commit-graph.auto=-1`. The test pushes with the Action, then
  commits and pushes with plain Git, and asserts no `objects/info/commit-graph*`
  in either repository. An explicit `git maintenance run --auto` in each
  repository then proves that the witness fires.

Retries, timeouts and the cleanup call are unchanged, and no error is
swallowed. Production behaviour is unchanged (no CHANGELOG entry). The
Action's own Git commands already run with automatic maintenance off. Its
real remote is https, so no receive-pack runs on the runner.

## Reproduction rates (Kubuntu, 10 cores)

All loops use Git 2.55.0, built from the release tarball into a private
prefix (`NO_RUST`, `NO_CURL`), and Node 22.23.3, the runner's versions. They
run four parallel workers of `vitest run test/unit/actionApply.test.ts` in
rig slots. "Loaded" adds eight busy-loop processes (load average about 20).

| Tree                         | Load   | Runs | Failed | `ENOTEMPTY` |
| ---------------------------- | ------ | ---- | ------ | ----------- |
| main `d5bb9f288` (before)    | idle   | 600  | 1      | 1           |
| main `d5bb9f288` (before)    | loaded | 600  | 2      | 2           |
| fix (after)                  | idle   | 600  | 0      | 0           |
| fix (after)                  | loaded | 600  | 0      | 0           |
| main + forced repack (drill) | idle   | 100  | 100    | 4           |
| fix + forced repack (drill)  | idle   | 100  | 0      | 0           |

Each failure before the fix was `ENOTEMPTY` on the origin `source-*.git`, in
one of the two cases whose Action push succeeds, the same as in CI. "Forced
repack" sets `maintenance.geometric-repack.auto=-1` in the origin, so every
push's maintenance repacks. In that drill the new test failed in all 100 runs
(`the origin after the Action push: expected [ 'commit-graphs' ]`).

## Test-fire proof

- Fix reverted (no `--config receive.autoGc=false`, no plain global file),
  with the new test kept: the new test fails on Linux with Git 2.53 and with
  Git 2.55 (100 of 100), at `the origin after the Action push`.
- Plain global file emptied, `receive.autoGc=false` kept: the new test fails
  at `the clone after a plain commit: expected [ 'commit-graphs' ]`.
- Restored. The rig's final slot holds the same SHA-256 as the commit for
  both files (`actionFixtures.ts` `0527144b…552e5`, `actionApply.test.ts`
  `6aa85738…968f`).

## Regression set

The `action-check.yml` suites job runs `actionGate`, then `actionApply` with
`actionGit`, then `execTestLauncher.e2e`. The other users of these fixtures
are `actionInputs` and `actionRunExec`.

- Kubuntu, Git 2.55.0, Node 22.23.3: all eight `test/unit/action*.test.ts`
  files plus `execTestLauncher.e2e.test.ts` passed, 9 files and 164 tests.
- Mac mini, Apple Git 2.50.1: `actionGate`, `actionApply`, `actionGit` and
  `execTestLauncher.e2e` passed, 4 files and 80 tests.
- Windows host, Git 2.52.0.windows.1, Node 24.20.0: the same four files passed,
  4 files and 80 tests (vitest exit 0).

Gates on changed files (Windows host): `npm run typecheck:unit` exit 0;
`eslint --max-warnings=0` on both test files exit 0; `prettier --check` on
all five changed files exit 0. The full `npm run quality` was not run, so
hosted CI remains the gate.
