import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createUsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import type { CoreLogger } from '../../src/core/logging'

/**
 * The headless path's clock (src/runtime/main.ts): the epoch plus a
 * monotonic fraction, so every stamp carries a fraction of a millisecond.
 * The journal schema wants whole milliseconds since the epoch.
 */
const headlessNow = (): number => performance.timeOrigin + performance.now()

function ignoreLog(_message: string): void {
  /* Only warnings matter to this reproduction. */
}

function collectingLog(into: string[]): CoreLogger {
  return {
    trace: ignoreLog,
    info: ignoreLog,
    warn: (message: string) => {
      into.push(message)
    },
    error: ignoreLog,
  }
}

async function recordOneTurn(dataFolder: string, now: () => number, warnings: string[]) {
  const recording = createUsageRecording({
    client: 'cli',
    now,
    newId: () => randomUUID(),
    isEnabled: () => true,
    log: collectingLog(warnings),
    writer: (onWriteError) =>
      Promise.resolve(
        new UsageJournalStore(new NodeUsageFs(dataFolder, now), {
          writerId: 'redtest-writer',
          now,
          isEnabled: () => true,
          onWriteError,
        }),
      ),
  })
  recording.note(
    { input_tokens: 10, output_tokens: 5 },
    {
      backend: 'modelApi',
      provider: 'redtest',
      model: 'redtest',
      kind: 'turn',
      startedAt: now(),
      outcome: 'completed',
    },
  )
  await recording.flush()
  return await recording.today()
}

describe('exec usage clock', () => {
  it('records a headless turn stamped with the headless clock', async () => {
    const dataFolder = mkdtempSync(path.join(tmpdir(), 'exec-usage-red-'))
    const warnings: string[] = []
    const records = await recordOneTurn(dataFolder, headlessNow, warnings)
    expect(warnings).toEqual([])
    expect(records).toHaveLength(1)
  })

  it('records a turn stamped with whole milliseconds', async () => {
    const dataFolder = mkdtempSync(path.join(tmpdir(), 'exec-usage-red-'))
    const warnings: string[] = []
    const records = await recordOneTurn(dataFolder, Date.now, warnings)
    expect(warnings).toEqual([])
    expect(records).toHaveLength(1)
  })
})
