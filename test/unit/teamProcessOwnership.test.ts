import { describe, expect, it, vi } from 'vitest'
import { createProcessOwnership, type ProcessIdentity } from '../../src/host/team/processOwnership'

const id = '11111111-1111-4111-8111-111111111111'
const leader: ProcessIdentity = {
  pid: 42,
  group: '42',
  startTime: 'boot:123',
  launchId: id,
  executable: '/fixture/worker',
  uid: 501,
}
const member: ProcessIdentity = { ...leader, pid: 43, startTime: 'boot:124' }

function fixture() {
  const table = new Map([
    [leader.pid, leader],
    [member.pid, member],
  ])
  const observe = vi.fn((pid: number) => Promise.resolve(table.get(pid)))
  const scan = vi.fn(() =>
    Promise.resolve(Array.from(table.values(), (identity) => ({ ...identity }))),
  )
  const signal = vi.fn(() => Promise.resolve(true))
  return {
    table,
    observe,
    scan,
    signal,
    ownership: createProcessOwnership({ observe, scan, signal }),
  }
}

describe('M96 K signal-time ownership', () => {
  for (const isLeaderOwned of [false, true]) {
    it(`macOS group signals require a final owned leader: ${String(isLeaderOwned)}`, async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('platform descriptor missing')
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      try {
        const f = fixture()
        if (isLeaderOwned) {
          const observe = f.observe.getMockImplementation()
          if (observe === undefined) throw new Error('observer missing')
          f.observe
            .mockImplementationOnce(observe)
            .mockImplementationOnce(() => Promise.resolve({ ...leader, startTime: 'reused' }))
        } else f.table.set(leader.pid, { ...leader, launchId: undefined })
        const result = await f.ownership.signal(isLeaderOwned ? leader : member, 'SIGTERM')
        if (isLeaderOwned) {
          expect(result.signalled).toEqual([])
          expect(f.signal).not.toHaveBeenCalled()
        } else {
          expect(result).toEqual({ signalled: [member.pid], notOwned: [leader.pid] })
          expect(f.signal).toHaveBeenCalledWith(member, 'SIGTERM', false)
        }
      } finally {
        Object.defineProperty(process, 'platform', platform)
      }
    })
  }
  for (const field of ['pid', 'startTime', 'group', 'launchId', 'executable', 'uid'] as const) {
    it(`refuses a changed ${field} immediately before a signal`, async () => {
      const f = fixture()
      f.table.set(leader.pid, {
        ...leader,
        ...(field === 'pid' && { pid: 99 }),
        ...(field === 'startTime' && { startTime: 'reused' }),
        ...(field === 'group' && { group: '99' }),
        ...(field === 'launchId' && { launchId: 'different' }),
        ...(field === 'executable' && { executable: '/foreign/program' }),
        ...(field === 'uid' && { uid: 502 }),
      })
      expect(await f.ownership.signal(leader, 'SIGTERM')).toEqual({
        signalled: [],
        notOwned: [leader.pid],
      })
      expect(f.signal).not.toHaveBeenCalled()
    })
  }

  it('rechecks each member after enumeration and reports changed membership as unowned', async () => {
    const f = fixture()
    f.scan.mockImplementation(() => {
      f.table.set(member.pid, { ...member, startTime: 'reused' })
      return Promise.resolve([leader, member])
    })
    const result = await f.ownership.signal(leader, 'SIGTERM')
    if (process.platform === 'darwin') {
      expect(result).toEqual({ signalled: [leader.pid], notOwned: [] })
      expect(f.signal).toHaveBeenCalledWith(leader, 'SIGTERM', true)
    } else {
      expect(result).toEqual({ signalled: [leader.pid], notOwned: [member.pid] })
      expect(f.signal.mock.calls).toHaveLength(1)
    }
  })

  it('a marked member never authorizes its foreign leader or unmarked siblings', async () => {
    const f = fixture()
    f.table.set(leader.pid, { ...leader, launchId: undefined })
    f.table.set(44, { ...member, pid: 44, startTime: 'foreign-sibling', launchId: undefined })
    expect(await f.ownership.signal(member, 'SIGTERM')).toEqual({
      signalled: [member.pid],
      notOwned: [leader.pid, 44],
    })
    expect(f.signal).toHaveBeenCalledWith(member, 'SIGTERM', false)
    expect(f.signal).toHaveBeenCalledTimes(1)
  })

  it('a launch marker never substitutes for recorded executable and UID', async () => {
    const f = fixture()
    const { executable: _executable, uid: _uid, ...legacy } = leader
    f.table.set(leader.pid, legacy)
    expect(await f.ownership.signalLaunch(legacy, 'SIGTERM')).toMatchObject({ signalled: [] })
    expect(f.signal).not.toHaveBeenCalled()
  })

  it('an exact journal identity may authorize one unmarked process', async () => {
    const f = fixture()
    const unmarked = { ...member, launchId: undefined }
    f.table.set(member.pid, unmarked)
    f.table.set(leader.pid, { ...leader, launchId: undefined })
    expect(await f.ownership.signal(unmarked, 'SIGTERM')).toEqual({
      signalled: [member.pid],
      notOwned: [leader.pid],
    })
    expect(f.signal).toHaveBeenCalledWith(unmarked, 'SIGTERM', false)
  })

  it('retirement reports unrecorded marked survivors after the group leader has exited', async () => {
    const f = fixture()
    f.table.delete(leader.pid)
    expect(await f.ownership.signalLaunch(leader, 'SIGTERM')).toEqual({
      signalled: [],
      notOwned: [member.pid, leader.pid],
    })
    expect(f.signal).not.toHaveBeenCalled()
    expect(await f.ownership.signal(leader, 'SIGTERM')).toEqual({
      signalled: [],
      notOwned: [leader.pid],
    })
  })
})
