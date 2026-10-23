// Pinned local transport: each request owns one socket and no reconnect.
import { lookup } from 'node:dns/promises'
import { once } from 'node:events'
import { request } from 'node:http'
import { createConnection, isIP, type Socket } from 'node:net'
import * as z from 'zod/mini'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_TIMEOUT_MS,
  LOCAL_JUDGE_IPV4_FAMILY,
  LOCAL_JUDGE_DEFAULT_PORT,
  LOCAL_JUDGE_HTTP_OK,
  LOCAL_JUDGE_MIN_PORT,
  LOCAL_JUDGE_MAX_PORT,
  JUDGE_REQUEST_TIMEOUT_MS,
} from '../../../shared/constants'

function isLoopback(address: string): boolean {
  return (
    address === '::1' || (isIP(address) === LOCAL_JUDGE_IPV4_FAMILY && address.startsWith('127.'))
  )
}

/** Resolve once, then connect using only the selected loopback IP literal. */
export async function localEndpoint(
  value: string,
  resolve: (name: string) => Promise<{ address: string; family: number }> = lookup,
): Promise<{ address: string; port: number }> {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('unverified-endpoint')
  }
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, '')
  const resolved = isIP(hostname) ? { address: hostname } : await resolve(hostname)
  const address = resolved.address
  if (!isLoopback(address)) throw new Error('unverified-address')
  return { address, port: url.port === '' ? LOCAL_JUDGE_DEFAULT_PORT : Number(url.port) }
}

/** No pool or reconnect. The verifier runs before even an HTTP header is sent. */
export async function requestLocal(
  endpoint: { address: string; port: number },
  route: '/api/tags' | '/api/chat' | '/api/ps' | '/v1/systemone',
  verify: (socket: Socket) => Promise<void>,
  body?: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  options.signal?.throwIfAborted()
  const timeoutMs = options.timeoutMs ?? LOCAL_JUDGE_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > JUDGE_REQUEST_TIMEOUT_MS)
    throw new Error('invalid-local-deadline')
  if (!isLoopback(endpoint.address)) throw new Error('unverified-address')
  if (
    !Number.isSafeInteger(endpoint.port) ||
    endpoint.port < LOCAL_JUDGE_MIN_PORT ||
    endpoint.port > LOCAL_JUDGE_MAX_PORT
  ) {
    throw new Error('unverified-port')
  }
  if (body !== undefined && Buffer.byteLength(body) > LOCAL_JUDGE_MAX_RESPONSE_BYTES) {
    throw new Error('request-too-large')
  }
  const socket = createConnection({
    host: endpoint.address,
    port: endpoint.port,
    autoSelectFamily: false,
    // The literal pins this connect; refuse an unexpected DNS path altogether.
    lookup: (_hostname, _options, callback) => {
      callback(new Error('unexpected-lookup'), '', 0)
    },
  })
  const deadline = setTimeout(() => {
    socket.destroy(new Error('local-timeout'))
  }, timeoutMs)
  const abort = () => socket.destroy(new Error('local-cancelled'))
  options.signal?.addEventListener('abort', abort, { once: true })
  // Cover errors while the asynchronous OS/disk verifier is running, too.
  let fault: Error | undefined
  socket.on('error', (error) => {
    fault = error
  })
  try {
    await once(socket, 'connect')
    if (socket.remoteAddress !== endpoint.address || !isLoopback(socket.localAddress ?? '')) {
      throw new Error('unverified-tuple')
    }
    // A slow verifier cannot keep the transport alive after cancellation/expiry.
    let closed: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject) => {
      closed = () => {
        reject(fault ?? new Error('unverified-closed'))
      }
      socket.once('close', closed)
    })
    try {
      await Promise.race([verify(socket), stopped])
    } finally {
      if (closed) socket.removeListener('close', closed)
    }
    options.signal?.throwIfAborted()
    if (fault || socket.destroyed || !socket.writable || socket.readableEnded) {
      throw fault ?? new Error('unverified-closed')
    }
    return await new Promise<unknown>((resolve, reject) => {
      const outgoing = request(
        {
          hostname: endpoint.address,
          port: endpoint.port,
          path: route,
          method: body === undefined ? 'GET' : 'POST',
          createConnection: () => socket,
          headers: { 'content-type': 'application/json', connection: 'close' },
        },
        (response) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > LOCAL_JUDGE_MAX_RESPONSE_BYTES)
              outgoing.destroy(new Error('response-too-large'))
            else chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            try {
              if (response.statusCode !== LOCAL_JUDGE_HTTP_OK)
                throw new Error('refused-http-status')
              // Never follows Location, uses proxies, retries or reconnects.
              const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              resolve(z.json().parse(decoded))
            } catch (error: unknown) {
              reject(error instanceof Error ? error : new Error('invalid-json', { cause: error }))
            }
          })
        },
      )
      outgoing.on('error', reject)
      outgoing.end(body)
    })
  } finally {
    clearTimeout(deadline)
    options.signal?.removeEventListener('abort', abort)
    socket.destroy()
  }
}
