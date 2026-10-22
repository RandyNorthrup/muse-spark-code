// EXECPROV round 7: the counting capability lives in data (per
// preset/format), never in a format `if` at a call site. Each test fails
// without its row: the preset override, the format default, the
// off-switch, and the per-kind request build and answer parse.
import { describe, expect, it } from 'vitest'
import { presetById } from '../../src/core/providers/presets'
import {
  buildExactCountRequest,
  exactCountKindFor,
  parseExactCountResponse,
} from '../../src/core/providers/tokenCount'

function preset(id: string) {
  const found = presetById(id)
  if (found === undefined) throw new Error(`missing preset ${id}`)
  return found
}

describe('exact-count capability in data', () => {
  it('opts in per preset where only some providers of a format document one', () => {
    expect(exactCountKindFor({}, preset('openai'))).toBe('responses-input-tokens')
    // xAI and Azure share the Responses format and document no counting
    // call for the exact request: the byte bound stays on their wires.
    expect(exactCountKindFor({}, preset('xai'))).toBeUndefined()
    expect(exactCountKindFor({}, preset('azure'))).toBeUndefined()
  })

  it('defaults per format where the wire documents one', () => {
    expect(exactCountKindFor({}, preset('anthropic'))).toBe('anthropic-count-tokens')
    expect(exactCountKindFor({}, preset('gemini'))).toBeUndefined()
    expect(exactCountKindFor({}, preset('custom'))).toBeUndefined()
    expect(exactCountKindFor({}, preset('ollama'))).toBeUndefined()
  })

  it('the entry switch turns every wire back to the byte bound', () => {
    expect(exactCountKindFor({ exactInputCount: false }, preset('openai'))).toBeUndefined()
    expect(exactCountKindFor({ exactInputCount: false }, preset('anthropic'))).toBeUndefined()
    expect(exactCountKindFor({ exactInputCount: false }, preset('gemini'))).toBeUndefined()
    expect(exactCountKindFor({ exactInputCount: true }, preset('openai'))).toBe(
      'responses-input-tokens',
    )
  })
})

describe('exact-count request build', () => {
  it('sends the same responses body to the input_tokens sibling', () => {
    const body = { model: 'gpt-x', input: [{ type: 'message' }] }
    expect(
      buildExactCountRequest('responses-input-tokens', {
        path: '/v1/responses',
        body,
      }),
    ).toEqual({ path: '/v1/responses/input_tokens', body })
    expect(
      buildExactCountRequest('responses-input-tokens', { path: '/v1/messages', body }),
    ).toBeUndefined()
  })

  it('drops only the non-input fields from the anthropic body', () => {
    const built = buildExactCountRequest('anthropic-count-tokens', {
      path: '/v1/messages',
      body: {
        model: 'claude-x',
        max_tokens: 64,
        system: [{ type: 'text', text: 'hi' }],
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
        metadata: { user_id: 'u' },
        thinking: { type: 'adaptive' },
      },
      headers: { 'anthropic-version': '2023-06-01' },
    })
    expect(built?.path).toBe('/v1/messages/count_tokens')
    expect(built?.body).toEqual({
      model: 'claude-x',
      system: [{ type: 'text', text: 'hi' }],
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
    })
    expect(
      buildExactCountRequest('anthropic-count-tokens', { path: '/v1/responses', body: {} }),
    ).toBeUndefined()
    expect(
      buildExactCountRequest('anthropic-count-tokens', { path: '/v1/messages', body: null }),
    ).toBeUndefined()
  })

  it('drops manual thinking: the count endpoint documents budget_tokens as requiring max_tokens, which it does not accept', () => {
    const built = buildExactCountRequest('anthropic-count-tokens', {
      path: '/v1/messages',
      body: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        stream: true,
        metadata: { user_id: 'u' },
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
      headers: {},
    })
    expect(built?.path).toBe('/v1/messages/count_tokens')
    expect(built?.body).not.toHaveProperty('thinking')
    expect(built?.body).not.toHaveProperty('max_tokens')
    expect(built?.body).toHaveProperty('model', 'claude-haiku-4-5-20251001')
  })

  it('keeps output_config beside adaptive thinking, both documented without max_tokens', () => {
    const built = buildExactCountRequest('anthropic-count-tokens', {
      path: '/v1/messages',
      body: {
        model: 'claude-sonnet-5-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      },
      headers: {},
    })
    expect(built?.body).toHaveProperty('thinking', { type: 'adaptive' })
    expect(built?.body).toHaveProperty('output_config', { effort: 'high' })
  })
})

describe('exact-count answer parse', () => {
  it('reads each wire’s documented count field', () => {
    expect(parseExactCountResponse('responses-input-tokens', { input_tokens: 7 })).toBe(7)
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: 7 })).toBe(7)
  })

  it('rejects every non-count body without throwing', () => {
    expect(parseExactCountResponse('responses-input-tokens', {})).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: -1 })).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: 1.5 })).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { totalTokens: 1 })).toBeUndefined()
    expect(parseExactCountResponse('responses-input-tokens', 'seven')).toBeUndefined()
    expect(parseExactCountResponse('responses-input-tokens', null)).toBeUndefined()
  })
})
