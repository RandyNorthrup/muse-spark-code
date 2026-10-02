import { describe, expect, it } from 'vitest'
import {
  type CheckpointRecord,
  type RestoreRecord,
} from '../../src/host/checkpoints/checkpointRecords'
import { retainRecords } from '../../src/host/checkpoints/checkpointRetention'
import {
  CHECKPOINT_RESTORES_PER_SESSION_MAX,
  CHECKPOINT_SESSIONS_MAX,
  CHECKPOINTS_PER_SESSION_MAX,
  MILLISECONDS_PER_DAY,
} from '../../src/shared/constants'

// How long checkpoints and redo records are kept (M72): per conversation,
// for the conversations used most recently, none older than the setting's
// days; a running turn's checkpoint always stays.
const NOW = 100 * MILLISECONDS_PER_DAY
const capture = { tree: 't', coverage: { skipped: [], repositories: [] } }

function checkpoint(id: string, sessionId: string, createdAt: number): CheckpointRecord {
  return {
    kind: 'checkpoint',
    top: '/ws',
    prefix: '',
    id,
    sessionId,
    turnId: id,
    createdAt,
    start: capture,
  }
}

function restore(id: string, sessionId: string, createdAt: number): RestoreRecord {
  return { kind: 'restore', top: '/ws', prefix: '', id, sessionId, createdAt, entries: [] }
}

const ids = (records: readonly { readonly id: string }[]) => records.map((record) => record.id)
const range = (count: number) => Array.from({ length: count }, (_, index) => index)

describe('retainRecords (M72)', () => {
  it('keeps the newest records of each conversation, redo records included', () => {
    const records = {
      checkpoints: range(CHECKPOINTS_PER_SESSION_MAX + 1).map((index) =>
        checkpoint(`c${String(index)}`, 's1', NOW - 1000 + index),
      ),
      restores: range(CHECKPOINT_RESTORES_PER_SESSION_MAX + 1).map((index) =>
        restore(`r${String(index)}`, 's1', NOW - 1000 + index),
      ),
    }
    const kept = retainRecords(records, NOW, 30, () => false)
    expect(kept.checkpoints).toHaveLength(CHECKPOINTS_PER_SESSION_MAX)
    expect(kept.restores).toHaveLength(CHECKPOINT_RESTORES_PER_SESSION_MAX)
    expect(ids(kept.dropped)).toEqual(['c0', 'r0'])
  })

  it('keeps the conversations used most recently, and nothing older than the setting', () => {
    const sessions = range(CHECKPOINT_SESSIONS_MAX + 1)
    const records = {
      checkpoints: [
        ...sessions.map((index) =>
          checkpoint(`c${String(index)}`, `s${String(index)}`, NOW - index),
        ),
        checkpoint('old', 'recent', NOW - 31 * MILLISECONDS_PER_DAY),
      ],
      restores: [restore('old-redo', 's0', NOW - 31 * MILLISECONDS_PER_DAY)],
    }
    const kept = retainRecords(records, NOW, 30, () => false)
    expect(ids(kept.dropped).toSorted((a, b) => a.localeCompare(b))).toEqual([
      `c${String(CHECKPOINT_SESSIONS_MAX)}`,
      'old',
      'old-redo',
    ])
  })

  it('always keeps a running turn’s checkpoint, and keeps everything with no day limit', () => {
    const running = checkpoint('running', 's1', NOW - 90 * MILLISECONDS_PER_DAY)
    const records = { checkpoints: [running], restores: [] }
    expect(retainRecords(records, NOW, 30, (record) => record === running).dropped).toEqual([])
    expect(ids(retainRecords(records, NOW, 30, () => false).dropped)).toEqual(['running'])
    expect(retainRecords(records, NOW, 0, () => false).dropped).toEqual([])
  })
})
