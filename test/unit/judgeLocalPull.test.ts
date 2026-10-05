import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_JUDGE_RECOMMENDATIONS,
  pullLocalJudgeModel,
} from '../../src/core/judge/local/recommendations'

describe('M98 J2 explicit consented model download boundary', () => {
  it('publishes measured tev and qwen recommendations as data only', () => {
    expect(
      LOCAL_JUDGE_RECOMMENDATIONS.map((item) => [
        item.model,
        item.recommended,
        item.requiresCalibrationForAuto,
      ]),
    ).toEqual([
      ['tev1:4b', true, false],
      ['qwen3:4b-instruct-2507-q4_K_M', false, true],
      ['tev1:0.8b-q8_0', false, true],
    ])
  })
  it('shows exact model and size, then pulls once only after consent', async () => {
    const consent = vi.fn(() => Promise.resolve(true))
    const pull = vi.fn(() => Promise.resolve())
    const signal = new AbortController().signal
    expect(
      await pullLocalJudgeModel('tev1:4b', { explicitUserAction: true, consent, pull }, signal),
    ).toBe('pulled')
    expect(consent).toHaveBeenCalledExactlyOnceWith('tev1:4b', 4_482_415_847)
    expect(pull).toHaveBeenCalledExactlyOnceWith('tev1:4b', signal)
    expect(consent.mock.invocationCallOrder[0]).toBeLessThan(pull.mock.invocationCallOrder[0]!)
  })
  it.each(['automatic', 'unknown', 'declined', 'cancelled', 'changed-action'])(
    'never pulls for %s',
    async (fault) => {
      const controller = new AbortController()
      const action = {
        explicitUserAction: fault !== 'automatic',
        consent: vi.fn(() => {
          if (fault === 'cancelled') controller.abort()
          else if (fault === 'changed-action') action.explicitUserAction = false
          return Promise.resolve(fault !== 'declined')
        }),
        pull: vi.fn(() => Promise.resolve()),
      }
      const promise = pullLocalJudgeModel(
        fault === 'unknown' ? 'unmeasured:latest' : 'tev1:4b',
        action,
        controller.signal,
      )
      if (fault === 'declined') expect(await promise).toBe('consent-declined')
      else await expect(promise).rejects.toThrow()
      expect(action.pull).not.toHaveBeenCalled()
    },
  )
})
