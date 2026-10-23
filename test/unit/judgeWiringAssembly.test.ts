import { describe, expect, inject, it } from 'vitest'
import { assertCurrentProductionBuild } from './productionBuild'
import { embeddedBinding, phase2Binding, surfaceInput } from './helpers/judgePhase2Rig'
import { shippedJudgeP2Features } from './helpers/judgeP2Features'
import { command, io, REQUEST } from './judgeCliFixtures'

// The shipped lazy assembly, not a per-test build: these suites run
// against the production dist/ the delivery gate proved current.
assertCurrentProductionBuild(inject('productionBuildGeneration'), process.cwd())
function embedded(locality: 'same-provider' | 'verified-local' = 'same-provider') {
  return embeddedBinding(locality)
}

describe('phase-2 paths through the shipped lazy assembly', () => {
  it('reaches cascade from the runtime factory with one distinct attempt per source', async () => {
    const fixture = phase2Binding()
    const runtime = await shippedJudgeP2Features().createRuntime({ binding: () => fixture.value })
    const result = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { source: 'both', technique: 'cascade' } } },
    })
    expect(fixture.same.calls).toHaveLength(1)
    expect(fixture.separate.calls).toHaveLength(1)
  })
  it.each(['ask', 'mcp'])(
    'reaches cascade from the %s surface through the real command assembly',
    async (action) => {
      const fixture = phase2Binding()
      const factory = shippedJudgeP2Features()
      const deps = await factory.createCommandDeps({
        binding: () => fixture.value,
        billing: 'free',
        worstCaseUsd: () => 0,
      })
      const streams = io(surfaceInput(action))
      expect(
        await factory.runJudgeCommand(
          command(action, ['--engine', 'both', '--model', 'chosen']),
          streams,
          deps,
        ),
      ).toBe(0)
      expect(streams.output()).toContain('cascade')
      expect(fixture.same.calls).toHaveLength(1)
      expect(fixture.separate.calls).toHaveLength(1)
    },
  )
  it('drops a cascade verdict and prevents the follow-up when its turn changes during the first source', async () => {
    const fixture = phase2Binding()
    const firstSourceRun = fixture.value.separate.run
    let hasReplaced = false
    let current = {
      ...fixture.value,
      separate: {
        ...fixture.value.separate,
        run: (async (request, signal) => {
          if (!hasReplaced) {
            hasReplaced = true
            current = { ...current, context: { ...current.context, turn: 'replacement' } }
          }
          return await firstSourceRun(request, signal)
        }) satisfies typeof firstSourceRun,
      },
    }
    // The surface's trigger identity changes; the plan is cancelled, never re-planned.
    const runtime = await shippedJudgeP2Features().createRuntime({
      binding: () => current,
      triggers: () => current.context,
    })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(fixture.same.calls).toHaveLength(0)
  })
  it('reaches capable paid embeddings, publishes the manifest ceiling before dispatch and asks consent once', async () => {
    const fixture = embedded()
    const order: string[] = []
    const statuses: unknown[] = []
    const embedding = {
      ...fixture.value.embedding,
      source: {
        ...fixture.value.embedding.source,
        embed: async (inputs: readonly string[], signal: AbortSignal) => {
          order.push('embed')
          return await fixture.value.embedding.source.embed(inputs, signal)
        },
      },
    }
    const value = { ...fixture.value, embedding }
    const runtime = await shippedJudgeP2Features().createRuntime({
      binding: () => value,
      embeddingStatus: (status: unknown) => {
        order.push('status')
        statuses.push(status)
      },
    })
    for (let index = 0; index < 2; index += 1) {
      const result = await runtime.judge(REQUEST, new AbortController().signal)
      expect(result).toMatchObject({
        outcome: 'answered',
        result: { muse: { risk: { technique: 'embedding', uncertainCostUsd: '0.0002' } } },
      })
    }
    // The runtime publishes the availability manifest before every run's
    // dispatch (src/core/judge/runtime.ts), so two sequential runs publish
    // twice; consent below is still asked only once.
    expect(statuses).toHaveLength(2)
    for (const status of statuses)
      expect(status).toMatchObject({ available: true, attemptCeiling: 408 })
    expect(order).toEqual(['status', 'embed', 'status', 'embed'])
    expect(fixture.allowsCalls).toHaveLength(1)
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0]?.detail).toContain('$0.000200')
    expect(fixture.prompts[0]?.detail).toContain('$1.00')
    expect(fixture.embedCalls).toHaveLength(2)
    expect(fixture.claims).toHaveLength(2)
    expect(fixture.same.calls).toHaveLength(0)
  })
  it('offers free verified-local embeddings only after explicit local opt-in', async () => {
    const fixture = embedded('verified-local')
    const runtime = await shippedJudgeP2Features().createRuntime({ binding: () => fixture.value })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'embedding' } } },
    })
    expect(fixture.claims).toHaveLength(0)
    expect(fixture.allowsCalls).toHaveLength(0)
  })
  it('reports unavailable capability and preserves the full judge without embedding dispatch or consent', async () => {
    const fixture = embedded()
    const statuses: unknown[] = []
    const value = { ...fixture.value, embedding: { ...fixture.embedding, capable: false } }
    const runtime = await shippedJudgeP2Features().createRuntime({
      binding: () => value,
      embeddingStatus: (status: unknown) => {
        statuses.push(status)
      },
    })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'stated' } } },
    })
    expect(statuses).toEqual([{ available: false, reason: 'capability-unavailable' }])
    expect(fixture.embedCalls).toHaveLength(0)
    expect(fixture.allowsCalls).toHaveLength(0)
  })
})
