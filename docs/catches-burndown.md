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
