// What a model can do (M95, PLAN.md D74). Capabilities come from the
// provider's models list where it gives them, the vendored catalogue
// otherwise, and the user for a custom server. A custom server and the
// local servers start from Zed's conservative defaults (no parallel calls,
// no images, the window required). Pure.

import { JUDGE_MAX_STATE_TOKENS } from '../../shared/constants'
import type { ImageLimits } from '../imageResize'
import {
  resolveModelCapabilities,
  type Known,
  type ModelCapabilityRecord,
} from './capabilityRecord'
export {
  resolveModelCapabilities,
  metaCapabilityRecord,
  capabilityEffortLevels,
  capabilityOverridesSchema,
} from './capabilityRecord'
export type {
  Known,
  CapabilitySource,
  ModelCapabilityRecord,
  CapabilityOverrides,
  CapabilityEvidence,
} from './capabilityRecord'

/** What the harness needs to know about a model before using it. */
export interface ModelCapabilities {
  /** The model calls tools (false keeps it out of agent mode and badges). */
  readonly toolCalling: boolean
  /** The model takes image input. */
  readonly vision: boolean
  /** Unknown is off; resolved for this model, never inferred from its format. */
  readonly supportsStrictTools?: boolean | undefined
  /**
  Which `tool_choice` values the model takes; unknown (absent) means auto
  only. Read from the model's capability record, never inferred.
  */
  readonly toolChoiceModes?: readonly ('auto' | 'none')[] | undefined
  /** Documented pixel limits only; absence preserves today's image bytes. */
  readonly imageLimits?: ImageLimits | undefined
  /** The model reasons (its reasoning replays only to the same provider). */
  readonly reasoning: boolean
  /** The request may send several tool calls at once. */
  readonly parallelToolCalls: boolean
}

/** Zed's conservative defaults for an unknown model (research §2.5). */
export const CONSERVATIVE_CAPABILITIES: ModelCapabilities = {
  toolCalling: false,
  vision: false,
  reasoning: false,
  parallelToolCalls: false,
}

/** A model row the capabilities helpers read (a scan row or catalogue entry). */
export interface CapabilitiesRow {
  readonly capabilities?: Partial<ModelCapabilities> | undefined
  readonly capabilityRecord?: ModelCapabilityRecord | undefined
}

/** The row's capabilities with every gap filled from the conservative defaults. */
export function capabilitiesOf(row: CapabilitiesRow): ModelCapabilities {
  const source = { kind: 'preset' as const, ref: 'legacy-four-boolean' }
  const flag = (isSupported: boolean | undefined): Known<true> => {
    if (isSupported === undefined) return { state: 'unknown' }
    return isSupported ? { state: 'yes', value: true, source } : { state: 'no', source }
  }
  const vision = row.capabilities?.vision
  let image: Known<{ mimes: string[] }> = { state: 'unknown' }
  if (vision !== undefined)
    image = vision ? { state: 'yes', value: { mimes: [] }, source } : { state: 'no', source }
  const record =
    row.capabilityRecord ??
    resolveModelCapabilities({ provider: 'legacy', nativeModel: '', format: 'chat' }, [
      {
        source,
        fields: {
          tools: {
            calling: flag(row.capabilities?.toolCalling),
            parallel: flag(row.capabilities?.parallelToolCalls),
          },
          reasoning: { supported: flag(row.capabilities?.reasoning) },
          modalities: {
            image,
          },
        },
      },
    ])
  return {
    toolCalling: record.tools.calling.state === 'yes',
    ...(record.tools.choiceModes.state === 'yes' && {
      toolChoiceModes: record.tools.choiceModes.value.filter(
        (mode): mode is 'auto' | 'none' => mode === 'auto' || mode === 'none',
      ),
    }),
    vision: record.modalities.image.state === 'yes',
    reasoning:
      record.reasoning.supported.state === 'unknown'
        ? record.reasoning.modes.state === 'yes' &&
          record.reasoning.modes.value.some((mode) => mode !== 'off')
        : record.reasoning.supported.state === 'yes',
    parallelToolCalls: record.tools.parallel.state === 'yes',
  }
}

/** Whether the model may answer in agent mode (it must call tools). */
export function isAgentCapable(capabilities: ModelCapabilities): boolean {
  return capabilities.toolCalling
}

/**
Whether two capability sets use the same wire for tools: both call tools
with the same parallelism. The codecs read the fuller preset quirks; this
answers the picker's grouping only.
*/
export function hasSameToolShape(a: ModelCapabilities, b: ModelCapabilities): boolean {
  return a.toolCalling === b.toolCalling && a.parallelToolCalls === b.parallelToolCalls
}

// --- SystemOne model capabilities (M98 phase 2 lane C) ---
//
// Bounds and price are the captured Jev facts (PLAN.md D50; docs.typesafe.ai/models,
// read 2026-10-06; OpenRouter's 2026-10-04 calls in m98-research.md): $0.042 per
// million input tokens, output free, 32k tokens for the state plus the longest
// question, and twice that for the whole request. The served ids are the ones
// those records name. A row is not a permission to auto-select, and it is not a
// Clef parser: Clef has no row.

const SYSTEMONE_JEV_TERMS = {
  tested: false,
  optIn: true,
  autoSelectable: false,
  inputUsdPerMillion: 0.042,
  outputUsdPerMillion: 0,
  statePlusLongestQuestionTokens: JUDGE_MAX_STATE_TOKENS,
  requestTokens: JUDGE_MAX_STATE_TOKENS * 2,
} as const

export interface SystemOneModelCapability {
  readonly presetId: string
  readonly requestModel: string
  /** Response `model` values this request id may report. Anything else is misaligned. */
  readonly responseModels: readonly string[]
  readonly captureId: string
  readonly tested: false
  readonly optIn: true
  readonly autoSelectable: false
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
  readonly statePlusLongestQuestionTokens: number
  readonly requestTokens: number
}

export const SYSTEMONE_CAPABILITIES: readonly SystemOneModelCapability[] = [
  Object.freeze({
    presetId: 'openrouter-jev',
    requestModel: 'typesafe/jev-1.13',
    responseModels: Object.freeze(['typesafe/jev-1.13', 'typesafe/jev-1.13-20260917']),
    captureId: 'docs/certification/m98-research.md#openrouter-systemone',
    ...SYSTEMONE_JEV_TERMS,
  }),
  Object.freeze({
    presetId: 'openrouter-jev',
    requestModel: '~typesafe/jev-latest',
    responseModels: Object.freeze(['~typesafe/jev-latest', 'typesafe/jev-1.13-20260917']),
    captureId: 'docs/certification/m98-research.md#openrouter-systemone',
    ...SYSTEMONE_JEV_TERMS,
  }),
  Object.freeze({
    presetId: 'typesafe-jev',
    requestModel: 'jev-1.13.0',
    responseModels: Object.freeze(['jev-1.13.0']),
    captureId: 'https://docs.typesafe.ai/models',
    ...SYSTEMONE_JEV_TERMS,
  }),
  Object.freeze({
    presetId: 'typesafe-jev',
    requestModel: 'jev-latest',
    responseModels: Object.freeze(['jev-latest', 'jev-1.13.0']),
    captureId: 'https://docs.typesafe.ai/models',
    ...SYSTEMONE_JEV_TERMS,
  }),
]

/** The capability of one request model on one SystemOne route, or undefined. */
export function systemOneCapability(
  presetId: string,
  requestModel: string,
): SystemOneModelCapability | undefined {
  return SYSTEMONE_CAPABILITIES.find(
    (row) => row.presetId === presetId && row.requestModel === requestModel,
  )
}
