// W's lazy dist/vault.js boundary (PLAN.md D6): the loader refuses a missing
// or malformed module with `vault.brokerBlocked`, the window commands refuse
// closed while the broker-backed service is missing (never an empty vault),
// and a working bundle's controls are built once and delegated to.

import { describe, expect, it, vi } from 'vitest'
import {
  isVaultBundle,
  loadVaultControls,
  registerVaultCommands,
  vaultBundleLoader,
  type VaultBundle,
  type VaultControlsDeps,
  type VaultWindowControls,
} from '../../../src/host/vault/vaultPanelBundle'
import type { VaultPanelService } from '../../../src/host/vault/vaultPanelHost'
import { UI_TEXT } from '../../../src/shared/constants'
import { uiLocale } from '../../../src/shared/l10n/text'
import { FakeLogOutputChannel } from '../helpers/fakes'

function service(): VaultPanelService {
  return {
    snapshot: vi.fn(() => Promise.reject(new Error('unused'))),
    subscribe: vi.fn(() => vi.fn()),
    unlock: vi.fn(() => Promise.reject(new Error('unused'))),
    lock: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.reject(new Error('unused'))),
    updateMetadata: vi.fn(() => Promise.reject(new Error('unused'))),
    remove: vi.fn(() => Promise.reject(new Error('unused'))),
    grant: vi.fn(() => Promise.reject(new Error('unused'))),
    revoke: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    importFile: vi.fn(() => Promise.reject(new Error('unused'))),
  }
}

function deps(overrides?: Partial<VaultControlsDeps>): VaultControlsDeps {
  return {
    bundlePath: '/dist/vault.js',
    log: new FakeLogOutputChannel(),
    service: service(),
    ...overrides,
  }
}

function connect() {
  return {
    openPanel: vi.fn(() => Promise.resolve()),
    sshKey: vi.fn(() => Promise.reject(new Error('unused'))),
    now: () => 1000,
    publish: vi.fn(),
  }
}

describe('isVaultBundle', () => {
  it('accepts a module that exports the panel factory, and nothing else', () => {
    expect(isVaultBundle({ createVaultPanelHost: () => ({}) })).toBe(true)
    expect(isVaultBundle({ createVaultPanelHost: 1 })).toBe(false)
    expect(isVaultBundle({})).toBe(false)
    expect(isVaultBundle(null)).toBe(false)
    expect(isVaultBundle('createVaultPanelHost')).toBe(false)
  })
})

describe('vaultBundleLoader', () => {
  const bundle: VaultBundle = {
    createVaultPanelHost: () => ({}) as unknown as ReturnType<VaultBundle['createVaultPanelHost']>,
  }

  it('logs fixed loader failures without paths or arbitrary error content', () => {
    const log = new FakeLogOutputChannel()
    const load = vaultBundleLoader({
      bundlePath: '/home/private/vault.js',
      log,
      loadBundle: () => {
        throw new Error('opaque-demo-value in /home/private/vault.js')
      },
    })
    expect(() => load()).toThrow(UI_TEXT.vault.brokerBlocked)
    expect(log.error).toHaveBeenCalledExactlyOnceWith('The vault bundle could not be loaded')
  })

  it('loads the bundle once and keeps it', () => {
    const loadBundle = vi.fn(() => bundle)
    const load = vaultBundleLoader({
      bundlePath: '/dist/vault.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(load()).toBe(bundle)
    expect(load()).toBe(bundle)
    expect(loadBundle).toHaveBeenCalledOnce()
    expect(loadBundle).toHaveBeenCalledWith('/dist/vault.js')
  })

  it('says why a module that cannot be loaded is refused, and tries again on the next call', () => {
    const log = new FakeLogOutputChannel()
    let isBroken = true
    const load = vaultBundleLoader({
      bundlePath: '/dist/vault.js',
      log,
      loadBundle: () => {
        if (isBroken) throw new Error('Cannot find module')
        return bundle
      },
    })
    expect(() => load()).toThrow(UI_TEXT.vault.brokerBlocked)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'))
    isBroken = false
    expect(load()).toBe(bundle)
  })

  it('refuses a module that does not export the panel', () => {
    const log = new FakeLogOutputChannel()
    const load = vaultBundleLoader({
      bundlePath: '/dist/vault.js',
      log,
      loadBundle: () => ({ somethingElse: true }),
    })
    expect(() => load()).toThrow(UI_TEXT.vault.brokerBlocked)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('does not export the panel'))
  })
})

describe('loadVaultControls', () => {
  it('refuses closed while the broker-backed service is missing', () => {
    const log = new FakeLogOutputChannel()
    const loadBundle = vi.fn(() => {
      throw new Error('must not be reached')
    })
    const connectMissing = vi.fn(() => {
      throw new Error('must not be reached')
    })
    expect(() =>
      loadVaultControls(deps({ log, loadBundle, service: undefined }), connectMissing),
    ).toThrow(UI_TEXT.vault.brokerBlocked)
    expect(loadBundle).not.toHaveBeenCalled()
    expect(connectMissing).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'The vault panel needs its broker-backed service; refusing closed',
    )
  })

  it('builds the controls from the bundle with the installed language', () => {
    const created = {
      host: { kind: 'host' },
      open: vi.fn(() => Promise.resolve()),
      lock: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(),
    }
    const createVaultPanelHost = vi.fn(() => created)
    const bundle: VaultBundle = { createVaultPanelHost }
    const owned = service()
    const entry = connect()
    const controls = loadVaultControls(
      deps({ loadBundle: () => bundle, service: owned }),
      () => entry,
    )
    expect(createVaultPanelHost).toHaveBeenCalledOnce()
    expect(createVaultPanelHost).toHaveBeenCalledWith(
      { service: owned, ...entry },
      UI_TEXT,
      uiLocale(),
    )
    expect(controls).toBe(created)
  })
})

function registered(load: () => VaultWindowControls) {
  const actions = new Map<string, () => Promise<void>>()
  const disposable = registerVaultCommands((id, action) => {
    actions.set(id, action)
    return { dispose: () => void actions.delete(id) }
  }, load)
  return { actions, disposable }
}

describe('registerVaultCommands', () => {
  it('rejects with the reason while the service is missing', async () => {
    const loadBundle = vi.fn(() => {
      throw new Error('must not be reached')
    })
    const { actions, disposable } = registered(() =>
      loadVaultControls(deps({ loadBundle, service: undefined }), connect),
    )
    await expect(actions.get('museSpark.vault')?.()).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
    await expect(actions.get('museSpark.lockVault')?.()).rejects.toThrow(
      UI_TEXT.vault.brokerBlocked,
    )
    disposable.dispose()
    expect(actions.size).toBe(0)
  })

  it('delegates to one pair of controls', async () => {
    const controls: VaultWindowControls = {
      open: vi.fn(() => Promise.resolve()),
      lock: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(),
    }
    const load = vi.fn(() => controls)
    const { actions, disposable } = registered(load)
    await actions.get('museSpark.vault')?.()
    await actions.get('museSpark.lockVault')?.()
    await actions.get('museSpark.vault')?.()
    expect(load).toHaveBeenCalledOnce()
    expect(controls.open).toHaveBeenCalledTimes(2)
    expect(controls.lock).toHaveBeenCalledOnce()
    disposable.dispose()
    expect(controls.dispose).toHaveBeenCalledOnce()
  })
})
