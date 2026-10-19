// The loopback transport the host's MCP servers share (the `ide` server and
// the team's bridge, M96 lane B): a capped request body, a constant-time
// Bearer [REDACTED] comparison, and an ephemeral loopback listener. One module so the
// two servers never drift apart; neither owns it.

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { redactSecrets } from '../core/redact'
import { IDE_MCP_LOOPBACK_HOST } from '../shared/constants'
import type { Logger } from './logger'

/** Reads the request body, or undefined when it is too large or unreadable. */
export function readLoopbackBody(
  request: IncomingMessage,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    const finish = (body?: string) => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onError)
      signal?.removeEventListener('abort', onError)
      resolve(body)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size <= maxBytes) {
        chunks.push(chunk)
      }
    }
    const onEnd = () => {
      finish(size > maxBytes ? undefined : Buffer.concat(chunks).toString('utf8'))
    }
    const onError = () => {
      finish()
    }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onError)
    signal?.addEventListener('abort', onError, { once: true })
    if (signal?.aborted === true) onError()
  })
}

/** Compares a presented Bearer [REDACTED] with the expected one in constant time. */
export function isSameLoopbackSecret(presented: string, expected: string): boolean {
  const left = Buffer.from(presented)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export interface LoopbackListener {
  readonly server: Server
  readonly port: number
}

/**
 * Listens on an ephemeral loopback port for one MCP server. Errors after the
 * listen (a socket fault) are logged, never thrown at the host.
 */
export async function listenLoopback(
  onRequest: (request: IncomingMessage, response: ServerResponse) => void,
  log: Logger,
  service: string,
): Promise<LoopbackListener> {
  const server = createServer(onRequest)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, IDE_MCP_LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('error', (error) => {
    log.error(`${service} error: ${redactSecrets(error.message)}`)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error(`${service} has no TCP address`)
  }
  return { server, port: address.port }
}
