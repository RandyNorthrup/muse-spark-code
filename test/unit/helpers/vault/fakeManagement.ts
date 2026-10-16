import { randomBytes } from 'node:crypto'
import { VAULT_RECOVERY_BYTES } from '../../../../src/shared/constants'
import { type VaultItem, type VaultItemMetadata } from '../../../../src/shared/vault'
import {
  type VaultBrokerEvent,
  type VaultBrokerSnapshot,
} from '../../../../src/shared/vaultProtocol'
import {
  VaultManagementError,
  type VaultManagementPort,
} from '../../../../src/core/vault/broker/ports'

/** In-memory v2 management side for channel tests; material is generated, never real. */
export function fakeManagement(status: VaultBrokerSnapshot['status']) {
  const items = new Map<string, VaultItemMetadata>()
  const listeners = new Set<(event: VaultBrokerEvent) => void>()
  const received: { kind: string; materialBytes?: number }[] = []
  let setupId: string | null = null
  let code: Buffer | null = null
  const changed = () => {
    for (const listener of listeners) listener({ kind: 'changed', v: 2 })
  }
  const store = (item: VaultItem, isEdit: boolean) => {
    if (isEdit !== items.has(item.metadata.id)) throw new VaultManagementError('invalid')
    received.push({
      kind: isEdit ? 'edit' : 'add',
      materialBytes: Object.values(item.material).reduce<number>(
        (total, value) => total + (value instanceof Uint8Array ? value.byteLength : 0),
        0,
      ),
    })
    items.set(item.metadata.id, structuredClone(item.metadata))
    changed()
  }
  const port: VaultManagementPort = {
    snapshot: () =>
      Promise.resolve({
        status,
        setupId,
        items: Object.values(Object.fromEntries(items)),
        grants: [],
        pending: [],
        pendingReceipts: [],
      }),
    add: (item) => {
      store(item, false)
      return Promise.resolve()
    },
    edit: (item) => {
      store(item, true)
      return Promise.resolve()
    },
    editMetadata: (metadata) => {
      if (!items.has(metadata.id)) return Promise.reject(new VaultManagementError('invalid'))
      items.set(metadata.id, structuredClone(metadata))
      changed()
      return Promise.resolve()
    },
    remove: (itemId) => {
      if (!items.delete(itemId)) return Promise.reject(new VaultManagementError('invalid'))
      changed()
      return Promise.resolve()
    },
    importFile: () => Promise.reject(new VaultManagementError('invalid')),
    keepImport: () => Promise.reject(new VaultManagementError('invalid')),
    deleteImport: () => Promise.reject(new VaultManagementError('invalid')),
    resetBegin: () => Promise.reject(new VaultManagementError('invalid')),
    resetConfirm: () => Promise.reject(new VaultManagementError('invalid')),
    publicKey: (itemId) => {
      const item = items.get(itemId)
      return item?.publicKey
        ? Promise.resolve(item.publicKey)
        : Promise.reject(new VaultManagementError('invalid'))
    },
    setup: () => {
      if (status.state !== 'uncreated') return Promise.reject(new VaultManagementError('exists'))
      setupId = randomBytes(16).toString('hex')
      code = Buffer.from(randomBytes(VAULT_RECOVERY_BYTES).toString('hex'), 'ascii')
      return Promise.resolve({ setupId, code: Buffer.from(code) })
    },
    confirmSetup: (id) => {
      if (id !== setupId) return Promise.reject(new VaultManagementError('invalid'))
      setupId = null
      return Promise.resolve()
    },
    cancelSetup: (id) => {
      if (id !== setupId) return Promise.reject(new VaultManagementError('invalid'))
      setupId = null
      return Promise.resolve()
    },
    recover: (input) =>
      code !== null && Buffer.from(input).equals(code)
        ? Promise.resolve()
        : Promise.reject(new VaultManagementError('invalid')),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    port,
    items,
    received,
    emit: (event: VaultBrokerEvent) => {
      for (const listener of listeners) listener(event)
    },
  }
}
