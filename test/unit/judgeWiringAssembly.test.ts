import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { judgeFeaturesLoader } from '../../src/runtime/judge/judgeBundle'
import { createLogger } from '../../src/host/logger'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  embeddedBinding,
  phase2Binding,
  phase2Window,
  surfaceInput,
} from './helpers/judgePhase2Rig'
import { command, io, REQUEST } from './judgeCliFixtures'

const built = builtJudgeFactories()
function features() {
  return judgeFeaturesLoader({
    bundlePath: path.join(built.folder, 'judgeP2.js'),
    log: createLogger(new FakeLogOutputChannel()),
  })()
}
function binding(engine = 'both') {
  return phase2Binding(engine)
}
function embedded(locality: 'same-provider' | 'verified-local' = 'same-provider') {
  return embeddedBinding(locality)
}

describe('phase-2 paths through the shipped lazy assembly', () => {
  it('reaches cascade from the runtime factory with one distinct attempt per source', async () => {
    const fixture = binding()
    const runtime = await features().createRuntime({ binding: () => fixture.value })
    const result = await runtime.judge(
      { ...REQUEST, model: 'chosen' },
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { source: 'both', technique: 'cascade' } } },
    })
    expect(fixture.same.run).toHaveBeenCalledTimes(1)
    expect(fixture.separate.run).toHaveBeenCalledTimes(1)
  })
  it.each(['ask', 'mcp'])(
    'reaches cascade from the %s surface through the real command assembly',
    async (action) => {
      const fixture = binding()
      const factory = features()
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
      expect(fixture.same.run).toHaveBeenCalledTimes(1)
      expect(fixture.separate.run).toHaveBeenCalledTimes(1)
    },
  )
  it('reaches cascade through the window factory without changing the same-model fallback', async () => {
    const fixture = binding()
    const judge = phase2Window({
      binding: () => fixture.value,
      createRuntime: (deps) => features().createRuntime(deps),
    })
    const fence = judge.start(
      { backend: 'museCode', sessionId: 's1', turnId: 'turn-1', tool: 'bash', args: {} },
      'state',
    )
    await vi.waitFor(() => {
      expect(fixture.same.run).toHaveBeenCalledTimes(1)
    })
    expect(judge.readPanelSnapshot()?.effectiveSource).toBe('both')
    expect(fence?.read()).toBe('caution')
    judge.dispose()
  })
  it('drops a cascade verdict and prevents the follow-up when its turn changes during the first source', async () => {
    const fixture = binding()
    let current = fixture.value
    fixture.separate.run.mockImplementationOnce(async (request, signal) => {
      current = { ...current, context: { ...current.context, turn: 'replacement' } }
      return await binding().separate.run(request, signal)
    })
    const runtime = await features().createRuntime({ binding: () => current })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(fixture.same.run).not.toHaveBeenCalled()
  })
  it('reaches capable paid embeddings, publishes the manifest ceiling before dispatch and asks consent once', async () => {
    const fixture = embedded()
    const status = vi.fn()
    const runtime = await features().createRuntime({
      binding: () => fixture.value,
      embeddingStatus: status,
    })
    for (let index = 0; index < 2; index += 1) {
      const result = await runtime.judge(REQUEST, new AbortController().signal)
      expect(result).toMatchObject({
        outcome: 'answered',
        result: { muse: { risk: { technique: 'embedding', uncertainCostUsd: 0.0002 } } },
      })
    }
    expect(status).toHaveBeenCalledWith({ available: true, attemptCeiling: 408 })
    expect(status.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.embed.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(fixture.allowsPaidUse).toHaveBeenCalledTimes(1)
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0]?.detail).toContain('$0.000200')
    expect(fixture.prompts[0]?.detail).toContain('$1.00')
    expect(fixture.embed).toHaveBeenCalledTimes(2)
    expect(fixture.claims).toHaveLength(2)
    expect(fixture.same.run).not.toHaveBeenCalled()
  })
  it('offers free verified-local embeddings only after explicit local opt-in', async () => {
    const fixture = embedded('verified-local')
    const runtime = await features().createRuntime({ binding: () => fixture.value })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'embedding' } } },
    })
    expect(fixture.claims).toHaveLength(0)
    expect(fixture.allowsPaidUse).not.toHaveBeenCalled()
  })
  it('reports unavailable capability and preserves the full judge without embedding dispatch or consent', async () => {
    const fixture = embedded()
    const status = vi.fn()
    const value = { ...fixture.value, embedding: { ...fixture.embedding, capable: false } }
    const runtime = await features().createRuntime({
      binding: () => value,
      embeddingStatus: status,
    })
    expect(await runtime.judge(REQUEST, new AbortController().signal)).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { technique: 'stated' } } },
    })
    expect(status).toHaveBeenCalledWith({ available: false, reason: 'capability-unavailable' })
    expect(fixture.embed).not.toHaveBeenCalled()
    expect(fixture.allowsPaidUse).not.toHaveBeenCalled()
  })
})
