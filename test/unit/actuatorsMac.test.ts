import { describe, expect, it, vi } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
import type { ResourceMemberStatePort } from '../../src/core/resources/actuators/controls'
import { MacResourceActuator, type MacPolicyPort } from '../../src/core/resources/actuators/mac'
import type { ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'

const ticket: ResourceTicket = {
  id: 'mac',
  root: { pid: 910, startTime: '1234567890' },
  scope: { type: 'group', pgid: 910 },
  kind: 'worker',
  class: 'background',
  sessionId: null,
}
function fixture(isReversible = true, isBackground = false) {
  const tree = new FakeResourceTree()
  tree.register(ticket)
  tree.put(ticket.id, ticket.root, { cpuSeconds: 1, residentBytes: 100 })
  const inspect = vi.fn<MacPolicyPort['inspect']>(() =>
    Promise.resolve({ ...ticket.root, pgid: 910, externalBackground: isBackground }),
  )
  const run = vi.fn<MacPolicyPort['run']>((_ticket, _identity, _file, args) => {
    isBackground = args[0] === '-b'
    return Promise.resolve()
  })
  const port = new MacResourceActuator({
    registry: tree,
    policy: { inspect, run },
    reversible: isReversible,
  })
  return { tree, inspect, run, port, actuators: new ResourceActuators(tree, port) }
}
describe('macOS external background policy', () => {
  it('sets and reads back taskpolicy, restoring only the original external flag', async () => {
    const f = fixture()
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'taskpolicy', status: 'applied' },
    ])
    expect(f.run).toHaveBeenLastCalledWith(ticket, ticket.root, '/usr/sbin/taskpolicy', [
      '-b',
      '-p',
      '910',
    ])
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.run).toHaveBeenLastCalledWith(ticket, ticket.root, '/usr/sbin/taskpolicy', [
      '-B',
      '-p',
      '910',
    ])
  })
  it.each(['exited', 'zombie'] as const)(
    'drops a verified %s member without blocking recovery or retirement of the living root',
    async (exit) => {
      const f = fixture()
      const child = { pid: 911, startTime: '1234567891' }
      f.tree.put(ticket.id, child, { cpuSeconds: 1, residentBytes: 100 })
      const background = new Map<number, boolean>()
      f.inspect.mockImplementation((identity) =>
        Promise.resolve({
          ...identity,
          pgid: 910,
          externalBackground: background.get(identity.pid) ?? false,
        }),
      )
      f.run.mockImplementation((_ticket, identity, _file, args) => {
        background.set(identity.pid, args[0] === '-b')
        return Promise.resolve()
      })
      let hasExited = false
      const state = vi.fn<ResourceMemberStatePort['state']>((_ticket, identity) =>
        Promise.resolve(hasExited && identity.pid === child.pid ? 'exited' : 'alive'),
      )
      const actuators = new ResourceActuators(f.tree, f.port, { state })
      expect(await actuators.setLevel(ticket, 'throttle')).toEqual([
        { control: 'taskpolicy', status: 'applied' },
        { control: 'taskpolicy', status: 'applied' },
      ])
      hasExited = true
      if (exit === 'exited') f.tree.remove(child.pid)
      expect(await actuators.setLevel(ticket, 'normal')).toEqual([
        { control: 'taskpolicy', status: 'restored' },
      ])
      expect(await actuators.setLevel(ticket, 'normal')).toEqual([
        { control: 'taskpolicy', status: 'unchanged' },
      ])
      expect(await actuators.retire(ticket)).toHaveProperty('retired', true)
      expect(background.get(ticket.root.pid)).toBe(false)
      expect(f.run.mock.calls.filter(([, identity]) => identity.pid === child.pid)).toHaveLength(1)
      expect(state).toHaveBeenCalledWith(ticket, child)
    },
  )
  it.each(['unknown', 'throw'] as const)(
    'retains departed-member controls when exit proof is %s',
    async (failure) => {
      const f = fixture()
      let hasDeparted = false
      const state = vi.fn<ResourceMemberStatePort['state']>(() => {
        if (hasDeparted && failure === 'throw') throw new Error('exit unavailable')
        return Promise.resolve(hasDeparted ? 'unknown' : 'alive')
      })
      const actuators = new ResourceActuators(f.tree, f.port, { state })
      await actuators.setLevel(ticket, 'throttle')
      hasDeparted = true
      f.tree.remove(ticket.root.pid)
      expect(await actuators.retire(ticket)).toHaveProperty('retired', false)
      expect(actuators).toHaveProperty('trees.size', 1)
      expect(f.run).toHaveBeenCalledTimes(1)
    },
  )
  it('does not change a still-visible member while its state reading is unknown', async () => {
    const f = fixture()
    const state = vi.fn<ResourceMemberStatePort['state']>(() => Promise.resolve('unknown'))
    const actuators = new ResourceActuators(f.tree, f.port, { state })
    expect(await actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'taskpolicy', status: 'unknown' },
    ])
    expect(f.run).not.toHaveBeenCalled()
    state.mockResolvedValue('alive')
    expect(await actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'taskpolicy', status: 'applied' },
    ])
  })
  it('retries releasing an exited member when its control close fails', async () => {
    const f = fixture()
    const close = vi.fn(() => Promise.resolve())
    const opened = await f.port.controls(ticket)
    const controls = opened.map((control) => ({ ...control, close }))
    vi.spyOn(f.port, 'controls').mockResolvedValue(controls)
    const state = vi.fn<ResourceMemberStatePort['state']>(() => Promise.resolve('alive'))
    const actuators = new ResourceActuators(f.tree, f.port, { state })
    await actuators.setLevel(ticket, 'throttle')
    f.tree.remove(ticket.root.pid)
    state.mockResolvedValue('exited')
    close.mockRejectedValueOnce(new Error('close failed'))
    expect(await actuators.retire(ticket)).toEqual({
      retired: false,
      results: [{ control: 'taskpolicy', status: 'unknown' }],
    })
    expect(actuators).toHaveProperty('trees.size', 1)
    expect(await actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(close).toHaveBeenCalledTimes(2)
    expect(f.run).toHaveBeenCalledTimes(1)
  })
  it('preserves an existing external background policy without undoing it', async () => {
    const f = fixture(true, true)
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'taskpolicy', status: 'unchanged' },
    ])
    await f.actuators.retire(ticket)
    expect(f.run).not.toHaveBeenCalled()
  })
  it('uses an unqualified platform only at pause, retaining its lifetime policy', async () => {
    const f = fixture(false)
    await f.actuators.setLevel(ticket, 'throttle')
    expect(f.run).not.toHaveBeenCalled()
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'taskpolicy', status: 'lifetimeLowered' },
    ])
    await f.actuators.retire(ticket)
    expect(f.run).toHaveBeenCalledTimes(1)
  })
  it.each(['birth', 'group', 'pid', 'malformed'] as const)(
    'refuses mismatched native %s before running taskpolicy',
    async (field) => {
      const f = fixture()
      const policy = { ...ticket.root, pgid: 910, externalBackground: false }
      const replacements = {
        birth: { startTime: 'reused' },
        group: { pgid: 999 },
        pid: { pid: 999 },
        malformed: { pgid: -1 },
      }
      Object.assign(policy, replacements[field])
      f.inspect.mockResolvedValue(policy)
      expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
        { control: 'taskpolicy', status: 'unknown' },
      ])
      expect(f.run).not.toHaveBeenCalled()
    },
  )
  it('reports a failed boundary command or readback as unknown', async () => {
    const f = fixture()
    f.run.mockRejectedValueOnce(new Error('native refusal'))
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'taskpolicy', status: 'unknown' },
    ])
    f.run.mockImplementationOnce(() => Promise.resolve())
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'taskpolicy', status: 'unknown' },
    ])
  })
  it('refuses policy changes after registry membership is lost at the final boundary', async () => {
    const f = fixture()
    const read = f.inspect.getMockImplementation()!
    f.inspect.mockImplementation(async (identity) => {
      const value = await read(identity)
      if (f.inspect.mock.calls.length === 2) f.tree.remove(ticket.root.pid)
      return value
    })
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'taskpolicy', status: 'unknown' },
    ])
    expect(f.run).not.toHaveBeenCalled()
  })
  it('rejects unexpected native policy fields before any command', async () => {
    const f = fixture()
    const policy = { ...ticket.root, pgid: 910, externalBackground: false, path: 'private-canary' }
    f.inspect.mockResolvedValueOnce(policy)
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'taskpolicy', status: 'unknown' },
    ])
    expect(f.run).not.toHaveBeenCalled()
  })
  it('requires the process group rather than a guessed scope', async () => {
    const f = fixture()
    await expect(
      f.port.controls({ ...ticket, scope: { type: 'job', name: 'other' } }),
    ).rejects.toThrow('group')
  })
  it('refuses an invalid requested policy before running a command', async () => {
    const f = fixture()
    const controls = await f.port.controls(ticket)
    expect(await controls[0]!.write('invalid', ticket.root)).toBeNull()
    expect(f.run).not.toHaveBeenCalled()
  })
})
