import { createHash } from 'node:crypto'
import type * as FsPromises from 'node:fs/promises'
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { RUNTIME_STATE } from '../../src/shared/constants'
import { filesUnder, removeFolder } from './helpers/temporaryFolders'

const publishGate = vi.hoisted(() => ({
  isOn: false,
  arrivals: 0,
  heldFile: '',
  failedFile: '',
  released: Promise.resolve(true),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return {
    ...original,
    async rename(...args: Parameters<typeof original.rename>) {
      if (publishGate.isOn) {
        publishGate.arrivals += 1
        const destination = args[1].toString()
        const isHeld =
          publishGate.heldFile === ''
            ? publishGate.arrivals === 1
            : destination.endsWith(publishGate.heldFile)
        if (isHeld) await publishGate.released
        if (publishGate.failedFile !== '' && destination.endsWith(publishGate.failedFile))
          throw new Error('Fake write failure')
      }
      await original.rename(...args)
    },
  }
})

const folders: string[] = []
const POSIX_PERMISSIONS = 0o777
const OBSERVATION_MS = 50
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-state-'))
  folders.push(root)
  return { root, store: new RuntimeSettingsStore(root, '/workspace/one') }
}

describe('runtime settings and storage', () => {
  it('drains every admitted write before reporting a failed publication', async () => {
    const { store } = await setup()
    const release = Promise.withResolvers<boolean>()
    publishGate.isOn = true
    publishGate.arrivals = 0
    publishGate.heldFile = `${createHash('sha256').update('held').digest('hex')}.json`
    publishGate.failedFile = `${createHash('sha256').update('failed').digest('hex')}.json`
    publishGate.released = release.promise
    const failed = expect(store.setStorage('failed', 1, 'user')).rejects.toThrow(
      'Fake write failure',
    )
    const held = store.setStorage('held', 2, 'user')
    let isDrained = false
    let drainError: unknown
    const draining = (async () => {
      try {
        await store.settled()
      } catch (error: unknown) {
        drainError = error
      } finally {
        isDrained = true
      }
    })()
    try {
      await vi.waitFor(() => {
        expect(publishGate.arrivals).toBe(2)
      })
      await failed
      await new Promise((resolve) => setTimeout(resolve, OBSERVATION_MS))
      expect(isDrained).toBe(false)
    } finally {
      release.resolve(true)
      await held
      await draining
      publishGate.isOn = false
      publishGate.heldFile = ''
      publishGate.failedFile = ''
    }
    expect(drainError).toBeInstanceOf(AggregateError)
    expect(await store.getStorage('held', 'user')).toBe(2)
  })
  it('waits for the earlier same-key publication before publishing the next update', async () => {
    const { store } = await setup()
    const release = Promise.withResolvers<boolean>()
    publishGate.isOn = true
    publishGate.arrivals = 0
    publishGate.released = release.promise
    const writes: Promise<void>[] = []
    try {
      writes.push(store.setStorage('ordered', 1, 'user'))
      await vi.waitFor(() => {
        expect(publishGate.arrivals).toBe(1)
      })
      writes.push(store.setStorage('ordered', 2, 'user'))
      await new Promise((resolve) => setTimeout(resolve, OBSERVATION_MS))
      expect(publishGate.arrivals).toBe(1)
    } finally {
      release.resolve(true)
      await Promise.all(writes)
      publishGate.isOn = false
    }
    expect(await store.getStorage('ordered', 'user')).toBe(2)
  })
  it('uses shared defaults, validates updates, and gives workspace settings precedence', async () => {
    const { root, store } = await setup()
    expect(await store.getSetting('museSpark.autosave')).toBe(true)
    const changed = vi.fn()
    const unsubscribe = store.onSettingsChanged(changed)
    await store.updateSetting('museSpark.autosave', false, 'user')
    await store.updateSetting('museSpark.autosave', true, 'workspace')
    expect(
      await new RuntimeSettingsStore(root, '/workspace/one').getSetting('museSpark.autosave'),
    ).toBe(true)
    expect(
      await new RuntimeSettingsStore(root, '/workspace/two').getSetting('museSpark.autosave'),
    ).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    await expect(store.updateSetting('museSpark.autosave', 'false', 'user')).rejects.toThrow()
    await expect(store.updateSetting('museSpark.unknown', true, 'user')).rejects.toThrow(
      'MHP_STATE_UNKNOWN_SETTING',
    )
    await expect(store.getSetting('foreign.autosave')).rejects.toThrow()
    unsubscribe()
    await store.updateSetting('museSpark.autosave', false, 'workspace')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('retains null and false values and isolates settings, global storage and each workspace', async () => {
    const { root, store } = await setup()
    await store.setStorage('museSpark.autosave', false, 'user')
    await store.setStorage('ui-state', { saved: [1, null, false] }, 'workspace')
    expect(await store.getSetting('museSpark.autosave')).toBe(true)
    const other = new RuntimeSettingsStore(root, '/workspace/two')
    expect(await other.getStorage('museSpark.autosave', 'user')).toBe(false)
    expect(await other.getStorage('ui-state', 'workspace')).toBeNull()
    expect(await store.getStorage('ui-state', 'workspace')).toEqual({ saved: [1, null, false] })
    await store.setStorage('', true, 'user')
    expect(await store.getStorage('', 'user')).toBe(true)
    await store.setStorage('ui-state', null, 'workspace')
    expect(await store.getStorage('ui-state', 'workspace')).toBeNull()
    await store.updateSetting('museSpark.modelApiPermissionProfile', null, 'user')
    expect(await store.getSetting('museSpark.modelApiPermissionProfile')).toBeNull()
  })

  it('orders same-key writes and does not lose unrelated keys from independent stores', async () => {
    const { root, store } = await setup()
    const other = new RuntimeSettingsStore(root, '/workspace/one')
    await Promise.all([
      store.setStorage('one', 1, 'user'),
      store.setStorage('one', 2, 'user'),
      other.setStorage('two', 2, 'user'),
    ])
    expect(await store.getStorage('one', 'user')).toBe(2)
    expect(await store.getStorage('two', 'user')).toBe(2)
    expect(filesUnder(root).every((file) => file.endsWith('.json'))).toBe(true)
  })

  it('hashes untrusted keys and refuses named credentials before persisting them', async () => {
    const { root, store } = await setup()
    await store.setStorage('../../outside', 'allowed value', 'user')
    expect(await store.getStorage('../../outside', 'user')).toBe('allowed value')
    const before = filesUnder(root)
    await expect(store.setStorage('api_key', 'never-stored', 'user')).rejects.toThrow(
      'MHP_STATE_CREDENTIAL_REFUSED',
    )
    await expect(
      store.setStorage('ordinary', { nested: { password: 'never-stored' } }, 'user'),
    ).rejects.toThrow('MHP_STATE_CREDENTIAL_REFUSED')
    await expect(
      store.updateSetting(
        'museSpark.environmentVariables',
        [{ name: 'META_API_KEY', value: 'never-stored' }],
        'user',
      ),
    ).rejects.toThrow('MHP_STATE_CREDENTIAL_REFUSED')
    await expect(store.setStorage('ordinary', 'password=example-value', 'user')).rejects.toThrow(
      'MHP_STATE_CREDENTIAL_REFUSED',
    )
    expect(filesUnder(root)).toEqual(before)
    for (const file of before) {
      expect(path.dirname(file)).toBe(path.join(root, RUNTIME_STATE.folder, 'storage', 'global'))
      expect(await readFile(file, 'utf8')).not.toContain('never-stored')
      if (process.platform === 'win32') continue
      const info = await stat(file)
      expect(info.mode & POSIX_PERMISSIONS).toBe(RUNTIME_STATE.fileMode)
      const directory = await stat(path.dirname(file))
      expect(directory.mode & POSIX_PERMISSIONS).toBe(RUNTIME_STATE.directoryMode)
    }
  })

  it('refuses corrupt, mismatched and oversized records and over-limit writes', async () => {
    const { root, store } = await setup()
    await expect(
      store.setStorage('x'.repeat(RUNTIME_STATE.maximumKeyChars + 1), null, 'user'),
    ).rejects.toThrow()
    const key = 'ordinary'
    await store.setStorage(key, 'original', 'user')
    const file = filesUnder(root)[0]
    if (file === undefined) throw new Error('no record')
    await writeFile(
      file,
      JSON.stringify({ version: RUNTIME_STATE.version, key, value: 'original', extra: true }),
    )
    await expect(store.getStorage(key, 'user')).rejects.toThrow()
    await writeFile(file, 'not JSON')
    await expect(store.getStorage(key, 'user')).rejects.toThrow()
    await writeFile(
      file,
      JSON.stringify({ version: RUNTIME_STATE.version + 1, key, value: 'original' }),
    )
    await expect(store.getStorage(key, 'user')).rejects.toThrow()
    await writeFile(
      file,
      JSON.stringify({ version: RUNTIME_STATE.version, key: 'other', value: 'original' }),
    )
    await expect(store.getStorage(key, 'user')).rejects.toThrow('MHP_STATE_INVALID_RECORD')
    await writeFile(file, 'x'.repeat(RUNTIME_STATE.maximumRecordBytes + 1))
    await expect(store.getStorage(key, 'user')).rejects.toThrow('MHP_STATE_INVALID_RECORD')
    await expect(
      store.setStorage('large', 'x'.repeat(RUNTIME_STATE.maximumRecordBytes + 1), 'user'),
    ).rejects.toThrow('MHP_STATE_TOO_LARGE')
  })

  it('refuses a linked record rather than reading another file', async () => {
    const { root, store } = await setup()
    await store.setStorage('target', 'private', 'user')
    const target = filesUnder(root)[0]
    if (target === undefined) throw new Error('no record')
    const name = createHash('sha256').update('link').digest('hex')
    const linked = path.join(path.dirname(target), `${name}.json`)
    await writeFile(
      target,
      JSON.stringify({ version: RUNTIME_STATE.version, key: 'link', value: 'private' }),
    )
    await symlink(target, linked)
    await expect(store.getStorage('link', 'user')).rejects.toThrow()
  })
})
