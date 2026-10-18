// The resource journal's corrupt-file refusal (D119): undecodable bytes and
// malformed JSON each refuse the read in fixed words, while a failure no
// named condition covers keeps its own kind; a clean file still reads.
import { appendFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResourceEvent, ResourceRecord } from '../../src/shared/resources'
import { ResourceJournal, ResourceJournalError } from '../../src/core/usage/resourceJournal'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const event: ResourceEvent = {
  type: 'levelChanged',
  atMs: 0,
  from: 'normal',
  to: 'throttle',
  reason: 'cpu',
}

/** The one collector file the journal just wrote, found by shape not by path. */
function findCollectorFile(root: string): string {
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name)
      if (statSync(file).isDirectory()) visit(file)
      else if (name.endsWith('.jsonl')) found.push(file)
    }
  }
  visit(root)
  if (found.length !== 1)
    throw new Error(`expected one collector file, found ${String(found.length)}`)
  return found[0]!
}

async function journalAfterCorrupt(corrupt?: (file: string) => void): Promise<ResourceJournal> {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-resource-journal-'))
  roots.push(root)
  const atMs = Date.now()
  const journal = new ResourceJournal(new NodeUsageFs(root), {
    writerId: 'test-writer',
    now: () => atMs,
    isEnabled: () => true,
  })
  const record: ResourceRecord = { type: 'resource', atMs, minute: null, event, work: [] }
  await journal.append(record)
  if (corrupt !== undefined) corrupt(findCollectorFile(root))
  return journal
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
    let failure: unknown
    try {
      await journal.read()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ResourceJournalError)
    expect((failure as ResourceJournalError).code).toBe('resourceHistoryCorrupt')
  })

  it('refuses malformed JSON in fixed words', async () => {
    const journal = await journalAfterCorrupt((file) => {
      appendFileSync(file, '{"broken":\n')
    })
    let failure: unknown
    try {
      await journal.read()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ResourceJournalError)
    expect((failure as ResourceJournalError).code).toBe('resourceHistoryCorrupt')
  })
})
