// RVCM1091F host regressions: each P2/P3 scenario from the review drives the
// real VaultPanelHost (fakes only at the service boundary) and asserts the
// published frames and reports. Every test fails on the pre-redesign host:
// the lockRequested flag silenced these paths.
import { describe, expect, it, vi } from 'vitest'
import jaTable from '../../../l10n/ui.ja.json'
import koTable from '../../../l10n/ui.ko.json'
import cnTable from '../../../l10n/ui.zh-cn.json'
import twTable from '../../../l10n/ui.zh-tw.json'
import {
  VaultPanelHost,
  type VaultPanelHostDeps,
  type VaultPanelService,
} from '../../../src/host/vault/vaultPanelHost'
import { VaultChannelError } from '../../../src/core/vault/broker/client'
import type { VaultPanelState } from '../../../src/shared/vaultPanel'
import { vaultHostMessageSchema } from '../../../src/shared/hostApi/vaultMessages'
import { UI_TEXT } from '../../../src/shared/constants'
import { panel, item, metadata, approval } from '../helpers/vault/fixtures'
import { generatedImport } from '../helpers/vault/runtime'

function fixture() {
  const state = panel()
  const changed: { callback: (event: unknown) => void } = { callback: () => undefined }
  const failed: { callback: () => void } = { callback: () => undefined }
  const service = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(state))),
    subscribe: vi.fn((callback: (event: unknown) => void, onFailed: () => void) => {
      changed.callback = callback
      failed.callback = onFailed
      return vi.fn()
    }),
    unlock: vi.fn((_authorize: () => void) => Promise.resolve()),
    lock: vi.fn(() => {
      state.status.state = 'locked'
      state.status.lockEpoch += 1
      state.pending = []
      return Promise.resolve()
    }),
    write: vi.fn((_item: unknown, _authorize: () => void) => Promise.resolve()),
    updateMetadata: vi.fn((_item: unknown, _authorize: () => void) => Promise.resolve()),
    remove: vi.fn((_id: unknown, _authorize: () => void) => Promise.resolve()),
    grant: vi.fn((_grant: unknown, _authorize: () => void) => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    importFile: vi.fn<VaultPanelService['importFile']>((_path, _authorize) => generatedImport()),
    keepImport: vi.fn(() => Promise.resolve()),
    deleteImport: vi.fn(() => Promise.resolve()),
    resetBegin: vi.fn(() => Promise.resolve({ resetId: 'b'.repeat(32), word: 'RESET' })),
    resetConfirm: vi.fn((_id: unknown, _word: unknown, _authorize: () => void) =>
      Promise.resolve(),
    ),
    setup: vi.fn(() => Promise.reject(new Error('unused route'))),
    confirmSetup: vi.fn(() => Promise.resolve()),
    cancelSetup: vi.fn(() => Promise.resolve()),
  }
  const deps = {
    service,
    showRecoveryCode: vi.fn<VaultPanelHostDeps['showRecoveryCode']>(() => Promise.resolve(true)),
    importDone: vi.fn<VaultPanelHostDeps['importDone']>(() => Promise.resolve('keep' as const)),
    confirmReset: vi.fn<VaultPanelHostDeps['confirmReset']>(() => Promise.resolve('RESET')),
    now: () => 1000,
    editItem: vi.fn<VaultPanelHostDeps['editItem']>(() => Promise.resolve(null)),
    confirmRemove: vi.fn(() => Promise.resolve(true)),
    copyPublicKey: vi.fn(() => Promise.resolve()),
    publish: vi.fn(),
    status: vi.fn(),
    showError: vi.fn(),
  }
  const host = new VaultPanelHost(deps)
  return { host, deps, service, state, changed, failed }
}

function lastState(f: ReturnType<typeof fixture>): VaultPanelState {
  const calls = f.deps.publish.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return (calls.at(-1)?.[0] as { state: VaultPanelState }).state
}

function publishedText(f: ReturnType<typeof fixture>): string {
  return f.deps.publish.mock.calls.map((call) => JSON.stringify(call[0])).join('\n')
}

/** Published frames after `mark` (a publish count), as text. */
function publishedSince(f: ReturnType<typeof fixture>, mark: number): string {
  return f.deps.publish.mock.calls
    .slice(mark)
    .map((call) => JSON.stringify(call[0]))
    .join('\n')
}

