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
- Every HTTP body is bounded UTF-8 and schema-validated after the injected
  scrub. The collected snapshot is scrubbed and validated again. Errors
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
