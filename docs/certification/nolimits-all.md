# Lane NOLIMITSALL certification — every limit setting defaults to no limit

First-result record (what the person sees now → what they will see after this lane).
Design: `0` is none for every setting below, the `hooksMaxRunningCommands = 0`
and `modelApiSessionBudgetUsd = 0` precedent already in the schema. No
provider publishes any of these seven numbers as an API maximum (each checked
below), so every one is ours and goes; set-value ranges stay so a person's
own value still validates.

## The seven settings

- `museSpark.questions.deferAfterSeconds` 60 → 0. Questions wait
  indefinitely until the person sets 10–3600 (1–9 read as 10). The Muse Code
  backend wait takes no deadline at 0 (`deferMuseQuestions`).
- `museSpark.hooksMaxStopContinuations` 8 → 0. Stop hooks keep a finished
  turn going until it ends on its own; a set value stays within Muse Code's
  own 1–8 (`stopContinuationLimitFor`; past 8 warns and the default stands).
- `museSpark.subagentMaxConcurrent` 8 → 0. Subagents start at once; a set
  value stays within 1–64 (`subagentConcurrencyFor`). The spawn description
  names the live bound (`subagentSpawnDescription`).
- `museSpark.modelApiMaxToolOutputBytes` 64000 → 0. No byte guard of ours;
  results pass to the model's window share and line caps alone; a set value
  still cuts with head, tail, counts and a spill file. Headless
  `--max-tool-output-bytes 0` means the same.
- `museSpark.webSearchMaxPerRequest` 5 → 0. No `max_tool_calls` of ours is
  sent and the provider decides; search stays offered where the model's
  record supports it; a set value stays within 1–20 (`webSearchMaxCallsFor`).
- `museSpark.mediaMaxUploadMiB` 200 → 0. Any size admits; the provider and
  the model's own record still refuse; a set MiB still refuses past it
  before any read (`mediaLimitsFromSettings`, `checkMediaLimits`,
  Files upload guard now enforces only an explicitly passed cap).
- `museSpark.screenRecordingMaxSeconds` 120 → 0. Every recorder runs until
  stopped; all four drivers report elapsed while uncapped and skip the
  automatic stop and the duration cap; the macOS and Windows native helpers
  accept 0 as no auto-stop (see platform note below).

## Provider-limit check (brief step 1)

None of the seven is a provider's published, provider-enforced maximum: no
Meta, Anthropic, OpenAI, Gemini, Azure or xAI documentation names a
question-deferral delay, a Stop-hook continuation count, a subagent
concurrency, a tool-result byte guard, a hosted-search count, an attach
size, or a recording length. The set-value ranges that stay (1–8, 1–64,
1–20, 10–600, ≥1024 bytes) are Muse Code's own or this product's, kept as
validation for a person's own value per the brief. The model's own record
still governs where it exists (modality upload/inline bytes, web-search
tool support, model window share).

## Break-once drill (brief step 4)

`test/unit/noDefaultLimits.test.ts` was written before each change and run
against the unmodified code: defer (2 failures), hooks/subagents (4),
tool-output guard (2), web search (3), media pair (2). Each run failed only
on the new-behaviour assertions; the person-set assertions passed throughout.
After each change the same file is green with the repository's own timeout.
No stand-ins: every test drives the real exported function or schema the
production path calls (`questionDeferSeconds`, `readSettings`,
`stopContinuationLimitFor`, `subagentConcurrencyFor`,
`subagentSpawnDescription`, `validateToolResultCap`, `limitsForByteGuard`,
`boundToolResultText`, `webSearchMaxCallsFor`, `checkMediaLimits`,
`mediaLimitsFromSettings`, `screenRecordingOptionsSchema`, `parseExec`).

## Golden re-baseline (D81.1/D86.1)

