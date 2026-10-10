# MINOUT — never send an output cap below the provider's minimum

Macmini rig, `fix/min-output-cap`, base `82d50d5e4` (0.17.0), 2026-10-10.
No dependency, runtime UI, model call or credential was added. Golden
requests are byte-identical when no budget is set (the floor only fires
inside a budget reservation).

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
  below 16 is still sent as configured; only budget lowering refuses.

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
