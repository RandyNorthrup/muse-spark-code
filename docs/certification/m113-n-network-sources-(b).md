# M113 N — Network sources (b)

2026-10-06, Kubuntu rig, worktree `/home/randy/lanes/M113N`, branch
`m113/n`, base `145f97cdd`. Authority: `M113N.rig.md`, shared
`codex/common.md`, AGENTS.md, PLAN.md D93 and M113, read in full, and lane
0's frozen contracts and certification. Background: M71's capture and client,
M80's headless contracts, M84's export scrub and M93's research.

This lane implements the shared network readers and posting controller against
lane 0. It does not register a command, setting, UI, lazy entry or manifest
key: those files belong to X, V and W. The brief forbids editing another
lane's files, network calls, merge, rebase and push. All validation and drills
are local, fake-only, with default Vitest timeouts; no model attempts, live
requests, credentials, dependencies, installs or global settings.

## Implementation and acceptance

- `cache.ts`: terminal network requires `--network` even with sign-in;
  `off` prevents cache access and dispatch. Every request needs the injected
  D65/host egress admission. Only HTTPS on the four declared service hosts;
  redirects and ambient cookies are refused by the public transport. GitHub's
  media type and API version are pinned to M71's constants. GETs only, except
  the Marketplace's public read-query POST. Credential-shaped request values
  are refused. Requests, bodies, pages and cache indexes are bounded; one
  five-second source deadline covers egress, cache, HTTP and parsing. Abort
  cancels a stalled body even when the transport ignores its signal.
- Every HTTP body is bounded UTF-8, parsed with its input schema, then scrubbed
  as decoded structured data and validated with its output schema. The
  collected snapshot uses the same structured scrub and is validated again. Errors
  expose fixed technical reasons, never response bodies, stderr or thrown
  source text. Cache identities are scrubbed before SHA-256 and include the
  workspace. Cache values and ETags are scrubbed before storage and again on
  reuse. A 304 keeps the original observation and its age, marked stale;
  it cannot fabricate a missing cache entry. Updates are serialized in one
  cache instance and oldest entries evicted deterministically.
- Rate limits honour `x-ratelimit-remaining`, `x-ratelimit-reset` and both
  Retry-After forms. The GitHub floor is inclusive at 10. Subsequent reads
  stop without dispatch, naming the reset even when no initial read succeeded.
  Missing reset metadata receives a bounded conservative cooldown. No retry
  loop or untrusted Link header is followed.
- `github.ts`: pull requests and check runs reuse the **2026-09-28 M71
  gh-api capture** in `test/unit/helpers/githubCapture.ts`, from repository
  `RandyNorthrup/muse-spark-code`, M71's recorded branch/workspace. This lane
  made **zero model attempts and zero capture requests**. New field reads
  (`head_sha`, `html_url`) occur in that recorded check shape. HEAD checks
  must match the requested commit; default branch and release tag remain
  separate scopes, and future conclusion words survive. Bounded pages retain
  successful facts when later reads fail. Lists use code-unit keys; identical
  overlapping facts collapse and conflicting facts are explicitly refused.
  Release assets are sorted too. Missing workflow/release captures produce
  `partial`, not fabricated complete success.
- `ghReportTransport`: the real default runner is Node's `execFile`, no
  shell, with a timeout, maxBuffer, AbortSignal and a credential-free supplied
  environment. D24's existing safe PATH resolver selects an absolute executable
  through the mandatory host file probe, excluding empty/relative workspace
  entries on both POSIX and Windows; a missing binary is explicitly refused.
  The process-spy tests exercise that boundary. gh owns its
  login; no token is read, stored or passed in arguments/environment. HTTP
  status/headers from nonzero gh exits still reach rate-limit handling;
  stderr never reaches reports. `--include` is parsed as standard HTTP syntax,
  not a guessed service JSON shape.
- `stores.ts`: the publisher/vscode manifest selects Marketplace and Open
  VSX; only non-private packages select npm. A private non-extension is
  explicitly not applicable. Each applicable missing adapter is named. A
  successful adapter is validated as a normalized application fact; unknown
  version syntax is unavailable. The existing M99 semver comparison supplies
  current/lagging, including prereleases and historical reports where a store
  is ahead. Lag rows feed K's Needs-you collector; failed channels remain
  explicit beside successful channels.
- Posting: opt-in is checked for the exact report kind and target. A manual
  invocation shows the entire scrubbed body plus the localized automated note
  and needs the semantic `post` decision. An unattended invocation needs a
  validated `post-report` schedule grant for that exact kind/target and a
  previous approved full preview. The mandatory scheduler-authority port
  independently verifies the active occurrence, creator and workspace before
  egress and again before dispatch; caller-provided fields and a remembered
  target preview cannot establish authority. The pinned status issue uses `updateIssue`
  with its existing number, never creates another issue. Consent is rechecked
  after preview and after egress admission. A changed scrub result invalidates
  the preview. Receipts validate origin and exact target. Dispatched failures
  or deadlines are `uncertain`, never automatically retried or remembered as
  a successful preview.

