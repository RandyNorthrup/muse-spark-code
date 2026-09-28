import { describe, expect, it, vi } from 'vitest'
import type { CheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import type { Snapshot } from '../../src/host/checkpoints/checkpointStore'
import { ConversationCheckpoints } from '../../src/host/conversation/conversationCheckpoints'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel } from './helpers/fakes'

function snapshot(tree: string): Snapshot {
  return {
    tree,
    coverage: { skipped: [], repositories: [] },
    inventory: { files: new Map(), skippedFolders: [], isPartial: false },
    createdAt: 0,
  }
}

/** A port that hands out numbered captures and records what it was asked (M72). */
function harness() {
  const calls: string[] = []
  let captures = 0
  const port: CheckpointPort = {
    availability: () => 'on',
    capture: () => {
      captures += 1
      return Promise.resolve({ ok: true, snapshot: snapshot(`c${String(captures)}`) })
    },
    record: (sessionId, turnId, taken) => {
      calls.push(`record ${sessionId} ${turnId} ${taken.tree}`)
      return Promise.resolve()
    },
    endTurn: (sessionId, turnId) => {
      calls.push(`end ${sessionId} ${turnId}`)
      return Promise.resolve()
    },
    turns: () => Promise.resolve([]),
    restore: () => Promise.resolve({ ok: false, reason: 'noCheckpoint' }),
    redo: () => Promise.resolve({ ok: false, reason: 'redoGone' }),
    forgetSession: () => Promise.resolve(),
    beforeToolWrite: () => Promise.resolve(),
  }
  const posted: HostToWebviewMessage[] = []
  const checkpoints = new ConversationCheckpoints({
    port,
    post: (message) => {
      posted.push(message)
    },
    notice: vi.fn(),
    confirm: () => Promise.resolve(true),
    unsavedPaths: () => [],
    log: new FakeLogOutputChannel(),
  })
  return { checkpoints, calls, posted }
}

describe('ConversationCheckpoints (M72)', () => {
  it('gives each turn the capture taken before its own message, whichever event comes first', async () => {
    const { checkpoints, calls } = harness()
    await checkpoints.sessionChanged('s1')
    const first = await checkpoints.beforeTurn('s1')
    const second = await checkpoints.beforeTurn('s1')
    // The first turn starts before its acknowledgement; the second message steers.
    checkpoints.turnStarted('s1', 't1')
    checkpoints.accepted(first, 't1', true)
    checkpoints.accepted(second, 't1', false)
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 t1 c1'])
    })
    // An acknowledgement before the start binds the capture it names.
    const third = await checkpoints.beforeTurn('s1')
    checkpoints.accepted(third, 't2', true)
    checkpoints.turnStarted('s1', 't2')
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 t1 c1', 'record s1 t2 c3'])
    })
  })

  it('drops the capture of a message that was not sent', async () => {
    const { checkpoints, calls } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.dropPending(await checkpoints.beforeTurn('s1'))
    checkpoints.turnStarted('s1', 'scheduled')
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 scheduled c2'])
    })
  })

  it('ends a running turn when its conversation leaves the panel, or the panel closes', async () => {
    const { checkpoints, calls } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await checkpoints.sessionChanged('s2')
    checkpoints.accepted(await checkpoints.beforeTurn('s2'), 't9', true)
    checkpoints.dispose()
    await vi.waitFor(() => {
      expect(calls.toSorted((a, b) => a.localeCompare(b))).toEqual([
        'end s1 t1',
        'end s2 t9',
        'record s1 t1 c1',
        'record s2 t9 c2',
      ])
    })
    // Each end came after its own record.
    expect(calls.indexOf('end s1 t1')).toBeGreaterThan(calls.indexOf('record s1 t1 c1'))
    expect(calls.indexOf('end s2 t9')).toBeGreaterThan(calls.indexOf('record s2 t9 c2'))
    // A later end for either is not recorded twice.
    checkpoints.turnCompleted('t1')
    checkpoints.turnCompleted('t9')
    expect(calls.filter((call) => call.startsWith('end'))).toHaveLength(2)
  })

  it('tells the panel only what changed', async () => {
    const { checkpoints, posted } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.postState()
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await vi.waitFor(() => {
      expect(posted.at(-1)).toMatchObject({ turnIds: ['t1'] })
    })
    const told = posted.length
    checkpoints.postState()
    expect(posted).toHaveLength(told)
    checkpoints.panelReady()
    expect(posted).toHaveLength(told + 1)
  })
})
