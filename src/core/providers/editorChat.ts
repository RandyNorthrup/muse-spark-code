// Editor chat's pure logic (M95c part 2), free of the `vscode` import so
// unit tests drive the real code: request conversion, limits, rates,
// reasoning effort and the confirmation evidence. The editor's role and
// tool-mode values arrive as the injected wire: opaque numbers the module
// compares by identity, never interprets. The provider passes the real
// `vscode` enums; tests pass arbitrary sentinels. Anything that touches
// the editor (the consent dialog, progress parts, registration) stays in
// `src/host/models/lmProvider.ts`, covered through the integration suite.
import * as z from 'zod/mini'
import type { ResolvedModel } from '../backends/modelapi/modelPolicy'
import type { CreateResponseBody, InputItem } from '../backends/modelapi/schemas'
import { Usd } from '../../shared/usd'
import {
  ANTHROPIC_MAX_IMAGE_BYTES,
  META_IMAGE_MAX_BYTES,
  MODEL_API_EFFORT_OFF,
  TOKENS_PER_MILLION,
  EDITOR_CHAT_PROMPT_CACHE_RETENTION,
  UI_TEXT,
} from '../../shared/constants'
import { boundToolResultText } from '../backends/modelapi/toolResultBound'
import { parseModelRef } from './modelRef'
import { fill, formatNumber } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'

/**
The editor's own role and tool-mode values, as the host's enums give
them: compared by identity only. `requiredToolMode` parses (the editor
may ask for it) and the body still refuses anything but `auto`.
*/
export interface EditorChatWireValues {
  readonly userRole: number
  readonly assistantRole: number
  readonly autoToolMode: number
  readonly requiredToolMode: number
}

const modelOptionsSchema = z.strictObject({ reasoningEffort: z.optional(z.string()) })
const textSchema = z.object({ value: z.string() })
const callSchema = z.object({
  callId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
})
const resultSchema = z.object({ callId: z.string(), content: z.array(textSchema) })
const imageSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.instanceof(Uint8Array).check(z.refine((value) => value.byteLength > 0)),
})

/**
The provider's own documented image bound for editor-sent pictures, or
undefined where the provider states none: only documented bounds are
enforced locally (D121); other providers' own refusals reach the caller
in words.
*/
const IMAGE_MAX_BYTES_BY_PROVIDER: Readonly<Record<string, number>> = {
  anthropic: ANTHROPIC_MAX_IMAGE_BYTES,
  meta: META_IMAGE_MAX_BYTES,
}
const imageMaxBytesFor = (providerId: string): number | undefined =>
  IMAGE_MAX_BYTES_BY_PROVIDER[providerId]

export function editorChatMessageSchema(wire: EditorChatWireValues) {
  return z.object({
    role: z.union([z.literal(wire.userRole), z.literal(wire.assistantRole)]),
    content: z.array(z.union([callSchema, resultSchema, textSchema, imageSchema])),
  })
}

function editorChatMessagesSchema(wire: EditorChatWireValues) {
  return z.array(editorChatMessageSchema(wire))
}

function editorChatOptionsSchema(wire: EditorChatWireValues) {
  return z.object({
    tools: z.optional(
      z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          inputSchema: z.optional(z.record(z.string(), z.unknown())),
        }),
      ),
    ),
    toolMode: z.optional(z.union([z.literal(wire.autoToolMode), z.literal(wire.requiredToolMode)])),
    modelOptions: z.optional(z.record(z.string(), z.unknown())),
  })
}

/**
The provider's own refusal, distinct from anything unexpected: callers
skip a refused model and rethrow anything else. The cause stays on the
thrown refusal for the record; only the fixed sentence reaches the person.
*/
export class EditorChatRefusalError extends Error {
  constructor(cause?: unknown) {
    super(UI_TEXT.editorChatRefused, cause === undefined ? undefined : { cause })
  }
}
function fail(): never {
  throw new EditorChatRefusalError()
}

export function editorChatLimits(model: ResolvedModel): { input: number; output: number } {
  const input = model.contextTokens
  const output = model.policy.output.maxTokens
  return input === undefined ||
    output === undefined ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input <= 0 ||
    output <= 0
    ? fail()
    : { input, output }
}

