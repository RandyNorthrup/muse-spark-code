import { describe, expect, it } from 'vitest'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MODEL_TEXT } from '../../src/shared/constants'
import { pdfFixture } from './helpers/pdfFixture'

describe('Model API replay media budget', () => {
  it('refuses overfull required media instead of fitting it as delivered history', () => {
    const required = Array.from(
      { length: 51 },
      () =>
        ({
          type: 'input_image',
          image_url: 'data:image/png;base64,AQ==',
          detail: 'auto',
        }) as const,
    )
    const input: readonly InputItem[] = [{ type: 'message', role: 'user', content: required }]
    expect(() => new MediaBudget().fit(input, undefined, required)).toThrow()
  })

  it.each(['slots', 'chars'])(
    'reserves %s for undelivered media before fitting later delivered history',
    (limit) => {
      const pending = {
        type: 'input_image',
        image_url: 'data:image/png;base64,AQ==',
        detail: 'auto',
      } as const
      const delivered = { ...pending, image_url: 'data:image/png;base64,AA==' }
      const input: readonly InputItem[] = [
        { type: 'message', role: 'user', content: [pending] },
        {
          type: 'message',
          role: 'user',
          content: Array.from({ length: limit === 'slots' ? 50 : 1 }, () => delivered),
        },
      ]
      const budget = new MediaBudget(limit === 'chars' ? pending.image_url.length : undefined)
      const fitted = budget.fit(input, undefined, [pending])
      expect(fitted[0]).toBe(input[0])
      expect(fitted[1]).toMatchObject({
        content: expect.arrayContaining([expect.objectContaining({ type: 'input_text' })]),
      })
      expect(budget.omitted).toBe(true)
    },
  )

  it('counts uploaded video in the shared 50-media budget while its bytes consume no inline budget', () => {
    const part = { type: 'input_text', text: 'test-upload:file-clip' } as const
    const budget = new MediaBudget(0)
    budget.noteMedia(
      part,
      {
        kind: 'video',
        mediaType: 'video/mp4',
        sizeBytes: 1_000_000,
        durationSeconds: 10,
        hasSoundtrack: false,
      },
      0,
      'clip.mp4 metadata',
    )
    const input: readonly InputItem[] = [
      { type: 'message', role: 'user', content: Array.from({ length: 51 }, () => part) },
    ]
    const fitted = budget.fit(input)
    expect(fitted).toMatchObject([
      {
        content: [
          { type: 'input_text', text: 'clip.mp4 metadata' },
          ...Array.from({ length: 50 }, () => part),
        ],
      },
    ])
    expect(() => {
      budget.assertMessageFits(Array.from({ length: 51 }, () => part))
    }).toThrow()
    expect(() => {
      budget.assertMessageFits(Array.from({ length: 50 }, () => part))
    }).not.toThrow()
  })

  it('weighs uploaded PDFs by known pages and reserves 50 slots when pages are unknown', () => {
    const known = { type: 'input_text', text: 'test-upload:file-pdf' } as const
    const unknown = { type: 'input_text', text: 'test-upload:file-opaque' } as const
    const video = { type: 'input_text', text: 'test-upload:file-video' } as const
    const budget = new MediaBudget()
    budget.noteMedia(
      known,
      { kind: 'document', mediaType: 'application/pdf', sizeBytes: 1, pageCount: 49 },
      0,
    )
    budget.noteMedia(unknown, { kind: 'document', mediaType: 'application/pdf', sizeBytes: 1 }, 0)
    budget.noteMedia(
      video,
      {
        kind: 'video',
        mediaType: 'video/mp4',
        sizeBytes: 1,
        durationSeconds: 1,
        hasSoundtrack: false,
      },
      0,
    )
    expect(() => {
      budget.assertMessageFits([known, video])
    }).not.toThrow()
    expect(() => {
      budget.assertMessageFits([unknown, video])
    }).toThrow()
  })
  it('keeps newer PDF pages and images, naming older media it leaves out', () => {
    const pdf = {
      type: 'input_file',
      filename: 'new.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from(pdfFixture(49)).toString('base64')}`,
    } as const
    const olderImage = {
      type: 'input_image',
      image_url: 'data:image/png;base64,AA==',
      detail: 'auto',
    } as const
    const newestImage = {
      type: 'input_image',
      image_url: 'data:image/png;base64,AQ==',
      detail: 'auto',
    } as const
    const input: readonly InputItem[] = [
      { type: 'message', role: 'user', content: [olderImage] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'seen' }] },
      { type: 'message', role: 'user', content: [pdf, newestImage] },
    ]
    const budget = new MediaBudget()
    expect(budget.fit(input)).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: MODEL_API_MODEL_TEXT.imageLeftOut }],
      },
      input[1],
      input[2],
    ])
    expect(input[0]).toEqual({ type: 'message', role: 'user', content: [olderImage] })
  })

  it('reserves the full image budget for a PDF whose page count is unknown', () => {
    const pdf = {
      type: 'input_file',
      filename: 'opaque.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}`,
    } as const
    const input: readonly InputItem[] = [
      { type: 'message', role: 'user', content: [pdf] },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' }],
      },
    ]
    const fitted = new MediaBudget().fit(input)
    expect(fitted[0]).toMatchObject({
      content: [{ type: 'input_text', text: expect.stringContaining('opaque.pdf') }],
    })
    expect(fitted[1]).toEqual(input[1])
  })

  it('leaves out a 50-page PDF when a newer image claims one slot, despite a nested count', () => {
    const pdf = {
      type: 'input_file',
      filename: 'nested.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from(pdfFixture(50, '/Custom << /Count 1 >>')).toString('base64')}`,
    } as const
    const image = {
      type: 'input_image',
      image_url: 'data:image/png;base64,AA==',
      detail: 'auto',
    } as const
    const input: readonly InputItem[] = [
      { type: 'message', role: 'user', content: [pdf] },
      { type: 'message', role: 'user', content: [image] },
    ]
    const fitted = new MediaBudget().fit(input)
    expect(fitted[0]).toMatchObject({
      content: [{ type: 'input_text', text: expect.stringContaining('nested.pdf') }],
    })
    expect(fitted[1]).toEqual(input[1])
  })

  it('keeps newest media within the encoded data URL cap and reports elision', () => {
    const oldImage = {
      type: 'input_image',
      image_url: 'data:image/png;base64,AAAA',
      detail: 'auto',
    } as const
    const newImage = {
      type: 'input_image',
      image_url: 'data:image/png;base64,AQ==',
      detail: 'auto',
    } as const
    const input: readonly InputItem[] = [
      { type: 'message', role: 'user', content: [oldImage] },
      { type: 'message', role: 'user', content: [newImage] },
    ]
    const budget = new MediaBudget(newImage.image_url.length)
    expect(budget.fit(input)).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: MODEL_API_MODEL_TEXT.imageLeftOut }],
      },
      input[1],
    ])
    expect(budget.omitted).toBe(true)
    expect(input[0]).toEqual({ type: 'message', role: 'user', content: [oldImage] })
    expect(budget.fit([input[1]!])).toEqual([input[1]])
    expect(budget.omitted).toBe(false)
  })

  it('counts an MCP tool-result image before an older 50-page PDF', () => {
    const input: readonly InputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: 'earlier.pdf',
            file_data: `data:application/pdf;base64,${Buffer.from(pdfFixture(50)).toString('base64')}`,
          },
        ],
      },
      {
        type: 'function_call_output',
        call_id: 'mcp-image',
        output: [
          { type: 'input_text', text: 'MCP returned a picture' },
          { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
        ],
      },
    ]
    const budget = new MediaBudget()
    expect(budget.fit(input)).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: expect.stringContaining('earlier.pdf') }],
      },
      input[1],
    ])
    expect(budget.omitted).toBe(true)
  })

  it('counts MCP output image bytes against a newer PDF request cap', () => {
    const pdfData = `data:application/pdf;base64,${Buffer.from(pdfFixture(1)).toString('base64')}`
    const input: readonly InputItem[] = [
      {
        type: 'function_call_output',
        call_id: 'mcp-older',
        output: [
          { type: 'input_text', text: 'old result' },
          { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' },
        ],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_file', filename: 'new.pdf', file_data: pdfData }],
      },
    ]
    const budget = new MediaBudget(pdfData.length)
    expect(budget.fit(input)).toEqual([
      {
        type: 'function_call_output',
        call_id: 'mcp-older',
        output: [
          { type: 'input_text', text: 'old result' },
          { type: 'input_text', text: MODEL_API_MODEL_TEXT.imageLeftOut },
        ],
      },
      input[1],
    ])
    expect(budget.omitted).toBe(true)
  })
})
