// RVCM1091A2 regressions: no operation a Lock overtook finishes afterwards
// (P2, every await of confirm, recover, reset and import), and a headless
// open cancelled during registration returns no session (P3). Generated
// material and a generated temporary home only.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VAULT_RESET_WORD } from '../../../src/shared/constants'
import { VaultStore } from '../../../src/core/vault/store'
import type { VaultBrokerConnection } from '../../../src/core/vault/broker/manageClient'
import { openHeadlessVault } from '../../../src/runtime/vault/vaultRuntimeEntry'
import { holdFileWrite } from './storeFixtures'
import {
  heldSetupConfirmation,
  lockedVault,
  managementFixture,
  cleanupTempHomes,
  stateOf,
  tempHome,
} from './managementFixture'

afterEach(cleanupTempHomes)

describe('RVCM1091A2', () => {
  it('P2: a Lock during first creation staging publishes no intent or vault', async () => {
    const f = managementFixture()
    const shown = await f.management.setup()
    const { held, state } = holdFileWrite(f.files, 'pending.v1')
    const confirming = f.management.confirmSetup(shown.setupId)
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    f.management.noteLocked(2)
    held.resolve(undefined)
    await expect(confirming).rejects.toMatchObject({ reason: 'locked' })
    expect(f.files.data.size).toBe(0)
    expect(await f.anchor.vaultId()).toBeNull()
    expect(f.broker.unlock).not.toHaveBeenCalled()
    shown.code.fill(0)
  })

  it('P2: a Lock during reset audit staging preserves the damaged vault and anchor', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    const anchored = await f.anchor.vaultId()
    const damaged = Buffer.from('unreadable-generated-slots')
    f.files.data.set('slots.v1', damaged)
    const challenge = await f.management.resetBegin()
    const { held, state } = holdFileWrite(f.files, 'reset.v1')
    const resetting = f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    f.management.noteLocked(2)
    held.resolve(undefined)
    await expect(resetting).rejects.toMatchObject({ reason: 'locked' })
    expect(f.files.data.has('reset.v1')).toBe(false)
    expect(f.files.data.get('slots.v1')).toEqual(damaged)
    expect(f.files.data.has('vault.v1')).toBe(true)
    expect(f.files.quarantined).toEqual([])
    expect(await f.anchor.vaultId()).toBe(anchored)
    code.fill(0)
  })
  it('P2: a Lock during the wrap of I Saved It creates no vault and unlocks nothing', async () => {
    const release = Promise.withResolvers<undefined>()
    const f = managementFixture(release.promise)
    const { shown, confirming } = await heldSetupConfirmation(f)
    f.management.noteLocked(1)
    release.resolve(undefined)
    await expect(confirming).rejects.toMatchObject({ reason: 'locked' })
    expect(f.broker.unlock).not.toHaveBeenCalled()
    expect(await VaultStore.exists(f.files)).toBe(false)
    shown.code.fill(0)
  })

  it('P2: a Lock after the vault is written leaves it locked, never unlocked', async () => {
    const f = managementFixture()
    const held = Promise.withResolvers<undefined>()
    const advance = f.anchor.advance.bind(f.anchor)
    let isHeld = false
    vi.spyOn(f.anchor, 'advance').mockImplementationOnce(async (...args) => {
      isHeld = true
      await held.promise
      await advance(...args)
    })
    const shown = await f.management.setup()
    const confirming = f.management.confirmSetup(shown.setupId)
    await vi.waitFor(() => {
      expect(isHeld).toBe(true)
    })
    f.management.noteLocked(1)
    held.resolve(undefined)
    await expect(confirming).rejects.toMatchObject({ reason: 'locked' })
    expect(f.broker.unlock).not.toHaveBeenCalled()
    expect(await VaultStore.exists(f.files)).toBe(true)
    expect(await stateOf(f.management)).toBe('locked')
    shown.code.fill(0)
  })

  it('P2: a Lock during recovery offers no key and unlocks nothing', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    const held = Promise.withResolvers<undefined>()
    const records = f.unlock.records.bind(f.unlock)
    vi.spyOn(f.unlock, 'records').mockImplementationOnce(async () => {
      await held.promise
      return await records()
    })
    const offer = vi.spyOn(f.unlock, 'offerRecovery')
    const recovering = f.management.recover(code)
    await vi.waitFor(() => {
      expect(f.unlock.records).toHaveBeenCalled()
    })
    f.management.noteLocked(2)
    held.resolve(undefined)
    await expect(recovering).rejects.toMatchObject({ reason: 'locked' })
    expect(offer).not.toHaveBeenCalled()
    code.fill(0)
  })

  it('P2: a Lock between the two reset steps withdraws the challenge', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    f.files.data.delete('slots.v1')
    f.files.data.delete('vault.v1')
    const challenge = await f.management.resetBegin()
    f.management.noteLocked(2)
    await expect(
      f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD),
    ).rejects.toMatchObject({ reason: 'invalid' })
    expect(f.files.data.has('reset.v1')).toBe(false)
    code.fill(0)
  })

  it('P2: a Lock during an import commits nothing', async () => {
    const home = await tempHome()
    const file = path.join(home, '.netrc')
    await writeFile(
      file,
      `machine example.test login generated password ${randomBytes(8).toString('hex')}\n`,
      { mode: 0o600 },
    )
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    await f.broker.unlock(null)
    const { held, state } = holdFileWrite(f.files, 'pending.v1')
    const importing = f.management.importFile(file, () => true)
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    // The management side's Lock alone: its generation refuses the commit.
    f.management.noteLocked(2)
    held.resolve(undefined)
    await expect(importing).rejects.toMatchObject({ reason: expect.any(String) })
    f.files.hold = null
    expect(await f.repository.current().list()).toEqual([])
    code.fill(0)
  })

  it('P3: a headless open cancelled during registration returns no session and closes', async () => {
    const controller = new AbortController()
    const registered = Promise.withResolvers<{ kind: 'ok' }>()
    const close = vi.fn()
    const client: VaultBrokerConnection = {
      send: () => registered.promise,
      close,
      watch: () => Promise.resolve(),
      closed: () => Promise.resolve(),
    }
    const opening = openHeadlessVault(
      () => Promise.resolve(client),
      {
        cwd: '/workspace',
        sessionId: 'session-1',
        signal: controller.signal,
        source: 'headless',
        unattended: true,
        onDenied: vi.fn(),
      },
      'c'.repeat(32),
      4242,
    )
    await Promise.resolve()
    controller.abort()
    registered.resolve({ kind: 'ok' })
    await expect(opening).rejects.toThrow()
    expect(close).toHaveBeenCalled()
  })
})
