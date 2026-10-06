// Lane M98-S: the Model API side request (PLAN.md M98 acceptance item 1).
// The cached prefix is copied exactly with the question at the tail;
// redaction first (a changed prefix byte goes standalone); below the
// cacheable minimum goes standalone; the main body is never touched.

import { describe, expect, it } from 'vitest'
import { planSideRequest, redactedTail } from '../../src/core/judge/same/sideRequest'

const MAIN = {
  model: 'muse-spark-1.3-contributor',
  input: [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
  ],
  instructions: 'Be helpful.',
  tools: [{ type: 'function', name: 'read_file' }],
  tool_choice: 'auto' as const,
  reasoning: { effort: 'minimal', summary: 'auto' as const },
  stream: true as const,
  store: false as const,
  include: [],
  max_output_tokens: 8192,
  prompt_cache_key: 'muse-abc123',
  prompt_cache_retention: 'in-memory',
}

const TAIL = {
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text: 'Judge this.' }],
}
const unchanged = (text: string): string => text

describe('planSideRequest', () => {
  it('copies the prefix exactly and appends the tail when redaction changes nothing', () => {
    const planned = planSideRequest({
      mainBody: MAIN,
      tail: TAIL,
      redact: unchanged,
      prefixTokens: 4357,
      minPrefixTokens: 1024,
    })
    if (planned.mode !== 'shared-prefix') {
      throw new Error('expected a shared prefix')
    }
    expect(planned.body).not.toBe(MAIN)
    expect(planned.body.input).toHaveLength(MAIN.input.length + 1)
    expect(planned.body.input.slice(0, MAIN.input.length)).toEqual(MAIN.input)
    expect(planned.body.input.at(-1)).toEqual(TAIL)
    const { input: _dropped, ...rest } = planned.body
    const { input: _mainDropped, ...mainRest } = MAIN
    expect(rest).toEqual(mainRest)
  })

  it('leaves the main body untouched', () => {
    const before = structuredClone(MAIN)
    planSideRequest({
      mainBody: MAIN,
      tail: TAIL,
      redact: unchanged,
      prefixTokens: 5000,
      minPrefixTokens: 1024,
    })
    expect(MAIN).toEqual(before)
  })

  it('goes standalone when redaction changes a prefix byte', () => {
    const planned = planSideRequest({
      mainBody: MAIN,
      tail: TAIL,
      redact: (text) => text.replaceAll('hello', '[redacted]'),
      prefixTokens: 5000,
      minPrefixTokens: 1024,
    })
    expect(planned.mode).toBe('standalone')
  })

  it('goes standalone below the cacheable minimum', () => {
    const planned = planSideRequest({
      mainBody: MAIN,
      tail: TAIL,
      redact: unchanged,
      prefixTokens: 1023,
      minPrefixTokens: 1024,
    })
    expect(planned.mode).toBe('standalone')
  })

  it('shares at exactly the minimum', () => {
    const planned = planSideRequest({
      mainBody: MAIN,
      tail: TAIL,
      redact: unchanged,
      prefixTokens: 1024,
      minPrefixTokens: 1024,
    })
    expect(planned.mode).toBe('shared-prefix')
  })

  it('redacts the tail even on the shared-prefix path', () => {
    const secretTail = { text: 'password: hunter2' }
    const planned = planSideRequest({
      mainBody: MAIN,
      tail: secretTail,
      redact: (text) => text.replaceAll('hunter2', '[redacted]'),
      prefixTokens: 5000,
      minPrefixTokens: 1024,
    })
    if (planned.mode !== 'shared-prefix') {
      throw new Error('expected a shared prefix')
    }
    expect(JSON.stringify(planned.body.input.at(-1))).toContain('[redacted]')
    expect(JSON.stringify(planned.body.input.at(-1))).not.toContain('hunter2')
  })

  it('refuses a non-list input and a non-JSON body loudly', () => {
    const malformed = { ...MAIN }
    Reflect.set(malformed, 'input', 'nope')
    expect(() =>
      planSideRequest({
        mainBody: malformed,
        tail: TAIL,
        redact: unchanged,
        prefixTokens: 5000,
        minPrefixTokens: 1024,
      }),
    ).toThrow(TypeError)
    expect(() =>
      planSideRequest({
        mainBody: MAIN,
        tail: TAIL,
        redact: unchanged,
        prefixTokens: NaN,
        minPrefixTokens: 1024,
      }),
    ).toThrow(RangeError)
  })
})

describe('redactedTail', () => {
  it('is identity when redaction changes nothing', () => {
    expect(redactedTail(unchanged, TAIL)).toEqual(TAIL)
  })

  it('refuses a non-JSON tail', () => {
    expect(() => redactedTail(unchanged, undefined)).toThrow(TypeError)
  })
})
