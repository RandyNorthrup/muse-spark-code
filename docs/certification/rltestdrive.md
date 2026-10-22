# RLTESTDRIVE — the owner's 0.19.0 test drive: every defect it found, fixed

Recovery lane. Rig `linuxlt`, worktree `/home/randy/lanes/RLTESTDRIVE`,
branch `rec/rltestdrive`, base main at 0.19.0 (`0cab9f3233`), never merged,
never pushed. Tests run directly (`npx vitest run <files> --maxWorkers=3`,
at most 3 files per run) with the repository's own timeout. No live model
or provider calls from the rig (brief authorizes none; the owner's key
lives on the owner PC): where a backend is involved, the exact request is
recorded for the owner-PC run instead.

## 1. Agent Map: one true status per agent (`f6eb86198c`)

A finished agent read "Running · Inactive · Ended, Unverified": the card,
detail page, background-task row and workflow child joined the raw status
label (whose field lags the controls on the Muse Code backend) with the
derived activity/outcome text. Every agent surface now reads the derived
`agentStateText` alone (`inactive` activity plus the ended outcome, or the
activity word); the transcript row does too via its own `useAgentClock`.
The `childStatusLabel` / `workflowChildStatuses` text is deleted (en plus
14 locale tables).

Files: `src/webview/components/AgentMapContent.tsx`, `Transcript.tsx`,
`WorkflowRun.tsx`, `src/webview/workflowDetails.ts`, `agentFormat.ts`,
`src/shared/l10n/en.ts`, `l10n/ui.*.json`.

Tests: `test/unit/agentMapStatus.test.tsx`, `workflowDetails.test.ts`,
`agentOutcome.test.ts` — green. Drill (in-turn): the status tests fail on
the joined text (exit 1), pass on the derived text alone.

Look: `agents-details` before/after in this directory
(`item1-agents-before/after.{light,dark}.png`): before shows the detail
page "Role: explorer · Running · Active" and the transcript row leaking
the raw "Result Ready"; after shows the single derived statuses
("Active"; "Inactive · Ended, Unverified" as the one derived value).

## 2. Anthropic input count (`fdc6249646`)

