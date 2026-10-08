import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL_API_BASE_URL, SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { runtimeProvidersFile } from '../../src/runtime/providers/providersFileStore'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { memoryKeyring } from './helpers/keyring'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const ENTRY = {
  id: 'vendor',
  policyProvider: 'vendor',
  product: 'model-api',
  auth: 'apiKey',
  origin: 'https://example.test',
} as const

function seed(folder: string): void {
  writeFileSync(
    runtimeProvidersFile(folder),
    JSON.stringify({ providers: { vendor: { ...ENTRY } } }),
  )
}

function rig() {
  // macOS spells $TMPDIR through a /var symlink the developer root refuses.
  const folder = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'm108-services-'))
  dirs.push(folder)
  seed(folder)
  const { openEntry } = memoryKeyring()
  return createRuntimeAccountServices({
    dataDir: folder,
    openEntry,
    now: () => Date.parse('2026-10-07T12:00:00Z'),
  })
}

const ROW = { id: 'work', label: 'Work', order: 0, thresholds: {} } as const

describe('createRuntimeAccountServices', () => {
  it('manages accounts through the file-backed store', async () => {
    const services = rig()
    try {
      // An absent accounts field migrates the default account (K).
      await services.store.add('vendor', { ...ROW, order: 1 })
      await expect(services.store.list('vendor')).resolves.toMatchObject([
        { id: 'default' },
        { id: 'work' },
      ])
      await services.store.remove('vendor', 'work')
      await expect(services.store.list('vendor')).resolves.toMatchObject([{ id: 'default' }])
    } finally {
      services.dispose()
    }
  })

  it('publishes fresh state to subscribers after a mutation', async () => {
    const services = rig()
    try {
      const port = services.sessions('vendor')
      const seen: unknown[] = []
      const stop = port.subscribe('session-a', (event) => {
        seen.push(event)
      })
      try {
        await services.store.add('vendor', { ...ROW, order: 1 })
        await vi.waitFor(() => {
          if (seen.length === 0) throw new Error('no snapshot yet')
        })
        expect(seen.at(-1)).toMatchObject({
          type: 'accounts/state',
          currentAccount: 'default',
          accounts: [{ id: 'default' }, { id: 'work' }],
        })
      } finally {
        stop()
      }
    } finally {
      services.dispose()
    }
  })

  it('reads state and re-adopts the current account only', async () => {
    const services = rig()
    try {
      await services.store.add('vendor', { ...ROW, order: 1 })
      const port = services.sessions('vendor')
      const state = await port.read('session-a')
      expect(state).toMatchObject({ type: 'accounts/state', currentAccount: 'default' })
      await expect(port.use('session-a', 'default', () => true)).resolves.toMatchObject({
        currentAccount: 'default',
      })
      await expect(port.use('session-a', 'missing', () => true)).rejects.toThrow()
      await expect(port.use('session-a', 'work', () => true)).rejects.toThrow(/unavailable/)
      await expect(port.use('session-a', 'default', () => false)).resolves.toMatchObject({
        currentAccount: 'default',
      })
    } finally {
      services.dispose()
    }
  })

  it('keeps the actual default identity through reorder and removal instead of adopting another account', async () => {
    const services = rig()
    try {
      await services.store.add('vendor', { ...ROW, order: 1 })
      const port = services.sessions('vendor')
      await services.store.order('vendor', ['work', 'default'])
      await expect(port.read('session-a')).resolves.toMatchObject({ currentAccount: 'default' })
      await expect(port.use('session-a', 'work', () => true)).rejects.toThrow(
        UI_TEXT.accounts.unavailable,
      )
      await services.store.remove('vendor', 'default')
      await expect(port.read('session-a')).resolves.toMatchObject({ currentAccount: null })
      await expect(port.use('session-a', 'work', () => true)).rejects.toThrow(
        UI_TEXT.accounts.unavailable,
      )
    } finally {
      services.dispose()
    }
  })

  it('binds the headless port to its requested credential and publishes that fixed identity', async () => {
    const services = rig()
    const folder = dirs[0]
    if (folder === undefined) throw new Error('missing test folder')
    const parsed = parseCommandLine(['--backend', 'modelApi'])
    if (parsed.command !== 'serve') throw new Error('missing test serve options')
    const origin = new URL(MODEL_API_BASE_URL).origin
    writeFileSync(
      runtimeProvidersFile(folder),
      JSON.stringify({
        providers: {
          meta: { ...ENTRY, id: 'meta', policyProvider: 'meta', origin },
        },
      }),
    )
    await services.store.add('meta', { ...ROW, order: 1 })
    await services.store.setCredential('meta', 'work', {
      v: 1,
      auth: 'apiKey',
      provider: 'meta',
      account: 'work',
      origin,
      secret: 'LLM|1|fake-work-key',
    })
    const get = vi.fn(() => Promise.resolve('LLM|1|fake-legacy-key'))
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error('unexpected fetch')),
    )
    // CAPS017: the services build the runtime only through the caller's factory.
    const createBackend = vi.fn(createRuntimeBackend)
    const configured = services.exec.create(
      {
        options: parsed.options,
        version: 'test',
        distDir: folder,
        platform: process.platform,
        env: {},
        homeDir: folder,
        secrets: { get, store: () => Promise.resolve(), delete: () => Promise.resolve() },
        runGit: () => Promise.reject(new Error('unexpected git')),
        fetch,
        sleep: () => Promise.resolve(),
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      },
      { account: 'work', hasPoolFlag: false, isInteractive: false },
      createBackend,
    )
    expect(createBackend).toHaveBeenCalledOnce()
    expect(createBackend.mock.results[0]?.value).toBe(configured.runtime)
    const seen: unknown[] = []
    const stop = configured.accounts.subscribe('run-a', (state) => {
      seen.push(state)
    })
    try {
      await expect(configured.runtime.backend.readiness(false)).resolves.toMatchObject({
        state: 'ready',
      })
      expect(get).not.toHaveBeenCalled()
      await expect(configured.accounts.read('run-a')).resolves.toMatchObject({
        currentAccount: 'work',
      })
      await services.store.order('meta', ['work', 'default'])
      await vi.waitFor(() => {
        expect(seen.at(-1)).toMatchObject({ currentAccount: 'work' })
      })
      await expect(services.sessions('meta').read('session-a')).resolves.toMatchObject({
        currentAccount: 'default',
      })
      await expect(configured.accounts.use('run-a', 'default', () => true)).rejects.toThrow(
        UI_TEXT.accounts.unavailable,
      )
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      stop()
      await configured.runtime.close()
      services.dispose()
    }
  })

  it('uses legacy key fallback only for an absent Meta default binding', async () => {
    const services = rig()
    const get = vi.fn(() => Promise.resolve('LLM|1|fake-legacy-key'))
    const fallback = { get, store: () => Promise.resolve(), delete: () => Promise.resolve() }
    try {
      for (const [provider, account] of [
        ['meta', 'work'],
        ['absent', 'default'],
        ['absent', 'work'],
      ]) {
        if (provider === undefined || account === undefined)
          throw new Error('missing fixture identity')
        await expect(
          services.secretsFor(provider, account, fallback).get(SECRET_KEYS.modelApiKey),
        ).rejects.toThrow(UI_TEXT.accounts.unavailable)
      }
      expect(get).not.toHaveBeenCalled()
      await expect(
        services.secretsFor('meta', 'default', fallback).get(SECRET_KEYS.modelApiKey),
      ).resolves.toBe('LLM|1|fake-legacy-key')
    } finally {
      services.dispose()
    }
  })

  it('refuses malformed Meta metadata before reading any legacy key', async () => {
    const services = rig()
    const folder = dirs[0]
    if (folder === undefined) throw new Error('missing test folder')
    writeFileSync(
      runtimeProvidersFile(folder),
      JSON.stringify({ providers: { meta: { ...ENTRY, auth: 'bad' } } }),
    )
    const get = vi.fn(() => Promise.resolve('LLM|1|fake-legacy-key'))
    try {
      await expect(
        services
          .secretsFor('meta', 'default', {
            get,
            store: () => Promise.resolve(),
            delete: () => Promise.resolve(),
          })
          .get(SECRET_KEYS.modelApiKey),
      ).rejects.toThrow()
      expect(get).not.toHaveBeenCalled()
    } finally {
      services.dispose()
    }
  })

  it('serves the fixed account key through the backend secrets', async () => {
    const services = rig()
    try {
      await services.store.add('vendor', { ...ROW })
      await services.store.setCredential('vendor', 'work', {
        provider: 'vendor',
        account: 'work',
        origin: 'https://example.test',
        v: 1,
        auth: 'apiKey',
        secret: 'vendor-secret',
      })
      const fallback = {
        get: () => Promise.resolve('fallback'),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }
      const secrets = services.secretsFor('vendor', 'work', fallback)
      await expect(secrets.get(SECRET_KEYS.modelApiKey)).resolves.toBe('vendor-secret')
      await expect(secrets.get('something-else')).resolves.toBe('fallback')
    } finally {
      services.dispose()
    }
  })

  it('refuses unbound profile cleanup and retains ownership after a failed launch', async () => {
    const services = rig()
    try {
      await services.store.add('vendor', { ...ROW, order: 1 })
      const owner = await services.developer({
        readLine: () => Promise.resolve(UI_TEXT.accounts.confirm),
        print: vi.fn(),
      })
      await owner.unlock('terminal')
      await owner.setMultiple(true)
      await expect(owner.addProfile('vendor', 'work')).rejects.toThrow(
        UI_TEXT.developer.unavailable,
      )
      await expect(owner.addProfile('vendor', 'default')).rejects.toThrow(
        UI_TEXT.developer.unavailable,
      )
      const profiles = owner.snapshot().profiles
      expect(profiles).toHaveLength(2)
      expect(new Set(profiles.map((row) => row.id)).size).toBe(2)
      const [profile] = profiles
      if (profile === undefined) throw new Error('failed launch lost its ownership ledger')
      for (const cleanup of [
        () => owner.setMultiple(false),
        () => owner.removeProfile(profile.id),
        () => owner.reset(),
      ]) {
        await expect(cleanup()).rejects.toThrow(UI_TEXT.developer.unavailable)
        expect(owner.snapshot().profiles).toEqual(profiles)
      }
    } finally {
      services.dispose()
    }
  })

  it('opens a locked developer owner without profile bindings', async () => {
    const services = rig()
    try {
      const printed: string[] = []
      const owner = await services.developer({
        readLine: () => Promise.resolve(''),
        print: (line) => {
          printed.push(line)
        },
      })
      expect(owner.snapshot().isUnlocked).toBe(false)
      expect(printed).toEqual([])
    } finally {
      services.dispose()
    }
  })
})
