# Lane REASONSHAPESR2 — certification record

Branch `feat/reasoning-controls` (round 1's branch, continued).
Capture plan: [REASONSHAPESR2-capture-plan.json](REASONSHAPESR2-capture-plan.json)
(27 requests). No lane request touched any provider: every request shape
below comes from the provider's own documentation page, quoted with its
address and the day it was read, and stays **UNVERIFIED** until the lead's
real-request answers land. Round 1's corrected rows live in
[REASONSHAPES.md](REASONSHAPES.md); this record covers round 2's eleven
gaps plus the xAI-first defect the lead measured on the published product.

One rule throughout (rank 1, seen three ways): what Thinking off and each
effort name SEND is decided by the model's capability record, and a value
the model does not take is never sent and never silently replaced. A
listed level rides as named; an unlisted on-level resolves to `default`
(the provider default: codecs omit the field); off rides as `none` where
the record affirms disabling (a listed `none`, an affirmed `canDisable`,
or an affirmed off switch); anywhere else the record speaks, the typed
refusal `unsupported_reasoning_effort` is raised before dispatch. A model
with no usable levels takes the plain turn on every setting: no reasoning
field in any request on any route. Per model, from the record, never per
vendor: no provider name sits in a codec branch.

## Wire census sign-off

The golden suite (`test/unit/reasoningResolver.test.ts`) dispatches the
production bytes for every catalogue model × every setting through a fake
transport. Its pins were re-recorded only after a line-by-line review of
the new bytes against the old (`$TMPDIR/basedump2` at `5f16193a8` vs
`$TMPDIR/wiredump3` on this tree, plus a fresh anthropic dump after the
typed-refusal fix; dumps removed after review). Every change is intended:

- Unlisted level → field omitted (was: remapped to a neighbour or sent
  anyway). Fireworks, Groq, Hugging Face, Mistral ×2, OpenAI, OpenRouter
  rows flip from a sent value to absent bytes with the turn otherwise
  succeeding.
- Refusal before dispatch where the record speaks (was: sent). OpenAI
  (8 rows: Thinking off on models whose record lists usable levels
  without `none`), xAI, OpenRouter (28), Hugging Face (12), Fireworks
  (5), Mistral (1), Groq (1), Gemini (3 Thinking-off rows on
  flash-latest, flash-lite-latest, 3.1-flash-lite-image, whose catalogue
  rows list usable levels without `none`; round 1's budget-0 sends were
  never verified live).
- Anthropic off switch rides (GAPANTH-G02): Haiku 4.5, Opus 4.5/4.6,
  Opus 5 and Sonnet 5.5 send `thinking: {type: disabled}` (Sonnet 5.5
  sends `between_tools`); Opus 5.5, Fable 5/5.1 refuse with
  `unsupported_reasoning_effort`. Was: no thinking field (thinking stayed
  on, billed) or a silent plain turn.
- Manual-only tiers ride unnamed with a tier-sized budget (GAPANTH-G10/
  G17): Opus 4.5/4.6 and Haiku 4.5 on-level rows now carry manual
  thinking. Under the suite's 512-token cap the codec loudly refuses
  with `invalid_thinking_budget` (a suite artifact of the small cap, now
  typed via `AnthropicCodecError` instead of the transport's generic
  error); at real caps the same rows send.
- xAI no-levels models omit the field at every setting (the xAI-first
  defect): `grok-build-0.1`, `grok-4.20-0309-reasoning` and
  `grok-4.20-0309-non-reasoning` went from `reasoning: {effort: ...}` on
  the wire to no reasoning key at all.
- `ultra` resolves to the provider default and omits where unlisted
  (Ollama rows flip from `think: false` to `think: true`): the person
  asked for most thinking, not for none.
- No-change presets: azure (no client in either dump), custom,
  llama.cpp, lmstudio, together, vllm, zai.

Review addendum (RVREASONSHAPES, 2026-10-14): the no-neighbour rule
above did not hold on Thinking-off-switch models — the shared resolver
still substituted the nearest listed level there (and an unused client
alias map rode five files), and the Gemini codec turned the provider
default into a 1,024-token thinking budget on budget-mode models. Both
are fixed on the review branch; the gemini, together and zai golden
pins were re-recorded for exactly those byte changes (line counts
unchanged).

## xAI-first defect — done

Every turn on an xAI entry with `grok-build-0.1` failed on the published
product while the run's stated effort said `high` and the model's own
effort option listed no levels. The provider's answer is known by direct
request: with no reasoning field the model answers 200; with
`reasoning: {effort: "high"}` it answers 400
(`{"code":"invalid-argument","error":"Model grok-build-0.1 does not
support parameter reasoningEffort."}`). By construction in the round-1
mechanism: a model whose record has no usable effort levels gets no
reasoning field in any request on any route (`hasUsableEffortLevels`,
`effortForPolicy`, the responses-chat omit in `configured.ts`), the
run's stated effort says `default`, and `exec --effort` accepts `none`
for the terminal agent. Verified at the wire: all eight settings on
`grok-build-0.1` dispatch bytes with no reasoning key (was: the field
present). UNVERIFIED live until XAI-EFFORT-420R/420N answer; the two
4.20 ids' provider answer is still unknown and nothing assumes it.

Person's steps: add an xAI entry, pick `grok-build-0.1`, send any turn.
Observe the turn succeeds and the run's stated effort is the default,
not high. Before: every turn failed with the Models & Agents error.

## GAPANTH-G01 — done

Thinking blocks were dropped between tool turns because the decoder
stamped the saved block with the qualified id
(`anthropic/claude-sonnet-5-5`) while the encoder compared the bare id.
The decoder now stamps the native model id the provider's block belongs
to, both call sites in `configured.ts` pass it, and the encoder replays
a block only for the model that produced it. What is sent back follows
the provider's rule: the final assistant turn begins with the model's
own thinking block unchanged
(`https://platform.claude.com/docs/en/build-with-claude/extended-thinking`,
read 2026-10-13). UNVERIFIED live until ANTH-REPLAY-1/2 answer; the
unit tests use one string for both ids so they cannot see a mismatch —
the golden suite pins the replay bytes per model.

Person's steps: on Opus 4.5/4.6 or Sonnet 4.6, start a turn that calls a
tool, then continue. Observe the second request carries the first
turn's thinking block verbatim at the head of the assistant turn.
Before: the block was missing and manual-mode turns could not continue.

## GAPANTH-G02 — done

Thinking off now sends the affirmed switch: `thinking: {type:
"disabled"}` where the thinking table affirms it (Opus 5 and Haiku 5.5
at high or below; every 4.x row at any effort), Sonnet 5.5's
`between_tools`
(`https://platform.claude.com/docs/en/build-with-claude/thinking`,
read 2026-10-13). Where the table answers 400 to `disabled` (Opus 5.5,
Fable 5, Fable 5.1, and Sonnet 5.5 for `disabled`), the record carries
`canDisable: no` and the product refuses Thinking off before dispatch
with `unsupported_reasoning_effort` instead of billing silent thinking;
the picker reads the same flag so the person is told it cannot be
turned off there. The 4.x and Opus 5 / Haiku 5.5 facts are dated preset
patches shadowing a catalogue that carries no toggle; the live list
wins where it speaks. UNVERIFIED live until ANTH-DISABLE-OPUS55,
ANTH-BETWEEN-SONNET55, ANTH-DISABLE-HAIKU55, ANTH-DISABLE-OPUS5,
ANTH-DISABLE-OPUS45 and ANTH-DISABLE-FABLE5 answer.

Person's steps: pick Opus 5, set the Thinking toggle off, send a turn.
Observe a direct answer with no thinking billed. On Opus 5.5, observe
the toggle refuses with the named reason instead of sending. Before:
both sent no thinking field and both thought, billed.

## OPENAI-G02 — done

Thinking off on `gpt-6-astra` and `gpt-6.1-sol` refused before dispatch:
the reasoning page documents that `none` (and `minimal`) are not
supported there
(`https://developers.openai.com/api/docs/guides/reasoning`, read
2026-10-13), so the resolver raises `unsupported_reasoning_effort`
instead of sending a value the provider rejects. UNVERIFIED live until
OPENAI-NONE-ASTRA, OPENAI-NONE-SOL and OPENAI-MINIMAL-SOL answer.

Person's steps: pick `gpt-6-astra`, set Thinking off, send. Observe the
refusal naming the setting before anything is dispatched. Before: the
request went out with `reasoning.effort: "none"`.

## XAI-G02 — done

Same rule on xAI: `grok-4.7`, `grok-4.6` and `grok-4.5` cannot disable
reasoning and list no `none`
(`https://docs.x.ai/developers/model-capabilities/text/reasoning`,
read 2026-10-13), so Thinking off refuses before dispatch. UNVERIFIED
live until XAI-NONE-45 and XAI-NONE-47 answer: xAI does not say whether
it refuses or ignores the value, so the product refuses rather than
sends.

Person's steps: pick `grok-4.5`, set Thinking off, send. Observe the
refusal before dispatch. Before: `reasoning.effort: "none"` went out.

## XAI-G14 — done

The catalogue rows with no effort evidence (`grok-4.20-0309-reasoning`,
`grok-4.20-0309-non-reasoning`, `grok-build-0.1`) send no reasoning
field at any setting (the xAI-first defect, above): only `none` could
ever be sent before, and the provider refuses the parameter itself.
`grok-build-0.1` works at the default effort only, which is what the
omission gives it. UNVERIFIED live until XAI-EFFORT-420R, XAI-EFFORT-420N
and XAI-LIST answer; nothing is assumed about the two 4.20 ids.

Person's steps: pick `grok-4.20-0309-non-reasoning`, send at any effort.
Observe a plain turn with no reasoning field on the wire.

## OPENAI-G01 — done

The composer's effort slider is no longer hidden for configured-provider
ids: `providerRegistry` posts each row's own `effortLevels` and
`defaultEffort` (the picker's `ModelOption.effortLevels`), so a person
on an OpenAI model chosen through the Models panel is offered exactly
the levels the record has instead of the session sending the composer
default `high` — which `gpt-6-astra` and `gpt-6.1-sol` cannot run at
every level. Levels a provider adds later ride through the record, not
through the six-name enum. UNVERIFIED live: the offered levels are only
as current as the catalogue plus live list.

Person's steps: add an OpenAI entry, open the Models panel, pick
`gpt-6-astra`. Observe the effort slider shows that model's levels with
its default selected. Before: no slider, and the turn sent `high`.

## XAI-G01 — done

Same record for xAI plus the dated-catalogue correction: the preset
fact gives `grok-4.5` the live list's `xhigh` (sent as `high`, which the
provider treats as `high`), and the registry reads the live
`default_reasoning_effort` (`low` for `grok-4.3`, `high` for 4.5–4.7)
as the slider default. UNVERIFIED live until XAI-LIST settles the
catalogue against the key's list.

Person's steps: add an xAI entry, pick `grok-4.3`. Observe the slider
offers low/medium/high/xhigh with low selected. Before: no slider, and
the turn sent `high`.

## GAPANTH-G10 — done

Effort is never silently dropped: an unlisted on-level resolves to
`default` (omit, provider default) rather than switching thinking off,
and manual-only models (Opus 4.5/4.6, Sonnet 4.6, Haiku 4.5) ride the
tier through unnamed with a tier-sized budget so extended thinking can
happen at all. On Haiku 5.5 the key's five levels now reach the wire.
UNVERIFIED live until ANTH-MINIMAL (does Sonnet 5 take `minimal`, or
must the client map it to `low`?) and ANTH-XHIGH-46 (is `xhigh`
accepted on 4.6, or must the product refuse it?) answer.

Person's steps: pick Opus 4.6, set effort to High, send. Observe the
request carries manual thinking with the high tier's budget. Before:
no thinking field at all.

## GAPANTH-G17 — done

Manual thinking sends the tier's budget from `MANUAL_THINKING_BUDGET_BY_EFFORT`
(`src/shared/constants.ts`) instead of a flat 1,024 tokens, and Opus
4.5 sends the `interleaved-thinking-2025-05-14` beta header so it can
think between tool calls
(`https://platform.claude.com/docs/en/build-with-claude/extended-thinking`
and `/api/beta-headers`, read 2026-10-13). Where the budget cannot fit
the run's cap the codec refuses loudly (`invalid_thinking_budget`)
instead of sending a starved turn. The exact tier-to-token map is
UNVERIFIED: no cheap probe settles what each tier should size, only
that thinking happens (ANTH-MINIMAL, ANTH-XHIGH-46).

Person's steps: pick Opus 4.5, attach a tool, send at High. Observe the
request carries the beta header and the high tier's budget, and the
model thinks again after the tool result. Before: a flat 1,024-token
budget and no header.

## OPENAI-G08 — partly (wire ready, no product surface yet)

`reasoning.mode: "pro"` can be carried: the schemas and the responses
codec accept an optional `mode` and pass it beside effort, covered by
codec tests through the real builder. But no product surface sets it
yet — no composer control, session option or exec flag populates the
field — so a person cannot request pro mode today. UNVERIFIED live
until OPENAI-PRO answers; the follow-up is the surface that sets the
field.

Person's steps (after the follow-up surface lands and the capture
answers): pick the pro replacement model, request pro mode, send.
Observe the wire carries `reasoning.mode: "pro"`. Before: no way to
send it at any layer.

