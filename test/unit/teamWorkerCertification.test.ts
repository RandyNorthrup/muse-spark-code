import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import * as z from 'zod/mini'

const RECEIPT_FILES = [
  'src/core/team/workers/workerFence.ts',
  'src/core/team/workers/museCodeWorker.ts',
  'src/core/team/workers/acpWorker.ts',
  'src/core/team/workers/engineWorker.ts',
  'src/core/team/workers/report.ts',
  'src/core/team/workers/workerEnv.ts',
  'src/host/team/acpProcess.ts',
  'src/shared/constants.ts',
] as const

const compare = (left: string, right: string) => left.localeCompare(right, 'en')

it('RVM96W2C-N16 certification hashes bind every certified committed worker source', async () => {
  const certification = await readFile(path.resolve('docs/certification/m96-w.md'), 'utf8')
  // JSON strings preserve Git-filtered LF bytes even in Windows CRLF checkouts.
  const sources = z
    .record(z.string(), z.string())
    .parse(
      JSON.parse(
        await readFile(path.resolve('test/fixtures/team-worker-certified/sources.json'), 'utf8'),
      ),
    )
  expect(Object.keys(sources).toSorted(compare)).toEqual(RECEIPT_FILES.toSorted(compare))
  let rowCount = 0
  const recorded = new Map<string, string>()
  for (const row of certification.matchAll(/\|\s*`(src\/[^`]+)`\s*\|\s*`([\da-f]{64})`\s*\|/g)) {
    rowCount += 1
    const file = row[1]
    const digest = row[2]
    if (file === undefined || digest === undefined) throw new Error('Missing restoration receipt')
    expect(recorded.has(file)).toBe(false)
    recorded.set(file, digest)
  }
  expect(rowCount).toBe(RECEIPT_FILES.length)
  for (const file of RECEIPT_FILES) {
    // Historical receipts bind the exact certified bytes, not later release sources.
    const committed = sources[file]
    if (committed === undefined) throw new Error(`Missing certified source: ${file}`)
    const digest = createHash('sha256').update(committed).digest('hex')
    expect(recorded.get(file), file).toBe(digest)
  }
})