export function editorChatBody(
  ref: string,
  messages: unknown,
  options: unknown,
  output: number,
  effort: string,
  inputWindow: number,
  wire: EditorChatWireValues,
): CreateResponseBody {
  const parsed = editorChatMessagesSchema(wire).safeParse(messages)
  const opts = editorChatOptionsSchema(wire).safeParse(options)
  const providerId = parseModelRef(ref)?.providerId
  if (
    providerId === undefined ||
    !parsed.success ||
    !opts.success ||
    (opts.data.toolMode !== undefined && opts.data.toolMode !== wire.autoToolMode) ||
    !modelOptionsSchema.safeParse(opts.data.modelOptions ?? {}).success
  )
    return fail()
  const maxImageBytes = imageMaxBytesFor(providerId)
  const input: InputItem[] = []
  for (const message of parsed.data) {
    for (const part of message.content) {
      if ('data' in part) {
        if (message.role !== wire.userRole) return fail()
        if (maxImageBytes !== undefined && part.data.byteLength > maxImageBytes) return fail()
        input.push({
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
              detail: 'auto',
            },
          ],
        })
      } else if ('input' in part) {
        if (message.role !== wire.assistantRole) return fail()
        input.push({
          type: 'function_call',
          call_id: part.callId,
          name: part.name,
          arguments: JSON.stringify(part.input),
        })
      } else if ('content' in part) {
        if (message.role !== wire.userRole) return fail()
        // TOOLCAP: the editor's tool text enters the request through the
        // one bound, sized by the model's own window. No spill writer
        // runs here, so text over its share fails loudly instead of
        // riding unbounded into a paid call.
        const bounded = boundToolResultText(part.content.map((text) => text.value).join('\n'), {
          maxBytes: Infinity,
          windowTokens: inputWindow,
        })
        if (bounded.cut !== undefined) return fail()
        input.push({
          type: 'function_call_output',
          call_id: part.callId,
          output: bounded.text,
        })
      } else
        input.push({
          type: 'message',
          role: message.role === wire.userRole ? 'user' : 'assistant',
          content: [
            {
              type: message.role === wire.userRole ? 'input_text' : 'output_text',
              text: part.value,
            },
          ],
        })
    }
  }
  return {
    model: ref,
    input,
    instructions: '',
    tools: (opts.data.tools ?? []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      strict: false,
    })),
    tool_choice: 'auto',
    reasoning: { effort },
    stream: true,
    store: false,
    include: [],
    prompt_cache_key: '',
    prompt_cache_retention: EDITOR_CHAT_PROMPT_CACHE_RETENTION,
    max_output_tokens: output,
  }
}

export const editorChatConfirmationEvidence = (model: ResolvedModel) =>
  JSON.stringify({
    model: model.ref,
    origin: model.origin,
    pricing: model.policy.pricing,
  })

const pricePerMillion = (rate: number) =>
  formatUsd(Usd.from(rate).times(TOKENS_PER_MILLION).toAmount(), 2)

export const editorChatRates = (model: ResolvedModel) => {
  const pricing = model.policy.pricing
  if (pricing.kind === 'local') return UI_TEXT.modelLocal
  if (pricing.kind !== 'priced') return fail()
  const card = pricing.card
  const tokenRates = (tier: typeof card.longContextTier) => {
    const input = tier?.input ?? card.input
    const output = tier?.output ?? card.output
    const cached = tier?.cachedInput ?? card.cachedInput ?? input
    const write = tier?.cacheWrite ?? card.cacheWrite ?? input
    const write1h = tier?.cacheWrite1h ?? card.cacheWrite1h ?? write
    return fill(UI_TEXT.editorChatRates, {
      input: pricePerMillion(input),
      output: pricePerMillion(output),
      cached: pricePerMillion(cached),
      write: pricePerMillion(write),
      write1h: pricePerMillion(write1h),
    })
  }
  const base = tokenRates(undefined)
  const fees = fill(UI_TEXT.editorChatFees, {
    request: formatUsd(card.request ?? 0, 2),
    image: formatUsd(card.image ?? 0, 2),
  })
  const tier = card.longContextTier
  return [
    base,
    fees,
    ...(tier === undefined
      ? []
      : [
          fill(UI_TEXT.editorChatTier, {
            tokens: formatNumber(tier.fromTokens),
            rates: tokenRates(tier),
          }),
        ]),
  ].join('\n')
}

export const editorChatReasoningEffort = (
  model: ResolvedModel,
  options: unknown,
  wire: EditorChatWireValues,
) => {
  const opts = editorChatOptionsSchema(wire).parse(options)
  const requested = modelOptionsSchema.parse(opts.modelOptions ?? {}).reasoningEffort
  const { supported, effortLevels, canDisable } = model.policy.reasoning
  // Reasoning off bills no reasoning level: a listed `none` level and a
  // recorded disable capability each run without reasoning, even when the
  // catalogue records only one of them.
  const canRunWithoutReasoning =
    canDisable.state === 'yes' ||
    (effortLevels.state === 'yes' && effortLevels.value.includes('none'))
  // Meta's thinking-off wire value is `minimal` (`none` is a 400); every
  // other provider runs without reasoning on `none`.
  const offEffort = model.policy.identity.provider === 'meta' ? MODEL_API_EFFORT_OFF : 'none'
  if (requested !== undefined) {
    // An explicit off request runs on the same terms as the default below:
    // it is honoured whenever the catalogue shows the model can run without
    // reasoning, even when `none` is not a listed level, and it is sent on
    // the provider's off wire value.
    if (requested === 'none') {
      if (supported.state === 'no') return 'none'
      return canRunWithoutReasoning ? offEffort : fail()
    }
    return supported.state !== 'no' &&
      effortLevels.state === 'yes' &&
      effortLevels.value.includes(requested)
      ? requested
      : fail()
  }
  if (supported.state === 'no') return 'none'
  if (effortLevels.state === 'yes') {
    if (canRunWithoutReasoning) return offEffort
    const level = effortLevels.value.find((value) => value !== 'none')
    if (level !== undefined) return level
  }
  return canDisable.state === 'yes' ? offEffort : fail()
}
