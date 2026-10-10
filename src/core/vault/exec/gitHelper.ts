import { UI_TEXT, MILLISECONDS_PER_SECOND, VAULT_LIMITS } from '../../../shared/constants'
import { type VaultUse } from '../../../shared/vault'

/** Only the exact HTTPS path receives a generated answer; store/erase never persist anything. */
export function gitCredentialAnswer(
  use: Extract<VaultUse, { kind: 'git' }>,
  operation: string,
  input: string,
  username: Uint8Array | null,
  password: Uint8Array,
  expiresAt: number,
  now: number = Date.now(),
): Buffer {
  if (operation !== 'get') return Buffer.alloc(0)
  if (now >= expiresAt) throw new Error(UI_TEXT.vault.noAccess)
  if (Buffer.byteLength(input) > VAULT_LIMITS.text) throw new Error(UI_TEXT.vault.noAccess)
  const fields = new Map<string, string>()
  for (const line of input.split(/\r?\n/u)) {
    if (line === '') break
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(UI_TEXT.vault.noAccess)
    const name = line.slice(0, separator)
    if (fields.has(name)) throw new Error(UI_TEXT.vault.noAccess)
    fields.set(name, line.slice(separator + 1))
  }
  if (
    fields.get('protocol') !== use.protocol ||
    fields.get('host') !== use.host ||
    fields.get('path') !== use.path
  )
    throw new Error(UI_TEXT.vault.noAccess)
  const user = username ?? Buffer.alloc(0)
  for (const bytes of [user, password])
    if (
      bytes.includes(0) ||
      bytes.includes('\n'.codePointAt(0) ?? 0) ||
      bytes.includes('\r'.codePointAt(0) ?? 0)
    )
      throw new Error(UI_TEXT.vault.noAccess)
  const prefix = Buffer.from(username === null ? '' : 'username=')
  const middle = Buffer.from(username === null ? 'password=' : '\npassword=')
  const suffix = Buffer.from(
    `\npassword_expiry_utc=${String(Math.floor(expiresAt / MILLISECONDS_PER_SECOND))}\nephemeral=true\n\n`,
  )
  const output = Buffer.alloc(
    prefix.length + user.length + middle.length + password.length + suffix.length,
  )
  let offset = 0
  for (const bytes of [prefix, user, middle, password, suffix]) {
    output.set(bytes, offset)
    offset += bytes.length
  }
  return output
}
