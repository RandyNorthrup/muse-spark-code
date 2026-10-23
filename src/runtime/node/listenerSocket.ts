import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  NODE_WS_AUTH_MS,
  NODE_WS_CLOSE,
  NODE_WS_FRAME_BYTES,
  NODE_WS_GUID,
  NODE_WS_LENGTH_16,
  NODE_WS_LENGTH_64,
  NODE_WS_MASK_BYTES,
  NODE_WS_MASK_FLAG,
  NODE_WS_PING,
  NODE_WS_PONG,
  NODE_WS_QUEUE_BYTES,
  NODE_WS_SHORT_MAX,
  NODE_WS_TEXT,
  NODE_TERMINAL_FRAMES_PER_S,
  NODE_SIGNIN_BACKOFF_MS,
  UI_TEXT,
} from '../../shared/constants'
import { nodeEventSchema, nodeTerminalClientFrameSchema, type NodeEvent } from '../../shared/node'
import type { NodeSession } from '../../shared/nodeAuth'
import type { NodeListenerOptions } from './listener'
import { nodeAuthenticate, nodeHeader, NodeListenerError } from './listenerGuard'
import { dispatchNodeMethod } from './listenerMethods'

/** U2 supplies the authorized, ordered stream; disconnect must dispose its PTY. */
export type NodeTerminalSubscription = (
  session: NodeSession,
  terminalId: string,
  onEvent: (event: NodeEvent) => Promise<void>,
  signal: AbortSignal,
) => Promise<void>

function encodeFrame(bytes: Buffer, opcode: number): Buffer {
  let headerSize = 2
  if (bytes.length > NODE_WS_SHORT_MAX)
    headerSize =
      bytes.length <= NODE_WS_FRAME_BYTES - 1 ? NODE_WS_MASK_BYTES : NODE_WS_MASK_BYTES * 2 + 2
  const header = Buffer.alloc(headerSize)
  header[0] = opcode
  if (header.length === 2) header[1] = bytes.length
  else if (header.length === NODE_WS_MASK_BYTES) {
    header[1] = NODE_WS_LENGTH_16
    header.writeUInt16BE(bytes.length, 2)
  } else {
    header[1] = NODE_WS_LENGTH_64
    header.writeBigUInt64BE(BigInt(bytes.length), 2)
  }
  return Buffer.concat([header, bytes])
}

