# Provider refusals read as the provider's refusal (lane PROVERR)

Branch `fix/provider-refusals` from `38ef148f19` (release 0.18.1).
Recorded 2026-10-12/13, rig `macmini`, worktree `/Users/randy/lanes/PROVERR`.

Rule: a provider's answered refusal is shown as that provider's refusal, with
its own words and what to do; "… is not available in this build" is said only
when a part of the build is missing. A refusal answered with a 4xx status
before processing releases its reservation in full (settled 0, uncertain 0).

## The measured case (lead, 2026-10-12, released 0.18.1, Windows, real calls)

An Anthropic account ran out of credit. Asked directly with the same key,
Anthropic answers:

- status `400`, body exactly

  `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`

  with a `request-id` header and no rate-limit headers.

Through the product on a configured Anthropic provider entry, the same answer
ended the turn with `Internal error: Models & Agents is not available in this
build.`, result `requests: 1, inputTokens: 0, outputTokens: 0`,
`costUsd.settled "0"`, `costUsd.uncertain "2.262144"`, and the log lines
`Session budget: a response ended without its usage; its remaining reservation
of … USD counts as spent` and `Model API turn … failed: Models & Agents is not
available in this build.` (`providers test` on the same entry says
`Key works · 14 models`, which needs no credit.)

## The raise site that fired

`src/core/providers/configured.ts`, the `streamResponse` catch. On base its
tail was `return fail()`, and `fail()` throws
`new Error(UI_TEXT.modelsPanelUnavailable)` (base `:106`). Measured on base
with the real configured-provider client, codec and session path (seam only
for the socket, which this sandbox forbids; every line below the send is base
code) for the credit bytes:

```text
Error: Models & Agents is not available in this build.
    at fail (src/core/providers/configured.ts:106:9)
    at Object.streamResponse (src/core/providers/configured.ts:800:18)
```

That catch swallowed every send/stream error — including the Anthropic
parser's provider-message error — into a plain `Error` (not a
`ModelApiError`, so no status survived), which is also why the ledger saw "a
response that ended without its usage" and held the reservation as uncertain.
After the fix the same catch builds the refusal sentence (`refusalError`,
`configured.ts:153`) and keeps status/kind/code/request id/wait; the
deliverable test pins `error.stack` containing `configured`.

## Before / after for the nine Part 1 answers

Before-sentence and before-requests measured on base `38ef148f19` with the
same nine byte shapes the deliverable test serves (client boundary, exhausted
retry budget `retriesUsed: 4` on both sides, so the counts compare fairly).
Before-money for credit is the lead's live measurement; the other answers
took the identical swallowed-`Error` path (verified by code reading, not
re-measured live). After-values are asserted by
`test/unit/providerRefusals.test.ts` (loopback; runs on a non-sandbox rig),
the 26-case seam probe run here, and the session/e2e cases for credit.

Provider display name below is `case` (custom entries show their id).

| Answer                               | Before: person told                                              | Before: requests / settled / uncertain | After: person told                                                                                                                                                                                                                                                                | After: requests / settled / uncertain                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 400 credit (measured bytes)          | Models & Agents is not available in this build.                  | 1 / 0 / 2.262144 (lead, live)          | case refused the request: its account is out of credit. Add credit at case; nothing reached a model and nothing was charged for this request. case said: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits. | 1 / 0 / 0                                                                                                               |
| 401 authentication_error             | Same build sentence (plain Error).                               | 1 / 0 / reservation held uncertain     | case refused the request: the stored key was rejected. Store a new case key from Models & Agents; nothing was sent and nothing was charged. case said: invalid x-api-key                                                                                                          | 1 / 0 / 0                                                                                                               |
| 429 rate_limit_error + retry-after 1 | Same build sentence.                                             | 1 / 0 / held uncertain                 | case refused the request for now: too many requests (retry after 1). Try again shortly; nothing was charged for this refusal. case said: Rate limit reached; try again in a minute.                                                                                               | 1 with exhausted budget; retried per table with live budget (2 requests with one retry admitted)                        |
| 529 overloaded_error                 | Same build sentence.                                             | 1 / 0 / held uncertain                 | case refused the request: it is overloaded. Try again shortly; nothing was charged for this refusal. case said: Overloaded; try again shortly.                                                                                                                                    | 1 (the responses table does not list 529); uncertain held — 529 is 5xx, outside the documented-definite set (see below) |
| 400 invalid max_tokens               | Same build sentence.                                             | 1 / 0 / held uncertain                 | case refused the request: the request was invalid; nothing was charged. case said: max_tokens 200000 exceeds the maximum for this model.                                                                                                                                          | 1 / 0 / 0                                                                                                               |
| 404 not_found model id               | Same build sentence.                                             | 1 / 0 / held uncertain                 | case refused the request: it has no such model. Pick a model case lists; nothing was sent and nothing was charged. case said: model: unknown-model-9                                                                                                                              | 1 / 0 / 0                                                                                                               |
| 413 request_too_large                | Same build sentence.                                             | 1 / 0 / held uncertain                 | case refused the request: it was too large. Shorten the conversation or attachments and try again; nothing was charged. case said: Request is larger than 32 MB.                                                                                                                  | 1 / 0 / 0                                                                                                               |
| HTML 502 proxy                       | Same build sentence.                                             | 1 / 0 / held uncertain                 | case answered with an error this build does not recognise (HTTP 502). Try again; the request may have been charged — check usage at case. The answer began: HTTP 502: \<html\>\<body\>Bad Gateway\</body\>\</html\>                                                               | 1 with exhausted budget; uncertain held                                                                                 |
| Close before headers                 | Same build sentence (via the binding-less send catch, status 0). | 1 / 0 / held uncertain                 | Could not reach case. Check the network and the provider address; nothing was sent.                                                                                                                                                                                               | 1; uncertain held (unanswered send)                                                                                     |

