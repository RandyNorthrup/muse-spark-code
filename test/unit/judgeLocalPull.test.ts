import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_JUDGE_RECOMMENDATIONS,
  pullLocalJudgeModel,
} from '../../src/core/judge/local/recommendations'
import linuxCapture from './fixtures/localJudgeLinuxCapture.json'
import { localSystemOneResult } from '../../src/core/judge/local/wire'
import { judgeRequestSchema } from '../../src/core/judge/schema'

describe('M98 J2 explicit consented model download boundary', () => {
  it('uses the captured small decision model size and wire without enabling auto', () => {
    const small = LOCAL_JUDGE_RECOMMENDATIONS.find(
      (item) => item.model === linuxCapture.request.model,
    )
    expect(small?.downloadBytes).toBe(
      linuxCapture.manifest.config.size +
        linuxCapture.manifest.layers.reduce((sum, layer) => sum + layer.size, 0),
    )
    expect(small?.recommended).toBe(false)
    expect(small?.requiresCalibrationForAuto).toBe(true)
    const result = localSystemOneResult(
      linuxCapture.response,
      judgeRequestSchema.parse(linuxCapture.request),
      linuxCapture.request.model,
    )
    expect(result.usage).toEqual(linuxCapture.response.usage)
    expect(result.muse['risk']?.label).toBe('uncalibrated')
  })
  it('publishes measured tev and qwen recommendations as data only', () => {
    expect(
      LOCAL_JUDGE_RECOMMENDATIONS.map((item) => [
        item.model,
        item.recommended,
        item.requiresCalibrationForAuto,
      ]),
    ).toEqual([
      ['tev1:4b', true, false],
      ['tev1:0.8b', false, true],
      ['qwen3:4b-instruct-2507-q4_K_M', false, true],
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