Every thinking-on request sent `thinking: {type: enabled,
budget_tokens}` to `POST /v1/messages/count_tokens` without `max_tokens`,
which the count endpoint documents `budget_tokens` as requiring and does
not accept: rejected on every request, so the byte bound reserved
instead ("The provider input count failed, so the byte bound reserves
this request instead."). `buildExactCountRequest` now drops manual-mode
`thinking` (configuration, not content); adaptive/disabled/between-tools
and `output_config` stay as documented.

Files: `src/core/providers/tokenCount.ts`, `test/unit/tokenCount.test.ts`.

Tests: `tokenCount.test.ts` — green. Drill (in-turn): the body test fails
with thinking present (exit 1), passes with it dropped.

Live proof (owner PC, key `anthropic-s2`): the exact request is
`POST https://api.anthropic.com/v1/messages/count_tokens` with body keys
`model`, `system`, `messages` only (no `max_tokens`, no `thinking`). Not
run from the rig: provider calls are blocked headless. This record claims
the body fix (proved by test), not the live acceptance.

## 3. exec ready line names the provider (`9d10b7e494`)

exec on an Anthropic provider logged "Model API backend ready
(api.meta.ai/v1, stateless reasoning replay)". The manager's
`modelApiReadyMessage(provider?)` now takes the provider run's id and
origin host and the line names them ("anthropic-s2 via
api.anthropic.com"); without a provider run it names Meta as before.

Files: `src/host/backend/modelApiBackendManager.ts`,
`src/runtime/backends.ts`, `test/unit/modelApiReadyMessage.test.ts`.

Tests: green. Drill (in-turn): the ready-line test fails on the Meta
wording with a provider run (exit 1), passes naming the run.

## 4. No subagent tool in headless exec (`044595af19`)

By design, said plainly: child tasks are paid, headless has no one to
consent, and the agent has no subagents flag — so the built-in
explore/second-opinion agents and custom agents (roles) cannot run
headless. README and `docs/acp.md` say so; `AcpPaidUse` locking test
keeps subagents off with every flag combination.

Files: `README.md`, `docs/acp.md`, `test/unit/acpPaidGrants.test.ts`.

Tests: green (the grant test fails if subagents are admitted, exit 1).

## 5. Frozen provider model lists (`7cd92fd0af`, `7821ed5444`)

A provider's model list froze at `providers add`: exec refused a model
the live list had, and the CLI had no refresh. `providers refresh <id>`
stores every live id the file lacks (filed ids the list lacks stay, and
are reported as still configured); both exec paths admit a live-but-
unfiled model and file it on use, best effort. The list read moves to the
shared `runtime/exec/providerList.ts` (`dist/providerList.js` beside
`dist/headless.js`, budget held). Fixed along the way: `providerModelsPath`
crashed on entries without an address; refresh/test crashed on a down
credential store; `auth status` reads the ChatGPT grant through the
subscriptions entry (D207). A follow-up dedups the two refresh-guard
cases into one table (duplication gate 0.0%).

Files: `src/runtime/exec/providerExec.ts`, `providerList.ts`,
`providerListEntry.ts`, `runExec.ts`, `src/runtime/providersCommands.ts`,
`cliArgs.ts`, `cliOptions.ts`, `cliHelp.ts`, `main.ts`,
`providersModelsCommand.ts`, `configuredProvidersEntry.ts`,
`subscriptionsEntry.ts`, `authCommands.ts`, `src/shared/cliCommands.ts`,
`l10n/en.ts`, `referenceProviders` wording, `l10n/ui.*.json`, bundle
scripts, generated reference; tests `providersRefresh.test.ts`,
`providerRefreshOnUse.test.ts`, `providerExec.test.ts`,
`providersTest.test.ts`, `cliArgs.test.ts`, `helpers/providersCommandHarness.ts`.

Tests: green. Drill (in-turn): the diff/refresh/refresh-on-use tests fail
before (exit 1), pass after; guard tests prove no list read without a key
and a named (not crashing) down-store failure.

Live proof (owner PC): `providers refresh anthropic-s2` against
`GET https://api.anthropic.com/v1/models` (x-api-key, anthropic-version),
then
`exec --model anthropic-s2/claude-haiku-4-5-20251001`. Not run from the
rig: the key is a credential and provider calls are blocked headless.

claude-haiku-5-5 pricing (brief: from Anthropic's published price if
published): verified, no change. Anthropic's pricing page
(`https://platform.claude.com/docs/en/about-claude/pricing`, read
2026-10-22) publishes Haiku 5.5 at $0.10/$0.50 per MTok (input/output)
to 100K tokens, $0.50/$2.50 above, cache read $0.01/$0.05, 5m writes
$0.125/$0.625 — exactly the vendored catalogue row
(`vendor/models-dev/snapshot.json`, providers/anthropic, snapshot
2026-10-17), which is where the price card reads it.

## 6. Panel and CLI key stores (`c3a53ded32`)

The two surfaces share the provider list but keep keys in separate
stores neither can read (the editor's secret storage vs the agent's own
OS credential store entries). Merging stores is not possible, so the
panel says where the key lives: the key row reads "No Key Stored in the
Editor", the Providers section carries the `providerKeysSplitStores`
explainer, and the README says the same.

Files: `src/webview/models/ProvidersSection.tsx`, `src/shared/l10n/en.ts`,
`l10n/ui.*.json`, `README.md`.

Tests: `modelsPanelSchemas/Sections` suites — green.

Look: `models-providers` before/after in this directory
(`item6-providers.{light,dark}.png`).

## 7. auth status vs providers status (`204af47646`)

`auth status` parsed every stored value as an API-key envelope, so a
valid ChatGPT sign-in read "cannot be read; enter the key again" while
`providers status chatgpt` said "signed in". Both now share
`chatGptGrantStatus()` on the grant schema (signed in / expired / not
signed in / grant unreadable with the sign-in remedy); `auth status`
lazy-imports to preserve the bundle split.

Files: `src/runtime/authCommands.ts`,
`src/runtime/chatGptProviderCommands.ts`,
`src/core/providers/subscriptions/chatgpt.ts`,
`test/unit/authCommands.test.ts`.

Tests: green. Drill (in-turn): the grant tests fail on the envelope
parse (exit 1), pass on the shared verdict.

## 8. Effort default Max vs high (`84141ac6dc`)

The CLI's own model/list (captured 1.4.10 fixture) declares default
`max` for muse-spark-1.3 and `high` for 1.2, so the 0.19.0 session
starting at Max was the row's default, not a product choice; code and
pill already honor it. The stale "high is the CLI default" claims
(`DEFAULT_EFFORT` comment, D10's UNVERIFIED note, effort-reader
comments) now say `high` is the standing default where a row lists none,
and a recorded-rows test locks max-for-1.3 / high-for-1.2 /
high-fallback. No visual change (nothing to look at).

Files: `PLAN.md`, `src/core/backends/musecode/MuseCodeHost.ts`,
`src/shared/constants.ts`, `test/unit/museCodeEfforts.test.ts`
(+ `chatgptPlanEffort` coverage).

Tests: green. Drill (in-turn): the rows test fails on high-for-1.3
(exit 1), passes on the recorded defaults.

## 9. Limits of ours (`067d3777ad`, `efed6eb83f`, `7821ed5444`)

Removed under D121/D208 (each removal keeps the person's own stop and
tells them in words; none is a provider's documented limit):

- Report sources: `REPORT_SOURCE_TIMEOUT_MS` was already deleted in
  base (42aec1b0b1); `REPORT_SOURCE_SETTLE_MS` (a handed deadline's
  cancellation waited for the in-flight reader to settle) is deleted by
  067d3777ad — cancellation returns at once, the abort rides the read's
  signal, and the late settlement stays silent. Test:
  `test/unit/reportCancellation.test.ts` (green; drill in-turn, exit 1
  before).
- OS hand-offs: `RESOURCE_HANDOFF_TIMEOUT_MS` (10 s) no longer bounds
  every adapter wait. `handoffResourceFile` takes only a caller deadline
  (`timeoutMs`); the usage-page opener passes its own bound, renamed
  `USAGE_PAGE_OPEN_TIMEOUT_MS`. Clipboard/browser/vault waits end at
  the adapter's exit, its start, or the caller's cancel. Files:
  `src/core/resources/{process,launch,commands}.ts`,
  `src/runtime/main.ts`, `src/shared/constants.ts`. Drill:
  `test/unit/resourceHandoffDeadline.test.ts` (3/3): an explicit
  deadline detaches a slow real adapter (marker absent at resolve, then
  lands — detached, never killed); no deadline waits for the exit; a
  caller cancel ends the wait. Red shown by ignoring the option (exit
  1, marker present), restore, green.
- Screen recording cleanup: `SCREEN_RECORDING_REMOVE_ATTEMPTS`
  deleted; a scanner lock retries until the person's cancel ends the
  wait, and the lock error keeps its kind. `src/core/media/record/
windows.ts`. Drill: `test/unit/windowsRecording.test.ts` (10/10) — a
  lock held past any count still removes (6 attempts); cancel ends the
  wait after one attempt with the lock error. Red shown by restoring
  the count of 3 (exit 1), restore, green.
- Schedules report reader: the snapshot loop's attempt count is gone;
  it re-reads until a list/fires/list triple agrees or the caller
  cancels. Measured un-fireable (100 hammered updates across four
  writers settle inside the first triples; the index lock serializes
  readers into agreement), so the number was dead defense — old and new
  behave identically under all finite churn, and differ only under
  infinite churn (busy after 5 vs wait-for-cancel), which is exactly
  D121(1)'s demand. `src/runtime/reporting/playbookSchedulesInputs.ts`.
  Test: `playbookSchedulesInputs.test.ts` (22/22) gains an agreed-
  snapshot-across-a-concurrent-writer case (stable 5/5 green after a
  first-bump fix; a red-by-contention drill is unobservable by the
  measurement above, recorded here instead of faked).
- Release CI reuse lookup: `LOOKUP_PAGES`/`LOOKUP_TIMEOUT_MS` deleted;
  `findBuild` walks every page to GitHub's short-page end, and the
  lookup waits for the API (the job's own timeout or Ctrl-C stops it)
  instead of falling back to a full rebuild on our 120 s.
  `scripts/release-reuse.mjs`. Drill:
  `test/unit/releaseReusePaging.test.mjs` over recorded ci.yml pages
  (`test/fixtures/rltestdrive/release-reuse/`, captured 2026-10-22,
  receipt with commands and hashes; arrangement stated): pages 1-4
  fetched, none beyond. Red shown by restoring the 3-page cap (exit 1),
  restore, green. The timeout deletion is code-proof (the `signal`
  leaves the one fetch; `findBuild` never took a timeout).

Stays, under D121(4) (decided, not deferred — removal would be wrong,
and no provider documents these as limits):

- `SCHEDULE_FS_RETRY_ATTEMPTS` in `nodeScheduleFs.retry()`: no stop
  reaches lock-free store reads (`store.list` takes no lease signal;
  the ALS check is a no-op without one), so unbounded retry would hang
  silently on a permanent transient-coded error. Removing it needs
  signal threading through `ScheduleFsPort`, the journal, the store and
  every caller — a store-API project, named here for the lead.
- `ORPHAN_SWEEP_ROUNDS`: no stop reaches MCP exit cleanup (serialized
  queue, no cancel); an unbounded kill loop on a respawner would stall
  every later sweep and shutdown. The cap's expiry logs its words.
- `VISIBILITY_TIMEOUT_MS` (publish-registry): expiry warns and the
  release succeeds; removal would turn a slow registry into a CI-timeout
  job failure. npm publishes no visibility SLA (one 19-minute lag
  observed). The bound is the release's own patience, reported in
  words.

## 10. The vault, findable (`a4b06e3ea2`)

A join merge reintroduced the hiding that 6a9f453ee2 deliberately
removed: both vault commands were `when: false` in the palette and the
tab mounted only once the host bound the broker. Now: both commands are
palette-visible (README documents both); the catalog marks them runnable
(the feature stays in-progress in Help); the tab no longer gates on
`vaultOffered`. When no binding can be built, the host answers vault
messages with a synthesized unavailable frame whose reason names the
failure — `switchedOff` (new host-only reason with the settings
sentence), `brokerBlocked`, or `unreachable` — instead of dropping the
message into a spinner with no future. Vault navigation routes to the
tab instead of bouncing to providers, and the person's own Retry
re-arms a failed binding (broker installed or vault re-enabled since).

Files: `package.json`, `src/shared/featureCatalog.ts`,
`src/shared/vaultStatus.ts`, `src/shared/vaultRefusals.ts`,
`src/shared/modelsPanel.ts`, `src/host/models/modelsPanel.ts`,
`src/webview/models/sections.ts`, `panel.tsx`,
`sections/vault/VaultSection.tsx`; tests `manifest.test.ts`,
`modelsSections.test.ts`, `modelsPanelVaultSection.test.tsx`,
`test/unit/vault/vaultBindingFailure.test.tsx` (new).

Drills (each: break, exit 1, restore, green): the palette pin test
updated first (red on the hidden manifest), then the manifest fixed;
the sections test updated first (red on the gate), then the gate
removed; the reason/synthesis test written first (5 failures on the
missing functions), then implemented. Host glue (ensure/retry/route)
is vscode-bound and has no unit seam; it is proven by the real-bundle
look below and the reference/lint/type gates, with the pure mapper
and synthesizer unit-covered.

Look: `models-providers` before/after in this directory
(`item10-panel-before/after.{light,dark}.png`): before shows Providers
and Models navigation only; after adds the Vault tab.

## Gates

Every exit code (recovery rules), final verification runs:

- prettier + eslint on touched files: exit 0
- `npm run typecheck` (host, webview, unit, e2e, integration): exit 0
  (three lane-test `exactOptionalPropertyTypes` errors found and fixed
  first: `83aec74950`)
- `node scripts/check-l10n.mjs`: exit 0 (0 problems)
- `npm run check:reference`: exit 0 (current)
- `npm run check:host-api`: exit 0
- `npm run check:plan`: exit 0
- `npm run check:roadmap`: exit 0 (after adding the internal
  RLTESTDRIVE entry and regenerating)
- `npm run check:catches`: exit 0 (after re-baselining the one
  recording-cleanup identity item 9 changed: `f84cfca176`)
- `npm run duplication`: exit 0
- `npm run cycles`: exit 0
- `npm run deadcode` (knip): exit 0
- `npm run build`: exit 0 (after removing five traffic-harness rows
  item 5's regen committed from a dirty dist: `80f689eefe`)

## Suites

Per-item suites (all green, repo-default timeout): agentMapStatus,
workflowDetails, agentOutcome, tokenCount, modelApiReadyMessage,
authCommands, museCodeEfforts, chatgptPlanEffort, acpPaidGrants,
providerExec, providersRefresh (8), providerRefreshOnUse,
providersTest, cliArgs, modelsPanelSchemas/Sections, chatGpt providers
suites, resourceHandoffDeadline (3), windowsRecording (10),
playbookSchedulesInputs (22), releaseReusePaging (1),
reportCancellation, manifest (40), modelsSections,
modelsPanelVaultSection, vaultBindingFailure (5), vaultStatusCard (17),
vaultStateTable (17).

`vitest related` over all 42 changed source files (`--run`,
`--maxWorkers=3`, repo timeouts): 711 passed, 18 skipped, 7 failed
files / 30 failed tests out of 736 files / 22267 tests. The 30 are
pre-existing rig-environment failures, proved by running the same 7
files on base `0cab9f3233` on this rig: identical 30 failures
(inspectNative 18 — confinement refused; privateDirectory 3,
privateRootLease 2, mediaConvert 1 — parent-dir modes; vsixCompression
2 — pinned zopfli absent; brokerSocketDirectory 3 — rig path depth
over the socket limit; scheduleBackgroundReconcile 1 — `.app` in the
rig path trips the launcher allowlist). Zero lane regressions.
