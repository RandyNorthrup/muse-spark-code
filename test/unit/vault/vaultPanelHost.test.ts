import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  VaultPanelHost,
  type VaultPanelService,
  type VaultPanelHostDeps,
} from '../../../src/host/vault/vaultPanelHost'
import { type VaultItem } from '../../../src/shared/vault'
import { panel, item, metadata, approval, grant } from '../helpers/vault/fixtures'

function fixture() {
  const state = panel()
  const changed: { callback: (event: unknown) => void } = { callback: vi.fn() }
  const service: VaultPanelService = {
    snapshot: vi.fn<VaultPanelService['snapshot']>(() => Promise.resolve(structuredClone(state))),
    subscribe: vi.fn<VaultPanelService['subscribe']>((callback) => {
      changed.callback = callback
      return vi.fn()
    }),
    unlock: vi.fn<VaultPanelService['unlock']>((authorize) => {
      authorize()
      return Promise.resolve()
    }),
    lock: vi.fn<VaultPanelService['lock']>(() => {
      state.status.state = 'locked'
      state.status.lockEpoch += 1
      state.pending = []
      return Promise.resolve()
    }),
    write: vi.fn<VaultPanelService['write']>((_item, authorize) => {
      authorize()
      return Promise.resolve()
    }),
    updateMetadata: vi.fn<VaultPanelService['updateMetadata']>((_item, authorize) => {
      authorize()
      return Promise.resolve()
    }),
    remove: vi.fn<VaultPanelService['remove']>((_id, authorize) => {
      authorize()
      return Promise.resolve()
    }),
    grant: vi.fn<VaultPanelService['grant']>((_grant, authorize) => {
      authorize()
      return Promise.resolve()
    }),
    revoke: vi.fn<VaultPanelService['revoke']>(() => Promise.resolve()),
    answer: vi.fn<VaultPanelService['answer']>(() => Promise.resolve()),
    importFile: vi.fn<VaultPanelService['importFile']>((_path, authorize) => {
      authorize()
      return Promise.resolve()
    }),
  }
  const deps = {
    service,
    now: () => 1000,
    editItem: vi.fn<VaultPanelHostDeps['editItem']>(() => Promise.resolve(null)),
    confirmRemove: vi.fn(() => Promise.resolve(true)),
    copyPublicKey: vi.fn(() => Promise.resolve()),
    publish: vi.fn(),
    status: vi.fn(),
    showError: vi.fn(),
  }
  const host = new VaultPanelHost(deps)
  return { host, deps, service, state, changed }
}

