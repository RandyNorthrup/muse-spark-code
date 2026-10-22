// The usage journal's lock-race read (D119): a lock lost mid-read retries
// once with cold caches and never returns mixed-generation bytes; two lost
// locks read as usageLockLost; a read that fails under a held lock keeps
// its kind.
//
// Real code throughout: the real UsageJournalStore over the real
// NodeUsageFs in real temp dirs, and a real second NodeUsageFs over the
// same dir playing the other process, which takes the lock over with a
// future clock (a stale-lease takeover, the race the code guards). The only
// test-side scheduling is a GatingFs that delegates every call to the real
// filesystem and only pauses one file's read until the peer has stolen the
// lock, the way the lease suite's pausingPort pauses one call where an
// interleaving matters: every byte the store reads comes from real files.
// The swapped day file keeps its size and mtime, so only cold caches read
// the new bytes.
import { statSync, utimesSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  UsageJournalStore,
  USAGE_JOURNAL_ROOT,
  type UsageFs,
} from '../../src/core/usage/journalStore'
import { epochNow, toEpochMs } from '../../src/shared/epochMs'
import { createUsageRecord, usageLocalDay } from '../../src/core/usage/journalRecord'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import {
  USAGE_DAYS_FOLDER,
  USAGE_ROLLUP_LOCK,
  USAGE_ROLLUP_LOCK_STALE_MS,
} from '../../src/shared/constants'