/** True when a published host message carries a frame flagged as retrying. */
function isRetryingFrame(message: unknown): boolean {
  const parsed = vaultHostMessageSchema.safeParse(message)
  return parsed.success && parsed.data.state.retrying === true
}

// RVAPP-CM1091D5 P2-1: the person's own Lock or Revoke during an Import or a
// Delete aborts the in-flight call; the close reason the abort caused is
// silent (the barrier owns the view), never a failure toast. The abort
// rejects the way the real client now does (VaultChannelError('closed')),
// not with the hand-built locked sentence the stale test used before.
function abortableImport(f: ReturnType<typeof fixture>): void {
  f.deps.service.importFile.mockImplementationOnce(
    (_path: string, _authorize: () => void, signal: AbortSignal) => {
      const pending = Promise.withResolvers<never>()
      signal.addEventListener('abort', () => {
        pending.reject(new VaultChannelError('closed'))
      })
      return pending.promise
    },
  )
}
function abortableDelete(f: ReturnType<typeof fixture>): void {
  f.deps.service.deleteImport.mockImplementationOnce(
    (_receipt: string, _authorize: () => void, signal: AbortSignal) => {
      const pending = Promise.withResolvers<never>()
      signal.addEventListener('abort', () => {
        pending.reject(new VaultChannelError('closed'))
      })
      return pending.promise
    },
  )
}

describe('RVCM1091F P2 locked events reload and strip, later events recover', () => {
  it('a broker locked event reloads, strips labels and grants, and later events recover', async () => {
    const f = fixture()
    await f.host.refresh()
    expect(lastState(f).status.state).toBe('unlocked')
    const snapshots = f.service.snapshot.mock.calls.length
    // Idle auto-lock from another window: the broker event, not this window.
    // (A real locked snapshot carries no items, grants, audit or pending —
    // the fake mirrors that shape here.)
    f.state.status.state = 'locked'
    f.state.status.lockEpoch = 1
    f.state.items = []
    f.state.grants = []
    f.state.audit = []
    f.state.pending = []
    const mark = f.deps.publish.mock.calls.length
    f.changed.callback({ kind: 'locked', v: 2, lockEpoch: 1 })
    await vi.waitFor(() => {
      expect(f.service.snapshot.mock.calls.length).toBeGreaterThan(snapshots)
    })
    // Locked at once, with no item labels, grants, audit or pending cards.
    const locked = lastState(f)
    expect(locked.status.state).toBe('locked')
    expect(locked.items).toEqual([])
    expect(locked.grants).toEqual([])
    expect(locked.audit).toEqual([])
    expect(locked.pending).toEqual([])
    expect(publishedSince(f, mark)).not.toContain('Generated test item')
    // Unlocked elsewhere again: a change recovers this window.
    f.state.status.state = 'unlocked'
    f.state.status.lockEpoch = 1
    f.state.items = [metadata()]
    f.changed.callback({ kind: 'changed' })
    await vi.waitFor(() => {
      expect(lastState(f).status.state).toBe('unlocked')
    })
    expect(lastState(f).items).toHaveLength(1)
    // An approval card is never starved by the earlier lock.
    f.state.pending = [
      {
        id: 'a'.repeat(32),
        requester: {
          id: 'b'.repeat(32),
          hostId: 'c'.repeat(32),
          conversationId: 'conversation',
          taskId: null,
          role: { kind: 'orchestrator' },
          workspaceId: 'workspace',
          deviceId: null,
          peerProcessId: 100,
          sessionId: 'd'.repeat(32),
          unattended: false,
          source: 'conversation',
        },
        item: metadata(),
        use: {
          kind: 'environment',
          command: { executable: '/usr/bin/tool', argv: ['--check'], cwd: '/workspace' },
          names: ['SERVICE_TOKEN'],
        },
        digest: 'e'.repeat(64),
        nonce: 'f'.repeat(32),
        createdAt: 0,
        expiresAt: 120_000,
        lockEpoch: 1,
        taint: { tainted: false, reasons: [] },
      },
    ]
    f.changed.callback({
      kind: 'approval',
      v: 2,
      request: f.state.pending[0],
    })
    await vi.waitFor(() => {
      expect(lastState(f).pending).toHaveLength(1)
    })
    // Re-showing the tab reloads and reports nothing on success.
    const errors = f.deps.showError.mock.calls.length
    await f.host.handle({ type: 'vaultReady' })
    expect(lastState(f).status.state).toBe('unlocked')
    expect(f.deps.showError.mock.calls.length).toBe(errors)
    f.host.dispose()
  })
})

