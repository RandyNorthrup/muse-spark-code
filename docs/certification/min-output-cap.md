# MINOUT — never send an output cap below the provider's minimum

Macmini rig, `fix/min-output-cap`, base `82d50d5e4` (0.17.0), 2026-10-10.
No dependency, runtime UI, model call or credential was added. Golden
requests are byte-identical for valid caps (no-budget Meta bodies still send
32,768); sub-minimum static caps are refused at configuration validation and
before send (round 2).

## Captured fact

Lead's live Meta capture, 2026-10-10 20:13 UTC,
`muse-spark-1.3-contributor`: `POST /v1/responses` with
`max_output_tokens: 1` returns HTTP 400 `invalid_request_error`, param
`max_output_tokens`, message "`max_output_tokens` The number must be
`>= 16`."

## Bug

`reserveRequest` in `src/core/backends/modelapi/sessionBudget.ts` refused
only when the budget afforded fewer than 1 output token, then lowered
`max_output_tokens` to what was affordable. A nearly spent session budget
affording 1–15 tokens sent a request Meta rejects with a 400 instead of
stopping the turn with the honest session-budget message.

## Fix

- `src/shared/constants.ts`: `MODEL_API_MIN_OUTPUT_TOKENS = 16` (the one
  source); `EXEC_MIN_OUTPUT_TOKENS` reads it (still 16).
- `src/core/providers/capabilityRecord.ts`: Meta record carries
  `output.minTokens: 16` with this capture as provenance; providers without
  a captured minimum keep the field absent.
- `src/core/backends/modelapi/modelPolicy.ts`: `output.minTokens`,
  `ModelPolicyEvidence.minOutputTokens`, and `minOutputTokensForPolicy`
  (unknown keeps 1). Meta policies get 16.
- `src/core/providers/configured.ts`: registry evidence forwards
  `record.output.minTokens`, so configured providers flow into the policy.
- `src/core/backends/modelapi/sessionBudget.ts`: both reserve paths take
  `minOutputTokens` (default 1, invalid rejected) and throw
  `SessionBudgetExceededError` when affordable output is below it. The cap
  is never rounded up past what the budget affords.
- Callers pass the selected provider's minimum: `ModelApiHost.budgeted()`,
  `hookModelEntry` (1024 fixed cap), `reviewerEntry`. The compaction
  summary budget (`Math.max(1, …)`) is floored at the provider minimum, so
  a tiny window can no longer build a sub-minimum request cap.
- Swept and left unchanged: judge transports (copy the main body's already
  floored cap), Tab (fixed 608/1536 caps, binary fit refuses over-budget),
  exec (already refused below 16), paid/hook daily ledgers (reserve as-is,
  never lower), codecs (pass the reserved cap through), connection
  probes/lists (send no output cap). A user-configured static output cap
  below the provider minimum is refused at configuration validation and
  before send (round 2); budget lowering also refuses instead of sending.

## Red drills (macmini, repo-default timeout)

- New unit tests failed on unfixed code (5 failures across
  `sessionBudget`, `modelPolicy`, `capabilityRecord`), then passed after
  the fix (88/88).
- Guard broken on purpose (`minOutputTokensForPolicy` forced to 1): the
  host drill `stops with the budget message when the cap affords fewer
than sixteen output tokens` failed (a 10-token request was sent);
  restored byte-exact (`git diff` shows only the intended hunks) and the
  full `modelApiHost` suite passes (670/670).
- Owning suites: `sessionBudget` 42, `modelPolicy` 12, `capabilityRecord`
  34, `modelApiHost` 670 — all green on the final tree.

## Round 2 — static caps (2026-10-10, macmini)

The round-1 residual is closed: configured output caps below the selected
provider's known minimum are rejected during configuration validation and
before a response send. The shared message is “Output cap must be at least
{count} tokens.” It reads the installed language and formats the number at
use time; both new strings have real translations in all fourteen tables.
No cap is increased to make an invalid configuration work.

### Configuration and dispatch audit

