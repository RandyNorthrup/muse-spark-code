# M113 S — Local sources

2026-10-06, Win11 rig, `C:/lanes/M113S`, branch `m113/s`, frozen lane-0
base `145f97cd`. Authority: `C:/lanes/_ctx/M113S.rig.md`, its shared
`codex/common.md`, AGENTS.md, PLAN.md D93 and M113 (read in full), and
`docs/certification/m113-contracts.md`. Background: M71's metadata process
controls, M84's portable export and scrub, M93's existing problem-report
contract. No network, paid/model call, credential file read, dependency,
global setting, gate change, merge, rebase or push.

## Implementation

`src/core/reporting/sources/` supplies the frozen source ports for git,
changelog, certification, package declarations, sessions, questions, usage
and external agent usage. `createHostReportSources` binds injected host
ports. `createRuntimeReportSources` supplies confined native file reads,
credential-free local Git and opted-in agent file discovery. The same
source contracts serve VS Code, native hosts, companion, ACP and CLI;
neither adapter registers a command or adds activation code.

- Git uses bounded local metadata commands with fixed argument arrays,
  suppressed pagers/fsmonitor/signatures/maintenance, no optional locks or
  credential prompts, and only an executable found on absolute PATH entries.
  Commits have subjects, dates and workspace-relative file names. Lightweight
  and annotated tags resolve to their target object. Branch ancestry is
  read against origin's default HEAD, or an observed local main/master.
  An unknown default is partial; no default is fabricated. The NUL parser
  handles empty messages and empty commits. Bare shared storage is excluded
  from working-tree facts because it has no working tree or HEAD.
- File reads refuse private names, traversal, canonical escapes, devices,
  non-regular files, credential aliases through hard links, descriptor
  substitution, excess bytes and invalid UTF-8. Certification recursively
  reads matching Markdown records, preserves checkbox order, sorts paths,
  and reports partial reads. Changelog sections follow Keep a Changelog;
  link definitions are excluded and note order is preserved.
- Package facts are declarations from the quality script and its referenced
  npm/run-s/run-p scripts. Nothing executes them. Sessions go through M84's
  `buildSessionExport` and the injected report scrub. Real turn/approval
  counts are supplied before portable projection; a missing count remains
  unavailable. Usage preserves unknown cost and optional cache capability.
  M112 questions preserve all three states and are sorted by id.
- Every text field is scrubbed before it enters the normalized facts.
  Native errors and file contents never become failure reasons. Source
  records include status, a localized reason for absence/partial data,
  observation time and age relative to the one injected `asOf`. Live local
  reads use that stamp; session/usage/registry adapters retain their supplied
  observation. Recency uses the existing source read interval, 5 seconds;
  older observations are stale and future/absent observations have unknown
  age. All reads admit cancellation and the existing per-source deadline.
  Workspace keys hash normalized paths, with Windows separator/case parity.

## Usage capture

On this Win11 rig, 2026-10-06, the installed agents' existing local usage
records were projected in memory. No model attempt was made: **0 attempts,
$0**. Raw files, messages, account/plan labels, ids, credit balances and
credentials were never copied or retained. File names below use anonymous
project/session segments so the record contains no account or local root.
Fixtures in `agentUsageSource.test.ts` retain only the captured fields,
substituting fixture ids/models; unrelated canary fields are synthetic
fault controls, not additional claimed captures.

