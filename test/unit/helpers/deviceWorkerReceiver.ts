import { DeviceReceiver } from '../../../src/host/devices/deviceReceiver'
import type { DeviceReceiverExecution } from '../../../src/host/devices/deviceReceiver'
import type { AttemptJournal } from '../../../src/core/devices/attemptJournal'
import type { DeviceGrant } from '../../../src/core/devices/grants'

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
