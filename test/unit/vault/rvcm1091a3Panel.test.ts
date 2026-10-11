// Real management/session/panel composition over generated, in-memory transport.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  VaultManageSession,
  type VaultBrokerConnection,
} from '../../../src/core/vault/broker/manageClient'
import { VaultManagementError } from '../../../src/core/vault/broker/ports'
import { VaultPanelHost, type VaultPanelHostDeps } from '../../../src/host/vault/vaultPanelHost'
import { vaultPanelService } from '../../../src/host/vault/vaultPanelService'
import { discoverAmbientFiles } from '../../../src/core/vault/migrate/ambient'
import { cleanupTempHomes, lockedVault, managementFixture, tempHome } from './managementFixture'
import { holdFileWrite } from './storeFixtures'
import { UI_TEXT } from '../../../src/shared/constants'
import { vaultHostMessageSchema } from '../../../src/shared/hostApi/vaultMessages'

afterEach(cleanupTempHomes)
const noUnsubscribe = () => undefined

async function panelFixture() {
  const home = await tempHome()
  const file = path.join(home, '.netrc')
  await writeFile(file, 'machine example.test login generated-user password generated-password\n')
  const f = managementFixture(undefined, home)
  const code = await lockedVault(f)
  code.fill(0)
  await f.broker.unlock(null)
  const connections: { open: boolean }[] = []
  const session = new VaultManageSession(() => {
    const state = { open: true }
    connections.push(state)
    const closed = Promise.withResolvers<undefined>()
    let unsubscribe: () => void = noUnsubscribe
    const client: VaultBrokerConnection = {
      send: async (request) => {
        if (!('kind' in request)) throw new Error('unsupported generated frame')
        try {
          switch (request.kind) {
            case 'snapshot': {
              return { kind: 'snapshot', snapshot: await f.management.snapshot() }
            }
            case 'audit': {
              return { kind: 'audit', records: [] }
            }
            case 'import': {
              const report = await f.management.importFile(request.path, () => state.open)
              return { kind: 'imported', receipt: report.receipt, items: [...report.items] }
            }
            case 'importDelete': {
              await f.management.deleteImport(request.receipt, () => state.open)
              return { kind: 'ok' }
            }
            case 'importKeep': {
              await f.management.keepImport(request.receipt)
              return { kind: 'ok' }
            }
            default: {
              throw new Error('unsupported generated request')
            }
          }
        } catch (error: unknown) {
          if (error instanceof VaultManagementError)
            return { kind: 'refused', reason: error.reason }
          throw error
        }
      },
      close: () => {
        state.open = false
        unsubscribe()
        closed.resolve(undefined)
      },
      watch: (onEvent) => {
        unsubscribe = f.management.subscribe(onEvent)
        return Promise.resolve()
      },
      closed: () => closed.promise,
    }
    return Promise.resolve(client)
  })
  const deps: VaultPanelHostDeps = {
    service: {
      ...vaultPanelService(session, { ambientFiles: () => discoverAmbientFiles(home) }),
      subscribe: (onEvent) => f.management.subscribe(onEvent),
    },
    now: () => f.clock.now(),
    editItem: () => Promise.resolve(null),
    confirmRemove: () => Promise.resolve(false),
    copyPublicKey: () => Promise.resolve(),
    showRecoveryCode: () => Promise.resolve(false),
    confirmReset: () => Promise.resolve(null),
    importDone: vi.fn(() => Promise.resolve('delete' as const)),
    publish: vi.fn(),
    status: vi.fn(),
    showError: vi.fn(),
  }
  const host = new VaultPanelHost(deps)
  await host.refresh()
  return { f, host, deps, file, connections }
}

