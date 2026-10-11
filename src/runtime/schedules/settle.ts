// The schedule command's settlement wrapper and launcher-error reason live
// here, beside the command, so hosts that only settle a command (the ACP
// agent binary) do not pull the command's engine, report or registration
// imports into their bundle. `registration.ts` re-exports the reason for its
// native callers; `command.ts` re-uses the settlement wrapper.
import { SCHEDULE_CLEANUP_EXIT_CODE, UI_TEXT } from '../../shared/constants'

export interface ScheduleCommandResult {
  readonly exitCode: number
  readonly output: string
  readonly warning?: string
}

/** Names an unsafe-launcher refusal without importing registration. */
export function scheduleLauncherReason(value: unknown): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    value.name === 'UnsafeScheduleLauncherError' &&
    'message' in value &&
    typeof value.message === 'string'
    ? value.message
    : undefined
}

/** Cleanup cannot erase a command's committed acknowledgement. */
export async function settleScheduleCommand(
  work: () => Promise<ScheduleCommandResult>,
  close: () => Promise<void>,
): Promise<ScheduleCommandResult> {
  let result: ScheduleCommandResult | undefined
  try {
    result = await work()
  } finally {
    try {
      await close()
    } catch (error: unknown) {
      if (result !== undefined) {
        const reason = scheduleLauncherReason(error)
        result = {
          ...result,
          exitCode: SCHEDULE_CLEANUP_EXIT_CODE,
          warning:
            reason === undefined
              ? UI_TEXT.scheduleV2.runtime.cleanupFailed
              : `${UI_TEXT.scheduleV2.runtime.cleanupFailed}: ${reason}`,
        }
      }
    }
  }
  return result
}