Final review added the independent scheduler-authority port. Its regression
refuses a forged grant even with target opt-in and a prior preview. A separate
regression first failed with `posted` when target consent was revoked during
the second authority check; moving the final setting check after that awaited
verification fixed it. A redaction change during egress also invalidates the
preview before dispatch. The initial authority drill exposed that two identical
denial checks masked the intended first-admission test; the fixture now changes
authority at egress to prove each boundary independently.
The executable regressions first failed on both POSIX and Windows with a
bare `gh` name, and the missing-binary case incorrectly succeeded. Binding
the existing resolver fixed all three without adding a resolver or filesystem
implementation to this lane.

The first concurrency regression failed before its repair: four simultaneous
cache updates retained one entry. Serializing updates fixed it; the queue
bypass drill fails the same test. An initial pagination fixture exceeded its
own small body budget before reaching the page guard; that fixture now has a
separate adequate byte budget, without changing any repository timeout/cap.

## Integration handoffs (required, not production fakes)

The lane-0 record explicitly names `M113-N-captures`: approved store responses
and actual rate headers are **absent on this base**. Shared rules forbid new
network calls. Rate/ETag/error controls here are synthetic faults, not live
receipts; store tests are normalized application-port fakes, never claimed
wire captures. The lead must not claim stores, workflow/releases or posting
service adapters certified until the following bindings land.

| Handoff                   | Owner            | Required binding                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-captures                | Lead / N         | Approved Marketplace, Open VSX, npm, workflow/release and posting captures, with workspace and attempt counts. `ReportStoreAdapter` supplies a captured schema/transform; `ReportGitHubAdditionalPort` supplies normalized facts. No guessed wire parser is shipped.                                                                                                                                                                                                  |
| N-cache-storage           | S / W            | Bind `ReportCacheStorage` to owner-only, bounded, confined, link-refusing atomic storage at `<agentDataFolder>/reports/v1/cache/index.json`. Share one cache instance per storage binding; separate processes/windows need the host's storage serialization. Storage calls must honour their AbortSignal.                                                                                                                                                             |
| N-reader-wiring           | V / X / W        | Inject the installed-language export scrub (registered values, digests, account ids and local roots), actual observation clock, machine-scoped network setting, terminal flag and D65/network-posture check. Bind signed-in HTTP through M71's credential-owning host client; public fetch and gh transports are implemented here. The gh transport requires the host's D24 `ExecutableProbe`. W supplies named byte/page/cache-entry constants without raising caps. |
| N-posting                 | V / X / Q / M115 | Bind per-kind/exact-target settings and the stored preview state, the full preview's Post button, and the captured comment/update adapter using D95.13's user identity. Q binds mandatory `authorizeSchedule` to the active occurrence/creator/workspace authority, independently of the caller's grant and prior preview. Surface `uncertain` honestly and never silently retry it.                                                                                  |
| N-Needs-you               | K                | Consume `stores` channel status/lag and GitHub's scoped default-branch failures. Unknown/missing channels remain explicit source rows.                                                                                                                                                                                                                                                                                                                                |
| N-manifest-reference-docs | W                | Register the prepared `museSpark.reports.network` manifest keys, default whenSignedIn and machine scope; expose `--network` through X. Add accurate network/posting help catalogue entries, regenerate reference, and update README Reports, CHANGELOG Unreleased, PRIVACY, SECURITY, ACP/CI and host docs. These files belong to W, so this lane leaves them untouched.                                                                                              |
| N-host-api-record         | W                | Regenerate the owned host API record after integration. This lane adds one importing file each for `node:child_process` (13→14), `node:crypto` (46→47), and `node:util` (5→6). No VS Code API or importing file is added. The source check currently fails only generated-record freshness.                                                                                                                                                                           |
| N-lazy-bundle             | W / R            | Import these modules only through `dist/reporting.js`, with R's render/scrub and the guarded no-backend split; measure the complete engine against D93's new budget. No activation or UI import is added here.                                                                                                                                                                                                                                                        |

All editors use the same core ports: VS Code, native MHP hosts, companion,
ACP/CLI/headless and later desktop/TUI. There is no VS Code import. This lane
introduces no filesystem path comparison; the storage binding must normalize
Windows separators and verify canonical confinement. No new UI or English
key was needed: existing lane-0 localized `reportUi` text is read at call time.
Technical availability codes are source data. The seven unused manifest keys
already recorded by lane 0 remain W's handoff; they are not ignored or removed.

## Validation

