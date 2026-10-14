import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createUsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { epochNow, toEpochMs, type EpochMs } from '../../src/shared/epochMs'
import type { CoreLogger } from '../../src/core/logging'

/**
 * The headless path's old clock (src/runtime/main.ts before the fix): the
 * epoch plus a monotonic fraction. The usage boundary rounds it once, here,
 * through the single clock constructor, so the journal keeps whole
 * milliseconds.
 */
const headlessNow = (): EpochMs => toEpochMs(performance.timeOrigin + performance.now())

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

async function recordOneTurn(dataFolder: string, now: () => EpochMs, warnings: string[]) {
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
  it('rounds a fractional input once, at the constructor', () => {
    expect(toEpochMs(1_791_839_174_122.7842)).toBe(1_791_839_174_123)
    expect(toEpochMs(1_791_839_174_108)).toBe(1_791_839_174_108)
    expect(Number.isSafeInteger(epochNow())).toBe(true)
  })

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
    const records = await recordOneTurn(dataFolder, epochNow, warnings)
    expect(warnings).toEqual([])
    expect(records).toHaveLength(1)
  })

  it('names the failing field when a record is rejected', async () => {
    const dataFolder = mkdtempSync(path.join(tmpdir(), 'exec-usage-red-'))
    const errors: { code: string; reason: string }[] = []
    const store = new UsageJournalStore(new NodeUsageFs(dataFolder, epochNow), {
      writerId: 'redtest-writer',
      now: epochNow,
      isEnabled: () => true,
      onWriteError: (code, reason) => {
        errors.push({ code, reason })
      },
    })
    store.noteUsage(
      { input_tokens: 10, output_tokens: 5 },
      {
        id: '',
        at: epochNow(),
        startedAt: epochNow(),
        client: 'cli',
        backend: 'modelApi',
        provider: 'redtest',
        model: 'redtest',
        kind: 'turn',
        outcome: 'completed',
      },
    )
    await store.flush()
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('usageWriteFailed')
    expect(errors[0]?.reason).toContain('id')
  })

  it('does not say usage was not recorded when only the read fails', async () => {
    // A regular file where the data folder belongs: the real store cannot
    // read it. Records may well exist elsewhere; the read failing is not
    // evidence they were never written, so no "not recorded" warning.
    const folder = mkdtempSync(path.join(tmpdir(), 'exec-usage-red-'))
    const notAFolder = path.join(folder, 'not-a-folder')
    writeFileSync(notAFolder, 'x')
    const warnings: string[] = []
    const recording = createUsageRecording({
      client: 'cli',
      now: epochNow,
      newId: () => randomUUID(),
      isEnabled: () => true,
      log: collectingLog(warnings),
      writer: (onWriteError) =>
        Promise.resolve(
          new UsageJournalStore(new NodeUsageFs(notAFolder, epochNow), {
            writerId: 'redtest-writer',
            now: epochNow,
            isEnabled: () => true,
            onWriteError,
          }),
        ),
    })
    await expect(recording.today()).rejects.toThrow('Usage history unavailable')
    expect(warnings).toEqual([])
  })
})
