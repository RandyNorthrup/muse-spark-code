import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

/** Reject duplicates even where Node would otherwise discard or join them. */
export function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const values = request.headersDistinct[name]
  return values?.length === 1 ? values[0] : undefined
}

export function isSameSecret(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Initial navigation may omit Origin/metadata; privileged routes may not omit Origin. */
export function isSameOrigin(
  request: IncomingMessage,
  origin: string,
  isPrivileged: boolean,
): boolean {
  if (singleHeader(request, 'host') !== new URL(origin).host) return false
  const supplied = singleHeader(request, 'origin')
  if (supplied !== origin && request.headersDistinct['origin'] !== undefined) return false
  if (isPrivileged && supplied !== origin) return false
  const site = singleHeader(request, 'sec-fetch-site')
  return (
    request.headersDistinct['sec-fetch-site'] === undefined ||
    site === 'same-origin' ||
    (site === 'none' && !isPrivileged)
  )
}

export function sessionBearer(request: IncomingMessage): string | undefined {
  const authorization = singleHeader(request, 'authorization')
  return authorization === undefined ? undefined : /^Bearer ([a-f\d]+)$/.exec(authorization)?.[1]
}

/** Applied before dispatch, including refusals and static assets. Never enable CORS. */
export function secureHeaders(response: ServerResponse, nonce: string): void {
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '),
  )
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
}

/** Fatal UTF-8 decoding and a byte cap precede every injected zod parser. */
export async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (singleHeader(request, 'content-type') !== 'application/json')
    throw new Error('EPANEL_CONTENT_TYPE')
  const length = singleHeader(request, 'content-length')
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new Error('EPANEL_BODY')
  let size = 0
  const chunks: Buffer[] = []
  const stream = request.iterator({ destroyOnReturn: false })
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) throw new Error('EPANEL_BODY')
    size += chunk.length
    if (size > maxBytes) throw new Error('EPANEL_BODY')
    chunks.push(chunk)
  }
  const parsed: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  )
  return parsed
}
