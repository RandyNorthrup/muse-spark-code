import { describe, expect, it, vi } from 'vitest'
import { parseNdjson } from '../../src/core/backends/modelapi/ndjson'

function source(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(new TextEncoder().encode(part))
      }
      controller.close()
    },
  })
}

describe('parseNdjson', () => {
  it('reads split JSON, CRLF, blanks and an unterminated final frame', async () => {
    expect(await Array.fromAsync(parseNdjson(source('\n{"a":', '1}\r\n\n', '{"b":2}')))).toEqual([
      { a: 1 },
      { b: 2 },
    ])
  })
  it('preserves a UTF-8 character split between bytes', async () => {
    const bytes = new TextEncoder().encode('{"text":"é"}\n')
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) {
          controller.enqueue(new Uint8Array([byte]))
        }
        controller.close()
      },
    })
    expect(await Array.fromAsync(parseNdjson(chunks))).toEqual([{ text: 'é' }])
  })
  it.each([
    ['frame_limit', '{"a":"éééé"}', { frameBytes: 10 }],
    ['frame_limit', ' '.repeat(20) + '\n', { frameBytes: 10 }],
    ['stream_limit', '\n'.repeat(4), { totalBytes: 2 }],
    ['frame_count_limit', '{}\n{}\n', { frames: 1 }],
    ['malformed_ndjson', '{secret', {}],
  ])('rejects %s and never repeats raw frame text', async (reason, text, limits) => {
    await expect(Array.fromAsync(parseNdjson(source(text), limits))).rejects.toThrow(reason)
  })
  it('closes the source after parse failure and early return', async () => {
    for (const text of ['bad\n', '{}\n']) {
      const cancel = vi.fn()
      const chunks = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text))
        },
        cancel,
      })
      const frames = parseNdjson(chunks)
      if (text === 'bad\n') {
        await expect(frames.next()).rejects.toThrow('malformed_ndjson')
      } else {
        await frames.next()
        await frames.return(undefined)
      }
      expect(cancel).toHaveBeenCalledOnce()
      expect(chunks.locked).toBe(false)
    }
  })
})
