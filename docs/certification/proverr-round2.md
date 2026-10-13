# Provider refusals round 2 — red table (2026-10-12/13)

Recorded by the lead on 2026-10-12, 6:27–6:28 PM PT (no model ran; account ids
in the xAI and OpenRouter answers replaced with zeros by the lead). Fixtures:
`test/fixtures/provider-refusals/<provider>/bad-key.json|unknown-model.json`,
byte-identical copies of
`~/lanes/_captures/refusals-2026-10-12/<provider>/{models-list-made-up-key,key-check-made-up-key,unknown-model}.json`.

"Round-1 kind" is what the product's own path gives on round-1 code
(`fix/provider-refusals`): the configured path parses with `openAiEnvelope`;
the Anthropic codec with `anthropicEnvelope`; the Gemini codec with
`geminiEnvelope`. Measured with a scratch probe through the real modules
(`parseRefusalError` + `classifyRefusalKind`/`refusalOf`), deleted after the
run. "True kind" is the fact from the table in the lane brief.

| Fixture                          | Status | Round-1 kind (product path)                                   | True kind      |
| -------------------------------- | ------ | ------------------------------------------------------------- | -------------- |
| openai/bad-key                   | 401    | authentication                                                | authentication |
| openai/unknown-model             | 404    | notFound                                                      | notFound       |
| groq/bad-key                     | 401    | authentication                                                | authentication |
| groq/unknown-model               | 404    | notFound                                                      | notFound       |
| deepseek/bad-key                 | 401    | authentication                                                | authentication |
| deepseek/unknown-model           | 400    | **invalidRequest**                                            | notFound       |
| anthropic/bad-key                | 401    | authentication                                                | authentication |
| anthropic/unknown-model          | 404    | notFound                                                      | notFound       |
| fireworks/bad-key                | 401    | authentication                                                | authentication |
| fireworks/unknown-model          | 404    | notFound                                                      | notFound       |
| together/bad-key                 | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| together/unknown-model           | 404    | notFound                                                      | notFound       |
| openrouter/bad-key               | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| openrouter/unknown-model         | 400    | **unrecognised** (typeless envelope kept)                     | notFound       |
| xai/bad-key                      | 400    | **unrecognised** (flat `error`-string envelope unread)        | authentication |
| xai/unknown-model                | 404    | **unrecognised** (flat `error`-string envelope unread)        | notFound       |
| gemini/bad-key (configured path) | 400    | **unrecognised** (Google envelope unread by `openAiEnvelope`) | authentication |
| gemini/bad-key (gemini codec)    | 400    | **invalidRequest** (`INVALID_ARGUMENT` matches no kind)       | authentication |
| gemini/unknown-model             | 404    | notFound                                                      | notFound       |
| mistral/bad-key                  | 401    | **unrecognised** (`detail` envelope unread)                   | authentication |
| mistral/unknown-model            | 400    | **unrecognised** (top-level `message` envelope unread)        | notFound       |
| zai/bad-key                      | 401    | **unrecognised** (typeless envelope kept)                     | authentication |
| zai/unknown-model                | 400    | notFound (only via the cross-status `unknown model` phrase)   | notFound       |
| huggingface/bad-key              | 200    | n/a (the model list answers 200 to any key)                   | n/a            |
| huggingface/unknown-model        | 400    | notFound (`model_not_found`)                                  | notFound       |

Bold cells are the red: 11 of the 23 error answers misclassify on round-1
code (eleven bold rows above). Three classes, matching the review findings:

1. Typeless envelopes kept as `unrecognised` (finding 1): Together, OpenRouter
   (both), Z.ai bad-key — 401s the person reads as "unrecognised" instead of
   "your key was refused".
2. Real envelope shapes no parser reads (finding 2): xAI flat (both), Mistral
   `detail` + top-level `message`, Gemini on the configured path.
3. Status/type/code ignored in favour of phrases, or phrases missing where the
   provider gives nothing else (finding 3): Gemini bad-key (`API key not
valid`, reason `API_KEY_INVALID`) → `invalidRequest`; DeepSeek/Mistral/
   OpenRouter unknown-model 400s → `invalidRequest`; Z.ai unknown-model right
   only by accident of the `unknown model` phrase.

