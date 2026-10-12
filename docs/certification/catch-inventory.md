# Catch inventory (CATCHAUDIT lane, 2026-10-12)

Branch `fix/catch-audit` from main `f8435aaac`. Tool, ratchet and the two
smallest areas (`src/acp`, `src/webview`) are done here; `core`, `host`,
`runtime` and `shared` are reported, not touched. The lead opens one fix
lane per area from the worst list below.

## Full counts (scanner `node scripts/catch-inventory.mjs`, this tree)

| Area    | SWALLOW | GENERIC | Total catches |
| ------- | ------- | ------- | ------------- |
| acp     | 0       | 0       | 70            |
| core    | 190     | 352     | 976           |
| host    | 67      | 245     | 764           |
| root    | 2       | 6       | 20            |
| runtime | 51      | 173     | 386           |
| shared  | 4       | 9       | 15            |
| webview | 0       | 0       | 68            |

Before/after for the fixed areas: acp SWALLOW+GENERIC 40 to 0;
webview SWALLOW 42 to 0, GENERIC 17 to 0. Core/host/runtime/shared
product code is untouched: their SWALLOW falls since the first baseline
(core 212 to 190, host 74 to 67, runtime 58 to 51) come from the
classifier's leading-comment rule for CLEANUP, and the baseline was
regenerated to match. `npm run check:catches` exits 0.

## The 40 worst in core, host and runtime

Ranked by what the handler can hide: money and consent first, then
credentials, then data loss, then the person's work in a turn. Each line
was read, not guessed from the snippet.

Money and consent:

- `src/core/paid/paidConsent.ts:888` — a corrupt grant generation parses
  as epoch-less, so the grant loses its order and the failure looks like
  a fresh grant.
- `src/core/paid/paidConsent.ts:402` — a quote-order failure returns
  undefined, so the approved use goes ahead once with no durable order.
- `src/core/paid/paidConsent.ts:578` — a quote-grant save failure is only
  warned, so "always" silently stops sticking.
- `src/core/paid/paidConsent.ts:375` — a remember-grant failure logs the
  raw error message and returns false, leaking message text into the log
  while hiding why "always" did not stick.
- `src/host/models/sessionBudget.ts:162` — a budget write failure
  surfaces the raw error message in the failure sentence, which can name
  paths or accounts.
- `src/runtime/exec/runLedger.ts:235` — a charge-computation throw
  becomes `refuse('unpriced')`, so a pricing bug reads as a missing price.
- `src/runtime/paidGrants.ts:139` — an unreadable quote folder reads as
  no quotes, so stored "always" grants are silently ignored and the
  person is asked again.
- `src/core/estimator/prices.ts:128` — a cache read failure only sets a
  flag, hiding cache corruption from the refresh decision below it.
- `src/runtime/resources/history.ts:113` — an unreadable history choice
  reads as no consent (fail-closed, but a corrupt settings file is
  indistinguishable from a refusal).
- `src/runtime/schedules/consent.ts:19` — a corrupt consent file throws
  one fixed code, hiding corruption versus hostile JSON.

Credentials:

- `src/host/auth/accountHost.ts:83` — an account-state read failure
  returns undefined, so a broken host reads as "no account".
- `src/host/auth/credentialStore.ts:98` — a secret-store read failure
  returns true, so presence is assumed exactly when the store cannot say.
- `src/host/providers/credentialRecords.ts:110` — an origin-parse
  failure returns false, hiding whether the record or the request was
  malformed.
- `src/host/providers/accountSecrets.ts:46` — an unparseable stored
  secret throws one fixed code, hiding corruption versus a wrong shape.
- `src/core/mcp/oauth/discovery.ts:129` — a metadata-parse failure calls
  the never-returning `oauthDenied()`; fail-closed but flagged, see the
  conservatism note below.
- `src/core/mcp/oauth/client.ts:155` — same never-returning deny on the
  multiplexed tail; fail-closed but flagged.
- `src/core/vault/crypto.ts:170` — any decrypt failure becomes
  `VaultError('authentication')`, hiding corruption versus a wrong key.
- `src/core/backends/musecode/credentialFile.ts:99` — an unparseable
  credential file reads as `unrecognized`, hiding corruption versus an
  unknown shape.
- `src/core/providers/accountCredentialRecord.ts:20` — an unparseable
  origin reads as not-a-URL-credential, hiding which side was malformed.
- `src/host/models/modelsPanel.ts:246` — any credential-snapshot
  failure becomes `importNeedsKey`, so a store outage reads as a missing
  key.

Data loss:

- `src/core/backends/modelapi/ModelApiHost.ts:14098` — a checkpoint-end
  failure is only warned, so the turn proceeds with no checkpoint and
  the person never knows the safety net is gone.
- `src/core/prompts/promptStore.ts:135` — any list failure throws
  `promptStoreDamaged`, so a transient lock reads as a damaged store.
