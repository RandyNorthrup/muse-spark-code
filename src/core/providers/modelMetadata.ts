// Reinterpret captured native metadata without discarding its JSON fields.
// A field absent from a list stays unknown; a price never proves a feature.
import * as z from 'zod/mini'
import {
  ANTHROPIC_IMAGE_200K_WINDOW_TOKENS,
  ANTHROPIC_IMAGE_MAX_COUNT,
  ANTHROPIC_IMAGE_MAX_COUNT_200K,
  ANTHROPIC_MAX_IMAGE_BYTES,
  IMAGE_MEDIA_TYPES,
  XAI_IMAGE_MEDIA_TYPES,
  XAI_MAX_IMAGE_BYTES,
} from '../../shared/constants'
import type { CapabilityEvidence, CapabilityOverrides, CapabilitySource } from './capabilityRecord'

export const nativeModelMetadataSchema = z.record(z.string(), z.json())
export type NativeModelMetadata = z.infer<typeof nativeModelMetadataSchema>
const strings = z.array(z.string())
const numeric = z.number().check(z.nonnegative())
const reasoningOptionsSchema = z.array(
  z.looseObject({
    type: z.string(),
    values: z.optional(strings),
    min: z.optional(numeric),
    max: z.optional(numeric),
  }),
)

/** Native records are JSON-validated before interpretation or persistence. */
export function nativeCapabilityEvidence(
  preset: string,
  input: unknown,
  source: CapabilitySource,
  selectedUpstream?: string,
): CapabilityEvidence {
  const native = nativeModelMetadataSchema.parse(input)
  const read = <T>(schema: z.ZodMiniType<T>, ...path: string[]): T | undefined => {
    let value: unknown = native
    for (const key of path) {
      if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key))
        return undefined
      value = Reflect.get(value, key)
    }
    return value === undefined ? undefined : schema.parse(value)
  }
  const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })
  const flag = (isSupported: boolean) =>
    isSupported ? yes<true>(true) : { state: 'no' as const, source }
  const fields: CapabilityOverrides = {}
  const tools: NonNullable<CapabilityOverrides['tools']> = {}
  const reasoning: NonNullable<CapabilityOverrides['reasoning']> = {}
  const output: NonNullable<CapabilityOverrides['output']> = {}
  const limits: NonNullable<CapabilityOverrides['limits']> = {}
  const modalities: NonNullable<CapabilityOverrides['modalities']> = {}
  const sampling: NonNullable<CapabilityOverrides['sampling']> = {}
  // Native support is required. Research supplies the documented provider
  // bounds (Anthropic's byte bound, xAI's jpg/jpeg/png formats up to 20
  // MiB, XAI-G11); other providers state no image bound here, so none is
  // enforced locally for them (D121) — the provider's own refusal reaches
  // the caller in words.
  const imagePolicy: { mimes: string[]; maxBytes?: number; maxCount?: number } = {
    mimes: [...IMAGE_MEDIA_TYPES],
  }
  if (preset === 'anthropic') imagePolicy.maxBytes = ANTHROPIC_MAX_IMAGE_BYTES
  else if (preset === 'xai') {
    imagePolicy.mimes = [...XAI_IMAGE_MEDIA_TYPES]
    imagePolicy.maxBytes = XAI_MAX_IMAGE_BYTES
  }
  const context =
    read(numeric, 'limit', 'context') ??
    read(numeric, 'context_length') ??
    read(numeric, 'context_window') ??
    read(numeric, 'max_context_length') ??
    read(numeric, 'inputTokenLimit') ??
    read(numeric, 'max_input_tokens') ??
    // Local servers (captured 2026-10-10, C-M95-4 R2): llama.cpp lists the
    // live `--ctx-size` window as `meta.n_ctx` with the trained window in
    // `meta.n_ctx_train`, and vLLM uses `max_model_len`. Without these a
    // scanned local model keeps an unknown window and manual compact
    // assumes Meta's window.
    read(numeric, 'meta', 'n_ctx') ??
    read(numeric, 'meta', 'n_ctx_train') ??
    read(numeric, 'max_model_len') ??
    read(numeric, 'n_ctx')
  const maxOutput =
    read(numeric, 'limit', 'output') ??
    read(numeric, 'max_tokens') ??
    read(numeric, 'outputTokenLimit') ??
    // DeepSeek lists `max_output_tokens` per model (captured 2026-10-04,
    // docs/certification/m95-captures/deepseek/01-models-list.json).
    read(numeric, 'max_output_tokens') ??
    read(numeric, 'max_completion_tokens') ??
    read(numeric, 'top_provider', 'max_completion_tokens')
  const maxInput =
    read(numeric, 'limit', 'input') ??
    read(numeric, 'max_input_tokens') ??
    read(numeric, 'inputTokenLimit')
  if (context !== undefined && context > 0) limits.contextTokens = context
  // Anthropic's per-request image count rides the model's own window (its
  // vision doc, read 2026-10-22): 100 for 200k-context models, 600 where
  // the window is anything else or unknown.
  if (preset === 'anthropic')
    imagePolicy.maxCount =
      context === ANTHROPIC_IMAGE_200K_WINDOW_TOKENS
        ? ANTHROPIC_IMAGE_MAX_COUNT_200K
        : ANTHROPIC_IMAGE_MAX_COUNT
  if (maxInput !== undefined && maxInput > 0) limits.inputTokens = maxInput
  if (maxOutput !== undefined && maxOutput > 0) {
    output.maxTokens = maxOutput
    output.acceptsLimit = yes(true)
  }
  const parameters = read(strings, 'supported_parameters') ?? read(strings, 'supported_features')
  const samplingParameters = read(strings, 'supported_sampling_parameters') ?? parameters
  const toolCalling =
    read(z.boolean(), 'tool_call') ??
    // Fireworks lists `supports_tools` per model (captured 2026-10-04,
    // docs/certification/m95-captures/fireworks/01-models-list.json).
    read(z.boolean(), 'supports_tools') ??
    read(z.boolean(), 'capabilities', 'function_calling')
  if (toolCalling !== undefined) tools.calling = flag(toolCalling)
  else if (parameters !== undefined) tools.calling = flag(parameters.includes('tools'))
  if (parameters?.includes('parallel_tool_calls') === true) tools.parallel = yes(true)
  const reasoningFlag =
    read(z.boolean(), 'thinking') ??
    (typeof native['reasoning'] === 'boolean' ? native['reasoning'] : undefined) ??
    read(z.boolean(), 'capabilities', 'reasoning')
  if (reasoningFlag !== undefined) reasoning.supported = flag(reasoningFlag)
  if (parameters?.includes('reasoning') === true) reasoning.supported = yes(true)
  const defaultEffort = read(z.string(), 'capabilities', 'default_reasoning_effort')
  if (defaultEffort !== undefined) reasoning.defaultEffort = defaultEffort
  const reasoningOptions = read(reasoningOptionsSchema, 'reasoning_options')
  const efforts =
    reasoningOptions?.find((option) => option.type === 'effort')?.values ??
    read(strings, 'capabilities', 'reasoning_effort') ??
    read(strings, 'reasoning', 'supported_efforts') ??
    // DeepSeek lists `effort.supported_levels` per model (captured
    // 2026-10-04, docs/certification/m95-captures/deepseek/01-models-list.json).
    read(strings, 'effort', 'supported_levels')
  if (efforts !== undefined) {
    reasoning.effortLevels = yes(efforts)
    if (efforts.some((effort) => effort !== 'none')) {
      reasoning.supported = yes(true)
      reasoning.modes = yes([preset === 'anthropic' ? 'adaptive' : 'level'])
    }
  }
  const budgetOption = reasoningOptions?.find((option) => option.type === 'budget_tokens')
  if (budgetOption !== undefined) {
    reasoning.modes = yes([preset === 'anthropic' ? 'manual' : 'budget'])
    if (budgetOption.min !== undefined || budgetOption.max !== undefined)
      reasoning.budget = { min: budgetOption.min, max: budgetOption.max }
  }
  if (reasoningOptions?.some((option) => option.type === 'toggle') === true)
    reasoning.canDisable = yes(true)
  const mandatory = read(z.boolean(), 'reasoning', 'mandatory')
  if (mandatory !== undefined) {
    reasoning.forced = flag(mandatory)
    reasoning.canDisable = flag(!mandatory)
  }
  const inputs =
    read(strings, 'input_modalities') ??
    read(strings, 'architecture', 'input_modalities') ??
    read(strings, 'modalities', 'input') ??
    (Array.isArray(native['modalities']) ? strings.parse(native['modalities']) : undefined)
  if (inputs !== undefined) {
    modalities.image = inputs.includes('image') ? yes(imagePolicy) : { state: 'no', source }
    modalities.audio = flag(inputs.includes('audio'))
    // Generic "file" does not establish PDF support.
    if (inputs.includes('pdf')) modalities.pdf = yes({})
  }
  const vision = read(z.boolean(), 'capabilities', 'vision')
  if (vision !== undefined) modalities.image = vision ? yes(imagePolicy) : { state: 'no', source }
  // Fireworks lists `supports_image_input` per model (captured 2026-10-04,
  // docs/certification/m95-captures/fireworks/01-models-list.json).
  const supportsImageInput = read(z.boolean(), 'supports_image_input')
  if (supportsImageInput !== undefined)
    modalities.image = supportsImageInput ? yes(imagePolicy) : { state: 'no', source }
  const temperature = native['temperature']
  if (typeof temperature === 'boolean') sampling.temperature = flag(temperature)
  if (typeof temperature === 'number' || read(numeric, 'default_model_temperature') !== undefined)
    sampling.temperature = yes(true)
  if (read(numeric, 'topP') !== undefined) sampling.topP = yes(true)
  const topP = read(z.boolean(), 'top_p')
  if (topP !== undefined) sampling.topP = flag(topP)
  const structuredOutput = read(z.boolean(), 'structured_output')
  if (structuredOutput !== undefined)
    output.formats = yes(structuredOutput ? ['text', 'json_schema'] : ['text'])
  if (preset === 'huggingface') {
    // The router's `/v1/models` row prices and bounds per live upstream
    // (router.huggingface.co, read 2026-10-12): each states `context_length`
    // and its `supports_tools` / `supports_structured_output` flags. An
    // explicitly chosen upstream decides; otherwise the context promises no
    // more than the smallest live window, and tools/structured stay at the
    // catalogue's answer unless every stating upstream agrees.
    const routerUpstreams = z
      .array(
        z.object({
          provider: z.string(),
          status: z.string(),
          context_length: z.optional(z.number()),
          supports_tools: z.optional(z.boolean()),
          supports_structured_output: z.optional(z.boolean()),
        }),
      )
      .safeParse(native['providers'])
    if (routerUpstreams.success) {
      const live = routerUpstreams.data.filter((row) => row.status === 'live')
      const scoped =
        selectedUpstream === undefined
          ? live
          : live.filter((row) => row.provider === selectedUpstream)
      const windows = scoped.flatMap((row) =>
        row.context_length !== undefined &&
        Number.isFinite(row.context_length) &&
        row.context_length > 0
          ? row.context_length
          : [],
      )
      if (windows.length > 0) limits.contextTokens = Math.min(...windows)
      const toolFlags = scoped.flatMap((row) =>
        row.supports_tools === undefined ? [] : [row.supports_tools],
      )
      if (toolFlags.length > 0 && toolFlags.every(Boolean)) tools.calling = yes(true)
      else if (toolFlags.length > 0 && toolFlags.every((supported) => !supported))
        tools.calling = { state: 'no', source }
      const structuredFlags = scoped.flatMap((row) =>
        row.supports_structured_output === undefined ? [] : [row.supports_structured_output],
      )
      if (structuredOutput === undefined && structuredFlags.length > 0)
        output.formats = yes(structuredFlags.every(Boolean) ? ['text', 'json_schema'] : ['text'])
    }
  }
  if (samplingParameters !== undefined) {
    sampling.temperature = flag(samplingParameters.includes('temperature'))
    sampling.topP = flag(samplingParameters.includes('top_p'))
  }
  if (parameters !== undefined) {
    const formats: ('text' | 'json_object' | 'json_schema' | 'strict_schema' | 'forced_tool')[] = [
      'text',
    ]
    if (parameters.includes('json_mode')) formats.push('json_object')
    if (parameters.includes('structured_outputs')) formats.push('json_schema')
    output.formats = yes(formats)
  }
  if (preset === 'anthropic') {
    const supported = read(z.boolean(), 'capabilities', 'thinking', 'supported')
    if (supported !== undefined) reasoning.supported = flag(supported)
    // Whether `thinking: {type: "disabled"}` is accepted (lane
    // REASONSHAPESR2, GAPANTH-G02): the thinking table answers 400 for it
    // on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1, Fable 5 and Mythos 5.
    // Sonnet 5.5 turns off up-front thinking with `between_tools` instead
    // (a preset fact, not this flag).
    const disabled = read(z.boolean(), 'capabilities', 'thinking', 'types', 'disabled', 'supported')
    if (disabled !== undefined) reasoning.canDisable = flag(disabled)
    const modes: ('off' | 'manual' | 'adaptive')[] = []
    if (read(z.boolean(), 'capabilities', 'thinking', 'types', 'enabled', 'supported') === true)
      modes.push('manual')
    if (read(z.boolean(), 'capabilities', 'thinking', 'types', 'adaptive', 'supported') === true)
      modes.push('adaptive')
    if (supported !== undefined) reasoning.modes = supported ? yes(modes) : { state: 'no', source }
    const effortSupported = read(z.boolean(), 'capabilities', 'effort', 'supported')
    if (effortSupported !== undefined)
      reasoning.effortLevels = effortSupported
        ? yes(
            ['low', 'medium', 'high', 'xhigh', 'max'].filter(
              (level) => read(z.boolean(), 'capabilities', 'effort', level, 'supported') === true,
            ),
          )
        : { state: 'no', source }
    if (
      reasoning.modes === undefined &&
      reasoning.effortLevels?.state === 'yes' &&
      reasoning.effortLevels.value.some((effort) => effort !== 'none')
    )
      reasoning.modes = yes(['adaptive'])
    for (const [key, nativeKey] of [
      ['image', 'image_input'],
      ['pdf', 'pdf_input'],
    ] as const) {
      const supportedMedia = read(z.boolean(), 'capabilities', nativeKey, 'supported')
      if (supportedMedia !== undefined) {
        if (key === 'image')
          modalities.image = supportedMedia ? yes(imagePolicy) : { state: 'no', source }
        else modalities.pdf = supportedMedia ? yes({}) : { state: 'no', source }
      }
    }
    const structured = read(z.boolean(), 'capabilities', 'structured_outputs', 'supported')
    if (structured !== undefined)
      output.formats = yes(structured ? ['text', 'json_schema'] : ['text'])
  }
  return {
    source,
    fields: {
      ...fields,
      tools,
      reasoning,
      output,
      limits,
      modalities,
      sampling,
      ...(typeof native['version'] === 'string' && { servedVersion: native['version'] }),
    },
  }
}

