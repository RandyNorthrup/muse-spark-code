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

## Lane PROVERRORS (2026-10-17): errors, retries and backoff per provider

Branch `fix/provider-errors` continued in place on the Windows workstation
(worktree `mx-proverrors`), after merging `origin/main` at `03ae95171b`
(no `main-now` branch exists there). Source of truth: the provider research
of PR #202 (`origin/research/claude-a:docs/research/providers/*.md`, read
2026-10-17), each provider's page re-read on 2026-10-17 where a fix
depended on it. Engine: Claude Opus 5.5.

### Research rows fixed in this lane

| Research file   | Row                                                              | What changed                                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| anthropic.md    | AB13, AD2 (the `Retry-After` half), §4.2 `retry-after` (d)       | The 60 s cap that refused a longer wait is gone (with its sentence in all 15 tables); the backoff no longer cuts a named wait to 60 s.                                                                                                                                   |
| openai.md       | OD3 (the `Retry-After` half), §4 `Retry-After` (d)               | Same change.                                                                                                                                                                                                                                                             |
| gemini.md       | GD4 (the `Retry-After` half), §4 `Retry-After` cap (d)           | Same change.                                                                                                                                                                                                                                                             |
| groq.md         | §4 429 row, cap (d)                                              | Same change.                                                                                                                                                                                                                                                             |
| azure-openai.md | ZB2 (the transport half), ZB5 (the wait half), §4 Retry guidance | `retry-after-ms` is read before `Retry-After` on every refusal and in the pacing observation, and kept on usage records. The reset headers (ZB2's pacing half) are lane PROVM95's.                                                                                       |
| anthropic.md    | AB3                                                              | A retryable error a stream ends with before any content (Anthropic's `overloaded_error`) is sent again under the preset's table, as its 529 would be.                                                                                                                    |
| openrouter.md   | ORB2 (the retry-table half), §3 Retry (b)                        | OpenRouter's own table: 429 and 503 retried; 502 and 408 no longer; the in-flight-budget 402 retried after its `Retry-After`.                                                                                                                                            |
| openrouter.md   | ORB3, §3 Errors (b)                                              | `metadata.error_type` and `metadata.limit_source` are read; `provider_overloaded` is overload; the 403 budget limits read as usage limits.                                                                                                                               |
| openrouter.md   | §3 Mid-stream 429 (b)                                            | The mid-stream error (status in `error.code`) is sent again before any content.                                                                                                                                                                                          |
| zai.md          | ZB2, §4 Errors (b)                                               | 1308, 1309, 1310, 1313, 1314, 1316-1321 stop at once with their own sentence; 1113 credit; 1311 and 1315 permission; 1301 content filter; 1261 too large; 1305 overload (retried). `next_flush_time` is quoted in Z.ai's words, never parsed (its page gives no format). |
| anthropic.md    | §4.1 Response headers, `request-id` (c)                          | Every refusal sentence ends with "(request id …)".                                                                                                                                                                                                                       |

Beyond the research (current pages read 2026-10-17): Gemini's
`quota_exceeded` (daily quota) is a usage limit, not credit; the Gemini
table retries 408 ("Only retry on transient errors (like 429, 408, or
5xx)"); the authentication, permission and not-found sentences said
"nothing was sent" although the provider answered — they now say "nothing
reached a model".

### Research rows found already fixed on this branch (verified, not redone)

anthropic.md AB2 (529/409: the configured path classifies with
`quirksOf(preset).retry`), AB4 (`error.details.error_code`, with the
spend-cap word as the 429 fallback); openai.md OB2 and the §4 401/403 and
429-billing rows (the shape-driven extractor keeps `type`/`code`);
gemini.md GB6; mistral.md "Chat retry table unused"; deepseek.md §4 Retry
(the chat table now applies); xai.md §2 item 4 (the flat envelope is read);
azure-openai.md ZC6 (`content_filter` has its own sentence).

### The lead's addition: "Models & Agents is not available in this build"

The six sites the lead named (on `main`) and what each says on this branch:

| Site on main                                                           | Now                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `configured.ts:106` `fail()`                                           | Removed in round 2: each entry cause has its own sentence (`InvalidEntryCause`).                                                                                                                                                                                                                                                                                                                       |
| `configured.ts:295`, the pinned send's catch                           | A native send failure goes to the transport as it is; a real connection failure (a string failure code in its causes) is retried as a transient send failure and, when it stops, reads "Could not reach \<provider\>: the connection failed (\<Node's codes\>), so whether the request arrived is unknown; …". A refusal of ours raised inside the send passes through unchanged and is never retried. |
| `configured.ts:639`, the parser's default case                         | Removed in round 2: a total table per format; Anthropic goes through `parseAnthropicError` on the turn and the key check.                                                                                                                                                                                                                                                                              |
| `configured.ts:997`, the paid probe detail                             | Round 2: the paid-test sentence; this lane: a no-answer probe failure shows the network codes or the entry's own cause.                                                                                                                                                                                                                                                                                |
| `modelApiEntry.ts:179`, `:242`                                         | Round 2: `modelApiProvidersMissing` (the providers part really is missing there).                                                                                                                                                                                                                                                                                                                      |
| The last-resort catch of the configured `streamResponse` (this branch) | It turned every non-`ModelApiError` into "the action failed", hiding the lead's `SessionBudgetExceededError`. Every refusal of ours now passes through unchanged, with its message and type.                                                                                                                                                                                                           |

New on the same path: a connection lost after the 200 reads "The connection
to \<provider\> was lost after it accepted the request (\<codes\>) …"; the
runtime's `providers test` reads answers and send failures through the same
reader (`providerFailureReader`). `modelsPanelUnavailable` remains only in
the panel bundles' loaders and the panel's page.

### Tests and drills

- Deleted under the owner's no-invented-data rule: `providerRetry.test.ts`
  (its header said "Fakes only."; synthetic failures) and, in
  `providerRefusals.test.ts`, the documented-shape and invented cases. What
  they covered (an OpenAI quota 429, a quota-worded Gemini 429, OpenAI's
  `server_error` override, Anthropic's `details.error_code` spend cap, the
  Azure filter, the xAI unsupported parameter) is listed for capture below.
- `providerRefusals.test.ts` (recorded answers only, 27 tests) now asserts
  the sentence carries the recorded request id. Drill: rendering the wait
  fragment in its place failed 11 recorded cases (exit 1); restored, 27
  pass.
- The bundle-split gate caught `isRetryableStreamFailure` read from
  `dist/modelApi.js` without an export (it would have been `undefined` in the
  product); the export was added before any real use.

### Real use (packed build of this tree, `node dist/acp.js`)

Isolated: `XDG_CONFIG_HOME` and `LOCALAPPDATA` pointed at a scratch folder,
an empty workspace, no stored key read or written (keys over stdin were
made-up strings). Provider calls: 2, both to `api.anthropic.com`, both
refused with 401 ($0).

1. `providers add --preset ollama --as dead --address http://127.0.0.1:59321`
   (a closed port): "Test failed: Could not reach dead: the connection failed
   (fetch failed: ECONNREFUSED), so whether the request arrived is unknown;
   check the network and the provider address." Before: "Test failed: The
   provider could not be reached." (Port 9 is on the Fetch standard's
   blocked list, "bad port", refused locally with no code; it keeps the
   fixed sentence.)
