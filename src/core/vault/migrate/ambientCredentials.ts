import * as z from 'zod/mini'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type VaultItem, type VaultBinding } from '../../../shared/vault'
import { type AmbientFile } from './ambient'
import { VaultMigrationFault } from './ports'

export interface AmbientCredential {
  /** Private import review hint; never copied to an agent-visible label without user review. */
  target: string
  bindings: readonly VaultBinding[]
  material: VaultItem['material']
}
function owned(value: string): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(Buffer.byteLength(value))
  bytes.write(value)
  return bytes
}
function password(
  target: string,
  username: string,
  value: string,
  bindings: readonly VaultBinding[] = [],
): AmbientCredential {
  if (username === '' || value === '') throw new VaultMigrationFault('invalid')
  return {
    target,
    bindings,
    material: { kind: 'password', username: owned(username), password: owned(value) },
  }
}
function secret(target: string, value: string): AmbientCredential {
  if (value === '') throw new VaultMigrationFault('invalid')
  return { target, bindings: [], material: { kind: 'secret', value: owned(value) } }
}
function git(text: string, result: AmbientCredential[]): void {
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    const url = new URL(line)
    if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '')
      throw new VaultMigrationFault('invalid')
    result.push(
      password(url.origin, decodeURIComponent(url.username), decodeURIComponent(url.password), [
        { kind: 'git', protocol: 'https', host: url.host, path: url.pathname.slice(1) || '/' },
      ]),
    )
  }
}
function netrc(text: string, result: AmbientCredential[]): void {
  // Refuse default and macdef; neither has an exact target/finite credential grammar.
  const tokens = text.replaceAll(/^\s*#[^\r\n]*$/gmu, '').match(/"(?:[^"\\]|\\.)*"|[^\s]+/gu) ?? []
  let machine = ''
  let username = ''
  let value = ''
  function flush(): void {
    if (machine !== '') result.push(password(machine, username, value))
    username = ''
    value = ''
  }
  for (let index = 0; index < tokens.length; index += 2) {
    const token = tokens[index]
    let next = tokens[index + 1]
    if (!next || !['machine', 'login', 'password'].includes(token ?? ''))
      throw new VaultMigrationFault('invalid')
    if (next.startsWith('"')) {
      if (!next.endsWith('"')) throw new VaultMigrationFault('invalid')
      next = next.slice(1, -1).replaceAll(/\\(.)/gu, '$1')
    }
    if (token === 'machine') {
      flush()
      machine = next
    } else if (machine === '') throw new VaultMigrationFault('invalid')
    else if (token === 'login' && username === '') username = next
    else if (token === 'password' && value === '') value = next
    else throw new VaultMigrationFault('invalid')
  }
  flush()
}
function ini(kind: 'npm' | 'aws', text: string, result: AmbientCredential[]): void {
  let section = 'default'
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    if (/^\[[^\]\r\n]+\]$/u.test(trimmed)) {
      section = trimmed.slice(1, -1)
      continue
    }
    const equals = trimmed.indexOf('=')
    if (equals < 1) throw new VaultMigrationFault('invalid')
    const key = trimmed.slice(0, equals).trim()
    if (
      kind === 'aws' &&
      ![
        'aws_access_key_id',
        'aws_secret_access_key',
        'aws_session_token',
        'aws_security_token',
      ].includes(key)
    )
      continue
    if (kind === 'npm' && !/(?:^|:)(?:_authToken|_auth|_password)$/u.test(key)) continue
    const value = trimmed.slice(equals + 1).trim()
    const target = `${section}:${key}`
    if (seen.has(target) || value.includes('${')) throw new VaultMigrationFault('invalid')
    seen.add(target)
    // _auth/_password are base64 in npmrc; preserve their wire representation for scoped environment use.
    result.push(secret(target, value))
  }
}
const dockerSchema = z.looseObject({
  auths: z.optional(
    z.record(
      z.string(),
      z.looseObject({
        auth: z.optional(z.string()),
        identitytoken: z.optional(z.string()),
      }),
    ),
  ),
})
function docker(text: string, result: AmbientCredential[]): void {
  const parsed: unknown = JSON.parse(text)
  const config = dockerSchema.parse(parsed)
  const entries = Object.entries(config.auths ?? {})
  for (const [target, entry] of entries) {
    if (entry.auth !== undefined) {
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(entry.auth)) throw new VaultMigrationFault('invalid')
      const decoded = Buffer.alloc(Buffer.byteLength(entry.auth, 'base64'))
      try {
        decoded.write(entry.auth, 'base64')
        if (decoded.toString('base64') !== entry.auth) throw new VaultMigrationFault('invalid')
        const value = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
        const colon = value.indexOf(':')
        if (colon < 1) throw new VaultMigrationFault('invalid')
        result.push(password(target, value.slice(0, colon), value.slice(colon + 1)))
      } finally {
        decoded.fill(0)
      }
    }
    if (entry.identitytoken !== undefined) result.push(secret(target, entry.identitytoken))
  }
  // credsStore/credHelpers are intentionally never invoked or read.
}

/** Private drafts only. U/H require a reviewed name/label and grants; no ambient Always grant. */
export function parseAmbientCredentials(
  kind: Exclude<AmbientFile['kind'], 'ssh' | 'csv'>,
  bytes: Uint8Array,
): readonly AmbientCredential[] {
  const result: AmbientCredential[] = []
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > VAULT_LIMITS.valueBytes)
      throw new VaultMigrationFault('invalid')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\0')) throw new VaultMigrationFault('invalid')
    switch (kind) {
      case 'git': {
        git(text, result)
        break
      }
      case 'netrc': {
        netrc(text, result)
        break
      }
      case 'npm':
      case 'aws': {
        ini(kind, text, result)
        break
      }
      case 'docker': {
        docker(text, result)
        break
      }
    }
    if (result.length === 0 || result.length > VAULT_LIMITS.items)
      throw new VaultMigrationFault('invalid')
    return result
  } catch {
    for (const entry of result)
      for (const field of Object.values(entry.material))
        if (field instanceof Uint8Array) field.fill(0)
    throw new VaultMigrationFault('invalid')
  }
}