describe('RVCM1091F P2 every failure path publishes and reports', () => {
  it('a failed Unlock while the snapshot is down publishes and reports', async () => {
    const f = fixture()
    await f.host.refresh()
    f.state.status.state = 'locked'
    f.state.status.lockEpoch = 1
    f.changed.callback({ kind: 'locked', v: 2, lockEpoch: 1 })
    await vi.waitFor(() => {
      expect(lastState(f).status.state).toBe('locked')
    })
    f.deps.service.unlock.mockRejectedValueOnce(new Error('boom-unlock'))
    f.deps.service.snapshot.mockRejectedValueOnce(new Error('snapshot down'))
    const publishes = f.deps.publish.mock.calls.length
    await f.host.handle({ type: 'vaultUnlock' })
    expect(f.deps.publish.mock.calls.length).toBeGreaterThan(publishes)
    expect(f.deps.showError.mock.calls.length).toBeGreaterThan(0)
    for (const call of f.deps.showError.mock.calls)
      expect(call[0] as string).not.toContain('snapshot down')
    f.host.dispose()
  })

  it('a watch outage while locked publishes and reports', async () => {
    const f = fixture()
    await f.host.refresh()
    f.state.status.state = 'locked'
    f.state.status.lockEpoch = 1
    f.changed.callback({ kind: 'locked', v: 2, lockEpoch: 1 })
    await vi.waitFor(() => {
      expect(lastState(f).status.state).toBe('locked')
    })
    const publishes = f.deps.publish.mock.calls.length
    f.failed.callback()
    await vi.waitFor(() => {
      expect(f.deps.showError.mock.calls.length).toBeGreaterThan(0)
    })
    expect(f.deps.publish.mock.calls.length).toBeGreaterThan(publishes)
    f.host.dispose()
  })

  it('a Lock that succeeds while the snapshot is down shows Locked with no labels and a message', async () => {
    const f = fixture()
    await f.host.refresh()
    const mark = f.deps.publish.mock.calls.length
    f.deps.service.snapshot.mockRejectedValue(new Error('snapshot down'))
    await f.host.lock()
    // Locked, with no item labels or grants anywhere on screen, and the
    // failure is reported — never a silent stale view.
    const state = lastState(f)
    expect(state.status.state).toBe('locked')
    expect(state.items).toEqual([])
    expect(state.grants).toEqual([])
    expect(publishedSince(f, mark)).not.toContain('Generated test item')
    expect(f.deps.showError.mock.calls.length).toBeGreaterThan(0)
    // A later change is never ignored because of the earlier lock.
    f.deps.service.snapshot.mockImplementation(() => Promise.resolve(structuredClone(f.state)))
    f.state.status.state = 'unlocked'
    f.changed.callback({ kind: 'changed' })
    await vi.waitFor(() => {
      expect(lastState(f).status.state).toBe('unlocked')
    })
    f.host.dispose()
  })

  it('a Lock that fails while the snapshot is down says Unavailable, never Locked', async () => {
    const f = fixture()
    await f.host.refresh()
    f.deps.service.lock.mockRejectedValueOnce(new Error('boom-lock'))
    f.deps.service.snapshot.mockRejectedValue(new Error('snapshot down'))
    await f.host.lock()
    // The optimistic Locked is void — the lock may have failed — so the
    // true reason with no item names, never a Locked claim.
    const state = lastState(f)
    expect(state.status.state).toBe('unavailable')
    expect(state.items).toEqual([])
    expect(state.grants).toEqual([])
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.operationFailed)
    f.host.dispose()
  })
})

