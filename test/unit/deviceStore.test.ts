import { link, readFile, writeFile, rm, stat, readdir, open } from 'node:fs/promises'
import path from 'node:path'
import type * as FileSystem from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import { DevicePairingError } from '../../src/core/devices/pairing'
import {
  fakeDeviceStorage,
  grantOthers,
  ownerOnlyEvidence,
  reparseAlias,
  useDeviceStorageRoot,
} from './helpers/deviceFixtures'
import { DEVICE_LIMITS } from '../../src/shared/constants'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, open: vi.fn(actual.open) }
})
const { fixture, stores } = useDeviceStorageRoot('m100-p-store-')
async function create() {
  const directory = path.join(fixture.parent, 'devices')
  const store = await DeviceStore.create(directory, 'a'.repeat(32), fixture.storage)
  stores.push(store)
  return { directory, store }
}

describe('private nonsync device store', () => {
  it.each(['revoked', 'grant', 'unpaired'] as const)(
    'preserves the %s policy refusal without poisoning subsequent reads or writes',
    async (reason) => {
      const { store, directory } = await create()
      const before = await readFile(path.join(directory, 'pairs.json'))
      await expect(
        store.update((state) => {
          state.usedInvitationIds.push('b'.repeat(32))
          throw new DevicePairingError(reason)
        }),
      ).rejects.toThrow(reason)
      expect(await readFile(path.join(directory, 'pairs.json'))).toEqual(before)
      const refused = await store.read()
      expect(refused.usedInvitationIds).toEqual([])
      await store.update((state) => {
        state.usedInvitationIds.push('c'.repeat(32))
        return state
      })
      const updated = await store.read()
      expect(updated.usedInvitationIds).toEqual(['c'.repeat(32)])
    },
  )
  it('latches an unexpected update callback failure with only the storage reason', async () => {
    const { store, directory } = await create()
    const before = await readFile(path.join(directory, 'pairs.json'))
    await expect(
      store.update(() => {
        throw new Error('private-callback-sentinel')
      }),
    ).rejects.toThrow(/^storage$/)
    expect(await readFile(path.join(directory, 'pairs.json'))).toEqual(before)
    await expect(store.read()).rejects.toThrow('storage')
  })
  it('latches a persistence failure even when it carries a policy error type', async () => {
    const fake = fakeDeviceStorage()
    const syncDirectory = vi.spyOn(fake.protection, 'syncDirectory')
    const store = await DeviceStore.create(
      path.join(fixture.parent, 'devices'),
      'a'.repeat(32),
      fake.protection,
    )
    stores.push(store)
    syncDirectory.mockRejectedValueOnce(new DevicePairingError('grant'))
    await expect(
      store.update((state) => {
        state.usedInvitationIds.push('b'.repeat(32))
        return state
      }),
    ).rejects.toThrow(/^storage$/)
    await expect(store.read()).rejects.toThrow('storage')
  })
  it('requires explicit initialization and durably persists state across close/reopen', async () => {
    const directory = path.join(fixture.parent, 'devices')
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    const { store } = await create()
    await store.update((state) => {
      state.usedInvitationIds.push('b'.repeat(32))
      return state
    })
    await store.close()
    const restored = await DeviceStore.open(directory, fixture.storage)
    stores.push(restored)
    const observed0 = await restored.read()
    expect(observed0.usedInvitationIds).toEqual(['b'.repeat(32)])
    await expect(DeviceStore.create(directory, 'c'.repeat(32), fixture.storage)).rejects.toThrow(
      'storage',
    )
    const observed1 = await restored.read()
    expect(observed1.deviceId).toBe('a'.repeat(32))
    expect(await ownerOnlyEvidence(directory, true)).toBe('700')
    expect(await ownerOnlyEvidence(path.join(directory, 'pairs.json'), false)).toBe('600')
  })
  it('serializes contending writes and excludes another window without a stale-lock timeout', async () => {
    const { store, directory } = await create()
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        store.update((state) => {
          state.usedInvitationIds.push(index.toString(16).padStart(32, '0'))
          return state
        }),
      ),
    )
    const observed4 = await store.read()
    expect(observed4.usedInvitationIds).toHaveLength(16)
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining(['.pairing.lock', 'pairs.json']),
    )
    const observed5 = await readdir(directory)
    expect(observed5.some((name) => name.endsWith('.stage'))).toBe(false)
  })
  it('refuses missing, corrupt, unknown-version and duplicate-key metadata without recreation', async () => {
    for (const corrupt of ['', '{', '{"version":99}', '{"version":1,"version":1}', 'missing']) {
      const directory = path.join(
        fixture.parent,
        `store-${String(corrupt.length)}-${String(Math.random())}`,
      )
      const store = await DeviceStore.create(directory, 'a'.repeat(32), fixture.storage)
      stores.push(store)
      const file = path.join(directory, 'pairs.json')
      if (corrupt === 'missing') await rm(file)
      else await writeFile(file, corrupt)
      await expect(store.read()).rejects.toThrow('storage')
      await expect(store.update((state) => state)).rejects.toThrow('storage')
      if (corrupt === 'missing')
        await expect(readFile(file)).rejects.toHaveProperty('code', 'ENOENT')
      else expect(await readFile(file, 'utf8')).toBe(corrupt)
    }
  })
  it('bounds state before parsing and retains the broken state', async () => {
    const { store, directory } = await create()
    const file = path.join(directory, 'pairs.json')
    await writeFile(file, ' '.repeat(DEVICE_LIMITS.journalBytes + 1))
    const parser = vi.spyOn(JSON, 'parse')
    vi.mocked(open).mockClear()
    try {
      await expect(store.read()).rejects.toThrow('storage')
      expect(parser).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      parser.mockRestore()
    }
    const observed6 = await stat(file)
    expect(observed6.size).toBe(DEVICE_LIMITS.journalBytes + 1)
  })
  it('never forgets invitation replay or revocation evidence and latches failed storage', async () => {
    const { store, directory } = await create()
    await store.update((state) => {
      state.usedInvitationIds.push('b'.repeat(32))
      state.revokedPairIds.push('c'.repeat(32))
      return state
    })
    const before = await readFile(path.join(directory, 'pairs.json'))
    await expect(
      store.update((state) => {
        state.usedInvitationIds = []
        return state
      }),
    ).rejects.toThrow('storage')
    expect(await readFile(path.join(directory, 'pairs.json'))).toEqual(before)
    await expect(store.read()).rejects.toThrow('storage')
    await store.close()
    const restored = await DeviceStore.open(directory, fixture.storage)
    stores.push(restored)
    await expect(
      restored.update((state) => {
        state.revokedPairIds = []
        return state
      }),
    ).rejects.toThrow('storage')
    expect(await readFile(path.join(directory, 'pairs.json'))).toEqual(before)
  })
  it('refuses a changed device id, duplicate history and exhausted history rather than overwriting', async () => {
    for (const kind of ['device', 'duplicate', 'full']) {
      const directory = path.join(fixture.parent, kind)
      const store = await DeviceStore.create(directory, 'a'.repeat(32), fixture.storage)
      stores.push(store)
      await expect(
        store.update((state) => {
          switch (kind) {
            case 'device': {
              state.deviceId = 'b'.repeat(32)
              break
            }
            case 'duplicate': {
              state.revokedPairIds.push('b'.repeat(32), 'b'.repeat(32))
              break
            }
            case 'full': {
              {
                state.usedInvitationIds = Array.from(
                  { length: DEVICE_LIMITS.tombstones + 1 },
                  (_, index) => index.toString(16).padStart(32, '0'),
                )
                // No default
              }
              break
            }
          }
          return state
        }),
      ).rejects.toThrow('storage')
      expect(JSON.parse(await readFile(path.join(directory, 'pairs.json'), 'utf8'))).toMatchObject({
        deviceId: 'a'.repeat(32),
        usedInvitationIds: [],
        revokedPairIds: [],
      })
    }
  })
  it('refuses permissive metadata or root permissions, links and replaceable parents', async () => {
    const { store, directory } = await create()
    const file = path.join(directory, 'pairs.json')
    const readable = await grantOthers(file, 'file')
    await expect(store.read()).rejects.toThrow('storage')
    await readable.restore()
    await store.close()
    const listable = await grantOthers(directory, 'directory')
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    await listable.restore()
    const hardlink = path.join(fixture.parent, 'hardlink.json')
    await link(file, hardlink)
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    await rm(hardlink)
    // The refused open got as far as taking the lock; an abandoned lock is never reused.
    await rm(path.join(directory, '.pairing.lock'))
    const reopened = await DeviceStore.open(directory, fixture.storage)
    stores.push(reopened)
    await expect(reopened.read()).resolves.toMatchObject({ deviceId: 'a'.repeat(32) })
    await reopened.close()
    await rm(file)
    const target = path.join(fixture.parent, 'target.json')
    await writeFile(target, '{}', { mode: 0o600 })
    await reparseAlias(target, file)
    await expect(DeviceStore.open(directory, fixture.storage)).rejects.toThrow('storage')
    const alias = path.join(fixture.parent, 'alias')
    await reparseAlias(directory, alias)
    await expect(DeviceStore.open(alias, fixture.storage)).rejects.toThrow('storage')
    const replaceable = await grantOthers(fixture.parent, 'parent')
    await expect(
      DeviceStore.create(
        path.join(fixture.parent, 'unsafe-parent'),
        'a'.repeat(32),
        fixture.storage,
      ),
    ).rejects.toThrow('storage')
    await replaceable.restore()
  })
  it('rejects a removed lock and a post-close operation instead of claiming durability', async () => {
    const { store, directory } = await create()
    await rm(path.join(directory, '.pairing.lock'))
    await expect(store.close()).rejects.toThrow()
    await expect(store.read()).rejects.toThrow('storage')
  })
})

