// RLWINFIX item 3: a usage read waits out a momentarily held rollup lock
// instead of failing it. Real code throughout: the real UsageJournalStore
// over the real NodeUsageFs in a real temp dir, and a real second
// NodeUsageFs over the same dir playing the other window, which holds the
// lock for 200 ms (far inside the wait budget) and then lets go.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  UsageJournalStore,
  USAGE_JOURNAL_ROOT,
  type UsageFs,
} from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { USAGE_ROLLUP_LOCK, USAGE_ROLLUP_LOCK_STALE_MS } from '../../src/shared/constants'

const LOCK = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`

function storeIn(fs: UsageFs, sleep?: (ms: number) => Promise<void>): UsageJournalStore {
  return new UsageJournalStore(fs, {
    writerId: 'test-writer',
    isEnabled: () => true,
    now: () => Date.now(),
    onWriteError: () => {
      throw new Error('the lock-wait tests never write')
    },
    ...(sleep !== undefined && { sleep }),
  })
}

describe('usage journal lock wait', () => {
  it('reads through a lock another window releases', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-journal-wait-'))
    try {
      const peer = new NodeUsageFs(dir)
      const held = await peer.acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
      if (held === undefined) throw new Error('the peer never took the lock')
      try {
        const store = storeIn(new NodeUsageFs(dir))
        const reading = store.read()
        // The outcome is observed only after the peer lets go; this branch
        // keeps a rejection from surfacing as unhandled before that await.
        void reading.catch(() => undefined)
        await delay(200)
        await held.release()
        const snapshot = await reading
        expect(snapshot.recordCount).toBe(0)
      } finally {
        if (await held.isHeld()) await held.release()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('still names usageLocked when the lock never frees, without waiting the budget', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-journal-busy-'))
    try {
      const peer = new NodeUsageFs(dir)
      const held = await peer.acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
      if (held === undefined) throw new Error('the peer never took the lock')
      try {
        // An instant clock: the 200 real acquire attempts run without
        // waiting out the budget.
        const store = storeIn(new NodeUsageFs(dir), () => Promise.resolve())
        await expect(store.read()).rejects.toThrow('usageLocked')
      } finally {
        await held.release()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