describe('RVCM1091F P2 transient failures keep, retry boundedly, then offer Retry', () => {
  it('a busy snapshot keeps the view, reports, retries, and recovers', async () => {
    const f = fixture()
    await f.host.refresh()
    f.deps.service.snapshot.mockRejectedValueOnce(new Error(UI_TEXT.vault.busy))
    const snapshots = f.service.snapshot.mock.calls.length
    await f.host.refresh()
    // Kept view with its labels, true sentence, no repair claim.
    expect(lastState(f).status.state).toBe('unlocked')
    expect(lastState(f).items).toHaveLength(1)
    expect(f.deps.showError).toHaveBeenLastCalledWith(UI_TEXT.vault.busy)
    expect(publishedText(f)).not.toContain(UI_TEXT.vault.brokerBlocked)
    // The bounded auto-retry runs and the recovered snapshot republishes.
    await vi.waitFor(() => {
      expect(f.service.snapshot.mock.calls.length).toBeGreaterThan(snapshots + 1)
    })
    expect(lastState(f).status.state).toBe('unlocked')
    f.host.dispose()
  })

  it('a lasting outage goes unavailable with its true reason, then Retry recovers', async () => {
    const f = fixture()
    await f.host.refresh()
    f.deps.service.snapshot.mockRejectedValue(new Error(UI_TEXT.vault.busy))
    await f.host.refresh()
    await vi.waitFor(
      () => {
        expect(lastState(f).status.state).toBe('unavailable')
      },
      { timeout: 5000 },
    )
    const state = lastState(f)
    expect(state.status.reason).toBe('busy')
    expect(state.items).toEqual([])
    expect(f.deps.showError).toHaveBeenLastCalledWith(UI_TEXT.vault.busy)
    expect(publishedText(f)).not.toContain(UI_TEXT.vault.brokerBlocked)
    // The person's own Retry restores the budget and reloads.
    f.deps.service.snapshot.mockImplementation(() => Promise.resolve(structuredClone(f.state)))
    await f.host.handle({ type: 'vaultRetry' })
    expect(lastState(f).status.state).toBe('unlocked')
    f.host.dispose()
  })
})

describe('RVCM1091F P2 generations: an older snapshot never overwrites a newer state', () => {
  it('two overlapping reloads settle on the newer snapshot', async () => {
    const f = fixture()
    const first = structuredClone(f.state)
    const second = structuredClone(f.state)
    second.items = []
    second.status.itemCount = 0
    let resolveFirst: ((value: VaultPanelState) => void) | undefined
    let resolveSecond: ((value: VaultPanelState) => void) | undefined
    f.deps.service.snapshot
      .mockImplementationOnce(
        () => new Promise<VaultPanelState>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<VaultPanelState>((resolve) => (resolveSecond = resolve)),
      )
      .mockImplementation(() => Promise.resolve(structuredClone(f.state)))
    const loading = f.host.refresh()
    // Let the older reload reach its snapshot before the change retires it.
    await vi.waitFor(() => {
      expect(resolveFirst).toBeDefined()
    })
    f.changed.callback({ kind: 'changed' })
    await vi.waitFor(() => {
      expect(resolveSecond).toBeDefined()
    })
    // The newer reload lands first, the older lands after: the older must
    // not overwrite it.
    resolveSecond!(structuredClone(second))
    await vi.waitFor(() => {
      expect(lastState(f).items).toEqual([])
    })
    resolveFirst!(structuredClone(first))
    await loading
    expect(lastState(f).items).toEqual([])
    expect(lastState(f).status.itemCount).toBe(0)
    f.host.dispose()
  })

  it('two approval reloads settle newest-wins in both landing orders', async () => {
    for (const isNewerFirst of [true, false]) {
      const f = fixture()
      await f.host.refresh()
      const one = structuredClone(f.state)
      // The older reply differs from the current view (two items, not one),
      // so dropping it as stale is observable in this order too: applying it
      // would show two. Without the guard this order cannot fail
      // (RVAPP-CM1091D5 P3-5).
      one.items = [metadata(), metadata()]
      one.status.itemCount = 2
      const two = structuredClone(f.state)
      two.items = []
      two.status.itemCount = 0
      let resolveOlder: ((value: VaultPanelState) => void) | undefined
      let resolveNewer: ((value: VaultPanelState) => void) | undefined
      let calls = 0
      f.deps.service.snapshot.mockImplementation(() => {
        calls += 1
        if (calls <= 2)
          return new Promise<VaultPanelState>((resolve) => {
            if (calls === 1) resolveOlder = resolve
            else resolveNewer = resolve
          })
        return Promise.resolve(structuredClone(f.state))
      })
      // Two approval cards under one generation: neither retires the other,
      // so the older reply must not overwrite the newer one (RVCM1091G P2).
      f.changed.callback({ kind: 'approval', v: 2, request: approval() })
      await vi.waitFor(() => {
        expect(resolveOlder).toBeDefined()
      })
      f.changed.callback({ kind: 'approval', v: 2, request: approval() })
      await vi.waitFor(() => {
        expect(resolveNewer).toBeDefined()
      })
      // Whichever reply lands first, the newest request wins once both
      // have landed.
      const firstResolve = isNewerFirst ? resolveNewer! : resolveOlder!
      const firstSnapshot = isNewerFirst ? two : one
      const secondResolve = isNewerFirst ? resolveOlder! : resolveNewer!
      const secondSnapshot = isNewerFirst ? one : two
      firstResolve(structuredClone(firstSnapshot))
      await vi.waitFor(() => {
        expect(lastState(f).items).toHaveLength(isNewerFirst ? 0 : 1)
      })
      secondResolve(structuredClone(secondSnapshot))
      await vi.waitFor(() => {
        expect(lastState(f).items).toEqual([])
      })
      expect(lastState(f).status.itemCount).toBe(0)
      f.host.dispose()
    }
  })
})