it('refuses valid-shaped unknown-version and duplicate-key state before returning a usable store', async () => {
  for (const kind of ['version', 'duplicate']) {
    const directory = path.join(fixture.parent, kind)
    const store = await DeviceStore.create(directory, 'a'.repeat(32), fixture.storage)
    stores.push(store)
    const state = await store.read()
    const text =
      kind === 'version'
        ? JSON.stringify({ ...state, version: 2 })
        : JSON.stringify(state).replace('{', '{"version":1,')
    await writeFile(path.join(directory, 'pairs.json'), text)
    await expect(store.read()).rejects.toThrow('storage')
  }
})
it('requires the native Windows ACL/durability binding and fails closed when it refuses', async () => {
  const directory = path.join(fixture.parent, 'devices')
  const store = await DeviceStore.create(directory, 'a'.repeat(32), fixture.storage)
  stores.push(store)
  await store.close()
  // The injected platform runs Windows' rules on every OS.
  await expect(DeviceStore.open(directory, undefined, 'win32')).rejects.toThrow('storage')
  expect(await readdir(directory)).not.toContain('.pairing.lock')
  const unbound = path.join(fixture.parent, 'unbound')
  await expect(DeviceStore.create(unbound, 'a'.repeat(32), undefined, 'win32')).rejects.toThrow(
    'storage',
  )
  expect(await readdir(unbound)).toEqual([])
  const refusing = fakeDeviceStorage()
  refusing.refuse('assertPrivate')
  await expect(DeviceStore.open(directory, refusing.protection, 'win32')).rejects.toThrow(
    /^storage$/,
  )
  expect(await readdir(directory)).not.toContain('.pairing.lock')
  const bound = fakeDeviceStorage()
  const reopened = await DeviceStore.open(directory, bound.protection, 'win32')
  stores.push(reopened)
  expect(bound.calls).toEqual(expect.arrayContaining(['assertPrivate', 'assertSafeAncestor']))
})
it.each(['secureFresh', 'assertSafeAncestor', 'syncDirectory'] as const)(
  'refuses to create a store when the binding refuses %s',
  async (step) => {
    const refusing = fakeDeviceStorage()
    refusing.refuse(step)
    const directory = path.join(fixture.parent, step)
    await expect(
      DeviceStore.create(directory, 'a'.repeat(32), refusing.protection, 'win32'),
    ).rejects.toThrow(/^storage$/)
    expect(await readdir(directory)).not.toContain('.pairing.lock')
  },
)
it('replaces only through the binding and latches a refused replacement without touching state', async () => {
  const bound = fakeDeviceStorage()
  const directory = path.join(fixture.parent, 'replace')
  const store = await DeviceStore.create(directory, 'a'.repeat(32), bound.protection, 'win32')
  stores.push(store)
  await store.update((state) => {
    state.usedInvitationIds.push('b'.repeat(32))
    return state
  })
  // Folder, pairs.json, lock and stage are each claimed once, as created.
  expect(bound.calls.filter((call) => call === 'secureFresh')).toHaveLength(4)
  expect(bound.calls.filter((call) => call === 'replace')).toHaveLength(1)
  const before = await readFile(path.join(directory, 'pairs.json'))
  bound.refuse('replace')
  await expect(
    store.update((state) => {
      state.usedInvitationIds.push('c'.repeat(32))
      return state
    }),
  ).rejects.toThrow(/^storage$/)
  expect(await readFile(path.join(directory, 'pairs.json'))).toEqual(before)
  await expect(store.read()).rejects.toThrow('storage')
})
