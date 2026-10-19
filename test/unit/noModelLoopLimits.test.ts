import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { structuredSideCall } from '../../src/core/backends/modelapi/structuredOutput'
import { subagentTaskPrice } from '../../src/shared/paid'

const answerSchema = z.object({ answer: z.string() })

const formats = { state: 'yes', value: ['json_schema'] } as const

// NOLIMITSRUN (PLAN.md D121): no repair bound of ours. A structured side
// call repairs until the answer validates or the person stops it, saying so
// on every round; Stop still ends it.
describe('no model-loop limits: structured-output repairs', () => {
  it('repairs past the old one-repair bound until the answer validates', async () => {
    const repairs: boolean[] = []
    const notices: string[] = []
    let calls = 0
    const result = await structuredSideCall({
      formats,
      name: 'probe',
      schema: answerSchema,
      request: (attempt) => {
        calls += 1
        repairs.push(attempt.repair)
        return Promise.resolve(calls < 3 ? 'not json' : JSON.stringify({ answer: 'done' }))
      },
      signal: new AbortController().signal,
      fallback: () => ({ answer: 'fallback' }),
      notice: (text) => {
        notices.push(text)
      },
    })
    expect(result).toEqual({ answer: 'done' })
    expect(calls).toBe(3)
    expect(repairs).toEqual([false, true, true])
    expect(notices).toHaveLength(2)
    expect(notices[0]).not.toBe(notices[1])
  })

  it('says so on a failed request round and keeps going', async () => {
    const notices: string[] = []
    let calls = 0
    const result = await structuredSideCall({
      formats,
      name: 'probe',
      schema: answerSchema,
      request: () => {
        calls += 1
        if (calls === 1) throw new Error('flaky transport')
        return Promise.resolve(JSON.stringify({ answer: 'done' }))
      },
      signal: new AbortController().signal,
      fallback: () => ({ answer: 'fallback' }),
      notice: (text) => {
        notices.push(text)
      },
    })
    expect(result).toEqual({ answer: 'done' })
    expect(calls).toBe(2)
    expect(notices).toHaveLength(1)
  })

  it('still ends when the person stops it', async () => {
    const controller = new AbortController()
    await expect(
      structuredSideCall({
        formats,
        name: 'probe',
        schema: answerSchema,
        request: () => {
          controller.abort()
          return Promise.resolve('not json')
        },
        signal: controller.signal,
        fallback: () => ({ answer: 'fallback' }),
      }),
    ).rejects.toThrow()
  })
})

// NOLIMITSRUN (PLAN.md D121): no request bound of ours on a child task. A
// subagent runs until done or stopped; the paid-consent card prices from the
// published rates with no cap, and every request is tallied as it goes.
describe('no model-loop limits: subagent task pricing', () => {
  it('prices the task from the rates with no request cap of ours', () => {
    const price = subagentTaskPrice('muse-spark-1.3')
    expect(price).toContain('muse-spark-1.3')
    expect(price).toContain('billed per request')
    expect(price).not.toContain('up to')
  })

  it('still names an unverified price as unknown', () => {
    expect(subagentTaskPrice('no-such-model')).toBeTruthy()
  })
})
