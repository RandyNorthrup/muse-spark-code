import { describe, expect, it, vi } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
import type {
  ResourceActuatorPort,
  ResourceControl,
} from '../../src/core/resources/actuators/controls'
import type { ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'

const ticket: ResourceTicket = {
  id: 'owned',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'group', pgid: 710 },
  kind: 'check',
  class: 'background',
  sessionId: null,
}
function fixture(input = ticket) {
  const tree = new FakeResourceTree()
  tree.register(input)
  tree.put(input.id, input.root, { cpuSeconds: 1, residentBytes: 100 })
  let value = '100'
  const read = vi.fn(() => Promise.resolve<string | null>(value))
  const write = vi.fn((next: string) => {
    value = next
    return Promise.resolve<string | null>(value)
  })
  const control: ResourceControl = {
    key: 'weight',
    name: 'cpuWeight',
    identity: null,
    reversible: true,
    minimumLevel: 'throttle',
    read,
    write,
    lower: (level) => (level === 'pause' ? '1' : '2'),
    close: vi.fn(() => Promise.resolve()),
  }
  const port: ResourceActuatorPort = { controls: vi.fn(() => Promise.resolve([{ ...control }])) }
  const actuators = new ResourceActuators(tree, port)
  return { tree, control, port, actuators, read, write, value: () => value }
}

function failWrite(
  write: ReturnType<typeof fixture>['write'],
  failure: 'null' | 'mismatch' | 'throw',
) {
  write.mockImplementationOnce(() =>
    failure === 'throw'
      ? Promise.reject(new Error('failed'))
      : Promise.resolve(failure === 'null' ? null : 'different'),
  )
}