Notes on the table:

- Before-requests were measured with an exhausted retry budget, isolating
  the sentence; base live-budget retry counts per answer were not measured.
- After-requests for 500/502-class answers with a live budget follow the
  responses table (which lists 500/502/503/504 but not 529); only the
  exhausted-budget count (1) and the never-retry kinds are pinned per answer.
- The 529 row is honest, not contradictory: the provider rejected before
  processing (so its sentence says nothing was charged), but 529 is a 5xx
  status no provider document places in the definite set, so the product
  keeps the reservation uncertain instead of releasing it. The money rule
  covers answered 4xx only.

## Raise-site table for `modelsPanelUnavailable`

Before (base `38ef148f19`, `git grep`): `src/core/providers/configured.ts`
`:106` (`fail()`), `:295` (binding-less send catch, status 0), `:639`
(per-format `parseError` `default:`), `:997` (key-test `paid` detail);
`src/core/providers/panelSeam.ts:2`; `src/host/backend/modelApiEntry.ts:179`
and `:242`; `src/host/models/modelsPanelBundle.ts:125` and `:137`; the
webview; the l10n table.

After: all `configured.ts` sites build or pass through typed refusals
(`invalidEntry` returns `ModelApiError` status 0 so its true sentence
survives the catch; the per-format table is a total `Record<ProviderFormat>`
with no `default:`); `panelSeam.ts` throws `modelsPanelPartMissing`;
`modelApiEntry.ts` throws `modelApiProvidersMissing`; the key-test `paid`
detail asks the price first (`providerPaidTest`). The key remains only where
a part of the build is truly missing — the two `lazyBundleLoader`
`unavailable` wirings in `modelsPanelBundle.ts` (`:125`, `:137`) — plus the
l10n table itself. `test/unit/modelsPanelUnavailableGuard.test.ts` parses
every `src/**/*.ts(x)` AST and fails on any other read (see drill A).

## Why these statuses are definite "nothing billed"

`isDefiniteRefusal` releases `{400, 401, 402, 403, 404, 413, 422, 429}`.
Fetched 2026-10-13 (docs, no model calls):

- Anthropic, "Claude API errors"
  (`https://platform.claude.com/docs/en/api/errors`): "400 -
  `invalid_request_error`: There was an issue with the format or content of
  your request." / "401 - `authentication_error`: There's an issue with your
  API key" / "402 - `billing_error`: There's an issue with your billing or
  payment information." / "403 - `permission_error`: Your API key does not
  have permission to use the specified resource." / "404 -
  `not_found_error`: The requested resource was not found." / "413 -
  `request_too_large`: Request exceeds the maximum allowed number of bytes."
  / "429 - `rate_limit_error`: Your organization has hit a rate limit …".
- OpenAI, "Error codes"
  (`https://developers.openai.com/api/docs/guides/error-codes`): "401 -
  Incorrect API key provided … Ensure the API key used is correct" /
  "429 - Credit balance exhausted … `credit_balance_exhausted` … Your
  organization has no prepaid credits remaining." / "429 - Rate limit
  reached for requests … follow the `Retry-After` header when it's present"
  / "Retrying billing, spend, or quota errors won't restore API access."
