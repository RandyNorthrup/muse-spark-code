// The busiest-device finish shared by the Linux and macOS disk deltas:
// counters only, no OS surface, so plain counter maps drive it.
import { describe, expect, it } from 'vitest'
import { finishDiskDelta } from '../../src/core/resources/sampler/diskDelta'

describe('finishDiskDelta', () => {
  it('baselines first, then reads the busiest device as a percent', () => {
    const first = finishDiskDelta(undefined, 0, new Map([['8:0:sda', 1000]]))
    expect(first.busy).toBeNull()
    expect(first.store).toEqual({ atMs: 0, counters: new Map([['8:0:sda', 1000]]) })
    // 500 ms of busy time over 5,000 ms of wall time: 10 %.
    const second = finishDiskDelta(first.store, 5000, new Map([['8:0:sda', 1500]]))
    expect(second.busy).toBe(10)
    expect(second.store?.atMs).toBe(5000)
  })

  it('caps at 100 and fails closed on bad time, changed sets and regressed counters', () => {
    const before = { atMs: 0, counters: new Map([['8:0:sda', 1000]]) }
    // Ten seconds of busy time in one second of wall time: capped.
    expect(finishDiskDelta(before, 1000, new Map([['8:0:sda', 11_000]])).busy).toBe(100)
    // Still or reversed time rebaselines to unknown.
    expect(finishDiskDelta(before, 0, new Map([['8:0:sda', 1500]])).busy).toBeNull()
    // A changed device set rebaselines to unknown.
    expect(
      finishDiskDelta(
        before,
        5000,
        new Map([
          ['8:0:sda', 1500],
          ['8:16:sdb', 10],
        ]),
      ).busy,
    ).toBeNull()
    // A regressed counter rebaselines to unknown.
    expect(finishDiskDelta(before, 5000, new Map([['8:0:sda', 900]])).busy).toBeNull()
    // No counters is unknown with no baseline.
    const empty = finishDiskDelta(before, 5000, new Map())
    expect(empty.busy).toBeNull()
    expect(empty.store).toBeUndefined()
  })
})
