# exec-usage-clock: the terminal agent records no usage history

Defect (released): every `exec` turn stamps its usage record with a
fractional clock, the journal schema refuses the record, and the write is
swallowed with one warning. `usage` afterwards shows none of the terminal
agent's requests. First released version with the defect: 0.12.0, measured
with git (not re-derived): commit 77e8ccd03 (`feat(runtime): implement M80
headless engine and wiring`, 2026-10-02) introduces
`const now = () => performance.timeOrigin + performance.now()` in
`src/runtime/main.ts`; it is absent from the 0.11.0 tree (`git show
b1acb9a47:src/runtime/main.ts` counts 0) and present in the 0.12.0 release
commit 3b7c38bfa (2026-10-04, counts 1; the commit is a descendant of
77e8ccd03).

## Red (2026-10-12, this lane, on 0.18.1 + record)

Smallest real `exec` path without a provider: none reaches the recorder. A
packed `exec --backend modelApi` against a provider entry pointing at the
closed port 127.0.0.1:11434 (real `ECONNREFUSED`, isolated `HOME`) fails in
model resolution with "Backend Unavailable; requests 0" before any request
is sent, so `recordedCall` is never set and nothing is recorded. What needs
a real provider answer is the lead's real-life run.

Red at the real module boundary instead: the real `createUsageRecording`,
the real `UsageJournalStore`, the real `NodeUsageFs`, a real temporary
folder, and the headless path's exact clock expression. No mocks, no fake
timers, no stand-in store.

`npx vitest run test/unit/execUsageClock.test.ts` on the unpatched tree:

- `records a headless turn stamped with the headless clock` FAILS:
  `expected [ Array(1) ] to deeply equal []` — the warnings array holds
  `"Usage history could not be recorded"` and `today()` returns 0 records.
- `records a turn stamped with whole milliseconds` passes (1 record).

## Green (2026-10-12, this lane, same tree plus the fix)

`npx vitest run test/unit/execUsageClock.test.ts --maxWorkers=2`: 4 passed.
The headless-clock case now records 1 record with no warnings; the
constructor case pins `toEpochMs(1791839174122.7842) === 1791839174123`;
the rejection case pins the reason naming the field (`id`).

Packed proof on the production build (`npm run build` exit 0 first), with
the real `dist/usageService.js` bundle, the real `src/shared/epochMs.ts`
constructor (Node 24 type-stripping, no re-implementation), a real
temporary data folder, and the headless path's exact clock expression
(`temp/packed-usage-proof.cjs`, scratch only, not committed):

- `writeErrors=["usageWriteFailed:record rejected: at (invalid_type,
expected int); startedAt (invalid_type, expected int)"]` — the 0.18.1
  stamp shape is still refused, now with the true reason.
- `records=1 ids=fixed-shape`, `at=1791855520916 integer=true` — the
  fixed boundary's stamp is written and reads back whole.

Packed `exec` + `usage` in an isolated `HOME` (providers file written from
the repo's own `providerEntrySchema`, ollama preset at the closed port
127.0.0.1:11434):

- `node dist/acp.js exec --backend modelApi --model ollama/llama3
--max-budget-usd 0.01 "say hello"` → exit 3,
  `Backend Unavailable; requests 0` (real `ECONNREFUSED`), no usage
  warning (no request sent, nothing to record — same as 0.18.1 on this
  path; the defect fires only when a request is answered).
- `node dist/acp.js usage` in the same home → `Requests: 0 requests`.
- Built bundles: `timeOrigin` counts 0 in `dist/headless.js`/`dist/acp.js`;
  `Usage history could not be recorded` counts 0 everywhere.

What needs a real provider answer is the lead's real-life run: exec a turn
on a configured provider, then `usage` counts it (before: `0 of N recorded
requests belong to the turn` plus one warning per run).

## Clocks: every place a clock is created and handed on

One stored-time type (`EpochMs` in `src/shared/epochMs.ts`, branded, single
`toEpochMs` constructor that rounds once); a span clock stays `() =>
number` and the compiler refuses it where `EpochMs` is wanted (41
typecheck errors on the first build, all in tests, fixed by wrapping).

- `src/runtime/main.ts` headless `now`: was the fractional expression;
  now `epochNow`. The `serve` path: `Date.now` → `epochNow` (2 sites).
- `src/runtime/exec/runExec.ts`: `deps.now` (caller span clock, still
  `() => number`) is wrapped once at the boundary,
  `epochClock = () => toEpochMs(deps.now())`, into `createUsageRecording`
  and `createUsageWriter`. Image flow `startedAt` wrapped; the exec
  result's `durationMs` rounded (`execProtocol` takes plain `z.number`,
  so whole values stay accepted everywhere).
- `src/extension.ts`: `Date.now` → `epochNow` (3 sites: recording, store,
  `observedAt`).
- `src/runtime/usage/usageServiceEntry.ts`: `Date.now` → `epochNow`;
  `onWriteError` logs the reason.
- `src/core/backends/modelapi/ModelApiHost.ts`: `deps.now()` (spans and
  timeouts elsewhere, stays `number`) wrapped with `toEpochMs` at the 4
  recording handoffs (`startedAt` ×2, `observedAt` ×2).
