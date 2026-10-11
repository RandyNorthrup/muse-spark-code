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
