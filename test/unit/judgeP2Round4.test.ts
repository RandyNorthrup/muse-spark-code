import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { createLogger } from '../../src/host/logger'
import type { JudgeReviewInput } from '../../src/host/judge/uses'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  useAction,
  useOutput,
  usePolicy,
  useQuestion,
  useRequest,
} from './helpers/judgeUsesFixture'

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

function features() {
  return judgeFeaturesLoader({
    bundlePath: path.resolve('dist/judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}

describe('round-4 production J/FU factories', () => {
  it('installs current language and refuses local inference without opt-in', async () => {
    setUiText({ ...EN, judgeLocalUnverified: 'Fixture translated local label' }, 'de')
    const root = features()
    expect(features()).toBe(root)
    const local = await root.loadLocal()
    const config = {
      enabled: false,
      selection: 'explicit',
      confidential: false,
      endpoint: 'http://127.0.0.1:1',
      model: 'tev1:4b',
      trust: 'unverified',
      capability: usePolicy().capability,
    } as const
    expect(local.localJudgeStatus(config).label).toBe('Fixture translated local label')
    const measureTokens = vi.fn(() => 0)
    const chatPrompt = vi.fn(() => ({ system: '', user: '' }))
    const runtime = local.createLocalJudge(
      {
        configuration: () => config,
        nativeScope: () => 'native',
        runtimeInstallation: () => undefined,
        measureTokens,
        chatPrompt,
      },
      { packageRoot: '/missing-package', storageRoot: '/missing-storage' },
    )
    await expect(runtime.judge(useRequest(), new AbortController().signal)).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
    expect(measureTokens).not.toHaveBeenCalled()
    expect(chatPrompt).not.toHaveBeenCalled()
    const consent = vi.fn(() => Promise.resolve(false))
    const pull = vi.fn(() => Promise.resolve())
    await expect(
      local.pullLocalJudgeModel(
        'tev1:4b',
        {
          explicitUserAction: true,
          consent,
          pull,
        },
        new AbortController().signal,
      ),
    ).resolves.toBe('consent-declined')
    expect(consent).toHaveBeenCalledWith('tev1:4b', 4_482_415_847)
    expect(pull).not.toHaveBeenCalled()
  })

  it('keeps each use inactive without its paired and borrowed-golden evidence', async () => {
    const uses = await features().loadUses()
    const allUses = [
      'skill-suggestion',
      'agent-suggestion',
      'context-relevance',
      'semantic-grading',
      'orchestration-hint',
      'review-signal',
      'ci-flake-triage',
      'lane-diff-prescreen',
      'review-class-order',
    ] as const
    expect(Object.keys(uses.definitions)).toEqual(allUses)
    for (const use of allUses) {
      const policy = usePolicy(use)
      const question = useQuestion(use)
      if (!policy.evidence) throw new Error('missing fixture evidence')
      for (const evidence of [
        undefined,
        { ...policy.evidence, pairedM75Receipt: '' },
        { ...policy.evidence, borrowedGoldenReceipt: '' },
      ]) {
        expect(uses.admitJudgeUse({ ...policy, evidence }, question)).toEqual({
          admitted: false,
          reason: 'evidence-missing',
        })
      }
    }
    const policy = usePolicy()
    const judge = vi.fn(() => Promise.resolve(useOutput()))
    const review = new uses.JudgeUses({
      runtime: { judge },
      policy: () => ({ ...policy, evidence: undefined }),
      binding: () => policy,
      question: () => useQuestion('review-signal'),
      redact: (text) => text,
    })
    expect(
      review.startReview(
        {
          action: useAction(),
          state: {
            userRequest: 'synthetic',
            recentCalls: [],
            tool: 'shell',
            action: 'fixture',
            workspaceRoot: '/fixture',
            platform: 'darwin',
          },
        },
        new AbortController().signal,
      ),
    ).toBeUndefined()
    expect(judge).not.toHaveBeenCalled()
  })

  it('shares one fake admitted review while preserving the other holder at its fence', async () => {
    const uses = await features().loadUses()
    const policy = usePolicy()
    const judge = vi.fn(() => Promise.resolve(useOutput(policy, undefined, {}, 'review')))
    const review = new uses.JudgeUses({
      runtime: { judge },
      policy: () => policy,
      binding: () => policy,
      question: () => useQuestion('review-signal'),
      redact: (text) => text,
    })
    const input: JudgeReviewInput = {
      action: useAction(),
      state: {
        userRequest: 'synthetic',
        recentCalls: [],
        tool: 'shell',
        action: 'fixture',
        workspaceRoot: '/fixture',
        platform: 'darwin',
      },
    }
    const first = review.startReview(input, new AbortController().signal)
    const second = review.startReview(input, new AbortController().signal)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(judge).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(first?.read()).toBe(true)
    expect(second?.read()).toBe(true)
    expect(first?.read()).toBe(false)
    expect(second?.read()).toBe(false)
  })
})