2. The lead's case, a budget stop: daily cap `{"paidDailyBudgetUsd":0.5}`,
   `exec --backend modelApi --provider claude --model
claude/claude-sonnet-4-5 --max-budget-usd 20 --key-stdin`: "Stopped: the
   next request (about $3.40) would pass the session budget of $0.5000
   ($0.0000 used). It was not sent." — requests 0, settled 0, uncertain 0,
   exit 4.
3. Anthropic's real 401 through the turn path: "Anthropic refused the
   request: the stored key was rejected. Store a new Anthropic key from
   Models & Agents; nothing reached a model and nothing was charged.
   Anthropic said: invalid x-api-key (request id
   req_011Cg8a5NHVbTToFjf2VYiyt)" — requests 1, never retried.

### Findings for the lead (not fixed here: outside this lane)

- **A refused request is booked as spent on the headless path.** Run 3
  ended with `uncertain $3.393216`, and a later budget-stop run in the same
  data folder read "($3.40 used)" with nothing ever billed:
  `withRuntimeAccounting` (`src/runtime/runtimeAccountingEntry.ts`, its
  `settle`) releases a reservation only for a 429, not for the other
  definite refusals (`isDefiniteRefusal`). This contradicts the round-1
  CHANGELOG claim ("settled and uncertain stay 0") on the headless path and
  fills the session budget with phantom spend. The lead assigned reservation
  logic to the budget lane.
- A headless run on a custom Anthropic-format entry (person-set limits and
  prices, loopback) stops before dispatch with "This model is not available
  for this run." in two attempts (qualified and bare model id); cause
  UNMEASURED. The turn path's connection failure could therefore not be
  driven headlessly here.

### Open, with the reason

