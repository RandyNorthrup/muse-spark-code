import type {
  DeviceWorkerJob,
  DeviceWorkerLaunch,
} from '../../../src/host/devices/deviceWorkerHost'

/**
The launched job, or the driver's typed failure as a rejection carrying its stated case
(`launch: 'refused' | 'uncertain'`), for driver tests that only observe the failure.
*/
export async function launchedJob(launch: Promise<DeviceWorkerLaunch>): Promise<DeviceWorkerJob> {
  const result = await launch
  if (result.kind === 'launched') return result.job
  throw Object.assign(result.error, { launch: result.kind })
}
