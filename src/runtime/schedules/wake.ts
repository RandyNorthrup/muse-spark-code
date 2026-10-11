import path from 'node:path'
import { verifyScheduleWake } from './nodeBackgroundIo'
import type { ScheduleWakeAuthorization } from './registration'

/** Re-read and verify the native definition/record before each engine admission. */
export function createVerifyWake(executable: string, agentFile: string) {
  return async (registrationId?: string): Promise<ScheduleWakeAuthorization> =>
    await verifyScheduleWake(executable, agentFile, undefined, registrationId)
}

/** The agent script beside this bundle is the launcher the record names. */
export function agentFileBeside(bundleFile: string): string {
  return path.join(path.dirname(bundleFile), 'acp.js')
}
