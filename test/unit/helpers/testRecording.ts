// One real usage recording over a real journal store on a real folder, with
// a quiet log: suites drive the real journaling path with no doubles, and
// the zero-tolerance duplication gate keeps the construction in this one
// place instead of copied per suite.
import { UsageJournalStore } from '../../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../../src/runtime/usage/nodeUsageFs'
import { createUsageRecording, type UsageRecording } from '../../../src/core/usage/recording'
import type { EpochMs } from '../../../src/shared/epochMs'

export interface TestRecordingOptions {
  readonly root: string
  readonly writerId: string
  readonly client: string
  readonly now: () => EpochMs
  readonly newId: () => string
}

export function createTestRecording(
  options: TestRecordingOptions,
  warnings: string[],
): { recording: UsageRecording; store: UsageJournalStore } {
  const store = new UsageJournalStore(new NodeUsageFs(options.root), {
    writerId: options.writerId,
    now: options.now,
    isEnabled: () => true,
    onWriteError: () => {
      warnings.push('usageWriteFailed')
    },
  })
  const recording = createUsageRecording({
    client: options.client,
    now: options.now,
    newId: options.newId,
    isEnabled: () => true,
    writer: () => Promise.resolve(store),
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message)
      },
      error: (message: string) => {
        warnings.push(message)
      },
    },
  })
  return { recording, store }
}
