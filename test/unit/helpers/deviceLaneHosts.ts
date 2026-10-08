// Lane D: one slim pairing host for lane tests. Phase-1 suites keep their
// own harnesses; this builder shares the memory secret store instead.
import { DevicePairing } from '../../../src/host/devices/devicePairing'
import type { DeviceStore } from '../../../src/host/devices/deviceStore'
import { DeviceSecrets, type DeviceExecutionHost } from '../../../src/host/devices/deviceSecrets'
import type { DeviceWebviewRequest } from '../../../src/shared/modelsPanel'
import { deviceTestExpiry, deviceTestNow } from './deviceFixtures'
import { memorySecrets } from './fakes'

export const laneTestHost: DeviceExecutionHost = {
  ui: 'desktop',
  remoteName: undefined,
  execution: 'local',
  secretLocation: 'execution-host',
}

function laneSetup() {
  return Promise.resolve({
    certificateExpiresAt: deviceTestExpiry,
    interfaceLabel: 'lo',
    listenerApplication: 'node',
    endpoint: { address: '127.0.0.1', port: 34_567 },
  })
}

function denyLaneAction(request: DeviceWebviewRequest) {
  return Promise.resolve({
    viewId: request.viewId,
    requestId: request.requestId,
    failure: 'grant' as const,
  })
}

export function startLaneTestHost(store: DeviceStore, host: DeviceExecutionHost = laneTestHost) {
  const adapter = new DevicePairing({
    store,
    host,
    setup: laneSetup,
    otherAction: denyLaneAction,
    disconnectPair: () => undefined,
    secrets: new DeviceSecrets(memorySecrets(), host),
    now: () => deviceTestNow,
    receiverIncarnationId: '1'.repeat(32),
  })
  const act = (action: DeviceWebviewRequest['action']) =>
    adapter.handle({
      action,
      type: 'deviceRequest',
      viewId: '9'.repeat(32),
      requestId: 'f'.repeat(32),
      revision: 0,
    })
  return { adapter, act }
}
