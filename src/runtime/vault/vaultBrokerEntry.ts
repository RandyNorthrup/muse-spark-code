import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { configureResources } from '../../core/resources/admission'
import type * as ResourceGovernor from '../../core/resources/resourceGovernorEntry'
import { uiLocale } from '../../shared/l10n/text'
import { createRequire } from 'node:module'
// Lazy Node bundles keep their own language state; the installed runtime calls this before use.
export { setUiText } from '../../shared/l10n/text'
import { isCredentialVariable } from '../../core/credentialEnvironment'
import * as z from 'zod/mini'
import { VaultBroker } from '../../core/vault/broker/broker'
import {
  VaultChannelServer,
  type VaultChannelDeps,
  type VaultSecuredListenerPort,
} from '../../core/vault/broker/channel'
import { VaultManagement } from '../../core/vault/broker/management'
import {
  VaultStoreRepository,
  VaultSlotUnlock,
  type VaultAnchorPort,
  type VaultSlotProvider,
} from '../../core/vault/broker/repository'
import type { VaultBrokerLocation } from '../../core/vault/broker/discovery'
import type { VaultSlotRecord } from '../../shared/vault'
import { VaultLockEpoch } from '../../core/vault/broker/epoch'
import { UnixVaultPrivateFiles, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import { UnixVaultPeerVerifier, type VaultPeerVerifier } from '../../core/vault/broker/peer'
import { type VaultBrokerDeps } from '../../core/vault/broker/ports'
import { NodeVaultFiles } from '../../core/vault/store'
import { KeyringVaultAnchor } from './keyringAnchor'
import { type KeyringEntryFactory } from '../keyStore'
import { LinuxVaultSlots } from './slots/linuxVaultSlots'
import { MacVaultSlots } from './slots/macVaultSlots'
import { WindowsVaultSlots } from './slots/windowsVaultSlots'
import { macVaultTransport } from './slots/macVaultTransport'
import { macVaultSlotExecutable } from './posixNative'
import { startVaultBrokerProcess, type VaultBrokerProcessOptions } from './brokerProcess'
import {
  startWindowsVaultBrokerOnServe,
  startWindowsVaultBrokerProcess,
  type WindowsVaultBrokerServe,
} from './windowsBrokerProcess'
import { WindowsPipeFiles, startWindowsPipeServe, windowsVaultPipeName } from './windowsPipeRelay'
import { windowsBrokerPlatform, type WindowsBrokerPlatform } from './windowsHost'
import { VaultError } from '../../core/vault/crypto'
import { vaultPeerExecutable, vaultProcessIdentity, vaultSocketDescriptors } from './posixNative'
import { bumpVaultEpoch } from './epochContender'
import {
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_IDLE_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from '../../shared/constants'

const windowsHelperSchema = z.strictObject({
  file: z.string().check(
    z.minLength(1),
    z.refine((value) => path.win32.isAbsolute(value)),
  ),
  sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  powershell: z.string().check(
    z.minLength(1),
    z.refine((value) => path.win32.isAbsolute(value)),
  ),
  guardSource: z.string().check(z.minLength(1)),
})
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
  // Windows only: the host-built slot helper (DPAPI/CNG/Hello). The broker
  // refuses integrity failures instead of rebuilding: the host owns the build.
  windowsHelper: z.optional(windowsHelperSchema),
  // Windows only: the host-built pipe helper (serve/files relay). One file
  // never serves both roles: the pipe helper owns the pipe and the
  // owner-only files, the slot helper seals and unseals.
  pipeHelper: z.optional(windowsHelperSchema),
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
  /** The user's home: the management side imports only files discovered there. */
  readonly home: string
  readonly slots?: VaultSlotProvider
  readonly keyring?: KeyringEntryFactory
  /**
  The rollback anchor the bindings chose: the OS store where its binding
  is installed, the owner-only file anchor where it is not. Absent for
  foreign constructors, which keep the keyring anchor below.
  */
  readonly anchor?: VaultAnchorPort
  readonly peers?: VaultPeerVerifier
  readonly privateFiles?: VaultPrivateFilesPort
  readonly idleMs?: number
  readonly lockOnScreenLock: boolean
}

/**
This platform's slots: DPAPI/CNG/Hello on Windows, Keychain plus the
Secure Enclave on macOS, Secret Service plus the TPM2 sealed object on
Linux. The same selection serves every editor on the machine.
*/
export function defaultBrokerSlots(
  context: Pick<VaultBrokerContext, 'installRoot'> & {
    readonly windowsHelper?: z.infer<typeof windowsHelperSchema> | undefined
  },
  presenceRecords: () => Promise<readonly VaultSlotRecord[]>,
): VaultSlotProvider {
  switch (process.platform) {
    case 'win32': {
      const helper = context.windowsHelper
      if (!helper) throw new Error(UI_TEXT.vault.noAccess)
      return new WindowsVaultSlots(
        {
          ...helper,
          rebuild: () => {
            // The host owns the helper build; the broker refuses instead.
            return Promise.reject(new Error(UI_TEXT.vault.noAccess))
          },
          report: () => {
            process.stderr.write('vault-slot-rebuild-refused\n')
          },
        },
        { presenceRecords },
      )
    }
    case 'darwin': {
      return new MacVaultSlots(macVaultTransport(macVaultSlotExecutable(context.installRoot)), {
        presenceRecords,
      })
    }
    case 'linux': {
      return new LinuxVaultSlots()
    }
    default: {
      throw new Error(UI_TEXT.vault.noAccess)
    }
  }
}

/**
One channel body for every starter: the starter owns the pipe or socket
and the claim, and supplies exactly what differs (files, keyring, peers,
epoch contention and the listener). Everything else runs the same.
*/
/**
Locking a broker process cancels a pending setup first; disposal only
disposes. One pair for every starter.
*/
export function brokerProcessLock(owned: {
  broker?: VaultBroker
  management?: VaultManagement
}): Pick<VaultBrokerProcessOptions, 'lock' | 'dispose'> {
  return {
    lock: async () => {
      try {
        const pending = await owned.management?.snapshot()
        if (pending?.setupId) await owned.management?.cancelSetup(pending.setupId)
      } finally {
        await owned.broker?.lock()
      }
    },
    dispose: async () => {
      await owned.broker?.dispose()
    },
  }
}

export async function buildBrokerChannel(
  context: VaultBrokerContext,
  bindings: VaultBrokerBindings,
  owned: { broker?: VaultBroker; management?: VaultManagement },
  location: VaultBrokerLocation,
  parts: {
    readonly privateFiles: VaultPrivateFilesPort
    readonly files: NodeVaultFiles
    readonly keyring: KeyringEntryFactory
    readonly peers: VaultPeerVerifier
    bump(owner: { processId: number; startedAt: number }, authorize?: () => void): Promise<number>
    readonly listener: VaultSecuredListenerPort
  },
) {
  const anchor = bindings.anchor ?? new KeyringVaultAnchor(parts.keyring)
  const repository = new VaultStoreRepository(parts.files, anchor)
  // Presence proofs resolve this vault's own presence-tier records: the
  // supplier is bound after unlock exists, and fails closed before that.
  const unlockRef: { current?: VaultSlotUnlock } = {}
  const slots =
    bindings.slots ??
    defaultBrokerSlots(context, async () => {
      const records = await unlockRef.current?.records()
      return records ?? []
    })
  const unlock = new VaultSlotUnlock(parts.files, anchor, slots)
  unlockRef.current = unlock
  const clock = { now: () => Date.now() }
  const managementRef: { current?: VaultManagement } = {}
  const epoch = new VaultLockEpoch(context.runDirectory, parts.privateFiles)
  const initialEpoch = await epoch.current()
  const broker = new VaultBroker({
    clock,
    repository,
    unlock,
    epoch: {
      current: () => epoch.current(),
      bump: async (authorize) => {
        // Epoch is shared across session/protocol brokers; a contender
        // that finds the exclusive writer claimed decides by rule (dead
        // holder replaced, live holder awaited then refused with the
        // fixed reason), never an unhandled EEXIST. The owner is this
        // broker's startup-proven identity.
        return await parts.bump(
          {
            processId: location.lock.processId,
            startedAt: location.lock.startedAt,
          },
          authorize,
        )
      },
      subscribe: (listener) => {
        const unsubscribe = epoch.subscribe(listener)
        listener(initialEpoch)
        return unsubscribe
      },
    },
    audit: bindings.audit(repository),
    identity: bindings.identity,
    idleMs: VAULT_IDLE_MINUTES * MILLISECONDS_PER_MINUTE,
    lockOnScreenLock: bindings.lockOnScreenLock,
    firstPartyOnly: false,
    onApproval: (request) => managementRef.current?.noteApproval(request),
    onLocked: (epoch) => managementRef.current?.noteLocked(epoch),
    onRevoked: (requesterId, grantId) => managementRef.current?.noteRevoked(requesterId, grantId),
    onAuditFailure: bindings.onAuditFailure,
    scrub: bindings.scrub,
  })
  const manage = new VaultManagement({
    files: parts.files,
    anchor,
    repository,
    unlock,
    slots,
    broker,
    clock,
    home: bindings.home,
  })
  managementRef.current = manage
  const management = manage
  // Grant saves no longer fire subscribe(); committed changes already
  // reach watchers through VaultManagement's own subscribeCommitted
  // forwarding (RVCM1091A F3), so no second subscriber is added here:
  // one committed save must emit exactly one changed event (RVCM1091B2).
  owned.broker = broker
  owned.management = management
  await broker.status()
  return new VaultChannelServer({
    broker,
    peers: parts.peers,
    manage: management,
    listener: parts.listener,
    bootToken: location.bootToken,
    brokerId: location.lock.brokerId,
    identify: bindings.identify,
    ceiling: bindings.ceiling,
    lifetime: bindings.lifetime,
    perform: bindings.perform,
    taint: bindings.taint,
    scrub: bindings.scrub,
  })
}

/** Runs inside the broker process. Composes part A's blocks, never a second store/management/anchor. */
export async function createVaultBrokerProcess(
  input: VaultBrokerContext,
  bindings: VaultBrokerBindings,
  serve?: WindowsVaultBrokerServe,
) {
  if (bindings.lockOnScreenLock && !bindings.slots) throw new Error(UI_TEXT.vault.noAccess)
  const context = contextSchema.parse(input)
  if (process.platform === 'win32')
    return await createWindowsVaultBrokerProcess(context, bindings, serve)
  const helper = vaultPeerExecutable(context.installRoot)
  const owned: { broker?: VaultBroker; management?: VaultManagement } = {}
  return await startVaultBrokerProcess({
    runDirectory: context.runDirectory,
    dataDir: context.dataDir,
    userSession: context.userSession,
    helper,
    ...(bindings.idleMs !== undefined && { idleMs: bindings.idleMs }),
    ...brokerProcessLock(owned),
    channel: async (location, listener) => {
      const privateFiles = bindings.privateFiles ?? new UnixVaultPrivateFiles()
      const files = new NodeVaultFiles(context.dataDir, VAULT_LIMITS.frameBytes)
      let keyring = bindings.keyring
      if (!keyring) {
        const { AsyncEntry } = await import('@napi-rs/keyring')
        keyring = (service, account) =>
          new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
      }
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
      return await buildBrokerChannel(context, bindings, owned, location, {
        privateFiles,
        files,
        keyring,
        peers,
        bump: (owner, authorize) =>
          bumpVaultEpoch(helper, context.runDirectory, privateFiles, owner, authorize),
        listener,
      })
    },
  })
}

/** The Windows broker process: the serve helper owns the pipe the lock names. */
async function createWindowsVaultBrokerProcess(
  context: VaultBrokerContext,
  bindings: VaultBrokerBindings,
  serve?: WindowsVaultBrokerServe,
) {
  const helper = context.pipeHelper
  if (!helper) throw new Error(UI_TEXT.vault.noAccess)
  const owned: { broker?: VaultBroker; management?: VaultManagement } = {}
  const pipeExecutable = {
    ...helper,
    rebuild: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    report: () => {
      process.stderr.write('vault-slot-rebuild-refused\n')
    },
  }
  const options = {
    runDirectory: context.runDirectory,
    dataDir: context.dataDir,
    userSession: context.userSession,
    ...(bindings.idleMs !== undefined && { idleMs: bindings.idleMs }),
    ...brokerProcessLock(owned),
    pipeHelper: pipeExecutable,
    channel: async (
      location: VaultBrokerLocation,
      endpoint: {
        readonly listener: VaultSecuredListenerPort
        readonly peers: VaultPeerVerifier
        readonly platform: WindowsBrokerPlatform
      },
    ) => {
      const security = new WindowsPipeFiles(endpoint.platform.relay, () => new VaultError('io'))
      const files = new NodeVaultFiles(context.dataDir, VAULT_LIMITS.frameBytes, security, 'win32')
      let keyring = bindings.keyring
      if (!keyring) {
        const { AsyncEntry } = await import('@napi-rs/keyring')
        keyring = (service, account) => new AsyncEntry(service, account)
      }
      return await buildBrokerChannel(context, bindings, owned, location, {
        privateFiles: endpoint.platform.files,
        files,
        keyring,
        peers: bindings.peers ?? endpoint.peers,
        bump: (owner, authorize) =>
          endpoint.platform.bumpEpoch(context.runDirectory, owner, authorize),
        listener: endpoint.listener,
      })
    },
  }
  return serve
    ? await startWindowsVaultBrokerOnServe({ ...options, helperFile: helper.file }, serve)
    : await startWindowsVaultBrokerProcess(options)
}

/**
Entry-process shutdown: the signal handlers are armed before any startup
await, an early signal is buffered, and the buffer is re-checked after
startup (the same subscribe-then-recheck pattern as the guardian onLost
replay). A buffered signal closes the broker without announcing readiness.
The signal source is injectable for regression tests; production passes the
process object.
*/
type VaultBrokerProcessHandle = Pick<
  Awaited<ReturnType<typeof createVaultBrokerProcess>>,
  'close' | 'closed'
>

function streamError(): void {
  /* The socket, not these diagnostic streams, carries broker availability. */
}

export async function runVaultBrokerEntry(
  start: () => Promise<VaultBrokerProcessHandle>,
  signals: NodeJS.EventEmitter = process,
): Promise<void> {
  // Holder, not locals: a signal can arrive on any turn, so narrowing a
  // `let` at its definition site would misread both fields below.
  const lifecycle: { handle?: VaultBrokerProcessHandle; hasStopRequest: boolean } = {
    hasStopRequest: false,
  }
  const stop = (): void => {
    lifecycle.hasStopRequest = true
    const stopping = lifecycle.handle
    if (stopping !== undefined)
      void stopping.close().catch(() => {
        // A stop racing shutdown still fails the entry; the exit code is the launcher's record.
        process.exitCode = 1
      })
  }
  // Readiness/diagnostic writes must survive a launcher closing its reading ends.
  process.stdin.on('error', streamError)
  process.stdout.on('error', streamError)
  process.stderr.on('error', streamError)
  signals.on('SIGINT', stop)
  signals.on('SIGTERM', stop)
  try {
    const handle = await start()
    lifecycle.handle = handle
    if (lifecycle.hasStopRequest) {
      try {
        await handle.close()
      } catch {
        // A close after a stop request still fails the entry; the exit code is the launcher's record.
        process.exitCode = 1
      }
    } else {
      process.stdout.write('vault-broker-ready\n')
      await handle.closed
    }
  } finally {
    process.stdin.removeListener('error', streamError)
    process.stdout.removeListener('error', streamError)
    process.stderr.removeListener('error', streamError)
    signals.removeListener('SIGINT', stop)
    signals.removeListener('SIGTERM', stop)
  }
}

function resourceFailure(): void {
  process.stderr.write('vault-resource-refused\n')
}

/** A serve that failed to start stops best-effort; the startup failure is the one that throws. */
async function stopFailedServe(serve: { stop(): Promise<void> }): Promise<void> {
  try {
    await serve.stop()
  } catch {
    /* Startup already failed; the stop is best-effort. */
  }
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
    createVaultBrokerBindings?: (
      context: VaultBrokerContext,
      platform?: WindowsBrokerPlatform,
    ) => Promise<VaultBrokerBindings>
  }
  if (typeof runtime.createVaultBrokerBindings !== 'function')
    throw new TypeError(UI_TEXT.vault.brokerBlocked)
  const createBindings = runtime.createVaultBrokerBindings
  let disposeResources: (() => void) | undefined
  try {
    await runVaultBrokerEntry(async () => {
      // Same-build governor factory; validate its export before use (PLAN §8).
      const module = createRequire(__filename)(path.join(__dirname, 'resourceGovernor.js')) as Pick<
        typeof ResourceGovernor,
        'createResources'
      >
      if (typeof module.createResources !== 'function')
        throw new TypeError(UI_TEXT.vault.brokerBlocked)
      const resources = await module.createResources(
        {
          machineDir: path.dirname(context.dataDir),
          sleep: async (ms) => {
            await delay(ms)
          },
          onError: resourceFailure,
        },
        UI_TEXT,
        uiLocale(),
      )
      const disposeAdmission = configureResources({
        // The broker owns a separate creation registry; live editor registries must not overwrite it.
        registryFile: path.join(context.runDirectory, 'resource-created', 'registry.json'),
        inspect: () => ({}),
        onError: resourceFailure,
        admission: async (request, signal) => {
          await resources.status(signal)
          signal?.throwIfAborted()
          return await resources.admit(request, undefined, signal)
        },
      })
      disposeResources = () => {
        disposeAdmission()
        resources.dispose()
      }
      // Windows serves its pipe before the bindings exist: the serve
      // platform feeds the bindings, and the broker starts on that same
      // serve instead of serving twice. POSIX builds no serve here.
      if (process.platform === 'win32') {
        const pipe = context.pipeHelper
        if (!pipe) throw new Error(UI_TEXT.vault.noAccess)
        const pipeExecutable = {
          ...pipe,
          rebuild: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
          report: () => {
            process.stderr.write('vault-slot-rebuild-refused\n')
          },
        }
        const serve = await startWindowsPipeServe(pipeExecutable, windowsVaultPipeName())
        try {
          const platform = windowsBrokerPlatform(serve.relay, serve.ownerSid, pipe.file)
          return await createVaultBrokerProcess(
            context,
            await createBindings(context, platform),
            serve,
          )
        } catch (error: unknown) {
          // Startup already failed; the stop is best-effort and the startup failure still throws.
          await stopFailedServe(serve)
          throw error
        }
      }
      return await createVaultBrokerProcess(context, await createBindings(context))
    })
  } finally {
    disposeResources?.()
  }
}
if (require.main === module) {
  for (const stream of [process.stdin, process.stdout, process.stderr])
    stream.on('error', () => {
      /* Fixed failure diagnostics cannot depend on a surviving launcher's pipes. */
    })
  void main().catch(() => {
    // Startup failed before readiness: the fixed word on stderr and a nonzero exit are the record.
    process.stderr.write('vault-broker-refused\n')
    process.exitCode = 1
  })
}
