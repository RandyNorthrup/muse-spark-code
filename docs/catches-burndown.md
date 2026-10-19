# Catch burn-down list (D119)

Every site the corrected catch classifier accepts lives in
`scripts/catch-baseline.json` (1,309 identities after the 0.19.0
core/host/runtime burn-down: the corrected reader's finds, minus the
sites the lane fixed). New sites still fail `npm run check:catches`.
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
- `src/runtime/estimator/command.ts` run catch (CATCHRUN2): the outer CLI
  floor. Inner layers already classify refusals with their own detail
  (`isEstimateRefusal` in session and ACP); the floor reports residue in
  fixed translated words with explicit exit 1. The cause cannot enter the
  sentence (rule 18) and the port offers no record channel; rethrowing
  would replace an explicit exit with a crash. Evidence:
  `test/unit/runtimeCatchHandlers.test.ts` "estimate command floor" (a
  real contract failure through the runner port exits 1 with fixed words
  and nothing written) plus the `estimateSession` refusal/foreign-failure
  tests.
- `src/runtime/playbook/command.ts` run catch (CATCHRUN2): "Output
  contains validated data only, never exception text" is the documented
  contract; `runPlaybookCli` maps `ok:false` onto stderr and exit 1, and
  a hostile port's malformed data parses to the same fixed refusal.
  Rethrowing would crash the CLI past its explicit failure exit.
  Evidence: `test/unit/runtimeCatchHandlers.test.ts` "playbook command
  floor" (a failing port read answers `ok:false` with
  `playbookCommandFailed` and no leak).
- `src/runtime/fonts/nodeInstall.ts` probe catch (CATCHRUN2): every probe
  failure (absent, unreadable, invalid) maps onto the safe action, a
  fresh publication; publication owns its failures with causes. Naming
  the installer's own refusal would need locale-coupled message matching.
  Evidence: `test/unit/runtimeCatchHandlers.test.ts` "font pack
  publication" (fresh publish, matching reuse, refused clobber with the
  old bytes intact).
- `src/runtime/fonts/nodeInstall.ts` publish catch (CATCHRUN2): mirrors
  the accepted schedule publish entry above — a matching pack proves a
  concurrent publication moot; a mismatched one rethrows without touching
  the file. Evidence: "settles concurrent publishers on one destination"
  (two real concurrent publishers, one destination) and the
  refused-clobber case.
- `src/runtime/providers/accountsCommand.ts` both command catches
  (CATCHRUN2): the outer CLI boundary prints the reviewed `commandError`
  vocabulary (fixed sentences per store code; kept-cause messages
  otherwise, as `test/unit/accountErrorTruth.test.ts` pins, including a
  real unreadable-file failure) with explicit exit 1. Inlining the
  vocabulary into the handlers would duplicate it and diverge; rethrowing
  would crash past the explicit exit. No record channel in deps.
- `src/runtime/sharing/sharingEntry.ts` exec catch (CATCHRUN2): the outer
  exec floor. A paused run, an allow-listed known failure and anything
  else each write fixed words to stderr with an explicit exit code; the
  allow-list never echoes exception text. Rethrowing would crash past the
  explicit exit; no record channel in scope. Driving it needs process
  stdio and signals, so it stands on the contract above, unverified by a
  test — stated, not hidden.
- `src/runtime/usage/usageCli.ts` receive catch (CATCHRUN2): one failed
  message reports its fixed `readFailed` protocol code and the session
  survives; the cause cannot enter the fixed page schema and the ports
  offer no record channel. Evidence: `test/unit/runtimeCatchHandlers.test.ts`
  "usage stdio pump" (a malformed line and a failed message report their
  codes and the pump returns 0; a failed print rejects with the same
  error object).
- `src/runtime/usage/usageServiceEntry.ts` service-handle catch
  (CATCHRUN2): malformed input stays `invalidMessage`, a failed read
  reports `readFailed`, and the stdio server survives the blip — a fixed
  protocol vocabulary with truthful codes, no record channel in ports.
  Evidence: `test/unit/runtimeCatchHandlers.test.ts` "usage stdio
  service boundary" (malformed, oversized, failing and malformed-input
  lines each answer their code).
- `src/runtime/resources/history.ts` fingerprint/consent/sample/event
  catches (CATCHRUN2): the certified damage-noter design (TBL-12). The
  fingerprint degrades any unreadable choice to `unknown` rather than
  breaking damage identity; unreadable or invalid consent fails closed
  to `false` and is announced once per distinct damage, never mistaken
  for a refusal; a failed sample or event is reported once through the
  designated error port and dropped, never replaced by an invented
  reading, and sampling survives. Non-Errors rethrow past every one.
  Restructuring them for the classifier would touch certified money
  gates; the `onError`/`noteDamaged` record channels are invisible to it.
- `src/runtime/resources/host.ts` listener/sampler catches (CATCHRUN2):
  a failing listener or sampler reports the original error through the
  designated `onError` port; throwing there would break the sampling
  loop and every other listener. No other channel in scope.
- `src/runtime/resources/entry.ts` flush catch (CATCHRUN2): disposal
  never throws; a failed flush reaches the error port with its cause
  under fixed words.
- `src/core/reporting/sources/local.ts` outer catch, `checkRuns.ts`
  source catch, `sources/cache.ts` reader catch: port-level containment the
  report engine's unguarded `Promise.all` requires; every cause maps into the
  closed record vocabulary, and rethrowing would fail the entire report for
  one source.
- `src/core/reporting/destinations/runner.ts` deliver catch,
  `destinations/email.ts` send catch, `sources/github.ts` post catch:
  terminal per-destination outcomes; raw send errors are secret-bearing and
  the outcome protocol has no cause slot; refused and uncertain are named,
  everything else is failed or uncertain by the documented rule.
