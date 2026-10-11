import { describe, expect, it } from 'vitest'
import {
  postModelCallFields,
  preModelCallFields,
} from '../../src/core/backends/modelapi/modelCallHooks'
import { responseSchema, type CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  HOOK_MODEL_CONTENT_PARTS_MAX,
  HOOK_MODEL_MESSAGE_SUMMARIES_MAX,
  HOOK_MODEL_TEXT_PREVIEW_CHARS,
  HOOK_MODEL_TOOL_SUMMARIES_MAX,
  HOOK_STDIN_MAX_BYTES,
} from '../../src/shared/constants'

const body: CreateResponseBody = {
  model: 'muse-spark-1.3',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'Hello' },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,private-image-bytes',
          detail: 'auto',
        },
      ],
    },
    { type: 'function_call_output', call_id: 'old', output: 'Tool result' },
  ],
  instructions: 'Workspace instructions',
  tools: [
    {
      type: 'function',
      name: 'read_file',
      description: 'Read a file',
      parameters: {},
      strict: false,
    },
    { type: 'web_search' },
  ],
  tool_choice: 'auto',
  reasoning: { effort: 'minimal', summary: 'auto' },
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  max_output_tokens: 100,
  prompt_cache_key: 'session-1',
  prompt_cache_retention: 'in_memory',
}

describe('captured Model API hook summaries (M51)', () => {
  it('identifies the configured BYO provider and qualified model in both call hooks', () => {
    const byo = { ...body, model: 'custom-team/author/model' }
    const response = responseSchema.parse({ id: 'response-byo', status: 'completed', output: [] })
    for (const fields of [
      preModelCallFields(byo, 'request', 1, 0),
      postModelCallFields(byo, response, 'request', 1, 0, 'session'),
    ]) {
      expect(fields).toMatchObject({ provider: 'custom-team', model: byo.model })
      expect(fields['options']).toMatchObject({ 'custom-team.reasoning.effort': 'minimal' })
      expect(JSON.stringify(fields['options'])).not.toContain('meta.')
    }
  })

  it('uses the captured PreLLMCall keys and never passes media bytes or full tool output', () => {
    const pre = preModelCallFields(body, 'request-1', 1, 0)
    expect(pre).toMatchObject({
      provider: 'meta',
      request_id: 'request-1',
      attempt: 1,
      step: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      message_count: 1,
      tools: [
        { name: 'read_file', description: 'Read a file', has_parameters: true, strict: false },
        { name: 'web_search', description: '', has_parameters: false, strict: false },
      ],
      tool_count: 2,
      options: { 'meta.reasoning.effort': 'minimal' },
    })
    expect(JSON.stringify(pre)).not.toContain('private-image-bytes')
    expect(JSON.stringify(pre)).not.toContain('Tool result')
  })

  it('uses the captured successful PostLLMCall keys and bounded text previews', () => {
    const response = responseSchema.parse({
      id: 'response-1',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Reply' }] },
        { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{}' },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    })
    expect(postModelCallFields(body, response, 'request-1', 1, 0, 'session-1')).toMatchObject({
      provider: 'meta',
      request_id: 'request-1',
      attempt: 1,
      step: 0,
      status: 'success',
      response_id: 'response-1',
      finish_reason: null,
      error: null,
      usage: { input_tokens: 12, output_tokens: 4, cached_tokens: 3, reasoning_tokens: 2 },
      output_text_preview: 'Reply',
      tool_call_count: 1,
      messages: [
        { role: 'developer', content: [{ type: 'text', text: 'Workspace instructions' }] },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
      message_count: 2,
      tool_count: 2,
      options: { 'meta.reasoning.effort': 'minimal', 'meta.session_id': 'session-1' },
    })
    const longBody: CreateResponseBody = {
      ...body,
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x'.repeat(300) }] },
      ],
    }
    const long = preModelCallFields(longBody, 'request-2', 1, 0)
    expect(long).toMatchObject({
      messages: [{ content: [{ text: 'x'.repeat(HOOK_MODEL_TEXT_PREVIEW_CHARS) }] }],
    })
  })

  it('omits pasted media URLs from every model-call hook text preview', () => {
    const media = `data:image/png;base64,${'P'.repeat(400)}`
    const withPastedMedia: CreateResponseBody = {
      ...body,
      instructions: `Review ${media} carefully`,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `note ${media} tail` }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'read_file',
          description: `Read ${media} safely`,
          parameters: {},
          strict: false,
        },
      ],
    }
    const response = responseSchema.parse({
      id: 'response-media',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `Reply ${media} done` }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const pre = preModelCallFields(withPastedMedia, 'request-media', 1, 0)
    const post = postModelCallFields(withPastedMedia, response, 'request-media', 1, 0, 'session')
    expect(pre).toMatchObject({
      messages: [{ content: [{ text: 'note [media omitted] tail' }] }],
      tools: [{ description: 'Read [media omitted] safely' }],
    })
    expect(post).toMatchObject({
      messages: [
        { role: 'developer', content: [{ text: 'Review [media omitted] carefully' }] },
        { role: 'user', content: [{ text: 'note [media omitted] tail' }] },
      ],
      output_text_preview: 'Reply [media omitted] done',
    })
    expect(JSON.stringify({ pre, post })).not.toContain('data:image/png;base64,')
    expect(withPastedMedia.instructions).toContain(media)
  })

  it('keeps worst-case Unicode summaries below the hook stdin cap', () => {
    const many: CreateResponseBody = {
      ...body,
      instructions: '🙂'.repeat(1000),
      input: Array.from({ length: HOOK_MODEL_MESSAGE_SUMMARIES_MAX }, () => ({
        type: 'message',
        role: 'user',
        content: Array.from({ length: HOOK_MODEL_CONTENT_PARTS_MAX }, () => ({
          type: 'input_text',
          text: '🙂'.repeat(300),
        })),
      })),
      tools: Array.from({ length: HOOK_MODEL_TOOL_SUMMARIES_MAX }, (_, index) => ({
        type: 'function',
        name: `tool_${String(index)}`,
        description: '🙂'.repeat(600),
        parameters: {},
        strict: false,
      })),
    }
    const response = responseSchema.parse({
      id: 'response-many',
      status: 'completed',
      output: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const pre = preModelCallFields(many, 'request-many', 1, 0)
    const post = postModelCallFields(many, response, 'request-many', 1, 0, 'session-many')
    expect(Buffer.byteLength(JSON.stringify(pre))).toBeLessThan(HOOK_STDIN_MAX_BYTES)
    expect(Buffer.byteLength(JSON.stringify(post))).toBeLessThan(HOOK_STDIN_MAX_BYTES)
  })
})