describe('RVCM1091A3 panel import lifecycle', () => {
  it.each(['changed-source', 'dialog', 'keep', 'delete', 'report'] as const)(
    'RVCM1091A4 F2: %s refusal reloads an already committed import',
    async (failure) => {
      const { f, host, deps, file } = await panelFixture()
      const changed = 'machine example.test login changed-user password changed-password\n'
      const refusal = new Error('generated post-commit refusal')
      switch (failure) {
        case 'changed-source': {
          vi.mocked(deps.importDone).mockImplementationOnce(async () => {
            await writeFile(file, changed)
            return 'delete'
          })
          break
        }
        case 'dialog': {
          vi.mocked(deps.importDone).mockRejectedValueOnce(refusal)
          break
        }
        case 'report': {
          const importFile = deps.service.importFile.bind(deps.service)
          vi.spyOn(deps.service, 'importFile').mockImplementationOnce(async (...args) => {
            await importFile(...args)
            throw refusal
          })
          break
        }
        default: {
          vi.mocked(deps.importDone).mockResolvedValueOnce(failure)
          vi.spyOn(
            deps.service,
            failure === 'keep' ? 'keepImport' : 'deleteImport',
          ).mockRejectedValueOnce(refusal)
        }
      }
      try {
        await host.handle({ type: 'vaultImport', path: file })
        expect(await f.repository.current().list()).toHaveLength(1)
        expect(deps.showError).toHaveBeenCalledExactlyOnceWith(UI_TEXT.vault.operationFailed)
        const published: unknown = vi.mocked(deps.publish).mock.lastCall?.[0]
        const last = vaultHostMessageSchema.parse(published)
        expect(last.state.items).toHaveLength(1)
        expect(last.state.status.itemCount).toBe(1)
        const source = await stat(file)
        expect(source.isFile()).toBe(true)
        if (failure === 'changed-source') expect(await readFile(file, 'utf8')).toBe(changed)
      } finally {
        host.dispose()
      }
    },
  )

  it('F7: disposal closes a sent import before commit and opens no late dialog', async () => {
    const { f, host, deps, file, connections } = await panelFixture()
    const { held, state } = holdFileWrite(f.files, 'pending.v1')
    const importing = host.handle({ type: 'vaultImport', path: file })
    await vi.waitFor(() => {
      expect(state.isHeld).toBe(true)
    })
    host.dispose()
    expect(connections.every((connection) => !connection.open)).toBe(true)
    held.resolve(undefined)
    await importing
    f.files.hold = null
    expect(await f.repository.current().list()).toEqual([])
    expect(deps.importDone).not.toHaveBeenCalled()
    expect(deps.showError).not.toHaveBeenCalled()
  })

  it('F8: real import change notifications preserve the user Delete choice', async () => {
    const { f, host, deps, file } = await panelFixture()
    try {
      await host.handle({ type: 'vaultImport', path: file })
      expect(await f.repository.current().list()).toHaveLength(1)
      expect(deps.importDone).toHaveBeenCalledOnce()
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(deps.showError).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })

  it('F8: Lock during Keep/Delete withdraws receipt authority', async () => {
    const { f, host, deps, file } = await panelFixture()
    const choice = Promise.withResolvers<'delete'>()
    vi.mocked(deps.importDone).mockImplementationOnce(() => choice.promise)
    const importing = host.handle({ type: 'vaultImport', path: file })
    await vi.waitFor(() => {
      expect(deps.importDone).toHaveBeenCalledOnce()
    })
    f.management.noteLocked(2)
    choice.resolve('delete')
    await importing
    const remaining = await stat(file)
    expect(remaining.isFile()).toBe(true)
    host.dispose()
  })

  it('F7: cancellation while connecting sends no import, closes the late connection', async () => {
    const acquired = Promise.withResolvers<VaultBrokerConnection>()
    const client: VaultBrokerConnection = {
      send: vi.fn(),
      close: vi.fn(),
      watch: () => Promise.resolve(),
      closed: () => Promise.resolve(),
    }
    const session = new VaultManageSession(() => acquired.promise)
    const controller = new AbortController()
    const importing = session.importFile('/generated/.netrc', undefined, controller.signal)
    controller.abort()
    acquired.resolve(client)
    await expect(importing).rejects.toThrow()
    expect(client.send).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalled()
  })
})
