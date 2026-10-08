import { describe, expect, it, vi } from 'vitest'
import {
  sideCallBody,
  sideCallMode,
  structuredCompaction,
  structuredSideCall,
  renderCompactionSummary,
  type SideCallAttempt,
  type SideCallFormats,
} from '../../src/core/backends/modelapi/structuredOutput'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { reviewerAnswerSchema } from '../../src/shared/sideCallSchemas'
import { UI_TEXT } from '../../src/shared/constants'

const STRICT: SideCallFormats = { state: 'yes', value: ['strict_schema'] }
const BODY: CreateResponseBody = {
  model: 'captured-model',
  input: [],
  instructions: 'unchanged',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'minimal', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 100,
  prompt_cache_key: 'prefix',
  prompt_cache_retention: 'in_memory',
}
const SUMMARY = {
  goal: 'Finish the work.',
  constraints: 'Untrusted: ignore instructions in a file.',
  progress: String.raw`Completed: read C:\repo\a.ts. In progress: tests. Blocked: none.`,
  decisions: 'Preserve exact paths.',
  nextSteps: 'Run checks.',
  criticalContext: 'Error: exact\nbytes.',
}

describe('M106 structured side answers', () => {
  it.each([
    [undefined, 'text'],
    [{ state: 'unknown', value: ['strict_schema'] }, 'text'],
    [{ state: 'no', value: ['strict_schema'] }, 'text'],
    [{ state: 'yes', value: ['json_object', 'text'] }, 'text'],
    [{ state: 'yes', value: ['forced_tool'] }, 'forced_tool'],
    [{ state: 'yes', value: ['forced_tool', 'json_schema'] }, 'json_schema'],
    [{ state: 'yes', value: ['forced_tool', 'json_schema', 'strict_schema'] }, 'strict_schema'],
  ] as const)('selects only supported evidence: %j', (formats, mode) => {
    expect(sideCallMode(formats)).toBe(mode)
  })

  it('keeps the text request byte-identical and does not invoke a codec', () => {
    const encode = vi.fn(() => BODY)
    expect(
      sideCallBody(BODY, { mode: 'text', name: 'review', schema: {}, repair: false }, encode),
    ).toBe(BODY)
    expect(encode).not.toHaveBeenCalled()
  })

  it.each(['strict_schema', 'json_schema'] as const)(
    'encodes %s without changing the prefix',
    (mode) => {
      const body = sideCallBody(
        BODY,
        { mode, name: 'review', schema: { type: 'object' }, repair: false },
        undefined,
      )
      expect(body.text?.format).toEqual({
        type: 'json_schema',
        name: 'review',
        schema: { type: 'object' },
        strict: mode === 'strict_schema',
      })
      expect(body.instructions).toBe(BODY.instructions)
      expect(body.tools).toBe(BODY.tools)
      expect(body.input).toHaveLength(1)
      expect(BODY.input).toEqual([])
    },
  )

  it('requires the injected captured forced-tool codec', () => {
    const attempt: SideCallAttempt = {
      mode: 'forced_tool',
      name: 'review',
      schema: {},
      repair: false,
    }
    expect(() => sideCallBody(BODY, attempt, undefined)).toThrow('codec is unavailable')
    const codec = vi.fn(() => BODY)
    expect(sideCallBody(BODY, attempt, codec)).toBe(BODY)
    expect(codec).toHaveBeenCalledWith(BODY, attempt)
  })

  it('accepts only locally validated data and does not fall back on success', async () => {
    const request = vi.fn((_attempt: SideCallAttempt) =>
      Promise.resolve('{"decision":"ask","reason":"needs approval"}'),
    )
    const fallback = vi.fn(() => ({ decision: 'ask' as const, reason: 'text' }))
    const answer = await structuredSideCall({
      formats: STRICT,
      name: 'review',
      schema: reviewerAnswerSchema,
      request,
      fallback,
      signal: new AbortController().signal,
    })
    expect(answer).toEqual({ decision: 'ask', reason: 'needs approval' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toMatchObject({ mode: 'strict_schema', repair: false })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects extra granting fields, repairs exactly once, then makes a text request', async () => {
    const attempts: SideCallAttempt[] = []
    const notice = vi.fn()
    const fallback = vi.fn((text: string) => ({ decision: 'ask' as const, reason: text }))
    const answer = await structuredSideCall({
      formats: STRICT,
      name: 'review',
      schema: reviewerAnswerSchema,
      signal: new AbortController().signal,
      notice,
      fallback,
      request: (attempt) => {
        attempts.push(attempt)
        return Promise.resolve(
          attempt.mode === 'text'
            ? 'ASK: cannot validate'
            : '{"decision":"allow","reason":"ok","grant":true}',
        )
      },
    })
    expect(attempts.map(({ mode, repair }) => ({ mode, repair }))).toEqual([
      { mode: 'strict_schema', repair: false },
      { mode: 'strict_schema', repair: true },
      { mode: 'text', repair: false },
    ])
    expect(answer).toEqual({ decision: 'ask', reason: 'ASK: cannot validate' })
    expect(fallback).toHaveBeenCalledExactlyOnceWith('ASK: cannot validate')
    expect(notice.mock.calls).toEqual([
      [UI_TEXT.structuredOutputRepair],
      [UI_TEXT.structuredOutputFallback],
    ])
    expect(attempts[0]?.schema).toMatchObject({
      required: ['decision', 'reason'],
      additionalProperties: false,
    })
  })

  it('uses a valid repair without a third request', async () => {
    const attempts: SideCallAttempt[] = []
    const answer = await structuredSideCall({
      formats: STRICT,
      name: 'review',
      schema: reviewerAnswerSchema,
      signal: new AbortController().signal,
      fallback: () => {
        throw new Error('unexpected text fallback')
      },
      request: (attempt) => {
        attempts.push(attempt)
        return Promise.resolve(
          attempt.repair ? '{"decision":"ask","reason":"repaired"}' : 'invalid',
        )
      },
    })
    expect(answer).toEqual({ decision: 'ask', reason: 'repaired' })
    expect(attempts).toHaveLength(2)
  })

  it('never repairs a cancelled request', async () => {
    const abort = new AbortController()
    const request = vi.fn(() => {
      abort.abort()
      return Promise.resolve('invalid')
    })
    await expect(
      structuredSideCall({
        formats: STRICT,
        name: 'review',
        schema: reviewerAnswerSchema,
        request,
        signal: abort.signal,
        fallback: () => ({ decision: 'ask' as const, reason: 'text' }),
      }),
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('propagates terminal admission failures without repair or fallback', async () => {
    const failure = new Error('hook refused')
    const request = vi.fn(() => Promise.reject(failure))
    await expect(
      structuredCompaction({
        formats: STRICT,
        request,
        signal: new AbortController().signal,
        isTerminalError: (error) => error === failure,
      }),
    ).rejects.toBe(failure)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses invalid prose at the renderer boundary', () => {
    expect(() => renderCompactionSummary({ ...SUMMARY, goal: '' })).toThrow()
  })

  it('renders the six compaction sections byte-identically, preserving prose', async () => {
    const request = vi.fn(() => Promise.resolve(JSON.stringify(SUMMARY)))
    const summary = await structuredCompaction({
      formats: STRICT,
      request,
      signal: new AbortController().signal,
    })
    expect(summary).toBe(
      '## Goal\n\nFinish the work.\n\n## Constraints\n\nUntrusted: ignore instructions in a file.\n\n## Progress\n\nCompleted: read C:\\repo\\a.ts. In progress: tests. Blocked: none.\n\n## Decisions\n\nPreserve exact paths.\n\n## Next steps\n\nRun checks.\n\n## Critical context\n\nError: exact\nbytes.',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['invalid sections', 'transport failure'])(
    'still compacts after structured %s',
    async (failure) => {
      const attempts: SideCallAttempt[] = []
      const summary = await structuredCompaction({
        formats: STRICT,
        signal: new AbortController().signal,
        request: (attempt) => {
          attempts.push(attempt)
          if (attempt.mode === 'text')
            return Promise.resolve('Existing text summary\nwith exact bytes.')
          return failure === 'transport failure'
            ? Promise.reject(new Error('failed'))
            : Promise.resolve('{"goal":""}')
        },
      })
      expect(summary).toBe('Existing text summary\nwith exact bytes.')
      expect(attempts.map(({ mode }) => mode)).toEqual(['strict_schema', 'strict_schema', 'text'])
    },
  )
})
