# USAGETRACE — every usage read re-reads and re-parses the trace logs

Kubuntu rig, branch `fix/usage-trace-read`, base `39153196d` (release
0.18.0 plus the 0.18.1 hotfix). No push, merge or rebase. No paid or live
model calls. Commits `c3d3f7d05`, `f0bb10749` (plus the type-fix and this
record).

## Why

`test/unit/usageIntegration.test.ts` read this machine's real
`~/.local/share/muse/local-tracing/bootstrap/` (626 files, 691 MB):
every usage read (`POST /post query`, `POST /post export`, `access.read`
twice, the second `delete post`) parsed the newest 200 files again, about
0.8 s each. Two defects: (A) product — every usage read re-reads and
re-parses, holding up to 200 × 8 MiB = 1.6 GB of text at once; (B) tests —
a unit test reads the developer's real home folder.

## What changed (Part A)

- `src/runtime/usage/traceLogs.ts`: one reader object per home folder
  (`getTraceLogReader`), shared by `readTraceAttempts`,
  `createInsightsReader` and `readTraceLogs` (the usage service's default
  `readAttempts` reaches it unchanged through `readTraceAttempts`). Parsed
  facts are kept per file, keyed by path with size, mtimeMs and the native
  BigInt identity (`sameFile` from `src/core/fs/fileIdentity.ts`, the
  lint-mandated sampler): an unchanged file is never opened again. Changed
  files parse again in full. Entries for files that left the newest-200
  set are dropped, so the cache holds at most `TRACE_LOG_MAX_FILES`.
- Bounded work: at most `TRACE_LOG_READ_CONCURRENCY` (4, new constant in
  `src/shared/constants.ts`) files parse at once — enough to hide
  file-open latency behind parsing, few enough that only streaming chunk
  buffers ever sit together. Each file is read as a stream of lines,
  never as one string.
- CORRECTION (round 2, 2026-10-12): the sentence that stood here claimed
  `node:readline` with `crlfDelay: Infinity` matched `/\r?\n/` splitting.
  The review by reading showed it does not (a lone CR also ends a line),
  and the equivalence test could not show it. Round 2 replaced readline
  with the reader's own LF/CRLF-only chunk splitter
  (`splitTraceChunk`), drops the unterminated tail by design, and drives
  the equivalence tests through the production streaming reader over real
  files (see `docs/certification/usage-trace-read-2.md`, P2-3).
  Worst case per refresh: 4 stream buffers (~64 KiB each) plus one line
  buffer per flight (a file is skipped whole past `TRACE_LOG_MAX_BYTES`,
  so one line is at most 8 MiB) plus parsed facts — against 1.6 GB of
  whole-file strings before.
- mtime skip: a file with mtime older than
  `max(USAGE_WINDOW_WEEK_MS, USAGE_HISTORY_DAYS_MAX * USAGE_WINDOW_DAY_MS)`
  contributes empty facts without being opened. A log line is written no
  later than its file's mtime, and attempts carry the line's own
  timestamp, so every attempt in such a file predates every caller window
  (usage history caps at `USAGE_HISTORY_DAYS_MAX`, insights at a week).
- Concurrent callers share one refresh in flight; a listing failure other
  than ENOENT rejects all of them, leaves the cache as it was, and the
  next call retries. An absent directory still reads as no logs.
- A locked, vanished or mid-read-replaced file is skipped as before and
  never cached as empty, so the next refresh retries it.
- `src/core/usage/insights.ts`: the parser is one pass per line with
  cheap string tests (timestamp prefix shape, `event="`, one marker per
  event kind, in the old check order) before any regular expression; a
  line reaches at most the expressions its markers name. `parseTraceLog`
  keeps its signature and is now the same per-line function the streaming
  reader uses.

## Behaviour → test map

