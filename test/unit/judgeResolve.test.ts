import { wiringFixture } from './helpers/judgeWiring'
import { describe, expect, it } from 'vitest'
import {
  resolveJudgeMode,
  resolveJudgeMode2a,
  shouldReResolve,
  type JudgeEngineSetting,
  type JudgeModeContext,
  type JudgeSeparateReadiness,
} from '../../src/core/judge/resolve'

function context(overrides: Partial<JudgeModeContext> = {}): JudgeModeContext {
  return {
    engine: 'auto',
    paidConsent: 'not-required',
    readyRate: undefined,
    minReadyRate: 0.5,
    sourceAvailable: true,
    providerId: 'fixture-provider',
    modelId: 'chosen',
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

  it('leaves the phase-1 entry on separate/both engines: no other source yet', () => {
    expect(resolveJudgeMode(context({ engine: 'separate' }))).toEqual({
      mode: 'off',
      reason: 'unknown-setting',
    })
    expect(resolveJudgeMode(context({ engine: 'both' }))).toEqual({
      mode: 'off',
      reason: 'unknown-setting',
    })
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
    expect(resolveJudgeMode(context({ engine: 'sometimes' }))).toEqual({
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

  it('honours explicit same below the automatic ready-rate floor', () => {
    const selected = context({ engine: 'same', paidConsent: 'granted', readyRate: 0.1 })
    expect(resolveJudgeMode(selected)).toEqual({ mode: 'same', reason: 'explicit-same' })
    expect(resolveJudgeMode({ ...selected, engine: 'auto' })).toEqual({
      mode: 'off',
      reason: 'ready-rate-low',
    })
    expect(resolveJudgeMode({ ...selected, paidConsent: 'declined' }).reason).toBe(
      'consent-declined',
    )
    expect(resolveJudgeMode({ ...selected, sourceAvailable: false }).reason).toBe(
      'source-unavailable',
    )
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
    providerId: 'fixture-provider',
    modelId: 'chosen',
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

  it('invalidates a cached selection on source, endpoint, profile, owner, mode or turn changes', () => {
    expect(shouldReResolve(triggers, triggers)).toBe(false)
    expect(shouldReResolve(triggers, { ...triggers, engine: 'both' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, endpoint: 'https://other.invalid/v1' })).toBe(
      true,
    )
    expect(shouldReResolve(triggers, { ...triggers, profileId: 'fit-2' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, ownerId: 'owner-2' })).toBe(true)
    expect(shouldReResolve(triggers, { ...triggers, turn: 'turn-2' })).toBe(true)
    expect(shouldReResolve({ ...triggers, turn: 3 }, { ...triggers, turn: 4 })).toBe(true)
  })

  it('keeps the cached resolution without a trigger: a fresh ready rate is no trust proof either way', () => {
    expect(shouldReResolve(triggers, { ...triggers })).toBe(false)
    expect(
      shouldReResolve(
        { ...triggers, endpoint: undefined, profileId: undefined },
        { ...triggers, endpoint: undefined, profileId: undefined },
      ),
    ).toBe(false)
  })
})

const ready: JudgeSeparateReadiness = { available: true, verified: true, profilesReady: true }

function context2a(overrides: Partial<JudgeModeContext> = {}): JudgeModeContext {
  return {
    engine: 'auto',
    paidConsent: 'not-required',
    readyRate: undefined,
    minReadyRate: 0.5,
    sourceAvailable: true,
    separate: { ...ready, adoption: wiringFixture().adoption },
    providerId: 'fixture-provider',
    modelId: 'chosen',
    confidential: false,
    ...overrides,
  }
}

describe('resolveJudgeMode2a', () => {
  it('covers the auto|same|separate|both|off matrix with a ready separate source', () => {
    expect(resolveJudgeMode2a(context2a({ engine: 'auto' }))).toEqual({
      mode: 'both',
      reason: 'auto-both',
    })
    expect(resolveJudgeMode2a(context2a({ engine: 'same' }))).toEqual({
      mode: 'same',
      reason: 'explicit-same',
    })
    expect(resolveJudgeMode2a(context2a({ engine: 'separate' }))).toEqual({
      mode: 'separate',
      reason: 'explicit-separate',
    })
    expect(resolveJudgeMode2a(context2a({ engine: 'both' }))).toEqual({
      mode: 'both',
      reason: 'explicit-both',
    })
    expect(resolveJudgeMode2a(context2a({ engine: 'off' }))).toEqual({
      mode: 'off',
      reason: 'explicit-off',
    })
  })

  it('keeps auto on phase-1 same without a separate source, profiles or verification', () => {
    expect(resolveJudgeMode2a(context2a({ separate: undefined }))).toEqual({
      mode: 'same',
      reason: 'auto-same',
    })
    expect(resolveJudgeMode2a(context2a({ separate: { ...ready, profilesReady: false } }))).toEqual(
      { mode: 'same', reason: 'auto-same', autoSameReason: 'profile-missing' },
    )
    expect(resolveJudgeMode2a(context2a({ separate: { ...ready, verified: false } }))).toEqual({
      mode: 'same',
      reason: 'auto-same',
      autoSameReason: 'source-untested',
    })
    expect(resolveJudgeMode2a(context2a({ separate: { ...ready, available: false } }))).toEqual({
      mode: 'same',
      reason: 'auto-same',
      autoSameReason: 'source-unavailable',
    })
  })

  it('fails explicit separate and both closed with the separate source reason', () => {
    expect(resolveJudgeMode2a(context2a({ engine: 'separate', separate: undefined }))).toEqual({
      mode: 'off',
      reason: 'source-unavailable',
    })
    expect(
      resolveJudgeMode2a(context2a({ engine: 'both', separate: { ...ready, available: false } })),
    ).toEqual({ mode: 'off', reason: 'source-unavailable' })
    expect(
      resolveJudgeMode2a(
        context2a({ engine: 'separate', separate: { ...ready, verified: false } }),
      ),
    ).toEqual({ mode: 'off', reason: 'source-untested' })
    expect(
      resolveJudgeMode2a(
        context2a({ engine: 'both', separate: { ...ready, profilesReady: false } }),
      ),
    ).toEqual({ mode: 'off', reason: 'profile-missing' })
    expect(resolveJudgeMode2a(context2a({ engine: 'both', sourceAvailable: false }))).toEqual({
      mode: 'off',
      reason: 'source-unavailable',
    })
  })

  it('fails a malformed readiness closed, never into an assumed source', () => {
    const malformedSeparate = JSON.parse('{"available":1,"verified":"yes","profilesReady":null}')
    expect(
      resolveJudgeMode2a({ ...context2a({ engine: 'separate' }), separate: malformedSeparate }),
    ).toEqual({ mode: 'off', reason: 'source-unavailable' })
    expect(
      resolveJudgeMode2a({ ...context2a({ engine: 'auto' }), separate: malformedSeparate }),
    ).toEqual({ mode: 'same', reason: 'auto-same', autoSameReason: 'source-unavailable' })
  })

  it('requires explicit boolean verification and profile readiness, not truthy values', () => {
    const unverified = JSON.parse('{"available":true,"verified":"false","profilesReady":true}')
    expect(resolveJudgeMode2a({ ...context2a({ engine: 'auto' }), separate: unverified })).toEqual({
      mode: 'same',
      reason: 'auto-same',
      autoSameReason: 'source-untested',
    })
    const unready = JSON.parse('{"available":true,"verified":true,"profilesReady":"false"}')
    expect(resolveJudgeMode2a({ ...context2a({ engine: 'both' }), separate: unready })).toEqual({
      mode: 'off',
      reason: 'profile-missing',
    })
  })

  it('lets explicit modes bypass the automatic ready-rate floor, and nothing else', () => {
    const low = { readyRate: 0.1, minReadyRate: 0.5 }
    expect(resolveJudgeMode2a(context2a({ engine: 'separate', ...low })).mode).toBe('separate')
    expect(resolveJudgeMode2a(context2a({ engine: 'both', ...low })).mode).toBe('both')
    expect(resolveJudgeMode2a(context2a({ engine: 'same', ...low })).mode).toBe('same')
    expect(resolveJudgeMode2a(context2a({ engine: 'auto', ...low }))).toEqual({
      mode: 'off',
      reason: 'ready-rate-low',
    })
    expect(
      resolveJudgeMode2a(context2a({ engine: 'both', ...low, paidConsent: 'declined' })).reason,
    ).toBe('consent-declined')
    expect(
      resolveJudgeMode2a(context2a({ engine: 'separate', ...low, paidConsent: 'unasked' })).reason,
    ).toBe('consent-needed')
  })

  it('fails closed on unknown engines exactly like the phase-1 entry', () => {
    for (const engine of ['sometimes', undefined, 42]) {
      expect(resolveJudgeMode2a(context2a({ engine }))).toEqual({
        mode: 'off',
        reason: 'unknown-setting',
      })
    }
  })

  it('matches the phase-1 entry wherever no separate source is configured', () => {
    const engines = ['auto', 'same', 'off', 'sometimes', undefined]
    for (const engine of engines) {
      expect(resolveJudgeMode2a(context2a({ engine, separate: undefined }))).toEqual(
        resolveJudgeMode(context2a({ engine, separate: undefined })),
      )
    }
  })

  it('names no conversation model: the same model stays the conversation model', () => {
    for (const engine of ['auto', 'same', 'separate', 'both', 'off']) {
      expect(Object.keys(resolveJudgeMode2a(context2a({ engine })))).toEqual(['mode', 'reason'])
    }
  })
})
