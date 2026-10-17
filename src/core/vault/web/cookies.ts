import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { VAULT_LIMITS, VAULT_SESSION_MAX_DAYS } from '../../../shared/constants'
import { vaultOriginSchema } from '../../../shared/vault'
import { type WebCookie } from './ports'
import { webOrigin } from './origin'

const MILLIS_PER_DAY = 86_400_000

export function sessionDeadline(createdAt: number): number {
  const deadline = createdAt + VAULT_SESSION_MAX_DAYS * MILLIS_PER_DAY
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !Number.isSafeInteger(deadline))
    throw new Error('useChanged')
  return deadline
}
const cookie = z.strictObject({
  origin: vaultOriginSchema,
  name: z
    .string()
    .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[!#$%&'*+.^_`|~\w-]+$/u)),
  value: z.instanceof(Uint8Array).check(z.refine((v) => v.byteLength <= VAULT_LIMITS.valueBytes)),
  path: z
    .string()
    .check(z.maxLength(VAULT_LIMITS.text), z.startsWith('/'), z.regex(/^[^\0\r\n]*$/u)),
  secure: z.literal(true),
  hostOnly: z.literal(true),
  httpOnly: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
  expiresAt: z.nullable(z.number().check(z.int(), z.nonnegative(), z.lte(Number.MAX_SAFE_INTEGER))),
})
const cookies = z.array(cookie).check(z.maxLength(VAULT_LIMITS.cookies))
const encodedCookie = z.strictObject({
  ...cookie.shape,
  value: z
    .string()
    .check(
      z.maxLength(VAULT_LIMITS.frameBytes),
      z.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
    ),
})
const envelope = z.strictObject({
  v: z.literal(1),
  cookies: z.array(encodedCookie).check(z.maxLength(VAULT_LIMITS.cookies)),
})

/** Own private format, not a CDP wire parser. Every value is an owned buffer, erased by caller. */
export function sessionCookies(
  input: readonly WebCookie[],
  origin: string,
  now: number,
): WebCookie[] {
  if (!Number.isSafeInteger(now) || now < 0 || origin !== webOrigin(origin))
    throw new Error('useChanged')
  const parsed = cookies.parse(input)
  const maxExpiry = sessionDeadline(now)
  const output: WebCookie[] = []
  try {
    const seen = new Set<string>()
    for (const row of parsed) {
      if (row.origin !== origin) throw new Error('useChanged')
      const identity = JSON.stringify([row.name, row.path])
      if (seen.has(identity)) throw new Error('useChanged')
      seen.add(identity)
      if (row.expiresAt !== null && row.expiresAt <= now) continue
      const value = Buffer.alloc(row.value.byteLength)
      value.set(row.value)
      output.push({ ...row, value, expiresAt: Math.min(row.expiresAt ?? maxExpiry, maxExpiry) })
    }
    return output
  } catch {
    eraseCookies(output)
    throw new Error('useChanged')
  }
}

export function eraseCookies(rows: readonly WebCookie[]): void {
  for (const row of rows) row.value.fill(0)
}

export function encodeCookies(rows: readonly WebCookie[]): Buffer<ArrayBuffer> {
  const text = JSON.stringify({
    v: 1,
    cookies: rows.map((row) => {
      const view = Buffer.from(row.value.buffer, row.value.byteOffset, row.value.byteLength)
      return { ...row, value: view.toString('base64') }
    }),
  })
  if (Buffer.byteLength(text) > VAULT_LIMITS.valueBytes) throw new Error('useChanged')
  const bytes = Buffer.alloc(Buffer.byteLength(text))
  bytes.write(text, 'utf8')
  return bytes
}

export function decodeCookies(bytes: Uint8Array, origin: string, now: number): WebCookie[] {
  const owned: WebCookie[] = []
  try {
    if (bytes.byteLength > VAULT_LIMITS.valueBytes) throw new Error('useChanged')
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const parsed = envelope.parse(JSON.parse(view.toString('utf8')))
    for (const row of parsed.cookies) {
      const decoded = Buffer.from(row.value, 'base64')
      const value = Buffer.alloc(decoded.byteLength)
      value.set(decoded)
      decoded.fill(0)
      owned.push({ ...row, value })
    }
    return sessionCookies(owned, origin, now)
  } catch {
    throw new Error('useChanged')
  } finally {
    eraseCookies(owned)
  }
}
