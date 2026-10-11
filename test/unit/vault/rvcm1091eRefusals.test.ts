// RVCM1091E CLASS 2: every refusal the broker can return for add, import
// and delete carries a sentence that is true for THAT operation. A Delete
// refused because the source changed after a successful import is a
// `deleteConflict` (the imported items stay; nothing was deleted) — never
// the add/import `conflict` sentence claiming nothing was added. A duplicate
// that wins the race past add's pre-check is a `conflict`, never the generic
// failure. Table: each operation crossed with each refusal it can return.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT } from '../../../src/shared/constants'
import { vaultRefusalMessage } from '../../../src/core/vault/broker/manageClient'
import type { VaultManagementRefusal } from '../../../src/core/vault/broker/ports'
import { VaultPanelHost, type VaultPanelHostDeps } from '../../../src/host/vault/vaultPanelHost'
import { item, metadata, panel } from '../helpers/vault/fixtures'
import { cleanupTempHomes, lockedVault, managementFixture, tempHome } from './managementFixture'

afterEach(cleanupTempHomes)

const unsubscribe = (): void => undefined

describe('RVCM1091E delete refusals name what stayed', () => {
  it('a source changed after a successful import refuses Delete as deleteConflict', async () => {
    const home = await tempHome()
    const file = path.join(home, '.netrc')
    await writeFile(file, 'machine example.test login generated-user password generated-password\n')
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    const report = await f.management.importFile(file, () => true)
    // The source is replaced after the import committed, before Delete.
    await writeFile(
      file,
      'machine example.test login generated-user password generated-replacement\n',
    )
    await expect(f.management.deleteImport(report.receipt, () => true)).rejects.toMatchObject({
      reason: 'deleteConflict',
    })
    // Nothing was deleted: the imported items stay and the source stays.
    expect(await f.repository.current().list()).toHaveLength(1)
    await expect(stat(file)).resolves.toBeDefined()
  })

  it('the deleteConflict sentence never claims nothing was added', () => {
    expect(vaultRefusalMessage('deleteConflict')).toBe(UI_TEXT.vault.deleteConflict)
    expect(UI_TEXT.vault.deleteConflict.toLowerCase()).not.toContain('added')
    expect(UI_TEXT.vault.deleteConflict.toLowerCase()).toContain('deleted')
  })

  it('the panel host keeps the delete sentence instead of the generic failure', async () => {
    const state = panel()
    state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
    const showError = vi.fn()
    const deps: VaultPanelHostDeps = {
      service: {
        snapshot: () => Promise.resolve(structuredClone(state)),
        subscribe: () => unsubscribe,
        unlock: () => Promise.resolve(),
        lock: () => Promise.resolve(),
        write: () => Promise.resolve(),
        updateMetadata: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        grant: () => Promise.resolve(),
        revoke: () => Promise.resolve(),
        answer: () => Promise.resolve(),
        importFile: () =>
          Promise.resolve({ receipt: 'a'.repeat(32), items: [structuredClone(metadata())] }),
        keepImport: () => Promise.resolve(),
        deleteImport: () => Promise.reject(new Error(UI_TEXT.vault.deleteConflict)),
        resetBegin: () => Promise.reject(new Error('unused route')),
        resetConfirm: () => Promise.resolve(),
        setup: () => Promise.reject(new Error('unused route')),
        confirmSetup: () => Promise.resolve(),
        cancelSetup: () => Promise.resolve(),
      },
      now: () => 1000,
      editItem: () => Promise.resolve(item()),
      confirmRemove: () => Promise.resolve(true),
      copyPublicKey: () => Promise.resolve(),
      publish: vi.fn(),
      status: vi.fn(),
      showError,
      importDone: () => Promise.resolve('delete' as const),
      confirmReset: () => Promise.resolve(null),
      showRecoveryCode: () => Promise.resolve(true),
    }
    const host = new VaultPanelHost(deps)
    await host.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
    expect(showError).toHaveBeenCalledWith(UI_TEXT.vault.deleteConflict)
    host.dispose()
  })
})

describe('RVCM1091E add/import collisions refuse as conflict', () => {
  it('a duplicate that wins the race past the pre-check refuses as conflict', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    await f.management.add({
      metadata: metadata(),
      material: { kind: 'secret', value: Buffer.from('generated-first') },
    })
    // The pre-check reads before the rival commits: it sees no collision.
    const store = f.repository.current()
    vi.spyOn(store, 'list').mockResolvedValueOnce([])
    await expect(
      f.management.add({
        metadata: { ...metadata(), id: 'e'.repeat(32) },
        material: { kind: 'secret', value: Buffer.from('generated-second') },
      }),
    ).rejects.toMatchObject({ reason: 'conflict' })
  })

  it('the conflict sentence never claims a deletion', () => {
    expect(UI_TEXT.vault.itemConflict.toLowerCase()).not.toContain('delet')
  })
})

