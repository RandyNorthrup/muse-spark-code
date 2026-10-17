import { Buffer } from 'node:buffer'
import { VAULT_LIMITS } from '../../../shared/constants'
import {
  vaultItemSchema,
  type VaultItem,
  type VaultItemMetadata,
  type VaultStorePort,
} from '../../../shared/vault'
import { decodeTotpSeed, WEB_TOTP_PERIOD_SECONDS } from './totp'
import { webOrigin } from './origin'
import { webItemMetadata } from './items'

export interface WebLoginImportPort {
  readonly store: VaultStorePort
  readonly now: () => number
  readonly randomId: () => string
  /** M/U/H bind to a user's explicit CSV import review, never a model or hook answer. */
  review(items: readonly VaultItemMetadata[]): Promise<boolean>
}
export type WebLoginImportResult =
  | { readonly kind: 'imported'; readonly items: readonly VaultItemMetadata[] }
  | { readonly kind: 'declined' }
  | { readonly kind: 'failed'; readonly items: readonly VaultItemMetadata[] }

/** RFC 4180: quoted commas, escaped quotes, CRLF and embedded newlines; malformed input refuses. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let isQuoted = false
  let hasQuoteEnded = false
  const addField = (): void => {
    if (field.length > VAULT_LIMITS.text || row.length >= VAULT_LIMITS.names)
      throw new Error('invalidCsv')
    row.push(field)
    field = ''
    hasQuoteEnded = false
  }
  const addRow = (): void => {
    addField()
    if (rows.length > VAULT_LIMITS.items) throw new Error('invalidCsv')
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const character = text.charAt(i)
    if (isQuoted) {
      if (character !== '"') field += character
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else {
        isQuoted = false
        hasQuoteEnded = true
      }
    } else if (character === ',') addField()
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i++
      addRow()
    } else if (character === '"' && field === '' && !hasQuoteEnded) isQuoted = true
    else {
      if (hasQuoteEnded || character === '"' || character === '\0') throw new Error('invalidCsv')
      field += character
    }
    if (field.length > VAULT_LIMITS.text) throw new Error('invalidCsv')
  }
  if (isQuoted) throw new Error('invalidCsv')
  if (hasQuoteEnded || field !== '' || row.length > 0) addRow()
  return rows
}

function seedOf(input: string): Buffer | null {
  if (input === '') return null
  if (!input.startsWith('otpauth://')) return decodeTotpSeed(input)
  const url = new URL(input)
  let hasInvalidParameters = false
  for (const key of url.searchParams.keys()) {
    if (
      !['secret', 'issuer', 'algorithm', 'digits', 'period'].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      hasInvalidParameters = true
  }
  if (
    hasInvalidParameters ||
    url.protocol !== 'otpauth:' ||
    url.hostname !== 'totp' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase() !== 'SHA1' ||
    (url.searchParams.get('digits') ?? '6') !== '6' ||
    (url.searchParams.get('period') ?? String(WEB_TOTP_PERIOD_SECONDS)) !==
      String(WEB_TOTP_PERIOD_SECONDS)
  )
    throw new Error('invalidCsv')
  return decodeTotpSeed(url.searchParams.get('secret') ?? '')
}

const CHROME_COLUMNS = ['name', 'url', 'username', 'password', 'note']
const BITWARDEN_COLUMNS = [
  'folder',
  'favorite',
  'type',
  'name',
  'notes',
  'fields',
  'reprompt',
  'login_uri',
  'login_username',
  'login_password',
  'login_totp',
]

function eraseItems(items: readonly VaultItem[]): void {
  for (const item of items) {
    for (const field of Object.values(item.material)) if (field instanceof Uint8Array) field.fill(0)
  }
}

/** The caller owns and erases the CSV bytes. No file, browser store or password manager is opened. */
export async function importWebLogins(
  csv: Uint8Array,
  deps: WebLoginImportPort,
): Promise<WebLoginImportResult> {
  const pending: VaultItem[] = []
  const saved: VaultItemMetadata[] = []
  try {
    if (csv.byteLength === 0 || csv.byteLength > VAULT_LIMITS.valueBytes)
      throw new Error('invalidCsv')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(csv)
    const [header, ...rows] = parseCsv(text)
    if (header === undefined || rows.length === 0 || new Set(header).size !== header.length)
      throw new Error('invalidCsv')
    const isBitwarden = header.includes('login_uri')
    const allowed = isBitwarden ? BITWARDEN_COLUMNS : CHROME_COLUMNS
    const required = isBitwarden
      ? ['type', 'login_uri', 'login_username', 'login_password']
      : ['url', 'username', 'password']
    if (
      header.some((key) => !allowed.includes(key)) ||
      required.some((key) => !header.includes(key))
    )
      throw new Error('invalidCsv')
    const existing = await deps.store.list()
    const ids = new Set(existing.map((item) => item.id))
    for (const row of rows) {
      if (row.length !== header.length) throw new Error('invalidCsv')
      const read = (column: string): string => row[header.indexOf(column)] ?? ''
      if (isBitwarden && read('type') !== 'login') throw new Error('invalidCsv')
      const origin = webOrigin(read(isBitwarden ? 'login_uri' : 'url'))
      const id = deps.randomId()
      if (ids.has(id)) throw new Error('invalidCsv')
      ids.add(id)
      const metadata = webItemMetadata('webLogin', id, origin, deps.now(), null)
      // Own every buffer before validation; any failed row erases the whole parsed import.
      const username = Buffer.alloc(
        Buffer.byteLength(read(isBitwarden ? 'login_username' : 'username')),
      )
      const password = Buffer.alloc(
        Buffer.byteLength(read(isBitwarden ? 'login_password' : 'password')),
      )
      let totpSeed: Buffer | null = null
      try {
        username.write(read(isBitwarden ? 'login_username' : 'username'))
        password.write(read(isBitwarden ? 'login_password' : 'password'))
        totpSeed = seedOf(read('login_totp'))
        const item = vaultItemSchema.parse({
          metadata,
          material: { kind: 'webLogin', origins: [origin], username, password, totpSeed },
        })
        pending.push(item)
      } catch {
        username.fill(0)
        password.fill(0)
        totpSeed?.fill(0)
        throw new Error('invalidCsv')
      }
    }
    if (!(await deps.review(pending.map((item) => structuredClone(item.metadata)))))
      return { kind: 'declined' }
    for (const item of pending) {
      await deps.store.write(item)
      saved.push(item.metadata)
    }
    return { kind: 'imported', items: saved }
  } catch {
    // A multi-item port has no transaction. Tell the host exactly what committed before failure.
    return { kind: 'failed', items: saved }
  } finally {
    eraseItems(pending)
  }
}
