// M95 N: one evidence-bearing capability record. Scalars retain provenance
// in `sources`; Known fields also carry it next to their value.
import * as z from 'zod/mini'
import {
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  MAX_DOCUMENT_BYTES,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_PDF_PAGE_IMAGES,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_MAX_OUTPUT_TOKENS,
  PROMPT_CACHE_RETENTIONS,
} from '../../shared/constants'
import { effortLevelsFor } from '../../shared/effort'

const sourceSchema = z.strictObject({
  kind: z.enum(['capture', 'models-list', 'catalogue', 'preset', 'user']),
  ref: z.optional(z.string()),
  at: z.optional(z.union([z.iso.date(), z.iso.datetime()])),
})
export type CapabilitySource = Readonly<z.infer<typeof sourceSchema>>
export type Known<T> =
  | { readonly state: 'yes'; readonly value: T; readonly source: CapabilitySource }
  | { readonly state: 'no'; readonly source: CapabilitySource }
  | { readonly state: 'unknown' }

function known<T extends z.ZodMiniType>(value: T) {
  // providers.json need not repeat provenance; the resolver stamps the
  // actual evidence source, so a supplied source can never elevate priority.
  const source = z._default(sourceSchema, { kind: 'user' })
  return z.union([
    z.strictObject({ state: z.literal('yes'), value, source }),
    z.strictObject({ state: z.literal('no'), source }),
    z.strictObject({ state: z.literal('unknown') }),
  ])
}
const count = z.int().check(z.positive())
const flag = known(z.literal(true))
const strings = z.array(z.string())
const toolsSchema = z.strictObject({
  calling: flag,
  parallel: flag,
  choiceModes: known(z.array(z.enum(['auto', 'none', 'required', 'named']))),
  streamingArguments: flag,
  historyRequiresTools: z.boolean(),
})
const replaySchema = z.strictObject({
  envelope: z.enum([
    'responses-encrypted',
    'anthropic-signed',
    'gemini-signature',
    'openrouter-details',
    'chat-reasoning',
    'none',
  ]),
  prefixEditPolicy: z.enum(['keep', 'drop', 'refuse']),
})
const budgetSchema = z
  .object({ min: z.optional(z.int().check(z.nonnegative())), max: z.optional(count) })
  .check(
    z.refine(
      (budget) => budget.min === undefined || budget.max === undefined || budget.min <= budget.max,
    ),
  )