| Agent       | Captured file family                                   | Fields read                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl`         | `type=assistant`, ISO `timestamp`, `message.id` (deduplication only), `message.model`, `message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`                                                               |
| Codex       | `~/.codex/sessions/YYYY/MM/DD/rollout-<session>.jsonl` | `type=event_msg`, ISO `timestamp`, `payload.type=token_count`, nullable `payload.info.total_token_usage.{input_tokens,cached_input_tokens,output_tokens}`, nullable `payload.rate_limits.{primary,secondary}.{used_percent,window_minutes,resets_at}` |

Claude's standalone `stats-cache.json` is absent on this rig; no schema for
it is guessed. The captured Claude usage had 2 ordinary input, 14,453 cache
creation input, 14,335 cache-read input and 210 output tokens. Codex had
19,462 total input, 12,544 cached input and 153 output tokens; its primary
window reported 100 percent used and a 10,080-minute window. Only usage
fields are projected from files that also contain conversation text.
Claude messages are deduplicated by id, Codex cumulative counters take the
latest observation instead of summing events, and observations after `asOf`
are excluded. Costs remain unknown; no subscription price is inferred.

Sources are empty/off by default. File discovery and reading happen only
after an explicit source selection. Only the captured session path families
are accepted. `.credentials.json`, `auth.json`, environment files, private
extensions, traversal and their canonical/hard-link aliases are refused
before content is read. Duplicate file selections are refused. Missing
enabled agents and failed files make the aggregate source unavailable or
partial, with its reason; they never create zero-usage successes.

## Validation

- `npm.cmd run typecheck`: all five projects passed.
- Scoped `npx.cmd eslint --max-warnings=0` on the eleven source files,
  English table and four source test files: passed. Prettier's check of
  those files and all fourteen translations: passed.
- `npm.cmd run deadcode`: passed (only existing configuration hints).
  `npx.cmd jscpd`: passed, zero clones across 1,206 files.
- `npm.cmd run cycles`: passed; no circular dependency in the 572-file
  shipping graph.
- Final direct Win11 Vitest, default repository timeout, at most three files
  per run, after all mutations were restored:
  `npx.cmd vitest run test/unit/gitSource.test.ts test/unit/changelogSource.test.ts test/unit/sessionReportSource.test.ts --maxWorkers=3`
  passed **32 tests** in 8.65 seconds;
  `npx.cmd vitest run test/unit/agentUsageSource.test.ts test/unit/reportStrings.test.ts --maxWorkers=3`
  passed **27 tests** in 2.79 seconds. Total: **42 owned source tests plus
  17 existing reporting-string tests**, with no raised timeout, filtered or
  skipped test. Coverage includes bare storage, empty subjects, directory
  junction escapes, credential hard-link aliases, native child environments,
  real activity counts and opted-in discovery.
- The actual repository's four local file/Git sources were all `ok`:
  1,460 commits, 285 branches, 238 working trees, 31 changelog sections,
  140 certification records and 26 declared quality scripts. Sequential
  collection measured **1,451.94 ms** after cache warmup; this measures
  sources only, not the later plan/collector/renderer pipeline. The first
  cold certification read took 2,562 ms on the shared rig; full cold report
  timing remains the integration lane's acceptance check.
- `node scripts/check-l10n.mjs`: exit 1 for exactly the seven pre-existing
  unused lane-0 manifest keys assigned to W, as recorded in lane 0's
  certification. All fourteen UI tables have zero translation problems.
  Nine source reasons have real translations. No key was ignored and no
  manifest or gate was changed.
- `npm.cmd run check:reference`: passed; 53 features, 44 commands, 59
  settings, 26 slash commands and 116 CLI entries remain current.
- `npm.cmd run check:host-api`: exit 1 because the generated Node built-in
  import counts need regeneration: child_process 13 → 14, crypto 46 → 47,
  fs 33 → 34, fs/promises 47 → 48 and path 84 → 85. There are no new VS Code
  imports or APIs. The generated compatibility record belongs to W; S did
  not edit it or weaken its freshness gate.
- `npm.cmd run build`: passed production build, size, split, host-global
  and notices gates. Extension **439.5 KiB / 600**, Model API **446.9 /
  475**, checkpoint store **76.9 / 225**, webview startup **797.9 / 900**,
  deferred JS **50.0 / 50**, ACP **821.5 / 850** and the existing M93 report
  bundle **21.7 / 75**. No budget changed. These are the frozen entry graph's
  sizes; W still owns M113's lazy source assembly and its final bundle check.

## Named integration handoffs

| Handoff               | Owner       | Binding                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-S-scrub          | R/W         | Supply the shared M84/report text scrub to both factories, including registered literals and local roots; scrub canonical output before hashing and again at render. The source layer requires this dependency, with no production identity fallback.                                                                            |
| M113-S-session        | V/X and M84 | Supply `ReportSessionReader`: the actual M84 source, retained turn and approved/denied/auto/expired counts or explicit unavailable reasons, usage, checks and observation. Forward the selected session/workspace context.                                                                                                       |
| M113-S-questions      | M112/V/X    | Supply `ReportQuestionsReader` from the actual registry, filtered to the selected workspace/session. M112 is absent on this base; no fake registry ships.                                                                                                                                                                        |
| M113-S-usage          | M102/K      | Bind M102's actual aggregate adapter to `usage`, preserving certainty, cache capability and limit facts. No guessed journal parser ships.                                                                                                                                                                                        |
| M113-S-assembly       | K/W/X/V     | Combine these eight ports with P/N/H and later sources into the snapshot. Invoke each once; keep source collection in the lazy reporting bundle, outside activation. Runtime defaults discover only selected agent sources; native hosts may inject their filesystem/Git ports and root overrides.                               |
| M113-S-manifest       | W           | Bind the seven prepared manifest keys, including machine-scoped `reports.agentSources` with an empty default. This is the existing lane-0 localization blocker. No S-owned package setting is registered.                                                                                                                        |
| M113-S-docs-reference | W           | README/CHANGELOG/reference/ACP/privacy/security should describe bounded local sources, M84 export, explicit unavailable bindings, read-only opt-in agent usage, refused credential files, named source paths and unknown costs. W owns those files. No new S command or independently reachable user feature is registered here. |
| M113-S-speed          | W           | Measure the full project report on each rig, including cold reads; the source-only timing above is not a whole-report acceptance claim.                                                                                                                                                                                          |
| M113-S-host-api       | W           | Regenerate `docs/ide-compatibility/host-api.md` after integration with `npm run check:host-api -- --write`, review the Node import-count diff and rerun the gate. No new VS Code API is required.                                                                                                                                |

The lead's full `quality` run remains an integration gate. The shared brief
explicitly forbids running it in an individual lane. Public surfaces,
rendering/history/hash and all other lane-owned files are left to their
named owners.

## Guard-fire receipts

Each mutation disabled the named guard or replaced its correct result with a wrong one. Each affected **whole test file** ran directly on Win11 with `npx.cmd vitest run <file> --maxWorkers=3`, using the repository default timeout, with no filtered or skipped tests. Every mutation produced exit 1 at the named regression and was restored in `finally` from the original bytes. All **40** restored SHA-256 values matched before the final green test runs. No mutation remains in the commit.

| Disabled guard / wrong result | Named regression (substring)                           | Result                |
| ----------------------------- | ------------------------------------------------------ | --------------------- |
| git-empty-subject             | parses empty subjects and empty commits                | exit 1; exact restore |
| git-workspace-path            | shows working-tree paths relative to the workspace     | exit 1; exact restore |
| git-home-path                 | replaces an outside working tree under the home folder | exit 1; exact restore |
| git-bound                     | requests the commit bound plus one                     | exit 1; exact restore |
| git-subject-scrub             | scrubs commit subjects                                 | exit 1; exact restore |
| git-enclosing-repository      | missing or enclosing repository                        | exit 1; exact restore |
| git-bare-storage              | reads working trees from a bare shared repository      | exit 1; exact restore |
| changelog-duplicates          | missing and malformed changelogs                       | exit 1; exact restore |
| changelog-text-bound          | refuses changelog notes beyond                         | exit 1; exact restore |
| certification-partial         | retains a partial source                               | exit 1; exact restore |
| certification-traversal-bound | bounds certification traversal                         | exit 1; exact restore |
| package-declarations          | reads required quality script declarations             | exit 1; exact restore |
| file-private-name             | refuses private names                                  | exit 1; exact restore |
| file-confinement              | refuses directory links outside                        | exit 1; exact restore |
| file-hardlink-alias           | refuses directory links outside                        | exit 1; exact restore |
| file-pre-read-bound           | refuses oversized files before loading                 | exit 1; exact restore |
| file-binary-NUL               | refuses NUL text                                       | exit 1; exact restore |
| source-unavailable-data       | provides explicit availability for all local sources   | exit 1; exact restore |
| source-observation-boundary   | rejects invalid observation timestamps                 | exit 1; exact restore |
| source-deadline               | cancels a reader that ignores the signal               | exit 1; exact restore |
| source-freshness              | distinguishes stale, future and unknown                | exit 1; exact restore |
| workspace-absolute            | computes keys consistently                             | exit 1; exact restore |
| workspace-Windows-case        | computes keys consistently                             | exit 1; exact restore |
| session-scrub                 | uses M84 export and retains real turns                 | exit 1; exact restore |
| session-real-turns            | uses M84 export and retains real turns                 | exit 1; exact restore |
| session-approval-outcomes     | uses M84 export and retains real turns                 | exit 1; exact restore |
| questions-duplicate-ids       | preserves question states                              | exit 1; exact restore |
| questions-missing-binding     | provides explicit availability                         | exit 1; exact restore |
| usage-validation              | uses injected usage aggregation                        | exit 1; exact restore |
| agent-opt-in                  | is opt-in and never reads                              | exit 1; exact restore |
| agent-duplicate-selection     | does not double-count duplicate file selections        | exit 1; exact restore |
| agent-Claude-deduplication    | projects Claude counters, deduplicates messages        | exit 1; exact restore |
| agent-Claude-offsets          | chooses the latest Claude usage revision               | exit 1; exact restore |
| agent-private-path            | refuses credential and traversal paths                 | exit 1; exact restore |
| agent-cumulative-counters     | takes the latest Codex cumulative totals               | exit 1; exact restore |
| agent-projection-scrub        | scrubs source names and model keys                     | exit 1; exact restore |
| agent-future-observations     | excludes future observations                           | exit 1; exact restore |
| agent-limit-only-not-zero     | rejects malformed usage                                | exit 1; exact restore |
| git-child-credentials         | keeps credentials and Git routing overrides            | exit 1; exact restore |
| git-child-routing             | keeps credentials and Git routing overrides            | exit 1; exact restore |

All associated tests are in `gitSource.test.ts`, `changelogSource.test.ts`, `sessionReportSource.test.ts` and `agentUsageSource.test.ts`. The restored production-file hashes are:

| File                                          | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/reporting/sources/git.ts`           | `50873a1f2713585799b0d82c606cacd00d4d8329207fd229408a015f78a382a2` |
| `src/core/reporting/sources/changelog.ts`     | `ddecfb5017ef46f68ff343e4cf4b7aab6c0ae148af4d571b3d0d63677d6961e9` |
| `src/core/reporting/sources/certification.ts` | `fb870b1eeca708b10449150a7e7fb1190e91475473db3c314542ec39f4b0b4a0` |
| `src/core/reporting/sources/package.ts`       | `ed1e50ca1c1ecf8ef4af085ebd827581f6cb1df5dbc532b446cf62446af5fe75` |
| `src/runtime/reporting/sources.ts`            | `117be1238c41d224ba620c97320254cc1a813ce251e6907e96807b8110f7af26` |
| `src/core/reporting/sources/local.ts`         | `3a800dcbd94ac5f6504fb45b12a2acadc27a4cba3203299900bc08463825dee8` |
| `src/core/reporting/sources/session.ts`       | `d21ccfc17e4abf95070681efdd026054f9729048e98d5c65d054ef47a8bd34fa` |
| `src/core/reporting/sources/questions.ts`     | `ad4307954d9a717250f678682c0022d7957a40f039265d4f5800d84082670a33` |
| `src/core/reporting/sources/agentUsage.ts`    | `eb0739c308535cc4f0b525e6c572a2bd4eeaadc189afbd14001436a5ac6591e7` |

