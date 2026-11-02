// D261 (lane RLF-FALLBACK): the session's fallback-model config option.
//
// The ACP `fallbackModel` select names the model a refused turn continues
// on. Off by default: the empty value names no model, and the session
// offers the option on the Model API backend only (Muse Code's CLI keeps
// its own behaviour, external agents keep theirs).
import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable'
import type { ModelSummary } from '../core/agent/agentBackend'
import { ACP_CONFIG_IDS, UI_TEXT } from '../shared/constants'

/** The select's off value: no model named, a refused turn ends with the refusal. */
export const FALLBACK_MODEL_OFF = ''

/**
The option for the session's models, current on the session's fallback or
off. Model rows carry their agent limit where they state one, as the
model picker's do.
*/
export function fallbackConfigOption(
  models: readonly ModelSummary[],
  current: string | undefined,
): SessionConfigOption {
  return {
    id: ACP_CONFIG_IDS.fallbackModel,
    name: UI_TEXT.fallbackModelName,
    category: 'model',
    type: 'select',
    currentValue: current ?? FALLBACK_MODEL_OFF,
    options: [
      { value: FALLBACK_MODEL_OFF, name: UI_TEXT.toggleOff },
      ...models.map((model) => ({
        value: model.modelId,
        name: model.displayLabel,
        ...(model.agentLimit !== undefined && { description: model.agentLimit }),
      })),
    ],
  }
}

export type ResolvedFallbackConfig =
  | { readonly ok: true; readonly modelId: string | undefined }
  | { readonly ok: false; readonly unknown: true }
  | { readonly ok: false; readonly unknown: false; readonly limit: string }

/**
The value the editor set: off clears to no model, a listed model without
an agent limit names it, anything else refuses (an unknown id, or a model
whose limit says it cannot run the agent).
*/
export function resolveFallbackConfigValue(
  value: string,
  models: readonly ModelSummary[],
): ResolvedFallbackConfig {
  if (value === FALLBACK_MODEL_OFF) return { ok: true, modelId: undefined }
  const chosen = models.find((model) => model.modelId === value)
  if (chosen === undefined) return { ok: false, unknown: true }
  return chosen.agentLimit === undefined
    ? { ok: true, modelId: value }
    : { ok: false, unknown: false, limit: chosen.agentLimit }
}
