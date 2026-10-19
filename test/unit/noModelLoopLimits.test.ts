import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { dispatchHooks, parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { structuredSideCall } from '../../src/core/backends/modelapi/structuredOutput'
import {
  boundToolResultText,
  validateToolResultCap,
} from '../../src/core/backends/modelapi/toolResultBound'
import type { ShellResult } from '../../src/core/shellResult'
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

// NOLIMITSRUN (PLAN.md D121): no default deadline of ours. A command or hook
// runs until it ends or the person stops it; a per-command or per-hook
// timeout the person or the model sets explicitly still works.
function hookConfig(hooks: unknown): string {
  return JSON.stringify({ hooks: { SessionStart: [{ hooks }] } })
}

describe('no model-loop limits: hook deadlines', () => {
  it('parses no deadline when none is set, and keeps an explicit one', () => {
    const unset = parseHookConfig(
      hookConfig([{ type: 'command', command: 'long' }]),
      'user',
      'linux',
    )
    expect(unset.warnings).toEqual([])
    expect(unset.hooks).toHaveLength(1)
    expect(unset.hooks[0]?.timeoutSeconds).toBeUndefined()
    const set = parseHookConfig(
      hookConfig([{ type: 'command', command: 'long', timeout: 30 }]),
      'user',
      'linux',
    )
    expect(set.warnings).toEqual([])
    expect(set.hooks[0]?.timeoutSeconds).toBe(30)
  })

  it('still refuses a timeout past the validating bound', () => {
    const parsed = parseHookConfig(
      hookConfig([{ type: 'command', command: 'long', timeout: 601 }]),
      'user',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'user hooks: SessionStart: handler timeout exceeds 600 seconds',
    ])
  })

  it('dispatches with no deadline value when none is set', async () => {
    const parsed = parseHookConfig(
      hookConfig([{ type: 'command', command: 'long' }]),
      'user',
      'linux',
    )
    expect(parsed.warnings).toEqual([])
    const seen: unknown[] = []
    let release: (() => void) | undefined
    const runHook = (...args: unknown[]): Promise<ShellResult> => {
      seen.push(args[3])
      return new Promise<ShellResult>((resolve) => {
        release = () => {
          resolve({ stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false })
        }
      })
    }
    const done = dispatchHooks(
      parsed.hooks,
      'SessionStart',
      { cwd: '/ws' },
      undefined,
      // The runner's real IO shape; only the deadline slot is observed here.
      { runHook },
      undefined,
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxRunningCommands: 4 },
    )
    for (let round = 0; release === undefined && round < 10; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(seen).toEqual([undefined])
    release?.()
    await done
  })
})

// NOLIMITSRUN (PLAN.md D121): no trimming of ours. A result reaches the model
// whole; only the model's real window share (the capability record's number)
// may cut it, with a spill the model can page through, said out loud.
describe('no model-loop limits: tool-result trim', () => {
  it('passes a long single-line result whole when the window allows', () => {
    const text = `${'x'.repeat(200_000)}\nshort\n`
    const bounded = boundToolResultText(text, { maxBytes: Infinity, windowTokens: 1_000_000 })
    expect(bounded.cut).toBeUndefined()
    expect(bounded.text).toBe(text)
  })

  it('still cuts to the window share when the result cannot fit it', () => {
    const text = 'y'.repeat(100_000)
    const bounded = boundToolResultText(text, { maxBytes: Infinity, windowTokens: 1000 })
    if (bounded.cut === undefined) throw new Error('expected a cut')
    expect(bounded.cut.keptChars + bounded.cut.omittedChars).toBe(text.length)
    expect(bounded.cut.keptChars).toBeLessThan(text.length)
  })

  it('validates a set cap with no fallback of ours', () => {
    expect(validateToolResultCap(undefined, 1_000_000)).toEqual({ bytes: Infinity })
    expect(validateToolResultCap(0, 1_000_000)).toEqual({ bytes: Infinity })
    const refused = validateToolResultCap(512, 1_000_000)
    expect('refused' in refused && refused.refused.kind).toBe('below-floor')
    expect(refused).not.toHaveProperty('fallback')
  })
})
