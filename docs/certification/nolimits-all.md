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

---

# Lane NOLIMITSTEAM — team, playbook, pipeline and hook round limits

Branch `fix/0190-nolimitsteam`. The lead's brief decides the six limits below
go, plus any other `TEAM_*` / `RUNNER_*` / `PLAYBOOK_*` constant that stops or
trims work a person asked for. Design, here as in NOLIMITSALL: a number no
provider publishes is ours and goes; rounds continue until the work converges
or the person stops it; removing a stop never leaves a silent hang — every
continued round names its round and why it runs, and Stop still ends it.
Journal and state paging that never stops work stays, named below with why.
No PLAN.md lines are added by this lane, per the D121 record rule quoted at
the top of that decision's list.

## The six removals (what replaced each)

- `TEAM_REVIEW_ROUNDS_MAX` (3) — removed from `src/shared/constants.ts`. The
  scheduler review flow (`src/core/team/scheduler/reviewFlow.ts`) repeats a
  failing review until it is clean instead of diverting to `redesign` at the
  third round; the round count stays on the task's `reviewRounds` (the schema
  bound in `src/shared/team.ts` goes with it) so the panel keeps showing the
  round. The `redesign` outcome and the orchestrator's `redesign`
  implementation stay as the person-dispatched redesign seam — only the
  count trigger goes. The model text (`TEAM_MODEL_TEXT.integration`) now says
  rounds continue until the change passes or the person stops the work, with
  each failing round reporting its findings and the ones that came back.
- `PIPELINE_MAX_ROUNDS` (3) — removed from `src/core/team/pipelines.ts`
  (where it lived as a local bound). `recordStepResult` repeats a failing
  round with its round, its findings and its recurring findings instead of
  stopping at `redesign`; the run stays `running` until `handoff`. The
  `maxRounds` key is gone from definitions, the narrowing schema and both key
  sets: files that still name it are refused with `unknownKey` naming
  `maxRounds`, never silently accepted. The removed total ceiling
  (`pipelineCeiling`) goes with it; per-step approval data stays.
- `TEAM_MAX_REASSIGNMENTS` (2) — removed from `src/shared/constants.ts`.
  Stall recovery (`src/core/team/scheduler/stalls.ts`) reassigns until the
  work converges unless the stall policy says `ask` or `stop`; the board
  (`src/core/team/scheduler/board.ts`) opens the next attempt the same way.
  The `thirdStall` block reason goes with the bound; `reassignments` keeps
  counting on the task for the panel. `diverging` still blocks on detection
  (runaway protection, visible with its reason).
