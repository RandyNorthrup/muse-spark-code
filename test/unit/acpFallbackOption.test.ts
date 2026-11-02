// D261 (lane RLF-FALLBACK): the session's fallback-model config option.
// The real option builder and value resolver run here: the select lists
// off plus the session's models, current on the fallback or off; setting
// it names a listed model, clears on off, and refuses the rest.
import { describe, expect, it } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable'
import type { ModelSummary } from '../../src/core/agent/agentBackend'
import { ACP_CONFIG_IDS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  FALLBACK_MODEL_OFF,
  fallbackConfigOption,
  resolveFallbackConfigValue,
  type ResolvedFallbackConfig,
} from '../../src/acp/fallbackOption'

const MODELS: readonly ModelSummary[] = (
  [
    ['meta/sonnet-5.5', 'Sonnet 5.5', undefined],
    ['meta/zenith-1.0', 'Zenith 1.0', undefined],
    ['meta/echo-0.5', 'Echo 0.5', 'Echo cannot run tools.'],
  ] as const
).map(([modelId, displayLabel, agentLimit]): ModelSummary => {
  const optional = agentLimit === undefined ? {} : { agentLimit }
  return {
    modelId,
    displayLabel,
    contextLimit: undefined,
    isDefault: false,
    isActive: false,
    ...optional,
  }
})

function selectOf(option: SessionConfigOption): Extract<SessionConfigOption, { type: 'select' }> {
  if (option.type !== 'select') throw new Error(`fallback option is not a select: ${option.type}`)
  return option
}

describe('fallback config option (D261)', () => {
  it('lists off plus the session models, current on off without a fallback', () => {
    const option = selectOf(fallbackConfigOption(MODELS, undefined))
    expect(option.id).toBe(ACP_CONFIG_IDS.fallbackModel)
    expect(option.name).toBe(EN.fallbackModelName)
    expect(option.currentValue).toBe(FALLBACK_MODEL_OFF)
    expect(option.options[0]).toEqual({ value: FALLBACK_MODEL_OFF, name: EN.toggleOff })
    expect(option.options.slice(1)).toEqual([
      { value: 'meta/sonnet-5.5', name: 'Sonnet 5.5' },
      { value: 'meta/zenith-1.0', name: 'Zenith 1.0' },
      { value: 'meta/echo-0.5', name: 'Echo 0.5', description: 'Echo cannot run tools.' },
    ])
  })

  it('reads current on the session fallback', () => {
    const option = selectOf(fallbackConfigOption(MODELS, 'meta/zenith-1.0'))
    expect(option.currentValue).toBe('meta/zenith-1.0')
  })

  it('names a listed model', () => {
    const resolved: ResolvedFallbackConfig = resolveFallbackConfigValue('meta/zenith-1.0', MODELS)
    expect(resolved).toEqual({ ok: true, modelId: 'meta/zenith-1.0' })
  })

  it('clears on off', () => {
    const resolved: ResolvedFallbackConfig = resolveFallbackConfigValue(FALLBACK_MODEL_OFF, MODELS)
    expect(resolved).toEqual({ ok: true, modelId: undefined })
  })

  it('refuses an unknown id', () => {
    const resolved: ResolvedFallbackConfig = resolveFallbackConfigValue(
      'meta/no-such-model',
      MODELS,
    )
    expect(resolved).toEqual({ ok: false, unknown: true })
  })

  it('refuses a model whose limit says it cannot run the agent', () => {
    const resolved: ResolvedFallbackConfig = resolveFallbackConfigValue('meta/echo-0.5', MODELS)
    expect(resolved).toEqual({ ok: false, unknown: false, limit: 'Echo cannot run tools.' })
  })
})