## Round-2 results (2026-10-13)

`test/unit/providerRefusals.test.ts` (34 tests, `npx vitest run
test/unit/providerRefusals.test.ts --maxWorkers=2`): every recorded error
answer in through the real extractor and classifier — 23 of 23 classify to
the true kind above, each with its sentence fragment, its never-retry
decision and, where the headers carry one, its request id. The three leaky
messages (OpenAI's masked-key remnant, DeepSeek's last-4, xAI's team id)
scrub to the exact stored forms. The red-table drills that fired it: the
`parsed`/`unrecognised` split, the Gemini `API_KEY_INVALID` promotion, and
the carrier that lost `reason`/`errorCode` before the classifier (all three
failed first, then passed after the fix).

Review findings, closed:

1. Parsed/unparsed carried apart (`parsed: false` beside the kind, never a
   magic kind string); typeless envelopes classify by status and code — the
   three typeless 401s read `authentication`.
2. One shape-driven extractor (`extractRefusalEnvelope`) used by every wire
   format; xAI flat, Mistral `detail` and top-level `message`, Google
   `details[].reason` all parse.
3. Status and documented type/code/reason decide; four recorded phrases in a
   sourced table cover only the statuses where a provider gives nothing
   else. Every table row classifies to the true kind.
4. `isDefiniteRefusal` kept only as TEMPORARY: the spend-ledger branch
   (`fix/spend-ledger`) has the decision but no code predicate yet
   (measured 2026-10-13), so the predicate stays until the ledger takes
   over the four `ModelApiHost.ts` call sites that remain
   (`noteRequestRefusal`, the `paidModelObservers` `isRefused`, the
   auto-review observers' `isRefused`, and the image-generation catch).
5. Sinks beyond the screen, each handled: the log file (the turn-fault line
   keeps the scrubbed form only), the usage history (clean by construction:
   the record schema carries outcome, headers and cost, no message text),
   the report bundle (`scrubFinalDraft` applies the one scrub), telemetry
   (no error telemetry exists — measured). The session file store persists
   no failure text (measured). The person still reads their own provider's
   full sentence on screen.
6. Every cause a person can meet has its own translated sentence
   (`InvalidEntryCause`: unknown preset, unsupported auth, missing address,
   missing stored key, unusable models entry, unset context window, address
   mismatch, entry changed mid-request); only a programming error reads the
   defect sentence. `modelsPanelUnavailableGuard.test.ts` is deleted: the
   key is now read in exactly one module (`src/host/models/modelsPanelBundle.ts`),
   both reads inside `lazyBundleLoader` `unavailable` wiring — the module
   boundary holds the rule, and a table read cannot be fenced further by
   the type system, so no guard replaces it.
7. `providerUnreachable` no longer says "nothing was sent": the connection
   failed, so whether the request arrived is unknown.
8. A stream error is its own kind at the answer's own status, with uncertain
   liability; a streamed content-filter block stays `streamError` (output
   was consumed) rather than reading as the uncharged 400 sentence.

The person's steps for each kind (the lead's real-life run on the packed
build): a wrong key on any of the eleven providers ends the turn with "the
stored key was rejected" plus the provider's own words, one request, never
retried; an unknown model ends with "it has no such model"; an account with
no credit ends with "its account is out of credit". What the person reads in
each case is the sentence quoted in `providerRefusalCredit`,
`providerRefusalAuthentication` and `providerRefusalNotFound`
(`src/shared/l10n/en.ts`), in their language.

UNVERIFIED until the lead's captures return
(`docs/certification/proverrr2-capture-plan.json`, 9 requests): real 429
bodies (rate vs quota per provider, the spend-cap header set), a cut-off
Anthropic reply with partial tool calls, an Azure content-filter block, the
xAI unsupported-parameter 400, and a quota-worded Gemini 429. The
documented-shape cases in the suite name their documentation address and
date.