- `src/core/reporting/history.ts` ownStart catch: first-attempt failure is
  superseded by the retry; the final throw carries the attempt's cause.
- `src/core/reporting/sources/cache.ts` transport catch: the void
  fire-and-forget effect reports `transportFailed` to the admission reducer;
  rethrowing would be an unhandled rejection.
- `src/core/reporting/sources/github.ts` exec catch: the exec rejection
  doubles as the response candidate and `safeParse` separates output-shaped
  failures from shapeless ones; rethrowing would lose gh's own error output.
- `src/core/resources/queue.ts` wake catch, `commands.ts` handoff and stop
  catches, `events.ts` publish catch, `governor.ts` read and publish
  catches, `relocate.ts` catches (3), `admission.ts` catches (2),
  `launchHost.ts` catches (4), `process.ts` catches (4): the live error (or
  its fixed stop-failed error with cause) is delivered to the waiter or
  owner that must settle; rethrowing would hang waiters, break fan-out,
  unwind subscribers, or report twice.
- `src/core/resources/actuators/index.ts` catches (5),
  `createdRegistry.ts` marker, restore-probe and clean catches,
  `trees/registry.ts` kill catch, `trees/mac.ts` catches (4),
  `trees/windows.ts` catches (6), `sampler/machineSampler.ts` probe catch:
  fail-closed and closed-vocabulary results (`unknown`, `false`, `refused`,
  per-entry markers); rethrowing would abort sibling controls, leak
  entries, break disposal, or fail host admission for one unreadable tree.
- `src/acp/agent.ts` media attach: refusals answer as written, anything
  else answers `attachmentUnreadable`, never in its own words (no-leak
  boundary; proven by `test/unit/acpMediaRefusal.test.ts`).
- `src/acp/agent.ts` retry/continue, question peek and answer start: fixed
  protocol words (`agentRetryUnavailable`, `cancelled`, the stored outcome
  error); the turn protocol has no words for these failures, so they stay
  fixed and non-errors keep their kind.
- `src/acp/playbook.ts` (2), `src/acp/reports.ts`: fail-closed command and
  string boundaries; a bundle or surface that cannot load reads unavailable,
  a failed report stays its fixed sentence.
- `src/core/bestOfN/bestOfNRunner.ts` (3): event and hook boundaries never
  throw; a failed attempt records its reason on the attempt, a failed hook
  warns in fixed words and denies.
- `src/core/codeIntel/codeIntelQuery.ts`, `src/core/codeIntel/repoMap.ts`:
  graceful degradation; an unreadable file keeps its locations without
  their lines (or leaves the counts), while a placement refusal propagates.
- `src/core/developer/surfaces.ts`: the surface always answers its error
  vocabulary; an owner refusal names its code, anything else reads
  `unavailable`.
- `src/core/diagnostics.ts`: a malformed URI or path comes back with its
  reason (proven by `test/unit/diagnostics.test.ts`).
- `src/core/eval/driver.ts` (2), `src/core/eval/runner.ts`,
  `src/core/eval/wire.ts`: the eval harness's own failure record; the text
  diagnoses the mechanism under test for the owner running the eval.
- `src/core/mcp.ts` tool call: the protocol mandates an `isError` result,
  never a throw; the text is the tool's own failure words.
- `src/core/pathIdentity.ts` (4): negative-default identity probes; only a
  missing path climbs, anything else has no identity rather than a wrong one.
- `src/host/tab/tabIgnoreFile.ts` `hasIgnoreFile`: the same negative-default
  probe for Tab reads (missing reads absent, unprovable absence reads
  present so a broken check denies); the typing path takes a boolean and a
  throw would reject the completion, so the mapping stays a plain return.
- `src/core/plans/planStore.ts` existence probe: unreadable is not this plan.
- `src/core/review/planModeHold.ts`: the restore outcome carries its error
  to `onRestored`; the owner sees the failure as data.
- `src/core/review/reviewMaterial.ts` (5): git probes; any git failure is a
  negative answer (proven by `test/unit/reviewMaterialProbes.test.ts` with
  the real git binary).
- `src/core/tab/tabEngine.ts` (3): the progress failure is recorded, the
  published usage rejection stands, the queued request hears its error
  (rejections now carry their cause).
- `src/core/tab/tabHooks.ts` read refusal: a hook-state failure refuses the
  read outright (fail-closed, beside the two CLEANUP neighbours).
- `src/core/usage/usageService.ts` dispatch: the page protocol always
  answers; a failed message reads `writeFailed`/`readFailed` with its id.
- `src/core/usage/usageService.ts` resource read: CLEANUP; the page renders
  without resources rather than failing or inventing them.
- `src/core/voice/museVoice.ts` (3): the stream settles failed in the
  refusal's own words, never by throwing out of a socket callback (proven
  by `test/unit/museVoiceSettle.test.ts`).
- `src/core/web/webFetch.ts` connection race and page boundary: attempts
  record into the race and the final `ConnectFailed` carries them; the page
  maps every failure to the fixed `WebFetchFailure` vocabulary while abort
  propagates.
- `src/core/imageResizeWorker.ts`: CLEANUP; the worker always answers so
  the parent never hangs.
