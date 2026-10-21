// M124 (D106, design §6): every string a client receives passes the shared
// redaction owner (M84/M118's share privacy: registered values, account and
// path scrub, then the secret patterns), and the serialized whole result is
// scrubbed once more before release. If that final pass still changes
// anything, the result is withheld rather than cut.
import type { SharePrivacyPort } from '../../shared/share'
import { scrubShareText } from '../../shared/share'
import { redactSecrets } from '../../shared/redact'

export interface ConnectorScrub {
  /** Every string value of a projection; its keys are our own fixed names and stay. */
  readonly leaves: (value: unknown) => unknown
  /** The final whole-text pass; undefined when it found something the leaves missed. */
  readonly whole: (serialized: string) => string | undefined
  readonly text: (value: string) => string
}

/**
Our own projections' enum fields: protocol words, not user text, so an
account name such as "user" cannot turn them into a marker (as M118's
prompt share keeps `scope`). Every other string is scrubbed.
*/
const PROTOCOL_KEYS: ReadonlySet<string> = new Set([
  'scope',
  'state',
  'kind',
  'delivery',
  'format',
  'status',
  'outcome',
])

export function createConnectorScrub(
  privacy: SharePrivacyPort,
  registered: () => readonly string[],
): ConnectorScrub {
  const text = (value: string) => redactSecrets(scrubShareText(value, privacy), registered())
  const leaves = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return PROTOCOL_KEYS.has(key) ? value : text(value)
    if (Array.isArray(value)) return value.map((item: unknown) => leaves(item))
    if (typeof value !== 'object' || value === null) return value
    // Keys are our allow-listed projection names; values are scrubbed.
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, leaves(item, name)]),
    )
  }
  return {
    leaves,
    text,
    whole: (serialized) => {
      const clean = redactSecrets(serialized, registered())
      return clean === serialized ? serialized : undefined
    },
  }
}
