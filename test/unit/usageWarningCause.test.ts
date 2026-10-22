// RLWINFIX item 3: when the usage journal cannot be read, the warning names
// the failure instead of standing alone. Real code throughout: the real
// recording over the real UsageJournalStore and NodeUsageFs, with a real
// second fs holding the rollup lock so the read fails usageLocked.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { usageFailureForLog } from '../../src/core/usage/failures'
import { USAGE_JOURNAL_ROOT, UsageJournalStore } from '../../src/core/usage/journalStore'
import type { CoreLogger } from '../../src/core/logging'
import { createUsageRecording } from '../../src/core/usage/recording'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { USAGE_ROLLUP_LOCK, USAGE_ROLLUP_LOCK_STALE_MS } from '../../src/shared/constants'

const LOCK = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`

describe('usage warning cause', () => {
  it('names the lock failure in the record warning and the restore rejection', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-journal-cause-'))
    try {
      const peer = new NodeUsageFs(dir)
      const held = await peer.acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
      if (held === undefined) throw new Error('the peer never took the lock')
      try {
        const warns: string[] = []
        const log: CoreLogger = {
          trace: () => undefined,
          info: () => undefined,
          warn: (message) => {
            warns.push(message)
          },
          error: () => undefined,
        }
        const recording = createUsageRecording({
          client: 'test',
          isEnabled: () => true,
          now: () => Date.now(),
          newId: () => 'test-id',
          log,
          writer: (onWriteError) =>
            Promise.resolve(
              new UsageJournalStore(new NodeUsageFs(dir), {
                writerId: 'test-writer',
                isEnabled: () => true,
                now: () => Date.now(),
                sleep: () => {
                  return Promise.resolve()
                },
                onWriteError: (_code, error) => {
                  onWriteError(error)
                },
              }),
            ),
        })
        let failure: unknown
        try {
          await recording.today()
        } catch (error: unknown) {
          failure = error
        }
        expect(failure).toBeInstanceOf(Error)
        // The record warning names it...
        expect(warns).toEqual(['Usage history could not be recorded (usageLocked)'])
        // ...and the restore path's rejection unwraps to it (the paid
        // host logs usageFailureForLog of exactly this rejection).
        expect(usageFailureForLog(failure)).toBe('usageLocked')
      } finally {
        await held.release()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