Final scoped gate results and deliberate-break receipts are appended below.
The duplication gate first caught four repeated test setup blocks; shared
test-only fixtures removed them without changing an assertion or threshold.
The follow-up gate caught two further repeated test setup blocks; a shared
admission-policy fixture and schedule value removed them with all assertions
retained, and the zero-threshold check passed again.
Plain knip runs through `npm run deadcode` with Jiti filesystem caching off
(`JITI_FS_CACHE=0`) to avoid writes under the shared `node_modules`; this does
not alter analysis or hooks.
The full quality gate stays with the lead: the rig brief/shared rules expressly
prohibit a lane from running it or the complete test suite. No gate, hook,
threshold, timeout, ignore, dependency or escape-hatch rule was changed.

## Deliberate breaks

The initial 57 mutations below ran the complete named owning test file with
`npx --no-install vitest run <file> --maxWorkers=3`, default test timeouts,
no test-name filters. Every run exited 1 with the expected named failure.
The original production file was restored in `finally` and its SHA-256
matched byte-exact. The two deadline mutations intentionally outlast the
fake clock and fail at Vitest's own default timeout; normal deadline tests
use fake timers and finish in milliseconds. One drill receipt initially
looked for the old wording of the changed-scrub test; the test label was
corrected and that drill rerun with the intended named failure.

Detailed local receipts/logs: `temp/m113n/drills.json` and `<drill>.log`.
No mutation, scratch harness, log or synthetic credential is shipped.

| Mutation                      | Named failing test                                                                          | Owning file                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| `network-off`                 | does not dispatch for editor off                                                            | `reportNetworkCache.test.ts` |
| `terminal-opt-in`             | does not dispatch for terminal always                                                       | `reportNetworkCache.test.ts` |
| `egress-admission`            | checks egress before cache or dispatch                                                      | `reportNetworkCache.test.ts` |
| `https-pin`                   | refuses an unpinned endpoint http:                                                          | `reportNetworkCache.test.ts` |
| `read-only-method`            | refuses a mutation hidden in a network reader                                               | `reportNetworkCache.test.ts` |
| `request-bound`               | refuses oversized query bodies before dispatch                                              | `reportNetworkCache.test.ts` |
| `request-secrets`             | refuses credential-shaped request values before dispatch                                    | `reportNetworkCache.test.ts` |
| `body-bound`                  | bounds response bytes and validates HTTP payloads                                           | `reportNetworkCache.test.ts` |
| `page-bound`                  | bounds pages rather than following arbitrary pagination forever                             | `reportNetworkCache.test.ts` |
| `positive-budgets`            | validates positive injected                                                                 | `reportNetworkCache.test.ts` |
| `cache-index-bound`           | validates cached records and refuses oversized indexes                                      | `reportNetworkCache.test.ts` |
| `cache-key-schema`            | validates persistent cache metadata before dispatch                                         | `reportNetworkCache.test.ts` |
| `cache-time-schema`           | validates persistent cache metadata before dispatch                                         | `reportNetworkCache.test.ts` |
| `cache-prune`                 | prunes the oldest cache entries with a stable tie break                                     | `reportNetworkCache.test.ts` |
| `cache-queue`                 | preserves concurrent cache updates                                                          | `reportNetworkCache.test.ts` |
| `cache-workspace`             | isolates cached responses by workspace                                                      | `reportNetworkCache.test.ts` |
| `scrub-before-cache-hash`     | scrubs cache content and identity before persisting or hashing                              | `reportNetworkCache.test.ts` |
| `scrub-before-cache-write`    | scrubs cache content and identity before persisting or hashing                              | `reportNetworkCache.test.ts` |
| `etag-secret`                 | rescrubs a tampered cache body and refuses its secret ETag                                  | `reportNetworkCache.test.ts` |
| `etag-conditional`            | reuses a 304 with the original observation and age                                          | `reportNetworkCache.test.ts` |
| `etag-age`                    | reuses a 304 with the original observation and age                                          | `reportNetworkCache.test.ts` |
| `etag-cache-missing`          | never fabricates a 304 cache hit                                                            | `reportNetworkCache.test.ts` |
| `rate-floor`                  | stops at the rate floor and names the reset without dispatching again                       | `reportNetworkCache.test.ts` |
| `retry-after`                 | honors Retry-After                                                                          | `reportNetworkCache.test.ts` |
| `source-deadline`             | times out ignored cancellation within the repository timeout                                | `reportNetworkCache.test.ts` |
| `body-cancellation`           | cancels a stalled response body on the source deadline                                      | `reportNetworkCache.test.ts` |
| `no-fake-observation`         | does not manufacture an observation for an unbound source port                              | `reportNetworkCache.test.ts` |
| `public-redirects`            | uses a credential-free, redirect-refusing public fetch                                      | `reportNetworkCache.test.ts` |
| `public-cookies`              | uses a credential-free, redirect-refusing public fetch                                      | `reportNetworkCache.test.ts` |
| `public-api-pin`              | uses a credential-free, redirect-refusing public fetch                                      | `reportNetworkCache.test.ts` |
| `github-sign-in`              | never dispatches when signed-in policy lacks a login                                        | `githubReportSource.test.ts` |
| `github-head-binding`         | refuses HEAD check runs for a different commit                                              | `githubReportSource.test.ts` |
| `github-url-schema`           | rejects malformed captured URL fields before reporting them                                 | `githubReportSource.test.ts` |
| `github-missing-captures`     | marks workflow/releases missing rather than presenting empty complete success               | `githubReportSource.test.ts` |
| `github-conflicting-facts`    | refuses conflicting facts for the same pull request rather than choosing an arbitrary state | `githubReportSource.test.ts` |
| `stable-order`                | orders releases and assets independently of the port input order                            | `githubReportSource.test.ts` |
| `snapshot-scrub`              | binds and scrubs a validated workflow/release port                                          | `githubReportSource.test.ts` |
| `gh-credential-environment`   | uses gh login without any credential environment variable or token argument                 | `githubReportSource.test.ts` |
| `gh-credential-argument`      | refuses credential-shaped refs and header values before spawning gh                         | `githubReportSource.test.ts` |
| `store-applicability`         | does not request npm for a private extension                                                | `storeReportSource.test.ts`  |
| `store-lag`                   | reads only applicable public channels and exposes lag for Needs you                         | `storeReportSource.test.ts`  |
| `store-unavailable-row`       | retains unavailable channel rows beside successful channels                                 | `storeReportSource.test.ts`  |
| `post-target-number`          | refuses invalid issue numbers                                                               | `reportPosting.test.ts`      |
| `post-kind-opt-in`            | requires opt-in for the exact kind and target                                               | `reportPosting.test.ts`      |
| `post-preview`                | refuses a denied preview                                                                    | `reportPosting.test.ts`      |
| `post-schedule-action`        | refuses a schedule with a different action at its runtime boundary                          | `reportPosting.test.ts`      |
| `post-schedule-kind`          | requires the schedule grant to name the same kind and exact target                          | `reportPosting.test.ts`      |
| `post-schedule-target`        | requires the schedule grant to name the same kind and exact target                          | `reportPosting.test.ts`      |
| `post-schedule-first-preview` | requires first full preview approval before any unattended post                             | `reportPosting.test.ts`      |
| `post-automated-note`         | previews the full scrubbed body and automated note before a manual post                     | `reportPosting.test.ts`      |
| `post-preview-scrub`          | scrubs planted source credentials from preview and dispatched body                          | `reportPosting.test.ts`      |
| `post-rescrub`                | refuses a changed scrub result after approval                                               | `reportPosting.test.ts`      |
| `post-revoke-at-egress`       | refuses a setting revoked during egress admission                                           | `reportPosting.test.ts`      |
| `post-pinned-update`          | edits the same pinned issue in place on every invocation                                    | `reportPosting.test.ts`      |
| `post-receipt-origin`         | refuses a foreign posting receipt https://example.invalid                                   | `reportPosting.test.ts`      |
| `post-receipt-target`         | refuses a foreign posting receipt https://github.com/fixture/repo/issues/13                 | `reportPosting.test.ts`      |
| `post-deadline`               | retains uncertainty and never retries a dispatched request that times out                   | `reportPosting.test.ts`      |

