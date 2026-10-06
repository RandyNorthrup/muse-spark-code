import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  chmod,
  symlink,
  readdir,
  open,
} from 'node:fs/promises'
import path from 'node:path'
import type * as FileSystem from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceStore } from '../../src/host/devices/deviceStore'
import { removeDeviceFixture } from './helpers/deviceFixtures'
import { DEVICE_LIMITS } from '../../src/shared/constants'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return { ...actual, open: vi.fn(actual.open) }
})
const fixture = { parent: '' }
const stores: DeviceStore[] = []
beforeEach(async () => {
  fixture.parent = await mkdtemp(path.join(process.cwd(), 'temp/m100-p-store-'))
})
afterEach(async () => {
  await removeDeviceFixture(stores, fixture.parent)
})
async function create() {
  const directory = path.join(fixture.parent, 'devices')
  const store = await DeviceStore.create(directory, 'a'.repeat(32))
  stores.push(store)
  return { directory, store }
}

describe('private nonsync device store', () => {
  it('requires explicit initialization and durably persists state across close/reopen', async () => {
    const directory = path.join(fixture.parent, 'devices')
    await expect(DeviceStore.open(directory)).rejects.toThrow('storage')
    const { store } = await create()
    await store.update((state) => {
      state.usedInvitationIds.push('b'.repeat(32))
      return state
    })
    await store.close()
    const restored = await DeviceStore.open(directory)
    stores.push(restored)
    const observed0 = await restored.read()
    expect(observed0.usedInvitationIds).toEqual(['b'.repeat(32)])
    await expect(DeviceStore.create(directory, 'c'.repeat(32))).rejects.toThrow('storage')
    const observed1 = await restored.read()
    expect(observed1.deviceId).toBe('a'.repeat(32))
    const observed2 = await stat(directory)
    expect(observed2.mode & 0o777).toBe(0o700)
    const observed3 = await stat(path.join(directory, 'pairs.json'))
    expect(observed3.mode & 0o777).toBe(0o600)
  })
  it('serializes contending writes and excludes another window without a stale-lock timeout', async () => {
    const { store, directory } = await create()
    await expect(DeviceStore.open(directory)).rejects.toThrow('storage')
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
      const store = await DeviceStore.create(directory, 'a'.repeat(32))
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
    const restored = await DeviceStore.open(directory)
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
      const store = await DeviceStore.create(directory, 'a'.repeat(32))
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
  it('refuses permissive metadata or root permissions, symlinks and writable parents', async () => {
    const { store, directory } = await create()
    const file = path.join(directory, 'pairs.json')
    await chmod(file, 0o644)
    await expect(store.read()).rejects.toThrow('storage')
    await chmod(file, 0o600)
    await store.close()
    await chmod(directory, 0o755)
    await expect(DeviceStore.open(directory)).rejects.toThrow('storage')
    await chmod(directory, 0o700)
    await rm(file)
    const target = path.join(fixture.parent, 'target.json')
    await writeFile(target, '{}', { mode: 0o600 })
    await symlink(target, file)
    await expect(DeviceStore.open(directory)).rejects.toThrow('storage')
    const alias = path.join(fixture.parent, 'alias')
    await symlink(directory, alias)
    await expect(DeviceStore.open(alias)).rejects.toThrow('storage')
    await chmod(fixture.parent, 0o777)
    await expect(
      DeviceStore.create(path.join(fixture.parent, 'unsafe-parent'), 'a'.repeat(32)),
    ).rejects.toThrow('storage')
    await chmod(fixture.parent, 0o700)
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
    const store = await DeviceStore.create(directory, 'a'.repeat(32))
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
  const store = await DeviceStore.create(directory, 'a'.repeat(32))
  stores.push(store)
  await store.close()
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  try {
    await expect(DeviceStore.open(directory)).rejects.toThrow('storage')
    expect(await readdir(directory)).not.toContain('.pairing.lock')
    const protection = {
      assertPrivate: () => Promise.reject(new Error('acl-sentinel')),
      syncDirectory: () => Promise.resolve(),
    }
    await expect(DeviceStore.open(directory, protection)).rejects.toThrow('storage')
  } finally {
    vi.unstubAllGlobals()
  }
})
