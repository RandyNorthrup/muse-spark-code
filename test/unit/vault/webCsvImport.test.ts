import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  importWebLogins,
  type WebLoginImportPort,
  type WebLoginImportResult,
} from '../../../src/core/vault/web/csvImport'
import { type VaultItem } from '../../../src/shared/vault'
import { InMemoryVault } from '../helpers/vault/core'
import { WEB_ORIGIN, privateBytes, observeByteOwners } from './webFixture'
import { VAULT_LIMITS } from '../../../src/shared/constants'

function importFixture() {
  const store = new InMemoryVault()
  const writes: VaultItem[] = []
  const deps: WebLoginImportPort = {
    store: {
      list: () => store.list(),
      read: (id) => store.read(id),
      remove: (id) => store.remove(id),
      lock: () => {
        store.lock()
      },
      write: async (item) => {
        writes.push(item)
        await store.write(item)
      },
    },
    now: () => 1000,
    randomId: () => randomBytes(16).toString('hex'),
    review: vi.fn(() => Promise.resolve(true)),
  }
  return { store, writes, deps }
}
async function importedLogin(store: InMemoryVault, result: WebLoginImportResult) {
  if (result.kind !== 'imported' || result.items[0] === undefined) throw new Error('bad result')
  const saved = await store.read(result.items[0].id)
  if (saved.material.kind !== 'webLogin') throw new Error('bad login kind')
  return { metadata: saved.metadata, material: saved.material }
}
const CHROME_HEADER = 'name,url,username,password'
const ROW = `export name,${WEB_ORIGIN}/login,user,generated-test-value`