Restored production SHA-256 for this drill batch:

- `src/core/reporting/sources/cache.ts`: `89e22036a391849c2b31c19e1fb983bbe58bcc16a3a08da070326053491d28f1`
- `src/core/reporting/sources/github.ts`: `5bd952458894a33852bec109b1e9b17c394308afe4b8fa01eb1e90d592eec249`
- `src/core/reporting/sources/stores.ts`: `27c9217fe8862e16f5d44a9cfbb6d0c69b001a6269e5605ba2f8701530d59053`

The final posting/transport follow-up adds six mutations, for **63 total** named red
drills. Each ran the complete owning test file with the same default
timeout and worker limit, exited 1 with the named failure, and restored
`github.ts` byte-exact to
`41119c7babfb4740b75556d65a04417fe8def430d67d5e1e5ba3bb4a6d05e785`.
Receipts: `temp/m113n/posting-drills.json` and the matching logs.

| Mutation                          | Named failing test                                                     |
| --------------------------------- | ---------------------------------------------------------------------- |
| `post-schedule-authority`         | refuses a forged schedule despite target opt-in and a previous preview |
| `post-schedule-authority-recheck` | rechecks scheduled authority after egress admission                    |
| `post-rescrub-after-egress`       | refuses a scrub change during egress before dispatch                   |
| `post-revoke-after-authority`     | refuses a setting revoked during scheduled authority verification      |
| `gh-safe-executable`              | resolves gh without workspace PATH entries on linux (also fails win32) |
| `gh-no-bare-fallback`             | refuses a missing gh executable instead of using a bare fallback       |

