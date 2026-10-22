// The estimator history's first-use bundle as the window sees it
// (src/host/estimator/historyBundle.ts): a bundle Node cannot load refuses
// the read with the fixed detail and tries again next time, and a loaded
// bundle reads records and skip diagnostics through one real journal.
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as historyEntry from '../../src/host/estimator/historyEntry'
import { lazyHistoryPorts } from '../../src/host/estimator/historyBundle'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { errorLogger } from './helpers/collectingLogger'

describe('M117 history bundle loader', () => {
  let directory: string
  beforeEach(async () => {
    await mkdir(path.resolve('temp/m117-c'), { recursive: true })
    directory = await mkdtemp(path.resolve('temp/m117-c/bundle-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('refuses with the fixed detail when the bundle cannot load, and tries again', async () => {
    const errors: string[] = []
    const ports = lazyHistoryPorts({
      bundlePath: path.join(directory, 'estimateHistory.js'),
      log: errorLogger(errors),
      directory: path.join(directory, 'history'),
    })
    const refusal = fill(UI_TEXT.estimateFailed, { detail: 'history-bundle-unavailable' })
    await expect(ports.history()).rejects.toThrow(refusal)
    await expect(ports.skipped()).rejects.toThrow(refusal)
    // Each read tried the load again; the log keeps fixed words, never the path.
    expect(errors).toEqual([
      'The estimate history bundle could not be loaded',
      'The estimate history bundle could not be loaded',
    ])
  })

  it('reads records and the same listing skip diagnostics through one journal', async () => {
    const errors: string[] = []
    let loads = 0
    const folder = path.join(directory, 'history')
    const ports = lazyHistoryPorts({
      bundlePath: path.join(directory, 'estimateHistory.js'),
      log: errorLogger(errors),
      directory: folder,
      loadBundle: () => {
        loads += 1
        return historyEntry
      },
    })
    expect(loads).toBe(0)
    expect(await ports.history()).toEqual([])
    await mkdir(folder, { recursive: true })
    // A basis outside the vocabulary stays out of calibration, and the skip
    // the second port reports is the one the first port's listing saw.
    await writeFile(
      path.join(folder, 'tide.json'),
      JSON.stringify({ version: 1, durationBasis: 'tide', record: { durationBasis: 'tide' } }),
    )
    const records = await ports.history()
    const skipped = await ports.skipped()
    expect(records).toEqual([])
    expect(skipped).toEqual([
      {
        recordId: createHash('sha256').update('tide.json').digest('hex'),
        code: 'unknownHistoryBasis',
      },
    ])
    expect(loads).toBe(1)
    expect(errors).toEqual([])
  })
})
