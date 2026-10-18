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
- Everything else below: pre-existing, grouped for area-by-area lanes.

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