const reasoningSchema = z.strictObject({
  supported: flag,
  modes: known(z.array(z.enum(['off', 'manual', 'adaptive', 'level', 'budget']))),
  effortLevels: known(strings),
  canDisable: flag,
  forced: flag,
  budget: z.optional(budgetSchema),
  summary: flag,
  replay: replaySchema,
})
const cacheSchema = z.strictObject({
  mode: z.enum(['none', 'implicit', 'breakpoints', 'explicit']),
  acceptsKey: z.boolean(),
  retention: strings,
  ttls: z.array(z.enum(['5m', '1h'])),
  minPrefixTokens: z.optional(count),
  maxBreakpoints: z.optional(count),
})
const outputSchema = z.strictObject({
  formats: known(
    z.array(z.enum(['text', 'json_object', 'json_schema', 'strict_schema', 'forced_tool'])),
  ),
  maxTokens: z.optional(count),
  minTokens: z.optional(count),
  acceptsLimit: flag,
})
const limitsSchema = z.strictObject({
  contextTokens: z.optional(count),
  loadedContextTokens: z.optional(count),
  inputTokens: z.optional(count),
})
const modalitiesSchema = z.strictObject({
  image: known(
    z.strictObject({ mimes: strings, maxBytes: z.optional(count), maxCount: z.optional(count) }),
  ),
  pdf: known(z.strictObject({ maxPages: z.optional(count), maxBytes: z.optional(count) })),
  audio: flag,
})
const logprobsSchema = known(
  z.strictObject({
    kind: z.enum(['top1', 'topk']),
    maxTopK: z.optional(count),
    dialect: z.string(),
    requiresEffortNone: z.optional(z.boolean()),
    minOutputTokens: z.optional(count),
  }),
)
const samplingSchema = z.strictObject({
  temperature: flag,
  topP: flag,
  nativeCandidates: known(count),
})
const hostedSchema = z.strictObject({ webSearch: known(z.strictObject({ tool: z.string() })) })
const completionSchema = known(z.strictObject({ mode: z.enum(['fim', 'chat-hole']) }))
const groups = {
  tools: toolsSchema,
  reasoning: reasoningSchema,
  cache: cacheSchema,
  output: outputSchema,
  limits: limitsSchema,
  modalities: modalitiesSchema,
  sampling: samplingSchema,
  hosted: hostedSchema,
}
const recordSchema = z.strictObject({
  identity: z.strictObject({
    provider: z.string(),
    nativeModel: z.string(),
    format: z.enum(['responses', 'chat', 'anthropic', 'gemini', 'ollama']),
    servedVersion: z.optional(z.string()),
  }),
  ...groups,
  logprobs: logprobsSchema,
  completion: completionSchema,
  sources: z.record(z.string(), sourceSchema),
})
export type ModelCapabilityRecord = Readonly<z.infer<typeof recordSchema>>
/** Any policy family may be overridden; identity's route remains registry-owned. */
export const capabilityOverridesSchema = z.strictObject({
  servedVersion: z.optional(z.string()),
  tools: z.optional(z.partial(toolsSchema)),
  reasoning: z.optional(
    z.extend(z.partial(reasoningSchema), { replay: z.optional(z.partial(replaySchema)) }),
  ),
  cache: z.optional(z.partial(cacheSchema)),
  output: z.optional(z.partial(outputSchema)),
  limits: z.optional(z.partial(limitsSchema)),
  modalities: z.optional(z.partial(modalitiesSchema)),
  sampling: z.optional(z.partial(samplingSchema)),
  hosted: z.optional(z.partial(hostedSchema)),
  logprobs: z.optional(logprobsSchema),
  completion: z.optional(completionSchema),
})
export type CapabilityOverrides = z.input<typeof capabilityOverridesSchema>
/** User-file parsing stamps provenance before the patch is stored. */
export function userCapabilityOverrides(
  fields: z.infer<typeof capabilityOverridesSchema>,
): z.infer<typeof capabilityOverridesSchema> {
  const parsed = capabilityOverridesSchema.parse(fields)
  const target: Record<string, unknown> = {}
  overlay(target, parsed, { kind: 'user' }, {})
  return capabilityOverridesSchema.parse(target)
}
export interface CapabilityEvidence {
  readonly source: CapabilitySource
  readonly fields: CapabilityOverrides
}
const PRIORITY: Readonly<Record<CapabilitySource['kind'], number>> = {
  preset: 0,
  catalogue: 1,
  'models-list': 2,
  capture: 3,
  user: 4,
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Merge known leaves atomically; unknown supplies no evidence and cannot erase a fact. */
function overlay(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  source: CapabilitySource,
  sources: Record<string, CapabilitySource>,
  prefix = '',
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const field = prefix === '' ? key : `${prefix}.${key}`
    if (isObject(value) && 'state' in value) {
      if (value['state'] === 'unknown') continue
      target[key] = { ...value, source }
      sources[field] = source
    } else if (isObject(value)) {
      const previous = target[key]
      const child = isObject(previous) ? previous : {}
      overlay(child, value, source, sources, field)
      target[key] = child
    } else {
      target[key] = value
      sources[field] = source
    }
  }
}
/** One resolver; evidence never inferred from names, prices or a text-only success. */
export function resolveModelCapabilities(
  identity: ModelCapabilityRecord['identity'],
  evidence: readonly CapabilityEvidence[] = [],
): ModelCapabilityRecord {
  const unknown = { state: 'unknown' }
  const sources: Record<string, CapabilitySource> = {}
  const result: Record<string, unknown> = {
    identity: { ...identity },
    sources,
    tools: {
      calling: unknown,
      parallel: unknown,
      choiceModes: unknown,
      streamingArguments: unknown,
      historyRequiresTools: false,
    },
    reasoning: {
      supported: unknown,
      modes: unknown,
      effortLevels: unknown,
      canDisable: unknown,
      forced: unknown,
      summary: unknown,
      replay: { envelope: 'none', prefixEditPolicy: 'refuse' },
    },
    cache: { mode: 'none', acceptsKey: false, retention: [], ttls: [] },
    output: { formats: unknown, acceptsLimit: unknown },
    limits: {},
    modalities: { image: unknown, pdf: unknown, audio: unknown },
    logprobs: unknown,
    sampling: { temperature: unknown, topP: unknown, nativeCandidates: unknown },
    completion: unknown,
    hosted: { webSearch: unknown },
  }
  const ordered = evidence.toSorted((a, b) => PRIORITY[a.source.kind] - PRIORITY[b.source.kind])
  for (const item of ordered) {
    const { servedVersion, ...patch } = capabilityOverridesSchema.parse(item.fields)
    const modes = patch.reasoning?.modes
    if (
      modes !== undefined &&
      patch.reasoning !== undefined &&
      patch.reasoning.supported === undefined &&
      modes.state !== 'unknown'
    ) {
      patch.reasoning.supported =
        modes.state === 'yes' && modes.value.some((mode) => mode !== 'off')
          ? { state: 'yes', value: true, source: item.source }
          : { state: 'no', source: item.source }
    }
    overlay(result, patch, sourceSchema.parse(item.source), sources)
    if (servedVersion === undefined) continue
    result['identity'] = { ...identity, servedVersion }
    sources['identity.servedVersion'] = item.source
  }
  const record = recordSchema.parse(result)
  if (
    record.output.minTokens !== undefined &&
    record.output.maxTokens !== undefined &&
    record.output.minTokens > record.output.maxTokens
  )
    throw new Error('capability_record:invalid_output_bounds')
  return record
}
/** Meta policy is built only from today's constants; callers keep their exact wire. */
export function metaCapabilityRecord(nativeModel: string): ModelCapabilityRecord {
  const source: CapabilitySource = { kind: 'preset', ref: 'meta' }
  const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })
  return resolveModelCapabilities({ provider: 'meta', nativeModel, format: 'responses' }, [
    {
      source,
      fields: {
        tools: {
          calling: yes(true),
          parallel: yes(true),
          choiceModes: yes(['auto', 'none', 'required', 'named']),
          streamingArguments: yes(true),
        },
        reasoning: {
          modes: yes(['level']),
          effortLevels: yes([...effortLevelsFor(nativeModel)]),
          replay: { envelope: 'responses-encrypted', prefixEditPolicy: 'keep' },
        },
        limits: { contextTokens: MODEL_API_CONTEXT_WINDOW },
        output: {
          maxTokens: MODEL_API_MAX_OUTPUT_TOKENS,
          acceptsLimit: yes(true),
          formats: yes(['text']),
        },
        modalities: {
          image: yes({
            mimes: [...IMAGE_MEDIA_TYPES],
            maxBytes: MAX_IMAGE_BYTES,
            maxCount: MODEL_API_MEDIA_PER_REQUEST,
          }),
          pdf: yes({ maxPages: MODEL_API_PDF_PAGE_IMAGES, maxBytes: MAX_DOCUMENT_BYTES }),
        },
        cache: { mode: 'implicit', acceptsKey: true, retention: [...PROMPT_CACHE_RETENTIONS] },
      },
    },
  ])
}
/** Native effort names for the picker, without manufacturing Meta tiers. */
export function capabilityEffortLevels(record: ModelCapabilityRecord): readonly string[] {
  return record.reasoning.effortLevels.state === 'yes' ? record.reasoning.effortLevels.value : []
}