## Final scoped results (Kubuntu)

All final test runs use the repository default timeout, no test-name filters,
at most three files per invocation and `--maxWorkers=3`.

| Check                                                                                   | Result                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                     | Exit 0, all five projects.                                                                                                                                                        |
| ESLint on all eight owned TypeScript files, `--max-warnings=0`                          | Exit 0.                                                                                                                                                                           |
| Prettier on those files and this record                                                 | Exit 0; rerun after final record append.                                                                                                                                          |
| `npm run deadcode` (plain knip; filesystem cache off only)                              | Exit 0.                                                                                                                                                                           |
| `npx --no-install jscpd`                                                                | Exit 0, zero clones at the unchanged zero threshold.                                                                                                                              |
| `npm run check:reference`                                                               | Exit 0; no user-facing registration was changed.                                                                                                                                  |
| `node scripts/check-l10n.mjs`                                                           | Exit 1: exactly the seven pre-existing unused manifest keys from lane 0. 14 UI tables have no new translation problem. W owns manifest binding; no ignore or key was removed.     |
| `npm run check:host-api`                                                                | Exit 1: one generated-record freshness problem, the three Node import counts named in N-host-api-record. No VS Code API changes. W owns regeneration; no record was edited.       |
| dpdm from all three network entries, with `-T`                                          | Exit 0, no cycles.                                                                                                                                                                |
| `npm run build`                                                                         | Exit 0: unchanged size/split, host-global and third-party notice gates. These modules have no activation entry on this base; W must measure the integrated lazy reporting bundle. |
| `reportNetworkCache.test.ts`, `githubReportSource.test.ts`, `storeReportSource.test.ts` | Exit 0, 78 tests.                                                                                                                                                                 |
| `reportPosting.test.ts`                                                                 | Exit 0, 31 tests; 109 total owned tests.                                                                                                                                          |
| Red drills                                                                              | 63 named semantic failures across both batches, exit 1, every production restoration SHA-256 byte-exact.                                                                          |

Build receipts: extension 439.5 KiB / 600 KiB, Model API 446.9 KiB / 475 KiB,
ACP 821.5 KiB / 850 KiB, checkpoint store 76.9 KiB / 225 KiB.

Final logs and exact commands are retained locally in
`temp/m113n/checks.json`, `checks-followup.json` and the matching final/follow-up logs. The only nonzero final gates
are the two named integration handoffs; they are not claimed green. No full
quality run, live service certification or editor integration is claimed.

The first implementation commit is
`2b0d882791bd8e618b22fc0994623c0bd6fbab31`. Its normal pre-commit hook ran
lint-staged's ESLint/Prettier and gitleaks successfully, with no leaks.
The worktree's `.husky/_/pre-commit` exists. The posting follow-up uses the
same enabled hooks; its commit receipt is included in the final lane report.
No source change follows the final follow-up checks.

## Review repair RVM113N (FIXM113N)

Authority: `/home/randy/lanes/_ctx/M113N.rig.md`,
`codex/common.md` and the complete `codex/RVM113N.report.md`, base
`24b45a612`. The review confirmed four P2s, no P1s. This repair stays in
N's owned modules, tests and certification plus PLAN's scoped records. W
continues to own CHANGELOG/public documentation and wiring; no new public
feature, command, setting, dependency, capture or model attempt is introduced.

All seven new regression cases failed against the original production code
(78 existing tests passed), using the three complete owning suites and default
timeouts. All four findings are now fixed, with no review residuals. The
first finished piece is `9e61d1762` (findings 1 and 2); the second completes
rate/policy admission and strengthens output-validation/failure tests:

| Finding                             | Repair                                                                                                                                                                                                                    | Regression                                                                                                                                 | Red drill                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 decoded credential persistence | Parse the response, scrub decoded strings/field names through the shared `scrubStructured` helper, validate the output, then write the cache. The helper also scrubs cached and collected data.                           | `scrubs escaped credentials in captured pull titles before persistent cache writes`                                                        | `decoded-scrub`: remove the decoded scrub before storage; the complete GitHub suite exits 1 at the named test.                                                      |
| P2.2 transformed 304 cache output   | Query accepts a separate output schema; store adapters always supply the normalized fact schema. The 304 path validates stored parsed output directly and preserves its observation.                                      | `reuses transformed store facts on 304 with their output schema`                                                                           | `parsed-304`: replace the cached output validator with the input parser; the complete store suite exits 1 at the named test.                                        |
| P2.3 concurrent rate-floor bypass   | One per-host queue covers rate admission, transport dispatch and the returned rate headers. Admission uses the current time after cache access and after acquiring the queue. Failed dispatches release later admissions. | `rechecks the rate floor after an awaited cache read`; `serializes concurrent same-host dispatches until rate headers establish the floor` | `rate-floor-after-cache`: bypass the final floor check; `serialized-dispatch`: bypass the preceding host dispatch. Each full cache suite exits 1 at its named test. |
| P2.4 network-off during an await    | Recheck the live policy immediately before each transport call, with no await between check and send.                                                                                                                     | `rechecks network-off after an awaited cache admission`; the egress variant; `rechecks network-off before every subsequent page`           | `network-before-dispatch`: remove the final policy check. All three named cases fail in the complete cache suite, exit 1.                                           |

