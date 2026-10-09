// Content-Length counts bytes, not UTF-16 characters. Every decoded JSON message is validated.
import type { Readable, Writable } from 'node:stream'
import { TextDecoder } from 'node:util'
import { LSP_LIMITS, MHP_ERROR_CODES } from '../../shared/constants'
import { messageSchema, type RpcId, type RpcMessage } from './protocol'

export interface LspTransport {
  readonly closed: Promise<void>
  notify(method: string, params: unknown): void
  reply(id: RpcId, result: unknown): void
  error(id: RpcId | null, code: number, message: string): void
  request(method: string, params: unknown): Promise<unknown>
  close(): void
}

export function lspTransport(
  input: Readable,
  output: Writable,
  receive: (message: RpcMessage) => void,
): LspTransport {
  let bytes = Buffer.alloc(0)
  let size: number | undefined
  let sequence = 0
  let queued = 0
  let isEnded = false
  const pending = new Map<
    RpcId,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const writes: Buffer[] = []
  let isWaiting = false
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
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('ELSP_CLOSED'))
    }
    pending.clear()
    writes.length = 0
    ending.abort()
  }
  function flush(): void {
    isWaiting = false
    while (!isEnded && writes.length > 0) {
      const frame = writes.shift()
      if (frame === undefined) return
      queued -= frame.length
      if (!output.write(frame)) {
        isWaiting = true
        return
      }
    }
  }
  function send(message: unknown): void {
    if (isEnded) return
    const body = Buffer.from(JSON.stringify(message))
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${String(body.length)}\r\n\r\n`),
      body,
    ])
    if (
      body.length > LSP_LIMITS.frameBytes ||
      queued + frame.length + output.writableLength > LSP_LIMITS.queuedBytes
    ) {
      close()
      return
    }
    queued += frame.length
    writes.push(frame)
    if (!isWaiting) flush()
  }
  const api: LspTransport = {
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
        if (isEnded || pending.size >= LSP_LIMITS.pendingRequests) {
          reject(new Error('ELSP_BUSY'))
          return
        }
        sequence += 1
        const id = `server-${String(sequence)}`
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('ELSP_TIMEOUT'))
        }, LSP_LIMITS.requestMs)
        pending.set(id, { resolve, reject, timer })
        send({ jsonrpc: '2.0', id, method, params })
      }),
    close,
  }
  function dispatch(body: Buffer): void {
    let raw: unknown
    try {
      raw = JSON.parse(decoder.decode(body))
    } catch {
      api.error(null, MHP_ERROR_CODES.parseError, 'ELSP_JSON')
      return
    }
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success) {
      api.error(null, MHP_ERROR_CODES.invalidRequest, 'ELSP_MESSAGE')
      return
    }
    const message = parsed.data
    if (message.method === undefined) {
      if (message.id === undefined || message.id === null) return
      const call = pending.get(message.id)
      if (call === undefined) return
      pending.delete(message.id)
      clearTimeout(call.timer)
      if (message.error === undefined) {
        call.resolve(message.result)
      } else {
        call.reject(new Error('ELSP_CLIENT', { cause: message.error.code }))
      }
    } else receive(message)
  }
  function onData(chunk: Buffer): void {
    // Consume before accepting another chunk; at most one bounded incomplete frame is retained.
    bytes = Buffer.concat([bytes, chunk])
    while (!isEnded) {
      if (size === undefined) {
        const end = bytes.indexOf('\r\n\r\n')
        if (end === -1) {
          if (bytes.length > LSP_LIMITS.headerBytes) close()
          return
        }
        if (end > LSP_LIMITS.headerBytes) {
          close()
          return
        }
        const lengths = bytes
          .subarray(0, end)
          .toString('ascii')
          .split('\r\n')
          .filter((line) => /^content-length:/iu.test(line))
        const match =
          lengths.length === 1 ? /^content-length: ([0-9]+)$/iu.exec(lengths[0] ?? '') : null
        size = match === null ? undefined : Number(match[1])
        if (
          size === undefined ||
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > LSP_LIMITS.frameBytes
        ) {
          close()
          return
        }
        bytes = bytes.subarray(end + LSP_LIMITS.headerDelimiterBytes)
      }
      if (bytes.length < size) return
      const body = bytes.subarray(0, size)
      bytes = bytes.subarray(size)
      size = undefined
      dispatch(body)
    }
  }
  input.on('data', onData)
  input.once('end', close)
  input.once('error', close)
  output.once('error', close)
  output.on('drain', flush)
  return api
}
