// M110r Y3: leases on monotonic clocks, epoch gates, checkpoint acks, re-dispatch rules.
import { describe, expect, it } from 'vitest'
import {
  isAckFor,
  checkEpoch,
  leaseGrantSchema,
  canRedispatch,
  nodeLeaseState,
  redispatchVerdict,
  splitByEpoch,
} from '../../src/core/devices/lease'

const grant = leaseGrantSchema.parse({
  leaseId: 'l1',
  taskId: 't1',
  attemptId: 'a1',
  epoch: 3,
  leaseMs: 60_000,
  guardMs: 10_000,
  grantedAtMono: 1_000_000,
})

describe('leases', () => {
  it('the node holds, then fences, then expires on its own clock', () => {
    expect(nodeLeaseState(grant, 1_000_000)).toBe('held')
    expect(nodeLeaseState(grant, 1_000_000 + 49_999)).toBe('held')
    expect(nodeLeaseState(grant, 1_000_000 + 50_000)).toBe('fencing')
    expect(nodeLeaseState(grant, 1_000_000 + 59_999)).toBe('fencing')
    expect(nodeLeaseState(grant, 1_000_000 + 60_000)).toBe('expired')
  })
  it('the orchestrator re-dispatches only after the lease plus the guard', () => {
    expect(canRedispatch(grant, 1_000_000 + 69_999)).toBe(false)
    expect(canRedispatch(grant, 1_000_000 + 70_000)).toBe(true)
  })
  it('grants validate: no zero lease, no negative guard or epoch', () => {
    expect(() => leaseGrantSchema.parse({ ...grant, leaseId: 'l2', leaseMs: 0 })).toThrow()
    expect(() => leaseGrantSchema.parse({ ...grant, leaseId: 'l3', guardMs: -1 })).toThrow()
    expect(() => leaseGrantSchema.parse({ ...grant, leaseId: 'l4', epoch: -1 })).toThrow()
  })
})

describe('checkpoints', () => {
  const checkpoint = {
    taskId: 't1',
    attemptId: 'a1',
    epoch: 3,
    step: 9,
    digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  }
  it('an ack names the same task, attempt, epoch, step and digest', () => {
    expect(isAckFor(checkpoint, { ...checkpoint })).toBe(true)
    expect(isAckFor(checkpoint, { ...checkpoint, step: 8 })).toBe(false)
    expect(isAckFor(checkpoint, { ...checkpoint, epoch: 2 })).toBe(false)
    expect(isAckFor(checkpoint, { ...checkpoint, digest: '0'.repeat(64) })).toBe(false)
  })
})

describe('epoch gates', () => {
  it('an old epoch is stale; the current one passes', () => {
    expect(checkEpoch(3, 2)).toBe('stale')
    expect(checkEpoch(3, 3)).toBe('current')
    expect(checkEpoch(3, 4)).toBe('current')
  })
  it('pre-admission splits stale attempts out before any gate', () => {
    const split = splitByEpoch(
      [
        { id: 'a-old', epoch: 2 },
        { id: 'a-now', epoch: 3 },
      ],
      3,
    )
    expect(split.current.map((candidate) => candidate.id)).toEqual(['a-now'])
    expect(split.stale.map((candidate) => candidate.id)).toEqual(['a-old'])
  })
})

describe('re-dispatch', () => {
  it('ready only past the lease, fenced, and certain', () => {
    expect(
      redispatchVerdict({ leaseExpired: true, fencedSinceCheckpoint: true, uncertain: false }),
    ).toBe('ready')
    expect(
      redispatchVerdict({ leaseExpired: false, fencedSinceCheckpoint: true, uncertain: false }),
    ).toBe('wait')
    expect(
      redispatchVerdict({ leaseExpired: true, fencedSinceCheckpoint: false, uncertain: false }),
    ).toBe('wait')
  })
  it('an uncertain attempt never re-dispatches by itself', () => {
    expect(
      redispatchVerdict({ leaseExpired: true, fencedSinceCheckpoint: true, uncertain: true }),
    ).toBe('uncertain-needs-person')
  })
})
