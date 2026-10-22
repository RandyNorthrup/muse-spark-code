// OPENAI-G15 / GAPANTH-G16: one Files mechanism by the capability record.
// Pure: real modules only, whole request and reply bodies, no stand-ins.
import { describe, expect, it } from 'vitest'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { responsesMediaCodec } from '../../src/core/backends/modelapi/codecs/responses'
import {
  buildUploadPrefix,
  parseUploadReceipt,
  wireForFiles,
  type FilesWire,
} from '../../src/core/backends/modelapi/files'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  metaCapabilityRecord,
  resolveModelCapabilities,
} from '../../src/core/providers/capabilityRecord'
import { presetFilesEvidence } from '../../src/core/providers/modelMetadata'
import { projectMediaCapabilities } from '../../src/host/media/mediaProviders'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'

function recordFor(preset: string, nativeModel: string, format: 'responses' | 'anthropic') {
  return resolveModelCapabilities(
    { provider: preset, nativeModel, format },
    presetFilesEvidence(preset),
  )
}

describe('provider files mechanism', () => {
  it('selects the upload dialect from the record, and stays off without evidence', () => {
    expect(wireForFiles(metaCapabilityRecord('muse-spark-1.3'))).toBe('meta-files')
    expect(wireForFiles(recordFor('openai', 'gpt-4.1', 'responses'))).toBe('openai-files')
    expect(wireForFiles(recordFor('xai', 'grok-4', 'responses'))).toBe('openai-files')
    expect(wireForFiles(recordFor('anthropic', 'claude-sonnet-5-5', 'anthropic'))).toBe(
      'anthropic-files',
    )
    expect(
      wireForFiles(
        resolveModelCapabilities({ provider: 'custom', nativeModel: 'm', format: 'chat' }),
      ),
    ).toBeUndefined()
  })

  it('lets a user override refuse uploads', () => {
    const record = resolveModelCapabilities(
      { provider: 'openai', nativeModel: 'gpt-4.1', format: 'responses' },
      [
        ...presetFilesEvidence('openai'),
        {
          source: { kind: 'user' as const, ref: 'test' },
          fields: { files: { upload: { state: 'no' as const } } },
        },
      ],
    )
    expect(wireForFiles(record)).toBeUndefined()
  })

  it.each([
    [
      'meta-files',
      '--b\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n' +
        '--b\r\nContent-Disposition: form-data; name="expires_after[anchor]"\r\n\r\ncreated_at\r\n' +
        '--b\r\nContent-Disposition: form-data; name="expires_after[seconds]"\r\n\r\n604800\r\n' +
        '--b\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    ],
    [
      'openai-files',
      '--b\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nassistants\r\n' +
        '--b\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n',
    ],
    [
      'anthropic-files',
      '--b\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n' +
        '--b\r\nContent-Disposition: form-data; name="expires_in_seconds"\r\n\r\n604800\r\n',
    ],
  ] as const)('builds the exact %s multipart head', (wire: FilesWire, expected: string) => {
    const prefix = buildUploadPrefix(wire, 'b', {
      name: 'doc.pdf',
      mime: 'application/pdf',
      expirySeconds: 604_800,
      purpose: 'assistants',
    })
    expect(new TextDecoder().decode(prefix)).toBe(expected)
  })

  it('refuses an OpenAI-dialect upload without a purpose', () => {
    expect(() =>
      buildUploadPrefix('openai-files', 'b', {
        name: 'doc.pdf',
        mime: 'application/pdf',
        expirySeconds: 604_800,
      }),
    ).toThrow('Invalid upload purpose')
  })

  it('parses each dialect receipt, and refuses a mismatched one', () => {
    expect(
      parseUploadReceipt(
        'meta-files',
        {
          id: 'file-1041857842215754',
          object: 'file',
          bytes: 12,
          created_at: 1_791_246_624,
          expires_at: 1_791_250_224,
          filename: 'doc.pdf',
          purpose: 'user_data',
          status: 'uploaded',
        },
        { bytes: 12, expirySeconds: 604_800 },
      ),
    ).toEqual({ fileId: 'file-1041857842215754', bytes: 12, expiresAt: 1_791_250_224 })
    expect(
      parseUploadReceipt(
        'openai-files',
        {
          id: 'file-abc123',
          object: 'file',
          bytes: 12,
          created_at: 1_791_246_624,
          filename: 'doc.pdf',
          purpose: 'assistants',
        },
        { bytes: 12, expirySeconds: 604_800 },
      ),
    ).toEqual({ fileId: 'file-abc123', bytes: 12 })
    expect(
      parseUploadReceipt(
        'anthropic-files',
        {
          id: 'file_011CNha8iCJcU1wXNR6q4V8w',
          type: 'file',
          filename: 'doc.pdf',
          mime_type: 'application/pdf',
          size_bytes: 12,
          created_at: '2026-10-01T00:00:00Z',
          downloadable: false,
          expires_at: '2026-10-08T00:00:00Z',
        },
        { bytes: 12, expirySeconds: 604_800 },
      ),
    ).toEqual({
      fileId: 'file_011CNha8iCJcU1wXNR6q4V8w',
      bytes: 12,
      expiresAt: Date.parse('2026-10-08T00:00:00Z') / 1000,
    })
    // A malformed shape fails parsing; a well-formed receipt with a wrong
    // size or a missing Meta expiry fails as an invalid receipt.
    expect(() =>
      parseUploadReceipt(
        'meta-files',
        { id: 'file-x', object: 'file' },
        { bytes: 1, expirySeconds: 60 },
      ),
    ).toThrow()
    expect(() =>
      parseUploadReceipt(
        'meta-files',
        {
          id: 'file-x',
          object: 'file',
          bytes: 1,
          created_at: 1_791_246_624,
          filename: 'doc.pdf',
          purpose: 'user_data',
          status: 'uploaded',
        },
        { bytes: 1, expirySeconds: 60 },
      ),
    ).toThrow('Invalid upload receipt')
    expect(() =>
      parseUploadReceipt(
        'openai-files',
        {
          id: 'file-abc123',
          object: 'file',
          bytes: 13,
          created_at: 1_791_246_624,
          filename: 'doc.pdf',
          purpose: 'assistants',
        },
        { bytes: 12, expirySeconds: 604_800 },
      ),
    ).toThrow('Invalid upload receipt')
  })
})

describe('responses file references', () => {
  const media = {
    name: 'doc.pdf',
    info: { kind: 'document', mediaType: 'application/pdf', sizeBytes: 12 },
    sha256: '0'.repeat(64),
    file: {
      fileId: 'file-abc123',
      provider: 'openai',
      sha256: '0'.repeat(64),
      bytes: 12,
      name: 'doc.pdf',
      mime: 'application/pdf',
    },
  } as const
  const model = projectMediaCapabilities('openai/gpt-4.1')

  it('encodes an upload as its file id, never bytes', () => {
    expect(responsesMediaCodec.encodeUploaded(media, model)).toEqual({
      type: 'input_file',
      file_id: 'file-abc123',
      filename: 'doc.pdf',
    })
    expect(
      responsesMediaCodec.encodeUploaded(
        {
          ...media,
          name: 'shot.png',
          info: { kind: 'image', mediaType: 'image/png', sizeBytes: 12 },
        },
        model,
      ),
    ).toEqual({ type: 'input_image', file_id: 'file-abc123', detail: 'auto' })
  })

  it('passes inline parts through with their size, and refuses a mismatch', () => {
    const inline = {
      type: 'input_file',
      filename: 'doc.pdf',
      file_data: 'data:application/pdf;base64,AAA',
    } as const
    expect(responsesMediaCodec.encodeInline(media, inline, model)).toEqual({
      part: inline,
      encodedChars: inline.file_data.length,
    })
    expect(() =>
      responsesMediaCodec.encodeInline(media, { type: 'input_text', text: 'x' }, model),
    ).toThrow('Responses codec: a document encodes inline only as file data')
  })

  it('names omissions honestly', () => {
    expect(responsesMediaCodec.omittedText(media, model, 'source')).toBe(
      '[The attachment doc.pdf is unavailable in this request; attach the file again to use it.]',
    )
    expect(responsesMediaCodec.omittedText(media, model, 'files')).toBe(
      '[Media is left out of this request because the selected model does not have established support for this media.]',
    )
    expect(responsesMediaCodec.metadataText(media)).toBe(
      'Media: doc.pdf (Duration unknown, 12 byte)',
    )
  })

  it('matches only a 404 that names the file', () => {
    const missing = new ModelApiError('No such file: file-abc123', 404, 'not_found', undefined)
    expect(responsesMediaCodec.isMissingFile(missing, ['file-abc123'])).toBe(true)
    expect(responsesMediaCodec.isMissingFile(missing, ['file-other'])).toBe(false)
    expect(
      responsesMediaCodec.isMissingFile(new ModelApiError('boom', 500, undefined, undefined), [
        'file-abc123',
      ]),
    ).toBe(false)
    expect(responsesMediaCodec.isMissingFile(new Error('nope'), ['file-abc123'])).toBe(false)
  })
})

/** Rolling cache markers excepted, like the codec's own tests. */
function messagesOf(native: { body: { messages: unknown } }): unknown {
  return JSON.parse(
    JSON.stringify(native.body.messages, (key, value: unknown) =>
      key === 'cache_control' ? undefined : value,
    ),
  )
}

function bodyWith(content: CreateResponseBody['input']): CreateResponseBody {
  return {
    model: 'anthropic/claude-sonnet-5-5',
    input: content,
    instructions: '',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'none', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 256,
    prompt_cache_key: 'test-key',
    prompt_cache_retention: 'in_memory',
  }
}

function imageFileMessage() {
  return {
    type: 'message' as const,
    role: 'user' as const,
    content: [
      {
        type: 'input_image' as const,
        file_id: 'file_011CPMxVD3fHLUhvTqtsQA5w',
        detail: 'auto' as const,
      },
    ],
  }
}

describe('anthropic file references', () => {
  it('sends a document file id as a file source, never bytes', () => {
    const native = encodeAnthropicRequest(
      bodyWith([
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Summarize this.' },
            { type: 'input_file', file_id: 'file_011CNha8iCJcU1wXNR6q4V8w' },
          ],
        },
      ]),
      { model: 'claude-sonnet-5-5', maxTokens: 256, effort: 'none' },
    )
    expect(messagesOf(native)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize this.' },
          { type: 'document', source: { type: 'file', file_id: 'file_011CNha8iCJcU1wXNR6q4V8w' } },
        ],
      },
    ])
  })

  it('sends an image file id as a file source, and a placeholder without vision', () => {
    const seeing = encodeAnthropicRequest(bodyWith([imageFileMessage()]), {
      model: 'claude-sonnet-5-5',
      maxTokens: 256,
      effort: 'none',
      capabilities: { vision: true },
    })
    expect(messagesOf(seeing)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'file', file_id: 'file_011CPMxVD3fHLUhvTqtsQA5w' } },
        ],
      },
    ])
    const blind = encodeAnthropicRequest(bodyWith([imageFileMessage()]), {
      model: 'claude-sonnet-5-5',
      maxTokens: 256,
      effort: 'none',
      capabilities: { vision: false },
    })
    expect(messagesOf(blind)).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: '[image omitted: this model takes no images]' }],
      },
    ])
  })
})

