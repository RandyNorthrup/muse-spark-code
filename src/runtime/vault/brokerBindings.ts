import process from 'node:process'
import path from 'node:path'
import { homedir } from 'node:os'
import * as z from 'zod/mini'
import { VaultAuditLog, type VaultAuditAnchorPort } from '../../core/vault/broker/audit'
import { VaultError, eraseVaultMaterial } from '../../core/vault/crypto'
import { VaultStoreUnavailableError } from '../../core/vault/broker/ports'
import { UnixVaultPrivateFiles, isVaultFileMissing } from '../../core/vault/broker/files'
import { vaultAuditRecordSchema } from '../../shared/vault'
import { VaultScrubber } from '../../core/vault/scrub'
import type { VaultStoreRepository } from '../../core/vault/broker/repository'
import {
  KEYRING_SERVICE,
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_AUDIT_MAX_BYTES,
} from '../../shared/constants'
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
  const pendingAccount = `vault-audit-pending-v1:${vaultId}`
  const directory = path.join(context.dataDir, 'audit', vaultId)
  let tail: Promise<unknown> = Promise.resolve()
  const readProtected = async (name: string): Promise<string | null | undefined> => {
    try {
      return await keyring(KEYRING_SERVICE, name).getPassword()
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }
  const checkpoint = (value: string | null | undefined) => {
    const zero = '0'.repeat(VAULT_LIMITS.sha256Hex)
    return auditAnchorSchema.parse(
      value == null
        ? { generation: 0, hash: zero, baseGeneration: 0, baseHash: zero }
        : JSON.parse(value),
    )
  }
  const writeProtected = async (
    record: ReturnType<typeof auditAnchorSchema.parse>,
  ): Promise<void> => {
    try {
      await keyring(KEYRING_SERVICE, account).setPassword(JSON.stringify(record))
      await keyring(KEYRING_SERVICE, pendingAccount).deletePassword()
    } catch {
      throw new VaultStoreUnavailableError()
    }
  }
  const pendingSchema = z
    .strictObject({ previous: auditAnchorSchema, next: auditAnchorSchema })
    .check(z.refine((value) => value.next.generation === value.previous.generation + 1))
  const anchors: VaultAuditAnchorPort = {
    read: async () => {
      let record = checkpoint(await readProtected(account))
      const pendingValue = await readProtected(pendingAccount)
      const snapshot = await repository.current().exportSnapshot()
      if (pendingValue != null) {
        const pending = pendingSchema.parse(JSON.parse(pendingValue))
        const isPrevious = JSON.stringify(record) === JSON.stringify(pending.previous)
        const isNext = JSON.stringify(record) === JSON.stringify(pending.next)
        const slots = snapshot.slots
        const isStorePrevious =
          slots.auditGeneration === pending.previous.generation &&
          slots.auditHead === pending.previous.hash
        const isStoreNext =
          slots.auditGeneration === pending.next.generation && slots.auditHead === pending.next.hash
        if (
          (!isPrevious && !isNext) ||
          (!isStorePrevious && !isStoreNext) ||
          (isNext && !isStoreNext)
        )
          throw new VaultError('rollback')
        if (isStorePrevious) {
          let bytes: Buffer
          try {
            bytes = await new UnixVaultPrivateFiles().read(
              path.join(directory, 'audit.v1.jsonl'),
              VAULT_AUDIT_MAX_BYTES,
            )
          } catch (error: unknown) {
            if (!isVaultFileMissing(error)) throw error
            bytes = Buffer.alloc(0)
          }
          const lines = bytes.toString('utf8').trimEnd().split('\n')
          const last = lines.at(-1)
          const physical = last ? vaultAuditRecordSchema.parse(JSON.parse(last)) : null
          // An authorized prepare that never appended (death or cancellation) changes no head.
          if (physical?.hash !== pending.next.hash) {
            if (physical !== null && physical.hash !== pending.previous.hash)
              throw new VaultError('rollback')
            try {
              await keyring(KEYRING_SERVICE, pendingAccount).deletePassword()
            } catch {
              throw new VaultStoreUnavailableError()
            }
            return record
          }
          // The protected intent binds this exact physical head; core still verifies every MAC.
          await repository.current().commitAudit(pending.next.generation, pending.next.hash)
        }
        await writeProtected(pending.next)
        record = pending.next
      } else if (
        snapshot.slots.auditGeneration !== record.generation ||
        snapshot.slots.auditHead !== record.hash
      ) {
        throw new VaultError('rollback')
      }
      return record
    },
    prepare: async (record) => {
      const parsed = auditAnchorSchema.parse(record)
      const previous = checkpoint(await readProtected(account))
      const pending = pendingSchema.parse({ previous, next: parsed })
      // Protected intent precedes both physical append and the store update.
      try {
        await keyring(KEYRING_SERVICE, pendingAccount).setPassword(JSON.stringify(pending))
      } catch {
        throw new VaultStoreUnavailableError()
      }
    },
    write: async (record) => {
      const parsed = auditAnchorSchema.parse(record)
      await repository.current().commitAudit(parsed.generation, parsed.hash)
      await writeProtected(parsed)
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
