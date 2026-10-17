// Reinterpret captured native metadata without discarding its JSON fields.
// A field absent from a list stays unknown; a price never proves a feature.
import * as z from 'zod/mini'
import {
  ANTHROPIC_MAX_IMAGE_BYTES,
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
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
  // Native support is required. Research supplies Anthropic's provider bound;
  // other providers retain the product's existing conservative image bound.
  const imagePolicy = {
    mimes: [...IMAGE_MEDIA_TYPES],
    maxBytes: preset === 'anthropic' ? ANTHROPIC_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES,
  }
  const context =
    read(numeric, 'limit', 'context') ??
    read(numeric, 'context_length') ??
    read(numeric, 'context_window') ??
    read(numeric, 'max_context_length') ??
    read(numeric, 'inputTokenLimit') ??
    read(numeric, 'max_input_tokens')
  const maxOutput =
    read(numeric, 'limit', 'output') ??
    read(numeric, 'max_tokens') ??
    read(numeric, 'outputTokenLimit') ??
    read(numeric, 'max_completion_tokens') ??
    read(numeric, 'top_provider', 'max_completion_tokens')
  const maxInput =
    read(numeric, 'limit', 'input') ??
    read(numeric, 'max_input_tokens') ??
    read(numeric, 'inputTokenLimit')
  if (context !== undefined && context > 0) limits.contextTokens = context
  if (maxInput !== undefined && maxInput > 0) limits.inputTokens = maxInput
  if (maxOutput !== undefined && maxOutput > 0) {
    output.maxTokens = maxOutput
    output.acceptsLimit = yes(true)
  }
  const parameters = read(strings, 'supported_parameters') ?? read(strings, 'supported_features')
  const samplingParameters = read(strings, 'supported_sampling_parameters') ?? parameters
  const toolCalling =
    read(z.boolean(), 'tool_call') ?? read(z.boolean(), 'capabilities', 'function_calling')
  if (toolCalling !== undefined) tools.calling = flag(toolCalling)
  else if (parameters !== undefined) tools.calling = flag(parameters.includes('tools'))
  if (parameters?.includes('parallel_tool_calls') === true) tools.parallel = yes(true)
  const reasoningFlag =
    read(z.boolean(), 'thinking') ??
    (typeof native['reasoning'] === 'boolean' ? native['reasoning'] : undefined) ??
    read(z.boolean(), 'capabilities', 'reasoning')
  if (reasoningFlag !== undefined) reasoning.supported = flag(reasoningFlag)
  if (parameters?.includes('reasoning') === true) reasoning.supported = yes(true)
  const reasoningOptions = read(reasoningOptionsSchema, 'reasoning_options')
  const efforts =
    reasoningOptions?.find((option) => option.type === 'effort')?.values ??
    read(strings, 'capabilities', 'reasoning_effort') ??
    read(strings, 'reasoning', 'supported_efforts')
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