- `PLAYBOOK_PATCH_ROUNDS_MAX` (2) — removed from `src/shared/constants.ts`.
  `patchRoundsMax` stays as the person's own setting with a new default of
  `0` (unlimited) and no ceiling of ours (`z.gte(0)` in both
  `src/shared/playbook.ts` and `src/runtime/playbook/command.ts`). A set
  number still forces the design decision and the redesign lane past it
  (`isPatchRoundsExceeded`, read by the policy's three strike sites). The
  panel takes the number directly and reports a bad value in words (the
  previously unread `playbookPatchRoundsInvalid` now reads on a failed
  parse); the CLI/ACP grammar takes `0`; the `orchestrator-playbook` skill
  teaches the new rule; English plus all fourteen locales updated.
- `HOOK_MAX_TASK_REFUSALS` (8) — removed from `src/shared/constants.ts`. A
  refused task write in `ModelApiHost` still answers with its error words to
  the model and the person; the warn line naming the removed limit and the
  commit-time `HookStoppedError` go with the bound, so refusals never end the
  turn on their own.
- `TEAMMATE_MAX_IDLE_KEEPS` (8) — removed from `src/shared/constants.ts`. A
  hook may keep an idle teammate working for as many rounds as the work
  needs; every keep still emits its `hookTeammateKept` notice, and the grant,
  the hook verdict, the remaining attempts and Stop still end the keeps. The
  keep counter goes with the bound.

## Proof

`test/unit/noRoundLimits.test.ts` (new) drives the real code with plain data:
pipelines repeat past the old stop with round, findings and recurring
findings; the board schema parses past the old ceilings; fresh playbook
settings default to unlimited and take `0` and `50`; `redesignBlock` with no
number set leaves a fifth strike alone while a set `2` still forces the
redesign path; the CLI/ACP grammar takes `0`; a handed-off run still refuses
further records. Break-once drill: 9 of the 11 failed on the unmodified code
(the person-set and terminal-run cases passed throughout, as kept behavior
should). Three file-loading cases then moved to `teamPipelines.test.ts`,
where the same behavior is covered durably, leaving 8 focused cases here —
all green after, with the repository's own timeout and no `--testTimeout`. The two host removals have no unit test: driving
`ModelApiHost` needs stand-ins for the host, hook and model seams, which the
no-fakes rule forbids — the proof there is the removal at the cause (above),
the related suites below, and real use of the packed product. The obsolete
`museCodeLatest` bound echo and the `teamSchedulerSchemas` / `teamPipelines`
ceiling assertions were updated to the new contract, with the reason in each
commit.

## Round-and-why display (orchestrator, panel, terminal)

- Orchestrator data: pipeline `repeat` decisions carry `round`, `findings`
  and `recurring`; review rounds are recorded per round through the review
  dependencies; stall handoffs carry the reason and the shortened history;
  playbook allow/refuse notes carry the round.
- Panel: the strike badge counts review rounds, the traffic details keep the
  `Review Rounds After the First` and `Reassignments` metrics, and the
  playbook settings page states the `0` = unlimited rule with its reason.
- Terminal: `playbook status|record|settings` renders rounds, notes and
  settings; every hook keep and every refused task write prints its own
  words; pipeline narrowing/definition refusals name `maxRounds`.

## Other TEAM_* / RUNNER_* / PLAYBOOK_* triage (this lane)

Removed above: the six. Everything else stays, for these reasons:

- Journal paging that protects evidence: `PLAYBOOK_RECORD_MAX` (5000) —
  `retainRecords` evicts oldest informational notes first and stops only when
  mandatory safety evidence alone fills the bound, instead of silently
  resetting it.
- State shape and persisted-schema bounds: `TEAM_SCHED_HISTORY_MAX` (256
  attempts/events/leases), `TEAM_BOARD_MAX` (64 live tasks, visible
  `boardFull` refusal), `TEAM_WRITE_SET_MAX` (256), `task_ids`/`depends_on`
  lengths, `TEAM_SCHED_ID/TEXT_MAX_CHARS`, `TEAM_ROLE_*` shape bounds,
  `RUNNER_CONFIG_MAX`/`RUNNER_LABELS_MAX` (32), `RUNNER_MAX_JOBS` (64, runner
  health shape), `TEAM_ROLE_DELEGATES_MAX` (8), `PLAYBOOK_DRIFT_NAMES_MAX`
  (5, display trim), `TEAM_MERGE_DETAILS_SHOWN` (10, display),
  `*_MAX_CHARS`/`*_MAX_BYTES` wire and memory shapes.
- Context packing that never refuses work: `TEAM_HANDOFF_TOOL_CALLS` (20,
  last calls), `TEAM_SCHED_TEXT_MAX_CHARS` (8000, handoff slices),
  `TEAM_MERGE_BATCH_MAX` (4, merge batching).
- Loop and retry protection where the failure stays visible:
  `TEAM_DIVERGE_REPEATS` (3, identical-rewrite detection;
  `TEAM_DIVERGE_SIZE_FACTOR` classifies, the block names `diverging`),
  `TEAM_MERGE_FLAKE_RETRIES` (1, then failures return for rework),
  `CHECK_FIX_MAX_ROUNDS` (out of this lane's name scope; verify-loop bound
  with its own notice).
- Detection timing, not caps: `TEAM_STALL_MS`, `TEAM_STALL_RATE_LIMIT_MS`,
  `TEAM_AGING/STARVATION/SCHED_TICK/RETIRE_WAIT/START_STAGGER/DIFF_POLL_MS`,
  `TEAM_HEAVY_COMMAND_SECONDS` (routing threshold),
  `RUNNER_CONNECT/HEALTH/SELFTEST_TIMEOUT_MS`, `RUNNER_WINDOWS_COMMAND_MAX_CHARS`
  and `RUNNER_PORT_MAX` (OS facts), `TEAM_TREE_TYPEAHEAD_MS`,
  `TEAM_UNMERGED_NOTICE_DAYS`.
- Estimates, weights and capability floors, not caps: `TEAM_PRIORITY_WEIGHTS`,
  `TEAM_SIZE_MINUTES`/`TEAM_SIZE_TOKEN_FACTORS`, `TEAM_BLAST_WEIGHTS`,
  `TEAM_ROLE_MIN/RECOMMENDED_CONTEXT_TOKENS`, `TEAM_MODEL_TEXT` guidance.
- Safety windows and vocab: `PLAYBOOK_LAUNDER_WINDOW_MS` (one hour),
  `PLAYBOOK_*` similarity/fingerprint/hash constants, hook names, finding
  classes, rule ids, resolutions, record folder, bundle file.

## Pre-existing failures (not this lane, measured same as NOLIMITSALL)

- Unit typecheck: 19 errors, file-for-file the set NOLIMITSALL recorded on
  the untouched tree (estimate*, modelApiPacing, teamConstants,
  vendorMediaCodecs, runtimePullRequestProcessBirth); host, webview and
  integration typechecks green; e2e shows the same shared-helper error.
  None in a file this lane touched.
- `teamConstants` runtime: `TEAM_META_CONTRIBUTOR_RPM` is 150 in the source
  but the test expects 100 — proven present at the lane base (`git show
341a9424d3` on both files), so provider drift with a stale test, not this
  lane. The file's typecheck error (`TEAM_MUSE_CODE_HOST_CEILING`) is the
  same pre-existing drift. Left for the lead; 37 of the file's 38 tests pass.
- `npm run check:catches`: fails on media/record and CompanionMedia
  SWALLOW/GENERIC sites last touched by NOLIMITSALL's own media commit
  (`868acba8cd`, in this lane's base); none of this lane's commits touches
  those files. Left for its owner — regenerating the baseline here would
  mask another lane's drift.
- `npm run check:plan`: stops — PLAN.md is over 85% of the plan reader's
  bound with zero lines added by this lane. Not worked around.
- `npm run build` (and `build:dev`): stops at the What's New bound (328199
  bytes over a 76800 bound; the six CHANGELOG lines add ~1.6 KB to a file
  already 4x over); bundle-size, bundle-split and later build steps
  therefore did not run in this lane. Not worked around.
- `npm run duplication` (jscpd, threshold 0): red on the untouched base (13
  clones, vault and helper files) and red with the byte-identical clone
  list on this lane — this lane adds none (two added clones were removed
  before finishing). Measured by archiving the base tree and diffing the
  clone reports.

## Final gate states (this lane)

- `npm run format:check`: green. Repo eslint on every file this lane
  touched: zero warnings (`--max-warnings=0`).
- `npm run check:l10n`: 0 problems. `npm run check:reference`: current.
  `npm run check:host-api`: 0 problems. `npm run cycles`: no cycles.
  `npm run deadcode` (knip): exit 0.
- Touched suites, repository's own timeout, no `--testTimeout`, at most 3
  files per run: noRoundLimits, teamPipelines, teamSchedulerSchemas (58);
  museCodeLatest, teamConstants, trafficMetrics (88, 1 pre-existing RPM
  failure above); teamProtocolLoading, teamReviewGate, reviewFindings (34);
  playbookSurface, collect.playbook, reportPlaybookSchedules (34);
  playbookSchedulesInputs, playbookReportSource, runtimeCatchHandlers (74);
  modelApiLoopContracts, modelApiCaptures, invariants (52);
  toolRoundsWrapUpGuard, questionManifest, manifest (46). 386 run, 385
  green; the single failure is the pre-existing drift above.
- SAST (`security:sast` in the sandbox): 0 findings. `security:audit`:
  exit 0 (2 advisories covered by `.github/audit-exceptions.json`).
- Real use: the repo packager is stopped by the pre-existing What's New
  bound above, so no `dist/` bundle exists to run. Instead the real
  journal-backed playbook surface (the same factories the `playbook` CLI
  calls: `parsePlaybookCommand` → `runPlaybookCli` → file journal → text
  renderer, bundled with the repo's own esbuild) was driven in a scratch
  workspace with an isolated `XDG_DATA_HOME` — no backend, no model, no
  spend. Person's steps and what they see:
  - `playbook status` in a fresh workspace: `Fix Rounds Before Redesign: 0`
    under the renamed `Redesign After Fix Rounds (threeStrikes): On`, exit 0.
  - `playbook settings patchRoundsMax 5`: saved, settings show `5`, exit 0.
  - `playbook settings patchRoundsMax 9`: saved, settings show `9`, exit 0 —
    the old code refused anything over 2.
  - `playbook settings patchRoundsMax 0`: saved, settings show `0`, exit 0.
  - `playbook settings patchRoundsMax -1`: usage text on stderr, exit 2.
  - `playbook record`: renders the journaled settings changes with the new
    words, exit 0.
  - The panel's number input and the staged pipeline/review/stall/host
    paths have no runner in this sandbox (no `dist/`, no browser, and the
    host paths need a model): proven by the unit tests above, panel review
    by the lead. The scratch bundle and data were removed afterwards.

## NOLIMITSINPUT (lane fix/0190-no-default-limits, 2026-10-19): attachments, media and fetch reach the model whole

Resolves this record's "kept pending provider research" items: the
20-attachment count, the 10 MiB image bound, the 1 MiB text bound, the 32 MB
document bound, the 64-entry attached registry, the 50,000-char page slice
and converter bound, and the 10-edit-source cap.

Provider research (dev.meta.ai/docs, read 2026-10-19; captures kept under
the lane's notes, pages refetched live for the fixture below):

- image-understanding: "Max file size per image (inline image_url) 50 MB
  (50,000,000 bytes)"; "You can include up to 50 images; more than 50
  returns HTTP 400 ('request contains <n> images, exceeding the maximum of
  50 allowed per request')".
- file-handling: "Limited to the 50 MB inline limit"; PDFs contribute text
  from the first 100 pages and at most the first 50 page-images toward the
  50/request budget.
- image-generation error catalog: "an edit needs 1–10 items".

The old constants (10 MiB, 32 MB) refused what Meta documents it takes, so
the record now carries Meta's documented numbers, each with its URL.

| Limit removed                                                                                                                                   | What replaced it                                                                                                                                                                                                       | Proof                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_ATTACHMENTS_PER_MESSAGE` (20)                                                                                                              | Nothing: any number attaches; the transports' frame validity and the send path answer                                                                                                                                  | `noLimitsInput.test.ts` (21 attach), `attachArgs.test.ts` (21 parse), `attachments.test.ts` (updated) — red before, green after         |
| `MAX_IMAGE_BYTES` (10 MiB)                                                                                                                      | `META_IMAGE_MAX_BYTES` (50,000,000) in the Meta capability record + `metaMediaCapabilities` + MCP/browser degradation, with the image-understanding URL; nothing local without a record                                | record test pins value + URL; 12 MB attach admits — red before, green after                                                             |
| `MAX_TEXT_ATTACHMENT_BYTES` (1 MiB)                                                                                                             | Nothing: text attaches at any size; MSP frame budget (transport) and the model window budget decide; voice pipeline keeps `VOICE_TEXT_MAX_BYTES` (protocol, renamed, unchanged)                                        | 2 MB Muse Code attach admits — red before, green after                                                                                  |
| `MAX_DOCUMENT_BYTES` (32 MB)                                                                                                                    | `META_DOCUMENT_MAX_BYTES` (50,000,000) in the record + captured capabilities, with the file-handling URL                                                                                                               | record test pins value + URL; 33 MB PDF admits — red before, green after                                                                |
| `MEDIA_ATTACHED_MAX_ENTRIES` (64)                                                                                                               | Nothing: registrations are metadata-only and unbounded; discards, owner and turn releases still let go; refusal class deleted                                                                                          | 65 idle resolve + all-held admit — red before, green after                                                                              |
| `WEB_FETCH_MAX_CONTENT_CHARS` (50,000)                                                                                                          | Nothing: the page reaches the tool-result path whole; past the model's real window the TOOLCAP spill carries it in a file the model pages through, with the cut notice                                                 | recorded 290,810-char Wikipedia page whole, no notice — red before, green after                                                         |
| `WEB_FETCH_CONVERT_MAX_CHARS` (100,000)                                                                                                         | Nothing: `maxChars` optional through the converter worker; the 5 MiB buffer window (bomb guard) and worker time/heap stop a hostile page                                                                               | same fixture past 100k converts whole; explicit bound still truncates — red before, green after                                         |
| `IMAGE_EDIT_SOURCE_MAX` (10)                                                                                                                    | `maxEditSources` on the record's image modality (Meta preset: 10, image-generation URL); `prepareImageCall` refuses from the record before any read or billing; without a record Meta's own refusal reaches the caller | record pins 10 + custom values; 11 refused pre-read with 0 reads, 3 prepared, 11 allowed with no stated count — red before, green after |
| Composer/ACP/exec count + kind caps; ACP 200 MiB sniff cap; `readPickedFile` PDF default; `readVisual`/edit-source reads                        | `MEDIA_READ_MAX_BYTES` (512 MiB host-memory bound, Stop-abortable); ACP sniff takes no cap (lazy head/tail only)                                                                                                       | `acpTranslate.test.ts` (10 MB valid image admits), suites green                                                                         |
| ACP `decodeAcpBlob`/postMessage sizing; `MAX_ENCODED_MEDIA_CHARS` 48M; ACP frame 64 MB; `MAX_ATTACHMENT_BASE64_CHARS` 42.7M; CDP message 32 MiB | Transports resized to the documented maxima: encoded budget 66,666,668 (one 50 MB file), ACP frame +16 MiB headroom, postMessage 66,666,668, CDP 80 MiB; the Composer enforces only the postMessage frame              | `acpSdkTransport.test.mjs` (one documented image fits) — red before, green after                                                        |

Kept with reason (D121 outcome 4, listed for the lead): `MEDIA_READ_MAX_BYTES`
(host-memory whole-read bound), `TOOL_IMAGE_PREVIEW_MAX_BYTES` (panel display),
`IMAGE_RESIZE_MAX_QUEUED` (serial worker queue), `SETTLED_ATTACHMENT_REQUEST_IDS_KEPT`
(UI state), `VOICE_TEXT_MAX_BYTES` (voice protocol), `WEB_FETCH_BUFFER_WINDOW_BYTES`

- convert worker time/heap (bomb guard), `WEB_FETCH_DETAIL/TOKEN/URL_MAX_CHARS`
  (display/wire), `LINK_FOLLOW_MAX_HOPS` (symlink loops), `WEB_FETCH_TIMEOUT_MS`
  (liveness), send-path `MODEL_API_MEDIA_PER_REQUEST`/`MODEL_API_PDF_PAGE_IMAGES`
  packing (Meta's documented per-request budget at the wire, with elision words),
  `MAX_ATTACHMENT_BASE64_CHARS`/`MAX_ENCODED_MEDIA_CHARS`/`ACP_MAX_MESSAGE_BYTES`
  (transport frames, resized), `MSP_*_BUDGET`/`MSP_FRAME_LIMIT_BYTES` (CLI transport),
  `TOOL_FILE_MAX_*` (generic file tools), `MODEL_API_TEXT_BUDGET_TOKENS` (model window).

Stop still ends every path: fetch rejects on abort (pinned), reads check the
signal per chunk, conversions keep the 10 s worker timeout, image requests
stay waited-on-until-stopped. No new progress UI was needed: a fetch is
deadline-bounded and its outcome (page, notice, spill, refusal) already says
in plain words what happened.

Break-once drill (2026-10-19, repo's own timeout): the new
`test/unit/noLimitsInput.test.ts` (16 tests) plus the rewritten
`acpSdkTransport` bound test failed on the pre-change code (13 failed, 3
passing guards: the abort-rejects fetch, the no-record edit count, and the
3-source prepare) and all pass after. Pre-existing failure noted, not
touched: `acpTranslate.test.ts` "refuses a media link when no confined reader
is installed" fails identically on the untouched base (stale expectation from
an earlier media change; media-link port routing, unrelated to sizes).

Lane close (2026-10-19, rig linuxlt, worktree NOLIMITSINPUT):

- `npm run check:catches` fails, identically with and without this lane's
  diff (verified on clean HEAD `341a9424d3` via a scratch worktree:
  13 flagged sites in files this lane never touched, SWALLOW 222 → 223).
  Pre-existing baseline drift; the lead owns the re-baseline. This lane
  adds and removes no `try`/`catch`.
- PLAN.md takes no lines from this lane: D121's own rule says the other
  NOLIMITS lanes add none, and `check:plan` warns the file is past 85% of
  the reader bound (3,808,659 bytes). The two `MEDIA_ATTACHED_MAX_ENTRIES`
  mentions left in PLAN.md are closed 2026-10-09 milestone history,
  byte-for-byte. CHANGELOG `[0.19.0]` carries the lane's lines instead.
- Help sweep: the README numbers left standing name kept bounds only —
  the Muse Code 10 MiB message frame (transport validity), the 10 MiB
  tool-image preview (panel display), `TOOL_FILE_MAX_*` file-tool rows —
  each now says the model still reads the work whole. Closed certification
  and design records keep their numbers as history.
- Pre-existing failures left red, each verified identical on the untouched
  base: the `acpTranslate` media-link test above and 2 `execExactCount`
  remedy tests. This lane's `acpTranslate` padded-image expectation was
  fixed (`toMatchObject`) and is green; 43/44 pass.
- Final gates on the lane tree: `tsc --noEmit` 0, eslint 0 warnings on all
  touched paths, prettier clean, `check:l10n` 0 problems, `check:reference`
  current, cycles none, `check:plan` exit 0 with the size warning above.
- Follow-up dedup (same day): the new suite first copied png/store/record
  and fetch-deps setup from three older suites (jscpd 19 vs base 13). The
  builders now live in `test/unit/helpers/` (`media/fixtures` gains
  `pngFixture`; new `attachedRecords`, `webfetchRecord`) and the older
  suites use the same copies: jscpd back to the base 13, none from this
  lane (gate still red at threshold 0, pre-existing). All four suites
  re-green after the move (52 + 3 tests).
- `npm run typecheck`: host and webview clean; unit reports 19 errors in
  estimate/pacing/pull-request files, byte-identical on the pre-lane base
  (`341a9424d3`, same 19 in the same files) — pre-existing, none from this
  lane. (An early lane note said only "`tsc --noEmit` 0": that was the host
  project; the full run is the record above. e2e and integration run
  separately (`run-s` stops after the unit failure): integration clean
  (exit 0); e2e reports the same pre-existing `estimateFailures` error
  counted in the unit 19.)
- Related suites (every unit suite importing a changed module): noLimitsInput
  16, attachments + acpMediaPort 36, webFetchBomb 3, noDefaultLimits +
  companionWav 18, noticesInput + voiceBatchSeams + recordingLatest 55,
  museCodeLatest + localServerCaptures + composerFocusOwnership 65,
  elicitationHookSeam + pathGuardSpawns + startupWords 25,
  vendorMediaCodecs + questionAttentionOwnership 42 — all green with the
  repo's own timeout. (`vitest related` itself cannot run here: its set
  pulls a production-build suite whose shared build fails on this rig;
  each related file passes by direct run.)
- SAST (`security:sast`): 533 rules on 3902 files, 0 findings, exit 0.
  `security:audit`: exit 0 (2 advisories, 1 documented exception).
- `npm run build` stops at the pre-existing What's New bound, as briefed:
  `CHANGELOG.md 0.19.0` notes decode to 326,993 bytes over the 76,800-byte
  bound. The base tree already carries ~269 KB of 0.19.0 notes; this lane
  adds 10 lines (~1 KB). Not worked around; bundle-size budgets unverified
  behind it. Deadcode exit 0, host-api 0 problems, cycles none,
  `check:reference` current, `check:l10n` 0 problems, `check:plan` exit 0
  with the size warning above, `check:catches` pre-existing red above.

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
---

# Lane NOLIMITSFINAL2 — the final product-set sweep (D121)

Branch `fix/0190-nolimitsfinal2`, base `d27853b421`. The owner's order:
no limit of ours in any default; the person sets one in settings when they
want one. Six removals, each below with its old default, new default,
setting, commit and test. Joined beside NOLIMITSRUN (`cand/JOIN0190/171`,
`ea77b7b27a`) and NOLIMITSINPUT (`cand/JOIN0190/169`, `270d33bc67`);
both were checked first and nothing they already removed was redone (both
still carry `WEB_FETCH_TIMEOUT_MS`, and 171 still carries
`HOOK_MODEL_MAX_OUTPUT_TOKENS`).

## The six removals (old default → new default, setting, commit, test)

- `WEB_FETCH_TIMEOUT_MS` (30 s) → no deadline: the fetch reads a page
  whole however slow it answers, until the page answers or Stop ends it.
  The wait names how long it has waited (`stillWaitingText` with the new
  `webFetch` subject, English `the web page` plus all fourteen locales)
  through the host's log, as Model API requests already do. No setting:
  Stop is the person's control, as with model requests. The `timeout`
  failure kind and both its sentences (`WEB_FETCH_MODEL_TEXT` English,
  `UI_TEXT` display) go with it. README's web-fetch section says the
  wait instead of the old 30 seconds. Commit
  `c374e69a7782e58d78050a6fce8b4d2b9bf75962`. Tests:
  `test/unit/webFetchNoDeadline.test.ts` (new: a 300 ms injected
  transport reads whole; notices name the wait; Stop ends it) and the new
  `webFetch` row in `test/unit/stillWaiting.test.ts`.
- `HOOK_MODEL_MAX_OUTPUT_TOKENS` (1024) → the capability record's
  published maximum, or nothing sent: `hookModelOutputCap` reads
  `modelPolicyFor(modelId).output.maxTokens` (Meta: 131,072); a model the
  record names none for omits the key and the provider's own default
  applies. No setting: the person's dollar budgets still cap (the session
  fit lowers the sent number, the daily reserve holds the sent number and
  the tally settles the true cost after). Two shared-layer reads stay
  honest for the absent key: the pacing estimate counts the input side
  alone (`estimatedStreamTokens`), and a manual thinking step keeps its
  full size (`manualThinkingBudget`, new pure helper); every other caller
  sends a budget, unchanged. Two `as` casts with §8 rows (the shared body
  type still requires the key; widening it would force dead fallbacks at
  every reader). Commit `d870200053f81f7e4e2c323e796c4bb1eeb7d581`.
  Tests: `test/unit/hookModelOutputCap.test.ts` (record maximum for a
  Meta model, nothing for a record-silent one) and
  `test/unit/hookUncappedEstimates.test.ts` (finite input-side pacing
  estimate; full thinking step uncapped, fitted step capped).
- `EXEC_SCAN_TIMEOUT_MS` (30 s) and `HEADLESS_FIXED_TIMEOUT_MS` → the scan
  runs until it finishes; a CI job that wants a deadline sets one per run
  with `scan-secrets --timeout <seconds>` (whole seconds within the
  platform timer's range; what it cannot hold is refused with the flag's
  own sentence). Commit `2e965fd7e2e4e63d86c57dd569154c8d7b63f5d2`.
  Tests: `test/unit/cliArgs.test.ts` (the `--timeout` case),
  `test/unit/scanSecrets.test.ts`.
- `SCHEDULE_PAUSE_AFTER_FAILURES` (3) → a schedule never pauses itself;
  every failure still tells the person. New setting
  `museSpark.schedulePauseAfterFailures` (default 0 = never; a set count
  pauses after that many consecutive failures), threaded from the bridge
  through the binding, runtime and engine into the store. Commit
  `e6e823611acf3331d89e3f1f1be7ccd1e90c5d2f`. Tests:
  `test/unit/schedulePauseAfterFailures.test.ts` (new),
  `test/unit/scheduleFireFailures.test.ts`,
  `test/unit/schedulePromptLoop.test.ts`,
  `test/unit/scheduleWorkspaceBridge.test.ts`.
- The plugin child's bounds → no bound of ours: `PLUGIN_HOOK_TIMEOUT_MS`
  (30 s), `PLUGIN_RUNTIME_PROBE_TIMEOUT_MS` (15 s),
  `PLUGIN_CHILD_MAX_HEAP_MB` (256: no heap flag, the runtime's own default
  applies), `PLUGIN_CHILD_MAX_MEMORY_BYTES` (1 GiB),
  `PLUGIN_RESPONSE_MAX_BYTES` (64 KiB), `MAX_FAILURES` (2) and the same
  kind of import bound. A wait names how long it has waited and Stop ends
  it; a retry backoff that only paces retries stays (it bounds nothing).
  No new settings (an explicit per-hook timeout already exists). Commit
  `cddd267ea5ae5fb309b076b703c4f2ac30de18af`. Tests:
  `test/unit/pluginDispatch.test.ts`, `test/unit/pluginContainment.test.ts`
  (new), `test/unit/pluginImportFiles.test.ts` (new).
- The governor's disk thresholds `RESOURCE_DISK_MIN_FREE_GIB` (2),
  `RESOURCE_DISK_CRITICAL_GIB` (1) and `RESOURCE_DISK_CRITICAL_FRACTION`
  (1%) → the governor measures and shows free space and refuses writes
  only at a threshold the person set, the NOGOVLIMITS convention for CPU
  and memory; the 2 GiB set-value minimum, hysteresis and sampler stay.
  Commit `11d992201efa9cdb2acd4687ea0cbebba8139aca`. Test:
  `test/unit/resourceNoLimits.test.ts`.

## Proof (break-once per removal, base worktree, then green on this tree)

Each new test was run on the base worktree (`d27853b421`, same rig,
same repo timeout, no `--testTimeout`) and failed only on the new-behaviour
assertions, then passed here. Measured: `webFetchNoDeadline` + `webFetch`
subject row 2 failed on base, 11 green on this tree with `webFetchBomb`;
`hookModelOutputCap` 2 failed on base, 2 green here;
`hookUncappedEstimates` 3 failed on base, 3 green here; the cliArgs
`--timeout` case 1 failed on base; `schedulePauseAfterFailures` 5 failed
on base; `pluginDispatch` 4, `pluginContainment` 1 and `pluginImportFiles`
1 failed on base; `resourceNoLimits` 2 failed on base. No stand-ins:
every test drives the real function or schema the production path calls
(a slow injected transport, the real policy record, real budgets, real
probes, real filesystem). The base worktree was restored byte-identical
after each probe (`git status` clean apart from its pre-existing
untracked `node_modules`).

## Kept, unchanged

`VAULT_APPROVAL_TTL_MS` (120 s, approval lifetime, not a work cap), the
hook-matcher 25 ms / 250 ms guard (`HOOK_MATCHER_TIMEOUT_MS` /
`HOOK_MATCHER_COMPILE_TIMEOUT_MS`: matcher shape, not work), the
workspace-trust ceiling on `hooksMaxStopContinuations`
(`HOOK_MAX_STOP_CONTINUATIONS` 8, Muse Code's own bound; the default stays
0), and `WEB_FETCH_BUFFER_WINDOW_MIB` (5 MiB decompression-bomb guard:
safety, not a time limit). None is touched by any commit of this lane.

## Pre-existing failures (not this lane)

- Unit typecheck: 27 errors on this tree, file-for-file the 27 on the
  untouched base (diffed sorted lists: `IDENTICAL_DRIFT`); e2e typecheck: 1
  error, the same shared-helper error on both. None in a file this lane
  touched.
- `test/unit/commandHelp.test.ts` (`openRouterConnect`) fails on the
  untouched base too; `elicitationHookSeam` logs an EPIPE on the base too.
  Left alone.
- `npm run check:plan`: stops — PLAN.md is 3,817,806 bytes, over 85%
  (3,565,158) of the plan reader's 4,194,304-byte bound (this lane's §8
  rows add ~1 KB to a file already over). Not worked around.
- `npm run build`: stops at the What's New bound (326,287 bytes decoded
  against a 76,800 bound; this lane's CHANGELOG lines add ~1 KB to a file
  already 4x over). Bundle-size, bundle-split and later build steps
  therefore did not run in this lane. Not worked around.

## Final gate states (this lane)

- `npm run format:check`: green (whole repo).
- `npm run lint:js:main` and `npm run lint:js:tests`: zero warnings.
- `npm run check:l10n`: 0 problems (English `webFetch` subject plus all
  fourteen locales; best-effort translations of `the web page`).
- `npm run check:reference`: current. `npm run cycles`: no cycles.
- `npm run deadcode` (knip): red on the base and red here for the same 12
  pre-existing unused-tag/export lines (the only base-vs-tree diff is
  `VAULT_UI_TICK_MS`'s line number shifting with the removals; the export
  itself is untouched). Not worked around.
- `npm run check:catches`: red on the base and red here for the same
  stale-baseline counts on media/record/vault files no commit of this lane
  touches (counts identical base-vs-tree). This lane re-identifies 4
  GENERIC sites whose bodies its edits changed, no new catch semantics:
  `webFetch.ts:941` (the deadline branch is gone),
  `pluginHost.ts:271, 301` and `extensionHooks.ts:1162` (item-5 edits).
  The baseline is not regenerated here: that would mask other lanes' drift.
- Touched suites, repository's own timeout, no `--testTimeout`, at most 3
  files per run: webFetchNoDeadline, webFetchBomb, webFetchHost,
  stillWaiting, hookModelOutputCap, hookUncappedEstimates,
  hookModelTurns, modelApiLoopContracts, responsesCodec, anthropicCodec,
  providerPacing, judgeSameSideRequest, cliArgs, scanSecrets,
  resourceNoLimits, schedulePauseAfterFailures, scheduleFireFailures,
  schedulePromptLoop, scheduleWorkspaceBridge, pluginDispatch,
  pluginContainment, pluginImportFiles, noDefaultLimits,
  elicitationHookSeam, capabilityRecord, invariants. All green; counts in
  the lane's final message.

---

# Lane GRVFIXB2 — person-set plugin bounds (Grok review of the 0.19.0 join)

Branch `fix/0190-grvfixb2`, base `109d8df8d9` (NOLIMITSFINAL2).
Finding: in `src/core/backends/modelapi/pluginHost.ts` (and
`pluginContainment.ts`, `hooks.ts`) the plugin child's bounds (heap,
memory, the 30 s and 15 s waits, the 64 KiB answer, probe, import, the
Windows job memory, the failure latch) were removed with no `museSpark.`
setting, and an unbounded wait never said how long it had waited (no
`startStillWaiting`; Stop answered `cancelled`).

## The fix (commits `c12e3e36d5`, `a96e516cef`)

Four settings, each defaulting to 0 = none of ours, applied only when
set (manifest, all 15 `package.nls.*.json`, settings schema, defaults,
feature catalog, generated reference, README prose + settings table,
changelog):

- `museSpark.pluginHookTimeoutSeconds` — how long a plugin hook waits
  for its child. An explicit per-hook timeout wins; otherwise the set
  wait bounds the probe and the answer wait alike.
- `museSpark.pluginChildMaxMemoryMiB` — the child's memory ceiling: a
  set ceiling caps node's heap flag on every platform, wraps Linux bun
  in `prlimit --data` (refuses with its reason when `prlimit` is
  absent), rides the Windows job launcher's `jobMemoryLimit`, and
  refuses on macOS bun with its reason instead of running unbounded
  past a ceiling the person set.
- `museSpark.pluginAnswerMaxBytes` — the answer frame cap; a set cap
  fails an over-long answer (and probe flood) with the restored
  `exceeded its frame` / `output exceeded its bound` reasons.
- `museSpark.pluginMaxFailures` — consecutive Windows job-launcher
  failures that set plugin hooks aside until Retry Plugin Hooks; 0
  keeps trying past the pacing delay, as before.

Every plugin wait (probe and call) uses the product's existing
still-waiting notice (`startStillWaiting` + `stillWaitingText` with the
new `pluginHook` subject, English plus all fourteen locales, as Model
API requests do). Stop names the wait it kept: the abort answers
`the plugin call was cancelled after {duration}`, a session-ended wait
answers `the session is closed after {duration}`, and a probe stopped
or timed out keeps its own `cancelled/timed out after {duration}`
words instead of being called absent/not-installed. `HOOK_MODEL_TIMEOUT_MS`
and `HOOK_SESSION_END_TIMEOUT_MS` untouched (the join removes both).
The four settings join `MACHINE_SCOPED_SETTINGS` (a repository must not
set them, PLAN.md D15), plus the `schedulePauseAfterFailures` entry the
schedules lane omitted: its D15 manifest test failed on the untouched
base (`109d8df8d9`, measured in a clean worktree: same single failure)
and goes green with the one-line addition.

README: the fetch section in this tree already states the true no-limit
rule (whole page however large until it answers or Stop; same-host
redirects as many times as it takes — verified against `fetchHops`,
whose loop carries no count; `LINK_FOLLOW_MAX_HOPS` belongs to
`canonicalPath`, not fetch), so no fetch sentence needed changing; the
plugin section now documents the four settings and the notices.

## Break-once drill (in place: break, watch fail, revert, rerun)

- `pluginCallBounds` returning none: 7 bounds tests fail
  (converter, hook wait, answer cap, probe wait, heap flag, darwin
  refusal, prlimit wrap), 33 pass — the explicit-timeout and
  notice/Stop tests pass throughout, as kept behavior should.
- Call-wait notices disabled: only `a waiting call says how long it
has waited, and Stop names the wait` fails.
- Latch forced to 0: only `sets plugin hooks aside at the set count
until Retry` fails. Success never clearing: only `a success clears
the count` fails. Reset as a no-op: both reset tests fail (the new
  `Retry clears the count before the latch engages` and the
  pre-existing `Retry clears the count`, which proves the old behavior
  still fires).
- `pluginHook` subject removed from English: the subject test fails
  (`TypeError`, no prose to read).
- `SETTING_DEFAULTS.pluginMaxFailures = 2`: both new `noDefaultLimits`
  plugin tests fail.
- No stand-ins: every test drives the real function the production
  path calls — real plugin children under this node, real PATH
  lookups, the real containment with a controllable clock, the real
  settings schema.

## Proof (this tree, repository's own timeout, no `--testTimeout`)

- `pluginDispatch` 40 passed, 5 skipped (darwin/bun-only, this rig is
  Linux without bun); `pluginContainment` 7/7; `stillWaiting` 5/5;
  `noDefaultLimits` 17/17; `manifest` 40/40; `foreignHooks` 22/22.
- `npm run typecheck`: 27 errors, file-for-file the 27 on the
  untouched base (estimate*, modelApiPacing, teamConstants,
  vendorMediaCodecs, runtimePullRequestProcessBirth and helpers);
  none in a file this lane touched.
- eslint `--max-warnings=0` on every touched file: clean. Prettier on
  every touched file: clean. `npm run check:l10n`: 0 problems.
  `npm run check:reference`: current.

## Owed (cannot run on this Linux rig)

- The Windows job `jobMemoryLimit` path: unit-injectable only through
  a live launcher spawn, and this rig is Linux. Covered by the shared
  conversion (`pluginCallBounds`, tested), the restored parameter, and
  the latch tests; the lead owns a Windows run through the packed
  product before a set ceiling is claimed there.
- `test/integration` (VS Code) and `npm run build` were not run in
  this lane; the real-use path (packed product plugin run) is the
  lead's at integration.

# PLANBOUND addendum — the report plan reader (D121, 2026-10-20)

Linux rig `linuxlt`, worktree `/home/randy/lanes/PLANBOUND`, branch
`fix/0190-planbound`. The Grok review of the 0.19.0 join found the report
plan reader refused a person's PLAN.md above 4 MiB with `input-size` drift:
a limit of ours, against D121.

## Fix

- `src/core/reporting/plan/reader.ts`: `readPlan` takes an optional byte
  limit (`maxBytes`, default 0) and parses the whole plan however large. A byte limit applies
  only when set above 0; past it the read refuses with `input-size` drift
  naming the person's limit. The UTF-8 fast path is kept, parameterized by
  the person's bound.
- `src/runtime/reporting/engine.ts`: `ReportingContext` gains optional
  `planMaxBytes` (0/absent = none). The plan source streams the whole
  PLAN.md with no cap of ours and passes the person's value to the parse.
- The person's setting: `museSpark.reports.planMaxBytes` (bytes, 0 = none,
  machine-scoped) in `package.json`, all 16 `package.nls.*.json` tables,
  host settings, defaults, feature catalog and the regenerated reference.
  The editor passes its value in; the terminal/ACP runtime reads
  `reportsPlanMaxBytes` from the agent data folder's `settings.json`
  (`src/runtime/runtimeReportsPlan.ts`; the budget strict schema accepts
  the key).
- `scripts/check-plan.mjs`: the hygiene gate keeps the same 3,565,158-byte
  archive threshold as its own named constant with the reason, no longer
  depending on a product bound. `FORMAT.md`, the README report section plus
  both settings tables, and the 0.19.0 no-limits sentence say reports parse
  the whole plan unless the person sets their own bound.

## Tests and break proof

- `planReader` 55/55: a plan past the old 4 MiB bound parses with zero
  drift by default and refuses with `input-size` naming the set limit when
  one is set (byte and multi-byte inputs); explicit 0 means none.
- `noDefaultLimits` 20/20: the new setting defaults to 0 in defaults and
  manifest, reads whole with nothing set, refuses past a person-set bound,
  and the runtime reader returns 0 for a missing key or file (real temp
  dir under `$TMPDIR`, removed afterwards).
- Break 1: `maxBytes > 0` forced to `>= 0` → 53 of 55 planReader tests
  failed, reverted to green.
- Break 2: runtime reader `?? 0` forced to `?? 1` → passed until the
  valid-file-without-key assertion was added; then exactly the new runtime
  test failed, reverted to green.

## Gates (final tree, repository's own timeout)

- prettier and eslint (zero warnings) on every touched file: clean.
- `npm run typecheck`: exit 0, all five projects clean.
- `npm run check:l10n`: 0 problems. `npm run check:reference`: current.
- `npm run check:plan`: `plan-format-v1; 222 milestones; 0 drift`.
- Suites: reportEngineLanguage + runtimeAccountingEntry + runtimeDailyBudget
  48/48; reportSourceFailures + reportPlaybookSchedules + manifest 68
  passed and 1 failed; paidMoneyStructure + execExactCount 50/50. The one
  manifest failure (`tiered CI` expects `check:no-output-cap` and
  `check:no-round-cap` CI leaves) fails identically on the untouched base
  commit, so it is pre-existing and unrelated.
- `npm run build`: exit 0. `npm run check:roadmap`: current.

## Open

- `CONTRIBUTING.md` still describes the old 4 MiB product bound stopping
  check:plan, check:roadmap and /report; out of this lane's listed scope.
- The packed-product real-use run is the lead's outside the sandbox.
