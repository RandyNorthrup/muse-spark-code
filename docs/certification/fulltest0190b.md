# FULLTEST2 on JOINB (truth + platform) — whole unit suite, 0.19.0

Lane: FULLTEST2 (`test/0190-fullsuite-b`), worktree on JOINB head `186f08d437`
(plus 8 fix commits below). Repo-default timeout throughout (5 s per test);
no `--testTimeout`, no timeout or budget raised. Shards run as CI runs them:
`npx vitest run --shard="N/8"`. e2e live tests skip (no keys) by design;
`reports.e2e` and `schedulesStdio.e2e` run inside the shards and pass.

## Blocker 0 (tree-wide): 0.19.0 notes over the What's New bound

`npm run build` and **every** unit shard failed: the joined 0.19.0 section
decoded to 90480 bytes, over the 76800-byte bound, and `globalSetup` builds
the production package before collecting tests (verified in vitest 5.0.3:
`initializeGlobalSetup` receives the unsharded spec list, so one
`packagedBundles` file poisons all 8 shards). Fix: condensed the verbose
0.19.0 bullets (~358+/576−) without dropping any feature, fix, lane id,
command or marker; `0.19.0` and `0.18.2` ship full again, which
`whatsNewContent`'s real-changelog tests require. Commit `89c323d618`.

## Defect 1: admission boundary missed the exact-birth re-exports

Build then failed `check-bundle-split`: `dist/vaultStore.js` reads
`exactCurrentProcessOwner`/`exactProcessBirth` from
`dist/resourceAdmission.js`, which did not export them. PR #220 added the
functions and their use in `vault/store.ts` but never extended
`admissionEntry.ts` — `undefined` at runtime on the vault writer path.
Fix: re-export both with the other process identities. Commit `493131d7a4`.
Build is green with budgets after this.

## Defect 2: strict-C11 race fixture never declared nanosleep

`inspectNative` B1 failed to compile `inspectRace.c` under `-std=c11
-Werror`: no `<time.h>` anywhere, and strict C11 hides `nanosleep` even
with the header (minimal repro kept). Fix: `_GNU_SOURCE` (the level the
confine program itself names) plus `<time.h>` in the fixture; a first try
with `_POSIX_C_SOURCE` hid the GNU extensions the confine code needs and
was corrected before committing. Compile verified with the test's exact
flags. Commit `cf1d24c1bc`.

## Defect 3: hook matcher checks inherited the 25 ms production bound

Shard 2 failed `importHookSources` RVM91I-7 (`expected false to be true`)
with no other signal; the file passes alone and a sibling test flaked the
same way under load. Cause: `isAdmitted` calls `matchingHooks` with the
default noop warn sink, so a lapsed `HOOK_MATCHER_TIMEOUT_MS` (25 ms VM
deadline) reads as a plain non-match. Fix per the engine's documented
contract ("only tests pass another value", as `foreignHooks.test.ts`
already does with 60 s): pass `TEST_MATCHER_TIMEOUT_MS = 60_000` in both
helpers and fail loudly on any matcher warning. Verified green twice
under the load combination that reproduced the flake. Commit `37b499eaba`.

## Slow tests fixed at the cause (same assertions, same floors)

- `vault/scrub` 1,000-value floor (3.2 s alone): construction builds a
  ~400 K-node trie while the measured scrub takes 7 ms. Build once in
  `beforeAll`, dispose in `afterAll`; test now 21 ms. Firing proven by
  breaking the floor on purpose (measured 467 MB/s vs absurd floor).
  Commit `5fbd6e4c9a`.
- `browserUiText` canonical shape (2.8 s): walked every table twice
  in-test. Walk once per English source in `beforeAll`, compare stored
  arrays in-test, still install every locale live (916 ms). Commit
  `e14b694faa`.
- `usageL10nGate` byte-for-byte ×2 (~1.2 s each): stage the complete tree
  once in `beforeAll` and assert the stored packaged verdict (4 ms); the
  missing-key case stages only the usage archive it mutates (847 ms).
  Firing proven by corrupting the stored verdict on purpose. Commit
  `b9e7af5e6c`.
- `ResourcesSection` week paging (1.1 s, plus an in-file comment noting
  earlier 5 s misses on hosted Ubuntu): aggregate the week once in
  `beforeAll`, capture each page state's rows once, page minutes and
  events in two tests asserting everything the single test did.
  Commit `90ff2baadb`.

## Sandbox-only failures (proven, no repo change)

This rig denies what hosted CI (`ubuntu-latest` shards, default umask
022, short tmp) does not:

- `vault/brokerSession` ×4, `vault/brokerWithoutKeyring` ×1,
  `vault/brokerSocketDirectory` ×2: `os.tmpdir()` here is 127 chars, so
  every socket candidate exceeds the 107/103-byte kernel bind limit
  (`node -e "os.tmpdir()"`); the broker correctly refuses in a sentence
  and the client burns the 5 s discovery deadline (timed manual client
  run: exactly 5 s, exit 1). With `TMPDIR=/tmp/ft2short` (removed after):
  4/4 and 14/14 pass; keyring test passes with `TMPDIR=/tmp`.
- `vault/brokerSocketDirectory` "permissive base": rig umask is 0077, so
  `mkdir(0o755)` yields 0700 and verification correctly passes
  (two-line probe kept). Passes under umask 022.
- `inspectNative` B1 runtime assertions (18): system files are uid 65534
  mode 777 (`stat -c '%u %a' /usr/bin/cat` → `65534 777`, we are uid
  1000), which the verifier's `system_file` (`st_uid == 0`,
  `!(mode & 0022)`, no symlink, unwritable ancestry) correctly refuses.
  Weakening that check would be a security hole; the lead runs it outside
  the sandbox.

## Not failures here

`chatGptLocalFailures`, transport, `storeProject`, `cx1r4Truth` budget,
`scheduleLeaseLifecycle`, `shellNoDeadline` — all green in the final
sweep. No FULLTEST sister record existed to compare against.

## Final sweep (this tree, repo timeout, 2026-10-19)

- Shards 1, 2, 3, 5, 8: green (56/54/54/53/54 files).
- Shard 4: only the 4 sandbox-only brokerSession timeouts.
- Shard 6: only inspectNative runtime assertions + 3 sandbox-only
  socket-directory cases (compile fixed).
- Shard 7: only the sandbox-only keyring-less broker timeout.
- Gates: `npm run build` exit 0; typecheck (all five projects) clean;
  prettier clean on all touched files; `lint:js` clean after removing my
  own `temp/` scratch outputs (lint runs before tests on CI, when `temp/`
  is empty); touched suites re-run green. Per-shard tallies are in the
  "Final sweep" section above (shard logs were scratch output, removed).

## Commits

`89c323d618` changelog trim · `493131d7a4` admission re-exports ·
`cf1d24c1bc` race fixture · `37b499eaba` matcher deadline ·
`5fbd6e4c9a` scrub setup · `e14b694faa` browser walks ·
`b9e7af5e6c` usage staging · `90ff2baadb` week paging.
