// RVCM1091E CLASS 1: after ANY failed operation the panel host never keeps
// an optimistic or stale view. Every operation settles through the one
// failure path: a fresh snapshot is published first (a change that arrived
// while the operation was failing is applied, not dropped), or the explicit
// unavailable state with no item labels when no snapshot can be had. The
// message names what actually failed — never an unlock for a vault shown
// unlocked, never a "Locked" report for a superseded refresh, never
// snapshot-connection text. Table: each operation crossed with each failure
// (the operation fails, the follow-up snapshot fails, a change lands in
// between).
import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { VaultPanelHost, type VaultPanelService } from '../../../src/host/vault/vaultPanelHost'
import type { VaultItemMetadata } from '../../../src/shared/vault'
import type { VaultPanelState } from '../../../src/shared/vaultPanel'
import { UI_TEXT } from '../../../src/shared/constants'
import { approval, grant, item, metadata, panel } from '../helpers/vault/fixtures'
import { generatedImport, generatedSetup } from '../helpers/vault/runtime'

interface Harness {
  host: VaultPanelHost
  deps: {
    service: { [K in keyof VaultPanelService]: Mock }
    publish: Mock
    status: Mock
    showError: Mock
    importDone: Mock
    editItem: Mock
    confirmRemove: Mock
    confirmReset: Mock
    showRecoveryCode: Mock
  }
  service: VaultPanelService
  state: VaultPanelState
  changed: { callback: (event: unknown) => void }
  failed: { callback: () => void }
}

