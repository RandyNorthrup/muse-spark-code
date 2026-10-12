# USAGETRACE round 2 — the usage read fix after its review

Linux rig `linuxlt`, worktree `/home/randy/lanes/USAGETRACE`, branch
`fix/usage-trace-read`, continuing from round-1 head `356ab216e`. No push,
merge or rebase. No paid or live model calls (the live project ran with all
drills skipped). Time box 130 minutes.

Round 1 (commits `c3d3f7d05`, `f0bb10749`, record
`docs/certification/usage-trace-read.md`) fixed the released defect: every
usage read re-parsed up to 200 trace logs (~0.8 s a read). The review by
reading (`RVAPP-USAGETRACE1.report.md`) found 1 P1, 5 P2, 6 P3, "safe to
ship: no". Every finding is fixed below, with its test and red drill.

## P1-1 — a log still being written is counted, not dropped

`parseTraceFile` re-checked size/mtime after a whole-file read and threw
`traceLogChanged`; the per-file catch dropped the file, so a `muse serve`
appending mid-turn removed today's attempts from the page and the chat
insights, shown as true. A refresh now reads a SNAPSHOT: stat first, stream
only the first `size` bytes (`createReadStream` with `end: size - 1`),
count only COMPLETE lines (a trailing piece without its newline is a torn
write, not a line yet), accept when the identity is unchanged and the size
did not shrink, and cache under the first stat. The next refresh sees the
growth and re-parses the file in full. A file that shrank or changed
identity is re-read once in the same refresh; one that keeps changing keeps
its last good parse, and the page says the numbers for that log may be
behind (`traceNotice: 'stale'`, `USAGE_TEXT.attemptsStaleNote`).

- Test: `test/unit/traceLogReader.test.ts` — "a file growing mid-read
  counts its snapshot lines and parses the tail next refresh" (one complete
  line plus one torn piece appended during the stream: 1 attempt served,
  nothing dropped, 2 after the next refresh), "a file shrinking mid-read
  is re-read once in the same refresh", "a file that keeps changing keeps
  its last good parse and reports stale" (every stat hands a new identity;
  `isTraceStale()` true, then false again once the file settles). The old
  "a file replaced mid-read is skipped" (expecting 0 logs for a growing
  file) is deleted.
- Red drill: accept on `after.size !== snapshot.size` (the old drop rule)
  → the growth case fails, `vitest-exit=1`
  (`1 failed | 15 passed (16)`); restored byte-exact (SHA-256 match).

## P2-1 — the age cutoff follows the query's `from`

`traceLogCutoffMs(nowMs)` assumed no caller looks back more than 1,825
days, but custom ranges and export have no lower bound. It is now
`traceLogCutoffMs(nowMs, fromDay?)`: with a query, a file is skipped only
when its mtime predates the local midnight starting the query's `from` day
(a line is written no later than its file's mtime, and attempt days are
local days, so every line in such a file falls before the range). Without a
query (the insights read) the old backstop stands. `readAttempts` takes the
query's `from` through the service port into the reader.

- Test: "a custom range before the old backstop still counts an old-mtime
  file" (mtime 2020, `from` 2020-01-01: opened, 1 attempt; `from`
  2021-01-01: unopened), plus the unchanged no-query backstop case.
- Red drill: always use the backstop → the custom-range case fails,
  `vitest-exit=1`; restored byte-exact.

## P2-2 — trace and journal fail independently, with their own sentences

A listing failure other than ENOENT rejected the whole `Promise.all` in
`usageService.read`: the cost journal was lost, the page showed the
journal's "Usage history could not be read.", chat showed
`usageUnavailable` with no report, and `void this.postUsage(...)` rejected
unhandled. Now `readAttempts` runs outside the joint `Promise.all` in its
own try/catch: the journal, budgets and limits still show, with
`traceNotice: 'unavailable'` rendered by the Attempts section's own fixed
sentence (`USAGE_TEXT.attemptsUnavailableNote`: what could not be read —
the Muse Code trace folder — and what to do). In chat,
`postUsage` catches an insights failure, logs it, and still posts the
subscription report; the `usage/changed` refresh owns its rejection through
the existing `logRejection` helper (`void … .catch(…)`). A passing chat
suite is the no-unhandled-rejection proof (vitest fails runs on unhandled
rejections; the new test exercises the `usage/changed` void path with a
failing insights read).