## C-M113-1 port — 2026-10-10 (MacBook lane CM1131)

Ports the accepted RVM113S repair (`port/m113-s`: 20854be3693, 7ea2fcac83a)
onto release 0.17.0 as a manual port: the base has moved on, so a blind
cherry-pick would regress two later improvements. Ported: total-order
tie-breaks in `git.ts` (commits, tags, branches, worktrees),
`questions.ts`, `session.ts` (check-run tail after the existing
at/check/outcome/commit/durationMs fields, breakdown and limits tails),
`agentUsage.ts` (Windows-separator normalization in file order) and the
`!entry.directory` discovery guard in `src/runtime/reporting/sources.ts`.
Deliberately NOT ported: the `package.ts` hunk (the base replaced the
`npm-run-all2` matcher with its own `matchTaskNames` over
`path.posix.matchesGlob`; re-applying the old hunk would regress it) and
the discovery-descent hunk (the base already descends into
`projects/<project>/subagents` with case-insensitive, separator-tolerant
matching, a superset of the repair). No new string, command, setting,
dependency or activation change; `check:l10n` reports 0 problems.

Property tests (repository default timeouts, `--maxWorkers=3`, MacBook):

- `test/unit/gitSource.test.ts`: shuffled scrub-colliding identities/paths
  produce byte-identical Git facts across three input orders.
