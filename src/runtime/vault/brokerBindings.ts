import process from 'node:process'
import path from 'node:path'
import { homedir } from 'node:os'
import * as z from 'zod/mini'
import { VaultAuditLog, type VaultAuditAnchorPort } from '../../core/vault/broker/audit'
import { VaultError, eraseVaultMaterial } from '../../core/vault/crypto'
import { VaultStoreUnavailableError } from '../../core/vault/broker/ports'
import { VaultScrubber } from '../../core/vault/scrub'
import type { VaultStoreRepository } from '../../core/vault/broker/repository'
import { KEYRING_SERVICE, UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import type { KeyringEntryFactory } from '../keyStore'
import type { VaultBrokerBindings, VaultBrokerContext } from './vaultBrokerEntry'
import { isPosixVaultHost } from './posixHost'
import { holdVaultStartupLock, vaultPeerExecutable, vaultProcessIdentity } from './posixNative'
export { setUiText } from '../../shared/l10n/text'

const count = z.number().check(z.int(), z.nonnegative(), z.refine(Number.isSafeInteger))
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const auditAnchorSchema = z.strictObject({
  generation: count,
  hash: digest,
  baseGeneration: count,
  baseHash: digest,
})

/** Authenticated audit history plus its rotation checkpoint in the protected OS store. */
function auditLog(
  context: VaultBrokerContext,
  repository: VaultStoreRepository,
  keyring: KeyringEntryFactory,
): VaultAuditLog {
  const vaultId = repository.current().vaultId
  const account = `vault-audit-v1:${vaultId}`
  const directory = path.join(context.dataDir, 'audit', vaultId)
  let tail: Promise<unknown> = Promise.resolve()
  const anchors: VaultAuditAnchorPort = {
    read: async () => {
      let value: string | null | undefined
      try {
        value = await keyring(KEYRING_SERVICE, account).getPassword()
      } catch {
        throw new VaultStoreUnavailableError()
      }
      const zero = '0'.repeat(VAULT_LIMITS.sha256Hex)
      const record = auditAnchorSchema.parse(
        value == null
          ? { generation: 0, hash: zero, baseGeneration: 0, baseHash: zero }
          : JSON.parse(value),
      )
      const snapshot = await repository.current().exportSnapshot()
      if (
        snapshot.slots.auditGeneration !== record.generation ||
        snapshot.slots.auditHead !== record.hash
      )
        throw new VaultError('rollback')
      return record
    },
    write: async (record) => {
      const parsed = auditAnchorSchema.parse(record)
      await repository.current().commitAudit(parsed.generation, parsed.hash)
      try {
        await keyring(KEYRING_SERVICE, account).setPassword(JSON.stringify(parsed))
      } catch {
        throw new VaultStoreUnavailableError()
      }
    },
    transaction: async (run) => {
      const previous = tail
      const next = (async () => {
        try {
          await previous
        } catch {
          /* The previous caller owns its refusal. */
        }
        const held = await holdVaultStartupLock(
          vaultPeerExecutable(context.installRoot),
          path.join(context.dataDir, 'audit.lock'),
        )
        try {
          return await run()
        } finally {
          await held.release()
        }
      })()
      tail = next
      return await next
    },
  }
  return new VaultAuditLog(directory, anchors)
}

/** Installed factory for POSIX management and first-party reads; no workspace-loaded module. */
export async function createVaultBrokerBindings(
  context: VaultBrokerContext,
  overrides: Pick<VaultBrokerBindings, 'keyring' | 'slots'> & { readonly home?: string } = {},
): Promise<VaultBrokerBindings> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error(UI_TEXT.vault.noAccess)
  let keyring = overrides.keyring
  if (!keyring) {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    keyring = (service, account) =>
      new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
  }
  const helper = vaultPeerExecutable(context.installRoot)
  const isHost = async (pid: number, hostId: string, hostSession?: string) => {
    const identity = await vaultProcessIdentity(helper, pid)
    return (
      identity !== null &&
      identity.userId === String(process.getuid?.()) &&
      (await isPosixVaultHost(context.runDirectory, identity, hostId, hostSession))
    )
  }
  let repository: VaultStoreRepository | undefined
  const scrub = async (text: string) => {
    if (!repository) throw new Error(UI_TEXT.vaultScrubUnavailable)
    const store = repository.current()
    const values: Uint8Array[] = []
    let scrubber: VaultScrubber | undefined
    try {
      const items = await store.list()
      for (const metadata of items) {
        const item = await store.read(metadata.id)
        try {
          for (const value of Object.values(item.material))
            if (value instanceof Uint8Array) values.push(Uint8Array.from(value))
        } finally {
          eraseVaultMaterial(item.material)
        }
      }
      scrubber = new VaultScrubber(values)
      return scrubber.scrub(text)
    } finally {
      scrubber?.dispose()
      for (const value of values) value.fill(0)
    }
  }
  return {
    keyring,
    ...(overrides.slots && { slots: overrides.slots }),
    home: overrides.home ?? homedir(),
    lockOnScreenLock: false,
    identity: {
      verifyHost: (peer) => isHost(peer.processId, peer.hostId),
      verifyLaunched: async (peer, registration) =>
        registration.requester.peerProcessId === peer.processId &&
        registration.requester.hostId === peer.hostId &&
        (await isHost(peer.processId, peer.hostId)),
    },
    identify: async (identity, hostId, hostSession) => {
      if (
        !(await isPosixVaultHost(context.runDirectory, identity, hostId, hostSession)) ||
        !(await isHost(identity.processId, hostId, hostSession))
      )
        throw new Error(UI_TEXT.vault.noAccess)
      return {
        peer: { hostId, userId: identity.userId, processId: identity.processId, ui: true },
        requester: null,
        firstParty: true,
        manage: true,
      }
    },
    audit: (current) => {
      repository = current
      let log: { vaultId: string; value: VaultAuditLog } | undefined
      const get = () => {
        const vaultId = current.current().vaultId
        if (log?.vaultId !== vaultId) {
          log?.value.close()
          log = { vaultId, value: auditLog(context, current, keyring) }
        }
        return log.value
      }
      return {
        openWriter: async (key) => await get().openWriter(key),
        open: async (key) => {
          await get().open(key)
        },
        append: async (record) => {
          await get().append(record)
        },
        read: async () => await get().read(),
        close: () => {
          log?.value.close()
          log = undefined
        },
      }
    },
    onAuditFailure: () => {
      process.stderr.write('vault-audit-refused\n')
    },
    // T/X/S/O transport owners supply provenance and execution before agent use is enabled.
    ceiling: () => 'none',
    taint: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    lifetime: (_requester, socket) => ({
      close: () => {
        socket.destroy()
      },
      terminate: () => {
        socket.destroy()
        return Promise.resolve(false)
      },
    }),
    perform: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    scrub,
  }
}
