import { describe, expect, it } from 'vitest'
import {
  resolveJudgeMode,
  shouldReResolve,
  type JudgeEngineSetting,
  type JudgeModeContext,
} from '../../src/core/judge/resolve'

function context(overrides: Partial<JudgeModeContext> = {}): JudgeModeContext {
  return {
    engine: 'auto',
    paidConsent: 'not-required',
    readyRate: undefined,
    minReadyRate: 0.5,
    sourceAvailable: true,
    providerId: 'meta',
    modelId: 'muse-spark',
    confidential: false,
    ...overrides,
  }
}

describe('resolveJudgeMode', () => {
  it('resolves auto to same in phase 1', () => {
    expect(resolveJudgeMode(context({ engine: 'auto' }))).toEqual({
      mode: 'same',
      reason: 'auto-same',
    })
  })

  it('resolves every schema-valid setting to a known reason', () => {
    const engines: JudgeEngineSetting[] = ['auto', 'same', 'off']
    const reasons = engines.map((engine) => resolveJudgeMode(context({ engine })).reason)
    expect(reasons).toEqual(['auto-same', 'explicit-same', 'explicit-off'])
  })

  it('honours explicit same and off', () => {
    expect(resolveJudgeMode(context({ engine: 'same' }))).toEqual({
      mode: 'same',
      reason: 'explicit-same',
    })
    expect(resolveJudgeMode(context({ engine: 'off' }))).toEqual({
      mode: 'off',
      reason: 'explicit-off',
    })
  })

  it('fails closed on an unknown setting value', () => {
    expect(resolveJudgeMode(context({ engine: 'both' }))).toEqual({
      mode: 'off',
      reason: 'unknown-setting',
    })
    expect(resolveJudgeMode(context({ engine: undefined }))).toEqual({
      mode: 'off',
      reason: 'unknown-setting',
    })
  })

  it('waits for the once-only paid consent on a paid source', () => {
    expect(resolveJudgeMode(context({ paidConsent: 'unasked' }))).toEqual({
      mode: 'off',
      reason: 'consent-needed',
    })
    expect(resolveJudgeMode(context({ paidConsent: 'declined' }))).toEqual({
      mode: 'off',
      reason: 'consent-declined',
    })
    expect(resolveJudgeMode(context({ paidConsent: 'granted' })).mode).toBe('same')
  })

  it('turns off where the source is unavailable', () => {
    expect(resolveJudgeMode(context({ sourceAvailable: false }))).toEqual({
      mode: 'off',
      reason: 'source-unavailable',
    })
  })

  it('turns off under a measured ready rate below the floor, with its reason', () => {
    expect(resolveJudgeMode(context({ readyRate: 0.2, minReadyRate: 0.5 }))).toEqual({
      mode: 'off',
      reason: 'ready-rate-low',
    })
    expect(resolveJudgeMode(context({ readyRate: 0.5, minReadyRate: 0.5 })).mode).toBe('same')
  })

  it('stays on while unmeasured: enhancements are on by default', () => {
    expect(resolveJudgeMode(context({ readyRate: undefined })).mode).toBe('same')
  })

  it('checks consent before availability before the ready rate', () => {
    expect(
      resolveJudgeMode(context({ paidConsent: 'declined', sourceAvailable: false })).reason,
    ).toBe('consent-declined')
    expect(
      resolveJudgeMode(context({ paidConsent: 'granted', sourceAvailable: false, readyRate: 0 }))
        .reason,
    ).toBe('source-unavailable')
  })
})

describe('shouldReResolve', () => {
  const triggers = {
    engine: 'auto' as const,
    providerId: 'meta',
    modelId: 'muse-spark',
    paidConsent: 'granted' as const,
    confidential: false,
  }

  it('re-resolves on a change of setting, provider, consent or confidential flag', () => {
    expect(shouldReResolve(triggers, triggers)).toBe(false)
    expect(shouldReResolve(triggers, { ...triggers, engine: 'off' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, providerId: 'openrouter' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, modelId: 'other' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, paidConsent: 'declined' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, confidential: true })).toBe(true)
  })
})
