import {
  DEFAULT_MAX_MESSAGE_BYTES,
  MessageTooLargeError,
  ndJsonStream,
} from '@agentclientprotocol/sdk'
import { ReadableStream, WritableStream } from 'node:stream/web'
import { TextEncoder } from 'node:util'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()
const message = { jsonrpc: '2.0', id: 1, result: { text: 'é' } }
const payload = encoder.encode(JSON.stringify(message))

function input(chunks, onCancel, shouldClose = true) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      if (shouldClose) controller.close()
    },
    cancel: onCancel,
  })
}

describe('ACP SDK transport bounds used by the runtime', () => {
  it.each(['\n', '\r\n'])(
    'accepts exactly the byte cap with %j framing and split UTF-8',
    async (end) => {
      const split = payload.indexOf(0xc3) + 1
      const stream = ndJsonStream(
        new WritableStream(),
        input([payload.subarray(0, split), payload.subarray(split), encoder.encode(end)]),
        { maxMessageBytes: payload.byteLength },
      )
      const reader = stream.readable.getReader()
      try {
        expect(await reader.read()).toEqual({ value: message, done: false })
        expect(await reader.read()).toEqual({ value: undefined, done: true })
      } finally {
        reader.releaseLock()
      }
    },
  )

  it.each([false, true])(
    'refuses an oversized %s-split line and cancels upstream',
    async (split) => {
      const cancellations = []
      const line = encoder.encode(JSON.stringify(message) + '\n')
      const chunks = split ? [line.subarray(0, 1), line.subarray(1)] : [line]
      const stream = ndJsonStream(
        new WritableStream(),
        input(
          chunks,
          (reason) => {
            cancellations.push(reason)
          },
          false,
        ),
        { maxMessageBytes: payload.byteLength - 1 },
      )
      const reader = stream.readable.getReader()
      try {
        await expect(reader.read()).rejects.toBeInstanceOf(MessageTooLargeError)
        expect(cancellations).toHaveLength(1)
        expect(cancellations[0]).toMatchObject({
          name: 'MessageTooLargeError',
          maxMessageBytes: payload.byteLength - 1,
        })
      } finally {
        reader.releaseLock()
      }
    },
  )

  it('bounds the option-free stream factory used by the runtime', async () => {
    expect(DEFAULT_MAX_MESSAGE_BYTES).toBe(32 * 1024 * 1024)
    const stream = ndJsonStream(
      new WritableStream(),
      input([new Uint8Array(DEFAULT_MAX_MESSAGE_BYTES + 1).fill(0x20)]),
    )
    const reader = stream.readable.getReader()
    try {
      await expect(reader.read()).rejects.toMatchObject({
        name: 'MessageTooLargeError',
        maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES,
      })
    } finally {
      reader.releaseLock()
    }
  })
})