- Gemini, "Troubleshooting guide"
  (`https://ai.google.dev/gemini-api/docs/troubleshooting`): "Only retry on
  transient errors (like `429`, `408`, or `5xx`). Do not retry on client
  errors (like `400`, `402`, or `403`) as they indicate issues like invalid
  API keys, depleted Prepay credits, or bad syntax."

What the documents do NOT say, this lane does not claim: no provider page
states verbatim that a rejected request is never billed. The definite set
rests on each provider documenting these statuses as rejections before
processing (malformed request, bad key, no permission, no such resource, too
large, spend/rate refusal) under usage-based billing, where a refusal carries
no usage object to settle. Accordingly 408, 409 (Anthropic documents
`conflict_error`, processing state ambiguous), every 5xx, and status 0 stay
uncertain — even 529, whose sentence still tells the provider's truth. Ollama
and other local servers bill nothing by construction.

## Red drills (each broke the rule, failed, and was restored byte for byte)

Pre-drill hashes (2026-10-13, `sha256sum`): panelSeam.ts
`d232f028…12da0011`, codecs/anthropic.ts `fb111b04…395112`,
providerRefusal.ts `169eebde…96f214`, l10n/en.ts `78dac686…55ff13db`,
providerClient.ts `1102cac7…a62a1e0fd27e6f6`. Every restore re-matched its
hash and its suite went green.

- A (guard): planted `redDrill()` reading `UI_TEXT.modelsPanelUnavailable`
  in `panelSeam.ts`. Guard failed exit non-zero:
  `AssertionError: expected [ Array(1) ] to deeply equal []` naming
  `src/core/providers/panelSeam.ts:6`. Restored hash-identical; guard 1/1.
- B (parser): `parseAnthropicError` returned the build sentence. 2 failed,
  exit 1 (`maps the invalid-model envelope from the capture`, `marks the
spend cap so the transport never retries it`). Restored; 88/88.
- C (money): dropped 400 from `DEFINITE_NOTHING_BILLED`. The refused-turn
  session test failed exit 1: `expected '0.021867' to be '0'` — the
  reservation counted as spent, the lead's bug reproduced. Restored; green.
- D (retry): wired `isRetryableFailure` to `() => true`. `never retries a
credit refusal` failed exit 1 (a second request went out). Restored; green.
- E (sentence): broke the `providerRefusalCredit` template. The measured
  credit test failed exit 1:
  `expected 'DRILL BROKE THE CREDIT SENTENCE case …' to be 'case refused the
request: its account…'`. Restored; `check:l10n` 0 problems, green.

## Left for the other branches

- Transmission (`fix/stream-limits-class-r5`, release agent): what happens
  after a write — a failure mid-stream, a stall, a close after headers —
  belongs there. This lane's only touch of that region is the
  binding-less send catch keeping the error's kind: a failure before
  anything was written is `providerUnreachable` (status 0, "could not reach
  \<provider\>"); anything after a write is unchanged and stays uncertain.
- Ledger (`fix/spend-ledger`, Codex): only the decision "was this a definite
  refusal" (`isDefiniteRefusal`) and the release call that consumes it
  (`noteRequestRefusal`, `isRefused` at three call sites in `ModelApiHost`)
  were touched. No ledger structure changed.

## What this rig could not run (sandbox forbids `listen(2)`)

`node -e "…listen(0,'127.0.0.1')…"` answers `EPERM` here, so no loopback
server runs on this rig: `test/unit/providerRefusals.test.ts` (26 tests),
the 6 loopback-bound `configuredProviders` cases, and the two new packed e2e
cases (`execStdio` E10, `acpStdio` credit refusal) never ran here. They ran
instead through the `send` seam with identical bytes
(`test/unit/proverrProbe.test.ts`, 26/26 green, deleted before the final
commit), and the before-values above were measured on base the same way.

## What the lead must run

1. The loopback suites on a non-sandbox rig at the repo timeout:
   `npx vitest run test/unit/providerRefusals.test.ts`,
   `npx vitest run test/unit/configuredProviders.test.ts`,
   the packed e2e files (`test/e2e/execStdio.e2e.test.ts`,
   `test/e2e/acpStdio.e2e.test.ts`).
2. One real out-of-credit refusal (the lead's account): the turn must end
   with the credit sentence naming the provider, requests 1, settled 0,
   uncertain 0 — never "not available in this build".
