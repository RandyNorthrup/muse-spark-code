// The resource journal's corrupt-file refusal (D119): undecodable bytes and
// malformed JSON each refuse the read in fixed words; a clean file reads.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ResourceEvent, ResourceRecord } from '../../src/shared/resources'
import { ResourceJournal, ResourceJournalError } from '../../src/core/usage/resourceJournal'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { fileRoots, findOnlyJsonlFile } from './helpers/tempDirs'

const { fresh: freshRoot } = fileRoots()

const event: ResourceEvent = {
  type: 'levelChanged',
  atMs: 0,
  from: 'normal',
  to: 'throttle',
  reason: 'cpu',
}

async function journalAfterCorrupt(corrupt?: (file: string) => void): Promise<ResourceJournal> {
  const root = await freshRoot('muse-resource-journal-')
  const atMs = Date.now()
  const journal = new ResourceJournal(new NodeUsageFs(root), {
    writerId: 'test-writer',
    now: () => atMs,
    isEnabled: () => true,
  })
  const record: ResourceRecord = { type: 'resource', atMs, minute: null, event, work: [] }
  await journal.append(record)
  if (corrupt !== undefined) corrupt(findOnlyJsonlFile(root))
  return journal
}

/** The read's failure, or undefined when the read succeeds. */
async function readFailure(journal: ResourceJournal): Promise<unknown> {
  try {
    await journal.read()
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe('resource journal corrupt files', () => {
  it('reads the clean file', async () => {
    const journal = await journalAfterCorrupt()
    const read = await journal.read()
    expect(read.records.length).toBe(1)
    expect(read.sources).toEqual(['test-writer'])
  })

  it('refuses undecodable bytes in fixed words', async () => {
    const journal = await journalAfterCorrupt((file) => {
      appendFileSync(file, Buffer.from([0xff, 0xfe, 0x0a]))
    })
    const failure = await readFailure(journal)
    expect(failure).toBeInstanceOf(ResourceJournalError)
    expect((failure as ResourceJournalError).code).toBe('resourceHistoryCorrupt')
  })

  it('refuses malformed JSON in fixed words', async () => {
    const journal = await journalAfterCorrupt((file) => {
      appendFileSync(file, '{"broken":\n')
    })
    const failure = await readFailure(journal)
    expect(failure).toBeInstanceOf(ResourceJournalError)
    expect((failure as ResourceJournalError).code).toBe('resourceHistoryCorrupt')
  })
})