- `src/host/providers/providerRemoval.ts` finish catch: the window end's
  failure keeps the pending for the next start's completePending (which
  throws naming the ids); it never rejects into the timer. Evidence:
  `test/unit/providerRemoval.test.ts` ("keeps a secret the window end
  cannot delete for the next start").
- `src/host/providers/providerRemoval.ts` completePending catch: every
  pending secret is attempted, then the throw names the ids that
  survived; the per-secret store failures are intentionally not carried
  (the person acts on ids). Evidence:
  `test/unit/providerRemoval.test.ts` ("attempts every pending secret
  and throws naming the survivors").
- `src/host/providers/wizardSave.ts` partial-save catch: the notice
  intentionally reports per-step fixed words with the secret-scrubbed
  reason (no record channel exists without out-of-area ripple); nothing
  is hidden (notice + failedStep reach the panel). Evidence:
  `test/unit/wizardSave.test.ts` ("reports a failed credential save step
  by step").
- `src/host/checkpoints/checkpointHost.ts` run-guard catch: a thrown
  guard is the refusal (toolIo's proven no-entry idiom); the fixed
  refused entry is the designed outcome, and the finish failure still
  throws with its cause. Evidence:
  `test/unit/checkpointStorageGuard.test.ts` ("returns a refused entry
  when the run guard throws").
- `src/host/git/conversationGit.ts` fetch-fallback catch: the fetch ran
  only after the log failed, so its own failure carries no new signal;
  the outer handler reports the outcome. Evidence: the outer base-commit
  handler is NARROW (typed rethrow plus the recorded kind).
- `src/host/git/conversationGit.ts` post-success ownership catch: the
  post completed, so success stands; only the linking reads stop.
- `src/host/skills/bundledSkillsInstall.ts` install, outer-install and
  remove tails: install and remove always return result data, never
  throw — the activation side never catches and words `result.failure`
  itself (`runBundledSkillsInstall`), and the outer install compensates
  (undo) before returning. Evidence:
  `test/unit/bundledSkillsInstall.test.ts` ("returns failure data, never
  a throw, when the vendor record is missing", "undoes the copy and
  returns failure data when the skills folder is blocked").
- `src/host/browser/browserProcess.ts` `isRunning` catch: unknown counts
  as running — a maybe-live owner's folder is never removed; the sweep
  retries. Evidence: `test/unit/browserProcess.test.ts` ("sweeps a dead
  owner folder and keeps a live one").
- `src/host/browser/runtime/runtimeStore.ts` stage-owner kill catch: only
  ESRCH (the owner is gone) removes the stage; any other kill failure
  keeps it for a later sweep, since the owner may live.
- `src/host/browser/browserProcess.ts` group-kill fallback catch: the
  pipes' setup already failed, so ending the direct child stays
  best-effort with nothing further to report.
- `src/host/browser/browserProcess.ts` half-made removal catch: a later
  sweep retries what stays.
- `src/host/providers/chatgptSignIn.ts` loopback-listen catch: every
  listen failure becomes the closed `local-failed` code carrying the
  operating system's code, which the hosts word themselves; the raw
  error never crosses (the class lives out of area, so no cause slot
  can be added here).
- `src/host/providers/chatgptSignIn.ts` callback-request catch: request
  bytes must never enter a failure, so a non-typed parser failure reads
  as `invalid-callback` by privacy design.
- `src/host/providers/chatgptSignIn.ts` lock-owner kill catch:
  permission and unrecognised OS failures mean uncertainty, not death —
  the lock is kept. Fail-closed toward keeping.
- `src/host/providers/chatgptSignIn.ts` credential-store catch: a
  refusal is the editor's store and is said as such, never as a ChatGPT
  outage (F14); the foreign error is deliberately not carried.
- `src/host/providers/chatgptSignIn.ts` factory-outer catch: a typed
  failure keeps its own sentence; anything else is a local file problem
  said with the operating system's code on the closed `local-failed`
  error the hosts word themselves.
- `src/host/providers/chatgptSignIn.ts` callback-wait and
  `src/host/providers/copilotClient.ts` tokenizer-race `.catch(() => null)`
  marks: the waiter (respectively the race) below receives the outcome;
  the mark only silences the handled rejection.
- `src/host/review/reviewCollector.ts` identity catch (REVCATCHD): a folder
  that cannot be read at all (a permission error, a link loop) keeps the
  review closed as a refused git failure with the code for the log, never as
  cancelled and never thrown — the collector's typed return channel is the
  report, which the classifier cannot see (GENERIC by shape, narrowed and
  reported by meaning). Evidence: `test/unit/reviewCollector.test.ts`
  ("refuses a looped folder as git failing, never thrown", observed failing
  on the throwing handler).
- `src/host/commands/museConfigCommands.ts` hook-file catch (REVCATCHD): a
  hooks file that cannot be read stays visible as an unreadable row with
  fixed words and its code, and the panel still lists every other source —
  the row's typed return channel is the report, which the classifier cannot
  see (GENERIC by shape, narrowed and reported by meaning). Evidence:
  `test/unit/museConfigCommands.test.ts` ("lists an unreadable hooks file
  as unreadable instead of failing the panel", "opens over a real
  unreadable hooks file", both observed failing on the throwing handler).
- `src/core/import/agentImport.ts` scan, plan and apply fallbacks (463,
  529, 1064, 1079, 1096, 1799, 1857, 2255, 2319, 2735): one unreadable
  foreign file warns in fixed words and skips while the scan continues;
  the write phase records the fixed code. Rethrowing would abort the whole
  import over one file, and no logger crosses the host-built scan input.
  Drills: `test/unit/pluginImport.test.ts` warn-and-continue cases through
  the failing read/listing seam.
- `src/core/import/pluginImport.ts:225`: a trust or environment check
  failure yields no findings rather than hooks; throwing would abort the
  plugin scan. Drills: the same scan suite's trust cases.
- `src/core/judge/same/scheduler.ts:37`,
  `src/core/judge/same/batches.ts:252`, `src/core/judge/use.ts:157`: the
  failure itself crosses to the owner's documented error channel after the
  entry settles failed; nothing is translated. These pure scheduling
  modules own no log sink and their options are built by host code.
  Drills: `test/unit/judgeSameSession.test.ts` exact-error forwarding cases.
- `src/core/judge/fast/inspectExec.ts` (211, 325, 355, 369, 380): the
  signal-decided refusal mapping stays refused (the driver settles a
  result, never rejects); the self-test latches off by design; readiness
  failures forward to the gate promise, and a non-Error now keeps its kind.
  Drills: `test/unit/inspectNative.test.ts` (helper paths run on Linux CI;
  the platform parts run everywhere).
- `src/core/locks/fileLease.ts:365`: the module protocol says not proven
  for any reason goes back and waits on (`kept`); only ENOENT retires.
  Drills: `test/unit/fileLease.test.ts` wait and takeover cases.
- `src/core/locks/nodeLeasePort.ts:35`: the port contract says any open
  failure means not rewritten (false); renewal reports false fail-closed,
  and the runtime caller treats a failed renewal as lost. Drills: the
  fileLease renew cases.
- `src/core/locks/processOwner.ts:220`: only ESRCH is provably gone;
  anything else (including garbage pids from corrupt notes) reads alive so
  takeover waits out the lease instead of throwing out of acquire. Drills:
  the fileLease owner cases (birth reads need an unsandboxed rig).
- `src/core/media/record/linux.ts` (156, 243, 459),
  `src/core/media/record/macos.ts` (137, 192, 233, 293) and
  `src/core/media/record/windows.ts` (127, 323, 353): setup and probe
  failures become refused or unavailable runs, never rejections; the person
  gets the true unavailable/refused sentences. Drills:
  `test/unit/linuxRecording.test.ts`, `test/unit/macosRecording.test.ts`
  and `test/unit/windowsRecording.test.ts` (unavailable probes, refused
  setups, skipped directories, unverifiable copies).
- Everything else below: pre-existing, grouped for area-by-area lanes.
- `src/host` root + `src/host/backend` keeps, 0.19.0 lane (each read in
  full; the failure either reaches the caller as data or is proven moot):
  `fsAtomic.ts:649` reports the stage-sweep failure through the caller's
  `warn` hook with the error, and `jobBuild.ts:200` logs the stale-build
  removal with its redacted cause and retries on a later start (both use
  caller-owned channels the classifier does not credit); `fsAtomic.ts:472`,
  `processTree.ts:345`, `toolIo.ts:298` and `importIo.ts:367` are
  best-effort cleanups that must never hide the original failure (a moved
  temp, a vanished process group, a retargeted reservation, an unverified
  import temp) and say so on the catch line; `git.ts:557` rejects with the
  tree-stop failure as the operative error and `git.ts:592` fails the
  take with it; `jobBuild.ts:101` finds the destination already in place,
  which is the rename's goal; `mcpProcess.ts:437/446` answer existence
  probes with `false`; `modelApiEntry.ts:252` resolves a plan model from
  the client's own facts and rethrows anything else; `searchWorker.ts:112`
  reads a file that vanished since listing as undefined and `:166` posts
  the worker failure back as its outcome; `shellJob.ts:131` propagates a
  policy pause and falls back only when the helper is unavailable;
  `toolIo.ts:104` returns the admission failure as the tool result's
  stderr, `:997` refuses before any workspace process starts, and `:1273`
  settles a failed tree stop as a run failure; `helperIntegrity.ts:39`
  reads an unreadable helper as no digest and `:49` still refuses to run
  it; `pluginContainment.ts:71` counts the failed preparation and tries
  the next; `fileScheduleStore.ts:100/:300` keep a crashed receipt's
  mtime as its permanent admission; `legalFixApplier.ts:39/:67` fail
  closed with fixed UI words; `networkPosture.ts:165` reports the probe
  as `ok: false` without repeating untrusted CLI output; and
  `workspaceIdentity.ts:48` reads an unverifiable identity as not
  current.
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

Lane CATCHHOST2 designed baselines (0.19.0; every one read in place, its
fail-closed words proven by a real-failure test unless noted):

- `src/host/auth/cliAccount.ts` (2): the credential-file tri-state
  boundary — missing (ENOENT/ENOTDIR) reads as absent, anything else as
  `unrecognized` with the `unreadable` signature; never a value from the
  file, never a throw (`cliCredentialFile` tests: a real missing file, real
  garbage).
- `src/host/auth/credentialRead.ts` (3): every SecretStorage, provider-list
  and provider-entry failure maps onto the closed `unreadable` kind and
  warns once per kind with the kind only; presence answers stay tri-state
  and never read as absence.
- `src/host/editor/verifyEditor.ts` (2): a file that cannot be stat or read
  cannot be compared, so it stays "not checked"; the check reruns on the
  next report (vscode-bound, no logger seam).
- `src/host/judge/museCodeSameJudge.ts` (1): a temp folder that cannot be
  removed is logged through `failureForLog` directly (the unverifiable
  `describeFailure` seam is removed) and disposal continues.
- `src/host/models/accountsHandler.ts` (1): only fixed bridge codes leave
  (`providersInvalid`, `invalidAccount`, `notOffered`, `unavailable`); a raw
  adapter error, which may contain a credential, never crosses
  (`accountsHandlerErrors` tests).
- `src/host/prompts/promptEntry.ts` (3): the `safePromptFailure` boundary —
  fixed words to the log and the surface, the cause discarded by design
  since it may hold paths or prompt text (`promptFailure` tests).
- `src/host/runners/sshRunner.ts` (4): every probe and act failure releases
  admission and answers fixed notices or `uncertain`/`offline`; the runner
  carries no logger seam (`sshRunnerUnreachable` test: a real refused
  connection).
- `src/host/support/reportJournal.ts` (13): storage failures centralize in
  `disable(error)` — one warn with the closed code, `isAvailable` false
  afterwards; a marker a peer just consumed races as missing, and anything
  else stays for the next start rather than producing an offer from garbage.
- `src/host/support/reportProblem.ts` (4): export answers stay in the fixed
  `ReportExportOutcome` vocabulary; a refused browser open reads as not
  opened (`reportProblemOutcomes` tests).
- `src/host/support/reportRecorder.ts` (1): a load failure hands the
  original error to `onUnavailable` and answers undefined
  (`reportRecorderUnavailable` test).
- `src/host/tab/tabBundle.ts` (1): completions stay quiet when the provider
  is not loaded yet — typing never breaks (vscode-bound).
- `src/host/team/processLifetime.ts` (4): probes answer false as capability
  data; an unreadable cgroup stays `uncertain`, never invented proof; the
  kill-signal fallback re-reads the scope file — a two-failure decision
  (absent cgroup keeps `uncertain`, anything else rethrows the signal
  failure) the classifier cannot express.
- `src/host/team/teamJournal.ts` (3): reads answer the typed `JournalRead`
  (`missing`, `broken`, record); torn records stay as evidence and are never
  moved without authority (`teamEvidence` tests: real torn files).
- `src/host/team/windowHints.ts` (1): an unreadable journal disables hints
  and reads none; the owner is notified through `disabled()`
  (`windowHintsRecovery` tests: a real blocking file, a real fatal file).
- `src/host/voice/voiceProcesses.ts` (2): helper failures reach the
  listeners as `error` events (an abort reads as a SIGTERM exit); the
  emitter is the delivery channel.
- `src/host/web/hookHttpRequest.ts` (1): the retry loop keeps the last
  failure and throws it after the budget; an abort supersedes through
  `throwIfAborted`.
- `src/host/web/webFetchBundle.ts` (1): a bundle-loader failure answers
  `unavailable()`; the loader logged the file and the cause.
- `src/runtime/panel/git/service.ts` spawn-time and held-parent checks
  (2 SWALLOW): fail-closed denies; any unreadable bound root refuses as
  `changed`. Proved on a real repository (`nativeGitService.test.ts`
  binding cases); the catch bodies run only in the check-to-spawn race.
- `src/runtime/panel/git/adapter.ts` form, push, operation and draft
  catches (6 GENERIC + 1 SWALLOW): every failure reaches the person
  (refusals in the panel's fixed words, git's own words redacted first)
  and every form comes back answered; rethrowing would drop the notice
  or strand the form. Proved on real repositories
  (`nativeGitAdapter.test.ts`: swept-root notices, the failed push's
  terminal offer, revoked trust, the failed generation).
- `src/runtime/panel/pullRequests/checkout.ts` batch stream funnel
  (2 GENERIC): a dead child, a bad answer or Cancel rejects the batch
  through one funnel; anything else would strand the checkout.
  Proved with real children (`nativeCheckout.test.ts`: no stdout,
  unclean exit, Cancel).
- `src/runtime/panel/pullRequests/checkout.ts` probes (2 GENERIC +
  1 SWALLOW for `isPresent`/`isMadeFolder`/`folderIdentityOf`): an
  unreadable folder reads as absent, never as verified; the removal
  that never throws depends on it. Proved by the removal tests' kept
  folders (`nativeCheckout.test.ts`).
- `src/runtime/panel/pullRequests/checkout.ts` never-throws cleanup
  (2 GENERIC): a rename or removal that fails is put back, warned with
  its redacted kind, and answered as left; throwing would break the
  cleanup contract. Proved on real folders (`nativeCheckout.test.ts`:
  a foreign-filled folder kept, a warning when git cannot remove).
- `src/runtime/panel/pullRequests/checkout.ts` checkout answer
  (1 GENERIC) and fetch answer (1 GENERIC): a failed checkout must
  answer (the card shows retry), never throw; git's words are
  redacted. Proved with real git (`nativeCheckout.test.ts`: a worktree
  add for a missing commit answers, the folder made is removed).
- `src/runtime/panel/pullRequests/recordGenerations.ts` sync read
  (1 SWALLOW) and proof verification (1 GENERIC): an unreadable head
  reads as no records by contract, and a proof failure lands the
  write unverified, never thrown. Proved by the records suite's
  real-directory generations.
- `src/runtime/panel/pullRequests/records.ts` claim capture
  (1 GENERIC): the maker's failure is kept on the failed claim the
  caller discards; throwing would lose it. Proved with a real
  maker failure (`nativeCheckout.test.ts`: a blocked folder fails
  the claim with its `EEXIST`).
- `src/runtime/main.ts` CLI answers (12 GENERIC + 1 SWALLOW:
  schedules fallback, scan usage, legal/exec barriers, history
  naming, wake refused and unavailable, report probes, key
  presence, report and crash barriers): a command answers in fixed
  words with its exit code and never throws past its barrier; the
  schedule wake reason and the crash line pass the redactor first.
  The report probes degrade an unreadable file to absent so one bad
  file never kills the report.
- `src/runtime/exec/runExec.ts` vault deny, prompt text and result
  computer (1 SWALLOW + 2 GENERIC): no vault answers as vaultless
  with fixed words; the prompt failure's text and the result's
  status travel in the exec result the transport settles; the close
  failure is always recorded, the latch stays first-cause-wins.
- `src/runtime/providersCommands.ts` restore, queue tail, busy,
  warnings and probe answers (3 GENERIC + 1 SWALLOW + 1 CLEANUP): a
  failed restore or a busy commit answers that it failed; the queue
  tail settles either way (its failure travels on the commit);
  advisory warnings degrade to none; the probe answers with its
  refusal or `unreachable`, never throwing past the command.
- `src/runtime/chatGptCallback.ts` (2 SWALLOW + 2 GENERIC),
  `chatGptHost.ts` (2 GENERIC), `chatGptRefreshLock.ts` (1 GENERIC):
  fixed-vocabulary sign-in errors (the core class carries the code,
  hosts render their own sentences); the loopback answers 400s for
  bad requests and the waiter always settles. Proved on a real
  loopback server (`chatGptCallback.test.ts`, `chatGptHost.test.ts`).
  The command-level answers share the existing
  `chatGptProviderCommands.ts` row above.
- `src/runtime/authCommands.ts` label fallback (1 SWALLOW): an
  unreadable user file labels the provider with its id, always true.
- `src/runtime/cliArgs.ts` sharing parse (1 GENERIC): an unbound
  runner's failure answers `invalid` with its own words; parsing
  must answer, never serve.
- `src/runtime/providerPaths.ts` DNS deny (1 GENERIC) and
  `windowsTrustedPath.ts` trust walk (1 GENERIC): fail-closed; an
  unresolvable name or an unreadable step refuses. Proved with a
  real `.invalid` lookup and a blocked ACL walk
  (`providerPaths.test.ts`, `windowsTrustedPath.test.ts`).
- `src/runtime/panel/git/transaction.ts` renew loss (1 SWALLOW):
  a failed lease renewal marks the transaction lost, which refuses;
  fail-closed.
- `src/runtime/exec/execFetch.ts` stream forward (1 GENERIC): a
  body read failure is forwarded into the wrapped stream the
  consumer reads; dropping it would hang the consumer.
- `src/runtime/exec/scanSecrets.ts` scanner refusal (1 GENERIC)
  and `src/runtime/reportCommand.ts` journal/build/save fallbacks
  (1 SWALLOW + 2 GENERIC): the scanner refuses with usage rather
  than echoing; the report names each failed stage in fixed words
  with its exit code. Proved (`scanSecrets.test.ts`,
  `reportCommand.test.ts`).
- `src/runtime/namedLock.ts` kill probe (1 GENERIC) and
  `runtimeAccountingEntry.ts` settings read and estimate fallback
  (1 GENERIC + 1 SWALLOW): only `ESRCH` collects a lock entry (alive
  or foreign stays); a missing settings file takes the default
  while a damaged one throws its kind with its cause; Cancel
  propagates out of counting while other failures estimate.
- `src/runtime/exec/providerExec.ts` DNS refusal (1 GENERIC): an
  unanswered name refuses as unreachable with nothing sent, carrying
  its cause where the gate cannot see positional causes. Proved
  (`providerExec.test.ts`).
- `src/runtime/backends.ts` readiness read (1 GENERIC): a refused
  providers file keeps its own words, a stored-grant failure keeps
  its words through the lazily loaded provider port (a value import
  would drag provider code into the engine bundle, failing the
  split gate), a store failure reads as the store-down condition
  (signed out with the store-down flag), and anything else resolves
  plain unavailable without the flag, so readiness answers instead
  of rejecting into its callers. Proved over the real backend with
  a denying store on both arms (`backendsReadiness.test.ts`).

- `src/core/schedules/delivery.ts` lease catch: a lease the target never
  granted settles the occurrence as failed under the fixed
  `scheduleCommandFailed` sentence; the fire record carries no cause slot
  (shared schema), and the person reads the true outcome.
- `src/core/schedules/reportAction.ts` run + tool catches: a throwing
  provider or admission settles as failed / refused under fixed sentences
  because the failure may carry paths, recipients or credentials; proven
  by `test/unit/scheduleReportSecrecy.test.ts` (no provider text reaches
  the settled record).
- `src/core/team/roles.ts` catalogue + file catches: an unreadable root
  or role file fails closed into an `unreadable` refusal; the refusal in
  the unknowns record is what the person reads. Only the read can throw
  there (parses return their failures), so the label is true.
- `src/core/schedules/unattended.ts` root catch: an unreadable workspace
  root fails closed into the protected refusal below, retried on the next
  decision; the refusal is the record.
- `src/core/schedules/journal.ts` retire catch, `src/core/schedules/store.ts`
  prune catch, applied-marker catch and the three claim-retirement
  catches: retirement and pruning are debt, not the committed
  transaction; a failed entry waits for the next maintain instead of
  failing the pass, and the entry is kept (never deleted around).
- Everything else below: pre-existing, grouped for area-by-area lanes.
- CATCHTEAM2 (2026-10-18, macmini rig) burned down browser, orchestration,
  providers and team as far as honest narrowings reach: 23 GENERIC and 8
  SWALLOW fixed at their cause (each proven by a real-code test that fails
  when the narrowing names the wrong failure; pure rephrasings excluded).
  The 24 GENERIC and 6 SWALLOW below stay because the handler is already
  the true outcome — a fail-closed deny, a fixed-vocabulary settlement, a
  delivery channel the classifier cannot see, or a best-effort degradation
  the results name. Each names its evidence.
- `src/core/browser/browserPolicy.ts` (4 fixed): malformed addresses narrow
  to the parser `TypeError`; anything else reaches the caller.
  Proven by `test/unit/browserPolicy.test.ts` (7 tests; wrong-kind drill
  fails 3).
- `src/core/browser/checkProxy.ts` (2 fixed): malformed destinations narrow
  to the parser `TypeError`. Proven by `test/unit/browserProxyRefusals.test.ts`
  over real loopback wire bytes (wrong-kind drill fails).
- `src/core/browser/cdpPipe.ts` (1 fixed): a broken write rejects with the
  failure itself (no `String(error)` wrap). Proven by
  `test/unit/cdpPipeSend.test.ts` on a real closed descriptor (wrap drill fails).
- `src/core/browser/browserRun.ts` orFail/prepare/spawn/checked (4 kept):
  step failures settle the check under the step's fixed failure kind and the
  lifetime's own end passes through; the caller reads the closed kind
  taxonomy (`browserRun.ts:128-196`). No other slot exists for a cause.
- `src/core/browser/canaries.ts` bind catches (2 kept): a failed bind
  degrades the fixture (`own` stays undefined); the plan carries nulls and
  the verdict reads `unverifiable`, never a false pass (`canaries.ts:380,479`).
- `src/core/browser/checkProxy.ts` dial loop (1 kept): every address is
  tried and the last failure is rethrown (`throw last`); the caller gets the
  real dial error. Loopback dial-refused paths are unproven in this lane's
  runs (no listener test was added); the rethrow is by inspection.
- `src/core/browser/checkProxy.ts` forward/tunnel catches (2 kept): an
  upstream dial failure answers 502/DENIED with an observation; upstream
  detail never reaches the page.
- `src/core/browser/pageCheck.ts` watch catch (1 kept): a failed watch
  setup ends the target `unwatchable` — the delivered verdict, not a hidden
  failure; no ready entry is kept.
- `src/core/orchestration/playbook/guard.ts` (1 fixed): the dead catch is
  gone — pure string matching cannot throw, and `false` would hide the
  warning it reports.
- `src/core/orchestration/playbook/journal.ts` (2 fixed): read failures
  carry their cause on `PlaybookHistoryLostError`; malformed lines narrow to
  `SyntaxError`. Proven by the journal block in
  `test/unit/playbookSurface.test.ts` (3 tests; wrong-kind drill fails).
- `src/core/orchestration/playbook/outcomes.ts` verify + cleanup catches
  (4 kept): every attempt settles as fail with secret-scrubbed output
  (scrubbed at the throw, at the catch and at the return boundary); a
  cleanup failure settles as fail, never pass.
- `src/core/orchestration/playbook/policy.ts` drift catch (1 kept): drift is
  proven by the digest mismatch before the `try`; the itemized detail is
  best-effort and the `configDrift` refusal stands with or without it.
- `src/core/orchestration/playbook/policy.ts` admission + verifyWork catches
  (2 kept): verification failure refuses as `unverifiedCommit`
  (fail-closed); raw hook output reaches the person second-scrubbed via
  `redactSecrets`, never journalled.
- `src/core/orchestration/panelPlaybook.ts` interval catch (1 kept): a failed
  renewal tears the review down (`close` + `stopReview`) and funnels the
  failure to the harness `failure` event; an interval callback cannot throw.
- `src/core/orchestration/playbookIntegration.ts` renewal catch (1 kept): the
  renewal failure aborts the work and is rethrown to the caller after the
  effect settles; a non-Error is normalized because an interval callback
  cannot throw.
- `src/core/team/teamMerge.ts` (4 fixed): merge failures carry their cause
  on `TeamMergeError`; missing paths read absent through the inline ENOENT
  shape (the unblessed local reader is gone).
- `src/core/team/teamWorkspaces.ts` ref read (1 fixed): the probe uses
  `--quiet` so absence exits 1 and breakage 128; only exit 1 reads absent.
  Proven by `test/unit/teamWorkspaceRefs.test.ts` over real git (measured:
  bare `rev-parse --verify` exits 128 for a missing ref too; wrong-code
  drill fails both tests).
- `src/core/team/workers/acpWorker.ts` fs catches (2 fixed): only the fence's
  confinement refusal reads "outside the working copy"; real I/O failures
  reach the caller. Proven by `test/unit/teamWorkerFs.test.ts` over the
  native fence I/O (wrong-shape drill fails; an escape to a nonexistent
  path truthfully throws ENOENT).
- `src/core/team/workers/acpWorker.ts` runner catch (1 fixed): the cancel
  extracted to a named cleanup so the outer handler reports (typed throw
  with the failure); the extracted cancel names its mootness.
- `src/core/team/workers/workerFence.ts` glob + admission checks (3 fixed):
  over-limit globs narrow to `RangeError`; the two call-site admission
  checks narrow to the fence's brand (the only thing `assertWorkerRoot`
  throws).
- `src/core/team/workers/workerFence.ts` admission boundaries (2 kept):
  `assertWorkerRoot` and `confineWorkerPath` fail closed — any unproven root
  or unresolvable target refuses as unadmitted; the fixed words are true.
- `src/core/team/teamPool.ts` sweep catch (1 kept): a background sweep
  failure is funneled to the harness `failure` sink and the sweep
  reschedules; a tick must not kill the scheduler.
- `src/core/providers/configured.ts` secret + stream catches (2 fixed):
  malformed stored secrets narrow to `SyntaxError`; stream non-Errors keep
  their kind (the old `actionFailed` wrap contradicted the pass-unchanged
  comment above it).
- `src/core/providers/configured.ts` send/stream/probe catches (4 kept):
  ambiguous dispatch liability settles into typed errors (the
  `UserRefusalError` carries its cause; the ambiguous-retry error is a fixed
  sentence with no echoed diagnostics, by comment); the stream's
  `controller.error` is the consumer's delivery, mapping only connection
  loss onto the coded sentence with closed-vocabulary detail; probe failures
  read as the documented RVPROVERR sentences.
- `src/core/providers/subscriptions/chatgpt.ts` + `registry.ts` body catches
  (7 fixed: 3 + 4): malformed tokens, answers, catalogues, plan bodies and
  stored grants narrow to `SyntaxError`. Proven by the malformed-bodies
  block in `test/unit/chatgptPlanCatalogue.test.ts` (5 tests over real
  `Response` objects and real malformed bytes; wrong-kind drill fails all
  5 — note the claims test needs a schema-valid header to reach the JSON
  parse).
- `src/core/providers/subscriptions/chatgpt.ts` crypto + guard catches and
  `registry.ts` fetch catch (4 kept): a failed crypto verification reads
  `invalid-id-token` (only the public JWK and the presented token are
  involved); typed sign-in errors pass through and untyped failures are
  named by the closed-vocabulary `failureCodeNames` (codes/names only, never
  messages) into `chatGptFailureText`'s per-code sentence.
- `src/core/providers/subscriptions/chatgpt.ts` callback guard (1 fixed):
  the interim-rejection handler names its mootness (the wait below reaps the
  outcome).

| Folder                 | GENERIC | SWALLOW |
| ---------------------- | ------- | ------- |
| src                    | 688     | 180     |
| src/acp                | 18      | 0       |
| src/core               | 314     | 114     |
| src/core/backends      | 79      | 14      |
| src/core/bestOfN       | 3       | 0       |
| src/core/browser       | 5       | 5       |
| src/core/codeIntel     | 2       | 0       |
| src/core/connector     | 5       | 1       |
| src/core/context       | 0       | 0       |
| src/core/developer     | 1       | 0       |
| src/core/estimator     | 4       | 0       |
| src/core/eval          | 5       | 0       |
| src/core/events        | 0       | 0       |
| src/core/export        | 0       | 0       |
| src/core/git           | 3       | 1       |
| src/core/import        | 7       | 4       |
| src/core/judge         | 8       | 0       |
| src/core/legal         | 1       | 6       |
| src/core/locks         | 4       | 4       |
| src/core/media         | 16      | 6       |
| src/core/memory        | 0       | 0       |
| src/core/orchestration | 8       | 1       |
| src/core/plans         | 1       | 0       |
| src/core/prompts       | 0       | 0       |
| src/core/providers     | 11      | 0       |
| src/core/questions     | 0       | 0       |
| src/core/reporting     | 24      | 7       |
| src/core/resources     | 25      | 14      |
| src/core/review        | 4       | 2       |
| src/core/schedules     | 4       | 1       |
| src/core/support       | 0       | 0       |
| src/core/tab           | 4       | 0       |
| src/core/team          | 3       | 0       |
| src/core/usage         | 1       | 0       |
| src/core/vault         | 65      | 41      |
| src/core/voice         | 7       | 3       |
| src/core/web           | 2       | 0       |
| src/host               | 113     | 21      |
| src/host/auth          | 5       | 0       |
| src/host/backend       | 15      | 6       |
| src/host/bestOfN       | 0       | 0       |
| src/host/browser       | 2       | 0       |
| src/host/checkpoints   | 1       | 0       |
| src/host/commands      | 1       | 0       |
| src/host/conversation  | 6       | 0       |
| src/host/editor        | 2       | 0       |
| src/host/estimator     | 2       | 3       |
| src/host/git           | 2       | 0       |
| src/host/ide           | 0       | 0       |
| src/host/judge         | 1       | 0       |
| src/host/media         | 1       | 1       |
| src/host/mention       | 0       | 0       |
| src/host/models        | 1       | 0       |
| src/host/paid          | 8       | 0       |
| src/host/prompts       | 3       | 0       |
| src/host/providers     | 8       | 9       |
| src/host/resources     | 0       | 0       |
| src/host/review        | 1       | 0       |
| src/host/runners       | 4       | 0       |
| src/host/schedules     | 2       | 0       |
| src/host/skills        | 3       | 1       |
| src/host/support       | 19      | 0       |
| src/host/tab           | 2       | 0       |
| src/host/team          | 6       | 0       |
| src/host/usage         | 0       | 0       |
| src/host/vault         | 8       | 0       |
| src/host/views         | 0       | 0       |
| src/host/voice         | 2       | 0       |
| src/host/web           | 2       | 0       |
| src/host/whatsNew      | 0       | 0       |
| src/runtime            | 209     | 35      |
| src/runtime/companion  | 2       | 6       |
| src/runtime/connector  | 5       | 2       |
| src/runtime/estimator  | 3       | 0       |
| src/runtime/exec       | 6       | 2       |
| src/runtime/fonts      | 2       | 0       |
| src/runtime/github     | 2       | 2       |
| src/runtime/legal      | 8       | 1       |
| src/runtime/panel      | 19      | 6       |
| src/runtime/playbook   | 1       | 0       |
| src/runtime/providers  | 2       | 0       |
| src/runtime/questions  | 0       | 0       |
| src/runtime/reporting  | 32      | 2       |
| src/runtime/resources  | 7       | 0       |
| src/runtime/schedules  | 14      | 3       |
| src/runtime/sharing    | 1       | 0       |
| src/runtime/usage      | 1       | 0       |
| src/runtime/vault      | 45      | 0       |
| src/shared             | 1       | 0       |
| src/shared/hostApi     | 0       | 0       |
| src/shared/l10n        | 0       | 0       |
| src/shared/reference   | 0       | 0       |
| src/webview            | 33      | 9       |
| src/webview/components | 4       | 0       |
| src/webview/estimator  | 0       | 1       |
| src/webview/media      | 7       | 0       |
| src/webview/models     | 1       | 0       |
| src/webview/playbook   | 3       | 0       |
| src/webview/prompts    | 5       | 0       |
| src/webview/schedules  | 3       | 0       |
| src/webview/sharing    | 3       | 0       |
| src/webview/state      | 1       | 0       |
| src/webview/usage      | 1       | 0       |
| src/webview/voice      | 0       | 8       |
