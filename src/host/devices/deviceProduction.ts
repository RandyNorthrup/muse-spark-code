// M100 phase 2 (lane W): production binding for the lazy Devices bundle.
// The extension host owns storage and identity; lane K (owner binding, M109
// vault) owns execution with its worker driver, policy approval, the channel
// source and the listener facts. The driver stays out of this bundle on
// purpose: all three native drivers with M96's environment record exceed the
// unchanged `dist/devices.js` cap, so K supplies the unified selector's
// choice with its execution binding. Every K-owned port below refuses with
// an explicit typed error until K binds it — nothing returns an empty success.
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, rename, rmdir, stat } from 'node:fs/promises'
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
import { assertLocalDeviceHost, type DeviceExecutionHost } from './deviceSecrets'
import type { DeviceStorageProtection } from '../../core/devices/storageProtection'
import type { DeviceStore } from './deviceStore'
import type { DeviceSecrets } from './deviceSecrets'
import type { AttemptJournal } from '../../core/devices/attemptJournal'

/**
The bundle surface the production builder constructs through, never
around. Structural statics (not the concrete classes) so tests can prove
the binding with fakes and no cast; the real bundle satisfies this shape.
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
Lane-K-owned ports: remote execution, local approval policy, the channel
source and the listener facts. K binds them after its owner-validity
check; until then every use refuses explicitly.
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
The K placeholder the lead replaces: every security-relevant use refuses
with typed `unsupported-host` (mapped to the Devices recovery UI) instead
of succeeding without an owner check. Paid use stays off; teardown never
throws.
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
  /** The qualified editor's machine-scoped Devices directory; provisioned on first use. */
  readonly storageDirectory: string
  /** The shipped-helper directory the Windows storage binding compiles in. */
  readonly helperDirectory: string
  readonly systemRoot: string | undefined
  /** The extension folder that ships `native/windows/`. */
  readonly extensionPath: string
  readonly secrets: SecretStore
  /**
  The editor's own qualification of this extension host (D80): UI kind,
  remote name, where the extension runs and where its SecretStorage lives.
  Never assumed: a remote, web or headless host refuses before any storage.
  */
  readonly host: DeviceExecutionHost
  readonly log: Logger
  readonly platform?: NodeJS.Platform
  readonly now?: () => number
  readonly randomId?: () => string
  /** This process's user id for the POSIX journal owner check; Node's own by default. */
  readonly userId?: () => number | undefined
}

export interface DeviceProductionDeps extends Omit<
  DeviceServiceDeps,
  'snapshot' | 'publish' | 'report'
> {
  /**
  Closes the pairing store (releasing its `.pairing.lock`), then ends the
  Windows storage helper owned by this preparation. Each runs once.
  */
  readonly dispose: () => Promise<void>
}

function processUserId(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined
}

async function assertJournalOwner(
  directory: string,
  platform: NodeJS.Platform,
  userId: () => number | undefined,
): Promise<void> {
  if (platform === 'win32') return
  const uid = userId()
  if (uid === undefined) throw new DevicePairingError('storage')
  const ownership = await stat(directory)
  if (ownership.uid !== uid) throw new DevicePairingError('storage')
}

