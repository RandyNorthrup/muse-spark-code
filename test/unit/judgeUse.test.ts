import { describe, expect, it, vi } from 'vitest'
import { createJudgeUse } from '../../src/host/judge/judgeUse'
import { JudgeReplayRecorder } from '../../src/core/eval/judgeReplay'
import type { JudgeModeContext } from '../../src/core/judge/resolve'
import { startApprovalJudge } from '../../src/core/judge/use'
import { UI_TEXT } from '../../src/shared/constants'
import { JUDGE_ACTION, RISK_QUESTION, judgeUseRig } from './helpers/judgeUseRig'

describe('JudgeUse synchronous fences', () => {
  it('returns immediately while consent and the judge are pending, dropping late results', async () => {
    const consent = Promise.withResolvers<boolean>()
    const rig = judgeUseRig({ prepare: () => consent.promise })
    const fence = rig.judge.start(JUDGE_ACTION, 'state')
    expect(fence).toBeDefined()
    expect(rig.jobs).toEqual([])
    expect(fence?.read()).toBeUndefined()
    consent.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(rig.jobs).toEqual([])
    expect(rig.onFence).toHaveBeenCalledWith({ backend: 'modelApi', ready: false, caution: false })
  })

  it.each(['caution', 'none', 'failed'] as const)(
    'reads %s once without exposing a reviewer answer',
    async (outcome) => {
      const rig = judgeUseRig({ outcome })
      const fence = rig.judge.start(JUDGE_ACTION, 'state')
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      expect(fence?.read()).toBe(outcome === 'failed' ? undefined : outcome)
      expect(fence?.read()).toBeUndefined()
      expect(rig.settle('caution')).toBe(false)
    },
  )

  it('adds a note to a card without waiting and stops after the answer', async () => {
    const rig = judgeUseRig()
    const note = vi.fn()
    const fence = rig.judge.start(JUDGE_ACTION, 'state')
    fence?.card(note)
    expect(note).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    expect(rig.settle('caution')).toBe(true)
    expect(note).toHaveBeenCalledTimes(1)
    fence?.discard()
    expect(rig.settle('caution')).toBe(false)
    expect(note).toHaveBeenCalledTimes(1)
  })

  it('attaches an already ready caution and leaves a safe card alone', async () => {
    for (const outcome of ['caution', 'none'] as const) {
      const rig = judgeUseRig({ outcome })
      const fence = rig.judge.start(JUDGE_ACTION, 'state')
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      const note = vi.fn()
      fence?.card(note)
      expect(note).toHaveBeenCalledTimes(outcome === 'caution' ? 1 : 0)
      fence?.discard()
    }
  })

  it.each(['turn', 'session', 'action'] as const)(
    'discards a replaced %s and rejects its restarted generation callbacks',
    async (kind) => {
      const rig = judgeUseRig()
      const fence = rig.judge.start(JUDGE_ACTION, 'state')
      const note = await rig.showCard(fence)
      if (kind === 'turn') rig.judge.discardTurn('s1', 't1')
      else if (kind === 'session') rig.judge.discardSession('s1')
      else fence?.discard()
      const next = rig.judge.start(JUDGE_ACTION, 'state')
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(2)
      })
      expect(rig.settle('caution', 0)).toBe(false)
      expect(note).not.toHaveBeenCalled()
      expect(next?.read()).toBeUndefined()
    },
  )

  it('keys parsed Muse Code arguments canonically and refuses malformed JSON', async () => {
    const rig = judgeUseRig()
    const action = { backend: 'museCode', sessionId: 's1', turnId: 't1', tool: 'bash' }
    const first = startApprovalJudge(
      rig.judge,
      action,
      '{"command":"npm test","cwd":"/ws"}',
      'state',
    )
    const next = startApprovalJudge(
      rig.judge,
      action,
      '{"cwd":"/ws","command":"npm test"}',
      'state',
    )
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    expect(rig.settle('caution')).toBe(true)
    expect(first?.read()).toBe('caution')
    expect(next?.read()).toBeUndefined()
    expect(startApprovalJudge(rig.judge, action, '{invalid', 'state')).toBeUndefined()
  })

  it('drops ready and late card cautions when the current policy is turned off', async () => {
    let isOn = true
    const rig = judgeUseRig({ on: () => isOn })
    const fence = rig.judge.start(JUDGE_ACTION, 'state')
    const note = await rig.showCard(fence)
    isOn = false
    rig.settle('caution')
    expect(note).not.toHaveBeenCalled()
    expect(fence?.read()).toBeUndefined()
    isOn = true
    const ready = rig.judge.start(JUDGE_ACTION, 'state')
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(2)
    })
    rig.settle('caution', 1)
    isOn = false
    ready?.card(note)
    expect(note).not.toHaveBeenCalled()
    expect(ready?.read()).toBeUndefined()
  })

  it('off creates no runner, question, consent or fence sample', () => {
    const rig = judgeUseRig({ on: () => false })
    expect(rig.judge.start(JUDGE_ACTION, 'state')).toBeUndefined()
    expect(rig.prepare).not.toHaveBeenCalled()
    expect(rig.createRunner).not.toHaveBeenCalled()
    expect(rig.onFence).not.toHaveBeenCalled()
  })

  it('does not dispatch after a held modal sees the mode turn off or consent denied', async () => {
    let isOn = true
    const consent = Promise.withResolvers<boolean>()
    const rig = judgeUseRig({ on: () => isOn, prepare: () => consent.promise })
    rig.judge.start(JUDGE_ACTION, 'state')
    isOn = false
    consent.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(rig.createRunner).not.toHaveBeenCalled()
    const denied = judgeUseRig({ prepare: () => Promise.resolve(false) })
    const fence = denied.judge.start(JUDGE_ACTION, 'state')
    await Promise.resolve()
    expect(fence?.read()).toBeUndefined()
    expect(denied.createRunner).not.toHaveBeenCalled()
  })
})

