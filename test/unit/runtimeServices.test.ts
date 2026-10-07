import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { runtimeProvidersFile } from '../../src/runtime/providers/providersFileStore'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import type { KeyringEntryFactory } from '../../src/runtime/keyStore'

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

function keyring(): { openEntry: KeyringEntryFactory; values: Map<string, string> } {
  const values = new Map<string, string>()
  const openEntry: KeyringEntryFactory = (_service, name) => ({
    getPassword: () => Promise.resolve(values.get(name)),
    setPassword: (value: string) => {
      values.set(name, value)
      return Promise.resolve()
    },
    deletePassword: () => Promise.resolve(values.delete(name)),
  })
  return { openEntry, values }
}

function rig() {
  const folder = mkdtempSync(path.join(tmpdir(), 'm108-services-'))
  dirs.push(folder)
  seed(folder)
  const { openEntry } = keyring()
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
