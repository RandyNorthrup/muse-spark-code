// M95c part 3: OpenAI's explicit prompt-cache breakpoints. The request
// shape is the one OpenAI documents: `prompt_cache_breakpoint:
// {"mode": "explicit"}` on a message's `input_text` / `input_image` /
// `input_file` part or a `function_call_output` part, never on top-level
// `instructions`, on GPT-5.6 and later only; implicit mode stays (no
// `prompt_cache_options.mode`), which leaves three explicit slots
// (developers.openai.com/api/docs/guides/prompt-caching and
// developers.openai.com/api/reference/resources/responses/methods/create,
// read 2026-10-23). The whole-request tests ride the real configured
// request builder and the real pinned transport to a real local socket
// that records the request and closes unanswered (helpers/providerWire.ts):
// a Responses-API server entry, since OpenAI's own preset is pinned to its
// public origin; the codec, its gate and the marker are the same.
import { describe, expect, it } from 'vitest'
import {
  createResponsesCodec,
  markCacheBreakpoints,
} from '../../src/core/backends/modelapi/codecs/responses'
import type { CreateResponseBody, InputItem } from '../../src/core/backends/modelapi/schemas'
import { restoredToolText } from '../../src/core/backends/modelapi/schemas'
import { makeTurnBody } from './helpers/turnBodies'
import {
  responsesEntryAt,
  storedKey,
  suiteSocket,
  turnRequest,
  wireServices,
  type WireRequest,
} from './helpers/providerWire'

const BREAKPOINT = { mode: 'explicit' }
const opened = suiteSocket()
const entryAt = (origin: string) => responsesEntryAt(origin, ['gpt-6.1-sol', 'gpt-5.5'])

/** A tool loop: the first ask, a call, its array result, an answer, the next ask, goal progress. */
function loopInput(): InputItem[] {
  return [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the typo.' }] },
    {
      type: 'function_call',
      call_id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    },
    {
      type: 'function_call_output',
      call_id: 'call_1',
      output: [{ type: 'input_text', text: 'A typo.' }],
    },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Fixed.' }],
    },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now the docs.' }] },
    {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Goal progress: 1 of 2.' }],
    },
  ]
}

function body(model: string, input: InputItem[]): CreateResponseBody {
  return makeTurnBody({
    model,
    input,
    instructions: 'You are a coding agent.',
    toolName: 'read_file',
    effort: 'medium',
    include: ['reasoning.encrypted_content'],
    maxOutputTokens: 8192,
    promptCacheKey: 'prefix-1',
  })
}

/** The request's `input` array, checked rather than assumed. */
function inputOf(wire: unknown): readonly unknown[] {
  if (typeof wire !== 'object' || wire === null || !('input' in wire) || !Array.isArray(wire.input))
    throw new TypeError('Expected a Responses request with an input array')
  return wire.input
}

async function sent(model: string, input: InputItem[], isOn: boolean): Promise<WireRequest> {
  const socket = await opened
  const services = wireServices(
    [entryAt(socket.origin)],
    { 'museSpark.provider.openai': storedKey(socket.origin, 'test-openai-key') },
    { promptCacheBreakpoints: () => isOn },
  )
  return await turnRequest(services, socket, `openai/${model}`, body(`openai/${model}`, input))
}

