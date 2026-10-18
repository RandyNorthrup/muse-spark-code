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
