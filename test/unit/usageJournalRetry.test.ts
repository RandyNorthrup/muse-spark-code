// The usage journal's lock-race read (D119): a lock lost mid-read retries
// once with cold caches and never returns mixed-generation bytes; a read
// that fails under a held lock keeps its kind, as does a second race.
import { describe, expect, it } from 'vitest'
import { UsageJournalStore, type UsageFs } from '../../src/core/usage/journalStore'

function options() {
  const writeErrors: string[] = []
  return {
    writerId: 'test-writer',
    isEnabled: () => true,
    now: () => Date.now(),
    onWriteError: (code: 'usageWriteFailed') => {
      writeErrors.push(code)
    },
  }
}

function stubFs(lists: () => Promise<readonly string[]>, isHeld: () => Promise<boolean>) {
  const calls = { list: 0, acquire: 0 }
  const fs: UsageFs = {
    list: () => {
      calls.list += 1
      return lists()
    },
    stat: () => Promise.resolve(undefined),
    read: () => Promise.resolve(new Uint8Array()),
    append: () => Promise.resolve(),
    writeFileAtomically: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    acquireLock: () => {
      calls.acquire += 1
      return Promise.resolve({
        token: 'test',
        generation: 0,
        isHeld,
        release: () => Promise.resolve(),
      })
    },
  }
  return { fs, calls }
}

describe('usage journal lock races', () => {
  it('retries a raced lock and returns the fresh snapshot', async () => {
    let reads = 0
    const { fs, calls } = stubFs(
      () => {
        reads += 1
        return reads === 1 ? Promise.reject(new Error('storage paused')) : Promise.resolve([])
      },
      (() => {
        let heldCount = 0
        return () => Promise.resolve((heldCount += 1) > 1)
      })(),
    )
    const store = new UsageJournalStore(fs, options())
    const snapshot = await store.read()
    expect(snapshot.records).toEqual([])
    expect(snapshot.recordCount).toBe(0)
    // One failed rollup listing, then a fresh rollup and day listing.
    expect(calls.list).toBe(3)
    expect(calls.acquire).toBe(2)
  })

  it('keeps its kind after a second race', async () => {
    const { fs, calls } = stubFs(
      () => Promise.reject(new Error('storage paused')),
      () => Promise.resolve(false),
    )
    const store = new UsageJournalStore(fs, options())
    let failure: unknown
    try {
      await store.read()
      throw new Error('a twice-raced read must not return bytes')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('usageLockLost')
    expect(calls.acquire).toBe(2)
  })

  it('keeps a read failure under a held lock with its kind', async () => {
    const failure = new Error('storage paused')
    const { fs, calls } = stubFs(
      () => Promise.reject(failure),
      () => Promise.resolve(true),
    )
    const store = new UsageJournalStore(fs, options())
    await expect(store.read()).rejects.toBe(failure)
    expect(calls.acquire).toBe(1)
  })
})