- `test/unit/sessionReportSource.test.ts`: all 24 permutations of tied
  checks with repeated usage keys, and all 6 permutations of
  scrub-colliding questions, produce byte-identical session facts.
- `test/unit/agentUsageSource.test.ts`: byte-identical file order for
  Windows vs POSIX separators; the subagent discovery test gains a
  directory-shaped `directory.jsonl` entry that must stay unselected.

Final runs: `gitSource + sessionReportSource` 25 passed;
`agentUsageSource` 12 passed; all three files together 37 passed.
`npm run typecheck` (all projects), scoped ESLint zero warnings, Prettier
and `check:l10n` (0 problems) pass.

### Guard-fire receipts (each guard broken independently, restored byte-exact)

| Disabled guard                  | Named regression              | Result                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------ |
| git-commit-tie                  | byte-identical Git facts      | 1 failed / 11 passed; exact restore              |
| git-tag-tie                     | byte-identical Git facts      | 1 failed / 11 passed; exact restore              |
| git-branch-tie                  | byte-identical Git facts      | 1 failed / 11 passed; exact restore              |
| git-worktree-tie                | byte-identical Git facts      | 1 failed / 11 passed; exact restore              |
| check-duration-step (tail kept) | byte-identical session facts  | 13 passed: the JSON tail alone holds determinism |
| check-duration-step + JSON tail | byte-identical session facts  | 1 failed / 12 passed; exact restore              |
| usage-breakdown-tie             | byte-identical session facts  | 1 failed / 12 passed; exact restore              |
| usage-limit-tie                 | byte-identical session facts  | 1 failed / 12 passed; exact restore              |
| question-scrubbed-id-tie        | byte-identical questions      | 1 failed / 12 passed; exact restore              |
| agent-path-separators           | byte-identical file order     | 1 failed / 11 passed; exact restore              |
| discovery-regular-files         | subagent discovery stays `ok` | 1 failed / 11 passed; exact restore              |

