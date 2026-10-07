import { describe, expect, it, vi } from 'vitest'
import { createJudgeSourceRouter } from '../../src/core/judge/routing'
import { JUDGE_STATED_OUTPUT_TOKENS } from '../../src/shared/constants'
import type { ByoJudgeDeps } from '../../src/core/judge/providers/run'
import type { SystemOneJudgeDependencies } from '../../src/core/judge/systemone/source'
import { createJudgeSourcesFeatures } from '../../src/runtime/judge/judgeSourcesEntry'
import { EN } from '../../src/shared/l10n/en'

const capture = vi.hoisted(() => ({
  generations: [] as (() => number)[],
  ceilings: [] as number[],
  configurations: [] as SystemOneJudgeDependencies['configuration'][],
}))
vi.mock('../../src/core/judge/providers/run', () => ({
  createByoJudge: (deps: ByoJudgeDeps) => {
    capture.generations.push(deps.generation)
    capture.ceilings.push(deps.statedOutputTokens)
    return {
      run: () => Promise.resolve({ outcome: 'no-answer', reason: 'capability-unavailable' }),
    }
  },
}))
vi.mock('../../src/core/judge/systemone/source', () => ({
  createSystemOneJudge: (deps: SystemOneJudgeDependencies) => {
    capture.configurations.push(deps.configuration)
    return { judge: () => Promise.resolve({ outcome: 'no-answer', reason: 'source-untested' }) }
  },
}))

describe('explicit phase-2 source assembly', () => {
  it('publishes the router through the lazy production factory', () => {
    const features = createJudgeSourcesFeatures({ uiText: EN, uiLocale: 'en' })
    expect(features.createJudgeSourceRouter).toBe(createJudgeSourceRouter)
  })
  it('advances generation on every binding event including A to B to A and invalidation', () => {
    const router = createJudgeSourceRouter()
    // The mocked factory records assembly inputs only; no provider implementation uses this fixture.
    const deps = {} as Omit<ByoJudgeDeps, 'generation' | 'logprobWording' | 'statedOutputTokens'>
    router.select({ kind: 'byo', deps })
    const first = capture.generations.at(-1)
    if (first === undefined) throw new Error('missing generation')
    const before = first()
    router.select({ kind: 'byo', deps })
    router.select({ kind: 'byo', deps })
    expect(first()).toBe(before + 2)
    router.invalidate()
    expect(first()).toBe(before + 3)
    expect(capture.ceilings.at(-1)).toBe(JUDGE_STATED_OUTPUT_TOKENS)
  })
  it('withdraws the complete SystemOne binding on replacement', () => {
    const router = createJudgeSourceRouter()
    const deps = { readKey: vi.fn(), measureTokens: () => 1, reserve: vi.fn(), post: vi.fn() }
    const selection = {
      presetId: 'openrouter-jev',
      model: 'jev',
      enabled: true,
      selection: 'explicit' as const,
      confidential: false,
      consent: 'granted' as const,
    }
    router.select({ kind: 'systemone', selection, deps })
    const read = capture.configurations.at(-1)
    expect(read?.()?.generation).toBe(1)
    router.select({ kind: 'systemone', selection: { ...selection, consent: 'declined' }, deps })
    expect(read?.()).toBeUndefined()
    expect(deps.reserve).not.toHaveBeenCalled()
  })
  it('has an explicit unavailable outcome until selection and after revocation', async () => {
    const router = createJudgeSourceRouter()
    const request = { state: '', questions: {} }
    const signal = new AbortController().signal
    expect(await router.judge(request, signal)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    router.invalidate()
    expect(await router.judge(request, signal)).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
  })
})