- Tests: `test/unit/usageService.test.ts` — journal totals/budgets/limits
  present with `traceNotice: 'unavailable'` and empty attempts; stale
  summary → `'stale'`. `test/unit/UsageApp.test.tsx` — both sentences
  render. `test/unit/conversationController.test.ts` — "still posts the
  subscription report when the trace insights fail" (initial read and a
  `usage/changed` notification).
- Red drills: rethrow from `readAttempts` → the journal case fails,
  `vitest-exit=1`; unguarded `usageInsights()` in `postUsage` → the report
  case fails, `vitest-exit=1`; both restored byte-exact.

## P2-3 — the splitter is LF/CRLF-only, and the equivalence test is real

`readline` with `crlfDelay: Infinity` also ends a line at a lone CR; the
old parser split only on LF/CRLF. The reader now splits itself
(`splitTraceChunk` over the byte stream: LF and CRLF end a line, a lone CR
stays inside it, a trailing CR is held back for a straddling CRLF, the
string decoder heals multibyte cuts, the unterminated tail is dropped).
`test/unit/traceParserEquivalence.test.ts` drives the PRODUCTION streaming
reader (`defaultTraceLogFs.streamLines` over real temp files, plus the
splitter directly for chunk-boundary pairs): the old parser copied verbatim
as the reference over the complete prefix, four seeds, a torn tail pinned
as intentionally unreported (reference counts it, production does not), a
lone CR inside a line, a BOM, invalid UTF-8 bytes, multibyte text, a
multi-chunk healing file, an over-chunk line, a file of exactly
`TRACE_LOG_MAX_BYTES`, an empty file, a file without a final newline, a
line matching two event patterns (child wins, first-match order kept), and
direct splitter cases. The misleading "the streaming line reader equals the
whole-text parse" (which split twice and could not fail alone, P3-4) is
gone. The round-1 record's equality sentence is corrected in place.

- Red drill: stop stripping the CR (`lines: pieces.map((piece) => piece)`)
  → the splitter case fails, `vitest-exit=1`
  (`1 failed | 11 passed (12)`); restored byte-exact.

## P2-4 — the live drills run redirect-free under their own project

`test:e2e:live`, `test:e2e:live:modelapi` and `test:e2e:live:eval` now run
`vitest.live.config.ts`: the five live files, `maxWorkers: 1`, no
`setupFiles`, no shared-build global setup. The default project excludes
`test/e2e/live.e2e.test.ts` and `test/e2e/*.live.e2e.test.ts`, so the
drills cannot run redirected. `test/e2e/liveCli.ts` resolves its trace
folder through `realHome()` (the saved real home under the unit project,
the current one under the live project); the CLI/sign-in lookup takes
`homedir()` at call time, which is real wherever the live project runs.
`tab.live.e2e.test.ts` matches the live include (no npm script; run it with
an explicit path). Proof on this rig: `npx vitest run --config
vitest.live.config.ts` → 29 skipped, 0 failed, no sign-in touched, no model
called.

## P2-5 — the rig suite runs again, and never skips silently

`pluginDispatch.test.ts` built its bun path from `HOME` at load, after the
redirect, so the "OpenCode under the installed bun" suite skipped with no
message. It now reads `bunPath()` from `test/unit/helpers/realMachine.ts`
(the saved real home). Counts on this rig (the file holds 30 vitest tests: 23 its expanding
`it.each` rows; structure identical at base `39153196d` and now):
before round 1 — 27 passed, bun suite (2 tests) skipped with no message,
darwin case (1 test) skipped (derived: same file, same `HOME`-based lookup,
no `~/.bun` on this rig); after round 1 — 27 passed, still silent (P2-5);
after round 2 — 27 passed with `[env-skip] OpenCode under the installed
bun: bun not present, skipping` plus the darwin skip, and with a bun
installed at `$TMPDIR/bunhome` (`MUSE_UNIT_REAL_HOME=$TMPDIR/bunhome`) 29
passed with only the darwin skip. bun itself was installed only into the
lane's private `$TMPDIR` for the proof run and removed after; the machine
keeps no bun, so CI's skip set is unchanged. Every tool-gated suite now calls `noteToolSkip` at load, and
`test/unit/environmentSkips.test.ts` audits that every tool-gated suite in
`test/unit`/`test/e2e` is registered in
`test/unit/helpers/environmentSkips.ts` and that this machine skips exactly
the expected set (`[env-skips] linux: …` printed).

