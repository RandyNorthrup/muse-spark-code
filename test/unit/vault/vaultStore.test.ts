import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as filesystem from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeVaultFiles, VaultStore } from '../../../src/core/vault/store'
import {
  decodeVaultMaterial,
  encodeVaultMaterial,
  eraseVaultMaterial,
  ownedBytes,
  randomVaultBytes,
} from '../../../src/core/vault/crypto'
import { createRecoverySlot, unlockRecoverySlot } from '../../../src/core/vault/keyslots'
import * as vaultCrypto from '../../../src/core/vault/crypto'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { item } from '../helpers/vault/fixtures'
import { FakeVaultClock } from '../helpers/vault/core'
import { freshVault, jsonRecord, MemoryVaultFiles } from './storeFixtures'

const directories: string[] = []
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof filesystem>()
  return { ...original, rename: vi.fn(original.rename), lstat: vi.fn(original.lstat) }
})
async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(await filesystem.realpath(tmpdir()), 'm109-c-'))
  directories.push(root)
  return root
}
afterEach(async () => {
  vi.restoreAllMocks()
  const original = await vi.importActual<typeof filesystem>('node:fs/promises')
  vi.mocked(filesystem.rename).mockImplementation(original.rename)
  vi.mocked(filesystem.lstat).mockImplementation(original.lstat)
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('encrypted vault store', () => {
  it('provides validated unlock hints and authenticates recovered keys before opening', async () => {
    const vault = await freshVault()
    const hints = await VaultStore.slotRecords(vault.files, vault.vaultId)
    const hint = hints[0]
    if (!hint) throw new Error('unlock hint')
    vault.store.lock()
    const recovered = unlockRecoverySlot(hint, vault.recovery.code)
    const opened = await VaultStore.open({ ...vault.options, key: recovered }, vault.vaultId)
    expect(await opened.list()).toEqual([])
    await expect(VaultStore.slotRecords(vault.files, 'b'.repeat(32))).rejects.toThrow()
    await expect(VaultStore.slotRecords(new MemoryVaultFiles(), vault.vaultId)).rejects.toThrow()
  })
  it('zeroes the held key at lock and erases material when writer cleanup rejects a read', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const secret = item()
    await vault.store.write(secret)
    const decoded: ReturnType<typeof decodeVaultMaterial>[] = []
    const decode = vaultCrypto.decodeVaultMaterial
    vi.spyOn(vaultCrypto, 'decodeVaultMaterial').mockImplementation((bytes) => {
      const result = decode(bytes)
      decoded.push(result)
      return result
    })
    const writer = files.withWriter.bind(files)
    files.withWriter = async (operation) => {
      await writer(operation)
      throw new Error('generated cleanup failure')
    }
    await expect(vault.store.read(secret.metadata.id)).rejects.toThrow()
    expect(decoded.length).toBe(1)
    for (const material of decoded)
      for (const bytes of Object.values(material))
        if (bytes instanceof Uint8Array) expect(bytes.every((byte) => byte === 0)).toBe(true)
    const held: unknown = Reflect.get(vault.store, 'key')
    if (!Buffer.isBuffer(held)) throw new Error('owned key')
    vault.store.lock()
    expect(held.every((byte) => byte === 0)).toBe(true)
  })
  it('rejects oversized publication before advancing the independent anchor', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    Reflect.set(files, 'maxBytes', 1)
    await expect(vault.store.write(item())).rejects.toMatchObject({ code: 'invalid' })
    const state = await vault.anchor.minimum(vault.vaultId)
    expect(state?.generation).toBe(1)
  })
  it('creates, reads, updates, removes, reopens and refuses access after lock', async () => {
    const vault = await freshVault()
    const first = item()
    await vault.store.write(first)
    expect(await vault.store.list()).toEqual([first.metadata])
    const read = await vault.store.read(first.metadata.id)
    expect(read).toEqual(first)
    eraseVaultMaterial(read.material)
    const changed = { ...first, material: { kind: 'secret', value: randomVaultBytes() } as const }
    await vault.store.write(changed)
    expect(await vault.store.read(first.metadata.id)).toEqual(changed)
    const opened = await VaultStore.open(vault.options, vault.vaultId)
    await opened.remove(first.metadata.id)
    expect(await vault.store.list()).toEqual([])
    await expect(vault.store.remove(first.metadata.id)).rejects.toMatchObject({ code: 'invalid' })
    opened.lock()
    await expect(opened.list()).rejects.toMatchObject({ code: 'locked' })
    await expect(opened.read(first.metadata.id)).rejects.toMatchObject({ code: 'locked' })
    expect(vault.key.some((byte) => byte !== 0)).toBe(true)
    const snapshot = await vault.store.exportSnapshot()
    expect(snapshot.document.generation).toBe(4)
    expect(snapshot.slots.records.every((record) => record.lastGeneration === 4)).toBe(true)
  })
  it('persists no value, name, label, origin or policy in plaintext and authenticates swapped blocks', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const first = item()
    first.metadata.name = `canary-${randomVaultBytes(8).toString('hex')}`
    first.metadata.handle = `secret://${first.metadata.name}`
    first.metadata.label = `label-${randomVaultBytes(8).toString('hex')}`
    first.metadata.bindings = [{ kind: 'origin', origin: 'https://private.example.com' }]
    const second = item()
    second.metadata.id = randomVaultBytes(16).toString('hex')
    second.metadata.name = 'second'
    second.metadata.handle = 'secret://second'
    await vault.store.write(first)
    await vault.store.write(second)
    for (const bytes of files.data.values()) {
      for (const canary of [
        first.metadata.name,
        first.metadata.label,
        'private.example.com',
        'askEveryTime',
      ])
        expect(bytes.includes(canary)).toBe(false)
      if (first.material.kind !== 'secret') throw new Error('fixture')
      expect(bytes.includes(Buffer.from(first.material.value))).toBe(false)
      expect(bytes.includes(Buffer.from(first.material.value).toString('base64'))).toBe(false)
    }
    const snapshot = await vault.store.exportSnapshot()
    const left = snapshot.document.items[0]
    const right = snapshot.document.items[1]
    if (!left || !right) throw new Error('two entries')
    // Preserve each public generation while swapping ciphertext between identities.
    const block = left.block
    left.block = { ...right.block, generation: block.generation }
    right.block = { ...block, generation: right.block.generation }
    files.data.set('vault.v1', Buffer.from(JSON.stringify(snapshot.document)))
    await expect(vault.store.read(first.metadata.id)).rejects.toThrow()
  })
  it('refuses rollback of the vault alone, both files, and audit head; never returns material', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const old = new Map(Array.from(files.data, ([name, bytes]) => [name, ownedBytes(bytes)]))
    const secret = item()
    await vault.store.write(secret)
    const current = new Map(files.data)
    const oldDocument = old.get('vault.v1')
    if (!oldDocument) throw new Error('snapshot')
    files.data.set('vault.v1', oldDocument)
    await expect(vault.store.read(secret.metadata.id)).rejects.toMatchObject({ code: 'rollback' })
    for (const [name, bytes] of old) files.data.set(name, bytes)
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'rollback' })
    for (const [name, bytes] of current) files.data.set(name, bytes)
    await vault.store.commitAudit(1, 'f'.repeat(64))
    const audited = await vault.store.exportSnapshot()
    expect(audited.slots.auditGeneration).toBe(1)
    await expect(vault.store.commitAudit(1, 'e'.repeat(64))).rejects.toMatchObject({
      code: 'rollback',
    })
    await expect(vault.store.commitAudit(0, 'e'.repeat(64))).rejects.toMatchObject({
      code: 'rollback',
    })
    const minimum = vault.anchor.states.get(vault.vaultId)
    if (!minimum) throw new Error('anchor')
    vault.anchor.states.set(vault.vaultId, { ...minimum, auditHead: 'a'.repeat(64) })
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'rollback' })
  })
  it('checks key, identity, authenticated slots, exact inventory and unique names before use', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    await expect(
      VaultStore.open({ ...vault.options, key: randomVaultBytes() }, vault.vaultId),
    ).rejects.toThrow()
    await expect(VaultStore.open(vault.options, 'b'.repeat(32))).rejects.toThrow()
    const savedSlots = files.data.get('slots.v1')
    if (!savedSlots) throw new Error('slots')
    const changed = jsonRecord(savedSlots)
    changed['generation'] = 2
    files.data.set('slots.v1', Buffer.from(JSON.stringify(changed)))
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'authentication' })
    files.data.set('slots.v1', savedSlots)
    const wrongMac = jsonRecord(savedSlots)
    wrongMac['mac'] = randomVaultBytes().toString('base64')
    files.data.set('slots.v1', Buffer.from(JSON.stringify(wrongMac)))
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'authentication' })
    files.data.set('slots.v1', savedSlots)
    const first = item()
    await vault.store.write(first)
    const duplicate = item()
    duplicate.metadata.id = randomVaultBytes(16).toString('hex')
    await expect(vault.store.write(duplicate)).rejects.toMatchObject({ code: 'invalid' })
    const snapshot = await vault.store.exportSnapshot()
    snapshot.document.items.push({
      id: randomVaultBytes(16).toString('hex'),
      block: structuredClone(snapshot.document.index),
    })
    files.data.set('vault.v1', Buffer.from(JSON.stringify(snapshot.document)))
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'invalid' })
  })
  it('enforces the configured item ceiling and refuses basic_text slot records', async () => {
    const vault = await freshVault()
    await vault.store.write(item())
    const limit = VAULT_LIMITS.items
    try {
      Reflect.set(VAULT_LIMITS, 'items', 1)
      const extra = item()
      extra.metadata.id = randomVaultBytes(16).toString('hex')
      extra.metadata.name = 'other'
      extra.metadata.handle = 'secret://other'
      await expect(vault.store.write(extra)).rejects.toThrow()
    } finally {
      Reflect.set(VAULT_LIMITS, 'items', limit)
    }
    const unsafe = structuredClone(vault.recovery.slot)
    Reflect.set(unsafe, 'tier', 'secretStorage')
    Reflect.set(unsafe, 'provider', 'secretStorage')
    Reflect.set(unsafe, 'backend', 'basic_text')
    await expect(vault.store.setSlots([unsafe])).rejects.toThrow()
  })
  it('binds public block generations before listing, even with an authenticated index', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    await vault.store.write(item())
    const snapshot = await vault.store.exportSnapshot()
    const block = snapshot.document.items[0]?.block
    if (!block) throw new Error('block')
    block.generation += 1
    files.data.set('vault.v1', Buffer.from(JSON.stringify(snapshot.document)))
    await expect(vault.store.list()).rejects.toThrow()
  })
  it('refuses authenticated material whose kind differs from the encrypted index', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const secret = item()
    await vault.store.write(secret)
    const snapshot = await vault.store.exportSnapshot()
    const entry = snapshot.document.items[0]
    if (!entry) throw new Error('entry')
    const plaintext = encodeVaultMaterial({
      kind: 'password',
      username: null,
      password: randomVaultBytes(),
    })
    entry.block = vaultCrypto.sealVaultBlock(
      vault.key,
      {
        vaultId: vault.vaultId,
        id: secret.metadata.id,
        kind: 'secret',
        generation: entry.block.generation,
      },
      plaintext,
    )
    plaintext.fill(0)
    files.data.set('vault.v1', Buffer.from(JSON.stringify(snapshot.document)))
    await expect(vault.store.read(secret.metadata.id)).rejects.toMatchObject({ code: 'invalid' })
  })
  it('refuses a pending generation jump or audit-anchor mismatch and recovers initial preparation without an anchor', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    await vault.store.commitAudit(1, 'f'.repeat(64))
    const snapshot = await vault.store.exportSnapshot()
    files.data.set('pending.v1', Buffer.from(JSON.stringify(snapshot)))
    vault.anchor.states.set(vault.vaultId, {
      generation: 0,
      auditGeneration: 0,
      auditHead: '0'.repeat(64),
    })
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'rollback' })
    for (const state of [
      { generation: 2, auditGeneration: 2, auditHead: 'f'.repeat(64) },
      { generation: 2, auditGeneration: 1, auditHead: 'e'.repeat(64) },
      { generation: 2, auditGeneration: 0, auditHead: '0'.repeat(64) },
    ]) {
      vault.anchor.states.set(vault.vaultId, state)
      const unchanged = new Map(files.data)
      await expect(vault.store.list()).rejects.toMatchObject({ code: 'rollback' })
      expect(files.data).toEqual(unchanged)
    }
    const created = new MemoryVaultFiles()
    const key = randomVaultBytes()
    const vaultId = randomVaultBytes(16).toString('hex')
    const recovery = createRecoverySlot(key, vaultId, new FakeVaultClock())
    const advance = vault.anchor.advance.bind(vault.anchor)
    vault.anchor.advance = () => Promise.reject(new Error('generated prepare failure'))
    const options = { files: created, anchor: vault.anchor, key }
    await expect(VaultStore.create(options, vaultId, [recovery.slot])).rejects.toThrow()
    vault.anchor.advance = advance
    const opened = await VaultStore.open(options, vaultId)
    expect(await opened.list()).toEqual([])
  })
  it('authenticates every pending item before recovery publishes or consumes the record', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    files.fail = 'vault.v1'
    await expect(vault.store.write(item())).rejects.toThrow()
    files.fail = null
    const bytes = files.data.get('pending.v1')
    if (!bytes) throw new Error('prepared snapshot')
    const prepared = jsonRecord(bytes)
    const document = prepared['document']
    if (document === null || typeof document !== 'object') throw new Error('document')
    const entries: unknown = Reflect.get(document, 'items')
    if (!Array.isArray(entries)) throw new Error('entries')
    const entry: unknown = entries[0]
    if (entry === null || typeof entry !== 'object') throw new Error('entry')
    const block: unknown = Reflect.get(entry, 'block')
    if (block === null || typeof block !== 'object') throw new Error('block')
    Reflect.set(block, 'tag', randomVaultBytes(16).toString('base64'))
    files.data.set('pending.v1', Buffer.from(JSON.stringify(prepared)))
    const unchanged = new Map(files.data)
    await expect(VaultStore.open(vault.options, vault.vaultId)).rejects.toThrow()
    expect(files.data).toEqual(unchanged)
  })
  it('requires at least one valid slot and allows adding/removing slots only while unlocked', async () => {
    const vault = await freshVault()
    await expect(vault.store.setSlots([])).rejects.toMatchObject({ code: 'invalid' })
    const extra = createRecoverySlot(vault.key, vault.vaultId, new FakeVaultClock())
    await vault.store.setSlots([extra.slot, vault.recovery.slot])
    const snapshot = await vault.store.exportSnapshot()
    expect(snapshot.slots.records.length).toBe(2)
    await expect(vault.store.setSlots([extra.slot, extra.slot])).rejects.toThrow()
    await expect(
      vault.store.setSlots([{ ...extra.slot, vaultId: 'b'.repeat(32) }]),
    ).rejects.toThrow()
    vault.store.lock()
    await expect(vault.store.setSlots([extra.slot])).rejects.toMatchObject({ code: 'locked' })
  })
  it('advances the independent anchor before publication and fails closed after interrupted writes', async () => {
    for (const name of ['slots.v1', 'vault.v1'] as const) {
      const files = new MemoryVaultFiles()
      const vault = await freshVault(files)
      files.fail = name
      const secret = item()
      await expect(vault.store.write(secret)).rejects.toMatchObject({ code: 'io' })
      const minimum = await vault.anchor.minimum(vault.vaultId)
      expect(minimum?.generation).toBe(2)
      await expect(vault.store.list()).rejects.toMatchObject({ code: 'locked' })
      files.fail = null
      const recovered = await VaultStore.open(vault.options, vault.vaultId)
      expect(await recovered.read(secret.metadata.id)).toEqual(secret)
      expect(files.data.has('pending.v1')).toBe(false)
    }
  })
  it('recovers a prepared commit before anchor advancement and a partial creation; refuses corrupt or stale pending records', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    const saved = await vault.store.exportSnapshot()
    const advance = vault.anchor.advance.bind(vault.anchor)
    vault.anchor.advance = () => Promise.reject(new Error('generated anchor failure'))
    const secret = item()
    await expect(vault.store.write(secret)).rejects.toThrow()
    const minimum = await vault.anchor.minimum(vault.vaultId)
    expect(minimum?.generation).toBe(1)
    vault.anchor.advance = advance
    const recovered = await VaultStore.open(vault.options, vault.vaultId)
    expect(await recovered.read(secret.metadata.id)).toEqual(secret)
    files.data.set('pending.v1', Buffer.from(JSON.stringify(saved)))
    await expect(recovered.list()).rejects.toMatchObject({ code: 'rollback' })
    files.data.set('pending.v1', Buffer.from('{'))
    await expect(recovered.list()).rejects.toMatchObject({ code: 'invalid' })
    const created = new MemoryVaultFiles()
    created.fail = 'slots.v1'
    const key = randomVaultBytes()
    const vaultId = randomVaultBytes(16).toString('hex')
    const recovery = createRecoverySlot(key, vaultId, new FakeVaultClock())
    const options = { files: created, anchor: vault.anchor, key }
    await expect(VaultStore.create(options, vaultId, [recovery.slot])).rejects.toThrow()
    const hints = await VaultStore.slotRecords(created, vaultId)
    expect(hints[0]?.id).toBe(recovery.slot.id)
    created.fail = null
    const reopened = await VaultStore.open(options, vaultId)
    expect(await reopened.list()).toEqual([])
  })
  it('owns writes before awaiting and refuses an in-flight read when lock happens', async () => {
    const vault = await freshVault()
    const secret = item()
    const expected = {
      metadata: structuredClone(secret.metadata),
      material: decodeVaultMaterial(encodeVaultMaterial(secret.material)),
    }
    const writing = vault.store.write(secret)
    secret.metadata.label = 'changed after dispatch'
    if (secret.material.kind !== 'secret') throw new Error('fixture')
    secret.material.value.fill(0)
    await writing
    expect(await vault.store.read(expected.metadata.id)).toEqual(expected)
    const reading = vault.store.read(expected.metadata.id)
    vault.store.lock()
    await expect(reading).rejects.toMatchObject({ code: 'locked' })
  })
  it('refuses malformed/missing documents, missing anchor, overwrite-create and invalid material', async () => {
    const files = new MemoryVaultFiles()
    const vault = await freshVault(files)
    await expect(
      VaultStore.create(vault.options, vault.vaultId, [vault.recovery.slot]),
    ).rejects.toThrow()
    await expect(vault.store.read('b'.repeat(32))).rejects.toThrow()
    const invalid = item()
    invalid.material = { kind: 'secret', value: new Uint8Array() }
    await expect(vault.store.write(invalid)).rejects.toThrow()
    vault.anchor.states.clear()
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'rollback' })
    files.data.set('vault.v1', Buffer.from('{'))
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'invalid' })
    files.data.delete('slots.v1')
    await expect(vault.store.list()).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      VaultStore.open({ ...vault.options, key: Buffer.alloc(31) }, vault.vaultId),
    ).rejects.toThrow()
  })
})

