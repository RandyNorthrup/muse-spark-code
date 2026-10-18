# Catch burn-down list (D119)

Every site the corrected catch classifier accepts lives in
`scripts/catch-baseline.json` (1,347 identities after PR161FIN: 1,163 from
the original reader plus the corrected reader's pre-existing finds, minus
the sites PR161FIN fixed). New sites still fail `npm run check:catches`.
Fix an area by fixing its handlers (the failure reaches the person in
words or the caller as an error with its cause), proving the test fires,
then regenerating the lowered baseline with
`node scripts/catch-inventory.mjs --write-baseline`. Never weaken the
classifier, its tests or the gate.

Areas PR161FIN fixed outright (money, credentials, consent and their
chains) carry no baseline debt for the handlers they repaired; the two
residual flags below rejoin the baseline with their reasons.

Designed baselines with reasons (accepted, not forgotten):

- `src/core/schedules/scheduler.ts` fire catch: settled recovery resolves
  on the proven settlement (the send error is superseded by proof); every
  failed or ambiguous round is journaled first, then rejects.
- `src/runtime/schedules/nodeScheduleFs.ts` publish catch: a matching
  staged read proves the publication moot; every other path names its
  condition or rethrows.
- `src/runtime/schedules/channel.ts`, `ScheduleEditor.tsx`,
  `ScheduleSurface.tsx`: fixed user words by l10n law; the channel keeps
  the send failure as its cause.
- `src/acp/accounts.ts` (3): fixed protocol vocabulary; the refused
  providers file keeps `providersInvalid`, the panel renders words for
  every code.
- `src/acp/vault.ts` ask: fail-closed deny; only a validated answer or a
  deny crosses.
- `src/acp/questionDeferral.ts` (4 GENERIC): the form closes, the failed
  marker is the record, safe defaults return. Note for a later lane: the
  person hears no failure words when a deferral dies silently (APP PROBLEM).
- `src/runtime/chatGptProviderCommands.ts` verify + outer command catch:
  fixed CLI words and exit codes; known sign-in codes are kept.
- `src/host/vault/slots/windowsVaultBuild.ts`: unsafe parents fall back
  to the temp tree with the host report signal.
- `src/runtime/vault/slots/macVaultProtocol.ts`: only the validated fixed
  error class crosses the broker boundary; raw diagnostics stay local.
- `src/host/auth/authService.ts` sign-in restart, `src/core/developer`
  multi-account start/enable, `src/runtime/chatGptProviderCommands.ts`
  setup: fixed in PR161FIN (named closers, kind words, cause slots).
- Everything else below: pre-existing, grouped for area-by-area lanes.
- Model API backend (CATCHBE1, 0.19.0): 73 handlers fixed at their cause
  (155 down to 82 GENERIC/SWALLOW); the 82 below stay as designed, with
  reasons. Fixed words in logs name the failure, never its text; kept
  person-surface words are the person's own workspace and transcript.
- Cost-unknown stays undefined, never an estimate: `autoCompactionAdmission.ts`
  (both reserve paths; `estimateCostUsd` throws plain-Error unknown-tariff by
  design, and Usd overflow must not abort admission) and `client.ts`
  searchPriceUsd (undefined disables search; never billed as zero).
- Retry and repair loops: the transient failure rides the retry channel and
  the terminal failure rethrows — `providerClient.ts` stream (the redacted
  failure reaches onRetry, the terminal rethrows through rethrowStreamError),
  `transport.ts` fetch retry (the redacted M56/D43 detail in the retry warn;
  refusal, ModelApiError and abort paths rethrow), `structuredOutput.ts`
  side-call repairs (abort and terminal errors rethrow, then text fallback
  with notice), `ModelApiHost.ts` attempt loop (quote, media and retry
  branches; the terminal rethrows).
- Availability bulkheads: the pool stays up — `mcp/pool.ts` plan (any plan
  failure is an unreadable fault; EntryProblem messages are already fixed
  literals) and connect (any connect failure is a failed state; a rethrow
  would fail all of startAll through Promise.all), `transport.ts` observe
  (usage-observation once-guard; a rethrow would fail attempts for
  telemetry), `transport.ts` describeFailure (an unreadable body falls back
  to the status-text envelope).
- Fail-closed hook and reviewer outcomes in fixed words, the stop owned by
  cancellation: `hookHandlers.ts` post/run/mcp, `reviewerEntry.ts` (the user
  decides), `hooks.ts` combined/command/plugin/prepare/run/admission/async
  (an unreadable config is not applied; an unloadable runtime runs nothing),
  `foreignHooksEntry.ts` (an unloadable plugin host refuses; a dynamic
  import failure has no named class), `schedulesEntry.ts` verify report
  (unavailable, never clean), `ModelApiHost.ts` reviewer admission (ask the
  user), hook load (no hooks run) and hook runtime.
- Best-effort probes whose negative answer is the contract:
  `hookFormats/clineDiscover.ts` (a directory that cannot be read
  contributes nothing, per its docstring), `pluginHost.ts` isExistingFile,
  `hooks.ts` regex compile/test (an invalid or timed-out pattern is refused
  or misses; timeout-as-invalid is the safe mapping), `ModelApiHost.ts`
  per-file listing skip.
- Fail-closed tool outcomes the model is told about, abort propagating:
  `codeIntelCalls.ts` rename partial (the abort-swallowing finishes the
  write by design), `imageGeneration.ts` read/reserve refusals,
  `tools.ts` media/visual/search/list/shell/vault/format/execute (the
  secrets failure takes vault.noAccess and never leaks; the vault tool
  failure is a security bulkhead; the format warns were scrubbed to fixed
  words), `ModelApiHost.ts` witness/provisional/steer/shell/policy/billing
  (a billing failure refuses and books nothing, D121; a policy refusal
  stands; refused shell entry tells the model nothing; the witness proceeds
  without proof), elicitation cancelled, compaction notice, turn
  terminal-state machine (abort, refusal and paid stops named).
