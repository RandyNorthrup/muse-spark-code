import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, chmod, symlink, link } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { VaultAuditLog, type VaultAuditAnchorPort } from '../../../src/core/vault/broker/audit'
import { audit } from '../helpers/vault/fixtures'
import { UnixVaultPrivateFiles } from '../../../src/core/vault/broker/files'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function setup(maxBytes = 8 * 1024 * 1024) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm109-b-audit-'))
  directories.push(directory)
  let anchor = { generation: 0, hash: '0'.repeat(64), baseGeneration: 0, baseHash: '0'.repeat(64) }
  let tail: Promise<unknown> = Promise.resolve()
  const anchors: VaultAuditAnchorPort = {
    transaction: async (run) => {
      const previous = tail
      const next = (async () => {
        try {
          await previous
        } catch {
          /* test caller observes rejection */
        }
        return await run()
      })()
      tail = next
      return await next
    },
    read: () => Promise.resolve(structuredClone(anchor)),
    write: (next) => {
      anchor = structuredClone(next)
      return Promise.resolve()
    },
  }
  const key = randomBytes(32)
  const log = new VaultAuditLog(directory, anchors, maxBytes)
  await log.open(key)
  const {
    v: _v,
    id: _id,
    generation: _generation,
    previousHash: _previous,
    hash: _hash,
    mac: _mac,
    ...record
  } = audit()
  return {
    log,
    key,
    directory,
    anchors,
    record,
    file: path.join(directory, 'audit.v1.jsonl'),
    anchor: () => anchor,
  }
}
describe('authenticated vault audit', () => {
  it('persists owner-only strict value-free records and authenticates the head', async () => {
    const fixture = await setup()
    await fixture.log.append(fixture.record)
    await fixture.log.append({ ...fixture.record, outcome: 'succeeded' })
    const records = await fixture.log.read()
    expect(records).toHaveLength(2)
    expect(records[1]?.previousHash).toBe(records[0]?.hash)
    expect(fixture.anchor().generation).toBe(2)
    fixture.log.close()
    await fixture.log.open(fixture.key)
    expect(await fixture.log.read()).toEqual(records)
    await expect(
      fixture.log.append(Object.assign({ ...fixture.record }, { value: randomBytes(32) })),
    ).rejects.toThrow()
  })
  it.each(['edit', 'truncate', 'wrongKey', 'missing', 'format'])(
    'detects %s against the authenticated slot anchor',
    async (attack) => {
      const fixture = await setup()
      await fixture.log.append(fixture.record)
      await fixture.log.append(fixture.record)
      fixture.log.close()
      const bytes = await readFile(fixture.file, 'utf8')
      if (attack === 'format') await writeFile(fixture.file, bytes.trimEnd())
      switch (attack) {
        case 'edit': {
          await writeFile(fixture.file, bytes.replace('redacted target', 'changed target'))
          break
        }
        case 'truncate': {
          await writeFile(fixture.file, `${bytes.split('\n', 1)[0]!}\n`)
          break
        }
        case 'missing': {
          {
            await rm(fixture.file)
            // No default
          }
          break
        }
      }
      await expect(
        fixture.log.open(attack === 'wrongKey' ? randomBytes(32) : fixture.key),
      ).rejects.toThrow()
    },
  )
  it('rotation retains an authenticated checkpoint and refuses truncation of the retained segment', async () => {
    const fixture = await setup(1600)
    await fixture.log.append(fixture.record)
    await fixture.log.append(fixture.record)
    expect(fixture.anchor().baseGeneration).toBe(1)
    expect(await fixture.log.read()).toHaveLength(1)
    fixture.log.close()
    await fixture.log.open(fixture.key)
    expect(await fixture.log.read()).toHaveLength(1)
    await writeFile(fixture.file, '')
    fixture.log.close()
    await expect(fixture.log.open(fixture.key)).rejects.toThrow()
  })
  it('refuses world-readable files and symlinks', async () => {
    const fixture = await setup()
    await fixture.log.append(fixture.record)
    const content = await readFile(fixture.file)
    fixture.log.close()
    await chmod(fixture.file, 0o644)
    await expect(fixture.log.open(fixture.key)).rejects.toThrow()
    await rm(fixture.file)
    const target = path.join(fixture.directory, 'target')
    await writeFile(target, content, { mode: 0o600 })
    await symlink(target, fixture.file)
    await expect(fixture.log.open(fixture.key)).rejects.toThrow()
  })
  it('refuses hard links, unsafe directories, invalid caps and wrong key lengths', async () => {
    const fixture = await setup()
    await fixture.log.append(fixture.record)
    fixture.log.close()
    await link(fixture.file, path.join(fixture.directory, 'alias'))
    await expect(fixture.log.open(fixture.key)).rejects.toThrow()
    const unsafe = await setup()
    unsafe.log.close()
    await chmod(unsafe.directory, 0o755)
    await expect(unsafe.log.open(unsafe.key)).rejects.toThrow()
    await expect(setup(0)).rejects.toThrow()
    const empty = await setup()
    await expect(empty.log.open(randomBytes(1))).rejects.toThrow()
  })
  it('anchor write failure fails closed until a verified repair', async () => {
    const fixture = await setup()
    fixture.anchors.write = () => Promise.reject(new Error('test anchor failed'))
    await expect(fixture.log.append(fixture.record)).rejects.toThrow('test anchor failed')
    await expect(fixture.log.read()).rejects.toThrow()
    await expect(fixture.log.open(fixture.key)).rejects.toThrow()
  })
  it('detects edits made after unlock before read or another append', async () => {
    const fixture = await setup()
    await fixture.log.append(fixture.record)
    const bytes = await readFile(fixture.file, 'utf8')
    await writeFile(fixture.file, bytes.replace('redacted target', 'changed target'))
    await expect(fixture.log.read()).rejects.toThrow()
    await expect(fixture.log.append(fixture.record)).rejects.toThrow()
  })
  it('two broker versions serialize append against the current authenticated head', async () => {
    const fixture = await setup()
    const other = new VaultAuditLog(fixture.directory, fixture.anchors)
    await other.open(fixture.key)
    await Promise.all([fixture.log.append(fixture.record), other.append(fixture.record)])
    const records = await other.read()
    expect(records.map((record) => record.generation)).toEqual([1, 2])
    expect(records[1]?.previousHash).toBe(records[0]?.hash)
    expect(await fixture.log.read()).toEqual(records)
    other.close()
  })
  it('a rotated descriptor still appends after another writer advances the file', async () => {
    const fixture = await setup(),
      files = new UnixVaultPrivateFiles(),
      first = files.writer(fixture.file),
      second = files.writer(fixture.file)
    try {
      first.replace(Buffer.from('head\n'))
      second.append(Buffer.from('next\n'))
      first.append(Buffer.from('last\n'))
      expect(await readFile(fixture.file, 'utf8')).toBe('head\nnext\nlast\n')
    } finally {
      first.close()
      second.close()
      fixture.log.close()
    }
  })
  it('writer rotation closes the old descriptor while another live writer follows the authenticated head', async () => {
    const fixture = await setup(1600),
      other = await fixture.log.openWriter(fixture.key)
    await fixture.log.append(fixture.record)
    await fixture.log.append(fixture.record)
    await other.append({ ...fixture.record, outcome: 'succeeded' })
    const records = await other.read()
    expect(records.at(-1)?.generation).toBe(3)
    other.close()
    fixture.log.close()
    await fixture.log.open(fixture.key)
    expect(await fixture.log.read()).toEqual(records)
  })

  it('RVM109B3 P2-3 closing a writer before a queued physical append leaves a reopenable log', async () => {
    const fixture = await setup(),
      writer = await fixture.log.openWriter(fixture.key),
      transaction = fixture.anchors.transaction,
      entered = Promise.withResolvers<undefined>(),
      waiting = Promise.withResolvers<undefined>()
    fixture.anchors.transaction = async (run) => {
      entered.resolve(undefined)
      await waiting.promise
      return await transaction(run)
    }
    const append = writer.append(fixture.record),
      observed = expect(append).rejects.toThrow()
    await entered.promise
    writer.close()
    waiting.resolve(undefined)
    await observed
    fixture.anchors.transaction = transaction
    await fixture.log.open(fixture.key)
    expect(await fixture.log.read()).toEqual([])
    expect(fixture.anchor().generation).toBe(0)
  })

  it('callers cannot override broker-owned audit identity or generation', async () => {
    const fixture = await setup()
    await expect(
      fixture.log.append(Object.assign({ ...fixture.record }, { generation: 100 })),
    ).rejects.toThrow()
    await expect(
      fixture.log.append(Object.assign({ ...fixture.record }, { id: 'a'.repeat(32) })),
    ).rejects.toThrow()
    expect(await fixture.log.read()).toEqual([])
  })
})