describe('OpenAI explicit cache breakpoints through the real request builder', () => {
  it('marks the stable prefix and the rolling end, never the goal suffix (GPT-6.1)', async () => {
    const request = await sent('gpt-6.1-sol', loopInput(), true)
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/v1/responses')
    expect(request.headers['authorization']).toBe('Bearer test-openai-key')
    // The golden: the documented marker on the first ask (the stable
    // prefix: instructions, tools and that message) and on the latest
    // ask; the trailing developer message is request-only progress and
    // stays unmarked, as do the call, its result in between and the
    // assistant's `output_text`.
    expect(request.body).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'You are a coding agent.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Fix the typo.', prompt_cache_breakpoint: BREAKPOINT },
          ],
        },
        { type: 'function_call', call_id: 'call_1' },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: [{ type: 'input_text', text: 'A typo.' }],
        },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed.' }] },
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Now the docs.', prompt_cache_breakpoint: BREAKPOINT },
          ],
        },
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Goal progress: 1 of 2.' }],
        },
      ],
    })
    const text = JSON.stringify(request.body)
    expect(text.split('prompt_cache_breakpoint').length - 1).toBe(2)
    // Implicit mode stays: no mode switch rides, so the implicit
    // breakpoint is kept beside the explicit ones.
    expect(request.body).not.toHaveProperty('prompt_cache_options')
  })

  it('sends nothing new when the setting is off, or on a model before GPT-5.6', async () => {
    const off = await sent('gpt-6.1-sol', loopInput(), false)
    expect(JSON.stringify(off.body)).not.toContain('prompt_cache_breakpoint')
    // GPT-5.5 takes no explicit breakpoints (the guide's table); the
    // choice stays home rather than risk a refused request.
    const early = await sent('gpt-5.5', loopInput(), true)
    expect(JSON.stringify(early.body)).not.toContain('prompt_cache_breakpoint')
    // Apart from the markers the two requests carry the same input.
    const on = await sent('gpt-6.1-sol', loopInput(), true)
    expect(
      JSON.stringify(on.body).replaceAll(',"prompt_cache_breakpoint":{"mode":"explicit"}', ''),
    ).toBe(JSON.stringify(off.body))
  })

  it('keeps every byte before the rolling marker stable as the turn grows (prefix)', async () => {
    const first = await sent('gpt-6.1-sol', loopInput().slice(0, 3), true)
    const second = await sent('gpt-6.1-sol', loopInput(), true)
    const firstInput = inputOf(first.body)
    const secondInput = inputOf(second.body)
    // The stable marker sits on the same first item, byte for byte.
    expect(JSON.stringify(secondInput[0])).toBe(JSON.stringify(firstInput[0]))
    // The first request's rolling marker rode its tool result; on the next
    // turn it moved to the newest ask and the result went back unmarked.
    expect(firstInput[2]).toMatchObject({
      output: [{ type: 'input_text', text: 'A typo.', prompt_cache_breakpoint: BREAKPOINT }],
    })
    expect(JSON.stringify(secondInput[2])).not.toContain('prompt_cache_breakpoint')
  })
})

describe('markCacheBreakpoints', () => {
  it('marks a lone markable item once and leaves string tool results unmarked', () => {
    const input: InputItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi.' }] },
      {
        type: 'function_call',
        call_id: 'call_2',
        name: 'read_file',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call_2', output: restoredToolText('text') },
    ]
    const marked = markCacheBreakpoints(input)
    expect(JSON.stringify(marked).split('prompt_cache_breakpoint').length - 1).toBe(1)
    expect(marked[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hi.', prompt_cache_breakpoint: BREAKPOINT }],
    })
    // The input itself is never touched: history keeps no marker.
    expect(JSON.stringify(input)).not.toContain('prompt_cache_breakpoint')
  })

  it('marks the last markable part of an item, an image included, never blank text', () => {
    const marked = markCacheBreakpoints([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
          { type: 'input_text', text: '' },
        ],
      },
    ])
    expect(marked[0]).toMatchObject({
      content: [
        { type: 'input_image', prompt_cache_breakpoint: BREAKPOINT },
        { type: 'input_text', text: '' },
      ],
    })
  })

  it('never rides the ChatGPT plan profile', () => {
    const plan = createResponsesCodec({
      profile: 'chatgpt',
      toolNamespace: 'functions',
      toolNamespaceDescription: 'test',
    })
    const wire = plan.encodeRequest(
      { ...body('gpt-6.1-sol', loopInput()), tools: [] },
      { cacheBreakpoints: true },
    )
    expect(JSON.stringify(wire)).not.toContain('prompt_cache_breakpoint')
  })
})
