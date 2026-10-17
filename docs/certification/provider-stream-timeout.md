# Provider stream timeout hotfix (0.17.2)

## What was wrong

`MODEL_API_REQUEST_TIMEOUT_MS` (30 s) is the deadline of a bounded call: a
model list, a token count, a token exchange, one file request. Since 0.15.0
it also wrapped two whole inference streams:

- `src/core/providers/configured.ts`, the bound provider client's
  `streamResponse`: every provider a user adds with a key or as a local
  server.
- `src/core/providers/subscriptions/registry.ts`, the ChatGPT plan route:
  the signal given to `fetch` for `RESPONSES_URL`, which also governs the
  reply body.

Any reply that took longer than 30 s in total was aborted. On the configured
route the abort was then reported as "Models & Agents is not available in
this build." by the catch that hides unknown errors.

Found on 2026-10-11 by running a review through the released 0.17.1 headless
agent with an Anthropic key: a request with about 150,000 input tokens ended
after 32 s with `transportError: "error"` and the full reservation kept as
uncertain; a second run ended the same way on its ninth request.

## What changed

- Both wrappers are removed. An inference stream ends when it finishes, on
  the caller's signal, on a budget or request cap, or after the idle limit
  (`MODEL_API_STREAM_IDLE_MS`, 300 s) with nothing received.
- Configured route: the idle limit was already applied by the shared
  transport to the wait for headers and to every read of the body
  (`RequestTransport.fetchWithIdleDeadline`, reached from `request`), and by
  `streamRequest` between parsed events. The catch now lets that one failure
  through, so the user gets the existing translated sentence
  (`modelApiStalled`). No other case of the catch changed.
- ChatGPT plan route: it had no idle limit at all. It now has one clock,
  started with the request and restarted when the headers arrive and at
  every event the codec decodes: the definition of the configured route,
  where only a validated canonical event renews the deadline. Bytes that
  decode to no event (SSE comments, empty lines) do not restart it, so
  keep-alive traffic cannot hold a reply open. A reply that stays silent
  for the limit is aborted and the user gets the same sentence as an
  `error` event.
- `streamIdleMs` is an optional input of both routes so the tests can
  shorten the limit. Production passes nothing and keeps 300 s.
- The Copilot route was checked and left alone: its two uses of the constant
  bound single token counts, not the stream.
- Money is unchanged. A request that ends without verified usage (Stop, the
  idle limit, a lost connection) keeps its full reservation as an uncertain
  amount, as before; a request that completes settles at its reported usage.

## Every use of the 30 s deadline, classified

`test/unit/providerStreamLimits.test.ts` lists the 17 remaining uses in
`src` with the call each one bounds and fails when the list and the source
disagree, so a new use has to be classified, and a use around a stream has
nowhere to go.

| File                                           | Uses | Bounded calls                                                           |
| ---------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `src/core/backends/modelapi/client.ts`         | 3    | the model list, the status read, one input token count                  |
| `src/core/backends/modelapi/files.ts`          | 4    | one upload, one read, the list, one delete                              |
| `src/core/backends/modelapi/providerClient.ts` | 2    | a provider model list, one provider input token count                   |
| `src/core/providers/configured.ts`             | 3    | a pinned request made without a signal, a model list scan, the key test |
| `src/core/providers/subscriptions/registry.ts` | 3    | two token exchanges, the ChatGPT catalogue read                         |
| `src/host/providers/copilotClient.ts`          | 2    | one Copilot input token count, one Copilot output token count           |

Removed: `configured.ts` (the stream wrapper) and `registry.ts` (the
`RESPONSES_URL` fetch signal).

## Tests

Configured route, `test/unit/configuredProviders.test.ts`, "configured
provider stream limits": the production transport against a loopback HTTP
server.

- A stream that takes about 600 ms completes while the bounded-call deadline
  is 100 ms (the test maps a 30 s `AbortSignal.timeout` to 100 ms).
