import {
  DEFAULT_MAX_MESSAGE_BYTES,
  MessageTooLargeError,
  ndJsonStream,
} from '@agentclientprotocol/sdk/unstable'
import * as stable from '@agentclientprotocol/sdk'
import * as unstable from '@agentclientprotocol/sdk/unstable'
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web'
import { TextEncoder } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { boundedAcpStream } from '../../src/shared/acpStream'
import {
  ACP_MAX_MESSAGE_BYTES,
  BASE64_INPUT_BLOCK_BYTES,
  BASE64_OUTPUT_BLOCK_CHARS,
  MAX_ENCODED_MEDIA_CHARS,
  META_IMAGE_MAX_BYTES,
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

describe('the product ACP stream bound', () => {
  it('fits one documented-size image inside the media budget the bound is built on (D121)', () => {
    const encodedChars =
      Math.ceil((META_IMAGE_MAX_BYTES - 1) / BASE64_INPUT_BLOCK_BYTES) * BASE64_OUTPUT_BLOCK_CHARS
    // Above the SDK's default line cap, so an option-free stream would drop it.
    expect(encodedChars).toBeGreaterThan(DEFAULT_MAX_MESSAGE_BYTES)
    expect(encodedChars).toBeLessThanOrEqual(MAX_ENCODED_MEDIA_CHARS)
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
})

// The loosened stable client against a newer agent (the 2.0 entrypoint
// split): an agent speaking full v1 emits a real unstable-only update
// (`plan_removed`, absent from the stable schema), and the stable client
// loosened exactly as production does (`execClient.ts`, `acpProcess.ts`:
// drop the constructor's strict session-update router) receives it on
// its loose boundary instead of failing the connection. Both ends are
// the real SDK over a real crossed NDJSON transport.
function loosenConstructorRouter(clientApp) {
  const builder = Reflect.get(clientApp, 'builder')
  if (typeof builder !== 'object' || builder === null) {
    throw new Error('The ACP client changed shape')
  }
  const handlers = Reflect.get(builder, 'handlers')
  if (!Array.isArray(handlers) || handlers.length !== 1) {
    throw new Error('The ACP client changed shape')
  }
  const router = handlers[0]
  if (
    typeof router !== 'object' ||
    router === null ||
    !('describe' in router) ||
    typeof router.describe !== 'function'
  ) {
    throw new Error('The ACP client changed shape')
  }
  if (Reflect.apply(router.describe, router, []) !== 'client-session-update-router') {
    throw new Error('The ACP client changed shape')
  }
  handlers.shift()
}

describe('the loosened stable client against a newer agent', () => {
  it('delivers an unstable-only update to the loose boundary', async () => {
    const received = []
    const agentApp = unstable
      .agent()
      .onRequest('initialize', () => ({ protocolVersion: unstable.PROTOCOL_VERSION }))
      .onRequest('session/new', () => ({ sessionId: 's1' }))
      .onRequest('session/prompt', async ({ params, client }) => {
        await client.notify('session/update', {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'plan_removed', planId: 'p1' },
        })
        return { stopReason: 'end_turn' }
      })
    const toAgent = new TransformStream()
    const toClient = new TransformStream()
    const agentStream = unstable.ndJsonStream(toClient.writable, toAgent.readable)
    const clientStream = stable.ndJsonStream(toAgent.writable, toClient.readable)
    const clientApp = stable.client({ name: 'loose-boundary' })
    loosenConstructorRouter(clientApp)
    clientApp.onNotification(
      'session/update',
      z.looseObject({ sessionId: z.string(), update: z.unknown() }),
      ({ params }) => {
        received.push(params.update)
      },
    )
    const agentConnection = agentApp.connect(agentStream)
    const connection = clientApp.connect(clientStream)
    try {
      const agent = connection.agent
      await agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} })
      const created = await agent.request('session/new', { cwd: '/tmp', mcpServers: [] })
      const result = await agent.request('session/prompt', {
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'hi' }],
      })
      expect(result.stopReason).toBe('end_turn')
      expect(received).toEqual([{ sessionUpdate: 'plan_removed', planId: 'p1' }])
    } finally {
      connection.close()
      agentConnection.close()
    }
  })
})