The spawn description's default pacing is a recorded wire byte, so
`test/fixtures/golden-requests/06-subagent-child.json` and its strict twin
carried `Up to 8 work at once; later ones queue.` with cache keys derived
from it. A temporary vitest script rebuilt both requests with the real
builders only (`subagentSpawnDescription()` for the one pacing sentence,
`promptCacheKey()` for each derived key) and replaced those bytes in place;
a first pass doubled the description, caught by `invariants.test.ts`, and a
repair pass set the exact builder text. Final diff per file: 2 request lines
(the two parent requests), differing only in the pacing sentence and the two
derived `prompt_cache_key` values; the child request is untouched. Verified
with a region diff and `test/unit/invariants.test.ts` 42/42 green. The
temporary scripts were deleted, not committed.

## Platform verification owed (native recording helpers)

`native/darwin/ScreenRecord.swift` and
`native/windows/MuseSparkScreenRecord.cs` accept `0` as no auto-stop
(validation, deadline/watchdog, writer/sample caps, clock display; the
Swift `screencapture` fallback omits `-V` at 0). Neither helper can build
or run on this Linux rig: the lead owns a macOS recording run and a Windows
recording run through the packed product before these paths are claimed.
The TS drivers, panel, companion and schema are unit-tested here; no live
recording was run on any OS in this lane.

## Pre-existing failures (not this lane)

- `test/unit/filesCancel.test.ts` → `ledger cleanup deletes with the caller
signal` fails on this rig on the pristine tree too (verified in a clean
  worktree at the setting-4 commit, same single failure): the upload-ledger
  code it covers is untouched by this lane. Left for its owner.
- Repo lint (`npm run lint`): 3 errors in
  `test/unit/estimateComposer.test.ts` / `test/unit/estimateSession.test.ts`
  (`no-unsafe-argument`), byte-identical on the untouched lane-base tree
  (7734923040). Untouched by this lane.
- Unit/e2e typecheck: 19 errors (estimate*, modelApiPacing, teamConstants,
  vendorMediaCodecs, runtimePullRequestProcessBirth), counted identical on
  the untouched lane-base tree. Host, webview and integration typechecks are
  green. Untouched by this lane.
- `npm run check:plan`: stops — PLAN.md is 3,808,659 bytes, over 85% of the
  plan reader's bound, with zero lines added by this lane. Archiving is
  another lane's job; not worked around.
- `npm run build`: stops at the What's New bound — the 0.19.0 notes decode
  to 326,287 bytes against a 76,800 bound. This lane added 1,426 bytes to
  CHANGELOG.md; the 4x overage predates it. Not worked around. Bundle-size,
  bundle-split and later build steps therefore did not run in this lane.

## Final gate states (this lane)

- `npm run format:check`: green (whole repo).
- Repo eslint on every file this lane touched: zero warnings; `npm run lint`
  as a whole is red only on the pre-existing errors above.
- `npm run check:l10n`: 0 problems. `npm run check:reference`: current.
- Touched suites, repository's own timeout, no `--testTimeout`: 396 tests
  green across 17 files (noDefaultLimits, questionManifest,
  questionContracts, museCodeLatest, invariants, modelApiLoopContracts,
  modelApiCaptures, toolResultBound, execArgs, mediaContracts,
  mediaSniffMalformed, acpMediaPort, manifest, recordingLatest,
  workspaceMediaSource, resolveLatestRecording, vendorMediaCodecs).

## Sweep verdicts (brief step 5)

Every `package.json` setting and every `src/shared/constants.ts` constant
(plus matching constants in other `src/` files) whose name says Max, Limit,
Cap, Timeout, Deadline, Seconds or Budget, triaged against "stops or trims
something a person asked for". Verdicts: provider-published (kept, source
cited), person-set (kept), ours-kept (kept with reason, needs-staying per
D121 outcome 4), ours-fixed (this lane). NOGOVLIMITS-owned resource-governor
settings were not touched.

### package.json settings