describe('RVCM1091G P3 channel failures never claim Locked, and a rejected Delete finishes', () => {
  it('a dead channel says the operation failed beside an unavailable section', async () => {
    for (const code of ['closed', 'writeFailed', 'invalidResponse'] as const) {
      const f = fixture()
      await f.host.refresh()
      expect(lastState(f).status.state).toBe('unlocked')
      f.deps.service.snapshot.mockRejectedValue(new VaultChannelError(code))
      await f.host.refresh()
      await vi.waitFor(() => {
        expect(lastState(f).status.state).toBe('unavailable')
      })
      // The section names no state it does not hold, and the toast never
      // claims Locked beside it.
      expect(lastState(f).status.reason).toBe('unreachable')
      expect(f.deps.showError).toHaveBeenLastCalledWith(UI_TEXT.vault.operationFailed)
      expect(f.deps.showError).not.toHaveBeenCalledWith(UI_TEXT.vault.locked)
      f.host.dispose()
    }
  })

  it('a Delete rejected as sourceGone finishes by clearing the leftover record', async () => {
    const f = fixture()
    await f.host.refresh()
    f.state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
    f.deps.importDone.mockResolvedValue('delete')
    f.deps.service.deleteImport.mockRejectedValueOnce(new Error(UI_TEXT.vault.sourceGone))
    await f.host.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
    // The receipt is finished, not dropped: Keep clears the record the
    // Delete could not, and the refusal still says the file is gone.
    expect(f.deps.service.keepImport).toHaveBeenCalledTimes(1)
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.sourceGone)
    f.host.dispose()
  })

  it('a kept view with a retry scheduled says it is retrying', async () => {
    const f = fixture()
    await f.host.refresh()
    f.deps.service.snapshot
      .mockRejectedValueOnce(new Error(UI_TEXT.vault.busy))
      .mockRejectedValueOnce(new Error(UI_TEXT.vault.busy))
    await f.host.refresh()
    // The kept unlocked frame carries the retry flag for the section while
    // the bounded auto-retry is scheduled; the recovered view clears it.
    await vi.waitFor(() => {
      expect(f.deps.publish.mock.calls.some((call) => isRetryingFrame(call[0]))).toBe(true)
    })
    await vi.waitFor(() => {
      const state = lastState(f)
      expect(state.status.state).toBe('unlocked')
      expect(state.retrying).not.toBe(true)
    })
    f.host.dispose()
  })
})

