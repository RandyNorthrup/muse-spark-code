// Normalized facts from the committed M95 captures, not model-name heuristics.
import {
  resolveModelCapabilities,
  type ModelCapabilityRecord,
  type CapabilityOverrides,
} from './capabilityRecord'

/** Fallback for direct codec callers until lane I supplies the configured record. */
export function capturedCapabilities(
  format: 'anthropic' | 'gemini',
  nativeModel: string,
): ModelCapabilityRecord {
  const source = {
    kind: 'capture' as const,
    ref: `docs/certification/m95-captures/${format}/01-models-list${format === 'anthropic' ? '-x-api-key' : ''}.json`,
  }
  const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })
  let fields: CapabilityOverrides = {}
  if (format === 'anthropic') {
    if (nativeModel === 'claude-haiku-4-5-20251001')
      fields = { reasoning: { modes: yes(['manual']), effortLevels: { state: 'no', source } } }
    else if (nativeModel === 'claude-sonnet-5-5' || nativeModel === 'claude-opus-5-5')
      fields = {
        reasoning: {
          modes: yes(['adaptive']),
          effortLevels: yes(['low', 'medium', 'high', 'xhigh', 'max']),
        },
      }
  } else if (['gemini-2.5-flash', 'gemini-2.5-pro'].includes(nativeModel)) {
    fields = { reasoning: { modes: yes(['budget']) } }
  } else if (nativeModel === 'gemini-3.5-flash-lite') {
    // The served 3.5 request is capture 02, rather than the trimmed list sample.
    source.ref = 'docs/certification/m95-captures/gemini/02-tool-call-stream.json'
    fields = { reasoning: { modes: yes(['level']) } }
  }
  const evidence = [{ source, fields }]
  if (format === 'anthropic' && fields.reasoning !== undefined) {
    return resolveModelCapabilities({ provider: format, nativeModel, format }, [
      {
        source: { kind: 'preset', ref: 'docs/certification/m95-research.md' },
        fields: {
          reasoning: {
            replay: {
              envelope: 'anthropic-signed',
              prefixEditPolicy: nativeModel === 'claude-haiku-4-5-20251001' ? 'refuse' : 'drop',
            },
          },
        },
      },
      ...evidence,
    ])
  }
  return resolveModelCapabilities({ provider: format, nativeModel, format }, evidence)
}
