// M110r Y3: queued results re-send in order until acked; old epochs quarantine.
import { describe, expect, it } from 'vitest'
import { intakeResult, ResultQueue } from '../../src/core/devices/resultQueue'

const item = (id: string, epoch: number) => ({
  id,
  taskId: 't1',
  attemptId: 'a1',
  epoch,
  kind: 'result' as const,
  stepKey: `p/t1/a1/${String(epoch)}/9/abc`,
  body: { lines: 3 },
  enqueuedAtWall: 1000,
})

describe('result queue', () => {
  it('re-sends in arrival order until each is acknowledged', () => {
    const queue = new ResultQueue()
    queue.enqueue(item('r1', 3))
    queue.enqueue(item('r2', 4))
    expect(queue.pending().map((entry) => entry.id)).toEqual(['r1', 'r2'])
    queue.acknowledge('r1')
    expect(queue.pending().map((entry) => entry.id)).toEqual(['r2'])
    queue.acknowledge('unknown')
    expect(queue.pendingCount()).toBe(1)
  })
  it('round-trips through the store, and a corrupt dump changes nothing', () => {
    const queue = new ResultQueue()
    queue.enqueue(item('r1', 3))
    const restored = new ResultQueue()
    restored.load(queue.dump())
    expect(restored.pending()).toEqual(queue.pending())
    expect(() => {
      restored.load('{"queued":[{"id":1}]}')
    }).toThrow()
    expect(restored.pending()).toEqual(queue.pending())
  })
})

describe('result intake', () => {
  it('current epochs land; old epochs quarantine, never land', () => {
    expect(intakeResult(3, item('r1', 3))).toEqual({ status: 'accepted' })
    expect(intakeResult(4, item('r1', 3))).toEqual({ status: 'quarantined', reason: 'stale-epoch' })
  })
})