/**
A preset's Files API facts (OPENAI-G15, GAPANTH-G16): which upload dialect
a file takes. OpenAI and xAI speak the OpenAI multipart dialect (`file`
plus `purpose`); Anthropic takes `file` with an optional
`expires_in_seconds` (3600 to 7776000 seconds) and 500 MB per file
(platform.claude.com file guide, read 2026-10-13), and our uploads always
set an expiry. Retention for OpenAI and xAI is not documented, so it stays
unknown and the uploader deletes explicitly. Every value stays UNVERIFIED
until the capture plan's requests confirm it; anything else stays unknown
and uploads nothing.
*/
export function presetFilesEvidence(preset: string): CapabilityEvidence[] {
  const source: CapabilitySource = { kind: 'preset', ref: preset }
  const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })
  if (preset === 'openai' || preset === 'xai')
    return [
      {
        source,
        fields: { files: { upload: yes({ wire: 'openai-files' }) } },
      },
    ]
  if (preset === 'anthropic')
    return [
      {
        source,
        fields: {
          files: {
            upload: yes({ wire: 'anthropic-files', maxBytes: 500_000_000, retention: 'expiring' }),
          },
        },
      },
    ]
  return []
}

/** OpenAI/xAI and chat servers share captured id-bearing data/model envelopes. */
export function parseNativeModelsList(body: unknown): readonly NativeModelMetadata[] {
  const envelope = z
    .union([
      z.object({ data: z.array(nativeModelMetadataSchema) }),
      z.object({ models: z.array(nativeModelMetadataSchema) }),
      z.array(nativeModelMetadataSchema),
    ])
    .parse(body)
  let rows: NativeModelMetadata[]
  if (Array.isArray(envelope)) rows = envelope
  else if ('data' in envelope) rows = envelope.data
  else rows = envelope.models
  for (const row of rows) z.string().check(z.minLength(1)).parse(row['id'])
  return rows
}
