import { mkdtempSync, realpathSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import { matchOf } from '../../src/host/checkpoints/checkpointFiles'
import { droppedRecords } from '../../src/host/checkpoints/checkpointRetention'
import { blobsOf } from '../../src/host/checkpoints/writeRecorder'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-nolimits13-')))

afterAll(async () => {
  await removeFolder(base)
})

function record(sessionId: string, sequence: number, createdAt: number, isOpen = false) {
  return { sessionId, sequence, createdAt, isOpen }
}

describe('checkpoint retention without invented caps', () => {
  it('keeps all 150 units of one session: no per-session cap', () => {
    const now = Date.now()
    const records = Array.from({ length: 150 }, (_, index) =>
      record('s1', index + 1, now - index * 1000),
    )
    expect(droppedRecords(records, now, 30)).toEqual([])
  })

  it('keeps all 60 recent sessions: no session-count cap', () => {
    const now = Date.now()
    const records = Array.from({ length: 60 }, (_, index) =>
      record(`s${String(index)}`, 1, now - 1000),
    )
    expect(droppedRecords(records, now, 30)).toEqual([])
  })

  it('still drops a conversation idle past cleanupPeriodDays, and keeps a running one whole', () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const idle = [record('old', 1, now - 40 * day), record('old', 2, now - 31 * day)]
    const running = [record('live', 1, now - 40 * day, true)]
    const dropped = droppedRecords([...idle, ...running], now, 30)
    expect(dropped.map((entry) => entry.sessionId)).toEqual(['old', 'old'])
  })
})

describe('checkpoint copies without the 16 MiB cap', () => {
  it('blobsOf keeps published bytes past the old file cap', () => {
    const published = Buffer.alloc(17 * 1024 * 1024, 7)
    const blobs = blobsOf({ state: { present: false }, bytes: undefined }, published)
    expect(blobs).toHaveLength(1)
    expect(blobs[0]?.bytes?.length).toBe(published.length)
  })

  it('matchOf compares a 17 MiB file by bytes instead of refusing it', async () => {
    const dir = await fsp.mkdtemp(path.join(base, 'big-'))
    const absolute = path.join(dir, 'big.bin')
    await fsp.writeFile(absolute, Buffer.alloc(17 * 1024 * 1024, 9))
    const oid = gitBlobOid(await fsp.readFile(absolute))
    expect(await matchOf(absolute, { kind: 'blob', oid })).toBe('same')
    expect(await matchOf(absolute, { kind: 'blob', oid: `${oid}x` })).toBe('changed')
  })
})
