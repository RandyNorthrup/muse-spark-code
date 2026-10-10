import path from 'node:path'
import { createRequire } from 'node:module'
// Lazy Node bundles keep their own language state; the installed runtime calls this before use.
export { setUiText } from '../../shared/l10n/text'
import { isCredentialVariable } from '../../core/credentialEnvironment'
import * as z from 'zod/mini'
import { VaultBroker } from '../../core/vault/broker/broker'
import { VaultChannelServer, type VaultChannelDeps } from '../../core/vault/broker/channel'
import { VaultManagement } from '../../core/vault/broker/management'
import {
  VaultStoreRepository,
  VaultSlotUnlock,
  type VaultSlotProvider,
} from '../../core/vault/broker/repository'
import { VaultLockEpoch } from '../../core/vault/broker/epoch'
import { UnixVaultPrivateFiles, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import { UnixVaultPeerVerifier, type VaultPeerVerifier } from '../../core/vault/broker/peer'
import { type VaultBrokerDeps } from '../../core/vault/broker/ports'
import { NodeVaultFiles } from '../../core/vault/store'
import { KeyringVaultAnchor } from './keyringAnchor'
import { type KeyringEntryFactory } from '../keyStore'
import { PosixVaultSlots } from './slots/posixVaultSlots'
import { startVaultBrokerProcess } from './brokerProcess'
import { vaultPeerExecutable, vaultProcessIdentity, vaultSocketDescriptors } from './posixNative'
import {
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_IDLE_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from '../../shared/constants'

const contextSchema = z.strictObject({
  dataDir: z.string().check(
    z.minLength(1),
    z.refine((value) => path.isAbsolute(value)),
  ),
  runDirectory: z.string().check(
    z.minLength(1),
    z.refine((value) => path.isAbsolute(value)),
  ),
  installRoot: z.string().check(
    z.minLength(1),
    z.refine((value) => path.isAbsolute(value)),
  ),
  userSession: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})
export type VaultBrokerContext = z.infer<typeof contextSchema>
/** Trusted runtime supplies execution, identity and scrub bindings; no substitute or empty success. */
export interface VaultBrokerBindings {
  readonly identity: VaultBrokerDeps['identity']
  readonly audit: (repository: VaultStoreRepository) => VaultBrokerDeps['audit']
  readonly onAuditFailure: VaultBrokerDeps['onAuditFailure']
  readonly identify: VaultChannelDeps['identify']
  readonly ceiling: VaultChannelDeps['ceiling']
  readonly lifetime: VaultChannelDeps['lifetime']
  readonly perform: VaultChannelDeps['perform']
  readonly taint: VaultChannelDeps['taint']
  readonly scrub: VaultChannelDeps['scrub']
  readonly importFile: (repository: VaultStoreRepository, file: string) => Promise<void>
  readonly slots?: VaultSlotProvider
  readonly keyring?: KeyringEntryFactory
  readonly peers?: VaultPeerVerifier
  readonly privateFiles?: VaultPrivateFilesPort
  readonly idleMs?: number
  readonly lockOnScreenLock: boolean
}

/** Runs inside the broker process. Composes part A's blocks, never a second store/management/anchor. */
export async function createVaultBrokerProcess(
  input: VaultBrokerContext,
  bindings: VaultBrokerBindings,
) {
  if (bindings.lockOnScreenLock && !bindings.slots) throw new Error(UI_TEXT.vault.noAccess)
  const context = contextSchema.parse(input)
  const helper = vaultPeerExecutable(context.installRoot)
  const owned: { broker?: VaultBroker; management?: VaultManagement; unsubscribe?: () => void } = {}
  return await startVaultBrokerProcess({
    runDirectory: context.runDirectory,
    userSession: context.userSession,
    helper,
    ...(bindings.idleMs !== undefined && { idleMs: bindings.idleMs }),
    lock: async () => {
      try {
        const pending = await owned.management?.snapshot()
        if (pending?.setupId) await owned.management?.cancelSetup(pending.setupId)
      } finally {
        await owned.broker?.lock()
      }
    },
    dispose: async () => {
      owned.unsubscribe?.()
      await owned.broker?.dispose()
    },
    channel: async (location, listener) => {
      const privateFiles = bindings.privateFiles ?? new UnixVaultPrivateFiles()
      const files = new NodeVaultFiles(context.dataDir, VAULT_LIMITS.frameBytes)
      let keyring = bindings.keyring
      if (!keyring) {
        const { AsyncEntry } = await import('@napi-rs/keyring')
        keyring = (service, account) =>
          new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
      }
      const anchor = new KeyringVaultAnchor(keyring)
      const repository = new VaultStoreRepository(files, anchor)
      const slots = bindings.slots ?? new PosixVaultSlots()
      const unlock = new VaultSlotUnlock(files, anchor, slots)
      const clock = { now: () => Date.now() }
      const peers =
        bindings.peers ??
        new UnixVaultPeerVerifier(
          helper,
          async (pid) => {
            const identity = await vaultProcessIdentity(helper, pid)
            if (!identity) throw new Error(UI_TEXT.vault.noAccess)
            return identity
          },
          vaultSocketDescriptors,
        )
      const managementRef: { current?: VaultManagement } = {}
      const broker = new VaultBroker({
        clock,
        repository,
        unlock,
        epoch: new VaultLockEpoch(context.runDirectory, privateFiles),
        audit: bindings.audit(repository),
        identity: bindings.identity,
        idleMs: VAULT_IDLE_MINUTES * MILLISECONDS_PER_MINUTE,
        lockOnScreenLock: bindings.lockOnScreenLock,
        firstPartyOnly: false,
        onApproval: (request) => managementRef.current?.noteApproval(request),
        onLocked: (epoch) => managementRef.current?.noteLocked(epoch),
        onRevoked: (requesterId, grantId) =>
          managementRef.current?.noteRevoked(requesterId, grantId),
        onAuditFailure: bindings.onAuditFailure,
        scrub: bindings.scrub,
      })
      const manage = new VaultManagement({
        files,
        anchor,
        repository,
        unlock,
        slots,
        broker,
        clock,
        importFile: async (file) => {
          await bindings.importFile(repository, file)
        },
      })
      managementRef.current = manage
      const management = manage
      const unsubscribe = repository.subscribe(() => {
        management.noteChanged()
      })
      owned.broker = broker
      owned.management = management
      owned.unsubscribe = unsubscribe
      await broker.synchronizeEpoch()
      return new VaultChannelServer({
        broker,
        peers,
        manage: management,
        listener,
        bootToken: location.bootToken,
        brokerId: location.lock.brokerId,
        identify: bindings.identify,
        ceiling: bindings.ceiling,
        lifetime: bindings.lifetime,
        perform: bindings.perform,
        taint: bindings.taint,
        scrub: bindings.scrub,
      })
    },
  })
}

/** Internal child entry: only the installed sibling runtime may supply the trusted bindings. */
async function main(): Promise<void> {
  for (const name of Object.keys(process.env))
    if (isCredentialVariable(name)) Reflect.deleteProperty(process.env, name)
  const context = contextSchema.parse(JSON.parse(process.argv[2] ?? 'null'))
  if (path.resolve(context.installRoot, 'dist') !== path.resolve(__dirname))
    throw new Error(UI_TEXT.vault.noAccess)
  // Installed sibling module is a typed build boundary; validate its export before calling (PLAN §8).
  const runtime = createRequire(__filename)(path.join(__dirname, 'vaultRuntime.js')) as {
    createVaultBrokerBindings?: (context: VaultBrokerContext) => Promise<VaultBrokerBindings>
  }
  if (typeof runtime.createVaultBrokerBindings !== 'function')
    throw new Error(UI_TEXT.vault.brokerBlocked)
  const processHandle = await createVaultBrokerProcess(
    context,
    await runtime.createVaultBrokerBindings(context),
  )
  const stop = (): void => {
    void processHandle.close().catch(() => {
      process.exitCode = 1
    })
  }
  process.stdout.write('vault-broker-ready\n')
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await processHandle.closed
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('vault-broker-refused\n')
    process.exitCode = 1
  })
}