## OPENAI-G07 — partly (wire ready, no product surface yet)

`reasoning.context` (`auto`, `current_turn`, `all_turns`) rides as an
optional passthrough next to effort; unset, the provider default
applies (`all_turns` on gpt-5.6 and later). Same state as G08: codec
ready and tested, no surface sets the field yet. UNVERIFIED live until
OPENAI-CONTEXT answers.

Person's steps (after the follow-up surface lands and the capture
answers): pick `gpt-6.1-sol`, request `current_turn` context, send.
Observe the wire carries it. Before: never sent.

## thinking-off-record — Gemini Thinking off (no gap, behaviour changed)

The same pre-dispatch refusal now answers Thinking off on
`gemini-flash-latest`, `gemini-flash-lite-latest` and
`gemini-3.1-flash-lite-image`, whose catalogue rows list usable levels
with no `none` and no disable affirmation. Round 1 sent
`thinkingBudget: 0` there, never verified live; the codec still sends
budget 0 for `none` where the record allows it, so a capture answer of
200 keeps today's refusal honest and a 400 confirms it. UNVERIFIED
until GEMINI-NONE-FLASH and GEMINI-NONE-LITE answer.

## Review-found fixes inside this lane

- The golden mirror compared `effortForPolicy` against a vacuous
  oracle (out-of-scope names, always equal). It now passes policy and
  setting explicitly; 4,800+ comparisons genuinely agree.
- `typecheck` was red on the tree (duplicated `defaultEffort` /
  `isDefault`, a widened preset-fact literal, three test-type errors
  including the owned CP-G04 search-history case): fixed, all five
  projects green.
- `duplication` (0% threshold) named six clones, all from this lane:
  fixed by sharing the reasoning-fields base interface, the Meta
  routing preamble, the DeepSeek facts map, and one capture-stream
  helper. 0 clones.
- Both owned red tests from round 1 (CP-G04 search-history drop,
  META-G05 effort-reader shape) pass through the real modules.

## Not run on this rig

The six loopback transport tests in `configuredProviders.test.ts`
(listen on loopback: sandbox EPERM, proven by a node listen probe),
the whole-suite run (lane rule: only touched files), and the packed
product drills that need a listener. The lead runs those outside the
sandbox.
