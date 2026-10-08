// M100 phase 2 (lane W): production binding for the lazy Devices bundle.
// The extension host owns storage and identity; lane K (owner binding, M109
// vault) owns execution with its worker driver, policy approval, the channel
// source and the listener facts. The driver stays out of this bundle on
// purpose: all three native drivers with M96's environment record exceed the
// unchanged `dist/devices.js` cap, so K supplies the unified selector's
// choice with its execution binding. Every K-owned port below refuses with
// an explicit typed error until K binds it — nothing returns an empty success.
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DEVICE_LIMITS } from '../../shared/constants'
import { DevicePairingError } from '../../core/devices/pairing'
import type { AttemptJournalOwner } from '../../core/devices/attemptJournal'
import type { SecretStore } from '../auth/credentialStore'
import type { Logger } from '../logger'
import type { DeviceChannelPort } from './deviceChannel'
import type { DeviceServiceDeps } from './deviceEntry'
import type { DevicePairingDeps } from './devicePairing'
import type { DeviceReceiverExecution, DeviceReceiverPolicy } from './deviceReceiver'
import type { DeviceExecutionHost } from './deviceSecrets'
import type { DeviceStorageProtection } from '../../core/devices/storageProtection'
import type { DeviceStore } from './deviceStore'
import type { DeviceSecrets } from './deviceSecrets'
import type { AttemptJournal } from '../../core/devices/attemptJournal'

/**
 * The bundle surface the production builder constructs through, never
 * around. Structural statics (not the concrete classes) so tests can prove
 * the binding with fakes and no cast; the real bundle satisfies this shape.
 */
export interface DeviceProductionBundle {
  readonly DeviceStore: {
    open(
      directory: string,
      protection: DeviceStorageProtection | undefined,
      platform: NodeJS.Platform,
    ): Promise<DeviceStore>
    create(
      directory: string,
      deviceId: string,
      protection: DeviceStorageProtection | undefined,
      platform: NodeJS.Platform,
    ): Promise<DeviceStore>
  }
  readonly DeviceSecrets: new (store: SecretStore, host: DeviceExecutionHost) => DeviceSecrets
  readonly AttemptJournal: {
    create(
      directory: string,
      owner: AttemptJournalOwner,
      protection: DeviceStorageProtection | undefined,
      platform: NodeJS.Platform,
    ): Promise<AttemptJournal>
    open(
      directory: string,
      owner: AttemptJournalOwner,
      protection: DeviceStorageProtection | undefined,
      platform: NodeJS.Platform,
    ): Promise<AttemptJournal>
  }
  readonly startWindowsStorageProtection: (options: {
    readonly directory: string
    readonly systemRoot: string
    readonly extensionPath: string
  }) => Promise<{
    readonly protection: DeviceStorageProtection
    readonly dispose: () => void
  }>
}

/**
 * Lane-K-owned ports: remote execution, local approval policy, the channel
 * source and the listener facts. K binds them after its owner-validity
 * check; until then every use refuses explicitly.
 */
export interface DeviceLanePorts {
  readonly setup: DevicePairingDeps['setup']
  readonly otherAction: DevicePairingDeps['otherAction']
  readonly execution: DeviceReceiverExecution
  readonly policy: Omit<DeviceReceiverPolicy, 'currentGrant'>
  readonly source: DeviceChannelPort
}

const laneKPrecondition = 'lane K owner binding (M109 vault)'

function refusedHost(): Promise<never> {
  return Promise.reject(new DevicePairingError('unsupported-host'))
}

/**
 * The K placeholder the lead replaces: every security-relevant use refuses
 * with typed `unsupported-host` (mapped to the Devices recovery UI) instead
 * of succeeding without an owner check. Paid use stays off; teardown never
 * throws.
 */
export function unboundDeviceLanePorts(log: Logger): DeviceLanePorts {
  log.error(`Devices lane ports unbound: ${laneKPrecondition} has not bound them yet`)
  return {
    setup: () => refusedHost(),
    otherAction: () => refusedHost(),
    execution: {
      retain: () => refusedHost(),
      admit: () => refusedHost(),
    },
    policy: {
      assertAllowed: () => refusedHost(),
      approve: () => refusedHost(),
      assertPaidBinding: () => refusedHost(),
      paidGate: {
        isOn: (_feature) => false,
      },
      paidConsent: { allows: () => Promise.resolve(false) },
    },
    source: {
      connected: () => {
        throw new DevicePairingError('unsupported-host')
      },
      receive: () => refusedHost(),
      disconnected: () => {
        // Teardown notifications must never throw.
      },
    },
  }
}