describe('RVCM1091F P2 two windows with overlapping snapshots', () => {
  it('an older snapshot landing late in the second window never overwrites its newer locked view', async () => {
    const f = fixture()
    const secondPublish = vi.fn()
    const secondError = vi.fn()
    const secondStatus = vi.fn()
    const second = new VaultPanelHost({
      ...f.deps,
      publish: secondPublish,
      showError: secondError,
      status: secondStatus,
    })
    const lastSecond = (): VaultPanelState => {
      const calls = secondPublish.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      return (calls.at(-1)?.[0] as { state: VaultPanelState }).state
    }
    await f.host.refresh()
    // The second window's reload hangs on its snapshot while the first
    // window locks: the broker bumps the epoch and broadcasts.
    let resolveOld: ((value: VaultPanelState) => void) | undefined
    let loads = 0
    f.deps.service.snapshot.mockImplementation(() => {
      loads += 1
      return loads === 1
        ? new Promise<VaultPanelState>((resolve) => (resolveOld = resolve))
        : Promise.resolve(structuredClone(f.state))
    })
    const reloading = second.refresh()
    await vi.waitFor(() => {
      expect(resolveOld).toBeDefined()
    })
    await f.host.lock()
    expect(lastState(f).status.state).toBe('locked')
    // A real locked snapshot carries no rows; the fake mirrors that shape.
    f.state.items = []
    f.state.grants = []
    f.state.audit = []
    // The broadcast reaches the second window: locked at once, stripped.
    f.changed.callback({ kind: 'locked', v: 2, lockEpoch: f.state.status.lockEpoch })
    await vi.waitFor(() => {
      expect(lastSecond().status.state).toBe('locked')
    })
    expect(lastSecond().items).toEqual([])
    // The older snapshot lands late: it must not resurrect the unlocked view.
    resolveOld!(structuredClone({ ...panel(), status: { ...panel().status, lockEpoch: 0 } }))
    await reloading
    expect(lastSecond().status.state).toBe('locked')
    expect(lastSecond().items).toEqual([])
    expect(JSON.stringify(lastSecond())).not.toContain('Generated test item')
    f.host.dispose()
    second.dispose()
  })
})

describe('RVCM1091F P3 failures kept, barrier aborts silent, sentences true', () => {
  it('a change during the settle reload keeps and shows the real failure', async () => {
    const f = fixture()
    await f.host.refresh()
    f.deps.editItem.mockResolvedValueOnce(item())
    f.deps.service.write.mockRejectedValueOnce(new Error(UI_TEXT.vault.itemConflict))
    // The operation's own load resolves; only the settle's reload hangs.
    let resolveLoad: ((value: VaultPanelState) => void) | undefined
    let loads = 0
    f.deps.service.snapshot.mockImplementation(() => {
      loads += 1
      const settled = loads === 2 ? null : structuredClone(f.state)
      return settled === null
        ? new Promise<VaultPanelState>((resolve) => (resolveLoad = resolve))
        : Promise.resolve(settled)
    })
    const adding = f.host.handle({ type: 'vaultAdd' })
    await vi.waitFor(() => {
      expect(resolveLoad).toBeDefined()
    })
    // Another window's change lands during the settle's reload: the refusal
    // is still reported, and the change is still applied.
    f.changed.callback({ kind: 'changed' })
    resolveLoad!(structuredClone(f.state))
    await adding
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.itemConflict)
    expect(lastState(f).status.state).toBe('unlocked')
    f.host.dispose()
  })

  it.each([
    { barrier: 'lock', operation: 'import' },
    { barrier: 'lock', operation: 'delete' },
    { barrier: 'revoke', operation: 'import' },
    { barrier: 'revoke', operation: 'delete' },
  ] as const)(
    'a personal $barrier during a $operation aborts it with no failure toast',
    async ({ barrier, operation }) => {
      const f = fixture()
      f.state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
      await f.host.refresh()
      if (operation === 'import') abortableImport(f)
      else abortableDelete(f)
      f.deps.importDone.mockResolvedValueOnce('delete' as const)
      const working = f.host.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
      await vi.waitFor(() => {
        expect(
          operation === 'import' ? f.deps.service.importFile : f.deps.service.deleteImport,
        ).toHaveBeenCalled()
      })
      // The person's own barrier aborts the in-flight call and owns the view.
      if (barrier === 'lock') await f.host.lock()
      else await f.host.handle({ type: 'vaultRevoke', grantId: 'a'.repeat(32) })
      await working
      // The barrier's own state is shown (Locked after Lock, Unlocked after
      // Revoke), with no failure toast beside it.
      expect(lastState(f).status.state).toBe(barrier === 'lock' ? 'locked' : 'unlocked')
      expect(f.deps.showError).not.toHaveBeenCalled()
      f.host.dispose()
    },
  )

  it('a Delete that lost its receipt keeps the true sentence', async () => {
    const f = fixture()
    f.state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
    await f.host.refresh()
    f.deps.service.deleteImport.mockRejectedValueOnce(new Error(UI_TEXT.vault.sourceGone))
    f.deps.importDone.mockResolvedValueOnce('delete' as const)
    await f.host.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.sourceGone)
    f.host.dispose()
  })
})

