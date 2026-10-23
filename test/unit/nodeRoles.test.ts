// M110a R1: the worker's intake admits only framed, paired, current-epoch
// tasks, and refuses everything else before touching task state.
import { describe, expect, it } from 'vitest'
import { admitTask, EphemeralPairDirectory } from '../../src/core/devices/roles'

const FRAME = {
  pairId: 'pair-home',
  taskId: 'task-9',
  attemptId: 'attempt-2',
  epoch: 4,
  body: { kind: 'm96-check', lane: 'pool-1' },
}

describe('worker intake', () => {
  it('admits a framed task from a paired pair at the current epoch', () => {
    const directory = new EphemeralPairDirectory()
    directory.add('pair-home')
    expect(admitTask(FRAME, directory, 4)).toEqual({
      admitted: true,
      ticket: { pairId: 'pair-home', taskId: 'task-9', attemptId: 'attempt-2', epoch: 4 },
    })
  })
  it('refuses unknown pairs and says only which pair it was', () => {
    const directory = new EphemeralPairDirectory()
    expect(admitTask(FRAME, directory, 4)).toEqual({
      admitted: false,
      reason: 'unknown-pair',
      detail: 'pair-home',
    })
    directory.add('pair-home')
    expect(directory.delete('pair-home')).toBe(true)
    expect(admitTask(FRAME, directory, 4).admitted).toBe(false)
  })
  it('refuses stale epochs with both numbers, and malformed frames with nothing echoed', () => {
    const directory = new EphemeralPairDirectory()
    directory.add('pair-home')
    expect(admitTask({ ...FRAME, epoch: 3 }, directory, 4)).toEqual({
      admitted: false,
      reason: 'stale-epoch',
      detail: 'task-9 epoch 3, current 4',
    })
    const bad = admitTask({ ...FRAME, taskId: 42, pairId: 'x'.repeat(5000) }, directory, 4)
    expect(bad).toEqual({ admitted: false, reason: 'bad-frame' })
  })
})