const PRIVATE_DIRECTORY_MODE = Number('0o700')

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** Any missing parent of the Devices folder, owner-only where POSIX modes apply. */
async function provisionParents(directory: string): Promise<void> {
  try {
    await mkdir(path.dirname(directory), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  } catch {
    throw new DevicePairingError('storage')
  }
}

async function removeStage(stage: string): Promise<void> {
  try {
    await rmdir(stage)
  } catch {
    return
  }
}

/**
Creates the Devices folder itself, exclusively and already private, so no
failure or race can leave it half made. POSIX: `mkdir` with mode `0700`.
Windows: a uniquely named sibling is created, claimed with `secureFresh`
and renamed into place; Windows refuses to rename a folder onto an
existing one. A Devices folder this call did not create is never claimed
or repaired: the store and journal check it, and refuse one that is not
private.
*/
async function provisionDevicesDirectory(
  directory: string,
  protection: DeviceStorageProtection | undefined,
  randomId: () => string,
): Promise<void> {
  if (protection === undefined) {
    try {
      await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE })
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw new DevicePairingError('storage')
    }
    return
  }
  try {
    await lstat(directory)
    return
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw new DevicePairingError('storage')
  }
  const parent = path.dirname(directory)
  const stage = path.join(parent, `.${path.basename(directory)}-${randomId()}.stage`)
  try {
    await mkdir(stage)
  } catch {
    throw new DevicePairingError('storage')
  }
  let isStaged = true
  try {
    await protection.secureFresh(stage, true)
    try {
      await rename(stage, directory)
      isStaged = false
    } catch {
      // Another creator got there first: that folder is validated, never claimed.
    }
    if (!isStaged) await protection.syncDirectory(parent)
  } catch {
    throw new DevicePairingError('storage')
  } finally {
    // Only this call's own empty stage; never recursive. A stage left behind
    // is empty and harmless; the claim never depended on removing it.
    if (isStaged) await removeStage(stage)
  }
}

/**
Binds every production authority W owns: the private Devices folder, the
pairing store (opened or created once), the attempt journal with a real
owner check, SecretStorage secrets on the qualified host and Windows
storage protection. Construction grants no listener or execution; the tab
supplies snapshot/publish/report and K supplies its ports with the worker
driver. Whatever it opened is closed again if any later step fails.
*/
export async function openDeviceProductionDeps(
  bundle: DeviceProductionBundle,
  context: DeviceProductionContext,
  ports: DeviceLanePorts,
): Promise<DeviceProductionDeps> {
  // D80: Remote SSH/Tunnels, WSL, containers, web and headless hosts wait for
  // their own host/key-location qualification. Refuse before any storage.
  assertLocalDeviceHost(context.host)
  const platform = context.platform ?? process.platform
  const now = context.now ?? Date.now
  const userId = context.userId ?? processUserId
  const randomId =
    context.randomId ?? (() => randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'))
  // Released last-in first-out: the store's close still needs the helper.
  const owned: (() => Promise<void> | void)[] = []
  const release = async (): Promise<void> => {
    for (const dispose of owned.splice(0).toReversed()) {
      try {
        await dispose()
      } catch {
        context.log.error('Devices storage cleanup failed')
      }
    }
  }
  try {
    await provisionParents(context.storageDirectory)
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
      owned.push(binding.dispose)
      protection = binding.protection
    }
    await provisionDevicesDirectory(context.storageDirectory, protection, randomId)
    const pairingDirectory = path.join(context.storageDirectory, 'pairing')
    let store: DeviceStore
    try {
      store = await bundle.DeviceStore.open(pairingDirectory, protection, platform)
    } catch {
      // First provisioning claims the directory; an existing (including
      // damaged or still locked) store refuses the create below instead of
      // resetting.
      store = await bundle.DeviceStore.create(pairingDirectory, randomId(), protection, platform)
    }
    owned.push(() => store.close())
    const journalDirectory = path.join(context.storageDirectory, 'attempts')
    const owner: AttemptJournalOwner = {
      assertOwner: () => assertJournalOwner(context.storageDirectory, platform, userId),
    }
    let journal
    try {
      journal = await bundle.AttemptJournal.create(journalDirectory, owner, protection, platform)
    } catch {
      journal = await bundle.AttemptJournal.open(journalDirectory, owner, protection, platform)
    }
    const secrets = new bundle.DeviceSecrets(context.secrets, context.host)
    return {
      store,
      secrets,
      host: context.host,
      now,
      receiverIncarnationId: randomId(),
      setup: ports.setup,
      otherAction: ports.otherAction,
      journal,
      execution: ports.execution,
      policy: ports.policy,
      source: ports.source,
      dispose: release,
    }
  } catch (error) {
    await release()
    throw error
  }
}
