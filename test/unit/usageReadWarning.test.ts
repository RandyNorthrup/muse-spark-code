// A usage history that cannot be read names its cause once, in its own
// sentence, and never says usage was not recorded (RLUSAGE's exec usage
// clock, reconciled with RLWINFIX's named causes in CC-INT2). The real
// recording over the real journal store and a regular file where the data
// folder belongs. Its own file because the store's write diagnostic gate is
// once per process: the later write failure below must be the first.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { createUsageRecording } from '../../src/core/usage/recording'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { epochNow } from '../../src/shared/epochMs'

function ignore(_message: string): void {
  /* Only warnings matter here. */
}

describe('usage history read failure', () => {
  it('names the cause without saying usage was not recorded, and leaves the write warning', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'usage-read-warning-'))
    const notAFolder = path.join(folder, 'not-a-folder')
    writeFileSync(notAFolder, 'x')
    const warnings: string[] = []
    const log: CoreLogger = {
      trace: ignore,
      info: ignore,
      warn: (message: string) => {
        warnings.push(message)
      },
      error: ignore,
    }
    const recording = createUsageRecording({
      client: 'cli',
      now: epochNow,
      newId: () => randomUUID(),
      isEnabled: () => true,
      log,
      writer: (onWriteError) =>
        Promise.resolve(
          new UsageJournalStore(new NodeUsageFs(notAFolder, epochNow), {
            writerId: 'read-warning-writer',
            now: epochNow,
            isEnabled: () => true,
            onWriteError: (_code, error) => {
              onWriteError(error)
            },
          }),
        ),
    })
    await expect(recording.today()).rejects.toThrow('Usage history unavailable')
    await expect(recording.today()).rejects.toThrow('Usage history unavailable')
    // Records may well exist elsewhere: a read failing is not evidence they
    // were never written. One sentence of its own, once.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('could not be read')
    expect(warnings[0]).not.toContain('not recorded')
    // The read warning did not spend the write warning a real failure needs.
    recording.note(
      { input_tokens: 10, output_tokens: 5 },
      {
        backend: 'modelApi',
        provider: 'redtest',
        model: 'redtest',
        kind: 'turn',
        startedAt: epochNow(),
        outcome: 'completed',
      },
    )
    await recording.flush()
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain('was not recorded')
  })
})