- `src/core/backends/musecode/MuseCodeHost.ts`: wrapped at 2 handoffs.
- `src/core/backends/modelapi/reviewerEntry.ts`: wrapped at 2 handoffs.
- `src/core/paid/paidFeatures.ts`: `Date.now()` → `epochNow()`.
- `src/core/usage/journalRecord.ts`: `at`/`startedAt` take `EpochMs`;
  `durationMs`/`firstTokenMs`/`retryDelayMs` rounded on write (the schema
  allows fractions there; the store keeps whole values).
- `NodeUsageFs` keeps `now: () => number`: trash-sweep timing against
  `mtimeMs` is spans, never stored times — reviewed, deliberately
  unchanged.

## Silent catches: fixed and reviewed

Fixed (a validation/programming error now carries its true reason):

- `journalStore.noteUsage` / `append`: bare `catch` →
  `usageWriteReason(error)`: first 3 failing fields with expected shapes
  (`record rejected: at (invalid_type, expected int)`), `usage counters
invalid`, else `record rejected`; append failure `journal append
failed`. Reason holds field names and shapes only — never values,
  paths, or record content (privacy-canary suites pass unchanged).
- `recording.report`: the literal `Usage history could not be recorded`
  → `Usage for this run was not recorded ({reason}).` (new `UI_TEXT`
  key, translated in all 14 locales), told once per run; queue/flush/
  `today` pass true reasons (`writer unavailable`, `write failed`,
  `write timed out`, `read failed`).
- `onWriteError` widened to `(code, reason)` in `UsageJournalOptions`,
  `UsageWriterBundle`, and all call sites.

Reviewed, unchanged (already honest):

- `journalStore.write`/`readFile`: IO errors → `journal append
failed`; unreadable lines counted, never thrown.
- `recording.today`/`flush`: report, then throw `Usage history
unavailable` — an explicit failure, never silent success.
- `usageService.handle` read/report path: `readFailed`/`writeFailed`
  codes to the page; `serveUsageStdio`/`usageCli` map bad input to
  `invalidMessage`.
- `usageService.readResources`: unreadable resource journal → `null`
  (documented: never fails the page, never invents data).
- `runLedger.admitResponse`: unpriceable request → `refuse('unpriced')`
  (the admission decision, not a swallowed error).

## Guard-fire drill (2026-10-12, this lane, macmini)

`usageWriteReason` neutered to `return 'record rejected'`:
`test/unit/execUsageClock.test.ts` → `names the failing field when a
record is rejected` FAILS with `expected 'record rejected' to contain
'id'` (3 others pass). Restored byte-exact (SHA-256 `986c62aa…`
before and after); the clock-type guard fired earlier as 41 typecheck
errors on the first build, all fixed by wrapping at the boundary.

## No migration

Records written by 0.18.1 and earlier are not affected: the defective path
threw on every write, so no fractional record was ever stored. The schema
is unchanged (still `z.int()`); no migration, no backfill.

## Continuation (2026-10-12 PT, macmini, this lane, same tree, no source edits)

Carried-over work reviewed file by file against the brief and kept as is.
Fresh `npm run build` exit 0: `dist/extension.js` 551.0 KiB (cap 600),
`dist/modelApi.js` 507.3 KiB (cap 525); `timeOrigin` counts 0 in
`dist/headless.js`/`dist/acp.js`; the old warning counts 0 in every bundle.
`node temp/packed-usage-proof.cjs` on the fresh dist: old fractional shape
refused with `usageWriteFailed:record rejected: at (invalid_type, expected
int); startedAt (invalid_type, expected int)`; fixed boundary writes 1
record with whole `at` (`at=1791860982424 integer=true`). Packed smoke in an
isolated home: `exec --backend modelApi --model ollama/llama3` → exit 3
`Backend Unavailable; requests 0`, no usage warning; `usage` → `Requests: 0
requests`. l10n pack diag: `equal=true` all 14. `check:l10n` 0 problems,
`deadcode` clean, `cycles` none, `duplication` 0 clones, `security:audit`
exit 0 (2 advisories, 1 exception), `check:reference` and `check:host-api`
clean, `check:plan` 0 drift. `security:sast` could not run here: semgrep
crashes writing its own log (`PermissionError: [Errno 1] Operation not
permitted: '/Users/randy/.semgrep/semgrep.log'`); the lead runs it outside
the sandbox.

Slow-suite drill (rig load 7.5–8.2, repo default 5 s timeout kept): the same
files were run on this tree and on the untouched base worktree
(`e763f4938`, `node_modules` symlinked). `journalStore`: the two-process
10,000-record test times out at 30 s on both (30144 ms here, 30123 ms on
base). `usageJournalMigration`: 8 failed here / 7 on base, every root cause
`Test timed out in 5000ms` with `ENOTEMPTY` cleanup knock-ons. `usageRollup`:
51 failed here / 53 on base, same two kinds, no other error. `usageIntegration`
`settles two vendor host turns…`: fails on base with `listen EPERM:
operation not permitted 127.0.0.1` (the Mac sandbox forbids loopback
listeners; the companion panel needs one) and on this tree with a 5 s
timeout at the same fetch stage — blocked here either way, named for the
lead. `execProvider` + `actionRunExec`: 3 timeouts here, 3 timeouts on base.
The warm-cache benchmark failed once on this tree (2973 ms) and passed alone
(also passes on base): load variance, measured. Per the owner rule these are
reported as measured (fails on base too), not labelled.