Note: the check-run JSON tail cannot fire on the frozen five-field schema
(two rows agreeing on every compared field are identical), so its drill is
the pair above: dropping the duration step stays green only while the tail
stands, and dropping both fails. Restored production-file SHA-256:

| File                                       | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `src/core/reporting/sources/git.ts`        | `a0168aea691f31ed309c05b2c7015fa842aaaae2d05f567c3fb901cdfbe0d8bc` |
| `src/core/reporting/sources/session.ts`    | `5fe4f79edfa2441abc4d2ae67de66293b6b0df655e7628363d8b0bdf57a6eb29` |
| `src/core/reporting/sources/questions.ts`  | `7e593e574951805363bc3a1fec97a05149bc43946028ec719ce96c889440cf27` |
| `src/core/reporting/sources/agentUsage.ts` | `e739e7d1f417316733c97e2456bab14353d095531ab5d5c3894648446e3aaa80` |
| `src/runtime/reporting/sources.ts`         | `a36e8dd8165d4554192ff56dd10f64f27d39d4571e8623b4d155842fe0badb55` |

Drill driver `temp/cm1131-drill.mjs` (gitignored scratch) breaks/restores
each guard and prints file hashes; `temp/cm1131-baseline.sha` holds the
pre-drill hashes the restores were diffed against.

### C-M113-1 review attempts — 2026-10-10 (historical evidence, not a review)

A Codex review was requested (`codex review --commit 8c0e8b569` and
`codex exec`, MacBook rig) but is environmentally blocked: this lane runs
headless under an agent sandbox, and both commands fail before any model
call with `failed to initialize in-process app-server client: Operation
not permitted (os error 1)`. No credentials were read or touched, and no
sandbox workaround was built. This paragraph records the blocked
invocation only; it is not review evidence.

The lane author's own pass over the same four classes on the same day
(comparators on scrubbed schema-parsed rows; no-throw on schema-typed
fields; pure comparators with `toSorted`; CHANGELOG and this record
checked against observed outputs; `changelog.ts:36` left alone) is a
self-check only. A lane never reviews its own work: the self-check found
no issues, but that verdict carries no review weight.

