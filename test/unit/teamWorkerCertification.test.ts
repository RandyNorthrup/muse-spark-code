import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

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

it('RVM96W2C-N16 certification hashes bind every certified committed worker source', async () => {
  const certification = await readFile(path.resolve('docs/certification/m96-w.md'), 'utf8')
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
    // Historical drill receipts bind their certified revision, not later release merges.
    const committed = execFileSync(
      'git',
      ['show', `45c3439bd3bb16088fb5749ec81b3ff3341957a8:${file}`],
      { windowsHide: true },
    )
    const digest = createHash('sha256').update(committed).digest('hex')
    expect(recorded.get(file), file).toBe(digest)
  }
})
