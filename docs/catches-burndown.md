# Catch burn-down list (D119)

Every site the corrected catch classifier accepts lives in
`scripts/catch-baseline.json` (1,618 identities at the
media/import/locks/judge lane regen: 1,347 after PR161FIN, plus the lanes'
new reasoned sites; the join regenerates once for all areas, so this
number moves until then). New sites still fail `npm run check:catches`.
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
| src/core/import        | 7       | 4       |
| src/core/judge         | 8       | 0       |
| src/core/legal         | 3       | 3       |
| src/core/locks         | 3       | 0       |
| src/core/media         | 8       | 2       |
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