| Path                                                  | Admission and result                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider `modelCapabilities.<model>.output.maxTokens` | The override schema compares the cap with `output.minTokens` (unknown retains 1); merged evidence repeats the check. Atomic saves refuse before changing the existing file.                                                                                                  |
| Provider `modelLimits.<model>.outputTokens`           | The entry schema compares the custom limit with that model's declared minimum. Older invalid files refuse on read with the same plain message. The provider-file parser preserves detailed validation messages and retains subscription entries' strict unknown-key refusal. |
| Team pool settings `outputCap`                        | The shared schema rejects sub-minimum Meta engine entries, with qualified and bare model references.                                                                                                                                                                         |
| Team orchestrator settings and Default pool entries   | The snapshot validates the selected/inherited Meta minimum; unknown providers keep 1. These settings are configuration seams: the current worker dispatchers do not read `outputCap`.                                                                                        |
| Shared Model API request builder                      | `outputLimitFor` validates both the configured cap and any smaller resolved provider ceiling. `ModelApiHost.outputCap` retains integer validation and refuses before creating a body, with or without a session budget.                                                      |
| Meta response transport                               | `ModelApiClient.streamResponse` independently refuses a sub-16 cap before spending or sending, including callers outside the main host.                                                                                                                                      |
| Configured-provider response transport                | The bound client checks the selected record's minimum before its codec/send boundary and preserves that message. Synthetic user evidence declares 16 in the regression; no claim of a captured Mistral minimum is made. A valid cap of exactly 16 is sent unchanged.         |
| Headless Meta request boundary                        | The existing minimum-16 request schema now returns the shared plain message while retaining `request_shape`, zero requests and zero dispatches. BYO headless uses the configured-provider boundary.                                                                          |
| VS Code settings                                      | `ExtensionSettings`, setting schemas and manifest expose no separate output-token cap. Shared provider/team validation handles the existing cap configuration.                                                                                                               |
| CLI flags and exec options                            | `cliOptions`, `ServeOptions` and `ExecOptions` expose no separate output-token cap flag. Provider-file validation and the final transport guards cover the existing interfaces. No new option is added.                                                                      |
| ACP configuration                                     | `configOptions()` exposes model, effort and optional account, without an output-token cap. ACP uses the same portable provider services and Model API host/transports.                                                                                                       |

Both configuration and dispatch regressions cover zero, 1 and 15 where
applicable, acceptance at 16, and the unknown-provider one-token behavior.
The README, ACP guide, Help feature catalog and generated reference describe
the rule; the M95 roadmap entry and generated roadmap move with it.

### Qualification

All work runs directly in `/Users/randy/lanes/MINOUT` on macmini. No browser,
paid/live request, dependency installation, credential access, merge or push.
The explicit rig/common brief assigns aggregate `quality` and cross-platform
hosted qualification to the lead; no gate, timeout, ignore or hook is weakened.
The installed hooks use `.husky/_` and the repository's fail-closed stub.

Final owning-suite counts, guard restoration hashes and scoped gate receipts
are recorded below after verification completes.

### Continuation (Muse, 2026-10-10, macmini, same worktree)