- Red drill: revert `BUN` to the `HOME`-based lookup with the proof bun
  present → the bun suite skips while the audit expects it to run:
  `vitest-exit=1` on `environmentSkips.test.ts`; restored byte-exact.

## P3-1 — nanosecond identity

Cache and snapshot stats carry `mtimeNs` via the existing
`fileReadIdentity`; unchanged means size, `mtimeNs` and native identity
equal. Test: a same-byte, same-millisecond, same-inode rewrite with only
`mtimeNs` moved re-parses (the first version of this case also grew the
file, so size alone explained the re-parse and the drill passed green —
rewritten in `0d417d966` to swap the run id in place). Red drill:
compare `mtimeMs` → the case fails, `vitest-exit=1`; restored byte-exact.

## P3-2 — one temp home per worker, none left

`setup.ts` keeps one `muse-unit-home-*` per worker process (shared by its
files) and reports it to the run's registry
(`MUSE_UNIT_HOME_REGISTRY`, inside the global setup's per-run root), which
the global teardown removes; a sweep at worker start removes leftovers
older than a day. (Workers are terminated, never exited — a `process.on
'exit'` probe showed the handler never fires, so an exit handler cannot do
this; the registry was verified 0 → run → 0 on one suite.) Leftover folders
after the full unit run below: 0 (counted in the suite's `tmpdir()`,
`$TMPDIR` on this rig, from a clean baseline; the lane's `$TMPDIR` proof
bun and stat folders were removed separately).

## P3-3 — per-user Chrome on Windows (UNMEASURED)

`scripts/lib/chrome.mjs` prefers the pre-redirect `LOCALAPPDATA`
(`MUSE_UNIT_REAL_LOCALAPPDATA`) for the per-user candidate, falling back to
the current environment exactly as before (the `chromeFinder` suite, which
mocks `process`, passes unchanged). No Windows host on this lane: for the
lead, on a Windows dev machine with a per-user Chrome and the redirect
active —
`npx vitest run test/unit/chromeFinder.test.ts test/unit/browserChecks.test.ts`
— expected: green, and a per-user install resolves through the saved
location. UNMEASURED here.

## P3-4 — the un-failable test is gone

Replaced by the production-driven splitter and reader cases (P2-3).

## P3-5 — listed files stat at bounded concurrency

The refresh's stat loop runs through the same `mapPool` (limit 4) as
parsing. Scratch measurement on 626 one-line files in `$TMPDIR/stat626`
(load ~1): sequential 13.9 / 14.6 / 12.6 ms → pooled-4 4.4 / 4.2 / 3.4 ms.
The committed benchmark holds the read win: 200 generated files —
first 333 ms / 200 opens, unchanged 3.8 ms / 0 opens, one grown 4.1 ms / 1
open (round 1 on another rig: 817 / 10.2 / 12.9 ms). Real home on this rig
(242 files): five `readTraceAttempts` took 474 ms first, then 17, 17, 21,
16 ms (round 1: 1,266 ms first on 626 files, then 51–56 ms).

## Records

- `CHANGELOG.md`: the round-1 "Pending" entry (which fixed a released
  defect and wrongly claimed files are skipped "older than any caller
  window") is replaced by a plain-words `[Unreleased] → Fixed` entry: no
  re-reads, complete in-progress numbers, the behind-note, the journal
  standing alone with its own note.
- New user-visible strings `attemptsStaleNote` / `attemptsUnavailableNote`
  in `src/shared/l10n/usageEn.ts` and all 14 `l10n/usage.*.json`, each
  immediately after `attemptsNote` (the English position);
  `npm run check:l10n` reports 0 problems.

## Full unit suite: 8 failed files, all accounted for

`npx vitest run --maxWorkers=3` → 1,322 passed files / 8 failed (27,520
tests passed, 56 failed, 175 skipped), `SUITE-EXIT=1`, temp homes left: 0.

- `test/e2e/execStdio.e2e.test.ts` (29), `test/unit/usagePackaging.test.mjs`
  (1), `test/unit/runtimeChatGptPackage.test.ts` (1),
  `test/e2e/execTestLauncher.e2e.test.ts` (suite): every failure is
  `npm pack` dying on the sandbox-blocked npm cache —
  `npm error Log files were not written … /home/randy/.npm/_logs`. Not
  code: re-run below with `NPM_CONFIG_CACHE="$TMPDIR/npm-cache"`.
- `test/unit/inspectNative.test.ts` (18), `test/unit/treesLinuxLaunchNative.test.ts`
  (5), `test/unit/vault/peer.test.ts` (1): sandbox blocks — kernel probes
  refused (`cat: {"refused":"systemFile"}`, exit 125), no cgroup delegation
  (`'group'` vs `'cgroup'`), no setuid sudo
  (`sudo must be owned by uid 0`). Measured pre-existing: the same three
  files on the untouched base `39153196d` (archive export under `$TMPDIR`,
  same conditions) fail 24 identically, same signatures.
- `test/unit/m114Audit.test.mjs` (1): MINE — the pinned source hashes for
  the two renderer files this round changes (`AttemptsSection.tsx`, and
  then `UsageApp.tsx`, found one at a time). Hashes refreshed one line
  each in `docs/certification/m114-audit.json`; the file passes 7/7 after.
  `npm run check:visual` for the new conditional paragraph: run to 4,392
  of 9,864 captures with zero failure lines, then stopped — the full gate
  needs about an hour on this rig and the lane's prove list does not
  include it. The goldens render the attempts scene with `traceNotice`
  unset (as before), so existing captures are pixel-identical; the full
  gate stays for hosted CI and the lead.

## Suites and gates (repo default timeouts, `--maxWorkers=3`, linuxlt)

- Owning suites: traceLogReader (16), traceParserEquivalence (12),
  homeIsolation + environmentSkips, traceRefreshBenchmark (1), usageService,
  UsageApp, traceLogs, conversationController (689, incl. the new report
  case run alone: 1 passed / 688 skipped), pluginDispatch (27+3 without
  bun; 29+1 with the proof bun), shellSyntax, manifest,
  modelApiForeignHooks, usagePanel/usageCompanionBridge/acpUsage,
  chromeFinder.
- Whole unit suite: see the final lane message (about 17 minutes on this
  class of machine; the setup change touches every file, so it ran whole).
- Packed product: `NPM_CONFIG_CACHE="$TMPDIR/npm-cache" npx vitest run
test/e2e/execStdio.e2e.test.ts test/e2e/execTestLauncher.e2e.test.ts
test/unit/usagePackaging.test.mjs test/unit/runtimeChatGptPackage.test.ts`
  → 4 files, 65 tests, all passed (exit 0). This is also the control for
  the full-suite pack failures: same tree, only the cache variable differs.
- Gates on the final tree: `npm run typecheck` (host, webview, unit, e2e),
  ESLint `--max-warnings=0` and Prettier on changed files,
  `npm run check:l10n` (0 problems), `npm run check:reference` (matches),
  `npm run deadcode` (exit 0; the two pre-existing config hints),
  `npm run check:cycles` (no cycles), `npx jscpd` (exit 0 after removing
  the two clones this round added), `npm run build` (extension 550.8 KiB /
  600, Model API 520.3 KiB / 525, usageService 93.8 KiB / 100),
  `npm run security:audit` (exit 0, 2 advisories under the exception file).
  `npm run security:sast` could not run in this sandbox (semgrep settings
  file unwritable: `OSError: [Errno 30] Read-only file system:
'/home/randy/.semgrep/settings5nwzbjwu.yml'`) — the lead runs it outside.
  The l10n pack-order diag (`~/lanes/_ctx/codex/l10n-pack-diag.mjs`) is
  absent from this rig; key adjacency was verified directly instead (new
  keys sit in the English position in all 14 files; wider en-vs-json order
  diffs predate this lane).