- A stream that goes silent after its first frame ends at the idle limit
  (600 ms in the test) with the idle sentence.
- A request whose headers never arrive ends at the idle limit with the idle
  sentence.
- Stop ends a stream at once.
- The idle limit is not a total limit: a stream that sends a frame every
  30 ms for about 1.3 s under a 300 ms idle limit completes with the same
  events as the same stream sent at once.

ChatGPT plan route, `test/unit/providerStreamLimits.test.ts`, "ChatGPT plan
stream limits": the real subscription client with only `fetch` faked. The
same five cases; the idle limit arrives as an `error` event with the idle
sentence, and the pending request is aborted. In the steady case an event
arrives every 50 ms for about 1.6 s under a 300 ms limit and all 30 deltas
are delivered. One more case: a reply of keep-alive comment lines every
100 ms under a 300 ms limit ends at the limit with the idle sentence and
the request aborted.

## Red drills (Mac mini rig, 2026-10-11)

### The 30 s wrappers back (first commit, a54c97d19)

Both wrappers were put back and the idle-sentence case was removed from the
configured catch. The two files were then run: exit 1, 5 failed of 49.

| Failed test                                                                          | Why                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| has every use classified as a bounded call                                           | 19 uses found, 17 classified                          |
| ChatGPT: lets a reply run past the bounded-call deadline                             | no `response.completed`                               |
| configured: lets a stream run past the bounded-call deadline                         | "Models & Agents is not available in this build."     |
| configured: ends a stream that goes silent at the idle limit, with the idle sentence | got "Models & Agents is not available in this build." |
| configured: ends a stream whose headers never arrive at the idle limit               | got "Models & Agents is not available in this build." |

The fix was restored byte for byte (the files as committed in a54c97d19):

- `src/core/providers/configured.ts`
  `38de053e6d06c96bb9036b102a224e0f8b25e92ef7bd8a7961fa0863ff1d65b4`
- `src/core/providers/subscriptions/registry.ts`
  `ef62eb3804829743aa29b90e3b5a4442625f276ee363948a2bb851e07dbc4b10`

With the fix in place the same run exited 0, 49 passed.

### Raw bytes restart the ChatGPT idle clock (follow-up commit)

The first commit bounded every read of the ChatGPT reply, so any bytes,
keep-alive comments included, kept a reply open. The follow-up counts
decoded events instead. Drill: the clock was restarted after every read
again. `test/unit/providerStreamLimits.test.ts`: exit 1, 1 failed of 7, the
keep-alive comments case (the reply stayed open and the test timed out).

### The idle clock starts once and never restarts (follow-up commit)

An idle limit that had quietly become a total limit. Drill: in `registry.ts`
the two restarts (headers, each decoded event) were removed, and in
`src/core/backends/modelapi/transport.ts` `eventParsed` armed its timer only
once. The two files: exit 1, 2 failed of 52.

| Failed test                                                              | Why                                          |
| ------------------------------------------------------------------------ | -------------------------------------------- |
| configured: keeps a steady stream alive for several times the idle limit | ended with the idle sentence after the limit |
| ChatGPT: keeps a steady reply alive for several times the idle limit     | last event `error`, not `response.completed` |

After both follow-up drills the files were restored byte for byte:

- `src/core/providers/subscriptions/registry.ts`
  `83aabf8c6be135bebe094f2a1233d1fef725251096d66e59516324a7d5cbc5b2`
- `src/core/backends/modelapi/transport.ts` (not changed by either commit)
  `75a1d2bf5060e8be491e7894605114ee388194b9911c1b6de502bda602b995da`

With the fix in place the two files exit 0, 52 passed.

## Not in this change

- The catch that turns every other provider failure into "Models & Agents
  is not available in this build." (a budget refusal among them) is left to
  the lane that redesigns it.
- The headless runtime does not yet give the provider route its own shorter
  idle limit, as it does for the Meta Model API route.
- The live proof on a build of this branch is recorded by the lead with the
  release.