- `test/unit/traceParserEquivalence.test.ts`: the old parser copied
  verbatim as the reference; generated logs (every event kind, CRLF and
  LF, partial last line, garbage, bad stamps, 5 KB filler around a late
  event) assert deep equality across 4 seeds, plus streaming-equals-whole
  and empty-log cases. Red drill: `phase="admission"` → `phase="admit"`
  fails 4 of 7; restored byte-exact (SHA-256 match).
- `test/unit/traceLogReader.test.ts` (injected counting fs): first
  refresh opens N, unchanged opens 0, one grown file opens 1; concurrent
  callers share one flight (opens == files); EACCES rejects every sharer,
  keeps the cache (recovery opens 0), retries next call; ENOENT reads as
  `[]`; locked and mid-read-replaced files skip and retry; oversize files
  open nothing and contribute nothing; newest-200 cap opens exactly 200;
  mtime boundary (`cutoff - 1` skipped unopened, `cutoff` read); a CRLF
  file with a partial last line equals the whole-text parse through the
  real streaming reader; default-fs readers are shared per home folder.
  Red drill: cache-hit forced off fails 6 of 12; restored byte-exact.
- `test/unit/traceRefreshBenchmark.test.ts` (committed, 200 generated
  files in a temp folder: 150 × 150 KiB, 40 × 500 KiB, 10 × 1.5 MiB;
  named 60 s timeout because generation plus a ~57 MB first parse is
  genuinely long): asserts opens 200 / 0 / 1 across first, unchanged and
  one-grown refreshes, and writes `temp/trace-refresh-bench.json`.
  Observed on this rig (kubuntu, load ~1.6):
  `{"files":200,"firstMs":816.57,"firstOpens":200,"unchangedMs":10.23,
"unchangedOpens":0,"oneGrownMs":12.91,"oneGrownOpens":1}`.
- Real-home scratch (deleted after; default timeout): before, five
  `access.read` calls took 806–929 ms each and blew the 5 s timeout;
  after, five `readTraceAttempts` calls against the real 626-file home
  took 1266 ms (first parse) then 51–56 ms each.
- `test/unit/homeIsolation.test.ts`: asserts `os.homedir()` inside a
  worker is the redirected temp folder with the XDG variables beneath
  it. Red drill: redirect removed → fails with
  `expected '/home/randy' to contain 'muse-unit-home-'`; restored
  byte-exact (SHA-256 match).

## Part A8 sweep (per-call cost, disposition)

- `src/runtime/usage/traceLogs.ts` (this lane): was unbounded (200
  whole files per call) — fixed above.
- `src/core/usage/journalStore.ts` read: already per-file cached by
  size+mtime with offset-incremental re-reads; days bounded by retention
  (30 detail + monthly rollups). Left as is.
- `src/core/usage/resourceJournal.ts` read: 4 MiB per file
  (`RESOURCE_JOURNAL_FILE_MAX_BYTES`), 32 MiB total
  (`RESOURCE_JOURNAL_READ_MAX_BYTES`), retention-bounded days. Left.
- `src/runtime/usage/usageSettingsFile.ts`, `resourceResetFile.ts`:
  one tiny synchronous JSON read per call (microseconds, single file, no
  scan). Left: bounded and trivial.
- `src/runtime/usage/usageTableFile.ts`: read once per access creation
  (cached promise). Left.
- Budget readers (`ModelApiHost.readUsageBudgets`: in-memory session
  iteration; `paidDailyBudget.readToday`: one day file;
  `usageRecording.limits`: in-memory; tab ledger `todayUsage`: one day
  directory). Left: each is one small file or memory.
- `src/runtime/usage/usageCompanionEntry.ts` module loading: once per
  companion open (a user action), bounded assets. Left.

## Part B (isolation)

- `test/unit/setup.ts`: every worker points `HOME`, `XDG_DATA_HOME`,
  `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` (plus
  `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` on Windows; `HOMEDRIVE`/
  `HOMEPATH` left — `os.homedir()` reads `USERPROFILE` first and no test
  needs the fallback) at an empty per-worker temp folder, restored never
  (workers end).
