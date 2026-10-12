// Generated-only regressions for RVCM1091A3's Lock and Reset findings.
import { describe, expect, it, vi } from 'vitest'
import { VAULT_RESET_WORD } from '../../../src/shared/constants'
import { VaultStore } from '../../../src/core/vault/store'
import { lockedVault, managementFixture } from './managementFixture'
import { item } from '../helpers/vault/fixtures'

async function damagedVault() {
  const f = managementFixture()
  const code = await lockedVault(f)
  code.fill(0)
  f.files.data.set('slots.v1', Buffer.from('generated damage'))
  const challenge = await f.management.resetBegin()
  return { f, challenge }
}

/** Attach the rejection handler immediately while other requests wait on a held await. */
async function resultOf(work: Promise<unknown>): Promise<unknown> {
  try {
    return await work
  } catch (error: unknown) {
    return error
  }
}

async function assertLostReset(f: ReturnType<typeof managementFixture>): Promise<void> {
  const snapshot = await f.management.snapshot()
  expect(snapshot.status.reason).toBe('vaultLost')
  const challenge = await f.management.resetBegin()
  await f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
  expect(await f.anchor.vaultId()).toBeNull()
  expect(f.files.data.has('vault.v1')).toBe(false)
}

function holdAnchorReset(
  f: ReturnType<typeof managementFixture>,
  hold: Promise<undefined>,
  entered: { resolve(value: undefined): void },
): void {
  const reset = f.anchor.reset.bind(f.anchor)
  vi.spyOn(f.anchor, 'reset').mockImplementationOnce(async (...args) => {
    entered.resolve(undefined)
    await hold
    await reset(...args)
  })
}

describe('RVCM1091A3 Lock and Reset', () => {
  it('F1: recovery and setup queued before Lock cannot inherit its generation', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const getStatus = f.broker.status.bind(f.broker)
    f.broker.status.mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await held.promise
      return await getStatus()
    })
    const first = resultOf(f.management.recover(code))
    await entered.promise
    const second = resultOf(f.management.recover(code))
    const setup = resultOf(f.management.setup())
    f.management.noteLocked(2)
    held.resolve(undefined)
    const results = await Promise.all([first, second, setup])
    for (const result of results) expect(result).toMatchObject({ reason: 'locked' })
    const status = await f.broker.status()
    expect(status.state).toBe('locked')
    code.fill(0)
  })

  it.each(['vault.v1', 'slots.v1', 'pending.v1'] as const)(
    'F3: damage to %s offers Reset consistently with the writer recheck',
    async (name) => {
      const f = managementFixture()
      const code = await lockedVault(f)
      code.fill(0)
      f.files.data.set(name, Buffer.from('generated damage'))
      await assertLostReset(f)
    },
  )

  it('F3: a missing document with intact slots offers Reset', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    f.files.data.delete('vault.v1')
    await assertLostReset(f)
  })

  it('F3: a complete pending transaction protects a damaged document from Reset', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    f.files.fail = 'vault.v1'
    await expect(f.repository.current().write(item())).rejects.toThrow()
    f.files.fail = null
    f.broker.lock()
    f.files.data.set('vault.v1', Buffer.from('generated damage'))
    const snapshot = await f.management.snapshot()
    expect(snapshot.status.reason).not.toBe('vaultLost')
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
  })

  it('F4: Reset refuses an unlocked repository even when files are lost', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    const slots = f.files.data.get('slots.v1')
    if (slots === undefined) throw new Error('missing generated slots')
    f.files.data.delete('slots.v1')
    const challenge = await f.management.resetBegin()
    f.files.data.set('slots.v1', slots)
    await f.broker.unlock(null)
    f.files.data.delete('slots.v1')
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    await expect(
      f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD),
    ).rejects.toMatchObject({ reason: 'invalid' })
    expect(f.files.data.has('vault.v1')).toBe(true)
    expect(await f.anchor.vaultId()).not.toBeNull()
    expect(() => {
      f.repository.current().assertOpen()
    }).not.toThrow()
  })

  it.each(['quarantine', 'remove', 'anchor'] as const)(
    'F5: Lock during the %s await stops further destruction and anchor retirement',
    async (boundary) => {
      const { f, challenge } = await damagedVault()
      const anchored = await f.anchor.vaultId()
      const held = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      if (boundary === 'anchor') {
        holdAnchorReset(f, held.promise, entered)
      } else {
        const delay = async () => {
          entered.resolve(undefined)
          await held.promise
        }
        if (boundary === 'quarantine') {
          const work = f.files.quarantine.bind(f.files)
          vi.spyOn(f.files, 'quarantine').mockImplementationOnce(async (...args) => {
            await delay()
            await work(...args)
          })
        } else {
          const work = f.files.remove.bind(f.files)
          vi.spyOn(f.files, 'remove').mockImplementationOnce(async (...args) => {
            await delay()
            await work(...args)
          })
        }
      }
      const resetting = resultOf(f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD))
      await entered.promise
      f.management.noteLocked(2)
      held.resolve(undefined)
      expect(await resetting).toMatchObject({ reason: 'locked' })
      expect(await f.anchor.vaultId()).toBe(anchored)
      if (boundary === 'anchor') return
      expect(f.files.data.has('vault.v1')).toBe(true)
      expect(f.files.data.has('slots.v1')).toBe(true)
    },
  )

  it('F6: anchor retirement holds the writer so a restore cannot race it', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    const snapshot = await f.repository.current().exportSnapshot()
    const [slot] = await f.unlock.records()
    if (slot === undefined) throw new Error('missing generated slot')
    const key = await f.osStore.unwrap(slot, 'generated restore')
    f.broker.lock()
    f.files.data.delete('slots.v1')
    const challenge = await f.management.resetBegin()
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    holdAnchorReset(f, held.promise, entered)
    const resetting = f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
    await entered.promise
    try {
      await expect(
        VaultStore.restore({ files: f.files, anchor: f.anchor, key }, snapshot, undefined, true),
      ).rejects.toMatchObject({ code: 'busy' })
    } finally {
      held.resolve(undefined)
      key.fill(0)
      await resetting
    }
    expect(await f.anchor.vaultId()).toBeNull()
  })

  it('F6: an anchor advanced before writer admission preserves every file', async () => {
    const { f, challenge } = await damagedVault()
    const vaultId = await f.anchor.vaultId()
    if (vaultId === null) throw new Error('missing generated vault')
    const prior = await f.anchor.minimum(vaultId)
    if (prior === null) throw new Error('missing generated anchor')
    const writer = f.files.withWriter.bind(f.files)
    vi.spyOn(f.files, 'withWriter').mockImplementationOnce(async (work) => {
      await f.anchor.advance(vaultId, { ...prior, generation: prior.generation + 1 }, prior)
      return await writer(work)
    })
    await expect(
      f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD),
    ).rejects.toMatchObject({ reason: 'invalid' })
    expect(f.files.data.has('reset.v1')).toBe(false)
    expect(f.files.data.has('vault.v1')).toBe(true)
    expect(f.files.data.has('slots.v1')).toBe(true)
  })
})
