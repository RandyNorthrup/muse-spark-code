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
| src                    | 9       | 3       |
| src/acp                | 19      | 0       |
| src/core               | 11      | 1       |
| src/core/backends      | 135     | 27      |
| src/core/bestOfN       | 5       | 0       |
| src/core/browser       | 5       | 5       |
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
| src/core/orchestration | 8       | 1       |
| src/core/plans         | 2       | 0       |
| src/core/prompts       | 2       | 1       |
| src/core/providers     | 8       | 0       |
| src/core/questions     | 1       | 0       |
| src/core/reporting     | 31      | 6       |
| src/core/resources     | 41      | 25      |
| src/core/review        | 4       | 2       |
| src/core/schedules     | 4       | 0       |
| src/core/support       | 0       | 2       |
| src/core/tab           | 5       | 0       |
| src/core/team          | 3       | 0       |
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
