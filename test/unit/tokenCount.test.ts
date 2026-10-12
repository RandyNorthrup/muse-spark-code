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
    expect(exactCountKindFor({}, preset('gemini'))).toBe('gemini-count-tokens')
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

  it('drops the output cap and the stream query from the gemini request', () => {
    const built = buildExactCountRequest('gemini-count-tokens', {
      path: '/v1beta/models/gemini-x:streamGenerateContent?alt=sse',
      body: {
        contents: [{ parts: [{ text: 'hello' }] }],
        generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'low' } },
      },
    })
    expect(built?.path).toBe('/v1beta/models/gemini-x:countTokens')
    expect(built?.body).toEqual({
      contents: [{ parts: [{ text: 'hello' }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    })
    expect(
      buildExactCountRequest('gemini-count-tokens', {
        path: '/v1beta/models/gemini-x:generateContent',
        body: {},
      }),
    ).toBeUndefined()
  })
})

describe('exact-count answer parse', () => {
  it('reads each wire’s documented count field', () => {
    expect(parseExactCountResponse('responses-input-tokens', { input_tokens: 7 })).toBe(7)
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: 7 })).toBe(7)
    expect(parseExactCountResponse('gemini-count-tokens', { totalTokens: 7 })).toBe(7)
  })

  it('rejects every non-count body without throwing', () => {
    expect(parseExactCountResponse('responses-input-tokens', {})).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: -1 })).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { input_tokens: 1.5 })).toBeUndefined()
    expect(parseExactCountResponse('anthropic-count-tokens', { totalTokens: 1 })).toBeUndefined()
    expect(parseExactCountResponse('gemini-count-tokens', { input_tokens: 1 })).toBeUndefined()
    expect(parseExactCountResponse('gemini-count-tokens', null)).toBeUndefined()
  })
})
