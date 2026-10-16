// RVAPP-CM1091D5 BYTES: the second lazy vault bundle (dist/vaultActions.js).
// The loader requires it on the first explicit action, refuses a missing or
// corrupt bundle with the operation failure sentence, and logs the bundle
// name (never a path or credential). Each case fails without its guard.
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import {
  isVaultActionsBundle,
  vaultActionsLoader,
} from '../../../src/host/vault/vaultActionsBundle'
import { FakeLogOutputChannel } from '../helpers/fakes'

const bundle = {
  vaultActionDialogs: () => ({}),
  encodeVaultMaterial: () => Buffer.alloc(0),
}

describe('isVaultActionsBundle', () => {
  it('accepts a module that exports the dialogs and the encoder, and nothing else', () => {
    expect(isVaultActionsBundle({ ...bundle })).toBe(true)
    expect(isVaultActionsBundle({ vaultActionDialogs: () => ({}) })).toBe(false)
    expect(isVaultActionsBundle({ encodeVaultMaterial: 1 })).toBe(false)
    expect(isVaultActionsBundle({})).toBe(false)
    expect(isVaultActionsBundle(null)).toBe(false)
    expect(isVaultActionsBundle('vaultActionDialogs')).toBe(false)
  })
})

describe('vaultActionsLoader', () => {
  it('logs fixed loader failures without paths or arbitrary error content', () => {
    const log = new FakeLogOutputChannel()
    const load = vaultActionsLoader({
      bundlePath: '/home/private/vaultActions.js',
      log,
      loadBundle: () => {
        throw new Error('opaque-demo-value in /home/private/vaultActions.js')
      },
    })
    expect(() => load()).toThrow(UI_TEXT.vault.operationFailed)
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'The vault actions bundle could not be loaded',
    )
  })

  it('loads the bundle once and keeps it', () => {
    const loadBundle = vi.fn(() => bundle)
    const load = vaultActionsLoader({
      bundlePath: '/dist/vaultActions.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(load()).toBe(bundle)
    expect(load()).toBe(bundle)
    expect(loadBundle).toHaveBeenCalledOnce()
    expect(loadBundle).toHaveBeenCalledWith('/dist/vaultActions.js')
  })

  it('says why a module that cannot be loaded is refused, and tries again on the next call', () => {
    const log = new FakeLogOutputChannel()
    let isBroken = true
    const load = vaultActionsLoader({
      bundlePath: '/dist/vaultActions.js',
      log,
      loadBundle: () => {
        if (isBroken) throw new Error('Cannot find module')
        return bundle
      },
    })
    expect(() => load()).toThrow(UI_TEXT.vault.operationFailed)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('could not be loaded'))
    isBroken = false
    expect(load()).toBe(bundle)
  })

  it('refuses a module that does not export the actions', () => {
    const log = new FakeLogOutputChannel()
    const load = vaultActionsLoader({
      bundlePath: '/dist/vaultActions.js',
      log,
      loadBundle: () => ({ somethingElse: true }),
    })
    expect(() => load()).toThrow(UI_TEXT.vault.operationFailed)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('does not export the actions'))
  })
})