describe('RVAPP-CM1091D5 P2-2 kept receipts finish from the panel', () => {
  const RECEIPT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  function listed(f: ReturnType<typeof fixture>): void {
    f.state.pendingReceipts = [{ receipt: RECEIPT, path: '/home/user/.netrc', items: [metadata()] }]
  }
  it('Keep clears the receipt and reloads without a toast', async () => {
    const f = fixture()
    listed(f)
    await f.host.refresh()
    await f.host.handle({ type: 'vaultKeepReceipt', receipt: RECEIPT })
    expect(f.deps.service.keepImport).toHaveBeenCalledWith(RECEIPT)
    expect(f.deps.showError).not.toHaveBeenCalled()
    expect(lastState(f).status.state).toBe('unlocked')
    f.host.dispose()
  })
  it('Delete finishes the receipt and reloads without a toast', async () => {
    const f = fixture()
    listed(f)
    await f.host.refresh()
    await f.host.handle({ type: 'vaultDeleteReceipt', receipt: RECEIPT })
    expect(f.deps.service.deleteImport).toHaveBeenCalledWith(
      RECEIPT,
      expect.any(Function),
      expect.anything(),
    )
    expect(f.deps.showError).not.toHaveBeenCalled()
    expect(lastState(f).status.state).toBe('unlocked')
    f.host.dispose()
  })
  it('a refused Delete from the list names its true reason', async () => {
    const f = fixture()
    listed(f)
    await f.host.refresh()
    f.deps.service.deleteImport.mockRejectedValueOnce(new Error(UI_TEXT.vault.sourceUnreadable))
    await f.host.handle({ type: 'vaultDeleteReceipt', receipt: RECEIPT })
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.sourceUnreadable)
    f.host.dispose()
  })
  it('a listed Delete that lost its receipt finishes by clearing it', async () => {
    const f = fixture()
    listed(f)
    await f.host.refresh()
    f.deps.service.deleteImport.mockRejectedValueOnce(new Error(UI_TEXT.vault.sourceGone))
    await f.host.handle({ type: 'vaultDeleteReceipt', receipt: RECEIPT })
    expect(f.deps.service.keepImport).toHaveBeenCalledWith(RECEIPT)
    expect(f.deps.showError).toHaveBeenCalledWith(UI_TEXT.vault.sourceGone)
    f.host.dispose()
  })
})

describe('RVCM1091F P3 translated tables use one word for the vault', () => {
  it('ja, ko, zh-cn and zh-tw use the table majority term in every vault string', () => {
    const stringsOf = (table: Record<string, unknown>): Record<string, string> => {
      const strings: Record<string, string> = {}
      for (const [key, value] of Object.entries(table))
        if (typeof value === 'string') strings[key] = value
      return strings
    }
    const tables: Record<string, Record<string, string>> = {
      ja: stringsOf(jaTable.vault),
      ko: stringsOf(koTable.vault),
      'zh-cn': stringsOf(cnTable.vault),
      'zh-tw': stringsOf(twTable.vault),
    }
    const terms: Record<string, readonly string[]> = {
      ja: ['ボールト'],
      ko: ['볼트'],
      'zh-cn': ['保管库'],
      'zh-tw': ['保管庫', '保存庫'],
    }
    for (const [lang, table] of Object.entries(tables)) {
      const bad = terms[lang] ?? []
      for (const [key, value] of Object.entries(table)) {
        for (const word of bad) expect(value, `${lang}.${key}`).not.toContain(word)
      }
      // The fixed sentences name the feature with the majority term.
      for (const key of ['itemConflict', 'deleteConflict', 'operationFailed', 'sourceGone']) {
        expect(typeof table[key]).toBe('string')
      }
    }
    expect(tables['ja']?.['operationFailed']).toContain('保管庫')
    expect(tables['ko']?.['operationFailed']).toContain('보관함')
    expect(tables['zh-cn']?.['operationFailed']).toContain('凭据库')
    expect(tables['zh-tw']?.['operationFailed']).toContain('憑證庫')
  })
})