- Void fire-and-forget records: `extensionHooks.ts` and `hooks.ts` async
  hook catches warn; a rethrow would be an unhandled rejection. Stream
  error forwarding is the propagation: `transport.ts` pulls forward into
  controller.error/cancel; a rethrow would double-fault.
- Person-surface words kept as the person reads them (own workspace, own
  transcript): shell stderr rows, row failureReasons, the schedule verify
  text in `schedulesEntry.ts`, `ModelApiHost.ts` D26 rename planning (a
  throw before the row exists would leave it rowless), directory reset and
  uncertified-bytes fallbacks, subagent lifecycle (the child session owns
  its error).
- Already kind-words or scrubbed by design: `ModelApiHost.ts`
  helpersFailure (kind via helpersFailureKind, verified closed), the
  turn-fault log (scrubRefusalLeak, round 2 finding 5), `pluginHost.ts`
  runtime probes (an absent runtime refuses), spawn and write failures (a
  child that never starts or takes a request settles failed).

| Folder                 | GENERIC | SWALLOW |
| ---------------------- | ------- | ------- |
| src                    | 9       | 3       |
| src/acp                | 19      | 0       |
| src/core               | 11      | 1       |
| src/core/backends      | 79      | 12      |
| src/core/bestOfN       | 5       | 0       |
| src/core/browser       | 9       | 8       |
| src/core/codeIntel     | 3       | 0       |
| src/core/context       | 4       | 0       |
| src/core/developer     | 6       | 0       |
| src/core/estimator     | 5       | 0       |
| src/core/eval          | 5       | 1       |
| src/core/events        | 0       | 1       |
| src/core/export        | 1       | 0       |
| src/core/git           | 2       | 0       |
| src/core/import        | 10      | 8       |
| src/core/judge         | 14      | 5       |
| src/core/legal         | 3       | 3       |
| src/core/locks         | 8       | 7       |
| src/core/media         | 11      | 17      |
| src/core/memory        | 5       | 0       |
| src/core/orchestration | 10      | 2       |
| src/core/plans         | 2       | 0       |
| src/core/prompts       | 2       | 1       |
| src/core/providers     | 15      | 2       |
| src/core/questions     | 1       | 0       |
| src/core/reporting     | 31      | 6       |
| src/core/resources     | 41      | 25      |
| src/core/review        | 4       | 2       |
| src/core/schedules     | 9       | 10      |
| src/core/support       | 0       | 2       |
| src/core/tab           | 5       | 0       |
| src/core/team          | 19      | 6       |
| src/core/usage         | 4       | 8       |
| src/core/vault         | 37      | 36      |
| src/core/voice         | 3       | 3       |
| src/core/web           | 8       | 3       |
| src/host               | 31      | 1       |
| src/host/auth          | 8       | 0       |
| src/host/backend       | 35      | 4       |
| src/host/bestOfN       | 1       | 0       |
| src/host/browser       | 10      | 6       |
| src/host/checkpoints   | 14      | 6       |
| src/host/commands      | 17      | 2       |
| src/host/conversation  | 111     | 9       |
| src/host/editor        | 9       | 0       |
| src/host/estimator     | 1       | 0       |
| src/host/git           | 20      | 5       |
| src/host/ide           | 2       | 0       |
| src/host/judge         | 2       | 1       |
| src/host/media         | 1       | 2       |
| src/host/mention       | 1       | 0       |
| src/host/models        | 4       | 2       |
| src/host/prompts       | 4       | 0       |
| src/host/providers     | 8       | 8       |
| src/host/resources     | 1       | 2       |
| src/host/review        | 11      | 1       |
| src/host/runners       | 4       | 0       |
| src/host/skills        | 10      | 0       |
| src/host/support       | 18      | 1       |
| src/host/tab           | 10      | 2       |
| src/host/team          | 11      | 10      |
| src/host/usage         | 1       | 0       |
| src/host/vault         | 3       | 4       |
| src/host/views         | 1       | 0       |
| src/host/voice         | 3       | 0       |
| src/host/web           | 4       | 0       |
| src/host/whatsNew      | 3       | 0       |
| src/runtime            | 42      | 6       |
| src/runtime/companion  | 2       | 5       |
| src/runtime/estimator  | 1       | 0       |
| src/runtime/exec       | 19      | 4       |
| src/runtime/fonts      | 2       | 0       |
| src/runtime/legal      | 8       | 1       |
| src/runtime/panel      | 49      | 12      |
| src/runtime/playbook   | 2       | 0       |
| src/runtime/providers  | 4       | 2       |
| src/runtime/questions  | 2       | 0       |
| src/runtime/reporting  | 16      | 0       |
| src/runtime/resources  | 8       | 1       |
| src/runtime/schedules  | 15      | 1       |
| src/runtime/sharing    | 3       | 0       |
| src/runtime/usage      | 4       | 4       |
| src/runtime/vault      | 9       | 12      |
| src/shared             | 7       | 3       |
| src/shared/hostApi     | 1       | 0       |
| src/shared/l10n        | 1       | 0       |
| src/shared/reference   | 0       | 1       |
| src/webview            | 5       | 0       |
| src/webview/components | 4       | 0       |
| src/webview/media      | 7       | 0       |
| src/webview/models     | 1       | 0       |
| src/webview/playbook   | 3       | 0       |
| src/webview/prompts    | 5       | 0       |
| src/webview/schedules  | 3       | 0       |
| src/webview/sharing    | 3       | 0       |
| src/webview/state      | 1       | 0       |