const AT = Date.UTC(2026, 9, 17, 12, 0, 0)
const DAY = usageLocalDay(AT)
const RECORD_COUNT = 10
// A peer clock far past any claim the store makes, so its takeover reads
// the store's fresh lock as a stale lease, the way a paused process's is.
const TAKEOVER_AHEAD_MS = USAGE_ROLLUP_LOCK_STALE_MS + 60_000
const LOCK = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`
// The gated file sorts after the swapped one, so the reader reaches it last.
const GATED = 'm.jsonl'

function record(id: string) {
  return createUsageRecord(undefined, {
    id,
    at: toEpochMs(AT),
    startedAt: toEpochMs(AT - 1000),
    client: 'Zed',
    backend: 'modelApi',
    provider: 'custom',
    model: 'test-model',
    kind: 'turn',
    outcome: 'completed',
  })
}

/** Schema-valid journal lines with same-width ids, so a same-count swap keeps every byte length. */
function lines(prefix: string): string[] {
  return Array.from({ length: RECORD_COUNT }, (_, index) =>
    JSON.stringify(record(`${prefix}-${String(index)}`)),
  )
}

/** Delegates every call to the real filesystem; only pauses the gated file's first reads. */
class GatingFs implements UsageFs {
  private armed = 0
  private started = 0
  private readonly releases: (() => void)[] = []
  constructor(private readonly inner: NodeUsageFs) {}
  arm(count: number): void {
    this.armed = count
  }
  /** Until the gated read has started n times; the reader is pinned there, so no bound races a pass. */
  async waitStarted(total: number): Promise<void> {
    while (this.started < total) await delay(1)
  }
  open(): void {
    const release = this.releases.shift()
    if (release === undefined) throw new Error('no gated read is waiting')
    release()
  }
  async read(file: string, offset: number, length?: number): Promise<Uint8Array> {
    if (file.endsWith(`/${GATED}`) && this.started < this.armed) {
      this.started += 1
      await new Promise<void>((resolve) => {
        this.releases.push(resolve)
      })
    }
    return await this.inner.read(file, offset, length)
  }
  list(folder: string): ReturnType<NodeUsageFs['list']> {
    return this.inner.list(folder)
  }
  stat(file: string): ReturnType<NodeUsageFs['stat']> {
    return this.inner.stat(file)
  }
  append(
    file: string,
    line: string,
    isDurable?: boolean,
    commit?: () => Promise<void>,
  ): Promise<void> {
    return this.inner.append(file, line, isDurable, commit)
  }
  writeFileAtomically(file: string, text: string, commit?: () => Promise<void>): Promise<void> {
    return this.inner.writeFileAtomically(file, text, commit)
  }
  remove(file: string, commit?: () => Promise<void>): Promise<void> {
    return this.inner.remove(file, commit)
  }
  sweep(folder: string): Promise<void> {
    return this.inner.sweep(folder)
  }
  acquireLock(file: string, staleMs: number): ReturnType<NodeUsageFs['acquireLock']> {
    return this.inner.acquireLock(file, staleMs)
  }
}

async function scratch(): Promise<{ dir: string; dayFile: string; gatedFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-journal-race-'))
  const dayDir = path.join(dir, USAGE_JOURNAL_ROOT, USAGE_DAYS_FOLDER, DAY)
  await mkdir(dayDir, { recursive: true })
  return { dir, dayFile: path.join(dayDir, 'a.jsonl'), gatedFile: path.join(dayDir, GATED) }
}

/** A scratched day holding the swapped file's old bytes beside the gated file's bytes. */
async function seededScratch(): Promise<{ dir: string; dayFile: string; gatedFile: string }> {
  const seeded = await scratch()
  await writeFile(seeded.dayFile, `${lines('a').join('\n')}\n`, 'utf8')
  await writeFile(seeded.gatedFile, `${lines('c').join('\n')}\n`, 'utf8')
  return seeded
}

function storeIn(fs: UsageFs): UsageJournalStore {
  return new UsageJournalStore(fs, {
    writerId: 'test-writer',
    isEnabled: () => true,
    now: epochNow,
    onWriteError: () => {
      throw new Error('the race tests never write')
    },
  })
}

/** A stale-lease takeover of the store's lock, released at once for the retry to take. */
async function takeOver(dir: string): Promise<void> {
  // The gated read started, so the store necessarily holds its claim: the
  // takeover cannot run early and steal an empty lock.
  const peer = new NodeUsageFs(dir, () => Date.now() + TAKEOVER_AHEAD_MS)
  const lock = await peer.acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
  if (lock === undefined) throw new Error('the peer never took the lock over')
  await lock.release()
}

describe('usage journal lock races', () => {
  it('retries a raced lock and returns the fresh snapshot, never mixed bytes', async () => {
    const { dir, dayFile } = await seededScratch()
    try {
      // A whole-millisecond mtime round-trips exactly, so the swap below
      // keeps the stat identical and only cold caches read the new bytes.
      const tick = Math.floor(Date.now() / 1000)
      utimesSync(dayFile, tick, tick)
      const baseline = statSync(dayFile)
      const gating = new GatingFs(new NodeUsageFs(dir))
      gating.arm(1)
      const store = storeIn(gating)
      const reading = store.read()
      // The reader is pinned on the gated file; the takeover always lands
      // mid-read, after the old bytes were cached and before they return.
      await gating.waitStarted(1)
      await takeOver(dir)
      await writeFile(dayFile, `${lines('b').join('\n')}\n`, 'utf8')
      utimesSync(dayFile, tick, tick)
      const after = statSync(dayFile)
      expect(after.size).toBe(baseline.size)
      expect(after.mtimeMs).toBe(baseline.mtimeMs)
      gating.open()
      const snapshot = await reading
      expect(snapshot.records.map((entry) => entry.id)).toEqual([
        ...Array.from({ length: RECORD_COUNT }, (_, index) => `b-${String(index)}`),
        ...Array.from({ length: RECORD_COUNT }, (_, index) => `c-${String(index)}`),
      ])
      expect(snapshot.recordCount).toBe(2 * RECORD_COUNT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads usageLockLost after a second race', async () => {
    const { dir } = await seededScratch()
    try {
      const gating = new GatingFs(new NodeUsageFs(dir))
      gating.arm(2)
      const store = storeIn(gating)
      const reading = store.read()
      await gating.waitStarted(1)
      await takeOver(dir)
      gating.open()
      // Race the retry too: the second gated read draws the second
      // takeover, so the reread also loses its lock.
      await gating.waitStarted(2)
      await takeOver(dir)
      gating.open()
      await expect(reading).rejects.toThrow('usageLockLost')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a read failure under a held lock with its kind', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-journal-held-'))
    try {
      // A file where the day directory belongs: listing it fails ENOTDIR
      // through real filesystem I/O, with the store's own lock still held.
      await mkdir(path.join(dir, USAGE_JOURNAL_ROOT), { recursive: true })
      await writeFile(path.join(dir, USAGE_JOURNAL_ROOT, USAGE_DAYS_FOLDER), 'not a directory')
      const store = storeIn(new NodeUsageFs(dir))
      await expect(store.read()).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
