import { createUsageRecording, type UsageRecording } from '../../../src/core/usage/recording'

export interface OwnedRecordingHarness {
  port: UsageRecording
}

// Silent history-disabled recording for owned-observation tests: observations
// stay in memory and are read through `ownedLimits()`.
export function ownedRecording(at: number, onWarn?: () => void): OwnedRecordingHarness {
  const port = createUsageRecording({
    client: 'owned-test',
    now: () => at,
    newId: () => 'owned',
    isEnabled: () => false,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: onWarn ?? (() => undefined),
      error: () => undefined,
    },
    writer: () => {
      throw new Error('history disabled')
    },
  })
  return { port }
}
