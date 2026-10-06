import { describe, expect, it, vi } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
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
  const inspect = vi.fn(() =>
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
    f.inspect.mockImplementation(async () => {
      const value = await read()
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
