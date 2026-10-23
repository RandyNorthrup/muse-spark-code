import type * as z from 'zod/mini'
import { NODE_HTTP_BODY_BYTES, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import {
  nodeMethodErrorSchema,
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../shared/hostApi/nodeMethods'
import { nodeTokenSchema } from '../../shared/nodeAuth'

/** A node refusal the page can name: the code, never a matched message. */
export type NodePageErrorCode = keyof UiText['nodeErrors']
export class NodePageError extends Error {
  constructor(
    readonly code: NodePageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(UI_TEXT.nodeErrors[code], options)
  }
}
export function isNodePageError(error: unknown): error is NodePageError {
  return error instanceof NodePageError
}

type Catalog = {
  [M in NodeMethodName]: {
    params: z.ZodMiniType<NodeMethodParams<M>>
    result: z.ZodMiniType<NodeMethodResult<M>>
  }
}
const catalog: Catalog = nodeMethods

/** Frozen MHP binding: transport envelopes stay M104's responsibility. */
export function validatedNodePort(transport: {
  request(method: NodeMethodName, params: unknown, signal: AbortSignal): Promise<unknown>
}): NodeMethodPort {
  return {
    async request<M extends NodeMethodName>(
      method: M,
      params: NodeMethodParams<M>,
      signal: AbortSignal,
    ): Promise<NodeMethodResult<M>> {
      signal.throwIfAborted()
      const entry = catalog[method]
      let input: unknown
      try {
        input = entry.params.parse(params)
      } catch (error: unknown) {
        // Person-typed input (the path box) can fail validation: typed
        // `invalidRequest`, never the raw schema failure.
        throw new NodePageError('invalidRequest', { cause: error })
      }
      let result: unknown
      try {
        result = await transport.request(method, input, signal)
      } catch (error: unknown) {
        if (signal.aborted) throw error
        if (isNodePageError(error)) throw error
        // A transport can fail untyped (a network TypeError, a harness
        // shortcut): typed `unavailable` with the failure attached.
        throw new NodePageError('unavailable', { cause: error })
      }
      signal.throwIfAborted()
      try {
        return entry.result.parse(result)
      } catch (error: unknown) {
        // A response that fails validation is a server fault: typed
        // `unavailable` with the parse failure attached.
        throw new NodePageError('unavailable', { cause: error })
      }
    },
  }
}

/** The smallest surface the terminal stream needs from a WebSocket. DOM
sockets satisfy it directly; the page passes `(url) => new WebSocket(url)`. */
export interface NodeTerminalRawSocket {
  send(data: string): void
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { readonly data?: unknown }) => void,
  ): void
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { readonly data?: unknown }) => void,
  ): void
}

/** The terminal's wire: an open, authenticated stream. The factory opens the
socket and sends the bearer in the first frame (the server closes a socket
whose first frame is not its auth); the session only ever sends input,
resize and close frames, and receives the server's typed events. `send` and
`close` never throw for a socket that is already gone: they end the stream
quietly, and anything else they cannot do surfaces typed. */
export interface NodeTerminalWire {
  send(data: string): void
  close(): void
  onMessage(handler: (data: string) => void): () => void
  onClose(handler: () => void): () => void
}

/** Opens and authenticates one terminal stream. Rejects typed when the
socket cannot open or the server refuses it. */
export type NodeTerminalSocketFactory = (terminalId: string) => Promise<NodeTerminalWire>