### Independent review RVCM1131 — 2026-10-10 (MacBook)

The lead commissioned independent review RVCM1131 of `82d50d5e4..c59e6d705`
(`8c0e8b569`, `c59e6d705`). Verdict: no introduced production P1/P2;
three P3 findings; report-byte acceptance unproved. All three findings
are closed by lane CM1131R2 (this lane):

1. **P3 — permutation regressions compared source bytes, not rendered
   reports** (`test/unit/sessionReportSource.test.ts:149`,
   `test/unit/gitSource.test.ts:169`, `CHANGELOG.md:77`). Closed: the
   session, git and agent-usage permutation tests now carry permuted
   inputs through the production collector, the production finalizer and
   all four production renderers (Markdown, HTML, JSON, text) and compare
   the rendered bytes; the CHANGELOG entry claims byte-identical source
   facts plus rendered-report equality for valid inputs only.
2. **P3 — this certification offered the author's pass as a review
   substitute** (line 286 of the prior revision). Closed: the substitute
   review text above is deleted and retained only as the blocked-invocation
   record plus a self-check label; this section appends the independent
   report, its findings and their dispositions.
3. **P3 — no C-M113-1 record in PLAN M113.** Closed: PLAN.md M113 gains a
   scoped `C-M113-1` repair/status record linking this certification and
   RVCM1131, without declaring the whole M113 milestone certified. M113's
   roadmap entry is unchanged (still planned overall), so no regeneration
   was needed.

### Recorded limitation — scrub-collapsed identities at the collector

RVCM1131 confirmed in memory with production code that distinct records
which scrub to the same key (repeated usage breakdown/limit keys,
question ids that scrub alike, commits sharing a scrubbed sha) finalize
their source payloads deterministically yet fail at the collector:
`createReportCollector` derives identical row keys and the report schema
rejects duplicate row keys with `Invalid report document`. The limitation
predates this port, is not a regression, and is owned by the collector
row-identity design (a later K/collector change), not by this lane: no
collector key derivation is changed here. Siblings swept: Git branches
and worktrees additionally have no collector consumer at all today, so
their input order is proven at the source level only. The new
renderer-level regressions therefore use valid inputs (distinct
post-scrub identities; checks differ in `at`) and prove end-to-end
report-byte stability for every report the engine can validly build.

Re-verification after the CM1131R2 fixes (tree unchanged): the owned
files pass together at repository timeouts, and typecheck, scoped ESLint,
Prettier and `check:l10n` pass; results are tallied in the lane's final
report.

### CM1131R2 guard-fire receipts (each guard broken independently, restored byte-exact)

Each mutation disabled the named guard; the named test file ran directly
on the MacBook with `npx vitest run <file> --maxWorkers=3` at the
repository default timeout, with no filtered or skipped test. Every
mutation was restored from the pre-drill bytes and the restored SHA-256
was diffed against `temp/cm1131r2-baseline.sha`. No production file is
changed by this lane: `session.ts`, `git.ts` and `agentUsage.ts` restore
to the C-M113-1 hashes above. Shared test wiring for the three
renderer-level regressions lives in
`test/unit/helpers/reporting/render.ts` (production collector with the
engine's finalizer wiring, all four production renderers).

| Disabled guard                                                                                                           | Named regression                                                                  | Result                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| session check-run `at` term + JSON tail (both removed; each alone stays green because the other still orders these rows) | renders byte-identical session reports in every format                            | 1 failed / 13 passed; exact restore                                                   |
| git commits JSON tail only                                                                                               | produces byte-identical Git facts when shuffled (pre-existing tied-identity test) | 1 failed / 12 passed; exact restore                                                   |
| git commits ordering fully removed (`() => 0`)                                                                           | renders byte-identical changes and project reports in every format                | 2 failed / 11 passed (both the render test and the tied-identity test); exact restore |
| agent file-order Windows-separator normalization                                                                         | renders byte-identical usage reports in every format                              | 2 failed / 11 passed (render test and the separator test); exact restore              |
| cert substitute-review phrases re-added                                                                                  | certifies the independent RVCM1131 review                                         | 1 failed / 1 passed; exact restore                                                    |
| PLAN C-M113-1 entry removed                                                                                              | records C-M113-1 in PLAN M113                                                     | 1 failed / 1 passed; exact restore                                                    |