/** Small RFC6455 subset: bounded masked, final text/control frames; no extensions. */
export function upgradeNodeTerminal(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: NodeListenerOptions,
  lifetime: AbortSignal,
): void {
  const key = nodeHeader(request, 'sec-websocket-key')
  if (
    key === undefined ||
    request.url !== '/node/terminal/stream' ||
    request.method !== 'GET' ||
    nodeHeader(request, 'upgrade')?.toLowerCase() !== 'websocket' ||
    nodeHeader(request, 'connection')?.toLowerCase() !== 'upgrade' ||
    nodeHeader(request, 'sec-websocket-version') !== '13' ||
    Buffer.from(key, 'base64').length !== NODE_WS_MASK_BYTES * NODE_WS_MASK_BYTES ||
    !/^[A-Za-z0-9+/]{22}==$/u.test(key) ||
    nodeHeader(request, 'authorization') !== undefined ||
    nodeHeader(request, 'sec-websocket-protocol') !== undefined ||
    options.verifier === undefined ||
    options.terminal === undefined
  )
    throw new NodeListenerError('forbidden')

  // Unexpected socket failures reach the serve console; the peer only sees the close.
  const report = (_error: unknown): void => {
    options.print(UI_TEXT.nodeMessages.unexpectedFailure)
  }
  const pending = new AbortController()
  let signal = AbortSignal.any([pending.signal, lifetime])
  let bearer: string | undefined
  let session: NodeSession | undefined
  let terminalId: string | undefined
  let buffered: Buffer = Buffer.alloc(0)
  let queue = Promise.resolve()
  let queuedBytes = 0
  let frameCount = 0
  let windowStart = options.clock.monotonicMs()
  const deadline = options.clock.monotonicMs() + NODE_WS_AUTH_MS
  const close = () => {
    pending.abort()
    clearTimeout(timer)
    bearer = undefined
    socket.destroy()
  }
  const timer = setTimeout(close, NODE_WS_AUTH_MS)
  lifetime.addEventListener('abort', close, { once: true })
  socket.once('close', () => {
    close()
    lifetime.removeEventListener('abort', close)
  })
  socket.on('error', close)

  const write = async (bytes: Buffer, opcode: number): Promise<void> => {
    signal.throwIfAborted()
    if (bytes.length + socket.writableLength > NODE_WS_QUEUE_BYTES)
      throw new NodeListenerError('tooLarge')
    await new Promise<void>((resolve, reject) => {
      socket.write(encodeFrame(bytes, opcode), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
  const dispatch = async (
    method:
      | 'node/terminal/attach'
      | 'node/terminal/write'
      | 'node/terminal/resize'
      | 'node/terminal/close',
    params: unknown,
  ): Promise<void> => {
    if (session === undefined) throw new NodeListenerError('unauthenticated')
    await dispatchNodeMethod(
      method,
      params,
      session,
      {
        methods: options.methods,
        verifier: options.verifier,
        now: () => options.clock.now(),
        source: request.socket.remoteAddress ?? '',
      },
      signal,
    )
  }

  const receive = async (bytes: Buffer, opcode: number): Promise<void> => {
    signal.throwIfAborted()
    if (opcode === NODE_WS_CLOSE) {
      close()
      return
    }
    if (opcode === NODE_WS_PING || opcode === NODE_WS_PONG) {
      if (session === undefined) throw new NodeListenerError('unauthenticated')
      if (opcode === NODE_WS_PING) await write(bytes, NODE_WS_PONG)
      return
    }
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const frame = nodeTerminalClientFrameSchema.parse(raw)
    if (session === undefined) {
      if (frame.type !== 'auth' || options.clock.monotonicMs() >= deadline)
        throw new NodeListenerError('unauthenticated')
      bearer = frame.bearer
      session = await nodeAuthenticate(options.verifier, bearer, options.ownerId, signal)
      if (options.clock.monotonicMs() >= deadline || options.verifier === undefined)
        throw new NodeListenerError('unauthenticated')
      signal = AbortSignal.any([signal, options.verifier.sessionSignal(session.id)])
      signal.addEventListener('abort', close, { once: true })
      signal.throwIfAborted()
      terminalId = frame.terminalId
      await dispatch('node/terminal/attach', { terminalId })
      clearTimeout(timer)
      const terminal = options.terminal
      if (terminal === undefined) throw new NodeListenerError('unavailable')
      // Install after ownership check; observe rejection without blocking inbound input.
      void terminal(
        session,
        terminalId,
        async (event) => {
          await nodeAuthenticate(options.verifier, bearer, options.ownerId, signal)
          const parsed = nodeEventSchema.parse(event)
          if (!('terminalId' in parsed) || parsed.terminalId !== terminalId)
            throw new NodeListenerError('forbidden')
          await write(Buffer.from(JSON.stringify(parsed)), NODE_WS_TEXT)
        },
        signal,
      ).catch(close)
      return
    }
    await nodeAuthenticate(options.verifier, bearer, options.ownerId, signal)
    if (frame.type === 'auth') throw new NodeListenerError('forbidden')
    if (frame.type === 'input')
      await dispatch('node/terminal/write', { terminalId, data: frame.data })
    else if (frame.type === 'resize')
      await dispatch('node/terminal/resize', { terminalId, size: frame.size })
    else {
      await dispatch('node/terminal/close', { terminalId })
      close()
    }
  }

  const ingest = (chunk: Buffer): void => {
    try {
      if (buffered.length + chunk.length + queuedBytes > NODE_WS_QUEUE_BYTES)
        throw new NodeListenerError('tooLarge')
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length >= 2) {
        const opcode = buffered[0]
        const sizeByte = buffered[1]
        if (
          opcode === undefined ||
          sizeByte === undefined ||
          ![NODE_WS_TEXT, NODE_WS_CLOSE, NODE_WS_PING, NODE_WS_PONG].includes(opcode) ||
          (sizeByte & NODE_WS_MASK_FLAG) === 0
        )
          throw new NodeListenerError('invalidRequest')
        let size = sizeByte & NODE_WS_LENGTH_64
        if (size === NODE_WS_LENGTH_64) throw new NodeListenerError('tooLarge')
        let offset = 2
        if (size === NODE_WS_LENGTH_16) {
          if (buffered.length < NODE_WS_MASK_BYTES) return
          size = buffered.readUInt16BE(2)
          offset = NODE_WS_MASK_BYTES
          if (size <= NODE_WS_SHORT_MAX) throw new NodeListenerError('invalidRequest')
        }
        if (
          size > NODE_WS_FRAME_BYTES ||
          (opcode !== NODE_WS_TEXT && size > NODE_WS_SHORT_MAX) ||
          (opcode === NODE_WS_CLOSE && size === 1)
        )
          throw new NodeListenerError('tooLarge')
        if (buffered.length < offset + NODE_WS_MASK_BYTES + size) return
        const bytes = Buffer.from(
          buffered.subarray(offset + NODE_WS_MASK_BYTES, offset + NODE_WS_MASK_BYTES + size),
        )
        for (let index = 0; index < bytes.length; index += 1)
          bytes[index] =
            (bytes[index] ?? 0) ^ (buffered[offset + (index % NODE_WS_MASK_BYTES)] ?? 0)
        buffered = buffered.subarray(offset + NODE_WS_MASK_BYTES + size)
        const now = options.clock.monotonicMs()
        if (now - windowStart >= NODE_SIGNIN_BACKOFF_MS) {
          windowStart = now
          frameCount = 0
        }
        frameCount += 1
        if (frameCount > NODE_TERMINAL_FRAMES_PER_S) throw new NodeListenerError('rateLimited')
        queuedBytes += bytes.length
        const previous = queue
        queue = (async () => {
          try {
            await previous
            await receive(bytes, opcode)
          } catch (error: unknown) {
            // Any receive failure closes the socket; the queue absorbs it so later
            // frames still settle, and unexpected failures are reported.
            close()
            if (!(error instanceof NodeListenerError)) report(error)
          } finally {
            queuedBytes -= bytes.length
          }
        })()
      }
    } catch (error: unknown) {
      // Any frame failure closes the socket; unexpected failures are reported.
      close()
      if (!(error instanceof NodeListenerError)) report(error)
    }
  }
  socket.on('data', (chunk: unknown) => {
    if (chunk instanceof Buffer) ingest(chunk)
    else close()
  })
  signal.throwIfAborted()
  const accept = createHash('sha1')
    .update(key + NODE_WS_GUID)
    .digest('base64')
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  if (head.length > 0) ingest(head)
}
