// Fast-path routing guards for the embedding shortcut (M98 phase 2, lane I).
// Fakes and synthetic fixtures only; no live, paid or local model calls.

import { describe, expect, it, type vi } from 'vitest'
import {
  runEmbeddingJudge,
  type EmbeddingRouteDependencies,
  type EmbeddingSource,
} from '../../src/core/judge/embedding/route'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE } from '../../src/shared/constants'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { embeddingHeadDigest } from '../../src/core/judge/embedding/schema'
import {
  confidentVectors,
  noulRequest,
  routeDependencies,
  trainedHead,
} from './judgeEmbeddingFixtures'

const options = { optedIn: true, confidential: false }
const signal = (): AbortSignal => new AbortController().signal

/** The full judge answered; the embedding leg spent nothing and ran nothing. */
async function expectQuietFallback(
  deps: EmbeddingRouteDependencies,
  fallbackCalls: JudgeRequest[],
  embed: ReturnType<typeof vi.fn>,
  claims: readonly unknown[],
): Promise<void> {
  const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') throw new Error('expected the full judge')
  expect(outcome.result.muse['risk']?.technique).toBe('stated')
  expect(fallbackCalls).toHaveLength(1)
  expect(embed).not.toHaveBeenCalled()
  expect(claims).toHaveLength(0)
}

describe('embedding fast path', () => {
  it('answers from the head with its own reservation when confident', async () => {
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      source: { embed: () => Promise.resolve(confidentVectors) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected an answer')
    const meta = outcome.result.muse['risk']
    expect(meta?.technique).toBe('embedding')
    expect(meta?.label).toBe('uncalibrated')
    expect(meta?.partial).toBe(false)
    expect(meta?.confidence).toBeGreaterThanOrEqual(JUDGE_EMBED_FALLBACK_CONFIDENCE)
    expect(outcome.result.answers['risk']).toMatchObject({ type: 'noul' })
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fallbackCalls).toHaveLength(0)
    expect(claims).toEqual([{ inputTokens: 12, uncachedCostUsd: 0.0002 }])
    expect(meta?.reservedCostUsd).toBe(0.0002)
  })

  it('refuses without an allowed full source and spends nothing', async () => {
    const { deps, claims, embed } = routeDependencies()
    const outcome = await runEmbeddingJudge(
      noulRequest,
      options,
      { ...deps, fallback: undefined },
      signal(),
    )
    expect(outcome).toEqual({ outcome: 'no-answer', reason: 'source-unavailable' })
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  })

  it.each([
    ['model', { model: 'other-model' }],
    ['provider', { providerId: 'other-provider' }],
    ['family', { family: 'skill.fit' }],
  ])('falls back on a head bound to another %s without embedding', async (_case, changed) => {
    const head = trainedHead()
    // Re-digest so the head verifies: only the source binding may refuse it.
    const rebound = { ...head, identity: { ...head.identity, ...changed } }
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...rebound, digest: embeddingHeadDigest(rebound) },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it('falls back on a head whose dimension disagrees with its weights', async () => {
    const head = trainedHead()
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...head, identity: { ...head.identity, dimension: 4 } },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it('falls back on corrupt weights without embedding', async () => {
    const head = trainedHead()
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...head, bias: head.bias + 10 },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it('falls back below the confidence floor and reserves each leg separately', async () => {
    const { deps, fallbackCalls, fallbackClaims, claims, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([[0.5, 0.5, 0.5]]) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected fallback')
    expect(outcome.result.muse['risk']?.technique).toBe('stated')
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fallbackCalls).toHaveLength(1)
    expect(claims).toEqual([{ inputTokens: 12, uncachedCostUsd: 0.0002 }])
    expect(fallbackClaims).toEqual([{ inputTokens: 40, uncachedCostUsd: 0.001 }])
  })

  it('falls back whole on a choice question the head cannot answer', async () => {
    const { deps, fallbackCalls, claims, embed } = routeDependencies()
    const choice = {
      state: noulRequest.state,
      questions: {
        pick: { type: 'choice', instructions: 'Pick one', criteria: { A: 'x', B: 'y' } },
      },
    } as const
    const outcome = await runEmbeddingJudge(choice, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  })

  it('falls back when not opted in and when cancelled or malformed', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies()
    expect(
      await runEmbeddingJudge(noulRequest, { ...options, optedIn: false }, deps, signal()),
    ).toMatchObject({ outcome: 'answered' })
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(await runEmbeddingJudge({ questions: {} }, options, deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
  })

  it('falls back on a misbehaving embedding source', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([]) },
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, signal())).toMatchObject({
      outcome: 'answered',
    })
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).toHaveBeenCalledTimes(1)
  })
})

describe('embedding confidentiality', () => {
  const confidentialOptions = { optedIn: true, confidential: true }

  /** The blocked leg defers to the full judge without spending or sending. */
  async function expectConfidentialFallback(source: Partial<EmbeddingSource>): Promise<void> {
    const { deps, fallbackCalls, claims, embed } = routeDependencies({ source })
    const outcome = await runEmbeddingJudge(noulRequest, confidentialOptions, deps, signal())
    expect(outcome.outcome).toBe('answered')
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  }

  /** The permitted leg answers from the head; the full judge never runs. */
  async function expectConfidentialAnswer(source: Partial<EmbeddingSource>): Promise<void> {
    const { deps, fallbackCalls, embed } = routeDependencies({ source })
    const outcome = await runEmbeddingJudge(noulRequest, confidentialOptions, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected an answer')
    expect(outcome.result.muse['risk']?.technique).toBe('embedding')
    expect(fallbackCalls).toHaveLength(0)
    expect(embed).toHaveBeenCalledTimes(1)
  }

  it('never embeds remotely in a confidential workspace without provider permission', async () => {
    await expectConfidentialFallback({ locality: 'same-provider', providerPolicy: 'refuse' })
  })

  it('embeds remotely in a confidential workspace the provider policy permits', async () => {
    await expectConfidentialAnswer({
      locality: 'same-provider',
      providerPolicy: 'allow',
      embed: () => Promise.resolve(confidentVectors),
    })
  })

  it('never uses an unverified local endpoint in a confidential workspace', async () => {
    await expectConfidentialFallback({ locality: 'unverified-local' })
  })

  it('uses a verified local endpoint in a confidential workspace', async () => {
    await expectConfidentialAnswer({
      locality: 'verified-local',
      embed: () => Promise.resolve(confidentVectors),
    })
  })
})
