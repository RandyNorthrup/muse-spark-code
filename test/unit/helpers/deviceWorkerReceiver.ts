import path from 'node:path'
import { DeviceReceiver } from '../../../src/host/devices/deviceReceiver'
import type { DeviceReceiverExecution } from '../../../src/host/devices/deviceReceiver'
import { AttemptJournal } from '../../../src/core/devices/attemptJournal'
import type { DeviceGrant } from '../../../src/core/devices/grants'
import type {
  DeviceWorkerJob,
  DeviceWorkerLaunch,
} from '../../../src/host/devices/deviceWorkerHost'
import { privateDeviceRoot } from './deviceFixtures'
import { executionProtection } from './deviceExecutionFixtures'

/**
 * A real journal under its own protected root (owner-only on Windows, 0700 on POSIX),
 * which the production storage checks require. The caller removes `parent`.
 */
export async function protectedWorkerJournal(
  prefix: string,
): Promise<{ parent: string; journal: AttemptJournal }> {
  const parent = await privateDeviceRoot(prefix)
  const journal = await AttemptJournal.create(
    path.join(parent, 'durable'),
    { assertOwner: () => Promise.resolve() },
    executionProtection,
  )
  return { parent, journal }
}

/** A real receiver over a local test owner, with no peer or model calls. */
export async function openWorkerReceiver(
  journal: AttemptJournal,
  execution: DeviceReceiverExecution,
  grant: DeviceGrant,
): Promise<DeviceReceiver> {
  const receiver = await DeviceReceiver.open(
    grant.offer.receiverIncarnationId,
    journal,
    execution,
    {
      currentGrant: () => Promise.resolve(grant),
      assertAllowed: () => Promise.resolve(),
      approve: () => Promise.resolve(true),
      paidGate: { isOn: () => true },
      paidConsent: { allows: () => Promise.resolve(true) },
      assertPaidBinding: () => Promise.resolve(),
    },
  )
  receiver.resumeQueue()
  return receiver
}

/**
 * The launched job, or the driver's typed failure as a rejection carrying its stated case
 * (`launch: 'refused' | 'uncertain'`), for driver tests that only observe the failure.
 */
export async function launchedJob(launch: Promise<DeviceWorkerLaunch>): Promise<DeviceWorkerJob> {
  const result = await launch
  if (result.kind === 'launched') return result.job
  throw Object.assign(result.error, { launch: result.kind })
}
