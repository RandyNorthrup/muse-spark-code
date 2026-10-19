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

| Folder                 | GENERIC | SWALLOW |
| ---------------------- | ------- | ------- |
| src                    | 9       | 3       |
| src/acp                | 19      | 0       |
| src/core               | 11      | 1       |
| src/core/backends      | 128     | 27      |
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
| src/host               | 6       | 1       |
| src/host/auth          | 8       | 0       |
| src/host/backend       | 10      | 3       |
| src/host/bestOfN       | 1       | 0       |
| src/host/browser       | 10      | 6       |
| src/host/checkpoints   | 14      | 6       |
| src/host/commands      | 17      | 2       |
| src/host/conversation  | 102     | 9       |
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