describe('budget with file references', () => {
  it('weighs no bytes for a reference and keeps it in the request', () => {
    const budget = new MediaBudget()
    const doc = { type: 'input_file', file_id: 'file-abc123' } as const
    // One media slot, weighed without bytes: no aggregate character budget.
    expect(budget.slotsUsed([doc])).toBe(1)
    const input = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }, doc] },
    ] as const
    const fitted = budget.fit(input)
    expect(fitted).toBe(input)
  })

  it('still counts referenced images against a documented per-request bound', () => {
    const record = resolveModelCapabilities(
      { provider: 'xai', nativeModel: 'grok-4', format: 'responses' },
      [
        {
          source: { kind: 'preset' as const, ref: 'test' },
          fields: {
            modalities: {
              image: {
                state: 'yes' as const,
                value: { mimes: ['image/png'], maxCount: 1 },
                source: { kind: 'preset' as const, ref: 'test' },
              },
            },
          },
        },
      ],
    )
    const budget = new MediaBudget()
    const first = { type: 'input_image', file_id: 'file-one', detail: 'auto' } as const
    const second = { type: 'input_image', file_id: 'file-two', detail: 'auto' } as const
    const input = [{ type: 'message', role: 'user', content: [first, second] }] as const
    const fitted = budget.fit(input, record)
    expect(fitted).not.toBe(input)
    expect(JSON.stringify(fitted)).toContain('[An image attached earlier is left out')
  })
})
