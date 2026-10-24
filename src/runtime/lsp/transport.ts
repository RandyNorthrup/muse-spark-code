// The language server's framing (M104 lane H): LSP's base protocol over a
// byte stream, `Content-Length` headers counting UTF-8 bytes, each body a
// JSON-RPC 2.0 message parsed with zod before it is dispatched. A request the
// server sends the editor (a question, an edit) waits for the editor's
// answer: no deadline of ours (D121), only the connection's end.
import type { Readable, Writable } from 'node:stream'
import { TextDecoder } from 'node:util'
import { LSP_HEADER_MAX_BYTES, MHP_ERROR_CODES } from '../../shared/constants'
import { messageSchema, type RpcId, type RpcMessage } from './protocol'

const HEADER_END = '\r\n\r\n'
const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/iu

export interface LspTransport {
  /** Settles when the connection ends, from either side. */
  readonly closed: Promise<void>
  notify(method: string, params: unknown): void
  reply(id: RpcId, result: unknown): void
  error(id: RpcId | null, code: number, message: string): void
  /** A request to the editor; rejects with `ELSP_CLIENT` (the code as its cause) or `ELSP_CLOSED`. */
  request(method: string, params: unknown): Promise<unknown>
  close(): void
}

/** An editor's answer that was an error: its JSON-RPC code is the cause. */
export class LspClientError extends Error {
  constructor(readonly code: number) {
    super('ELSP_CLIENT')
    this.name = 'LspClientError'
  }
}

export function lspTransport(
  input: Readable,
  output: Writable,
  receive: (message: RpcMessage) => void,
): LspTransport {
  let buffered: Buffer = Buffer.alloc(0)
  let bodyBytes: number | undefined
  let sequence = 0
  let isEnded = false
  let isWaiting = false
  const writes: Buffer[] = []
  const pending = new Map<RpcId, { resolve(value: unknown): void; reject(error: Error): void }>()
  const ending = new AbortController()
  const closed = new Promise<void>((resolve) => {
    ending.signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })

  function close(): void {
    if (isEnded) return
    isEnded = true
    input.off('data', onData)
    output.off('drain', flush)
    for (const call of pending.values()) call.reject(new Error('ELSP_CLOSED'))
    pending.clear()
    writes.length = 0
    ending.abort()
  }
  /** Writes in order and waits for `drain` when the stream asks: nothing is dropped. */
  function flush(): void {
    isWaiting = false
    for (let frame = writes.shift(); frame !== undefined; frame = writes.shift()) {
      if (isEnded) return
      if (!output.write(frame)) {
        isWaiting = true
        return
      }
    }
  }
  function send(message: unknown): void {
    if (isEnded) return
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    writes.push(
      Buffer.concat([Buffer.from(`Content-Length: ${String(body.length)}${HEADER_END}`), body]),
    )
    if (!isWaiting) flush()
  }
  const transport: LspTransport = {
    closed,
    notify: (method, params) => {
      send({ jsonrpc: '2.0', method, params })
    },
    reply: (id, result) => {
      send({ jsonrpc: '2.0', id, result })
    },
    error: (id, code, message) => {
      send({ jsonrpc: '2.0', id, error: { code, message } })
    },
    request: (method, params) =>
      new Promise((resolve, reject) => {
        if (isEnded) {
          reject(new Error('ELSP_CLOSED'))
          return
        }
        sequence += 1
        const id = `muse-${String(sequence)}`
        pending.set(id, { resolve, reject })
        send({ jsonrpc: '2.0', id, method, params })
      }),
    close,
  }

  function dispatch(body: Buffer): void {
    let raw: unknown
    try {
      raw = JSON.parse(decoder.decode(body))
    } catch (error: unknown) {
      // Not UTF-8 (the fatal decoder's TypeError) or not JSON (SyntaxError):
      // the specification's parse error. Anything else is not a parse answer.
      if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error
      transport.error(null, MHP_ERROR_CODES.parseError, 'ELSP_JSON')
      return
    }
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success) {
      transport.error(null, MHP_ERROR_CODES.invalidRequest, 'ELSP_MESSAGE')
      return
    }
    const message = parsed.data
    if (message.method !== undefined) {
      receive(message)
      return
    }
    if (message.id === undefined || message.id === null) return
    const call = pending.get(message.id)
    if (call === undefined) return
    pending.delete(message.id)
    if (message.error === undefined) call.resolve(message.result)
    else call.reject(new LspClientError(message.error.code))
  }
  function onData(chunk: Buffer): void {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])
    while (!isEnded) {
      if (bodyBytes === undefined) {
        const end = buffered.indexOf(HEADER_END)
        if (end === -1) {
          if (buffered.length > LSP_HEADER_MAX_BYTES) close()
          return
        }
        const lengths = buffered
          .subarray(0, end)
          .toString('ascii')
          .split('\r\n')
          .map((line) => CONTENT_LENGTH.exec(line))
          .filter((match) => match !== null)
        const length = lengths.length === 1 ? Number(lengths[0]?.[1]) : NaN
        if (end > LSP_HEADER_MAX_BYTES || !Number.isSafeInteger(length) || length <= 0) {
          close()
          return
        }
        bodyBytes = length
        buffered = buffered.subarray(end + HEADER_END.length)
      }
      if (buffered.length < bodyBytes) return
      const body = buffered.subarray(0, bodyBytes)
      buffered = buffered.subarray(bodyBytes)
      bodyBytes = undefined
      dispatch(body)
    }
  }
  input.on('data', onData)
  input.once('end', close)
  input.once('error', close)
  output.once('error', close)
  output.on('drain', flush)
  return transport
}