- Retry count (4) and backoff bounds (1 s to 60 s) — anthropic.md AD2/AB13,
  openai.md OD3, azure-openai.md ZB5 (their count halves): the research says
  "user settings", none by default; the providers' current pages ask for a
  maximum ("Define a maximum number of retry attempts to prevent infinite
  loops", Gemini troubleshooting; Azure "5–10"; Meta 3–5 attempts;
  Anthropic's SDK "twice by default"; Gemini's SDK "up to four times …
  approximately 1 second … maximum delay of 60 seconds"). Owner decision:
  whether a provider's SDK default is "the limit set from the provider",
  and where the person's retry limit lives.
- Idle and request timeouts (300 s, 30 s): anthropic.md AD3, openai.md OD6,
  gemini.md GD4 (idle half), azure-openai.md ZD3, chatgpt-codex.md CD2,
  copilot.md CPD2, deepseek.md keep-alive, local-servers.md — timeouts, not
  this lane's area; NOLIMITS2's C1 row (the same timeouts) never landed.
- anthropic.md AC14 (retention 400): the invalid-request sentence already
  quotes Anthropic's own words; a sentence of its own needs a captured
  answer (no documented code).
- azure-openai.md ZC9 (region 404): the Azure route cannot run
  (`wireCapture: false`); lane PROVM95's Azure work.
- mistral.md MC3: the exhaustion error is not documented; capture needed.
- chatgpt-codex.md CB4, CC1, CC2, CC4: the plan route, lane PROVPLAN (the
  same lines of `registry.ts`).
- Rate-limit header readers (anthropic.md AC4, openai.md OB3, azure ZB1,
  groq GQB1, fireworks FWB2, deepseek DB2, together TGB2, xai XB2,
  openrouter ORB2's reader half): lane PROVM95.
- Round-2 review finding 7 (the not-found sentence picks one of xAI's two
  causes): a wording decision, still open.

### Captures that would settle what is UNVERIFIED

One real answer each (no model needs to run for most): a 429 per provider
(rate vs quota, the headers sent); OpenRouter's in-flight-budget 402 and a
mid-stream error chunk; Z.ai 1308, 1310 and 1316 (the `next_flush_time`
format); Anthropic's mid-stream `overloaded_error` and its retention 400;
Gemini's `quota_exceeded` body (the snake_case envelope); Azure's 429 with
`retry-after-ms`; OpenAI's quota 429 and `server_error`; Anthropic's spend-cap
429; Mistral's exhaustion error.

### Lane RETRYLIMITS — documented retry limits per provider (2026-10-17)

Every source below was read 2026-10-17 (PR #202 research files, plus the
PROVERRORS record for the SDK rows; review RVRETRYLIMITS re-read the
OpenAI and Google SDK pages named below on the same date). "Not
documented" means the provider names no maximum retry count / backoff
on the pages read; per the owner's rule no limit of ours applies and
the person's setting decides. Rows whose research file itself records
the retry pages as unread or unverified are marked UNVERIFIED: their
behaviour (unbounded, the person's setting decides) is the same, but
the "not documented" claim itself was not established.

| Provider                                       | Max retries                     | Backoff                                | Source                                                                 |
| ---------------------------------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Anthropic                                      | 2 (SDK default)                 | Exponential, honors Retry-After        | Official SDK (via anthropic.md ERR)                                    |
| OpenAI                                         | 2 (SDK default)                 | Retry-After, else exp backoff + jitter | Error codes page (ERR) + SDK                                           |
| Gemini                                         | 4 (SDK: 5 attempts incl. first) | ~1 s start, 60 s max (SDK)             | Troubleshooting + Google Gen AI SDK                                    |
| Azure                                          | 5-10 (example range)            | retry-after-ms, else exp + jitter      | Learn QUOTAHOW                                                         |
| Meta                                           | 3-5 attempts                    | Exp, honors Retry-After                | dev.meta.ai error handling                                             |
| xAI                                            | Up to 5                         | 2^attempt s (docs examples)            | Rate limits page (RL)                                                  |
| OpenRouter                                     | Not documented                  | Wait Retry-After                       | Errors / limits docs (ERR)                                             |
| Groq                                           | Not documented                  | retry-after seconds only               | Rate limits page (RL)                                                  |
| DeepSeek                                       | Not documented                  | Not documented                         | Rate limits page (RL)                                                  |
| Mistral                                        | Not documented                  | Not documented                         | Pages read                                                             |
| Together                                       | Not documented                  | Exponential, no bounds                 | Rate limits page (RL)                                                  |
| Fireworks                                      | Not documented (UNVERIFIED)     | Not documented (UNVERIFIED)            | No retry row in fireworks.md; its serverless rate-limits page not read |
| HuggingFace                                    | Not documented (UNVERIFIED)     | Not documented (UNVERIFIED)            | huggingface.md: retry guidance "not documented / not verified"         |
| Z.ai                                           | Not documented                  | Wait until next_flush_time             | Errors page (ERR)                                                      |
| ChatGPT-Codex plan                             | Not documented                  | Bounded backoff                        | SIWC errors page                                                       |
| Copilot                                        | Not documented (UNVERIFIED)     | Not documented (UNVERIFIED)            | No retry row in copilot.md                                             |
| Ollama / LM Studio / vLLM / llama.cpp / custom | Not documented                  | Not documented                         | Server docs                                                            |

Notes:

- Anthropic's API docs fix no count ("retry with exponential backoff" for
  500; 429 retries after `retry-after` seconds); the count 2 is the
  official SDK default ("retries transient failures ... twice by default").
- Gemini's API docs ask for "a maximum number of retry attempts to prevent
  infinite loops" without naming one; the count 4 with ~1 s to 60 s is the
  official SDK default. Verified in review RVRETRYLIMITS (2026-10-17)
  against Google Cloud's "Retry strategy" page for the Google Gen AI SDK:
  `attempts` defaults to 5 as the maximum number of attempts including
  the original request (so 4 retries), `initial_delay` 1.0 s, `max_delay`
  60 s. The PR #202 research file (gemini.md) does not itself contain
  the SDK row; the PROVERRORS record's quotation is what the lane used.
- OpenAI's API docs say only "limit retries" (openai.md §4), but its
  official SDK documents the same basis the Anthropic row uses:
  "automatically retried 2 times by default, with a short exponential
  backoff" (openai-python README, read 2026-10-17 in review
  RVRETRYLIMITS). The count 2 therefore rides on the OpenAI preset; the
  lane as submitted left OpenAI unbounded, which was inconsistent with
  the Anthropic and Gemini SDK rows.
- Azure's docs give 5-10 as an example ("for example, 5–10"), not a fixed
  ceiling; `retry-after-ms` is read before `Retry-After` (done in PROVERRORS).
- Meta's 3–5 attempts with exponential backoff and jitter honouring
  `Retry-After` is `dev.meta.ai/docs/error-handling` (cited in
  `src/shared/constants.ts`, the Model API backend's own provider page);
  no PR #202 research file covers Meta, and the backoff has no documented
  bounds, so the count is 4 retries and the bounds are the person's
  setting (uncapped when unset).
- xAI's "up to 5 attempts" with 2^attempt-second backoff is from the
  docs' own worked examples (xai.md §4).
- OpenRouter, Z.ai and the Codex plan route document _which_ answers wait
  and retry (Retry-After / next_flush_time / bounded backoff) but no count.

### Gates

Full set on `fcc07ad8ea` (before the second merge): typecheck 0, lint
(`--max-warnings=0`) 0, `format:check` 0, deadcode 0, cycles 0, duplication
0, l10n 0, reference 0, host-api 0, plan 0, roadmap 0, build 0,
security:audit 0, `vitest related` over every changed source 0 (289 files,
5,446 tests). SAST exit 1: 9 blocking `detect-child-process` findings in
eight files this branch never touches (`pluginHost.ts`, `MuseCodeHost.ts`,
`toolIo.ts`, `browserProcess.ts`, `resourceJobHolder.ts`,
`processLifetime.ts`, `voiceProcesses.ts`, `pullRequests/checkout.ts`);
measured byte-identical to `origin/main` `296c63f20c`
(`git diff --quiet origin/main HEAD -- <the eight>` exit 0), so the same
findings stand on the untouched base.

After merging `origin/main` `296c63f20c` (no conflicts), on the final
tree, under the lead's narrowed rule: prettier 0 and eslint
(`--max-warnings=0`, with main's new stand-in rule) 0 on the 33 files this
lane changed, typecheck 0, build 0, the touched suites 0 (18 files, 526
tests), l10n 0, plan 0.

## Lane RETRYLIMITS (2026-10-17): each provider's own retry limit

Branch `fix/provider-retry-limits` from `3080ef02c4` (PR #176 head).
Recorded 2026-10-17, rig `macmini`, worktree `/Users/randy/lanes/RETRYLIMITS`.
Engine: GPT Sol 6.1 (Codex CLI).

Rule: the single global retry count (4) and backoff (1 s to 60 s) are
replaced by each provider's documented values (table above); anything a
provider does not document is the person's `museSpark.modelApiMaxRetries`
setting, unset by default, and with none set the provider's own
Retry-After (or stop answer) governs, with no cap of ours.

### What changed

- `src/shared/retryPolicy.ts`: `RetryLimits` (absent field = not
  documented), `PROVIDER_RETRY_LIMITS` per format (anthropic 2, gemini
  4/1 s/60 s, the rest empty), `META_DOCUMENTED_RETRY_LIMITS` (4, from
  dev.meta.ai/docs/error-handling's 3–5 attempts), the
  person-over-documented-over-unbounded merge (`effectiveMaxRetries`) and
  the pure backoff math (`retryDelayMs`: named wait whole, else
  exponential from the only documented base, capped only where documented).
- `src/core/providers/presets.ts`: `FormatQuirks.retryLimits` (format
  defaults plus the preset's override); xAI 4 retries from 1 s (up to 5
  attempts, 2^attempt s); Azure 10 (the largest maximum its documented
  5–10 example range names; anything above exceeds its guidance).
- `src/core/backends/modelapi/transport.ts`: per-transport effective
  maximum (`TransportDeps.retryLimits` + live `personMaxRetries`), unbounded
  loop bound, `noRetryBudget()` for single-attempt paths (replacing every
  `{ retriesUsed: MODEL_API_MAX_RETRIES }`), uncapped notices
  (`maxAttempts: number | undefined`).
- Turn loops (`ModelApiHost` twice), the configured stream resend
  (`providerClient.ts`) and every `ProviderClient` (CodecClient,
  ModelApiClient, the configured/subscription/accounting delegates) read
  the current client's own limit. The `turnRetry` event, its mapping and
  its transcript sentence carry no cap (`turnRetryingUncapped`) when
  neither the provider nor the person sets one.
- The person setting: `museSpark.modelApiMaxRetries` (integer or null,
  default null = unset, 0 never retries; machine-scoped) through the
  settings registry (`settings.ts`, `package.json`, `package.nls.json` +
  14 locales, `featureCatalog.ts` `retry-limits`, regenerated reference,
  README, CHANGELOG), wired live into the Meta client and every
  configured provider's transports. The ACP/headless surface does not
  expose it yet (its hosts pass no option): documented providers keep
  their maxima there; undocumented ones are unbounded there too.
- `MODEL_API_MAX_RETRIES` is gone. `MODEL_API_RETRY_BASE_MS` stays as the
  mechanical default initial wait (1 s is the only documented base);
  `MODEL_API_RETRY_JITTER_MS` stays as anti-herd mechanism;
  `MODEL_API_RETRY_MAX_MS` stays for pacing's assumed 429 wait only
  (lane PROVM95's area, untouched).

### Tests and drills

- `test/unit/providerRetryLimits.test.ts` (10 tests, real code only, no
  stand-ins): documented counts and bounds per preset, a preset's own
  count merged over its format's backoff, undocumented presets without a
  limit, person-wins merge (incl. 0), documented fallback, unbounded
  fallback, backoff math (named wait whole, doubling, documented cap,
  uncapped growth), single-attempt budgets past every cap. Green at the
  repo timeout. (Review RVRETRYLIMITS removed the one settings-read
  test: it fed `readSettings` a hand-written configuration object and a
  no-op logger, a stand-in for the editor's own config under the
  owner's testing rule; the packed-product steps below cover the
  setting instead. The same review added the merge test and pinned
  OpenAI's 2.)
- Drill: planted anthropic 3 instead of 2 — the pin test failed exit
  non-zero (`pins the documented counts`); restored byte-identical, green.
- The bundle-split gate fired on the change (3 cross-bundle reads:
  `UNBOUNDED_RETRIES` into `configuredProviders.js`, `noRetryBudget`
  into `reviewer.js` and `tab.js`); both names were exported from
  `dist/modelApi.js` before any real use, build green after.

### Gates (final tree)

typecheck all projects 0; eslint `--max-warnings=0` 0 on all changed
sources; prettier 0; deadcode 0; cycles 0; duplication 0 clones;
check:l10n 0 (new `turnRetryingUncapped` + setting description in all 14
locales, real translations); check:reference 0 (regenerated:
`retry-limits` feature, 90 settings); check:host-api 0; check:plan 0
drift; check:roadmap current; build 0 (budgets held); security:audit 0
(2 advisories, 1 exception). SAST could not start here:
`Fatal error: exception Failure: ca-certs: empty trust anchors` (the
sandbox's toolchain, before any scan; same tree-independent failure the
lead sees outside). `vitest related` over every changed source: all
retry-adjacent suites green (98/98 across the retry/refusals/presets/
notification/l10n files); the only failures are process/timing suites
that fail identically on the untouched base (see below).

### Related-suite failures, measured on both trees

`vitest related` (293 files) on this tree and on a clean clone at
`c5b764683` (no retry-code changes): `fileLease.test.ts` (4) and
`treesLifecycleNative.test.ts` (2) fail identically on both —
`processStartTime` undefined and zombie/setid assertions the sandbox
cannot satisfy. `nativeGitCore`, `runtimePullRequestRecords`,
`trafficHarness` fail intermittently on both trees with hook/test
timeouts under rig load (failed on base 2026-10-17; passed on this tree
in the earlier run). `packagedBundles.test.mjs` failed once in three
runs with an `afterAll` hook timeout removing its fixture folder (no
content assertion failed). None touches retry, settings, providers or
notices; the retry-adjacent suites pass deterministically.

### Real use (packed build of this tree, `node dist/acp.js`)

Isolated: `XDG_CONFIG_HOME` and workspace in scratch folders, no stored
key read or written (keys over stdin were shape-valid but made-up
strings). Provider calls: 1, to `api.anthropic.com`, refused with 401
($0).

1. `providers add --preset ollama --as dead --address
http://127.0.0.1:59321` (a closed port): "Test failed: Could not reach
   dead: the connection failed (fetch failed: ECONNREFUSED), so whether
   the request arrived is unknown; check the network and the provider
   address." — one attempt, through the packed code.
2. Hand-written `providers.json` (anthropic preset, scratch only), `exec
--backend modelApi --provider anthropic --model
anthropic/claude-haiku-4-5 --max-budget-usd 5 --key-stdin`: "Anthropic
   refused the request: the stored key was rejected. Store a new
   Anthropic key from Models & Agents; nothing reached a model and
   nothing was charged. Anthropic said: invalid x-api-key (request id
   req_011Cg8mpoAwSRy4MzVf3r6et)" — requests 1, never retried, sentence
   and request id intact after the refactor. (Headless books uncertain
   $0.331072 on the refusal: PROVERRORS finding 1, the budget lane owns
   it.)

### What the lead must run

1. The loopback suites at the repo timeout on a non-sandbox rig — the
   per-provider attempt counts the new caps imply (Anthropic stops after
   2 retries, Gemini after 4, an undocumented provider only on its stop
   answer, `modelApiMaxRetries: 0` sends once) cannot be driven here
   (`listen(2)` is EPERM).
2. One real 429-or-500 answer per documented provider (no model needs to
   run for most): the attempts must stop at that provider's documented
   maximum.
3. The person's setting in VS Code: set `museSpark.modelApiMaxRetries`
   to 1 and to 0 and watch a retryable failure stop accordingly; unset
   it and watch the provider's documented maximum govern.
4. SAST outside this sandbox (it cannot start here).

### Open, with the reason

- ACP/headless exposes no `modelApiMaxRetries` knob (runtime
  `createConfiguredProviderServices` and the headless Meta client pass
  no option): the mechanism honors it on every surface once a host
  passes it; the setting's surface is VS Code only.
- Idle and request timeouts (300 s, 30 s): not this lane (stated in the
  PLAN amendment).

### Review threads on PR #225 (2026-10-17)

The four unresolved Codex threads at `e6b2d3948d`, one line each:

1. `src/core/providers/configured.ts:371` (configured models retry by
   Meta's limit): fixed in `dfe495a437`. `boundClient()` spread `base`,
   whose `maxRetries` delegates to the Meta client (or throws when there
   is none, so the turn loop rethrew without any retry); the bound client
   now answers from its own `CodecClient` (`configured.ts:1048`: the
   preset's documented limit, or the person's setting).
2. `src/shared/retryPolicy.ts:202` (an uncapped delay overflows the timer):
   fixed in `c9171e323b`. `RequestTransport.pause` (`transport.ts:750`,
   the one wait every retry, turn resend and pacing hold goes through)
   sleeps in abortable
   pieces of at most `MODEL_API_TIMER_MAX_MS` (2^31 − 1 ms: "When `delay`
   is larger than `2147483647` … the `delay` will be set to `1`",
   nodejs.org/api/timers.html, Node.js v26.12.0, read 2026-10-17). The
   logical delay stays whole, so neither an uncapped backoff nor a
   provider's `Retry-After` date weeks away collapses to 1 ms.
3. `test/unit/providerRetryLimits.test.ts:87` (invented retry inputs):
   fixed in `c9171e323b`. The made-up 5-second provider wait, the
   synthetic jitter samples, the hand-written limit records and the
   fabricated preset (count 9) are gone. Every input is now a preset's real documented record, Meta's
   documented record, the product's own `RequestTransport` with the
   platform's random source and timer, and the agent's own
   `stderrLogger`. The named-wait rule has no test: the repository holds no
   recorded real exchange with a `Retry-After` header (a case-insensitive
   search of `test/` finds it only in two `sources.json` source snapshots
   and in hand-written header values of the usage-journal tests, no
   capture), so the packed product's real-life run proves it.
4. `src/extension.ts:2054` (the setting never reaches the conversation
   client): fixed in `dfe495a437`.
   `ModelApiBackendManagerDeps.personMaxRetries`
   (`modelApiBackendManager.ts:140`) is passed into the conversation
   client the backend builds (`:347`), and the extension hands it the live
   setting (`extension.ts:2629`), so `museSpark.modelApiMaxRetries: 0`
   stops ordinary Meta turns too.

Tests and drills:

- The suite drives the real transport: documented backoff per preset with
  the real jitter (bounds, not a sample), and the overflow case: an
  undocumented provider's 23rd try (`backoffMs(22)`, about 4.19 × 10^9 ms)
  is still waiting when a Stop comes 200 ms later. 8 tests, exit 0.
- Drill (run twice, on the first and the final form of the test): `pause`
  with the pieces removed (`piece = remaining`). Node printed its
  `TimeoutOverflowWarning` for the delay (4194304443 ms on the final
  run), the wait ended after 7 ms and the overflow test failed ("promise
  resolved "undefined" instead of rejecting", exit 1). Restored
  byte-identical (`cmp` exit 0), green again.
- No unit test for threads 1 and 4: the configured services need a
  secret store (`ConfiguredProviderOptions.secrets` is required) and the
  backend manager is built from the editor's settings and services. Each
  could only be built in a unit test on a stand-in, which the owner's rule
  forbids, so the real-life steps below are their proof.

What the lead must run (packed product, adds to the list above):

1. VS Code, `museSpark.modelApiMaxRetries: 0`, Meta backend, the network
   cut (for example `http.proxy` pointed at a closed port): one send and
   the failure at once, no "Retrying" notice. Unset it: Meta's four
   retries with their notices.
2. Thread 1 changes what the turn loop reads for a configured model,
   which is the media-recovery resend gate: configured streams never
   reach the loop as a `RetryableStreamError` (`configured.ts:994-1007`
   throws a stream error as a `ModelApiError`), and their own resends in
   `CodecClient` already read the preset's limit through the transport.
   Real-life: a configured Anthropic model whose provider refuses an
   attached image for its size after its own retries are spent (2): no
   recovery resend follows, where Meta's 4 used to allow one.

Still open:

- `createSubscriptionClient` (`subscriptions/registry.ts:183`) answers
  `maxRetries` from the Meta client for ChatGPT-plan and Copilot models as
  well. The host's turn loop reads it only for a `RetryableStreamError`
  (never raised on those routes) and for the media-recovery gate. Fixing it
  needs a per-model `maxRetries`, which `ProviderClient` does not have.
  Not changed here.
- ACP/headless still pass no `personMaxRetries` (see above).

## The three new Codex threads on PR #225 (lane PR225FIX2, done)

1. `ModelApiHost.ts:14610` (P1, compaction reads the aggregate client): fixed. `collectText` keeps the resolved attempt's client in `attemptClient` (`ModelApiHost.ts:14437,14452`) and the catch reads the limit, the delay and the wait from it (`:14618-14644`), falling back to the aggregate client only when nothing resolved yet. No unit test: the host needs the editor's services, which a unit test may only build on a stand-in (owner's rule); the lead's real-life step 1 below is the proof.
2. `transport.ts:760` (P2, an aborted long wait leaves its timer): fixed. `pause` hands the turn's stop to each chunk's sleep (`transport.ts:795`), and the four production sleeps that feed a transport (configured providers in `configured.ts:478`, the Meta key client and the conversation manager in `extension.ts:2058,2634`, the ACP/headless managers in `runtime/main.ts:201`) share `abortableSleep`, which clears its timer the moment the stop aborts. Clearing, not unreferencing, on purpose: an unaborted wait holds the process exactly as before; only an abandoned wait is gone. The race stays as the backstop for a sleep that ignores the signal. `abortableSleep` is exported from the Model API bundle entry (`modelApiEntry.ts:41`), or the three bundles that read it get `undefined` at run time (HOTFIX0181; the split gate failed before the export).
3. `transport.ts:1175` (P2 security, unbounded ambiguous replays): fixed. An unanswered send — the request may have arrived and executed — is sent again only within an explicit bound: the person's `museSpark.modelApiMaxRetries` setting or the provider's documented maximum (`transport.ts:1211-1219`). With neither, the send failure ends the request at once. The same rule covers a connection lost before any content in `CodecClient.streamResponse` (`providerClient.ts:287-297`). Answered retries are unchanged: HTTP statuses with the provider's `Retry-After`, documented retryable stream errors and the host turn loops' provider-answered error events stay on the provider's own policy (the provider answered, so the send is not ambiguous).

Tests and drills (`test/unit/providerRetryLimits.test.ts`, 14 tests, exit 0; real code and real data only — the platform's timer, the presets' documented tables, the product's own transport, a real refused loopback connection, no server, no stand-in):

- The stop reaches each chunk's sleep (fails when `pause` stops forwarding the signal: 1 failed, 13 skipped).
- A sleep that ignores the stop is still abandoned promptly (fails with the race removed: timeout past the suite limit).
- The production sleep resolves a stopped wait instead of holding it.
- An unanswered send with OpenRouter's undocumented limits and no setting fails once with zero retry notices (fails with the bound removed: three growing retries in the log, then the suite timeout — the vulnerability on display).
- The person's setting of 1 still retries exactly once; Anthropic's documented 2 still starts its first wait, ended by Stop.
- Shared transport deps factored out after the duplication gate found one 13-line clone; gate exit 0.

Real-life runs (lead, packed product):

1. Thread 1: a configured Anthropic model compacting after its own two retries are spent: the compaction follows Anthropic's limit (at most 2 more waits), not Meta's 4.
2. Thread 3: a configured provider with no documented maximum (e.g. OpenRouter), `museSpark.modelApiMaxRetries` unset, network cut mid-turn: the send failure at once, no "Retrying" notice. Set the count to 1: exactly one notice, then the failure.

Still open: `RetryableStreamError` resends in the host turn loops stay on the provider's policy (answered error events, not ambiguous sends); per-call-billed paths never retried ambiguous sends and still don't.

## Lane PR225W1 first result (the 7 threads triaged, fixes to follow)

1. Compaction reads the resolved client: already fixed in `413bf5658` (`attemptClient` retained per attempt; the catch reads the limit, the delay and the wait from it). To answer with that commit.
2. Cancel each timer chunk on abort: already fixed in `413bf5658` + `b4ae1e92b` (the stop reaches each chunk's sleep; `abortableSleep` clears its timer; all production deps share it). To answer with those commits.
3. Bound ambiguous retries: already fixed in `413bf5658` (an unanswered send replays only within an explicit bound — the person's setting or the provider's documented maximum — else the failure ends the request). To answer with that commit.
4. Subscription `maxRetries` delegates to Meta: OPEN, measured (`registry.ts:183` still `() => meta.maxRetries()`). To fix: plan routes answer the person's setting when set, else undefined (no documented maximum); non-plan routes keep Meta's.
5. `effectiveMaxRetries` replaces the provider maximum with `??`: OPEN, measured (`retryPolicy.ts:179`). To fix: the minimum when both exist; the person's value stays for undocumented providers.
6. Live retry cap not rechecked after the wait: OPEN, measured (`transport.ts:1288` gates before `pause()` only). To fix: revalidate the live callback after the wait, before dispatch.
7. No orchestrator notice when the person's cap fires: OPEN, measured (`ModelApiHost.ts:6037` rethrows with no cap event). To fix: emit the cap notification when the person's cap, not a provider maximum, blocks the retry.
8. CI `tests (ubuntu-latest, shard 3)`: OPEN, reproduced locally (`test/unit/modelsActivationBudget.test.ts`: growth 3282 > 3072; base `81dacaf5a` grows 2901, so the branch adds 381 — all in the activation bundle: `extension.ts` +146, `settings.ts` +113, `modelApiBackendManager.ts` +86, `constants.ts` +24, `mapNotification.ts` +12). To fix in code; the budget stays 3072.
9. CI `quality` (ubuntu/windows/macos), `package (.vsix)`, `dictation helper (macos)`: downstream of the unit-test failure (require every selected-tier job); expected green once item 8 is fixed.
10. CI `tests (windows/macos)` in the capacity repository (push the merge commit): a CI-infra step with no local equivalent (`never push`); no code cause on this branch. For the lead to re-run.

## Lane PR225W1 done (threads 4–7 fixed; threads 1–3 answered; budget green)

Threads 1–3 were already fixed on the branch — answered with `413bf5658` (1 and 3) and `413bf5658` + `b4ae1e92b` (2) — and their tests still pass in `test/unit/providerRetryLimits.test.ts` (20 tests, exit 0).

4. Subscription `maxRetries` (P1): fixed. `ProviderClient.maxRetries` takes the selected model (`client.ts`, `providerClient.ts`); the registry answers plan routes with the person's live setting when set, else undefined (neither plan route documents a maximum), and off-plan models with Meta's (`registry.ts`). `subscriptionFeatures` forwards the setting; headless passes none (unset). Unit test builds the real Meta client in front of the real registry (no stand-ins; sign-in, catalogue and account untouched by a limit read).
5. `effectiveMaxRetries` (P1): fixed. The minimum when both the person and the provider set one (`retryPolicy.ts`); the person's value still decides alone where nothing is documented. Unit test pins the Azure-then-Anthropic case (10 stays 2) and a real refused send stopping at 2 with the person at 10.
6. Live cap recheck (P2): fixed. `transport.request`'s `retry()`, `CodecClient`'s resend loop and both host loops (`streamOnce`, `collectText`) revalidate the live limit after the wait and refuse the dispatch with the original error when the cap now forbids it. Unit test lowers the cap to 0 mid-backoff on a real refused send: one send, one notice (two sends with the recheck removed).
7. Orchestrator notice (P1): fixed. Both host loops emit a `backendNotice` warning (`UI_TEXT.modelApiRetryCapReached`, English + all 14 tables) exactly when the person's own cap — not a provider maximum — stops the retry (`isPersonRetryCap` in `retryPolicy.ts`, unit-tested; the host emission itself needs the editor's services, so the packed-product steps below are its proof).
8. Activation budget: fixed in code, budget unchanged (3072). The branch added 381; dieted to 159: one shared live reader in `extension.ts`, `z.int()` schema, direct forward in the manager, and — the large one — `RequestTransport` waits with `abortableSleep` when no sleep is injected, so activation wires no sleep at all (as a side effect activation no longer eagerly requires `dist/modelApi.js`). The live person-set reader is now named `personCap` (it reads distinct from the effective `maxRetries()`). Growth `3060`, test exit 0. Items 9–10 above stand as recorded (downstream jobs unblocked; capacity-repo push for the lead).

Gate-fire drills (each break reverted byte-identical): reverting the thread-4/5 fixes fails 4 (both new blocks), the thread-6 send count doubles without the recheck, the `isPersonRetryCap` table inverts on `!==`.

Real-life runs (lead, packed product):

1. Thread 4: a `chatgpt/...` model, setting unset, network cut mid-turn: provider-governed retries with no Meta-imposed stop; set the count to 1: exactly one retry notice.
2. Thread 5: setting 10, Anthropic model, refused send: at most 2 retries.
3. Thread 6: setting 1, a long `Retry-After` wait, set 0 mid-wait: no further request goes out.
4. Thread 7: setting 1, two retryable stream errors: a warning names the person's cap (`museSpark.modelApiMaxRetries: 1`) on the run's feed.