- `src/host/backend/museCodeBackendManager.ts:631` — a workspace-path
  failure throws one fixed sentence, hiding which path was unresolvable.
- `src/core/plans/planStore.ts:253` — any undecodable plan throws
  `textFileInvalid`, the fixed sentence from the 2026-10-11 defects.
- `src/core/backends/modelapi/tools.ts:1138` — a format-on-edit failure
  warns with the raw error message, leaking message text into the
  formatter output.
- `src/host/backend/fileScheduleStore.ts:269` — a corrupt schedule file
  throws one fixed code and refuses migration, hiding the parse detail.
- `src/host/checkpoints/checkpointHost.ts:438` — a pre-run check
  failure becomes an opaque shell refusal, hiding why the work was
  refused.
- `src/host/checkpoints/writeJournal.ts:146` — a corrupt checkpoint
  line parses as absent, so history silently loses a line (the "not
  exact" shape from the 2026-10-11 defects).
- `src/core/orchestration/playbook/journal.ts:190` — a corrupt playbook
  line parses as absent on purpose (privacy comment); the record is
  still gone.
- `src/core/backends/modelapi/ModelApiHost.ts:1805` — an unparseable
  turn document falls back to `save`, so a lost create-intent is filed
  as a save.

The person's work in a turn:

- `src/core/attachments.ts:274` — any undecodable attachment reads
  `textFileInvalid`, the fixed sentence from the 2026-10-11 defects.
- `src/core/backends/modelapi/client.ts:328` — a price-lookup throw
  becomes undefined, so the budget guard prices blind.
- `src/core/backends/modelapi/codecs/anthropic.ts:410` — unparseable
  tool arguments ride as `{}`, so the call runs with empty input.
- `src/core/backends/modelapi/codecs/chat.ts:289` — an undecryptable
  reasoning envelope reads as absent, dropping the reasoning silently.
- `src/core/backends/modelapi/codecs/gemini.ts:557` — unparseable
  function-call arguments ride as `{}`, so the call runs with empty
  input.
- `src/core/backends/modelapi/argumentPreview.ts:133` — a preview-build
  failure only marks the preview invalid, hiding the preview bug.
- `src/core/backends/modelapi/autoCompactionAdmission.ts:106` — a
  reserve-amount throw becomes undefined, so compaction proceeds with
  no reserve.
- `src/host/conversation/conversationController.ts:4131` — a resume
  failure warns and starts fresh; the lost context is visible only as
  one warning line.
- `src/core/backends/modelapi/codeIntelCalls.ts:47` — unparseable tool
  arguments read as absent, hiding malformed model output.
- `src/core/backends/modelapi/codecs/ollama.ts:106` — an undecryptable
  thinking block is dropped, so the turn continues without its
  reasoning.

Classifier conservatism (checked while ranking, not fixed here): the
three `oauthDenied()` handlers above throw through a `never` helper the
classifier does not follow; `ModelApiHost.ts:13879`,
`memoryStore.ts:651` and `providersFile.ts:299` throw or record with
the cause and are flagged only because the shape is unrecognised;
`schedules/store.ts:632` keeps the pending finalization on failure,
which is the correct retry direction. Fix lanes should confirm each
before rewriting, and may teach the classifier `never` helpers.

## Proofs

- Classifier tests: `test/unit/catchInventory.test.mjs`, 13 passed,
  including one fixture example per class and the nested-function,
  fixed-string-log, awaited-promise and leading-comment shapes.
- Ratchet: `npm run check:catches` exits 0 against the regenerated
  `scripts/catch-baseline.json`.
- Drill: planting `catch { return 0 }` in `src/__catch_drill__.ts` made
  the check exit 1 (`root: GENERIC rose from 6 to 7`); removing it
  returned exit 0 with `All catch counts match the baseline`.
- Owning suites of every file changed, run directly with
  `npx vitest run <files> --maxWorkers=3`: `App.test.tsx` 191 passed;
  `acpEstimate` + `acpVault` + `serviceStatusRow` 31 passed; pure +
  bridges + `links` 15 passed; `stepSummary` + `toolPresentation` +
  `companionMediaTransport` 49 passed; `installTable` +
  `workflowDetails` + `goals` 34 passed. Two failures are pre-existing
  on pristine HEAD and untouched: `acpAgent.test.ts` "exposes all three
  ChatGPT actions" and `acpReports.test.ts` "cancels local generation".
- Typechecks: host, webview, unit, e2e and integration all report zero
  errors. The unit run caught two real test bugs (a wrong l10n table
  and a narrow message-source type), fixed before committing.
- eslint `--max-warnings=0` clean on every touched file; prettier
  applied. Foreign-failure staging uses `mockRejectedValue` with
  `unknown`-typed reasons, which satisfies both promise and throw
  rules without disables.
- knip reports only its two pre-existing configuration hints;
  `node scripts/check-l10n.mjs` reports 0 problems. Not run in this lane:
  the production build and the full unit suite (time box); every commit
  hook ran its lint-staged pass with hooks on.
