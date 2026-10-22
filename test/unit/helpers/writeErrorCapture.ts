// One real usage journal store over a real folder with its write-error
// reasons collected: suites asserting rejection diagnostics share it so
// the duplication gate stays silent.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UsageJournalStore } from '../../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../../src/runtime/usage/nodeUsageFs'
import { epochNow } from '../../../src/shared/epochMs'

export interface WriteErrorCapture {
  readonly store: UsageJournalStore
  readonly errors: { code: string; reason: string }[]
}

export function captureWriteErrors(prefix: string): WriteErrorCapture {
  const errors: { code: string; reason: string }[] = []
  const store = new UsageJournalStore(
    new NodeUsageFs(mkdtempSync(path.join(tmpdir(), prefix)), epochNow),
    {
      writerId: 'write-error-test-writer',
      now: epochNow,
      isEnabled: () => true,
      onWriteError: (code, reason) => {
        errors.push({ code, reason })
      },
    },
  )
  return { store, errors }
}
