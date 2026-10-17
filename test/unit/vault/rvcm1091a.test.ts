// RVCM1091A regressions (2 P1, 7 P2). Each case fails without its fix; the
// drills in docs/certification/m109-rvcm1091a-drills.json prove it. Material
// is generated; no credential, broker or network is used.

import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import type { VaultItem } from '../../../src/shared/vault'
import { VaultStore } from '../../../src/core/vault/store'
import {
  VaultManageSession,
  type VaultBrokerConnection,
} from '../../../src/core/vault/broker/manageClient'
import { isVaultPipeServerTrusted } from '../../../src/core/vault/broker/windowsPipe'
import { VaultPanelHost, type VaultPanelService } from '../../../src/host/vault/vaultPanelHost'
import { vaultPanelService } from '../../../src/host/vault/vaultPanelService'
import { runVaultCommand } from '../../../src/runtime/vault/vaultCommand'
import { vaultCommandPort } from '../../../src/runtime/vault/vaultRuntimeEntry'
import { grant, metadata } from '../helpers/vault/fixtures'
import { commandHarness } from '../helpers/vault/runtime'
import { MemoryVaultFiles, freshVault, heldWriteVault } from './storeFixtures'
import { heldConfirmation, managementFixture as composed, stateOf } from './managementFixture'

const item = (): VaultItem => ({
  metadata: metadata(),
  material: { kind: 'secret', value: randomBytes(24) },
})

async function created(f: ReturnType<typeof composed>): Promise<Buffer> {
  const shown = await f.management.setup()
  await f.management.confirmSetup(shown.setupId)
  return shown.code
}