export interface DeviceProductionContext {
  /** The qualified editor's machine-scoped Devices directory. */
  readonly storageDirectory: string
  /** The shipped-helper directory the Windows storage binding compiles in. */
  readonly helperDirectory: string
  readonly systemRoot: string | undefined
  /** The extension folder that ships `native/windows/`. */
  readonly extensionPath: string
  readonly secrets: SecretStore
  readonly log: Logger
  readonly platform?: NodeJS.Platform
  readonly now?: () => number
  readonly randomId?: () => string
}

export interface DeviceProductionDeps extends Omit<
  DeviceServiceDeps,
  'snapshot' | 'publish' | 'report'
> {
  /** Ends the Windows storage helper owned by this preparation. */
  readonly dispose: () => void
}

const localHost: DeviceExecutionHost = {
  ui: 'desktop',
  remoteName: undefined,
  execution: 'local',
  secretLocation: 'execution-host',
}

async function assertJournalOwner(directory: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') return
  if (typeof process.getuid !== 'function') throw new DevicePairingError('storage')
  const ownership = await stat(directory)
  if (ownership.uid !== process.getuid()) throw new DevicePairingError('storage')
}

/**
 * Binds every production authority W owns: the pairing store (opened or
 * created once), the attempt journal with a real owner check, SecretStorage
 * secrets on the local host and Windows storage protection. Construction
 * grants no listener or execution; the tab supplies snapshot/publish/report
 * and K supplies its ports with the worker driver.
 */
export async function openDeviceProductionDeps(
  bundle: DeviceProductionBundle,
  context: DeviceProductionContext,
  ports: DeviceLanePorts,
): Promise<DeviceProductionDeps> {
  const platform = context.platform ?? process.platform
  const now = context.now ?? Date.now
  const randomId =
    context.randomId ?? (() => randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'))
  const owned: (() => void)[] = []
  const scope = {
    own(dispose: () => void): void {
      owned.push(dispose)
    },
  }
  try {
    // Windows storage protection rides this preparation's scope; other
    // platforms use POSIX owner/mode checks and directory fsync. A missing
    // system root refuses explicitly before any helper starts.
    let protection: DeviceStorageProtection | undefined
    if (platform === 'win32') {
      if (context.systemRoot === undefined) throw new DevicePairingError('storage')
      const binding = await bundle.startWindowsStorageProtection({
        directory: context.helperDirectory,
        systemRoot: context.systemRoot,
        extensionPath: context.extensionPath,
      })
      scope.own(binding.dispose)
      protection = binding.protection
    }
    const pairingDirectory = path.join(context.storageDirectory, 'pairing')
    let store
    try {
      store = await bundle.DeviceStore.open(pairingDirectory, protection, platform)
    } catch {
      // First provisioning claims the directory; an existing (including
      // damaged) store refuses the create below instead of resetting.
      store = await bundle.DeviceStore.create(pairingDirectory, randomId(), protection, platform)
    }
    const journalDirectory = path.join(context.storageDirectory, 'attempts')
    const owner: AttemptJournalOwner = {
      assertOwner: () => assertJournalOwner(context.storageDirectory, platform),
    }
    let journal
    try {
      journal = await bundle.AttemptJournal.create(journalDirectory, owner, protection, platform)
    } catch {
      journal = await bundle.AttemptJournal.open(journalDirectory, owner, protection, platform)
    }
    const secrets = new bundle.DeviceSecrets(context.secrets, localHost)
    return {
      store,
      secrets,
      host: localHost,
      now,
      receiverIncarnationId: randomId(),
      setup: ports.setup,
      otherAction: ports.otherAction,
      journal,
      execution: ports.execution,
      policy: ports.policy,
      source: ports.source,
      dispose(): void {
        for (const dispose of owned.splice(0)) dispose()
      },
    }
  } catch (error) {
    for (const dispose of owned.splice(0)) dispose()
    throw error
  }
}