/** The terminal stream beside the method port: same origin and memory-only
bearer, over the server's WebSocket route. A1 owns the bearer;
reload/sign-out clears that caller-owned state. */
export function nodeTerminalSocket(options: {
  origin: string
  bearer(): string | undefined
  openSocket(url: string): NodeTerminalRawSocket
}): NodeTerminalSocketFactory {
  const origin = new URL(options.origin)
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== options.origin ||
    origin.username !== '' ||
    origin.password !== ''
  )
    throw new NodePageError('forbidden')
  const url = new URL('/node/terminal/stream', origin)
  url.protocol = 'wss:'
  const address = url.href
  return async (terminalId: string): Promise<NodeTerminalWire> => {
    const bearer = nodeTokenSchema.safeParse(options.bearer())
    if (!bearer.success) throw new NodePageError('unauthenticated')
    const socket = options.openSocket(address)
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.removeEventListener('open', onOpen)
          socket.removeEventListener('error', onFail)
          socket.removeEventListener('close', onFail)
        }
        const onOpen = () => {
          cleanup()
          resolve()
        }
        const onFail = () => {
          cleanup()
          reject(new NodePageError('unavailable'))
        }
        socket.addEventListener('open', onOpen)
        socket.addEventListener('error', onFail)
        socket.addEventListener('close', onFail)
      })
    } catch (error: unknown) {
      socket.close()
      throw error
    }
    try {
      socket.send(JSON.stringify({ type: 'auth', bearer: bearer.data, terminalId }))
    } catch (error: unknown) {
      // The socket opened but takes nothing: end it and say so, typed,
      // with the send failure attached.
      socket.close()
      throw new NodePageError('unavailable', { cause: error })
    }
    const messages = new Set<(data: string) => void>()
    const closes = new Set<() => void>()
    let isGone = false
    const onMessage = (event: { readonly data?: unknown }) => {
      if (typeof event.data !== 'string') {
        // The server sends text frames only: anything else is a server
        // fault, and ending the stream says so through the close below.
        socket.close()
        return
      }
      for (const handler of messages) handler(event.data)
    }
    const onClose = () => {
      if (isGone) return
      isGone = true
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      for (const handler of closes) handler()
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    const closeWire = () => {
      if (isGone) return
      isGone = true
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      socket.close()
    }
    return {
      send(data) {
        if (isGone) return
        try {
          socket.send(data)
        } catch (error: unknown) {
          // A failed send means a dead socket: only a DOM failure lands
          // here. This close keeps its listeners, so the stream's end
          // still reports through onClose; the wire's own close below
          // stays quiet because its caller already knows.
          if (!(error instanceof DOMException)) throw error
          socket.close()
        }
      },
      close: closeWire,
      onMessage(handler) {
        messages.add(handler)
        return () => {
          messages.delete(handler)
        }
      },
      onClose(handler) {
        closes.add(handler)
        return () => {
          closes.delete(handler)
        }
      },
    }
  }
}

/** N's captured local catalog route, not a guessed MHP envelope. A1 owns
the memory-only bearer; reload/sign-out clears that caller-owned state. */
export function nodeHttpsPort(options: {
  origin: string
  bearer(): string | undefined
  fetch: typeof fetch
}): NodeMethodPort {
  const origin = new URL(options.origin)
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== options.origin ||
    origin.username !== '' ||
    origin.password !== ''
  )
    throw new NodePageError('forbidden')
  return validatedNodePort({
    request: async (method, params, signal) => {
      const bearer = nodeTokenSchema.safeParse(options.bearer())
      if (!bearer.success) throw new NodePageError('unauthenticated')
      const body = JSON.stringify(params)
      if (new TextEncoder().encode(body).byteLength > NODE_HTTP_BODY_BYTES)
        throw new NodePageError('tooLarge')
      const response = await options.fetch(new URL(`/${method}`, origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer.data}`, 'Content-Type': 'application/json' },
        body,
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        mode: 'same-origin',
      })
      if (
        !['application/json', 'application/json; charset=utf-8'].includes(
          response.headers.get('content-type') ?? '',
        )
      )
        throw new NodePageError('invalidRequest')
      const reader = response.body?.getReader()
      if (reader === undefined) throw new NodePageError('invalidRequest')
      const parts: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          length += part.value.byteLength
          if (length > NODE_HTTP_BODY_BYTES) throw new NodePageError('tooLarge')
          parts.push(part.value)
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
      }
      const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (!response.ok) {
        const error = nodeMethodErrorSchema.safeParse(result)
        throw new NodePageError(error.success ? error.data.code : 'unavailable')
      }
      return result
    },
  })
}
