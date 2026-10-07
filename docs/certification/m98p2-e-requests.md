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
  API. This library adds none.
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