Both first-piece deliberate mutations restored `cache.ts` byte-exact in `finally`,
SHA-256 `267ff4e7955992cc2932ef538e43fe358de5eafabec3138f39f2ff25aa786b69`.
Local logs: `temp/fixm113n/baseline.log`, `parsed-cache.log`,
`drills-parsed.json` and `drill-{decoded-scrub,parsed-304}.log`.
The escaped title reuses M71's captured pull shape; the store transform is
explicitly a synthetic adapter-contract input, not an npm capture. Tests
never use a real credential or service. The post-repair GitHub/store run
passed all 43 tests with repository default timeouts.
`npm run typecheck` passed all five projects; ESLint with zero warnings and
Prettier passed the four TypeScript files in this first piece. The normal
pre-commit hook is enabled and checks the explicit staged paths.

The final seven red drills cover both original persistence/hit regressions
again, the independent parsed-output validator (a corrupt cached URL is
refused), the rate recheck, the host lock, the final live policy check, and
queued recovery from a thrown transport error. `host-failure-release`
deliberately makes the predecessor's failed dispatch poison its queue; the
existing `does not leak a thrown transport error or a refused HTTP body`
test now asserts the next concurrent read succeeds and fails under that
mutation. All seven complete owning-file runs exited 1 at the expected named
tests, restored byte-exact in `finally`, and compared SHA-256
`349376dbfe7335d85a4d90b2b38663b865dd88113a7ea546f9058bc86d1be210`.
Receipts: `temp/fixm113n/drills-final.json` and corresponding `drill-*.log`.
Including the first piece, nine drill executions were certified.

The zero-threshold duplication gate found one repeated rate-header fixture;
a shared test-only factory within the owned cache suite removes it. No
assertion or threshold changed; the rerun found zero clones, exit 0.
No path comparison, wire field, localization key or escape hatch is added.

### FIXM113N final verification (Kubuntu, 2026-10-06)

All checks ran directly in this worktree, sequentially; no rig wrappers,
test-name filters, timeout overrides, skipped tests or full-suite run. Final
commands and receipts are in `temp/fixm113n/checks-final.json`; logs use
`<check>-final.log` (the test logs are `sources-final-final.log` and
`posting-final-final.log`). The code is the byte-exact restored final version
above. The final documentation append receives another Prettier check.

| Check                                                                                                                                                      | Result                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                        | Exit 0, all five projects.                                                                                                                                                                               |
| ESLint on all eight owned TypeScript files, `--max-warnings=0`                                                                                             | Exit 0.                                                                                                                                                                                                  |
| Prettier on those files, PLAN and this record                                                                                                              | Exit 0.                                                                                                                                                                                                  |
| `npm run deadcode`, plain knip with `JITI_FS_CACHE=0`                                                                                                      | Exit 0; no writes under shared node_modules.                                                                                                                                                             |
| `npx --no-install jscpd`                                                                                                                                   | Exit 0, zero clones, unchanged zero threshold.                                                                                                                                                           |
| `npm run check:reference`                                                                                                                                  | Exit 0, generated reference current.                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                                                                                                                              | Exit 1, exactly the seven existing unused report manifest keys; all 14 UI tables checked, no new problem. W's N-manifest-reference-docs handoff, unchanged.                                              |
| `npm run check:host-api`                                                                                                                                   | Exit 1, the existing generated-record freshness problem: node:child_process 13→14, node:crypto 46→47, node:util 5→6. No new imports/API change in this repair. W's N-host-api-record handoff, unchanged. |
| `npm run build`                                                                                                                                            | Exit 0, including unchanged size/split, host-global and notice gates.                                                                                                                                    |
| `npx --no-install vitest run test/unit/reportNetworkCache.test.ts test/unit/githubReportSource.test.ts test/unit/storeReportSource.test.ts --maxWorkers=3` | Exit 0, 85 tests, repository default timeouts.                                                                                                                                                           |
| `npx --no-install vitest run test/unit/reportPosting.test.ts --maxWorkers=3`                                                                               | Exit 0, 31 tests, repository default timeouts; 116 total owned tests.                                                                                                                                    |
| Final red drills                                                                                                                                           | Seven expected red exits; nine executions including the first piece; every restoration SHA-256 byte-exact.                                                                                               |

