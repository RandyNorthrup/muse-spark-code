import * as fs from 'node:fs'
import { mkdtemp, readFile, readdir, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NodeVaultFiles,
  VaultStore,
  type VaultGenerationState,
  type VaultWriterCheck,
} from '../../../src/core/vault/store'
import { KeyringVaultAnchor } from '../../../src/runtime/vault/keyringAnchor'
import {
  acquireFileLease,
  LeaseBusyError,
  type FileLeaseEnv,
} from '../../../src/core/locks/fileLease'
import { nodeLeasePort } from '../../../src/core/locks/nodeLeasePort'
import { exactCurrentProcessOwner } from '../../../src/core/locks/processOwner'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import { item } from '../helpers/vault/fixtures'
import { removeFolder } from '../helpers/temporaryFolders'
import { MemoryVaultFiles } from './storeFixtures'

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof fs>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})
const roots: string[] = []
const QUEUE_OBSERVATION_MS = 250
afterEach(async () => {
  vi.restoreAllMocks()
  const actual = await vi.importActual<typeof fs>('node:fs')
  vi.mocked(fs.renameSync).mockImplementation(actual.renameSync)
  for (const root of roots.splice(0)) await removeFolder(root)
})
const security = {
  protect: () => Promise.resolve(undefined),
  verify: () => Promise.resolve(undefined),
}
async function fixture() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'M109-Lifetime-'))
  roots.push(root)
  return { root, files: new NodeVaultFiles(root, 1024 * 1024, security) }
}
async function contender(root: string) {
  const owner = await exactCurrentProcessOwner()
  if (!owner) throw new Error('generated fixture owner unavailable')
  let clock = 0
  const env: FileLeaseEnv = {
    port: nodeLeasePort,
    now: Date.now,
    monotonic: () => clock,
    sleep: () => Promise.resolve(undefined),
    owner,
    isOwnerGone: () => Promise.resolve(false),
    leaseMs: 30_000,
    honoredLeaseMs: 30_000,
    unreadableMs: 2000,
    timeoutMs: 0,
    pollMs: 0,
    takeover: 'ownerDeathOnly',
    watches: new Map(),
  }
  const file = path.join(root, 'writer.lock')
  await expect(acquireFileLease(file, env)).rejects.toBeInstanceOf(LeaseBusyError)
  clock = 100_000
  await expect(acquireFileLease(file, env)).rejects.toBeInstanceOf(LeaseBusyError)
}
const state = (generation: number): VaultGenerationState => ({
  generation,
  auditGeneration: 0,
  auditHead: '0'.repeat(64),
  stateDigest: String(generation).repeat(64),
})
describe('production writer mutation lifetime', () => {
  it('reports a dispatched mutation failure even when its callback handles the rejection', async () => {
    const { root } = await fixture()
    const files = new NodeVaultFiles(root, 1024, {
      ...security,
      protect: (file) =>
        file.endsWith('.stage')
          ? Promise.reject(new Error('generated storage refusal'))
          : Promise.resolve(),
    })
    await expect(
      files.withWriter(async () => {
        try {
          await files.writeAtomic('vault.v1', Buffer.from('dispatched'))
        } catch {
          // Catching the dispatch refusal does not make the enclosing operation successful.
        }
      }),
    ).rejects.toMatchObject({ code: 'io' })
    expect(await readdir(root)).not.toContain('writer.lock')
  })
  it('a late production rename cannot follow a live-owner takeover', async () => {
    const { root, files } = await fixture()
    await files.writeAtomic('vault.v1', Buffer.from('original'))
    const dispatched = Promise.withResolvers<undefined>(),
      resume = Promise.withResolvers<undefined>()
    const actual = await vi.importActual<typeof fs>('node:fs')
    let late: (() => void) | undefined
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith('vault.v1')) {
        late = () => {
          actual.renameSync(from, to)
        }
        dispatched.resolve(undefined)
      } else actual.renameSync(from, to)
    })
    const guarded = new NodeVaultFiles(root, 1024, {
      ...security,
      verify: async (file) => {
        if (late && file.endsWith('vault.v1')) await resume.promise
      },
    })
    const first = guarded.withWriter(() =>
      guarded.writeAtomic('vault.v1', Buffer.from('old-writer')),
    )
    try {
      await dispatched.promise
      await contender(root)
      expect(await readFile(path.join(root, 'vault.v1'), 'utf8')).toBe('original')
      if (!late) throw new Error('expected deferred native rename')
      late()
    } finally {
      resume.resolve(undefined)
      await first
    }
    expect(await readFile(path.join(root, 'vault.v1'), 'utf8')).toBe('old-writer')
  })
  it.each(['advance', 'reset'] as const)(
    'drains delayed AsyncEntry %s after an operation rejects',
    async (operation) => {
      const { root, files } = await fixture()
      const entered = Promise.withResolvers<undefined>(),
        release = Promise.withResolvers<undefined>()
      const vaultId = 'a'.repeat(32),
        initial = state(1),
        next = state(2)
      let raw: string | undefined = JSON.stringify({ v: 1, vaultId, ...initial })
      const anchor = new KeyringVaultAnchor(() => ({
        getPassword: () => Promise.resolve(raw),
        setPassword: async (value) => {
          entered.resolve(undefined)
          await release.promise
          raw = value
        },
        deletePassword: async () => {
          entered.resolve(undefined)
          await release.promise
          raw = undefined
          return true
        },
      }))
      let dispatched: Promise<void> | undefined
      const first = files.withWriter(async (check) => {
        dispatched =
          operation === 'advance'
            ? anchor.advance(vaultId, next, initial, check)
            : anchor.reset(vaultId, initial, check)
        await entered.promise
        throw new Error('generated callback failure')
      })
      const firstSettled = Promise.allSettled([first])
      try {
        await entered.promise
        await contender(root)
        let isSecondEntered = false
        const secondFiles = new NodeVaultFiles(root, 1024, security)
        const second = secondFiles.withWriter(() => {
          isSecondEntered = true
          return Promise.resolve(undefined)
        })
        let isSecondSettled = false
        const secondObserved = (async () => {
          try {
            await second
          } catch {
            // The assertion below inspects the original refusal.
          } finally {
            isSecondSettled = true
          }
        })()
        await delay(QUEUE_OBSERVATION_MS)
        expect(isSecondSettled).toBe(false)
        expect(isSecondEntered).toBe(false)
        expect(await readFile(path.join(root, 'writer.lock'), 'utf8')).toContain(
          String(process.pid),
        )
        release.resolve(undefined)
        await dispatched
        await expect(first).rejects.toThrow('generated callback failure')
        await second
        await secondObserved
        expect(isSecondEntered).toBe(true)
        expect(await anchor.minimum(vaultId)).toEqual(operation === 'advance' ? next : null)
      } finally {
        release.resolve(undefined)
        await firstSettled
        await dispatched
      }
    },
  )
  it('queues a direct file mutation from outside the holding async scope', async () => {
    const { root, files } = await fixture()
    const entered = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>()
    const first = files.withWriter(async () => {
      entered.resolve(undefined)
      await release.promise
    })
    await entered.promise
    const second = files.writeAtomic('vault.v1', Buffer.from('queued'))
    await delay(QUEUE_OBSERVATION_MS)
    await expect(readFile(path.join(root, 'vault.v1'))).rejects.toMatchObject({ code: 'ENOENT' })
    release.resolve(undefined)
    await first
    await second
    expect(await readFile(path.join(root, 'vault.v1'), 'utf8')).toBe('queued')
  })
  it('refuses a retired async scope before it creates any staging file', async () => {
    const { root, files } = await fixture()
    const start = Promise.withResolvers<undefined>()
    let late: Promise<void> | undefined
    await files.withWriter(() => {
      late = (async () => {
        await start.promise
        await files.writeAtomic('vault.v1', Buffer.from('retired'))
      })()
      return Promise.resolve(undefined)
    })
    start.resolve(undefined)
    await expect(late).rejects.toMatchObject({ code: 'busy' })
    expect(await readdir(root)).toEqual(['writer.lock.fences'])
  })
  it('refuses a retired anchor callback before it enters a new operation queue', async () => {
    const { files } = await fixture()
    let previous: VaultWriterCheck | undefined
    await files.withWriter((check) => {
      previous = check
      return Promise.resolve()
    })
    const retired = previous
    if (!retired) throw new Error('generated writer callback unavailable')
    const anchor = new KeyringVaultAnchor(() => ({
      getPassword: () => Promise.resolve(undefined),
      setPassword: () => Promise.resolve(),
      deletePassword: () => Promise.resolve(true),
    }))
    await files.withWriter(() => {
      expect(() => anchor.advance('a'.repeat(32), state(1), null, retired)).toThrow()
      return Promise.resolve()
    })
  })
  it('serializes an OS-store mutation and a file mutation inside one operation', async () => {
    const { root, files } = await fixture()
    const entered = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>()
    const vaultId = 'a'.repeat(32)
    const anchor = new KeyringVaultAnchor(() => ({
      getPassword: () => Promise.resolve(undefined),
      setPassword: async () => {
        entered.resolve(undefined)
        await release.promise
      },
      deletePassword: () => Promise.resolve(true),
    }))
    const first = files.withWriter(async (check) => {
      const advancing = anchor.advance(vaultId, state(1), null, check)
      await entered.promise
      const writing = files.writeAtomic('vault.v1', Buffer.from('serialized'))
      try {
        await delay(QUEUE_OBSERVATION_MS)
        await expect(readFile(path.join(root, 'vault.v1'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        release.resolve(undefined)
        await advancing
        await writing
      }
    })
    await first
    expect(await readFile(path.join(root, 'vault.v1'), 'utf8')).toBe('serialized')
  })
  it('awaits a dispatched file mutation before reporting a callback failure', async () => {
    const { root } = await fixture()
    const entered = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>()
    const files = new NodeVaultFiles(root, 1024, {
      ...security,
      protect: async (file) => {
        if (!path.basename(file).startsWith('vault.v1.') || !file.endsWith('.stage')) return
        entered.resolve(undefined)
        await release.promise
      },
    })
    let mutation: Promise<void> | undefined,
      isSettled = false
    const first = files.withWriter(async () => {
      mutation = files.writeAtomic('vault.v1', Buffer.from('awaited'))
      await entered.promise
      throw new Error('generated callback failure')
    })
    const settled = (async () => {
      try {
        await first
      } catch {
        // The assertion below inspects the original callback failure.
      } finally {
        isSettled = true
      }
    })()
    try {
      await entered.promise
      await new Promise(setImmediate)
      expect(isSettled).toBe(false)
      await contender(root)
      release.resolve(undefined)
      await mutation
      await expect(first).rejects.toThrow('generated callback failure')
      expect(await readFile(path.join(root, 'vault.v1'), 'utf8')).toBe('awaited')
    } finally {
      release.resolve(undefined)
      await settled
      await mutation
    }
  })
  it.each([false, true])(
    'detects a late generation-2 anchor after generation 3; journal=%s',
    async (hasJournal) => {
      const files = new MemoryVaultFiles(),
        key = Buffer.alloc(32, 1),
        vaultId = 'a'.repeat(32)
      let raw: string | undefined, earlier: string | undefined
      const anchor = new KeyringVaultAnchor(() => ({
        getPassword: () => Promise.resolve(raw),
        setPassword: (value) => {
          raw = value
          return Promise.resolve(undefined)
        },
        deletePassword: () => Promise.resolve(true),
      }))
      try {
        const options = { files, key, anchor }
        const store = await VaultStore.create(options, vaultId, [
          createRecoverySlot(key, vaultId, { now: () => 0 }).slot,
        ])
        await store.write(item())
        earlier = raw
        let journal: Buffer | undefined
        const write = files.writeAtomic.bind(files)
        vi.spyOn(files, 'writeAtomic').mockImplementation(async (...args) => {
          if (args[0] === 'pending.v1') journal = Buffer.from(args[1])
          await write(...args)
        })
        const changed = item()
        changed.metadata.id = 'b'.repeat(32)
        changed.metadata.name = 'second'
        changed.metadata.handle = 'secret://second'
        await store.write(changed)
        expect(await anchor.minimum(vaultId)).toMatchObject({ generation: 3 })
        raw = earlier // A dead process's external helper completes an old native request.
        if (hasJournal && journal) files.data.set('pending.v1', journal)
        if (hasJournal) {
          const reopened = await VaultStore.open(options, vaultId)
          expect(await reopened.list()).toHaveLength(2)
          expect(await anchor.minimum(vaultId)).toMatchObject({ generation: 3 })
          reopened.lock()
        } else
          await expect(VaultStore.open(options, vaultId)).rejects.toMatchObject({
            code: 'rollback',
          })
        store.lock()
      } finally {
        key.fill(0)
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'admits the reviewer spelling case by native directory identity',
    async () => {
      const { root, files } = await fixture()
      await files.writeAtomic('vault.v1', Buffer.from('same-directory'))
      const alias = new NodeVaultFiles(root.toLowerCase(), 1024, security)
      expect(await alias.read('vault.v1')).toEqual(Buffer.from('same-directory'))
      await alias.writeAtomic('vault.v1', Buffer.from('same-writer'))
      expect(await files.read('vault.v1')).toEqual(Buffer.from('same-writer'))
    },
  )
  it('rejects linked ancestors even when native leaf identities agree', async () => {
    const { root, files } = await fixture()
    await files.writeAtomic('vault.v1', Buffer.from('preserved'))
    const parent = await mkdtemp(path.join(await realpath(tmpdir()), 'm109-link-'))
    roots.push(parent)
    const alias = path.join(parent, 'linked')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const linked = new NodeVaultFiles(alias, 1024, security)
    await expect(linked.read('vault.v1')).rejects.toMatchObject({ code: 'io' })
  })
})