describe('native files and platform ports', () => {
  it('creates its native fixture under an existing OS temporary parent', async () => {
    const root = await directory()
    const parent = await filesystem.realpath(tmpdir())
    expect(path.dirname(root)).toBe(parent)
    const sample = await lstat(root)
    expect(sample.isDirectory()).toBe(true)
  })
  it('refuses a foreign POSIX owner reported by the filesystem before running a writer', async () => {
    const root = await directory()
    const original = await vi.importActual<typeof filesystem>('node:fs/promises')
    vi.spyOn(filesystem, 'lstat').mockImplementation(async (file, options) => {
      const sample = await original.lstat(file, options)
      Reflect.set(sample, 'uid', Number(sample.uid) + 1)
      return sample
    })
    const files = new NodeVaultFiles(root, 1024, undefined, 'linux')
    await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({ code: 'io' })
  })
  it('keeps the complete old file visible until its fully written replacement is renamed', async () => {
    const root = await directory()
    const files = new NodeVaultFiles(root, 1024)
    await files.writeAtomic('vault.v1', Buffer.from('complete-old'))
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = await vi.importActual<typeof filesystem>('node:fs/promises')
    const nativeRename = original.rename
    vi.spyOn(filesystem, 'rename').mockImplementation(async (source, destination) => {
      entered.resolve(undefined)
      await release.promise
      await nativeRename(source, destination)
    })
    const writing = files.writeAtomic('vault.v1', Buffer.from('complete-new'))
    await entered.promise
    try {
      const old = await readFile(path.join(root, 'vault.v1'))
      expect(old.toString()).toBe('complete-old')
    } finally {
      release.resolve(undefined)
      await writing
    }
    const published = await readFile(path.join(root, 'vault.v1'))
    expect(published.toString()).toBe('complete-new')
  })
  it('writes owner-only files with synced atomic replacement and no plaintext in any file', async () => {
    const root = await directory()
    const files = new NodeVaultFiles(path.join(root, 'vault'), 4 * 1024 * 1024)
    const vault = await freshVault(files)
    const secret = item()
    await vault.store.write(secret)
    await vault.store.write(secret)
    expect(await vault.store.read(secret.metadata.id)).toEqual(secret)
    const listing = await readdir(path.join(root, 'vault'))
    expect(listing.toSorted((left, right) => left.localeCompare(right))).toEqual([
      'slots.v1',
      'vault.v1',
    ])
    for (const file of listing) {
      const bytes = await readFile(path.join(root, 'vault', file))
      expect(bytes.includes(secret.metadata.name)).toBe(false)
      expect(bytes.includes(secret.metadata.label)).toBe(false)
      if (secret.material.kind !== 'secret') throw new Error('fixture')
      expect(bytes.includes(Buffer.from(secret.material.value))).toBe(false)
      if (process.platform === 'win32') continue
      const sample = await lstat(path.join(root, 'vault', file))
      expect(sample.mode & 0o777).toBe(0o600)
    }
    if (process.platform === 'win32') return
    const sample = await lstat(path.join(root, 'vault'))
    expect(sample.mode & 0o777).toBe(0o700)
  })
  it('allows exactly one writer and releases its lock on success and thrown operations', async () => {
    const root = await directory()
    const files = new NodeVaultFiles(root, 1024)
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const first = files.withWriter(async () => {
      entered.resolve(undefined)
      await released.promise
    })
    await Promise.race([entered.promise, first])
    try {
      await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
        code: 'busy',
      })
    } finally {
      released.resolve(undefined)
      await first
    }
    await expect(
      files.withWriter(() => Promise.reject(new Error('generated failure'))),
    ).rejects.toThrow()
    await files.withWriter(() => Promise.resolve())
    expect(await readdir(root)).toEqual([])
    await writeFile(path.join(root, 'writer.lock'), '', { mode: 0o600 })
    await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({ code: 'busy' })
  })
  it('refuses oversized and symbolic-link files and unsafe POSIX permissions', async () => {
    const root = await directory()
    const files = new NodeVaultFiles(root, 2)
    await expect(files.writeAtomic('vault.v1', Buffer.alloc(3))).rejects.toThrow()
    await writeFile(path.join(root, 'vault.v1'), Buffer.alloc(3), { mode: 0o600 })
    await expect(files.read('vault.v1')).rejects.toThrow()
    await rm(path.join(root, 'vault.v1'))
    await writeFile(path.join(root, 'outside'), Buffer.alloc(1), { mode: 0o600 })
    await symlink(path.join(root, 'outside'), path.join(root, 'vault.v1'))
    await expect(files.read('vault.v1')).rejects.toThrow()
    if (process.platform !== 'win32') {
      await chmod(root, 0o755)
      await expect(files.withWriter(() => Promise.resolve())).rejects.toThrow()
    }
    expect(() => new NodeVaultFiles('relative', 1)).toThrow()
    expect(() => new NodeVaultFiles(root, 0)).toThrow()
    expect(() => new NodeVaultFiles(root, 1, undefined, 'win32')).toThrow()
  })
  it('exercises Windows DACL and replacement ports on the rig and refuses a failed security probe', async () => {
    const root = await directory()
    const calls: string[] = []
    let isRefuse = false
    const security = {
      protect: (file: string, kind: string) => {
        calls.push(`protect:${path.basename(file)}:${kind}`)
        return Promise.resolve()
      },
      verify: (file: string, kind: string) => {
        calls.push(`verify:${path.basename(file)}:${kind}`)
        return isRefuse ? Promise.reject(new Error('test denied DACL')) : Promise.resolve()
      },
    }
    const files = new NodeVaultFiles(root, 1024, security, 'win32')
    await files.withWriter(async () => {
      await files.writeAtomic('vault.v1', Buffer.from('first'))
      await files.writeAtomic('vault.v1', Buffer.from('second'))
    })
    const published = await files.read('vault.v1')
    expect(published?.toString()).toBe('second')
    expect(calls.some((call) => call.endsWith(':directory'))).toBe(true)
    expect(calls.some((call) => call.startsWith('protect:writer.lock'))).toBe(true)
    expect(calls.some((call) => call.startsWith('verify:vault.v1'))).toBe(true)
    isRefuse = true
    await expect(files.read('vault.v1')).rejects.toThrow()
  })
})
