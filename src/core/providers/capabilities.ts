import type { ImageLimits } from '../imageResize'
// What a model can do (M95, PLAN.md D74). Capabilities come from the
// provider's models list where it gives them, the vendored catalogue
// otherwise, and the user for a custom server. A custom server and the
// local servers start from Zed's conservative defaults (no parallel calls,
// no images, the window required). Pure.

/** What the harness needs to know about a model before using it. */
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

export interface ModelCapabilities {
  /** The model calls tools (false keeps it out of agent mode and badges). */
  readonly toolCalling: boolean
  /** The model takes image input. */
  readonly vision: boolean
  /** Unknown is off; resolved for this model, never inferred from its format. */
  readonly supportsStrictTools?: boolean | undefined
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
 * Whether two capability sets use the same wire for tools: both call tools
 * with the same parallelism. The codecs read the fuller preset quirks; this
 * answers the picker's grouping only.
 */
export function hasSameToolShape(a: ModelCapabilities, b: ModelCapabilities): boolean {
  return a.toolCalling === b.toolCalling && a.parallelToolCalls === b.parallelToolCalls
}
