// Read-only takeover tolerates exactly the blocked-hint shape (PLAN.md
// D119): a lock-coded pointer replace in read-only mode re-checks fencing
// and succeeds, while any other failure keeps its kind and fails the read.
import { describe, expect, it } from 'vitest'
import { usingTempDir } from './helpers/temporaryFolders'
import {
  createScheduleJournal,
  isHintBlockedError,
  type ScheduleFsPort,
} from '../../src/core/schedules/journal'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'

type Collections = Record<string, Record<string, unknown>>

const parse = (raw: unknown): Collections => raw as Collections

function blockedReplace(fs: ScheduleFsPort, failure: Error): ScheduleFsPort {
  return {
    ...fs,
    replace: () => Promise.reject(failure),
  }
}

function hintBlocked(code: string): Error {
  return Object.assign(new Error('hint blocked'), { code })
}

async function sealedStore(directory: string): Promise<ScheduleFsPort> {
  const fs = createNodeScheduleFs(directory)
  const journal = createScheduleJournal(fs, 'journal', parse, {})
  await journal.transact(() => ({ value: { n: { v: 1 } }, result: undefined }))
  const current = await journal.read()
  // A sealed generation forces the next commit through the pointer-hint
  // replace: the seal delta below is byte-identical to the one a commit
  // writes, published through the real store.
  if (current.generation === undefined) throw new Error('journalSeedFailed')
  const isPublished = await fs.publish(
    `journal/${current.generation}/${String(current.revision + 1)}.json`,
    JSON.stringify({ revision: current.revision + 1, changes: [], sealed: true }),
  )
  if (!isPublished) throw new Error('journalSeedFailed')
  return fs
}

describe('schedule journal read-only fencing', () => {
  it('names only lock-coded failures as blocked hints', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      expect(isHintBlockedError(Object.assign(new Error('x'), { code }))).toBe(true)
    }
    expect(isHintBlockedError(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toBe(false)
    expect(isHintBlockedError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false)
    expect(isHintBlockedError(new Error('plain'))).toBe(false)
    expect(isHintBlockedError('EPERM')).toBe(false)
  })

  it('fails a read-only takeover when the hint replace fails any other way', async () => {
    await usingTempDir('muse-schedule-journal-', async (directory) => {
      const fs = await sealedStore(directory)
      const blocked = hintBlocked('ENOSPC')
      const journal = createScheduleJournal(blockedReplace(fs, blocked), 'journal', parse, {})
      let failure: unknown
      try {
        await journal.read()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBe(blocked)
    })
  })

  it('keeps the committed value when a blocked hint re-checks fencing', async () => {
    await usingTempDir('muse-schedule-journal-', async (directory) => {
      const fs = await sealedStore(directory)
      const journal = createScheduleJournal(
        blockedReplace(fs, hintBlocked('EPERM')),
        'journal',
        parse,
        {},
      )
      const current = await journal.read()
      expect(current.generation).not.toBeUndefined()
      expect(current.value).toEqual({ n: { v: 1 } })
    })
  })
})