- person-set, already none by default: `hooksMaxRunningCommands` (0),
  `modelApiSessionBudgetUsd` (0), `paidDailyBudgetUsd` (0),
  `tabDailyBudgetUsd` (0), `modelApiMaxRetries` (null = providers'
  documented maxima), `resourceGpuMaxPercent` / `resourceDiskBusyMaxPercent`
  (null = no probe until configured).
- person-set, settled by earlier D121 lanes (unchanged): `--max-requests`
  default 30 per A8 (the person's own per-run choice), check
  `timeoutSeconds` default 300 per A26.
- NOGOVLIMITS-owned (untouched): `resourceCpuMaxPercent` (85),
  `resourceMemoryMaxPercent` (90); `resourceGovernor` itself.
- ours-fixed this lane: the seven above.
- person-set (setting exists, default kept): `mediaUploadExpiryDays`
  (7, 1–30; lifecycle, not a work cap).

### Provider-published (kept, cited)

- `ANTHROPIC_MAX_IMAGE_BYTES` = 10_000_000 — Anthropic's documented 10 MB
  image limit (`docs/certification/m95-research.md` §1.5).
- `MAX_DOCUMENT_BYTES` = 32_000_000, inline/document media bounds —
  Meta's documented PDF/inline limits (D85).
- `GIT_PATH_MAX_WINDOWS/DARWIN/DEFAULT` (260/1024/4096), Windows command
  8191 (`HOOK_WINDOWS_COMMAND_MAX_CHARS`, `RUNNER_WINDOWS_COMMAND_MAX_CHARS`),
  `RUNNER_PORT_MAX` 65535, DNS `BROWSER_CHECK_HOST_MAX_CHARS` 253,
  `COMPANION_VOICE_PCM_MAX/MIN` (±int16), `WEB_TOTP_PERIOD_SECONDS` = 30
  (TOTP standard), `NODE_MAX_TIMER_MS` (2^31−1, platform fact per A26) —
  OS/protocol/platform facts, not ours.
- `MODEL_API_MAX_OUTPUT_TOKENS`, per-model output/recommended caps —
  the models' own policy caps, carried into requests, never raised locally.

### Set-value ranges kept for the seven (brief step 3)

`HOOK_STOP_CONTINUATIONS_MIN/MAX` (1–8), `SUBAGENT_CONCURRENT_MIN/MAX`
(1–64), `WEB_SEARCH_MIN_PER_REQUEST/_LIMIT` (1–20),
`QUESTION_DEFER_MIN/MAX_SECONDS` (10–3600),
`SCREEN_RECORDING_MIN/MAX_SECONDS` (10–600), `TOOL_RESULT_MIN_BYTES`
(1024), unbounded `mediaMaxUploadMiB` — validation for a person's own
value only; none applies with nothing set.

### Ours, loop/retry protection (kept, listed for the lead)

These stop a runaway rather than trim asked-for work; removing any of them
without a replacement risks unbounded billed loops:
`MODEL_API_MAX_TOOL_ROUNDS` (200/turn, replaceable by a caller allowance),
`TOOL_REPEAT_LIMIT` (3 identical results), `MODEL_API_CONTINUATIONS_MAX`
(1 output-limit continuation), `SUBAGENT_TASK_MAX_REQUESTS` (4; also the
paid-consent pricing basis), `HOOK_MAX_TASK_REFUSALS` /
`TEAMMATE_MAX_IDLE_KEEPS` (8), `STRUCTURED_OUTPUT_REPAIRS_MAX` (1),
`PLAYBOOK_PATCH_ROUNDS_MAX` (2), `TEAM_REVIEW_ROUNDS_MAX` (3),
`PIPELINE_MAX_ROUNDS` (3), `TEAM_MAX_REASSIGNMENTS` (2),
hook/command timeouts that end a hung child (`HOOK_DEFAULT/MAX_TIMEOUT_SECONDS`,
`HOOK_MODEL_TIMEOUT_MS`, `HOOK_SESSION_END_TIMEOUT_MS`,
`SHELL_DEFAULT_TIMEOUT_MS` with per-command control, `HOOK_MATCHER_*_TIMEOUT_MS`,
`PLUGIN_*_TIMEOUT_MS`, `MCP_ELICITATION_TIMEOUT_MS`).

### Ours, request-validity / memory-safety / wire shape (kept, listed)

- Tool-result backstops that stay behind the removed byte guard:
  `TOOL_OUTPUT_MAX_CHARS` (64_000 fallback + display clippings),
  `TOOL_RESULT_MAX_TOKENS` (16_000, follows the guard up),
  `TOOL_RESULT_MAX_LINE_CHARS` (8000, megabyte lines measured fatal),
  `TOOL_RESULT_SPILL_MAX_AGE_DAYS` (30-day prune), `TOOL_OUTPUT_CLIP_MARKER`.
- Media pipeline: `MEDIA_SNIFF_MAX_BYTES`, `MEDIA_CONVERTER_*`
  (probe/trust/sample timeouts, RSS caps, `MEDIA_CONVERSION_MAX_RSS_BYTES`,
  `MEDIA_CONVERSION_DEFAULT_OUTPUT_BYTES`), `MEDIA_MAX_UPLOAD_MIB` (1024
  companion/conversion bound), `MEDIA_FILE_ID_MIN_BYTES`,
  `MEDIA_PENDING_DELETE_RETRY_MAX_*`, `MEDIA_ATTACHED_MAX_ENTRIES`,
  `MEDIA_CALIBRATION_*`, `MEDIA_RSS_*`, expiry min/max,
  `MEDIA_CONVERTER_PATH_MAX_CHARS`.
- Images: `MAX_IMAGE_BYTES` (10 MiB attach bound), `IMAGE_RESIZE_*`
  (memory/pixel operational bounds), `IMAGE_EDIT_SOURCE_MAX` (10: kept
  pending provider research — Meta documents 1–10 edit items per A24).
- Message batching: `MAX_ATTACHMENTS_PER_MESSAGE` (20: kept pending
  provider research), `MAX_TEXT_ATTACHMENT_BYTES` (1 MiB),
  `MAX_ENCODED_MEDIA_CHARS`, `ACP_MAX_MESSAGE_BYTES` (transport),
  `MAX_ATTACHMENT_BASE64_CHARS`, `MAX_DOCUMENT_BYTES` (above).
- Fetch (untrusted network input, fail-closed): `WEB_FETCH_MAX_CONTENT_CHARS`
  (50_000), `WEB_FETCH_CONVERT_*`, `WEB_FETCH_DETAIL/TOKEN/URL_MAX_CHARS`,
  `LOOPBACK_FETCH_MAX_BODY_BYTES`, `LINK_FOLLOW_MAX_HOPS` (40).
- Search/code-intel (own-tool paging against provider windows):
  `SEARCH_MAX_RESULTS/HITS/CANDIDATES/FILE_BYTES/PATTERN`, `SEARCH_TIMEOUT_MS`,
  `CODE_INTEL_*`, `REPO_MAP_*` + time budgets, `MENTION_*`, `GLOB_*`,
  `LIST_FILES_DEFAULT_LIMIT` / `READ_FILE_DEFAULT_LIMIT` /
  `MEMORY_READ_DEFAULT_LIMIT` (page defaults; more is pageable),
  `JUDGE_*` (internal eval), `REVIEW_*` (review feature bounds),
  `GIT_*`/`CHECKPOINT_*`/`GOAL_*`/`PLAN_*`/`MEMORY_*`/`SESSION_*` (state
  paging), `PLAYBOOK_*` (journal bounds), `AGENT_*`/`SKILL_*`/`RULES_*`
  file bytes (context-window packing), `AGENT_IMPORT_*`,
  `TEAM_*`/`RUNNER_*` (orchestrator internals; person-settable caps arrive
  with the app surfaces per the standing Limits rule — lead's call),
  `COMPANION_VOICE_*` incl. `COMPANION_VOICE_MAX_SECONDS` (60: voice
  protocol + paid-consent redesign needed; feature held off per CMICCOMP),
  `TAB_*` (Tab's own ledger/rate design, D73), `BROWSER_CHECK_*` /
  `BROWSER_RUNTIME_*` / `BROWSER_PROXY_*` (check sandbox),
  `HOOK_*` matchers/handlers/env/nesting (hook sandbox shape),
  `PLUGIN_*` heap/memory/response, `ACCOUNT_*`/`OAUTH_*`/`GITHUB_*`/
  `GH_AUTH_*`/`PULL_REQUEST_*`/`COMMIT_*` (remote protocol),
  `VAULT_*`, `WORKTREE_*`, `PROCESS_*`, `HELD_*`, `NAT64_*`, `CHATGPT_*`,
  `JUDGE_FAST_*`, `SECURE_*`, `SLOT_*`, `HTTP_SUCCESS_MAX`,
  `TOOL_SCHEMA_MAX_DEPTH`/`TOOL_FILE_MAX_MIB` (grammar/request validity),
  `TOOL_ARGUMENT_PREVIEW_*`, `BACKGROUND_NOTICE_KEYS_MAX`,
  `SESSION_BUDGET_MIN_BYTES_PER_TOKEN`, `MODEL_API_TEXT_BUDGET_TOKENS`,
  `MODEL_API_RETRY/TIMER/STATUS/REQUEST_*` (client liveness),
  `MODEL_API_TIMER_MAX_MS`, `PROVIDER_*` (pricing/decimals/thinking),
  `MANUAL_THINKING_*`, `RESOURCE_*` sampler/journal/history (telemetry;
  governor itself is NOGOVLIMITS'), `COMPOSER_MAX_ROWS`,
  `WHATS_NEW_CONTENT_*`, `GOAL_PERCENT_MAX`, `OPEN_QUESTIONS_MAX` (20) /
  `QUESTION_REMINDERS_MAX` (2) / `QUESTION_ID/LATE_ANSWER_*_CHARS`
  (attention-dock state shape), `RECAP_SETTLE_TIMEOUT_MS`,
  `MUSE_CODE_REVIEW_TIMEOUT_MS`, `PROVIDER_IMPORT_MAX_BYTES`,
  `LOCAL_PROBE_TIMEOUT_MS`, `WEB_FETCH_TIMEOUT_MS`,
  `IMAGE_RESIZE_TIMEOUT_MS`, `ACCOUNT_REMOTE_LIMIT_DEFAULT_MS`,
  `OAUTH_LOOPBACK_TIMEOUT_MS`.
- `HOOK_MAX_RUNNING_COMMANDS` (4): fallback where no settings dep is wired;
  the `hooksMaxRunningCommands` setting (default 0) governs everywhere wired.
- `SHELL_PACKED_MAX_CHARS`, `GIT_OUTPUT_MAX_BYTES`, `GIT_STDERR_MAX_CHARS`,
  `HOOK_STDIN/OUTPUT_MAX_BYTES`, `HOOK_*_MAX_CHARS` (ids/labels/prompts),
  `REVIEW_*_MAX_CHARS`, `TEAM_*_MAX_CHARS`, `PLAN_*_MAX_CHARS`,
  `RESOURCE_ID/STATUS/NONCE_MAX_*` — wire/display/memory shape, none caps
  person work.
- Timeouts throughout (`*_TIMEOUT_MS`, `*_MS` deadlines, `RECENT_MAX_AGE_MS`,
  `STALL_RATE_LIMIT_MS`, `*_EXPIRY_*` windows, `*_COOLDOWN/INTERVAL_*`,
  `*_PER_MINUTE`, `IN_FLIGHT`) bound waits and polling, never content.

No other default of the same kind was found: every remaining Max/Limit/Cap/
Timeout/Deadline/Seconds/Budget either comes from a provider's published
limit, is set by the person (or null/unset by default), validates a person's
own value, or guards protocol/memory/loop liveness as listed above.

# Lane NOLIMITSRUN certification — the model loop runs until done or stopped

Branch `fix/0190-nolimitsrun` (continues `fix/0190-no-default-limits`),
seven commits, one per limit below. Each limit is removed at its cause per
PLAN.md D121 (outcome 1: not about a model → the constant, its checks, its
refusal text and its docs go). Removing a stop never leaves a silent hang:
the person is told in plain words what is happening while the work keeps
going until they stop it, and Stop always works. Per-person and per-model
explicit values still bind. Tests drive real code with no stand-ins, each
shown failing on the code before its change (break-once drill), then green
with the repository's own timeout (never `--testTimeout`).

## Each limit, its replacement, its proof

- Tool rounds (`MODEL_API_MAX_TOOL_ROUNDS` 200/turn + caller-allowance
  default). Replaced with: `modelCallLimit = callerModelCallsLeft() ??
Infinity`; the running round count rides the existing narration (tool
  rows, notices, per-request `tokenUsage`) on the panel, terminal and ACP.
  Proof: `test/unit/noRoundCap.test.ts` + `scripts/check-no-round-cap.mjs`
  (`check:no-round-cap` gate in `quality:gates`) fail on a reintroduced
  round constant and pass without one; lane suites green (counts below).
- Output continuations (`MODEL_API_CONTINUATIONS_MAX` 1). Replaced with: a
  `modelApiContinuing (part {count})` notice each round while the model is
  mid-answer. Proof: `test/unit/noOutputContinuationCap.test.ts` +
  `scripts/check-no-output-continuation-cap.mjs` (`check:no-output-cap`
  gate) fail on a reintroduced continuation constant, pass without one.
- Repeat guard (`TOOL_REPEAT_LIMIT` 3). Replaced with:
  `RepeatGuard.before()` returning `'run' | {repeat: N}`, always running,
  with a `modelApiToolRepeating {tool} {count}` info notice. Proof:
  `test/unit/repeatGuard.test.ts` green; the new-behaviour assertions
  (repeat runs with notice, never stops) failed before the change.
- Structured-output repairs (`STRUCTURED_OUTPUT_REPAIRS_MAX` 1). Replaced
  with a `for(;;)` repair loop emitting `structuredOutputRepair {count}` /
  `structuredOutputRetry {count}` notices per round; abort and terminal
  errors still end it. Proof: `noModelLoopLimits.test.ts` repair cases
  failed on the one-repair code, green after.
- Subagent requests (`SUBAGENT_TASK_MAX_REQUESTS` 4). Replaced with: no
  `remainingAttempts`/`attemptLimit` on the grant, no `requestLimit`
  refusal; `subagentTaskPrice(modelId)` prices from the model rates with
  "billed per request until ends/stopped" (`SUBAGENT_PRICE_ACCEPTANCE_VERSION`
  bumped to `2026-10-19:unbounded:v1`). Proof: `noModelLoopLimits.test.ts`
  subagent cases (unbounded run, live per-request pricing, Stop ends it)
  failed on the capped code, green after.
- Shell/hook timeouts (`SHELL_DEFAULT_TIMEOUT_MS`,
  `HOOK_DEFAULT_TIMEOUT_SECONDS`, `HOOK_MODEL_TIMEOUT_MS`,
  `HOOK_SESSION_END_TIMEOUT_MS`). Replaced with: `timeoutSeconds?` /
  `timeoutMs?` optional, `undefined` means run until it ends or is stopped,
  with running time shown (`streamRepairAttempt(..., timeoutMs|undefined)`,
  SessionEnd close waits with a log line). A timeout someone sets still
  works; only validating bounds stay (`HOOK_MAX_TIMEOUT_SECONDS` 600 s
  ceiling, `TOOL_RESULT_MIN_BYTES` floor, `SHELL_MAX_TIMEOUT_MS` for
  media). Proof: `test/unit/shellNoDeadline.test.ts` (unnamed run waits,
  named timeout kills, past-one-timer-range waits whole) and
  `test/unit/elicitationHookSeam.test.ts` failed on default-deadline code,
  green after.
- Tool-result trim (`TOOL_RESULT_MAX_TOKENS` 16,000,
  `TOOL_RESULT_MAX_LINE_CHARS` 8,000, `TOOL_OUTPUT_MAX_CHARS` 64,000
  fallback). Replaced with: the result reaches the model whole; only a
  byte guard the person set or the window share cuts, with a spill file
  under `.muse-spark/tool-results/` and a notice naming how much, which
  head/tail and how to read more. Read, search, list, vault, MCP text,
  IDE-external, browser-check, memory-note and `then_run` outcomes no
  longer clip at our 64 KiB; rows and the panel keep their display clip.
  Proof: `test/unit/toolResultBound.test.ts` (36: sums, surrogate, CRLF
  byte-exact, window-share guarantee, spill notices) and the new
  `test/unit/toolResultsRideWhole.test.ts` (6: MCP text/error past 64 KiB
  whole, browser report whole, kept-whole shell outcome with exit line and
  elided row, memory window whole with line-only paging) — 4 of the 6
  failed before the change; `test/unit/noDefaultLimits.test.ts` and
  `test/unit/execArgs.test.ts` updated to the two-argument
  `validateToolResultCap` (no fallback of ours).

## Suites run (repository's own timeout, `--maxWorkers=3`)

- `toolResultBound` (36) + `noDefaultLimits` (15) + `toolResultsRideWhole`
  (6): 57 green.
- `noModelLoopLimits` + `memoryIo` + `shellNoDeadline`: 24 green.
- `browserCheckNoCaps` + `importHookSources` + `modelapiChatCodec`: 178
  green.
- `responsesCodec` + `execArgs` + `diagnosticsReport`: 130 green.
- `noModelLoopLimits` + `noOutputContinuationCap` + `noRoundCap`: 19 green.
- `noRoundCap` + `noOutputContinuationCap` + `toolRoundsWrapUpGuard` through
  the shared `describeSourceGuard` drill: 12 green (dedupe keeps the gate at
  its base 13 pre-existing vault clones; this lane adds none).
- `repeatGuard` + `elicitationHookSeam` + `execArgs`: 89 green.
- `node scripts/check-l10n.mjs`: 0 problems. `npm run check:reference`:
  current. Repo eslint on every file this lane touched: zero errors.
- Host typecheck: green. Unit typecheck: 19 errors, all in files this lane
  never touched (estimate*, modelApiPacing, teamConstants,
  vendorMediaCodecs, runtimePullRequestProcessBirth) — pre-existing, left
  for their owners (the one `execArgs.test.ts` error this lane's signature
  change caused was fixed in the same change).

## Kept bounds, listed for the lead (D121 outcome 4)

The read/search/list paging contracts (limits the model sets, honest
continuation notices), `readFileCharacterBudget` (window-derived from the
capability record's `contextTokens` when known; its unknown-window 64 KiB
branch is ours), the verify-note budget `VERIFY_NOTE_MAX_CHARS` with
per-check shares (M68/D27 design: beginning, end and exit line kept),
`SEARCH_*`/`GLOB_*` engine bounds and the hit/pattern validity refusals
(search tool contract), hook input preview bounds
(`HOOK_TOOL_OUTPUT_PREVIEW_CHARS`, hook contract — the 64 KiB elide on the
hook path was left because hooks never see more than the preview anyway),
and every display/row/panel clip (they hide nothing from the model or the
saved record).
