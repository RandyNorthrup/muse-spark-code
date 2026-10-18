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
| src/host/browser       | 2       | 0       |
| src/host/checkpoints   | 1       | 0       |
| src/host/commands      | 0       | 0       |
| src/host/conversation  | 111     | 9       |
| src/host/editor        | 9       | 0       |
| src/host/estimator     | 1       | 0       |
| src/host/git           | 0       | 0       |
| src/host/ide           | 2       | 0       |
| src/host/judge         | 2       | 1       |
| src/host/media         | 1       | 2       |
| src/host/mention       | 1       | 0       |
| src/host/models        | 4       | 2       |
| src/host/prompts       | 4       | 0       |
| src/host/providers     | 5       | 3       |
| src/host/resources     | 1       | 2       |
| src/host/review        | 0       | 0       |
| src/host/runners       | 4       | 0       |
| src/host/skills        | 3       | 0       |
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