describe('RVCM1091A', () => {
  it('F1: setup expiry during a held confirmation never zeroes the key it wraps', async () => {
    const release = Promise.withResolvers<undefined>()
    const f = composed(release.promise)
    const shown = await f.management.setup()
    // The confirmation owns the setup and is waiting inside the OS-store wrap.
    const { confirming } = await heldConfirmation(f, shown.setupId)
    f.clock.advance(VAULT_APPROVAL_TTL_MS)
    expect(await stateOf(f.management)).toBe('setupPending')
    release.resolve(undefined)
    await confirming
    expect(f.wrapped).toHaveLength(1)
    expect(f.wrapped[0]?.some((byte) => byte !== 0)).toBe(true)
    // The recovery slot (wrapped at setup) opens the same vault: one key throughout.
    f.broker.lock()
    await f.management.recover(shown.code)
    expect(await stateOf(f.management)).toBe('unlocked')
    shown.code.fill(0)
  })

  it('F2: a grant retired while its write waited is neither published nor recovered', async () => {
    const { vault, files, held, state } = await heldWriteVault('pending.v1', item())
    let isRetired = false
    const saving = vault.store.saveGrant(grant(), () => {
      if (isRetired) throw new Error('generated retirement')
    })
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    isRetired = true
    held.resolve(undefined)
    await expect(saving).rejects.toThrow()
    files.hold = null
    const reopened = await VaultStore.open(vault.options, vault.vaultId)
    expect(await reopened.grants()).toEqual([])
  })

  it('F2 class: a store locked while any write waited commits nothing', async () => {
    const vault = await freshVault()
    const files = vault.files
    if (!(files instanceof MemoryVaultFiles)) throw new Error('memory files expected')
    const held = Promise.withResolvers<undefined>()
    let isHeld = false
    files.hold = (name) => {
      if (name !== 'pending.v1') return Promise.resolve()
      isHeld = true
      return held.promise
    }
    const writing = vault.store.write(item())
    await vi.waitFor(() => {
      expect(isHeld).toBe(true)
    })
    vault.store.lock()
    held.resolve(undefined)
    await expect(writing).rejects.toThrow()
    files.hold = null
    const reopened = await VaultStore.open(vault.options, vault.vaultId)
    expect(await reopened.list()).toEqual([])
  })

  it('F3: saving a grant is not a revocation; removing it is', async () => {
    const f = composed()
    await created(f)
    await f.management.add(item())
    const revocations: unknown[] = []
    const views = vi.fn()
    f.repository.subscribe((change) => {
      revocations.push(change)
    })
    f.repository.subscribeCommitted(views)
    await f.repository.saveGrant(grant(), () => undefined)
    expect(revocations).toEqual([])
    expect(views).toHaveBeenCalledOnce()
    await f.repository.removeGrant(grant().id)
    expect(revocations).toEqual([{ kind: 'grant', id: grant().id }])
  })

  it("F4: a watched panel's own setup does not retire its I Saved It", async () => {
    const f = composed()
    const service: VaultPanelService = {
      snapshot: async () => {
        const snapshot = await f.management.snapshot()
        return {
          status: snapshot.status,
          items: snapshot.items,
          grants: snapshot.grants,
          audit: [],
          pending: snapshot.pending,
          ambientFiles: [],
        }
      },
      subscribe: (changed) => f.management.subscribe(changed),
      unlock: () => Promise.reject(new Error('unused')),
      lock: () => Promise.resolve(),
      write: () => Promise.reject(new Error('unused')),
      updateMetadata: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      grant: () => Promise.reject(new Error('unused')),
      revoke: () => Promise.resolve(),
      answer: () => Promise.resolve(),
      importFile: () => Promise.reject(new Error('unused')),
      keepImport: () => Promise.resolve(),
      deleteImport: () => Promise.resolve(),
      resetBegin: () => Promise.reject(new Error('unused')),
      resetConfirm: () => Promise.resolve(),
      setup: () => f.management.setup(),
      confirmSetup: async (setupId, authorize) => {
        authorize()
        await f.management.confirmSetup(setupId)
      },
      cancelSetup: (setupId) => f.management.cancelSetup(setupId),
    }
    const showError = vi.fn()
    const publish = vi.fn()
    const status = vi.fn()
    const host = new VaultPanelHost({
      service,
      now: () => f.clock.now(),
      editItem: () => Promise.resolve(null),
      confirmRemove: () => Promise.resolve(false),
      copyPublicKey: () => Promise.resolve(),
      publish,
      status,
      showError,
      showRecoveryCode: () => Promise.resolve(true),
      importDone: () => Promise.resolve('keep'),
      confirmReset: () => Promise.resolve(null),
    })
    await host.handle({ type: 'vaultSetup' })
    // The setup really succeeded: the section converges on the unlocked
    // snapshot with no error — not just files on disk (RVCM1091E: the
    // confirmation's mid-flight broadcast used to race broker.unlock for
    // the writer, fail the setup, and stay silent). Quiescence first: the
    // test's own reads would otherwise steal the writer from the refresh.
    await vi.waitFor(() => {
      const last = publish.mock.calls.at(-1)?.[0] as
        { state: { status: { state: string } } } | undefined
      expect(last?.state.status.state).toBe('unlocked')
    })
    expect(await stateOf(f.management)).toBe('unlocked')
    expect(await VaultStore.exists(f.files)).toBe(true)
    expect(status).toHaveBeenLastCalledWith(true)
    expect(showError).not.toHaveBeenCalled()
    host.dispose()
  })

  it('F5: a panel retired while its connection was pending sends nothing', async () => {
    const opened = Promise.withResolvers<VaultBrokerConnection>()
    const send = vi.fn(() => Promise.resolve({ kind: 'ok' as const }))
    const service = vaultPanelService(new VaultManageSession(() => opened.promise), {
      ambientFiles: () => Promise.resolve([]),
    })
    let isRetired = false
    const granting = service.grant(grant(), () => {
      if (isRetired) throw new Error('generated retirement')
    })
    isRetired = true
    opened.resolve({
      send,
      close: vi.fn(),
      watch: () => Promise.resolve(),
      closed: () => Promise.resolve(),
    })
    await expect(granting).rejects.toThrow('generated retirement')
    expect(send).not.toHaveBeenCalled()
  })

  it('F6: a metadata edit never resurrects an item removed between transactions', async () => {
    const f = composed()
    await created(f)
    const added = item()
    const id = added.metadata.id
    await f.management.add(added)
    const original = f.files.withWriter.bind(f.files)
    let isArmed = true
    f.files.withWriter = async <T>(
      operation: (assertHeld: () => void) => Promise<T>,
    ): Promise<T> => {
      const result = await original(operation)
      if (isArmed) {
        isArmed = false
        // Another connection removes the item right after the first transaction.
        await f.repository.current().remove(id)
      }
      return result
    }
    await f.management.editMetadata({ ...metadata(), label: 'Generated renamed item' })
    expect(await f.repository.current().list()).toEqual([])
  })

  it('F7: a watch that cannot connect fails `vault watch` instead of exiting 0', async () => {
    const session = new VaultManageSession(() =>
      Promise.reject(new Error('generated connection failure')),
    )
    const h = commandHarness()
    const deps = { ...h.deps, open: () => Promise.resolve(vaultCommandPort(session)) }
    expect(await runVaultCommand({ command: 'watch' }, deps)).toBe(1)
    const failed = vi.fn()
    const unsubscribe = vaultPanelService(session, {
      ambientFiles: () => Promise.resolve([]),
    }).subscribe(vi.fn(), failed)
    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledOnce()
    })
    unsubscribe()
  })

  it('F8: cancelling while the watch connection is pending closes the late connection', async () => {
    const opened = Promise.withResolvers<VaultBrokerConnection>()
    const close = vi.fn()
    const controller = new AbortController()
    const watching = new VaultManageSession(() => opened.promise).watch(vi.fn(), controller.signal)
    controller.abort()
    opened.resolve({
      send: () => Promise.resolve({ kind: 'ok' }),
      close,
      watch: () => Promise.resolve(),
      // A live stream: it would never end on its own.
      closed: () => new Promise(() => undefined),
    })
    const finished = (async () => {
      await watching
      return 'finished'
    })()
    const hung = new Promise((resolve) => {
      setTimeout(() => {
        resolve('hung')
      }, 500)
    })
    const outcome = await Promise.race([finished, hung])
    expect(outcome).toBe('finished')
    expect(close).toHaveBeenCalled()
  })

  it("F9: the host trusts a Windows pipe only when its server is the user's broker from the lock", () => {
    const owner = 'S-1-5-21-1000-2000-3000-1001'
    const lock = { processId: 4242, startedAt: 1_700_000_000_000 }
    const answer = (userId: string, overrides: object = {}) => ({
      v: 1,
      id: 1,
      result: 'ok',
      ownerSid: owner,
      server: {
        v: 1,
        processId: lock.processId,
        userId,
        startedAt: lock.startedAt,
        executable: String.raw`C:\Program Files\nodejs\node.exe`,
        remote: false,
        ownerOnlyDacl: true,
        ...overrides,
      },
    })
    expect(isVaultPipeServerTrusted(answer(owner), lock)).toBe(true)
    expect(isVaultPipeServerTrusted(answer('S-1-5-21-1000-2000-3000-1002'), lock)).toBe(false)
    expect(isVaultPipeServerTrusted(answer(owner, { processId: 4243 }), lock)).toBe(false)
    expect(isVaultPipeServerTrusted(answer(owner, { startedAt: 1 }), lock)).toBe(false)
    expect(isVaultPipeServerTrusted(answer(owner, { remote: true }), lock)).toBe(false)
    expect(isVaultPipeServerTrusted({ ...answer(owner), result: 'refused' }, lock)).toBe(false)
  })
})
