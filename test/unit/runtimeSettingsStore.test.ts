import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import type * as FsPromises from 'node:fs/promises'
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { RUNTIME_STATE } from '../../src/shared/constants'
import { filesUnder, removeFolder } from './helpers/temporaryFolders'

const publishGate = vi.hoisted(() => ({
  beforeLock: (_file: string): Promise<void> => Promise.resolve(),
  lockAttempts: 0,
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
    async open(...args: Parameters<typeof original.open>) {
      const file = args[0].toString()
      if (file.endsWith('.lock')) {
        publishGate.lockAttempts += 1
        await publishGate.beforeLock(file)
      }
      return await original.open(...args)
    },
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
  it('distinguishes defaults from explicit user/workspace settings for CLI precedence', async () => {
    const { store } = await setup()
    expect(await store.getSetting('museSpark.shellSandbox')).toBe('auto')
    expect(await store.hasSetting('museSpark.shellSandbox')).toBe(false)
    await store.updateSetting('museSpark.shellSandbox', 'auto', 'user')
    expect(await store.hasSetting('museSpark.shellSandbox')).toBe(true)
    await store.updateSetting('museSpark.autosave', false, 'workspace')
    expect(await store.hasSetting('museSpark.autosave')).toBe(true)
    await expect(store.hasSetting('museSpark.unknown')).rejects.toThrow('MHP_STATE_UNKNOWN_SETTING')
  })
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
  it('serializes the same resolved record across independent store instances', async () => {
    const { root, store } = await setup()
    const other = new RuntimeSettingsStore(path.join(root, '.'), '/workspace/one')
    const release = Promise.withResolvers<boolean>()
    publishGate.isOn = true
    publishGate.arrivals = 0
    publishGate.lockAttempts = 0
    publishGate.released = release.promise
    const writes: Promise<void>[] = []
    try {
      writes.push(store.setStorage('lastSession', { sessionId: 'older', at: 1 }, 'workspace'))
      await vi.waitFor(() => {
        expect(publishGate.arrivals).toBe(1)
      })
      writes.push(other.setStorage('lastSession', { sessionId: 'newer', at: 2 }, 'workspace'))
      await new Promise((resolve) => setTimeout(resolve, OBSERVATION_MS))
      expect(publishGate.arrivals).toBe(1)
      expect(publishGate.lockAttempts).toBe(1)
    } finally {
      release.resolve(true)
      await Promise.all(writes)
      await Promise.all([store.settled(), other.settled()])
      publishGate.isOn = false
    }
    expect(await store.getStorage('lastSession', 'workspace')).toEqual({
      sessionId: 'newer',
      at: 2,
    })
  })

  it('refuses a stale revision and retries from the newer record before publication', async () => {
    const { root, store } = await setup()
    await store.setStorage('cas', 0, 'user')
    const record = filesUnder(root).find((file) => file.endsWith('.json'))
    if (record === undefined) throw new Error('missing record')
    publishGate.lockAttempts = 0
    let isFirst = true
    publishGate.beforeLock = async () => {
      if (!isFirst) return
      isFirst = false
      await writeFile(
        record,
        JSON.stringify({ version: RUNTIME_STATE.version, key: 'cas', value: 1, revision: 7 }),
      )
    }
    try {
      await store.setStorage('cas', 2, 'user')
    } finally {
      publishGate.beforeLock = () => Promise.resolve()
    }
    expect(publishGate.lockAttempts).toBe(2)
    expect(JSON.parse(await readFile(record, 'utf8'))).toMatchObject({ value: 2, revision: 8 })
  })

  it('migrates legacy activity records without overwriting a newer observation', async () => {
    const { root, store } = await setup()
    await store.setStorage('lastSession', { sessionId: 'seed', at: 1 }, 'workspace')
    const file = filesUnder(root).find((file) => file.endsWith('.json'))
    if (file === undefined) throw new Error('missing record')
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        key: 'lastSession',
        value: { sessionId: 'legacy-newer', at: 2 },
      }),
    )
    await store.setStorage('lastSession', { sessionId: 'older', at: 1 }, 'workspace')
    expect(await store.getStorage('lastSession', 'workspace')).toEqual({
      sessionId: 'legacy-newer',
      at: 2,
    })
    await store.setStorage('lastSession', { sessionId: 'latest', at: 3 }, 'workspace')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: RUNTIME_STATE.version,
      revision: 1,
      activityAt: 3,
    })
  })

  it('keeps newest activity even when an older observation arrives later, with revision breaking ties', async () => {
    const { root, store } = await setup()
    const other = new RuntimeSettingsStore(root, '/workspace/one')
    await store.setStorage('lastSession', { sessionId: 'newer', at: 2 }, 'workspace')
    await other.setStorage('lastSession', { sessionId: 'older', at: 1 }, 'workspace')
    expect(await other.getStorage('lastSession', 'workspace')).toEqual({
      sessionId: 'newer',
      at: 2,
    })
    await other.setStorage('lastSession', { sessionId: 'tie', at: 2 }, 'workspace')
    expect(await store.getStorage('lastSession', 'workspace')).toEqual({ sessionId: 'tie', at: 2 })
  })

  it('publishes setting changes to other same-root stores and preserves workspace isolation', async () => {
    const { root, store } = await setup()
    const other = new RuntimeSettingsStore(root, '/workspace/one')
    const unrelated = new RuntimeSettingsStore(root, '/workspace/two')
    const peer = vi.fn(),
      elsewhere = vi.fn()
    const stops = [other.onSettingsChanged(peer), unrelated.onSettingsChanged(elsewhere)]
    try {
      await store.updateSetting('museSpark.autosave', false, 'workspace')
      expect(peer).toHaveBeenCalledExactlyOnceWith(['museSpark.autosave'])
      expect(elsewhere).not.toHaveBeenCalled()
      await store.updateSetting('museSpark.autosave', false, 'user')
      expect(peer).toHaveBeenCalledTimes(2)
      expect(elsewhere).toHaveBeenCalledOnce()
    } finally {
      for (const stop of stops) stop()
    }
  })

  it('coordinates real separate processes without a lost revision or older restore', async () => {
    const { root, store } = await setup()
    const output = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'ts',
        contents: `
      import { RuntimeSettingsStore } from './src/runtime/settingsStore';
      const store = new RuntimeSettingsStore(process.argv[2], '/workspace/one');
      store.setStorage('lastSession', { sessionId: 'process-' + process.argv[3], at: Number(process.argv[3]) }, 'workspace')
        .then(() => store.settled()).catch(() => { process.exitCode = 1 });
    `,
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    const code = output.outputFiles[0]?.text
    if (code === undefined) throw new Error('missing fake writer')
    // A private script file avoids Linux's per-argument limit as the real bundle grows.
    const writerRoot = await mkdtemp(path.join(tmpdir(), 'runtime-state-writer-'))
    folders.push(writerRoot)
    const writer = path.join(writerRoot, 'writer.cjs')
    await writeFile(writer, code)
    await store.setStorage('lastSession', { sessionId: 'initial', at: 0 }, 'workspace')
    await Promise.all(
      [1, 2].map((at) =>
        promisify(execFile)(process.execPath, [writer, root, String(at)], { env: {} }),
      ),
    )
    expect(await store.getStorage('lastSession', 'workspace')).toEqual({
      sessionId: 'process-2',
      at: 2,
    })
    const file = filesUnder(root).find((file) => file.endsWith('.json'))
    if (file === undefined) throw new Error('missing record')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: RUNTIME_STATE.version,
      revision: expect.any(Number),
      activityAt: 2,
    })
    expect(filesUnder(root).every((entry) => entry.endsWith('.json'))).toBe(true)
  })

  it('refuses an owned or abandoned lock at the fixed deadline without stealing it', async () => {
    const { root, store } = await setup()
    await store.setStorage('locked', 1, 'user')
    const file = filesUnder(root).find((entry) => entry.endsWith('.json'))
    if (file === undefined) throw new Error('missing record')
    await writeFile(`${file}.lock`, 'owned')
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(RUNTIME_STATE.lockTimeoutMs)
    try {
      await expect(store.setStorage('locked', 2, 'user')).rejects.toThrow('MHP_STATE_LOCK_TIMEOUT')
    } finally {
      clock.mockRestore()
    }
    expect(await readFile(`${file}.lock`, 'utf8')).toBe('owned')
    expect(await store.getStorage('locked', 'user')).toBe(1)
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