Build sizes remain extension 439.5/600 KiB, Model API 446.9/475 KiB,
ACP 821.5/850 KiB and checkpoint store 76.9/225 KiB. These modules still
await W's lazy reporting entry; this build does not certify that future
integrated bundle. No gate is weakened or claimed green when nonzero.

For W's existing reader-wiring handoff, use the same reader for concurrent
reads in a host and bind `policy.mode` to the current setting (for example,
a live getter). Each reader's host queue shares its rate state; public,
signed-in and gh transports all pass through that admission. Cross-window
storage serialization remains the existing storage handoff. W also owns the
public Unreleased documentation for the four fixes. PLAN §9 records no
remaining review finding while retaining these named integration boundaries.

The first repair commit's normal hook ran lint-staged ESLint/Prettier and
gitleaks, exit 0, no leaks. The second uses the same enabled hooks with only
explicit paths staged. No merge, rebase, push, live service or model call,
dependency install or global setting change occurred.

## Round-two review repair RVM113N2 (FIXM113N2)

Authority: `/home/randy/lanes/_ctx/M113N.rig.md`, shared
`codex/common.md`, the complete `codex/RVM113N2.report.md`, AGENTS.md,
and PLAN D93/M113. Starting branch `m113/n`, HEAD `6741cea1d`.
The review confirmed two P2 findings, no P1/P3. Both are fixed structurally;
there are no remaining review findings. Edits stay within N's cache/GitHub
modules, owned tests and certification, and PLAN's scoped records.
No dependency, escape hatch, wire field, path comparison, localization key,
setting, command or activation import is added. Public documentation and
the feature catalogue remain W's existing named integration handoff.

| Finding                                                         | Fix                                                                                                                                                                                                                                                                                                                                       | Regression cases                                                                                                                                                                                                                                                                          | Status              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| P2.1 ignored cancellation blocks later host admission           | Replace the chained dispatch queue with one live owner per host. Both the owner wait and transport response race the existing five-second source deadline/abort signal. Finally releases the owner on success, failure, abort or timeout; late responses check their generation, cancel their bodies and cannot reach rate/cache updates. | `releases same-host admission after deadline when transport ignores cancellation`; the explicit-abort variant; `removes an aborted waiter without releasing the active host owner`; `discards a late transport response without changing the new host generation`; the rejection variant. | Fixed, no residual. |
| P2.2 GitHub dispatch bypasses the live whenSignedIn requirement | `isReportNetworkAllowed` owns the setting, terminal flag and endpoint-specific GitHub sign-in decision. GitHub's initial eligibility and every reader dispatch use it; the final check has no await before transport. Stores keep public access under whenSignedIn without a GitHub login.                                                | `refuses GitHub after whenSignedIn during cache admission` and `refuses GitHub after sign-out during cache admission`, plus both transitions during egress and host admission; `rechecks GitHub sign-in before every subsequent page`.                                                    | Fixed, no residual. |

The initial ten new regressions failed against reviewed HEAD (85 existing
cases passed). The expanded full-suite baseline failed all twelve fix
regressions (89 passed); four additional terminal-consent cases already
passed and protect each declared host: `api.github.com`,
`marketplace.visualstudio.com`, `open-vsx.org`, `registry.npmjs.org`.
The real GitHub source uses the existing M71 captured pull/check response
shapes; rate/stream/admission faults remain synthetic port fixtures.
No new service shape or capture is claimed. All editors share these core
ports: no VS Code-only behavior is introduced.

### Round-two deliberate failures

Every mutation ran complete owned suites (at most three files per run,
`--maxWorkers=3`, repository default timeout, no test-name filters),
returned exit 1 at the expected semantic assertion, and restored both
production files from saved bytes in `finally`. SHA-256 matched after
each run. The reviewed baseline and six guard drills are recorded in
`temp/fixm113n2/drills.json` with matching `drill-*.log` receipts.

