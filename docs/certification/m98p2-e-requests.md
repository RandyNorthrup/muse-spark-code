# Requests from M98 lane E (2e BYO)

Lane E shipped `createByoJudge` in `src/core/judge/providers/` and did not
edit another lane's files. These items stay with their owners. Nothing here
is authorization to spend, to raise a cap, or to claim the surface is
supported.

## M95 codecs and `CreateResponseBody` (F11 wire)

E consumes provider identity, format, auth, and `currentKeyDigest`, plus the
price card and the capability record. It does not call `streamResponse`.
The only committed vendor logprob body is Ollama `/api/chat` in
`test/unit/fixtures/localJudgeCapture.json`. OpenAI and xAI captures in the
tree have empty or absent logprobs. Empty is a decode failure in E. It is
not probability 1.

Please extend the canonical body and the codecs so a judge request can ask
for logprobs and the returned alternatives survive the codec:

- Chat Completions, Responses `output_text.logprobs`, Gemini, and Together's
  integer form each need their own committed capture before a parser. The
  future row is `L98P2-CAPABILITY`: at most 2 attempts per explicitly named
  M95 model variant, no provider sweep. This lane authorized 0 attempts.
- Map `ByoCompletionRequest.requiresEffortNone` onto the captured vendor
  switch. When the record boolean is exactly `true`, do not send logprobs
  without that switch. E copies the boolean onto the seam. For an Ollama
  client it also sends the captured `think: false`, `logprobs: true`, and
  `top_logprobs`. It does not invent `reasoning_effort`, `response_format`,
  or `responseLogprobs` for any other format.
- Native structured-output wrappers (`json_schema`, `strict_schema`,
  `forced_tool`, `json_object`) wait on a committed request capture. E
  records the selected mode name on `ByoCompletionRequest.statedFormat` and
  sends no wrapper.

## Lane N (capability record)

`ModelCapabilityRecord.logprobs` as a known value has `kind: 'top1' | 'topk'`
only (`capabilityRecord.ts`). A silent drop and a refusal are not a yes-value.
E agrees a record state of `no` with a judge claim of `refused` or `dropped`,
and a record state of `unknown` only with a judge claim of `unknown`. Any
other disagreement is no answer. A capture that must record dropped versus
refused on the model itself needs a record shape that can say so. E will not
infer either state from the provider name or the dialect.

## Z (integration and delivery)

Wire `createByoJudge` into the existing `dist/judgeP2.js` factory
(`src/runtime/judge/judgeEntry.ts`) on explicit judge use:

- Lazy load, with its own measured budget. No activation import.
- Add a knip and dpdm entry if that production import is otherwise
  unreachable. The unit tests already import the module, so knip sees it
  from the test entries today. E added no knip change.
- Regenerate the host-API snapshot only if the wiring adds a host or Node
  API. E now uses `node:crypto` only for in-memory cache digests; include it
  in the inventory when the library enters the production graph.
- Keep the split guards. Do not raise an existing cap.
- Admission stays on D78's ledger. E calls the injected `JudgeDailyLedger`
  (`reserve`, `settle`) and does not store claims. Leave
  `JudgeAdmissionEngine` as `'auto' | 'same'`.
- Update CHANGELOG, README, PLAN, and `docs/judge.md` when the surface is
  wired and a command has been run. No support claim before that.
- No feature-catalogue or localization change until there is a new command
  or setting. This lane adds neither.
- Do not add a second ledger, provider registry, or transport/key store.

Phase-1 `selectTechnique` still maps a refused or dropped field to stated.
E's stricter rule is only in `chooseByoTechnique`. Leave `techniques.ts` and
`ModelApiSameJudge` as they are until a later decision selects this library
as a source.

## FIXM98P2E repair contract (2026-10-06)

All ten RVM98P2E findings are in the authorized repair scope. E now owns
redaction, generation-tagged snapshots, dispatch fences, immutable call
tariffs, technique-specific prompts/output ceilings and bounded cache
invalidation. Regression tests were replayed against `183de45f3` and fail before fixes.

P0/Z must supply the required caller generation (incremented for every
selection, credential, privacy, price and consent change, including an
A → B → A switch), logprob wording from the lazy model-text block, and a
named bounded stated-output allowance from shared constants. E cannot edit
P0's constants or Z's PLAN/CHANGELOG under the lane ownership rule; the
required values are injected into the library and exercised by fakes here.
A logprob prompt asks for exactly yes/no, one choice letter or one score
digit; stated uses the existing JSON wording. Tests use a 256-token stated
ceiling, with larger captured model floors honored. Z maps
`ByoCompletionRequest.maxOutputTokens` to each captured native codec and
reserves/measures that same ceiling. No new wire field is guessed.

Next slice remains Z/M95 production routing and captured codec wrappers,
then integrated admission/cancellation and package checks. No live, paid or
local model attempt is authorized by this repair. Full quality stays with
Z/lead under common.md; scoped rig gates run here without changing caps.

## Z shared gate/doc closeout requests

- **E-HOST-API-RECORD:** repair imports `node:crypto` for SHA-256 cache
  digests. The unchanged inventory gate reports exactly one new count:
  `node:crypto` 85 → 86. Exact `183de45f3` source passes the gate. Z owns
  `docs/ide-compatibility/host-api.md`; regenerate/review that integrated
  snapshot and record this bounded lane deferral in PLAN §7 until closed.
  No VS Code call, theme variable or additional built-in was introduced.
- **E-DUPLICATION-BASELINE:** exact `183de45f3` has 34 clone pairs, four
  in E's owning tests. Initial repair had three more owning fixture copies.
  E removed all seven owning copies using shared refusal/record fixtures;
  final scan has 30 clone pairs, none in E. The remaining copies are the
  companion/serve and old/new token-file sources/tests, outside E ownership.
  Z must deduplicate those under the unchanged zero threshold and record
  the inherited lane failure in PLAN §7 until closed. No ignores changed.
- Update PLAN's E delivery status and CHANGELOG's Unreleased section when
  integrating this repaired callable library. Suggested changelog entry:
  “Harden the unwired BYO judge library with redaction, generation fences,
  immutable settlement tariffs, technique-specific output budgets and a
  bounded credential-aware cache. Production routing remains pending.”

These requests are not unresolved RVM98P2E findings. All ten owning defects
are fixed and regression-proven. Shared inventory/duplicate closeout, full
quality and production codec/routing/package certification remain required
for integrated delivery. No source activation or spending is authorized.