function hostContext(): Omit<JudgeModeContext, 'minReadyRate'> {
  return {
    engine: 'auto',
    paidConsent: 'not-required',
    readyRate: undefined,
    sourceAvailable: true,
    providerId: 'meta',
    modelId: 'muse-spark-1.3',
    confidential: false,
  }
}

function hostRig(backend: 'museCode' | 'modelApi') {
  let context = hostContext()
  const runner = { judge: vi.fn() }
  const createRunner = vi.fn(() => runner)
  const allowsPaidJudge = vi.fn(() => Promise.resolve(true))
  const onStatus = vi.fn()
  const notice = vi.fn()
  const judge = createJudgeUse({
    backend,
    context: () => context,
    createRunner,
    question: () => RISK_QUESTION,
    onError: vi.fn(),
    allowsPaidJudge,
    onStatus,
    notice,
  })
  return {
    judge,
    runner,
    createRunner,
    allowsPaidJudge,
    onStatus,
    notice,
    change: (next: Partial<typeof context>) => {
      context = { ...context, ...next }
    },
  }
}

describe('Judge source policy and first use', () => {
  it('subscription-only Muse Code never asks a price and says the limits and isolation residual once', async () => {
    const rig = hostRig('museCode')
    rig.judge.start({ ...JUDGE_ACTION, backend: 'museCode' }, 'state')
    await vi.waitFor(() => {
      expect(rig.runner.judge).toHaveBeenCalledTimes(1)
    })
    rig.judge.start({ ...JUDGE_ACTION, backend: 'museCode', turnId: 't2' }, 'state')
    await vi.waitFor(() => {
      expect(rig.runner.judge).toHaveBeenCalledTimes(2)
    })
    expect(rig.allowsPaidJudge).not.toHaveBeenCalled()
    expect(rig.notice).toHaveBeenCalledExactlyOnceWith(UI_TEXT.judgeSubscriptionNotice)
    expect(rig.onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'same', billing: 'subscription' }),
    )
  })

  it('accepts its own price-consent transition, but constructs a fresh bound runner after a model switch', async () => {
    const rig = hostRig('modelApi')
    rig.change({ paidConsent: 'unasked' })
    rig.allowsPaidJudge.mockImplementation(() => {
      rig.change({ paidConsent: 'granted' })
      return Promise.resolve(true)
    })
    rig.judge.start(JUDGE_ACTION, 'state')
    await vi.waitFor(() => {
      expect(rig.runner.judge).toHaveBeenCalledTimes(1)
    })
    rig.judge.discardSession('s1')
    rig.change({ modelId: 'muse-spark-1.1' })
    rig.judge.start({ ...JUDGE_ACTION, turnId: 't2' }, 'state')
    await vi.waitFor(() => {
      expect(rig.runner.judge).toHaveBeenCalledTimes(2)
    })
    expect(rig.createRunner).toHaveBeenCalledTimes(2)
    expect(rig.allowsPaidJudge).toHaveBeenLastCalledWith('muse-spark-1.1')
  })

  it('turns the auto default off below measured ready rate, with its reason; explicit same still works', async () => {
    const rig = hostRig('modelApi')
    rig.change({ readyRate: 0.2 })
    expect(rig.judge.start(JUDGE_ACTION, 'state')).toBeUndefined()
    expect(rig.createRunner).not.toHaveBeenCalled()
    expect(rig.allowsPaidJudge).not.toHaveBeenCalled()
    expect(rig.onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ready-rate-low', mode: 'off' }),
    )
    rig.change({ engine: 'same' })
    rig.judge.start(JUDGE_ACTION, 'state')
    await vi.waitFor(() => {
      expect(rig.runner.judge).toHaveBeenCalledTimes(1)
    })
  })

  it('does not dispatch after consent waits across a changed provider, model or confidential policy', async () => {
    for (const change of [{ providerId: 'other' }, { modelId: 'other' }, { confidential: true }]) {
      const rig = hostRig('modelApi')
      const consent = Promise.withResolvers<boolean>()
      rig.allowsPaidJudge.mockReturnValueOnce(consent.promise)
      rig.judge.start(JUDGE_ACTION, 'state')
      rig.change(change)
      consent.resolve(true)
      await Promise.resolve()
      await Promise.resolve()
      expect(rig.createRunner).not.toHaveBeenCalled()
    }
  })
})

describe('M75 independent Judge replay measurement', () => {
  it('records ready rate and caution precision per backend without treating approvals as labels', () => {
    const recorder = new JudgeReplayRecorder()
    recorder.record({ backend: 'modelApi', ready: true, caution: true }, true)
    recorder.record({ backend: 'modelApi', ready: true, caution: true }, false)
    recorder.record({ backend: 'modelApi', ready: false, caution: false }, true)
    recorder.record({ backend: 'museCode', ready: true, caution: false }, false)
    expect(recorder.measurements()).toEqual([
      { backend: 'modelApi', fences: 3, readyRate: 2 / 3, precision: 0.5, cautions: 2 },
      { backend: 'museCode', fences: 1, readyRate: 1, precision: undefined, cautions: 0 },
    ])
    expect(() => {
      recorder.record({ backend: 'modelApi', ready: false, caution: true }, true)
    }).toThrow()
  })
})
