import { PassThrough } from 'node:stream'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import type { JudgeOutcome, JudgeResult } from '../../src/core/judge/schema'
import { runJudgeCommand, type JudgeCliDeps } from '../../src/runtime/judge/commands'
import { JudgeCliInputError } from '../../src/runtime/judge/args'
import { JUDGE_MAX_BODY_BYTES, MILLISECONDS_PER_SECOND } from '../../src/shared/constants'
import { answered, command, evidenceCases, io, REQUEST, source, writer } from './judgeCliFixtures'

// One recording paid-admission closure per case: the calls array and the
// adapter stay together so no case repeats the recorder shape.
function paidAdmission() {
  const calls: unknown[][] = []
  return {
    calls,
    admitPaid: (...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve(answered())
    },
  }
}

describe('judge CLI bounded advisory commands', () => {
  it.each(evidenceCases())(
    'validates answer evidence: $name',
    async ({ request, outcome, valid }) => {
      const fake = source('free', undefined, outcome)
      const streams = io(JSON.stringify(request))
      expect(
        await runJudgeCommand(command(), streams, {
          resolveSource: () => Promise.resolve(fake.value),
        }),
      ).toBe(valid ? 0 : 4)
      expect(JSON.parse(streams.output())).toEqual(
        valid
          ? outcome
          : {
              outcome: 'no-answer',
              reason: 'engine-failure',
            },
      )
    },
  )
  it('preserves source configuration errors as exit 2 without private text', async () => {
    const streams = io()
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.reject(new JudgeCliInputError())
    }
    expect(await runJudgeCommand(command(), streams, { resolveSource })).toBe(2)
    expect(streams.output()).toBe('')
    expect(streams.error()).not.toContain('engine-failure')
    expect(streams.error()).not.toBe('')
    expect(resolveSourceCalls).toHaveLength(1)
  })
  it('answers only with the explicit available same model', async () => {
    const fake = source()
    const streams = io()
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.resolve(fake.value)
    }
    expect(await runJudgeCommand(command(), streams, { resolveSource })).toBe(0)
    expect(JSON.parse(streams.output())).toEqual(answered())
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toMatchObject({ request: REQUEST })
    expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(resolveSourceCalls).toHaveLength(1)
    const [resolved, resolveSignal, resolveRequest] = resolveSourceCalls[0] ?? []
    expect(resolved).toMatchObject({ model: 'chosen', engine: 'auto', budgetUsd: 0 })
    expect(resolveSignal).toBeInstanceOf(AbortSignal)
    expect(resolveRequest).toEqual(REQUEST)
  })
  it('refuses absent same context without resolving or switching models', async () => {
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.resolve(source().value)
    }
    const streams = io()
    expect(await runJudgeCommand(command('ask', []), streams, { resolveSource })).toBe(4)
    expect(resolveSourceCalls).toHaveLength(0)
    expect(JSON.parse(streams.output())).toEqual({
      outcome: 'no-answer',
      reason: 'source-unavailable',
    })
  })
  it('accepts an explicit request model as context', async () => {
    const streams = io(JSON.stringify({ ...REQUEST, model: 'chosen' }))
    expect(
      await runJudgeCommand(command('ask', []), streams, {
        resolveSource: () => Promise.resolve(source().value),
      }),
    ).toBe(0)
  })
  it('dispatches explicit separate and both modes through the selected injected source', async () => {
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const meta = good.result.muse['risk']
    if (meta === undefined) throw new Error('fixture')
    for (const kind of ['separate', 'both'] as const) {
      const fake = source('free', undefined, {
        outcome: 'answered',
        result: { ...good.result, muse: { risk: { ...meta, source: kind } } },
      })
      const resolveSourceCalls: unknown[][] = []
      const resolveSource = (...args: unknown[]) => {
        resolveSourceCalls.push(args)
        return Promise.resolve({ ...fake.value, source: kind })
      }
      const args = ['--engine', kind, '--separate', 'picked']
      if (kind === 'both') args.push('--model', 'chosen')
      expect(await runJudgeCommand(command('ask', args), io(), { resolveSource })).toBe(0)
      expect(resolveSourceCalls).toHaveLength(1)
      const [kindResolved, kindSignal, kindRequest] = resolveSourceCalls[0] ?? []
      expect(kindResolved).toMatchObject({ engine: kind, separate: 'picked' })
      expect(kindSignal).toBeInstanceOf(AbortSignal)
      expect(kindRequest).toEqual(REQUEST)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0]).toMatchObject({ request: REQUEST })
      expect(fake.calls[0]?.signal).toBeInstanceOf(AbortSignal)
    }
  })
  it('refuses unavailable and wrong-source or wrong-model contexts', async () => {
    for (const value of [
      undefined,
      { ...source().value, model: 'guessed' },
      { ...source().value, source: 'separate' as const },
    ]) {
      const streams = io()
      expect(
        await runJudgeCommand(command('ask', ['--engine', 'same', '--model', 'chosen']), streams, {
          resolveSource: () => Promise.resolve(value),
        }),
      ).toBe(4)
      expect(streams.output()).toContain('source-unavailable')
    }
  })
  it('rejects malformed stdin, wrong request shape and excess bytes before resolution', async () => {
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.resolve(source().value)
    }
    for (const input of [
      '',
      '{',
      '{}',
      'judge ask',
      'x'.repeat(JUDGE_MAX_BODY_BYTES + 1),
      JSON.stringify({ ...REQUEST, extra: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }),
      new Uint8Array([255]),
    ]) {
      const streams = io(input)
      expect(await runJudgeCommand(command(), streams, { resolveSource })).toBe(2)
      expect(streams.output()).toBe('')
    }
    expect(resolveSourceCalls).toHaveLength(0)
  })
  it('refuses contradictory request and CLI models before dispatch', async () => {
    const fake = source()
    const streams = io(JSON.stringify({ ...REQUEST, model: 'other' }))
    expect(
      await runJudgeCommand(command(), streams, {
        resolveSource: () => Promise.resolve(fake.value),
      }),
    ).toBe(2)
    expect(fake.calls).toHaveLength(0)
  })
  it('refuses a paid source at budget zero and a batch above a tiny positive cap', async () => {
    const fake = source('paid', 1)
    const { calls: admitPaidCalls, admitPaid } = paidAdmission()
    for (const budget of ['0', '0.000001']) {
      const streams = io()
      expect(
        await runJudgeCommand(
          command('ask', ['--model', 'chosen', '--budget-usd', budget]),
          streams,
          { resolveSource: () => Promise.resolve(fake.value), admitPaid },
        ),
      ).toBe(4)
      expect(streams.output()).toContain('over-budget')
    }
    expect(admitPaidCalls).toHaveLength(0)
    expect(fake.calls).toHaveLength(0)
  })
  it('refuses unpriced calls and calls without the daily ledger/consent adapter', async () => {
    for (const cost of [undefined, -1, 0, NaN, Infinity, 1]) {
      const fake = source('paid', cost)
      const streams = io()
      expect(
        await runJudgeCommand(command('ask', ['--model', 'chosen', '--budget-usd', '1']), streams, {
          resolveSource: () => Promise.resolve(fake.value),
        }),
      ).toBe(4)
      expect(streams.output()).toContain(cost === 1 ? 'consent-needed' : 'unpriced')
      expect(fake.calls).toHaveLength(0)
    }
  })
  it('routes paid dispatch exclusively through the durable admission adapter', async () => {
    const fake = source('paid', 1)
    const { calls: admitPaidCalls, admitPaid } = paidAdmission()
    const streams = io()
    expect(
      await runJudgeCommand(command('ask', ['--model', 'chosen', '--budget-usd', '1']), streams, {
        resolveSource: () => Promise.resolve(fake.value),
        admitPaid,
      }),
    ).toBe(0)
    expect(admitPaidCalls).toHaveLength(1)
    const [admitted, admitRequest, admitCost, admitSignal] = admitPaidCalls[0] ?? []
    expect(admitted).toBe(fake.value)
    expect(admitRequest).toEqual(REQUEST)
    expect(admitCost).toBe(1)
    expect(admitSignal).toBeInstanceOf(AbortSignal)
    expect(fake.calls).toHaveLength(0)
  })
  it('preserves daily ledger and consent refusals without paid dispatch', async () => {
    for (const reason of ['over-budget', 'consent-declined', 'engine-failure'] as const) {
      const fake = source('paid', 1)
      const streams = io()
      expect(
        await runJudgeCommand(command('ask', ['--model', 'chosen', '--budget-usd', '1']), streams, {
          resolveSource: () => Promise.resolve(fake.value),
          admitPaid: () => Promise.resolve({ outcome: 'no-answer', reason }),
        }),
      ).toBe(4)
      expect(streams.output()).toContain(reason)
      expect(fake.calls).toHaveLength(0)
    }
  })
  it('rejects empty, misaligned, wrong-type and oversized source output', async () => {
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const risk = good.result.answers['risk']
    const meta = good.result.muse['risk']
    if (risk === undefined || meta === undefined) throw new Error('fixture')
    const invalidResults: JudgeResult[] = [
      { ...good.result, answers: {}, muse: {} },
      { ...good.result, answers: { risk, extra: risk }, muse: { risk: meta, extra: meta } },
      { ...good.result, answers: { other: risk }, muse: { other: meta } },
      { ...good.result, model: 'other' },
      { ...good.result, muse: { risk: { ...meta, source: 'separate' } } },
      { ...good.result, muse: { risk: { ...meta, model: 'other' } } },
      {
        ...good.result,
        answers: { risk: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1 } } },
      },
      { ...good.result, vendor: 'x'.repeat(JUDGE_MAX_BODY_BYTES) },
    ]
    for (const result of invalidResults) {
      const fake = source('free', undefined, { outcome: 'answered', result })
      const streams = io()
      expect(
        await runJudgeCommand(command(), streams, {
          resolveSource: () => Promise.resolve(fake.value),
        }),
      ).toBe(4)
      expect(streams.output()).toContain('engine-failure')
    }
  })
  it('keeps failures content-free and never returns empty success', async () => {
    const fake = source('free', undefined, new Error('private upstream text'))
    const streams = io()
    const code = await runJudgeCommand(command(), streams, {
      resolveSource: () => Promise.resolve(fake.value),
    })
    expect(code).toBe(4)
    expect(JSON.parse(streams.output())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(streams.output() + streams.error()).not.toContain('private upstream text')
  })
  it('rejects options not offered and scores beyond the requested legend', async () => {
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const cases = [
      {
        question: { type: 'choice', instructions: 'Choose', criteria: { A: null, B: null } },
        answer: { type: 'choice', choice: 'C', confidence: 1, probabilities: { A: 1, B: 0 } },
      },
      {
        question: { type: 'choice', instructions: 'Choose', criteria: { A: null, B: null } },
        answer: { type: 'choice', choice: 'C', confidence: 1, probabilities: { C: 1 } },
      },
      {
        question: { type: 'choice', instructions: 'Choose', criteria: { A: null, B: null } },
        answer: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1, C: 0 } },
      },
      {
        question: { type: 'score', instructions: 'Score', criteria: ['low', 'high'] },
        answer: {
          type: 'score',
          score: 2,
          confidence: 1,
          probabilities: { '0': 0, '1': 1 },
          legend: { '0': 'low', '1': 'high' },
        },
      },
      {
        question: { type: 'score', instructions: 'Score', criteria: ['low', 'high'] },
        answer: {
          type: 'score',
          score: -1,
          confidence: 1,
          probabilities: { '0': 1, '1': 0 },
          legend: { '0': 'low', '1': 'high' },
        },
      },
    ] as const
    for (const entry of cases) {
      const fake = source('free', undefined, {
        outcome: 'answered',
        result: { ...good.result, answers: { risk: entry.answer } },
      })
      expect(
        await runJudgeCommand(
          command(),
          io(JSON.stringify({ state: '', questions: { risk: entry.question } })),
          {
            resolveSource: () => Promise.resolve(fake.value),
          },
        ),
      ).toBe(4)
    }
  })
  it('bounds stalled input and an engine that ignores cancellation', async () => {
    const started = performance.now()
    const short = command('ask', ['--model', 'chosen', '--timeout-ms', '100'])
    const stdin = new PassThrough()
    const streams = { ...io(), stdin }
    expect(await runJudgeCommand(short, streams, {})).toBe(4)
    expect(stdin.destroyed).toBe(true)
    // Deliberately ignores cancellation: the command's own timeout fires.
    const hanging = source()
    const fake = {
      ...hanging,
      value: {
        ...hanging.value,
        runtime: { judge: () => new Promise<JudgeOutcome>(() => undefined) },
      },
    }
    const next = io()
    expect(
      await runJudgeCommand(short, next, { resolveSource: () => Promise.resolve(fake.value) }),
    ).toBe(4)
    expect(next.output()).toContain('timeout')
    expect(performance.now() - started).toBeLessThan(MILLISECONDS_PER_SECOND)
  })
  it('fails closed on closed and stalled output delivery', async () => {
    for (const stdout of [writer(true, true).value, writer(false).value]) {
      expect(
        await runJudgeCommand(
          command(),
          { ...io(), stdout },
          { resolveSource: () => Promise.resolve(source().value) },
        ),
      ).toBe(4)
    }
  })
  it('does no work when output is already closed and bounds localization setup', async () => {
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.resolve(source().value)
    }
    expect(
      await runJudgeCommand(
        command(),
        { ...io(), stdout: writer(true, true).value },
        { resolveSource },
      ),
    ).toBe(4)
    expect(resolveSourceCalls).toHaveLength(0)
    expect(
      await runJudgeCommand(command('ask', ['--model', 'chosen', '--timeout-ms', '100']), io(), {
        initialize: () =>
          new Promise(() => {
            /* Deliberately stalled localization read. */
          }),
        resolveSource,
      }),
    ).toBe(4)
    expect(resolveSourceCalls).toHaveLength(0)
  })
  it('runs calibrate/report offline with B input and output schemas', async () => {
    const resolveSourceCalls: unknown[][] = []
    const resolveSource = (...args: unknown[]) => {
      resolveSourceCalls.push(args)
      return Promise.resolve(source().value)
    }
    const schema = z.strictObject({ labels: z.array(z.number()) })
    for (const action of ['calibrate', 'report']) {
      const runInputs: unknown[] = []
      const run = (input: unknown) => {
        runInputs.push(input)
        return Promise.resolve(input)
      }
      const deps: JudgeCliDeps = {
        resolveSource,
        calibrate: { inputSchema: schema, outputSchema: schema, run },
        report: { inputSchema: schema, outputSchema: schema, run },
      }
      const streams = io('{"labels":[0,1]}')
      expect(await runJudgeCommand(command(action), streams, deps)).toBe(0)
      expect(JSON.parse(streams.output())).toEqual({ labels: [0, 1] })
      expect(runInputs).toHaveLength(1)
      expect(await runJudgeCommand(command(action), io('{}'), deps)).toBe(2)
      expect(runInputs).toHaveLength(1)
    }
    expect(resolveSourceCalls).toHaveLength(0)
  })
  it('rejects missing offline/surface implementations and invalid offline results', async () => {
    for (const action of ['calibrate', 'report', 'serve', 'lint']) {
      expect(await runJudgeCommand(command(action, []), io(), {})).toBe(2)
    }
    const schema = z.strictObject({ labels: z.array(z.number()) })
    expect(
      await runJudgeCommand(command('calibrate'), io('{"labels":[1]}'), {
        calibrate: { inputSchema: schema, outputSchema: schema, run: () => Promise.resolve({}) },
      }),
    ).toBe(2)
  })
  it('bounds validated offline output bytes', async () => {
    const schema = z.looseObject({ labels: z.array(z.number()) })
    expect(
      await runJudgeCommand(command('report'), io('{"labels":[]}'), {
        report: {
          inputSchema: schema,
          outputSchema: schema,
          run: () => Promise.resolve({ labels: [], notes: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }),
        },
      }),
    ).toBe(2)
  })
  it('dispatches CS/H only through their injected surfaces', async () => {
    const serveCalls: unknown[][] = []
    const lintCalls: unknown[][] = []
    const serve = (...args: unknown[]) => {
      serveCalls.push(args)
      return Promise.resolve(0)
    }
    const lint = (...args: unknown[]) => {
      lintCalls.push(args)
      return Promise.resolve(2)
    }
    const streams = io()
    expect(await runJudgeCommand(command('serve', []), streams, { serve })).toBe(0)
    expect(streams.stdin.destroyed).toBe(true)
    expect(await runJudgeCommand(command('lint', []), io(), { lint })).toBe(2)
    expect(serveCalls).toHaveLength(1)
    expect(lintCalls).toHaveLength(1)
  })
})
