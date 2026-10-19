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