describe('U authenticated panel host', () => {
  it('V16 failed Lock keeps controls locked until an explicit unlock; cancellation reaches native entry', async () => {
    const f = fixture()
    await f.host.refresh()
    vi.mocked(f.service.lock).mockRejectedValueOnce(new Error('test failure'))
    await f.host.lock()
    const count = f.deps.publish.mock.calls.length
    await f.host.refresh()
    expect(f.deps.publish.mock.calls.length).toBe(count)
    expect(f.deps.status).toHaveBeenLastCalledWith(false)
    await f.host.handle({ type: 'vaultUnlock' })
    expect(f.deps.status).toHaveBeenLastCalledWith(true)
    const held = Promise.withResolvers<VaultItem | null>()
    let signal: AbortSignal | undefined
    f.deps.editItem.mockImplementationOnce((_current, value) => {
      signal = value
      return held.promise
    })
    const editing = f.host.handle({ type: 'vaultAdd' })
    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })
    f.host.dispose()
    expect(signal?.aborted).toBe(true)
    held.resolve(null)
    await editing
  })
  it('V16 external lock/revoke are immediate barriers even while a native editor waits', async () => {
    for (const kind of ['locked', 'revoked']) {
      const f = fixture()
      const signals: AbortSignal[] = []
      const held = Promise.withResolvers<VaultItem | null>()
      f.deps.editItem.mockImplementationOnce((_current, signal) => {
        signals.push(signal)
        return held.promise
      })
      const editing = f.host.handle({ type: 'vaultAdd' })
      await vi.waitFor(() => {
        expect(f.deps.editItem).toHaveBeenCalledOnce()
      })
      if (kind === 'locked') {
        f.state.status.state = 'locked'
        f.state.status.lockEpoch = 1
      }
      f.changed.callback(
        kind === 'locked'
          ? { kind, v: 1, lockEpoch: 1 }
          : { kind, v: 1, requesterId: approval().requester.id, grantId: null },
      )
      expect(signals[0]?.aborted).toBe(true)
      const entered = item()
      held.resolve(entered)
      await editing
      await f.host.refresh()
      expect(f.service.write).not.toHaveBeenCalled()
      if (entered.material.kind === 'secret')
        expect(entered.material.value.every((byte) => byte === 0)).toBe(true)
      if (kind === 'locked') {
        f.state.status.state = 'unlocked'
        f.changed.callback({ kind: 'changed' })
        await f.host.refresh()
        expect(f.deps.status).toHaveBeenLastCalledWith(true)
      }
      f.host.dispose()
    }
  })
  it('malformed and older-epoch notifications do not invalidate the current view', async () => {
    const f = fixture()
    f.state.status.lockEpoch = 2
    await f.host.refresh()
    const count = f.deps.publish.mock.calls.length
    f.changed.callback({ kind: 'locked', v: 1, lockEpoch: 1 })
    f.changed.callback({ kind: 'locked', v: 1, lockEpoch: 3, value: randomBytes(32) })
    expect(f.deps.publish.mock.calls.length).toBe(count)
    f.host.dispose()
  })
  it('V11 replay is refused even while the broker snapshot still contains an answered card', async () => {
    const f = fixture()
    const request = approval()
    f.state.pending = [request]
    const message = {
      type: 'vaultAnswer',
      answer: { requestId: request.id, digest: request.digest, decision: 'allowOnce' },
    }
    await f.host.handle(message)
    await f.host.handle(message)
    expect(f.service.answer).toHaveBeenCalledOnce()
    f.host.dispose()
  })
  it('V8 V9 rejects secret-shaped and unknown inbound messages without echoing them', async () => {
    const f = fixture()
    for (const raw of [
      { type: 'vaultAdd', value: randomBytes(32) },
      { type: 'vaultAnswer', answer: { decision: 'always' } },
      { type: 'tool', result: approval() },
    ])
      await f.host.handle(raw)
    expect(f.service.snapshot).not.toHaveBeenCalled()
    expect(f.deps.editItem).not.toHaveBeenCalled()
    expect(f.deps.publish).not.toHaveBeenCalled()
    f.host.dispose()
  })
  it('V9 validates every snapshot and never publishes a malformed value field', async () => {
    const f = fixture()
    vi.mocked(f.service.snapshot).mockResolvedValue({ ...panel(), value: randomBytes(32) })
    await f.host.refresh()
    expect(f.deps.publish).not.toHaveBeenCalled()
    expect(f.deps.showError).toHaveBeenCalledOnce()
    f.host.dispose()
  })
  it('publishes copies, updates status only while unlocked and reports fixed errors', async () => {
    const f = fixture()
    await f.host.handle({ type: 'vaultReady' })
    expect(f.deps.status).toHaveBeenLastCalledWith(true)
    await f.host.lock()
    expect(f.service.lock).toHaveBeenCalledOnce()
    expect(f.deps.status).toHaveBeenLastCalledWith(false)
    f.host.dispose()
  })
  it('V7 wipes entered bytes after success and after a rejected transaction', async () => {
    const f = fixture()
    for (const isFail of [false, true]) {
      const entered = item()
      f.deps.editItem.mockResolvedValueOnce(entered)
      if (isFail)
        vi.mocked(f.service.write).mockRejectedValueOnce(new Error(randomBytes(32).toString('hex')))
      await f.host.handle({ type: 'vaultAdd' })
      expect(entered.material.kind).toBe('secret')
      if (entered.material.kind === 'secret')
        expect([...entered.material.value]).toEqual(Array.from({ length: 32 }, () => 0))
    }
    expect(f.service.write).toHaveBeenCalledTimes(2)
    expect(f.deps.showError).toHaveBeenCalledOnce()
    f.host.dispose()
  })
  it('V16 lock retires a pending password box and wipes its late result', async () => {
    const f = fixture()
    const held = Promise.withResolvers<VaultItem | null>()
    f.deps.editItem.mockReturnValueOnce(held.promise)
    const editing = f.host.handle({ type: 'vaultAdd' })
    await vi.waitFor(() => {
      expect(f.deps.editItem).toHaveBeenCalledOnce()
    })
    await f.host.lock()
    expect(f.deps.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({ status: expect.objectContaining({ state: 'locked' }) }),
      }),
    )
    const entered = item()
    held.resolve(entered)
    await editing
    expect(f.service.write).not.toHaveBeenCalled()
    if (entered.material.kind === 'secret')
      expect(entered.material.value.every((byte) => byte === 0)).toBe(true)
    f.host.dispose()
  })
  it('V16 lock cancels a transaction at its physical commit callback', async () => {
    const f = fixture()
    const held = Promise.withResolvers<undefined>()
    const heldCommit: { commit?: () => void } = {}
    f.deps.editItem.mockResolvedValue(item())
    vi.mocked(f.service.write).mockImplementation(async (_item, authorize) => {
      heldCommit.commit = authorize
      await held.promise
      authorize()
    })
    const write = f.host.handle({ type: 'vaultAdd' })
    await vi.waitFor(() => {
      expect(heldCommit.commit).toBeDefined()
    })
    await f.host.lock()
    expect(() => heldCommit.commit?.()).toThrow()
    held.resolve(undefined)
    await write
    f.host.dispose()
  })
  it('V16 stale snapshot cannot resurrect a locked panel and dispose ignores late work', async () => {
    for (const action of ['lock', 'dispose']) {
      const f = fixture()
      const held = Promise.withResolvers<unknown>()
      vi.mocked(f.service.snapshot).mockReturnValueOnce(held.promise)
      const refreshing = f.host.refresh()
      await vi.waitFor(() => {
        expect(f.service.snapshot).toHaveBeenCalledOnce()
      })
      if (action === 'lock') await f.host.lock()
      else f.host.dispose()
      const count = f.deps.publish.mock.calls.length
      held.resolve(panel())
      await refreshing
      expect(f.deps.publish.mock.calls.length).toBe(count)
      f.host.dispose()
    }
  })
  it('rejects epoch rollback and canceled native editing', async () => {
    const f = fixture()
    f.state.status.lockEpoch = 2
    await f.host.refresh()
    f.state.status.lockEpoch = 1
    await f.host.refresh()
    expect(f.deps.publish).toHaveBeenCalledOnce()
    f.state.status.lockEpoch = 2
    await f.host.handle({ type: 'vaultAdd' })
    expect(f.service.write).not.toHaveBeenCalled()
    f.host.dispose()
  })
  it('V8 clipboard accepts only an SSH public key', async () => {
    const f = fixture()
    await f.host.handle({ type: 'vaultPublicKey', itemId: metadata().id })
    expect(f.deps.copyPublicKey).not.toHaveBeenCalled()
    f.state.items[0] = {
      ...metadata(),
      kind: 'sshKey',
      publicKey: 'ssh-ed25519 ' + randomBytes(32).toString('base64'),
    }
    await f.host.handle({ type: 'vaultPublicKey', itemId: metadata().id })
    expect(f.deps.copyPublicKey).toHaveBeenCalledExactlyOnceWith(f.state.items[0].publicKey)
    f.host.dispose()
  })
  it('V11 rejects wrong, late, unknown and old-epoch answers', async () => {
    for (const variant of ['digest', 'expiry', 'id', 'epoch']) {
      const f = fixture()
      const request = approval()
      if (variant === 'expiry') {
        request.expiresAt = 1000
        request.createdAt = 0
      } else if (variant === 'epoch') request.lockEpoch = 1
      f.state.pending = [request]
      await f.host.handle({
        type: 'vaultAnswer',
        answer: {
          requestId: variant === 'id' ? 'f'.repeat(32) : request.id,
          digest: variant === 'digest' ? 'f'.repeat(64) : request.digest,
          decision: 'allowOnce',
        },
      })
      expect(f.service.answer).not.toHaveBeenCalled()
      f.host.dispose()
    }
  })
  it('V1 V11 session answers are bounded by mode, session identity, taint and disclosure', async () => {
    for (const variant of ['mode', 'session', 'taint', 'disclosure', 'valid']) {
      const f = fixture()
      const request = approval()
      request.item.policy.mode = variant === 'mode' ? 'alwaysAllow' : 'askOncePerSession'
      request.requester.sessionId = variant === 'session' ? null : request.requester.sessionId
      request.taint =
        variant === 'taint'
          ? { tainted: true, reasons: [{ source: 'web', label: 'page' }] }
          : request.taint
      request.use =
        variant === 'disclosure' ? { kind: 'disclosure', recipient: 'person' } : request.use
      f.state.pending = [request]
      await f.host.handle({
        type: 'vaultAnswer',
        answer: { requestId: request.id, digest: request.digest, decision: 'allowSession' },
      })
      expect(f.service.answer).toHaveBeenCalledTimes(variant === 'valid' ? 1 : 0)
      f.host.dispose()
    }
  })
  it('edits only the selected id; metadata updates do not read existing values', async () => {
    const f = fixture()
    const replacement = item()
    replacement.metadata.id = 'f'.repeat(32)
    f.deps.editItem.mockResolvedValueOnce(replacement)
    await f.host.handle({ type: 'vaultEdit', itemId: metadata().id })
    expect(f.service.write).not.toHaveBeenCalled()
    f.deps.editItem.mockResolvedValueOnce(metadata())
    await f.host.handle({ type: 'vaultEdit', itemId: metadata().id })
    expect(f.service.updateMetadata).toHaveBeenCalledOnce()
    await f.host.handle({ type: 'vaultEdit', itemId: 'f'.repeat(32) })
    expect(f.deps.editItem).toHaveBeenCalledTimes(2)
    f.host.dispose()
  })
  it('V12 standing grants require panel authority, a visible item and fresh counters', async () => {
    const f = fixture()
    await f.host.handle({ type: 'vaultGrant', grant: grant() })
    expect(f.service.grant).toHaveBeenCalledOnce()
    for (const altered of [
      { ...grant(), createdBy: 'vaultCli' },
      { ...grant(), uses: 1 },
      { ...grant(), itemId: 'f'.repeat(32) },
    ])
      await f.host.handle({ type: 'vaultGrant', grant: altered })
    f.state.items[0]!.hidden = true
    await f.host.handle({ type: 'vaultGrant', grant: grant() })
    expect(f.service.grant).toHaveBeenCalledOnce()
    await f.host.handle({ type: 'vaultRevoke', grantId: grant().id })
    expect(f.service.revoke).toHaveBeenCalledExactlyOnceWith(grant().id)
    f.host.dispose()
  })
  it('imports only discovered paths, including Windows separator equivalence', async () => {
    const f = fixture()
    f.state.ambientFiles = [{ path: String.raw`C:\home\.netrc`, kind: 'netrc' }]
    await f.host.handle({ type: 'vaultImport', path: 'C:/home/.netrc' })
    expect(f.service.importFile).toHaveBeenCalledOnce()
    await f.host.handle({ type: 'vaultImport', path: 'C:/home/.netrc-other' })
    expect(f.service.importFile).toHaveBeenCalledOnce()
    await f.host.handle({ type: 'vaultRemove', itemId: metadata().id })
    expect(f.service.remove).toHaveBeenCalledOnce()
    f.deps.confirmRemove.mockResolvedValueOnce(false)
    await f.host.handle({ type: 'vaultRemove', itemId: metadata().id })
    expect(f.service.remove).toHaveBeenCalledOnce()
    f.host.dispose()
  })
  it('unlock is explicit and disposal unregisters notifications', async () => {
    const f = fixture()
    await f.host.handle({ type: 'vaultUnlock' })
    expect(f.service.unlock).toHaveBeenCalledOnce()
    f.changed.callback({ kind: 'changed' })
    await f.host.refresh()
    f.host.dispose()
    await f.host.handle({ type: 'vaultAdd' })
    expect(f.deps.editItem).not.toHaveBeenCalled()
  })
})