| Drill                  | Deliberate break                                                           | Named failure                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewed-baseline`    | Restore the reviewed cache/GitHub modules while retaining the final tests. | All twelve new fix regressions fail; 89 tests pass.                                                                                      |
| `transport-unbounded`  | Await the raw transport without racing cancellation/deadline.              | `releases same-host admission after deadline when transport ignores cancellation` and the abort/recovery cases.                          |
| `wait-unbounded`       | Await an owner's release without racing the waiter's cancellation.         | `removes an aborted waiter without releasing the active host owner`: the canceled collector's cleanup does not run.                      |
| `late-generation`      | Remove the obsolete-generation completion guard.                           | `discards a late transport response without changing the new host generation`: the late body's cancellation is missing.                  |
| `host-serialization`   | Bypass the active owner's wait.                                            | `serializes concurrent same-host dispatches until rate headers establish the floor`.                                                     |
| `github-live-policy`   | Omit the endpoint from the final policy decision.                          | `refuses GitHub after sign-out during host admission`; all seven GitHub live-policy cases fail.                                          |
| `final-network-policy` | Remove the final policy check.                                             | `rechecks terminal consent before dispatch to registry.npmjs.org`; all four declared-host cases and the existing network-off cases fail. |

Restored production SHA-256:

- `src/core/reporting/sources/cache.ts`:
  `03010b5c23aaa0c329b5563b8a56c9e44613c52892bfd623a266e221985732fa`
- `src/core/reporting/sources/github.ts`:
  `dc0d56ab9d742269885a099d2cab50b90ed0a4433ea69693cbb283a3cd16070d`

The shared five-second deadline is unchanged. Waiting callers observe the
owner's release without retaining a chain of timed-out dispatches. A canceled
waiter finishes its collector cleanup promptly while the active owner keeps
its slot. A recovered request may own that host before an obsolete transport
completes; neither an obsolete response nor rejection changes that ownership.
The host's rate state remains serialized through response headers.
The owner's once-only release signal keeps the implementation compatible
with Node 20. Scoped lint required await-based transport handling and this
release mechanism; test naming/void-expression errors were corrected.
The duplication gate caught two copied setup blocks and then a generic
barrier block shared with an unrelated suite. Test-only factories and a
grouped barrier state remove those copies; zero clones pass at the unchanged
zero threshold, with all assertions retained.
The reader-wiring handoff requires current setting/sign-in getters and a
shared reader in each host. N-cache-storage still requires bounded ports that
honour their AbortSignal; this repair does not replace the storage binding.

All work is local and fake-only on Kubuntu. No network/model/paid calls,
credentials, installs, merge, rebase, push or global configuration changes.
The worktree's `.husky/_/pre-commit` exists; commits use normal enabled
lint-staged/gitleaks hooks and explicit staged paths.

### FIXM113N2 final verification (Kubuntu, 2026-10-06)

All checks run directly and sequentially in this worktree. Final commands,
exit codes and logs are in `temp/fixm113n2/checks-final.json`; the final
production bytes match the restoration hashes above. Vitest uses repository
default timeouts, complete owned files, no filters and `--maxWorkers=3`.
No runtime source or assertion changes follow this verification.

| Check                                                                                                                                                      | Result                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                        | Exit 0, all five projects on the final owner implementation.                                                                                                                                        |
| ESLint, all eight owned TypeScript files, `--max-warnings=0`                                                                                               | Exit 0.                                                                                                                                                                                             |
| Prettier, those eight files and PLAN                                                                                                                       | Exit 0; this final certification append also receives a format check before commit.                                                                                                                 |
| `npm run deadcode`, plain knip with `JITI_FS_CACHE=0`                                                                                                      | Exit 0; caching off prevents writes under shared node_modules.                                                                                                                                      |
| `npx --no-install jscpd`                                                                                                                                   | Exit 0, zero clones, unchanged zero threshold.                                                                                                                                                      |
| `npm run check:reference`                                                                                                                                  | Exit 0, generated reference current.                                                                                                                                                                |
| `node scripts/check-l10n.mjs`                                                                                                                              | Exit 1, exactly the seven existing unused report manifest keys; all 14 UI tables checked. W's N-manifest-reference-docs handoff remains.                                                            |
| `npm run check:host-api`                                                                                                                                   | Exit 1, the existing generated-record freshness mismatch: node:child_process 13→14, node:crypto 46→47, node:util 5→6. This repair adds no import/API change. W's N-host-api-record handoff remains. |
| `npm run build`                                                                                                                                            | Exit 0, unchanged size/split, host-global and third-party notice gates.                                                                                                                             |
| `npx --no-install vitest run test/unit/reportNetworkCache.test.ts test/unit/githubReportSource.test.ts test/unit/storeReportSource.test.ts --maxWorkers=3` | Exit 0, 101 tests.                                                                                                                                                                                  |
| `npx --no-install vitest run test/unit/reportPosting.test.ts --maxWorkers=3`                                                                               | Exit 0, 31 tests; 132 total owned tests.                                                                                                                                                            |
| Final reviewed-baseline and guard drills                                                                                                                   | Seven expected red exits at named assertions, with byte-exact restoration after each run.                                                                                                           |
| `git diff --check`                                                                                                                                         | Exit 0.                                                                                                                                                                                             |

Build sizes: extension 439.5/600 KiB, Model API 446.9/475 KiB,
ACP 821.5/850 KiB, checkpoint store 76.9/225 KiB. W's future lazy reporting
entry is still unbound on this base, so these receipts do not certify its
integrated bundle. The brief reserves aggregate `npm run quality` for the
lead; it was not run. Both nonzero scoped gates are named pre-existing W
handoffs and are not claimed green. No threshold, rule or ignore is weakened.
W retains the public Unreleased documentation for these two repairs.
PLAN §9 records no review residuals and keeps all existing integration
handoffs with their named owners.
