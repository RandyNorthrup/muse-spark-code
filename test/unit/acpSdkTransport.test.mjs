import {
  DEFAULT_MAX_MESSAGE_BYTES,
  MessageTooLargeError,
  ndJsonStream,
} from '@agentclientprotocol/sdk'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ReadableStream, WritableStream } from 'node:stream/web'
import { fileURLToPath } from 'node:url'
import { TextEncoder } from 'node:util'
import { describe, expect, it } from 'vitest'
import { boundedAcpStream } from '../../src/shared/acpStream'
import {
  ACP_MAX_MESSAGE_BYTES,
  BASE64_INPUT_BLOCK_BYTES,
  BASE64_OUTPUT_BLOCK_CHARS,
  MAX_ENCODED_MEDIA_CHARS,
  MAX_IMAGE_BYTES,
} from '../../src/shared/constants'

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

  it('keeps the SDK default at 32 MiB, below a valid three-image prompt', async () => {
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

const NEAR_LIMIT_IMAGES = 3

describe('the product ACP stream bound', () => {
  it('fits three near-limit images inside the media budget the bound is built on', () => {
    const encodedChars =
      Math.ceil((MAX_IMAGE_BYTES - 1) / BASE64_INPUT_BLOCK_BYTES) * BASE64_OUTPUT_BLOCK_CHARS
    // Above the SDK's default line cap, so an option-free stream would drop it.
    expect(NEAR_LIMIT_IMAGES * encodedChars).toBeGreaterThan(DEFAULT_MAX_MESSAGE_BYTES)
    expect(NEAR_LIMIT_IMAGES * encodedChars).toBeLessThanOrEqual(MAX_ENCODED_MEDIA_CHARS)
    expect(ACP_MAX_MESSAGE_BYTES).toBeGreaterThan(MAX_ENCODED_MEDIA_CHARS)
  })

  it('reads a prompt line larger than the SDK default as one message', async () => {
    const image = {
      type: 'image',
      mimeType: 'image/png',
      data: 'A'.repeat(DEFAULT_MAX_MESSAGE_BYTES),
    }
    const prompt = {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/prompt',
      params: { sessionId: 's', prompt: [image] },
    }
    const line = encoder.encode(`${JSON.stringify(prompt)}\n`)
    expect(line.byteLength).toBeGreaterThan(DEFAULT_MAX_MESSAGE_BYTES)
    const reader = boundedAcpStream(
      ndJsonStream,
      new WritableStream(),
      input([line]),
    ).readable.getReader()
    try {
      const first = await reader.read()
      expect(first.done).toBe(false)
      expect(first.value.params.prompt[0].data).toHaveLength(DEFAULT_MAX_MESSAGE_BYTES)
    } finally {
      reader.releaseLock()
    }
  })

  it('still refuses a line past the product bound', async () => {
    const stream = boundedAcpStream(
      ndJsonStream,
      new WritableStream(),
      input([new Uint8Array(ACP_MAX_MESSAGE_BYTES + 1).fill(0x20)]),
    )
    const reader = stream.readable.getReader()
    try {
      await expect(reader.read()).rejects.toMatchObject({
        name: 'MessageTooLargeError',
        maxMessageBytes: ACP_MAX_MESSAGE_BYTES,
      })
    } finally {
      reader.releaseLock()
    }
  })

  it('is the only way production code opens an ACP NDJSON stream', () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url))
    const helper = path.join(src, 'shared', 'acpStream.ts')
    const callers = readdirSync(src, { recursive: true })
      .map((entry) => path.join(src, String(entry)))
      .filter((file) => /\.tsx?$/.test(file) && file !== helper)
      .filter((file) => /\bndJsonStream\s*\(/.test(readFileSync(file, 'utf8')))
    expect(callers).toEqual([])
  })
})