- `test/unit/helpers/usageTraceFixture.ts` (`traceAttemptsLive`): every
  suite building the real `createUsageAccess` injects its trace-log
  source from its own temp folder: `usageIntegration`,
  `usageRollup`, `usageJournalMigration`, `usageCompanionChunks`,
  `deferredBundles`, `resourceHistoryReview`, `resourceHistoryWiring`,
  `UsageAppResources`. Suites building `createUsageService` directly
  already stub `readAttempts` (`usageFixtureDeps`); `cliUsage` /
  `cliUsageProcess` never load the real service bundle.
- No test needed a real tool's config: the git suites already pin
  `GIT_CONFIG_GLOBAL` to `/dev/null`/`NUL` with local fixture config,
  and nothing reads the npm cache. No test was changed for content —
  every previously-green suite passes unchanged under the redirect, so
  the only tests that ever read the real home were the usage-trace ones
  above (fixed by injection) plus the two slow usage cases (fixed by the
  redirect).
- `npm run check:l10n`: no user-visible string changed; not run beyond
  the untouched gate. `check:reference`: no command/setting/feature
  changed. `check:roadmap`: no milestone change.

## Before / after (this rig, repo default timeouts)

- Scratch five-read timing: before 806–929 ms per read, suite blew the
  5 s timeout; after 1266 ms first, 51–56 ms per following read.
- `usageIntegration` non-HTTP cases: "refuses…" 15 ms → 9 ms,
  "honours history-off…" 830 ms → 28 ms (it had been reading the real
  home). The "settles…" case still fails in-sandbox at the companion
  HTTP step (see below); its five usage reads are the ones measured.
- Bundles (`npm run build` green): `dist/modelApi.js` 532,827 B before
  and after (the exact pin holds; `deferredBundles` 123 passed);
  `dist/extension.js` 563,974 B unchanged; `dist/usageCompanion.js`
  42,914 B unchanged; `dist/usageService.js` 92,470 → 94,722 B
  (+2,252 B, budget 100 KiB).

## Suites run (repo default timeouts, `--maxWorkers=3`, kubuntu)

Green: traceParserEquivalence (7), traceLogReader (12),
traceRefreshBenchmark (1), traceLogs (5), insights (13),
usageIntegration 2/3 (see below), usageRollup + usageJournalMigration +
homeIsolation (80), resourceHistoryReview + resourceHistoryWiring +
UsageAppResources (48), usageService + usageText + usageExport (45),
usagePanel + usageCompanionBridge + acpUsage (19), cliUsage +
usagePerformance + memoryLocation (18), cliUsageProcess + cliFeatures +
credentialEnvironment (88), launch + shareCommand + scheduleStore
(152), agentImportWorkspaceEdits + runtimeSharing + teamHintsAndLoad
(48), acpModelApi + sharePreviewFix + shellSyntax (174+1 skip),
MuseCodeHost + pluginDispatch + providersXFix (172+3 skip), acpRuntime

- m106CaptureFixtures + evalTasks (87), execResources + execRun +
  windowsVaultNative (101+33 skip), browserLaunch (10),
  deferredBundles (123). Typechecks: host, webview, unit, e2e,
  integration — all 0. ESLint `--max-warnings=0` and Prettier clean on
  every changed file. `knip` 0 (two pre-existing config hints).

## NOT RUN HERE (sandbox blocks loopback/Chrome) — lead runs outside

- `npx vitest run test/unit/usageIntegration.test.ts --maxWorkers=3` —
  the "settles…" case needs the companion's loopback HTTP server; in
  this sandbox every loopback response is a 502 (proven with a minimal
  node server: expected 401, got 502), failing at `call(panel,
'/usage.js')`. Pre-existing environmental failure, untouched by this
  lane.
- `npx vitest run test/unit/usageCompanionChunks.test.ts --maxWorkers=3` —
  launches real Chrome via playwright (`chromium.launch`).
