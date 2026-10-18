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

| Folder                 | GENERIC | SWALLOW |
| ---------------------- | ------- | ------- |
| src                    | 9       | 3       |
| src/acp                | 19      | 0       |
| src/core               | 11      | 1       |
| src/core/backends      | 135     | 27      |
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
| src/host/auth          | 5       | 0       |
| src/host/backend       | 35      | 4       |
| src/host/bestOfN       | 0       | 0       |
| src/host/browser       | 10      | 6       |
| src/host/checkpoints   | 14      | 6       |
| src/host/commands      | 17      | 2       |
| src/host/conversation  | 111     | 9       |
| src/host/editor        | 2       | 0       |
| src/host/estimator     | 0       | 0       |
| src/host/git           | 20      | 5       |
| src/host/ide           | 0       | 0       |
| src/host/judge         | 1       | 0       |
| src/host/media         | 0       | 0       |
| src/host/mention       | 0       | 0       |
| src/host/models        | 1       | 0       |
| src/host/prompts       | 3       | 0       |
| src/host/providers     | 8       | 8       |
| src/host/resources     | 0       | 0       |
| src/host/review        | 11      | 1       |
| src/host/runners       | 4       | 0       |
| src/host/skills        | 10      | 0       |
| src/host/support       | 18      | 0       |
| src/host/tab           | 1       | 0       |
| src/host/team          | 8       | 0       |
| src/host/usage         | 0       | 0       |
| src/host/vault         | 3       | 4       |
| src/host/views         | 0       | 0       |
| src/host/voice         | 2       | 0       |
| src/host/web           | 2       | 0       |
| src/host/whatsNew      | 0       | 0       |
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