describe('RVCM1091E unopenable snapshots name no protection', () => {
  it('uncreated, setup-pending and lost snapshots carry no slot', async () => {
    const f = managementFixture()
    f.broker.status.mockResolvedValue({
      state: 'locked',
      lockEpoch: 0,
      tier: 'osStore',
      provider: 'loginKeychain',
      silentUnlock: true,
      itemCount: 0,
      reason: 'locked',
    })
    const uncreated = await f.management.snapshot()
    expect(uncreated.status.state).toBe('uncreated')
    const shown = await f.management.setup()
    const pending = await f.management.snapshot()
    expect(pending.status.state).toBe('setupPending')
    shown.code.fill(0)
    for (const snapshot of [uncreated, pending]) {
      expect(snapshot.status.tier).toBeNull()
      expect(snapshot.status.provider).toBeNull()
      expect(snapshot.status.silentUnlock).toBe(false)
    }
  })

  it('a lost vault with a lingering broker slot still names no protection', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    f.files.data.delete('slots.v1')
    f.files.data.delete('vault.v1')
    f.broker.status.mockResolvedValue({
      state: 'locked',
      lockEpoch: 0,
      tier: 'osStore',
      provider: 'loginKeychain',
      silentUnlock: true,
      itemCount: 0,
      reason: 'locked',
    })
    const snapshot = await f.management.snapshot()
    expect(snapshot.status.state).toBe('unavailable')
    expect(snapshot.status.reason).toBe('vaultLost')
    expect(snapshot.status.tier).toBeNull()
    expect(snapshot.status.provider).toBeNull()
  })

  it('an unlocked vault keeps its observed slot', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    const snapshot = await f.management.snapshot()
    expect(snapshot.status.state).toBe('unlocked')
    expect(snapshot.status.tier).toBe('osStore')
  })
})

describe('RVCM1091E refusal sentences per operation', () => {
  interface Cell {
    readonly operation: 'add' | 'import' | 'delete'
    readonly reason: VaultManagementRefusal
    readonly forbidden: readonly string[]
  }
  const CELLS: readonly Cell[] = [
    { operation: 'add', reason: 'locked', forbidden: [] },
    { operation: 'add', reason: 'conflict', forbidden: ['delet'] },
    { operation: 'add', reason: 'invalid', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'add', reason: 'io', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'add', reason: 'storeUnavailable', forbidden: [] },
    { operation: 'import', reason: 'locked', forbidden: [] },
    { operation: 'import', reason: 'conflict', forbidden: ['delet'] },
    { operation: 'import', reason: 'invalid', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'import', reason: 'io', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'import', reason: 'storeUnavailable', forbidden: [] },
    { operation: 'delete', reason: 'locked', forbidden: [] },
    { operation: 'delete', reason: 'deleteConflict', forbidden: ['added'] },
    { operation: 'delete', reason: 'invalid', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'delete', reason: 'io', forbidden: ['unlock', 'added', 'delet'] },
    { operation: 'delete', reason: 'storeUnavailable', forbidden: [] },
  ]
  it.each(CELLS.map((cell) => [cell.operation, cell.reason] as const))(
    'the %s refusal %s is true for that operation',
    (operation, reason) => {
      const cell = CELLS.find((entry) => entry.operation === operation && entry.reason === reason)!
      const sentence = vaultRefusalMessage(reason)
      expect(sentence.length).toBeGreaterThan(0)
      // The operation's own refusal never borrows another operation's claim.
      for (const word of cell.forbidden) expect(sentence.toLowerCase()).not.toContain(word)
      switch (reason) {
        case 'conflict': {
          expect(operation).not.toBe('delete')
          expect(sentence).toBe(UI_TEXT.vault.itemConflict)
          break
        }
        case 'deleteConflict': {
          expect(operation).toBe('delete')
          expect(sentence).toBe(UI_TEXT.vault.deleteConflict)
          break
        }
        case 'invalid':
        case 'io': {
          expect(sentence).toBe(UI_TEXT.vault.operationFailed)
          break
        }
        default: {
          break
        }
      }
    },
  )

  it('every broker refusal has a sentence', () => {
    const reasons: readonly VaultManagementRefusal[] = [
      'locked',
      'uncreated',
      'exists',
      'conflict',
      'deleteConflict',
      'busy',
      'invalid',
      'rollback',
      'io',
      'storeUnavailable',
    ]
    for (const reason of reasons) expect(vaultRefusalMessage(reason).length).toBeGreaterThan(0)
  })
})