function harness(): Harness {
  const state = panel()
  const changed: Harness['changed'] = { callback: () => undefined }
  const failed: Harness['failed'] = { callback: () => undefined }
  const service = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(state))),
    subscribe: vi.fn((callback: (event: unknown) => void, onFailed: () => void) => {
      changed.callback = callback
      failed.callback = onFailed
      return vi.fn()
    }),
    unlock: vi.fn((authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    lock: vi.fn(() => {
      state.status.state = 'locked'
      state.status.lockEpoch += 1
      state.pending = []
      return Promise.resolve()
    }),
    write: vi.fn((_item: unknown, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    updateMetadata: vi.fn((_item: unknown, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    remove: vi.fn((_id: unknown, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    grant: vi.fn((_grant: unknown, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    revoke: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    importFile: vi.fn((_path: unknown, authorize: () => void) => {
      authorize()
      return generatedImport()
    }),
    keepImport: vi.fn(() => Promise.resolve()),
    deleteImport: vi.fn(() => Promise.resolve()),
    resetBegin: vi.fn(() => Promise.resolve({ resetId: 'b'.repeat(32), word: 'RESET' })),
    resetConfirm: vi.fn((_id: unknown, _word: unknown, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    setup: vi.fn(generatedSetup),
    confirmSetup: vi.fn(() => Promise.resolve()),
    cancelSetup: vi.fn(() => Promise.resolve()),
  }
  const deps = {
    service,
    showRecoveryCode: vi.fn(() => Promise.resolve(true)),
    importDone: vi.fn(() => Promise.resolve('keep' as const)),
    confirmReset: vi.fn(() => Promise.resolve('RESET')),
    now: () => 1000,
    editItem: vi.fn(() => Promise.resolve(null)),
    confirmRemove: vi.fn(() => Promise.resolve(true)),
    copyPublicKey: vi.fn(() => Promise.resolve()),
    publish: vi.fn(),
    status: vi.fn(),
    showError: vi.fn(),
  }
  const host = new VaultPanelHost(deps)
  return { host, deps, service, state, changed, failed }
}

function lastState(f: Harness): VaultPanelState {
  const calls = f.deps.publish.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return (calls.at(-1)?.[0] as { state: VaultPanelState }).state
}

function lastError(f: Harness): string {
  const calls = f.deps.showError.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls.at(-1)?.[0] as string
}

function publishedText(f: Harness): string {
  return JSON.stringify(f.deps.publish.mock.calls.at(-1)?.[0] ?? {})
}

interface Operation {
  readonly name: string
  /** Loads before the operation's own service call (0 for lock/unlock/revoke). */
  readonly preLoads: 0 | 1
  readonly freshState: 'unlocked' | 'uncreated' | 'unavailable'
  readonly arrange: (f: Harness) => void
  readonly drive: (f: Harness) => Promise<void>
  /** The service mock the drive waits on before the test injects the failure. */
  readonly started: (f: Harness) => Mock
  readonly fail: (f: Harness) => void
}

function deferred(): { promise: Promise<never>; reject: (error: unknown) => void } {
  const held = Promise.withResolvers<never>()
  return { promise: held.promise, reject: held.reject }
}

const OPERATIONS: readonly Operation[] = [
  {
    name: 'lock',
    preLoads: 0,
    freshState: 'unlocked',
    arrange: () => undefined,
    drive: (f) => f.host.lock(),
    started: (f) => f.deps.service.lock,
    fail: (f) => f.deps.service.lock.mockRejectedValueOnce(new Error('boom-lock')),
  },
  {
    name: 'unlock',
    preLoads: 0,
    freshState: 'unlocked',
    arrange: () => undefined,
    drive: (f) => f.host.handle({ type: 'vaultUnlock' }),
    started: (f) => f.deps.service.unlock,
    fail: (f) => f.deps.service.unlock.mockRejectedValueOnce(new Error('boom-unlock')),
  },
  {
    name: 'add',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: (f) => {
      f.deps.editItem.mockResolvedValue(item())
    },
    drive: (f) => f.host.handle({ type: 'vaultAdd' }),
    started: (f) => f.deps.service.write,
    fail: (f) => f.deps.service.write.mockRejectedValueOnce(new Error('boom-add')),
  },
  {
    name: 'edit',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: (f) => {
      f.deps.editItem.mockResolvedValue(item())
    },
    drive: (f) => f.host.handle({ type: 'vaultEdit', itemId: metadata().id }),
    started: (f) => f.deps.service.write,
    fail: (f) => f.deps.service.write.mockRejectedValueOnce(new Error('boom-edit')),
  },
  {
    name: 'remove',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: () => undefined,
    drive: (f) => f.host.handle({ type: 'vaultRemove', itemId: metadata().id }),
    started: (f) => f.deps.service.remove,
    fail: (f) => f.deps.service.remove.mockRejectedValueOnce(new Error('boom-remove')),
  },
  {
    name: 'grant',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: () => undefined,
    drive: (f) => f.host.handle({ type: 'vaultGrant', grant: grant() }),
    started: (f) => f.deps.service.grant,
    fail: (f) => f.deps.service.grant.mockRejectedValueOnce(new Error('boom-grant')),
  },
  {
    name: 'revoke',
    preLoads: 0,
    freshState: 'unlocked',
    arrange: () => undefined,
    drive: (f) => f.host.handle({ type: 'vaultRevoke', grantId: grant().id }),
    started: (f) => f.deps.service.revoke,
    fail: (f) => f.deps.service.revoke.mockRejectedValueOnce(new Error('boom-revoke')),
  },
  {
    name: 'answer',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: (f) => {
      f.state.pending = [approval()]
    },
    drive: (f) => {
      const request = approval()
      return f.host.handle({
        type: 'vaultAnswer',
        answer: { requestId: request.id, digest: request.digest, decision: 'allowOnce' },
      })
    },
    started: (f) => f.deps.service.answer,
    fail: (f) => f.deps.service.answer.mockRejectedValueOnce(new Error('boom-answer')),
  },
  {
    name: 'importKeep',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: (f) => {
      f.state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
    },
    drive: (f) => f.host.handle({ type: 'vaultImport', path: '/home/user/.netrc' }),
    started: (f) => f.deps.service.importFile,
    fail: (f) => f.deps.service.importFile.mockRejectedValueOnce(new Error('boom-import')),
  },
  {
    name: 'importDelete',
    preLoads: 1,
    freshState: 'unlocked',
    arrange: (f) => {
      f.state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
      f.deps.importDone.mockResolvedValue('delete')
    },
    drive: (f) => f.host.handle({ type: 'vaultImport', path: '/home/user/.netrc' }),
    started: (f) => f.deps.service.deleteImport,
    fail: (f) => f.deps.service.deleteImport.mockRejectedValueOnce(new Error('boom-delete')),
  },
  {
    name: 'reset',
    preLoads: 1,
    freshState: 'unavailable',
    arrange: (f) => {
      f.state.status.state = 'unavailable'
      f.state.status.reason = 'vaultLost'
      f.state.items = []
    },
    drive: (f) => f.host.handle({ type: 'vaultReset' }),
    started: (f) => f.deps.service.resetConfirm,
    fail: (f) => f.deps.service.resetConfirm.mockRejectedValueOnce(new Error('boom-reset')),
  },
  {
    name: 'setup',
    preLoads: 1,
    freshState: 'uncreated',
    arrange: (f) => {
      f.state.status.state = 'uncreated'
      f.state.items = []
    },
    drive: (f) => f.host.handle({ type: 'vaultSetup' }),
    started: (f) => f.deps.service.setup,
    fail: (f) => f.deps.service.setup.mockRejectedValueOnce(new Error('boom-setup')),
  },
]

describe('RVCM1091E CLASS 1: every failed operation settles on a fresh view', () => {
  it.each(OPERATIONS.map((operation) => [operation.name] as [string]))(
    'the failed %s republishes the fresh snapshot and names the failure',
    async (name) => {
      const operation = OPERATIONS.find((entry) => entry.name === name)!
      const f = harness()
      operation.arrange(f)
      operation.fail(f)
      await operation.drive(f)
      // The fresh snapshot is on screen: the real state, not an optimistic
      // or stale one, with the vault's own items.
      expect(lastState(f).status.state).toBe(operation.freshState)
      if (operation.freshState === 'unlocked') {
        expect(lastState(f).items).toHaveLength(1)
        expect(f.deps.status).toHaveBeenLastCalledWith(true)
      } else {
        expect(f.deps.status).toHaveBeenLastCalledWith(false)
      }
      // The message names the failure generically: never native text, never
      // an unlock for a vault shown unlocked, never a stale Locked report.
      expect(lastError(f)).toBe(UI_TEXT.vault.operationFailed)
      expect(UI_TEXT.vault.operationFailed.toLowerCase()).not.toContain('unlock')
      for (const call of f.deps.showError.mock.calls)
        expect(call[0] as string).not.toBe(UI_TEXT.vault.locked)
      f.host.dispose()
    },
  )

  it.each(OPERATIONS.map((operation) => [operation.name] as [string]))(
    'the failed %s with no snapshot available says Unavailable with no item labels',
    async (name) => {
      const operation = OPERATIONS.find((entry) => entry.name === name)!
      const f = harness()
      operation.arrange(f)
      operation.fail(f)
      let loads = 0
      const live = f.state
      f.deps.service.snapshot.mockImplementation(() => {
        loads += 1
        return loads <= operation.preLoads
          ? Promise.resolve(structuredClone(live))
          : Promise.reject(new Error('snapshot down'))
      })
      await operation.drive(f)
      // The explicit unavailable state: no items, grants or pending cards,
      // and no item label anywhere in the published frame.
      const state = lastState(f)
      expect(state.status.state).toBe('unavailable')
      expect(state.items).toEqual([])
      expect(state.grants).toEqual([])
      expect(state.pending).toEqual([])
      expect(publishedText(f)).not.toContain('test-secret')
      expect(publishedText(f)).not.toContain('Generated test item')
      for (const call of f.deps.showError.mock.calls)
        expect(call[0] as string).not.toContain('snapshot down')
      expect(f.deps.status).toHaveBeenLastCalledWith(false)
      // The original failure is still reported, not the snapshot error.
      expect(lastError(f)).toBe(UI_TEXT.vault.operationFailed)
      f.host.dispose()
    },
  )

  it('a change during a lock whose snapshot is down settles once, on the lock', async () => {
    const f = harness()
    f.deps.service.snapshot.mockRejectedValue(new Error('snapshot down'))
    const pending = deferred()
    f.deps.service.lock.mockImplementationOnce(() => pending.promise as never)
    const locking = f.host.lock()
    await vi.waitFor(() => {
      expect(f.deps.service.lock).toHaveBeenCalled()
    })
    // A watch reconnect lands while the lock is failing. The lock owns the
    // next publish — no mid-lock refresh runs — so the lock's own settle is
    // the one publish (Unavailable, no item labels) and the one report.
    // The timer yields after drained microtasks, so the superseded refresh
    // (if one ran) would settle while the lock is still in flight.
    f.changed.callback({ kind: 'changed' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    pending.reject(new Error('boom-lock'))
    await locking
    // Drain stragglers: a superseded refresh that still ran would publish
    // and report here, before disposal can mask it.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(f.deps.publish).toHaveBeenCalledTimes(1)
    const state = lastState(f)
    expect(state.status.state).toBe('unavailable')
    expect(state.items).toEqual([])
    expect(publishedText(f)).not.toContain('test-secret')
    expect(f.deps.showError).toHaveBeenCalledTimes(1)
    expect(lastError(f)).toBe(UI_TEXT.vault.operationFailed)
    for (const call of f.deps.showError.mock.calls)
      expect(call[0] as string).not.toContain('snapshot down')
    f.host.dispose()
  })

  it('a watch outage during a lock stays silent until the lock settles', async () => {
    const f = harness()
    f.deps.service.snapshot.mockRejectedValue(new Error('snapshot down'))
    const pending = deferred()
    f.deps.service.lock.mockImplementationOnce(() => pending.promise as never)
    const locking = f.host.lock()
    await vi.waitFor(() => {
      expect(f.deps.service.lock).toHaveBeenCalled()
    })
    // The outage settles while the lock is still in flight (the timer
    // yields after drained microtasks): the lock owns the view, so the
    // outage reports nothing and the lock's own settle is the one publish
    // and the one report.
    f.failed.callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    pending.reject(new Error('boom-lock'))
    await locking
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(f.deps.publish).toHaveBeenCalledTimes(1)
    expect(lastState(f).status.state).toBe('unavailable')
    expect(f.deps.showError).toHaveBeenCalledTimes(1)
    expect(lastError(f)).toBe(UI_TEXT.vault.operationFailed)
    f.host.dispose()
  })

  it.each(OPERATIONS.map((operation) => [operation.name] as [string]))(
    'a change that lands while %s is failing is applied and the real failure is reported',
    async (name) => {
      const operation = OPERATIONS.find((entry) => entry.name === name)!
      const f = harness()
      operation.arrange(f)
      const pending = deferred()
      const target = operation.started(f)
      // Hold the operation open without side effects: the failure lands only
      // after the change below, so the interleaving is deterministic.
      target.mockImplementationOnce(() => pending.promise as never)
      const driving = operation.drive(f)
      await vi.waitFor(() => {
        expect(target).toHaveBeenCalled()
      })
      // Another window's change lands while the operation is failing.
      const arrived: VaultItemMetadata = {
        ...metadata(),
        id: 'e'.repeat(32),
        name: 'changed-in-between',
        handle: 'secret://changed-in-between',
        label: 'Changed in between',
      }
      if (operation.name === 'setup' || operation.name === 'reset') {
        // The vault's state itself moved on (set up, or whole again).
        f.state.status.state = 'locked'
        f.state.status.reason = operation.name === 'setup' ? null : f.state.status.reason
      } else {
        f.state.items = [...f.state.items, arrived]
      }
      f.changed.callback({ kind: 'changed' })
      pending.reject(new Error(`boom-${operation.name}`))
      await driving
      target.mockReset()
      if (operation.name === 'setup' || operation.name === 'reset') {
        expect(lastState(f).status.state).toBe('locked')
      } else {
        expect(lastState(f).items.map((entry) => entry.id)).toContain('e'.repeat(32))
      }
      // Exactly one report, and it is the real failure — never "Locked".
      expect(f.deps.showError).toHaveBeenCalledTimes(1)
      expect(lastError(f)).toBe(UI_TEXT.vault.operationFailed)
      f.host.dispose()
    },
  )
})
