// Custom request headers per provider (M95c part 6, PLAN.md D74): the
// person's own headers for one provider entry (a gateway's tenant key, an
// OpenAI project, a proxy's routing tag), sent on every request to it.
// Names and values live together in the credential store
// (`museSpark.providerHeaders.<id>`), never in settings or the providers
// file, bound to the origin they were entered for exactly as the key is;
// a request to another origin refuses instead of sending them. Names the
// app sends itself (authorization, content, the protocol's own headers)
// are refused, and every value is scrubbed from errors and logs like a
// key. Pure: no `vscode` import.

import * as z from 'zod/mini'
import {
  PROVIDER_HEADERS_SECRET_PREFIX,
  PROVIDER_RESERVED_HEADER_PREFIXES,
  PROVIDER_RESERVED_HEADERS,
} from '../../shared/constants'

/** The credential-store account holding a provider's custom headers. */
export function providerHeadersAccount(providerId: string): string {
  return `${PROVIDER_HEADERS_SECRET_PREFIX}${providerId}`
}

/** An HTTP field name: an RFC 9110 token (section 5.1). */
const FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u
/** An RFC 9110 field value (section 5.5): visible ASCII, spaces and tabs, nothing else. */
const FIELD_VALUE = /^[\t -~]+$/u

/** Why a header name cannot be kept, or undefined when it can. */
export type HeaderNameProblem = 'invalid' | 'reserved'

export function headerNameProblem(name: string): HeaderNameProblem | undefined {
  if (!FIELD_NAME.test(name)) return 'invalid'
  const folded = name.toLowerCase()
  return PROVIDER_RESERVED_HEADERS.includes(folded) ||
    PROVIDER_RESERVED_HEADER_PREFIXES.some((prefix) => folded.startsWith(prefix))
    ? 'reserved'
    : undefined
}

/** A value is one non-blank line of field-value characters. */
export function isHeaderValueValid(value: string): boolean {
  return value.trim() !== '' && FIELD_VALUE.test(value)
}

const storedHeadersSchema = z.object({
  v: z.literal(1),
  origin: z.url(),
  headers: z.record(z.string(), z.string()).check(
    z.refine((headers) => {
      const names = Object.keys(headers)
      const folded = new Set(names.map((name) => name.toLowerCase()))
      return (
        folded.size === names.length &&
        names.every((name) => headerNameProblem(name) === undefined) &&
        Object.values(headers).every((value) => isHeaderValueValid(value))
      )
    }),
  ),
})

type StoredHeaders = z.infer<typeof storedHeadersSchema>

/** The stored text could not be read as a header record (never its contents: they are secret). */
export class StoredHeadersError extends Error {
  public constructor(public readonly providerId: string) {
    super(`The stored request headers for provider ${providerId} are not a header record`)
    this.name = 'StoredHeadersError'
  }
}

/**
The stored record, or undefined when none was entered. A stored value
that is not a record throws: a damaged entry is said, never read as
"no headers", since a request without them may reach the wrong tenant.
*/
export function parseStoredHeaders(
  providerId: string,
  stored: string | undefined,
): StoredHeaders | undefined {
  if (stored === undefined || stored === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error: unknown) {
    // Only malformed text reads damaged; its message would quote the secret.
    if (!(error instanceof SyntaxError)) throw error
    throw new StoredHeadersError(providerId)
  }
  const parsed = storedHeadersSchema.safeParse(value)
  if (!parsed.success) throw new StoredHeadersError(providerId)
  return parsed.data
}

/** The record as stored: origin-bound, one name per header whatever its casing. */
export function formatStoredHeaders(
  origin: string,
  headers: Readonly<Record<string, string>>,
): string {
  const record: StoredHeaders = { v: 1, origin: new URL(origin).origin, headers: { ...headers } }
  return JSON.stringify(storedHeadersSchema.parse(record))
}

/** The headers with `name` set to `value`, replacing any casing of the same name. */
export function withHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
  value: string,
): Record<string, string> {
  return { ...withoutHeader(headers, name), [name]: value }
}

/** The headers without any casing of `name`. */
export function withoutHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): Record<string, string> {
  const folded = name.toLowerCase()
  return Object.fromEntries(
    Object.entries(headers).filter(([existing]) => existing.toLowerCase() !== folded),
  )
}