describe('resource actuator authority and recovery', () => {
  it('refuses unregistered tickets before opening any controls', async () => {
    const f = fixture()
    expect(await f.actuators.setLevel({ ...ticket, id: 'foreign' }, 'pause')).toEqual([
      { control: null, status: 'unknown' },
    ])
    expect(f.port.controls).not.toHaveBeenCalled()
    expect(f.write).not.toHaveBeenCalled()
  })
  it('never throttles foreground work at any level', async () => {
    const launch = { ...ticket, class: 'foreground' } as const
    const f = fixture(launch)
    for (const level of ['normal', 'throttle', 'relocate', 'pause'] as const)
      expect(await f.actuators.setLevel(launch, level)).toEqual([])
    expect(f.port.controls).not.toHaveBeenCalled()
  })
  it('lowers Muse Code only at pause and restores as soon as it drops', async () => {
    const launch = { ...ticket, kind: 'museServe', class: 'foreground' } as const
    const f = fixture(launch)
    await f.actuators.setLevel(launch, 'throttle')
    await f.actuators.setLevel(launch, 'relocate')
    expect(f.write).not.toHaveBeenCalled()
    expect(await f.actuators.setLevel(launch, 'pause')).toEqual([
      { control: 'cpuWeight', status: 'applied' },
    ])
    expect(await f.actuators.setLevel(launch, 'relocate')).toEqual([
      { control: 'cpuWeight', status: 'restored' },
    ])
    expect(f.value()).toBe('100')
  })
  it('keeps one original through escalation, recovery, and retirement', async () => {
    const f = fixture()
    await f.actuators.setLevel(ticket, 'throttle')
    await f.actuators.setLevel(ticket, 'pause')
    await f.actuators.setLevel(ticket, 'throttle')
    expect(f.value()).toBe('2')
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(await f.actuators.retire(ticket)).toEqual({
      retired: true,
      results: [{ control: 'cpuWeight', status: 'restored' }],
    })
    expect(f.value()).toBe('100')
    expect(f.actuators).toHaveProperty('trees.size', 0)
    expect(f.actuators).toHaveProperty('pending.size', 0)
  })
  it('applies irreversible controls only at pause and records their lifetime residual', async () => {
    const f = fixture()
    Object.assign(f.control, { minimumLevel: 'pause', reversible: false, name: 'nice' })
    await f.actuators.setLevel(ticket, 'throttle')
    expect(f.write).not.toHaveBeenCalled()
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'lifetimeLowered' },
    ])
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.value()).toBe('1')
  })
  it.each(['null', 'mismatch', 'throw'] as const)(
    'keeps unconfirmed irreversible %s attempts unknown during recovery and retirement',
    async (failure) => {
      const f = fixture()
      Object.assign(f.control, { minimumLevel: 'pause', reversible: false, name: 'nice' })
      failWrite(f.write, failure)
      expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
        { control: 'nice', status: 'unknown' },
      ])
      expect(await f.actuators.setLevel(ticket, 'normal')).toEqual([
        { control: 'nice', status: 'unknown' },
      ])
      expect(await f.actuators.retire(ticket)).toEqual({
        retired: false,
        results: [{ control: 'nice', status: 'unknown' }],
      })
      expect(f.write).toHaveBeenCalledTimes(1)
      expect(f.value()).toBe('100')
    },
  )
  it('never promotes an unconfirmed irreversible write even if a later read sees the target', async () => {
    const f = fixture()
    Object.assign(f.control, { minimumLevel: 'pause', reversible: false, name: 'nice' })
    const write = f.write.getMockImplementation()!
    f.write.mockImplementationOnce(async (next) => {
      await write(next)
      return null
    })
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'unknown' },
    ])
    expect(f.value()).toBe('1')
    expect(await f.actuators.retire(ticket)).toEqual({
      retired: false,
      results: [{ control: 'nice', status: 'unknown' }],
    })
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'unknown' },
    ])
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('reproves confirmed irreversible policy on recovery without another mutation', async () => {
    const f = fixture()
    Object.assign(f.control, { minimumLevel: 'pause', reversible: false, name: 'nice' })
    await f.actuators.setLevel(ticket, 'pause')
    f.read.mockResolvedValueOnce('100')
    expect(await f.actuators.setLevel(ticket, 'normal')).toEqual([
      { control: 'nice', status: 'unknown' },
    ])
    f.tree.remove(ticket.root.pid)
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', false)
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('requires a fresh known prior state before retrying an irreversible mutation', async () => {
    const f = fixture()
    Object.assign(f.control, { minimumLevel: 'pause', reversible: false, name: 'nice' })
    f.write.mockResolvedValueOnce(null)
    await f.actuators.setLevel(ticket, 'pause')
    f.read.mockResolvedValueOnce(null)
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'unknown' },
    ])
    expect(f.write).toHaveBeenCalledTimes(1)
    f.read.mockResolvedValueOnce('different')
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'unknown' },
    ])
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'nice', status: 'lifetimeLowered' },
    ])
    expect(f.value()).toBe('1')
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.write).toHaveBeenCalledTimes(2)
  })
  it.each(['null', 'mismatch', 'throw'] as const)(
    'reports failed %s readback as unknown and retains the original for recovery',
    async (failure) => {
      const f = fixture()
      failWrite(f.write, failure)
      expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
        { control: 'cpuWeight', status: 'unknown' },
      ])
      expect(await f.actuators.setLevel(ticket, 'normal')).toEqual([
        { control: 'cpuWeight', status: 'restored' },
      ])
      expect(f.write).toHaveBeenLastCalledWith('100', ticket.root)
    },
  )
  it('does not dispatch when the original reading is unknown', async () => {
    const f = fixture()
    f.read.mockRejectedValueOnce(new Error('unavailable'))
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'cpuWeight', status: 'unknown' },
    ])
    expect(f.write).not.toHaveBeenCalled()
  })
  it('does not dispatch when the original reading is null', async () => {
    const f = fixture()
    f.read.mockResolvedValueOnce(null)
    expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
      { control: 'cpuWeight', status: 'unknown' },
    ])
    expect(f.write).not.toHaveBeenCalled()
  })
  it('refuses a recycled identity between snapshot and mutation, including recovery', async () => {
    const f = fixture()
    f.read.mockImplementationOnce(() => {
      f.tree.put(
        ticket.id,
        { ...ticket.root, startTime: 'reused' },
        { cpuSeconds: 0, residentBytes: 0 },
      )
      return Promise.resolve('100')
    })
    expect(await f.actuators.setLevel(ticket, 'pause')).toEqual([
      { control: 'cpuWeight', status: 'unknown' },
    ])
    expect(f.write).not.toHaveBeenCalled()
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', false)
    expect(f.write).not.toHaveBeenCalled()
  })
  it('keeps failed restoration retryable and never releases its handles as retired', async () => {
    const f = fixture()
    await f.actuators.setLevel(ticket, 'throttle')
    f.write.mockRejectedValueOnce(new Error('readback failed'))
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', false)
    expect(f.actuators).toHaveProperty('trees.size', 1)
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
    expect(f.value()).toBe('100')
  })
  it('keeps a failed handle close retryable after restoring policy', async () => {
    const f = fixture()
    await f.actuators.setLevel(ticket, 'throttle')
    vi.mocked(f.control.close).mockRejectedValueOnce(new Error('close failed'))
    expect(await f.actuators.retire(ticket)).toEqual({
      retired: false,
      results: [
        { control: 'cpuWeight', status: 'restored' },
        { control: null, status: 'unknown' },
      ],
    })
    expect(f.actuators).toHaveProperty('trees.size', 1)
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
  })
  it('serializes an in-flight mutation with retirement so nothing lowers after restoration', async () => {
    const f = fixture()
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<string>()
    f.write.mockImplementationOnce(() => {
      started.resolve(undefined)
      return finish.promise
    })
    const apply = f.actuators.setLevel(ticket, 'throttle')
    await started.promise
    const retire = f.actuators.retire(ticket)
    await new Promise((resolve) => setImmediate(resolve))
    expect(f.write).toHaveBeenCalledTimes(1)
    finish.resolve('2')
    await apply
    expect(await retire).toHaveProperty('retired', true)
    expect(f.write).toHaveBeenLastCalledWith('100', ticket.root)
    expect(f.actuators).toHaveProperty('pending.size', 0)
  })
  it('refuses a different ticket sharing an active snapshot id', async () => {
    const f = fixture()
    await f.actuators.setLevel(ticket, 'throttle')
    expect(await f.actuators.setLevel({ ...ticket, kind: 'worker' }, 'pause')).toEqual([
      { control: null, status: 'unknown' },
    ])
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('reports missing controls and adapter failures as unknown', async () => {
    const f = fixture()
    vi.mocked(f.port.controls)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('unsupported scope'))
    for (const level of ['throttle', 'pause'] as const)
      expect(await f.actuators.setLevel(ticket, level)).toEqual([
        { control: null, status: 'unknown' },
      ])
    expect(f.write).not.toHaveBeenCalled()
  })
  it('returns only fixed result codes without ticket, identity or saved values', async () => {
    const f = fixture()
    const result = await f.actuators.setLevel(ticket, 'throttle')
    expect(JSON.stringify(result)).toBe('[{"control":"cpuWeight","status":"applied"}]')
  })
  it('releases completed-tree handles only after independent retirement proof, never from an unknown reading', async () => {
    const f = fixture()
    await f.actuators.setLevel(ticket, 'throttle')
    f.tree.remove(ticket.root.pid)
    expect(await f.actuators.retire(ticket)).toHaveProperty('retired', false)
    const completed = vi.fn(() => Promise.resolve(false))
    expect(await f.actuators.releaseCompleted(ticket, { hasCompleted: completed })).toBe(false)
    expect(f.actuators).toHaveProperty('trees.size', 1)
    completed.mockRejectedValueOnce(new Error('retirement unknown'))
    expect(await f.actuators.releaseCompleted(ticket, { hasCompleted: completed })).toBe(false)
    completed.mockResolvedValue(true)
    expect(
      await f.actuators.releaseCompleted(
        { ...ticket, kind: 'worker' },
        { hasCompleted: completed },
      ),
    ).toBe(false)
    expect(await f.actuators.releaseCompleted(ticket, { hasCompleted: completed })).toBe(true)
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.actuators).toHaveProperty('trees.size', 0)
  })
})
