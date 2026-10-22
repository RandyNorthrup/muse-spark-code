// The usage journal's corrupt-line tally (D119): undecodable bytes and
// malformed JSON each count a line invalid while the scan keeps the valid
// records around them; the failures never escape the read.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { epochNow } from '../../src/shared/epochMs'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { fileRoots, findOnlyJsonlFile } from './helpers/tempDirs'
import { usageRecordContextAt } from './helpers/usageRecordContext'

const { fresh: freshRoot } = fileRoots()

async function journalAfterCorrupt(corrupt: (file: string) => void): Promise<UsageJournalStore> {
  const root = await freshRoot('muse-journal-invalid-')
  const writeErrors: string[] = []
  const store = new UsageJournalStore(new NodeUsageFs(root), {
    writerId: 'test-writer',
    isEnabled: () => true,
    now: epochNow,
    onWriteError: (code) => {
      writeErrors.push(code)
    },
  })
  store.append(createUsageRecord(undefined, usageRecordContextAt(Date.now())))
  await store.flush()
  corrupt(findOnlyJsonlFile(root))
  return store
}

describe('usage journal corrupt lines', () => {
  it('counts undecodable bytes invalid and keeps the valid record', async () => {
    const store = await journalAfterCorrupt((file) => {
      appendFileSync(file, Buffer.from([0xff, 0xfe, 0x0a]))
    })
    const snapshot = await store.read()
    expect(snapshot.invalidLines).toBe(1)
    expect(snapshot.records.length).toBe(1)
  })

  it('counts malformed JSON invalid and keeps the valid record', async () => {
    const store = await journalAfterCorrupt((file) => {
      appendFileSync(file, '{"broken":\n')
    })
    const snapshot = await store.read()
    expect(snapshot.invalidLines).toBe(1)
    expect(snapshot.records.length).toBe(1)
  })

  it('counts both kinds across one file', async () => {
    const store = await journalAfterCorrupt((file) => {
      appendFileSync(file, Buffer.from([0xff, 0x0a]))
      appendFileSync(file, '{"broken":\n')
    })
    const snapshot = await store.read()
    expect(snapshot.invalidLines).toBe(2)
    expect(snapshot.records.length).toBe(1)
  })
})
