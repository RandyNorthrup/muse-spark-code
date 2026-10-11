// RVCM1091D P2 (management-client honesty): an item or path collision is a
// `conflict` with its own sentence, never the "a vault already exists"
// setup sentence. Only creating a second vault keeps `exists`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT } from '../../../src/shared/constants'
import { vaultRefusalMessage } from '../../../src/core/vault/broker/manageClient'
import { VaultPanelHost, type VaultPanelHostDeps } from '../../../src/host/vault/vaultPanelHost'
import { item, metadata, panel } from '../helpers/vault/fixtures'
import { cleanupTempHomes, lockedVault, managementFixture, tempHome } from './managementFixture'

afterEach(cleanupTempHomes)

const unsubscribe = (): void => undefined
function unusedRoute(): never {
  throw new Error('unused route')
}

describe('RVCM1091D item collisions refuse as conflict', () => {
  it('adding an item with a duplicate id or name refuses as conflict', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    await f.management.add({
      metadata: metadata(),
      material: { kind: 'secret', value: randomBytes(32) },
    })
    await expect(
      f.management.add({
        metadata: metadata(),
        material: { kind: 'secret', value: randomBytes(8) },
      }),
    ).rejects.toMatchObject({ reason: 'conflict' })
  })

  it('a file whose parent changes identity refuses as conflict, not as existing setup', async () => {
    const root = await tempHome()
    const parent = path.join(root, 'parent')
    const home = path.join(parent, 'home')
    const outside = await tempHome()
    await mkdir(home, { recursive: true })
    await mkdir(path.join(outside, 'home'))
    const file = path.join(home, '.netrc')
    const raw = 'machine example.test login generated-user password generated-password\n'
    await writeFile(file, raw)
    await writeFile(path.join(outside, 'home', '.netrc'), raw)
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    code.fill(0)
    await f.broker.unlock(null)
    // The first Keep retains the importer and its originally admitted home.
    const report = await f.management.importFile(file, () => true)
    await f.management.keepImport(report.receipt)
    await rename(parent, `${parent}-retained`)
    await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(f.management.importFile(file, () => true)).rejects.toMatchObject({
      reason: 'conflict',
    })
    expect(await f.repository.current().list()).toHaveLength(1)
  })

  it('creating a second vault still refuses as exists', async () => {
    const f = managementFixture()
    const code = await lockedVault(f)
    code.fill(0)
    await expect(f.management.setup()).rejects.toMatchObject({ reason: 'exists' })
  })

  it('the conflict sentence names the collision, not the setup', () => {
    expect(vaultRefusalMessage('conflict')).toBe(UI_TEXT.vault.itemConflict)
    expect(vaultRefusalMessage('conflict')).not.toBe(UI_TEXT.vault.setupExists)
    expect(vaultRefusalMessage('exists')).toBe(UI_TEXT.vault.setupExists)
  })

  it('the panel host keeps the conflict sentence instead of the generic failure', async () => {
    const state = panel()
    const showError = vi.fn()
    // A complete host contract, so no cast: only Add is driven.
    const deps: VaultPanelHostDeps = {
      service: {
        snapshot: () => Promise.resolve(structuredClone(state)),
        subscribe: () => unsubscribe,
        unlock: () => Promise.resolve(),
        lock: () => Promise.resolve(),
        write: () => Promise.reject(new Error(UI_TEXT.vault.itemConflict)),
        updateMetadata: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        grant: () => Promise.resolve(),
        revoke: () => Promise.resolve(),
        answer: () => Promise.resolve(),
        importFile: unusedRoute,
        keepImport: () => Promise.resolve(),
        deleteImport: () => Promise.resolve(),
        resetBegin: unusedRoute,
        resetConfirm: () => Promise.resolve(),
        setup: unusedRoute,
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
      importDone: () => Promise.resolve('keep' as const),
      confirmReset: () => Promise.resolve(null),
      showRecoveryCode: () => Promise.resolve(true),
    }
    const host = new VaultPanelHost(deps)
    await host.handle({ type: 'vaultAdd' })
    expect(showError).toHaveBeenCalledWith(UI_TEXT.vault.itemConflict)
    host.dispose()
  })
})
