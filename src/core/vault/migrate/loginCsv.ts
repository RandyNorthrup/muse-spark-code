import { VAULT_LIMITS } from '../../../shared/constants'
import { vaultMaterialSchema, type VaultItem } from '../../../shared/vault'
import { VaultMigrationFault } from './ports'

export interface LoginCsvColumns {
  label: string
  url: string
  username: string
  password: string
  totpSeed: string | null
}
export interface ImportedLogin {
  label: string
  material: Extract<VaultItem['material'], { kind: 'webLogin' }>
}

function owned(value: string): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(Buffer.byteLength(value))
  bytes.write(value)
  return bytes
}

/** Quoted commas, escaped quotes and multiline fields; never silently repairs malformed CSV. */
function rows(text: string): string[][] {
  const result: string[][] = []
  let row: string[] = []
  let field = ''
  let isQuoted = false
  let isClosed = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (isQuoted) {
      if (char !== '"') field += char
      else if (text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        isQuoted = false
        isClosed = true
      }
    } else if ([',', '\n', '\r'].includes(char)) {
      row.push(field)
      field = ''
      isClosed = false
      if (char !== ',') {
        if (char === '\r' && text[index + 1] === '\n') index += 1
        result.push(row)
        row = []
        if (result.length > VAULT_LIMITS.items + 1) throw new VaultMigrationFault('invalid')
      }
    } else if (!isClosed && field === '' && char === '"') isQuoted = true
    else if (char === '"' || isClosed) throw new VaultMigrationFault('invalid')
    else field += char
  }
  if (isQuoted) throw new VaultMigrationFault('invalid')
  if (isClosed || field !== '' || row.length > 0) {
    row.push(field)
    result.push(row)
  }
  return result
}

/** L supplies the reviewed export-column mapping and builds user-named items; no password-manager store is opened. */
export function parseLoginCsv(
  bytes: Uint8Array,
  columns: LoginCsvColumns,
  /** L decodes supported TOTP exports; returned bytes transfer ownership. */
  decodeTotp: ((value: string) => Uint8Array) | null,
): readonly ImportedLogin[] {
  const imported: ImportedLogin[] = []
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > VAULT_LIMITS.valueBytes)
      throw new VaultMigrationFault('invalid')
    const table = rows(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\u{FEFF}/u, ''),
    )
    const header = table.shift() ?? []
    if (header.length === 0 || new Set(header).size !== header.length)
      throw new VaultMigrationFault('invalid')
    const required = [columns.label, columns.url, columns.username, columns.password]
    if (columns.totpSeed !== null) required.push(columns.totpSeed)
    if (
      new Set(required).size !== required.length ||
      required.some((name) => !header.includes(name))
    )
      throw new VaultMigrationFault('invalid')
    for (const row of table) {
      if (row.length !== header.length || row.some((field) => field.includes('\0')))
        throw new VaultMigrationFault('invalid')
      const get = (name: string): string => {
        const value = row[header.indexOf(name)]
        if (value === undefined) throw new VaultMigrationFault('invalid')
        return value
      }
      const url = new URL(get(columns.url))
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
        throw new VaultMigrationFault('invalid')
      let totpSeed: Buffer<ArrayBuffer> | null = null
      if (columns.totpSeed !== null && get(columns.totpSeed) !== '') {
        if (decodeTotp === null) throw new VaultMigrationFault('invalid')
        const decoded = decodeTotp(get(columns.totpSeed))
        try {
          totpSeed = Buffer.alloc(decoded.byteLength)
          totpSeed.set(decoded)
        } finally {
          decoded.fill(0)
        }
      }
      const material: ImportedLogin['material'] = {
        kind: 'webLogin',
        origins: [url.origin],
        username: owned(get(columns.username)),
        password: owned(get(columns.password)),
        totpSeed,
      }
      imported.push({ label: get(columns.label), material })
      if (!vaultMaterialSchema.safeParse(material).success) throw new VaultMigrationFault('invalid')
    }
    if (imported.length === 0 || imported.length > VAULT_LIMITS.items)
      throw new VaultMigrationFault('invalid')
    return imported
  } catch {
    for (const login of imported)
      for (const field of Object.values(login.material))
        if (field instanceof Uint8Array) field.fill(0)
    throw new VaultMigrationFault('invalid')
  }
}
