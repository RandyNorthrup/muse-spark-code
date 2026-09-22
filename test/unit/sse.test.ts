import { describe, expect, it } from 'vitest'
import { parseSse } from '../../src/core/backends/modelapi/sse'

const encoder = new TextEncoder()

/** The parts as one byte stream, one chunk each (a ReadableStream is async-iterable). */
function stream(...parts: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }
      controller.close()
    },
  })
}

function text(...parts: readonly string[]): ReadableStream<Uint8Array> {
  return stream(...parts.map((part) => encoder.encode(part)))
}

describe('parseSse', () => {
  it('yields one event per blank-line block, with the event name and joined data', async () => {
    const events = await Array.fromAsync(
      parseSse(
        text('event: response.created\ndata: {"a":1}\n\n', 'data: line one\ndata: line two\n\n'),
      ),
    )
    expect(events).toEqual([
      { event: 'response.created', data: '{"a":1}' },
      { event: undefined, data: 'line one\nline two' },
    ])
  })

  it('buffers across chunk boundaries, including a split inside a multi-byte character', async () => {
    const bytes = encoder.encode('data: {"delta":"héllo wörld"}\n\ndata: second\n\n')
    // Cut inside "é" (two UTF-8 bytes) and again mid-frame.
    const events = await Array.fromAsync(
      parseSse(stream(bytes.subarray(0, 16), bytes.subarray(16, 40), bytes.subarray(40))),
    )
    expect(events).toEqual([
      { event: undefined, data: '{"delta":"héllo wörld"}' },
      { event: undefined, data: 'second' },
    ])
  })

  it('accepts CRLF and CR line breaks, comments, and fields without a space', async () => {
    const events = await Array.fromAsync(
      parseSse(text(':keepalive\r\nevent:x\r\ndata:1\r\n\r\ndata: 2\r\r')),
    )
    expect(events).toEqual([
      { event: 'x', data: '1' },
      { event: undefined, data: '2' },
    ])
  })

  it('delivers a final block that has no trailing blank line', async () => {
    expect(await Array.fromAsync(parseSse(text('data: tail')))).toEqual([
      { event: undefined, data: 'tail' },
    ])
  })

  it('ignores blank lines and unknown fields between events', async () => {
    expect(await Array.fromAsync(parseSse(text('\n\nid: 7\nretry: 100\n\ndata: x\n\n')))).toEqual([
      { event: undefined, data: 'x' },
    ])
  })
})
