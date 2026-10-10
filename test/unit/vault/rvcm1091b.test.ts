// RVCM1091B part-A regressions (2 P1, 2 P2). Each case fails without its fix;
// m109-rvcm1091b-drills.json records the drills. Generated material only.

import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { UI_TEXT, VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import type { VaultItem } from '../../../src/shared/vault'
import { VaultError } from '../../../src/core/vault/crypto'
import { VaultStore } from '../../../src/core/vault/store'
import { VaultStoreUnavailableError } from '../../../src/core/vault/broker/ports'
import { vaultRefusalMessage } from '../../../src/core/vault/broker/manageClient'
import { grant, metadata } from '../helpers/vault/fixtures'
import { heldWriteVault } from './storeFixtures'
import { heldSetupConfirmation, managementFixture, stateOf } from './managementFixture'

const item = (): VaultItem => ({
  metadata: metadata(),
  material: { kind: 'secret', value: randomBytes(24) },
})
async function created(f: ReturnType<typeof managementFixture>): Promise<Buffer> {
  const shown = await f.management.setup()
  await f.management.confirmSetup(shown.setupId)
  return shown.code
}

describe('RVCM1091B part A', () => {
  it('1: a grant committed before a Lock completes, reports success and stays', async () => {
    const { vault, files, held, state } = await heldWriteVault('slots.v1', item())
    const saving = vault.store.saveGrant(grant(), () => undefined)
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    // The intent is already durable; Lock lands while it completes.
    vault.store.lock()
    held.resolve(undefined)
    await saving
    files.hold = null
    const reopened = await VaultStore.open(vault.options, vault.vaultId)
    expect(await reopened.grants()).toHaveLength(1)
  })

  it('2a: recovery while unlocked unwraps no key', async () => {
    const f = managementFixture()
    const code = await created(f)
    const offer = vi.spyOn(f.unlock, 'offerRecovery')
    await f.management.recover(code)
    expect(offer).not.toHaveBeenCalled()
    expect(await stateOf(f.management)).toBe('unlocked')
    code.fill(0)
  })

  it('2b: Lock erases an unconfirmed setup and its key', async () => {
    const f = managementFixture()
    const shown = await f.management.setup()
    f.management.noteLocked(1)
    await expect(f.management.confirmSetup(shown.setupId)).rejects.toMatchObject({
      reason: 'invalid',
    })
    expect(await stateOf(f.management)).toBe('uncreated')
    shown.code.fill(0)
  })

  it('2c: Lock during a failing confirmation erases the key instead of restoring the setup', async () => {
    const release = Promise.withResolvers<undefined>()
    const f = managementFixture(release.promise)
    vi.spyOn(f.osStore, 'wrap').mockRejectedValueOnce(new Error('generated wrap failure'))
    const { shown, confirming } = await heldSetupConfirmation(f)
    f.management.noteLocked(1)
    release.resolve(undefined)
    await expect(confirming).rejects.toMatchObject({ reason: 'io' })
    expect(await stateOf(f.management)).toBe('uncreated')
    shown.code.fill(0)
  })

  it('3a: a transient first anchor failure is retried by confirming again', async () => {
    const f = managementFixture()
    vi.spyOn(f.anchor, 'advance').mockRejectedValueOnce(new VaultError('io'))
    const shown = await f.management.setup()
    await expect(f.management.confirmSetup(shown.setupId)).rejects.toThrow()
    expect(f.files.data.has('pending.v1')).toBe(true)
    await f.management.confirmSetup(shown.setupId)
    expect(await stateOf(f.management)).toBe('unlocked')
    expect(f.files.data.has('pending.v1')).toBe(false)
    shown.code.fill(0)
  })

  it('3b: an abandoned first intent never blocks a fresh setup', async () => {
    const f = managementFixture()
    vi.spyOn(f.anchor, 'advance').mockRejectedValueOnce(new VaultError('io'))
    const first = await f.management.setup()
    await expect(f.management.confirmSetup(first.setupId)).rejects.toThrow()
    f.clock.advance(VAULT_APPROVAL_TTL_MS)
    const again = await f.management.setup()
    await f.management.confirmSetup(again.setupId)
    expect(await stateOf(f.management)).toBe('unlocked')
    first.code.fill(0)
    again.code.fill(0)
  })

  it('4: an unusable OS store reaches the person as its fixed repair', async () => {
    const f = managementFixture()
    vi.spyOn(f.anchor, 'vaultId').mockRejectedValueOnce(new VaultStoreUnavailableError())
    await expect(f.management.setup()).rejects.toMatchObject({ reason: 'storeUnavailable' })
    vi.spyOn(f.osStore, 'wrap').mockRejectedValueOnce(new VaultStoreUnavailableError())
    const shown = await f.management.setup()
    await expect(f.management.confirmSetup(shown.setupId)).rejects.toMatchObject({
      reason: 'storeUnavailable',
    })
    expect(vaultRefusalMessage('storeUnavailable')).toBe(UI_TEXT.vault.storeUnavailable)
    await f.management.confirmSetup(shown.setupId)
    f.broker.lock()
    vi.spyOn(f.osStore, 'unwrap').mockRejectedValueOnce(new VaultStoreUnavailableError())
    await expect(f.unlock.unlock(null)).rejects.toBeInstanceOf(VaultStoreUnavailableError)
    shown.code.fill(0)
  })
})
