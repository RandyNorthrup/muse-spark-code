import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EstimateHistoryJournal } from '../../src/core/estimator/calibration/journal'
import { estimateHistoryDirectory, fileHistoryPorts } from '../../src/host/estimator/historyStore'

describe('M117 history store in the agent data folder', () => {
  let directory: string
  beforeEach(async () => {
    await mkdir(path.resolve('temp/m117-c'), { recursive: true })
    directory = await mkdtemp(path.resolve('temp/m117-c/store-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('joins the journal directory onto the data folder on every platform', () => {
    const joined = estimateHistoryDirectory(path.join(directory, 'data'))
    expect(joined.replaceAll(path.sep, '/')).toBe(
      `${directory.replaceAll(path.sep, '/')}/data/estimator/history`,
    )
  })

  it('reads records and the same listing skip diagnostics through one journal', async () => {
    const ports = fileHistoryPorts(path.join(directory, 'history'))
    expect(await ports.history()).toEqual([])
    expect(await ports.skipped()).toEqual([])
    // A damaged publication stays out of calibration but shows in the honesty block.
    await mkdir(path.join(directory, 'history'), { recursive: true })
    await writeFile(
      path.join(directory, 'history', 'zz.json'),
      JSON.stringify({ version: 99, durationBasis: 'agentTime', record: {} }),
    )
    expect(await ports.history()).toEqual([])
    expect(await ports.skipped()).toEqual([
      {
        recordId: createHash('sha256').update('zz.json').digest('hex'),
        code: 'unknownHistoryVersion',
      },
    ])
  })

  it('shares appends with a directly opened journal', async () => {
    const folder = path.join(directory, 'history')
    const ports = fileHistoryPorts(folder)
    const record = {
      laneId: 'M117:store',
      kind: 'core',
      machineClassId: 'linux-x64-builder',
      estimatedHours: 2,
      actualHours: 3,
      review: { status: 'unknown' },
      startedAt: '2026-10-01T08:00:00.000Z',
      finishedAt: '2026-10-05T10:00:00.000Z',
      durationBasis: 'agentTime',
      source: 'board',
    } as const
    await new EstimateHistoryJournal(folder).append(record)
    expect(await ports.history()).toEqual([{ ...record }])
    expect(await ports.skipped()).toEqual([])
  })
})