The Codex session stopped with the round-2 work uncommitted and one new test
red: `retains Meta's captured minimum for a custom entry without a declared
minimum` (added after Codex's last green run) expected `Output cap must be at
least 16 tokens.` for a capability override cap of 0 but got `… at least 1
token.` Cause: the nested `capabilityOverridesSchema` check fired on the
undeclared-minimum floor (1) and zod dropped the field, so the provider-level
check in `providersFile.ts` never saw the value to report the effective
Meta floor (16). Fix (`src/core/providers/capabilityRecord.ts`): the nested
check now enforces declared bounds only (`minTokens` present); an override
without a declared minimum parses so the provider layer reports its own
effective floor — 16 at Meta's endpoint, 1 elsewhere (unchanged message).
Merging (`resolveModelCapabilities`) still refuses below one token, so no
invalid override can take effect anywhere.

Red drill for the changed guard: restored the unconditional
`output.minTokens ?? 1` check, watched the retention test fail with the
1-token message, restored the file (SHA-256 `b34259ae…bff9972` before and
after, identical).

Owning suites re-run directly in `/Users/randy/lanes/MINOUT` with the repo
default timeout: `configuredProviders` 33/34, `capabilityRecord` +
`providersL10n` + `providerImportExport` 70/70, `execFetch` +
`modelApiClient` + `modelApiLoopGuarantees` 155/155, `modelPolicy` +
`teamConstants` + `providersPolicy` 90/90. The one failure is the pre-existing
loopback test (`pins a loopback HTTP request…`, 5000 ms timeout): this sandbox
cannot bind 127.0.0.1 (round 1's record notes the same block); it passed on
Codex's unsandboxed 13:57 run, and the lead re-runs it outside the sandbox.
`npm run typecheck` (all five projects), changed-file eslint
(`--max-warnings=0`), prettier, and `node scripts/check-l10n.mjs` (0 problems)
are green in this session.

### Round 3 — review RVMINOUT findings (2026-10-10, macmini, same worktree)

All three findings fixed, no residuals.

- P2 (`ModelApiHost.outputCap`, `src/core/backends/modelapi/ModelApiHost.ts`):
  the per-model `outputCaps` cache is removed; the cap is recomputed per
  request from the currently resolved record (`modelPolicy()`, refreshed by
  `resolveModel()` at each turn's `streamAttempt`). A provider-file edit
  between turns can no longer leave a stale cap behind. Minimal and local to
  `outputCap`; the sibling stale-cache class on the argument-previews branch
  is untouched. Regression:
  `picks up a provider-file edit between turns instead of reusing the first
cap` (`test/unit/modelApiLoopGuarantees.test.ts`) resolves a custom entry
  with outputTokens 20, edits the record to outputTokens 64 / minimum 16
  between turns, and requires 20 then 64 on the wire. The old
  cache-reuse test is updated to the new contract (`recomputes the selected
per-model output cap on every request`). Red drill: cache restored, the new
  test fails with `expected 20 to be 64`; file restored byte-exact (SHA-256
  `1c19e523…1b53c5` before and after). Owning suite `modelApiLoopGuarantees`
  44/44 on the final tree.
- P3 (`l10n/ui.ru.json` `outputCapBelowMinimum`): `one` is now `токен` and
  `few` is now `токена`, matching the file's existing token plural.
  (Superseded by round 4 below: review RVMINOUT2 shows this sentence needs
  the genitive, not the standalone nominative nouns.)
- P3 (this file): the round-1 sentences claiming the floor fires only inside
  a budget reservation and that a sub-minimum static cap is still sent are
  corrected to the shipped rule (refused at save and at send) in the present
  tense above.

### Round 4 — review RVMINOUT2 finding (2026-10-10, macmini, same worktree)

One P3, fixed, no residuals. RVMINOUT2 shows `не менее` governs the
genitive, so the round-3 nouns were wrong: 1 read `токен` (should be
`токена`), 2 read `токена` (should be `токенов`); 16 was already the
correct `many` form `токенов`. Fix (`l10n/ui.ru.json`
`outputCapBelowMinimum`): `one`/`other` are now `токена` (genitive
singular; `other` covers fractions, same surface form) and `few`/`many`
are now `токенов` (genitive plural) — the same pattern as the file's
existing `checksStoppedNotice` (`раунда`/`раундов`), corroborated by
Gramota answer 224266 (`не менее одного раза`). Sibling sweep: Polish
`co najmniej` takes the nominative (1 `token`, 2–4 `tokeny`, 5+
`tokenów` — already correct), Czech avoids the noun (`alespoň {count}`),
and the remaining tables have no numeral-driven case, so Russian was the
only table with this defect. Regression: `uses the grammatical Russian
token noun for the output-cap minimum`
(`test/unit/providersL10n.test.ts`) now checks 1/2/5/16/21/22 through
`plural()` against the genitive wording. Red drill: pre-fix strings
restored, the test fails (1 failed, 18 passed); file restored byte-exact
(SHA-256 `309ccdbc…6a7e764c` before and after).
`node scripts/check-l10n.mjs` still reports 0 problems.

- P3 (this file): the round-1 sentences claiming the floor fires only inside
  a budget reservation and that a sub-minimum static cap is still sent are
  corrected to the shipped rule (refused at save and at send) in the present
  tense above.