describe('vault explicit CSV import', () => {
  it('imports Chrome CSV after review and returns metadata only with ask-every-time policy', async () => {
    const f = importFixture()
    const csv = privateBytes(`${CHROME_HEADER}\r\n${ROW}\r\n`)
    const result = await importWebLogins(csv, f.deps)
    expect(result.kind).toBe('imported')
    if (result.kind !== 'imported' || result.items[0] === undefined) throw new Error('bad result')
    const meta = result.items[0]
    expect(meta.label).toBe(WEB_ORIGIN)
    expect(meta.policy).toEqual({
      mode: 'askEveryTime',
      unattendedAllowed: false,
      allowDisclosure: false,
    })
    expect(meta.name).toMatch(/^web-login-[a-f0-9]{32}$/u)
    expect(JSON.stringify(result)).not.toContain('generated-test-value')
    expect(JSON.stringify(result)).not.toContain('export name')
    expect(f.deps.review).toHaveBeenCalledWith(result.items)
    const stored = await f.store.read(meta.id)
    if (stored.material.kind !== 'webLogin') throw new Error('bad stored kind')
    expect(Buffer.from(stored.material.password).toString()).toBe('generated-test-value')
    expect(
      f.writes.every((item) =>
        Object.values(item.material).every(
          (field) => !(field instanceof Uint8Array) || field.every((byte) => byte === 0),
        ),
      ),
    ).toBe(true)
    csv.fill(0)
    f.store.lock()
  })
  it('accepts BOM, escaped quotes, commas and multiline fields without exposing them in labels', async () => {
    const f = importFixture()
    const csv = privateBytes(
      `\u{FEFF}${CHROME_HEADER}\n"name, hidden",${WEB_ORIGIN},"user\nname","with ""quotes"", commas"`,
    )
    const result = await importWebLogins(csv, f.deps)
    const saved = await importedLogin(f.store, result)
    expect(Buffer.from(saved.material.username).toString()).toBe('user\nname')
    expect(Buffer.from(saved.material.password).toString()).toBe('with "quotes", commas')
    expect(saved.metadata.label).toBe(WEB_ORIGIN)
    csv.fill(0)
    f.store.lock()
  })
  it('imports Bitwarden logins and canonical default TOTP seeds', async () => {
    for (const seed of [
      'MZXW6YTBOI======',
      'otpauth://totp/Example?secret=MZXW6YTBOI&issuer=Example&algorithm=SHA1&digits=6&period=30',
    ]) {
      const f = importFixture()
      const csv = privateBytes(
        `type,name,login_uri,login_username,login_password,login_totp\nlogin,label,${WEB_ORIGIN},user,test-value,${seed}`,
      )
      const result = await importWebLogins(csv, f.deps)
      const saved = await importedLogin(f.store, result)
      expect(Buffer.from(saved.material.totpSeed ?? []).toString()).toBe('foobar')
      csv.fill(0)
      f.store.lock()
    }
  })
  it('refuses unsupported TOTP settings, duplicate URI parameters, HOTP and malformed seeds', async () => {
    for (const seed of [
      'otpauth://hotp/X?secret=MY',
      'otpauth://totp:123/X?secret=MY',
      'otpauth://user:private@totp/X?secret=MY',
      'otpauth://totp/X?secret=MY#private',
      'otpauth://totp/X?secret=MY&algorithm=SHA256',
      'otpauth://totp/X?secret=MY&digits=8',
      'otpauth://totp/X?secret=MY&period=60',
      'otpauth://totp/X?secret=MY&secret=MY',
      'otpauth://totp/X?secret=MY&privateKey=bad',
      'MZ',
    ]) {
      const f = importFixture()
      const result = await importWebLogins(
        privateBytes(
          `type,login_uri,login_username,login_password,login_totp\nlogin,${WEB_ORIGIN},user,test,${seed}`,
        ),
        f.deps,
      )
      expect(result).toEqual({ kind: 'failed', items: [] })
      expect(f.writes).toHaveLength(0)
      expect(f.deps.review).not.toHaveBeenCalled()
    }
  })
  it('rejects malformed rows, unsafe origins, passkey columns and non-login types before any write', async () => {
    const invalid = [
      '',
      CHROME_HEADER,
      `${CHROME_HEADER}\n${ROW}\nmissing,columns`,
      `${CHROME_HEADER}\n${ROW},extra`,
      `${CHROME_HEADER}\nlabel,${WEB_ORIGIN},user,"unterminated`,
      `${CHROME_HEADER}\n"bad"suffix,${WEB_ORIGIN},user,value`,
      `${CHROME_HEADER}\nlabel,${WEB_ORIGIN},user,va"lue`,
      'url,username,password,password\nhttps://test.test,user,value,value',
      `name,url,username,password,passkey\n${ROW},private`,
      'type,login_uri,login_username,login_password\nnote,https://test.test,user,value',
      `url,username,password\nhttp://test.test,user,value`,
      `url,username,password\nhttps://user:pass@test.test,user,value`,
      `url,username,password\n${WEB_ORIGIN},user,`,
    ]
    for (const text of invalid) {
      const f = importFixture()
      expect(await importWebLogins(privateBytes(text), f.deps)).toEqual({
        kind: 'failed',
        items: [],
      })
      expect(f.writes).toHaveLength(0)
      expect(f.deps.review).not.toHaveBeenCalled()
    }
  })
  it('a declined review writes nothing and wipes every prepared credential buffer', async () => {
    const f = importFixture()
    f.deps.review = () => Promise.resolve(false)
    const csv = privateBytes(`${CHROME_HEADER}\n${ROW}`)
    const owners = observeByteOwners()
    try {
      expect(await importWebLogins(csv, f.deps)).toEqual({ kind: 'declined' })
      expect(owners.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    } finally {
      owners.restore()
      csv.fill(0)
    }
    expect(f.writes).toHaveLength(0)
    expect(await f.store.list()).toHaveLength(0)
  })
  it('bounds import rows before review even when the file fits its byte budget', async () => {
    const f = importFixture()
    f.deps.review = () => Promise.resolve(false)
    const csv = privateBytes(`${CHROME_HEADER}\n${`${ROW}\n`.repeat(VAULT_LIMITS.items + 1)}`)
    expect(csv.byteLength).toBeLessThan(VAULT_LIMITS.valueBytes)
    expect(await importWebLogins(csv, f.deps)).toEqual({ kind: 'failed', items: [] })
    expect(f.writes).toHaveLength(0)
    csv.fill(0)
  })
  it('refuses oversized files/fields and malformed UTF-8 rather than importing changed passwords', async () => {
    const oversized = privateBytes(
      `${CHROME_HEADER}\n${`${ROW}${'x'.repeat(VAULT_LIMITS.text - 'generated-test-value'.length)}\n`.repeat(300)}`,
    )
    expect(oversized.byteLength).toBeGreaterThan(VAULT_LIMITS.valueBytes)
    const field = privateBytes(
      `${CHROME_HEADER}\nlabel,${WEB_ORIGIN},user,${'x'.repeat(VAULT_LIMITS.text + 1)}`,
    )
    const invalid = Buffer.concat([
      privateBytes(`${CHROME_HEADER}\nlabel,${WEB_ORIGIN},user,`),
      Buffer.alloc(1, 0xff),
    ])
    for (const csv of [oversized, field, invalid]) {
      const f = importFixture()
      expect(await importWebLogins(csv, f.deps)).toEqual({ kind: 'failed', items: [] })
      expect(f.writes).toHaveLength(0)
      csv.fill(0)
    }
  })
  it('reports partial writes explicitly and never echoes the storage exception', async () => {
    const f = importFixture()
    const write = f.deps.store.write
    let count = 0
    f.deps.store.write = async (item) => {
      if (count++ === 1) throw new Error('private storage exception')
      await write(item)
    }
    const result = await importWebLogins(privateBytes(`${CHROME_HEADER}\n${ROW}\n${ROW}`), f.deps)
    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') throw new Error('bad result')
    expect(result.items).toHaveLength(1)
    expect(await f.store.list()).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('private')
    expect(f.writes[0]?.material.kind).toBe('webLogin')
    f.store.lock()
  })
  it('refuses duplicate generated identities before review and leaves existing items intact', async () => {
    const f = importFixture()
    const deps = { ...f.deps, randomId: () => 'a'.repeat(32) }
    expect(await importWebLogins(privateBytes(`${CHROME_HEADER}\n${ROW}\n${ROW}`), deps)).toEqual({
      kind: 'failed',
      items: [],
    })
    expect(f.writes).toHaveLength(0)
  })
})
