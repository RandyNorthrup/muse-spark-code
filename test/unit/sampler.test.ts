import { describe, expect, it, vi } from 'vitest'
import {
  MachineResourceSampler,
  type MachineSamplerPort,
  type ResourceOptionalProbes,
} from '../../src/core/resources/sampler/machineSampler'
import {
  resourceSettingsSchema,
  type ResourceSample,
  type ResourceSettings,
} from '../../src/shared/resources'

function cpu(user = 0, idle = 0) {
  return { user, nice: 0, sys: 0, idle, irq: 0 }
}
function rig(platform: NodeJS.Platform = 'win32') {
  const files = new Map<string, string>([
    ['/proc/self/cgroup', '0::/\n'],
    ['/proc/self/mountinfo', '29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n'],
    ['/sys/fs/cgroup/memory.max', 'max\n'],
  ])
  let settings: ResourceSettings = resourceSettingsSchema.parse({})
  let time = 0
  const probes: ResourceOptionalProbes = {
    gpu: vi.fn(() => Promise.resolve(80)),
    disk: vi.fn(() => Promise.resolve(30)),
  }
  const port: MachineSamplerPort = {
    platform,
    now: () => time,
    cpus: vi.fn(() => [cpu()]),
    totalMemory: vi.fn(() => 8000),
    freeMemory: vi.fn(() => 4000),
    availableMemory: vi.fn(() => 3000),
    read: vi.fn((file: string) => Promise.resolve(files.get(file))),
    loadOptionalProbes: vi.fn(() => Promise.resolve(probes)),
  }
  return {
    port,
    probes,
    files,
    sampler: new MachineResourceSampler(port, () => settings),
    tick: (ms = 5000) => {
      time += ms
    },
    settings: (value: Partial<ResourceSettings>) => {
      settings = resourceSettingsSchema.parse({ ...settings, ...value })
    },
  }
}

async function reading<K extends keyof ResourceSample>(
  r: ReturnType<typeof rig>,
  key: K,
): Promise<ResourceSample[K]> {
  const sample = await r.sampler.sample()
  return sample[key]
}

describe('machine resource sampler', () => {
  it('starts no work at construction; uses CPU deltas even on Windows with zero loadavg', async () => {
    const r = rig()
    expect(r.port.cpus).not.toHaveBeenCalled()
    expect(r.port.read).not.toHaveBeenCalled()
    expect(r.port.loadOptionalProbes).not.toHaveBeenCalled()
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(80, 20)])
    r.tick()
    expect(await r.sampler.sample()).toMatchObject({
      atMs: 5000,
      cpuPercent: 80,
      memoryUsedPercent: 62.5,
      memoryAvailableBytes: 3000,
      memoryTotalBytes: 8000,
      pressure: null,
    })
    expect(r.port.read).not.toHaveBeenCalled()
  })

  it('weights heterogeneous CPU deltas and resets on empty, failed, changed or rolled-back counters', async () => {
    const r = rig()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(), cpu()])
    await r.sampler.sample()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(10, 90), cpu(60, 40)])
    expect(await reading(r, 'cpuPercent')).toBe(35)
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(0, 91), cpu(160, 40)])
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(100, 91)])
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockImplementationOnce(() => {
      throw new Error('unavailable')
    })
    expect(await reading(r, 'cpuPercent')).toBeNull()
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockReturnValue([])
    expect(await reading(r, 'cpuPercent')).toBeNull()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(NaN, 0)])
    expect(await reading(r, 'cpuPercent')).toBeNull()
  })

  it('keeps failed readings unknown while preserving genuine idle and exhausted-memory zeros', async () => {
    const r = rig()
    await r.sampler.sample()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(0, 100)])
    vi.mocked(r.port.availableMemory).mockReturnValue(0)
    expect(await r.sampler.sample()).toMatchObject({
      cpuPercent: 0,
      memoryAvailableBytes: 0,
      memoryUsedPercent: 100,
    })
    vi.mocked(r.port.freeMemory).mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(await r.sampler.sample()).toMatchObject({
      memoryAvailableBytes: null,
      memoryUsedPercent: null,
    })
    vi.mocked(r.port.totalMemory).mockReturnValue(NaN)
    expect(await reading(r, 'memoryTotalBytes')).toBeNull()
  })

  it('uses availableMemory on Darwin without confusing free pages or memorystatus_level with bytes', async () => {
    const r = rig('darwin')
    vi.mocked(r.port.freeMemory).mockReturnValue(10)
    expect(await r.sampler.sample()).toMatchObject({
      memoryAvailableBytes: 3000,
      memoryUsedPercent: 62.5,
    })
    expect(r.port.freeMemory).not.toHaveBeenCalled()
    vi.mocked(r.port.availableMemory).mockReturnValue(null)
    expect(await r.sampler.sample()).toMatchObject({
      memoryAvailableBytes: null,
      memoryUsedPercent: null,
    })
    expect(r.port.read).not.toHaveBeenCalled()
  })

  it('does not fabricate total, oversized, fractional or negative memory readings', async () => {
    const r = rig()
    vi.mocked(r.port.freeMemory).mockReturnValue(9000)
    vi.mocked(r.port.availableMemory).mockReturnValue(9000)
    expect(await reading(r, 'memoryAvailableBytes')).toBeNull()
    for (const invalid of [0, -1, 1.5, Infinity]) {
      vi.mocked(r.port.totalMemory).mockReturnValue(invalid)
      expect(await reading(r, 'memoryUsedPercent')).toBeNull()
    }
  })

  it('rejects invalid CPU counters and aggregate overflow rather than reporting recovery', async () => {
    for (const invalid of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const r = rig()
      await r.sampler.sample()
      vi.mocked(r.port.cpus).mockReturnValue([cpu(invalid, 100)])
      expect(await reading(r, 'cpuPercent')).toBeNull()
    }
    const r = rig()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(), cpu()])
    await r.sampler.sample()
    vi.mocked(r.port.cpus).mockReturnValue([cpu(Number.MAX_SAFE_INTEGER), cpu(1)])
    expect(await reading(r, 'cpuPercent')).toBeNull()
  })

  it('rejects malformed pressure averages and counters independently of memory readings', async () => {
    for (const invalid of [
      'avg10=NaN',
      'avg10=-1',
      'avg60=101',
      'avg300=Infinity',
      'total=-1',
      'total=0.5',
    ]) {
      const r = rig('linux')
      const field = invalid.split('=', 1)[0]!
      const fields = ['avg10=0', 'avg60=0', 'avg300=0', 'total=0'].map((value) =>
        value.startsWith(`${field}=`) ? invalid : value,
      )
      r.files.set('/proc/pressure/cpu', `some ${fields.join(' ')}`)
      expect(await reading(r, 'pressure')).toMatchObject({ cpuSomePercent: null })
      expect(await reading(r, 'memoryAvailableBytes')).toBe(3000)
    }
  })

  it('reads Linux pressure independently, retaining unknown fields on missing or malformed rows', async () => {
    const r = rig('linux')
    r.files.set('/proc/pressure/cpu', 'some avg10=12.50 avg60=10.00 avg300=3.00 total=50000\n')
    r.files.set(
      '/proc/pressure/memory',
      'some avg10=2.25 avg60=1.00 avg300=0.00 total=100\nfull avg10=0.50 avg60=0.00 avg300=0.00 total=3\n',
    )
    expect(await reading(r, 'pressure')).toEqual({
      cpuSomePercent: 12.5,
      memorySomePercent: 2.25,
      memoryFullPercent: 0.5,
    })
    r.files.set('/proc/pressure/cpu', 'some avg10=101 avg60=0 avg300=0 total=0')
    r.files.set('/proc/pressure/memory', 'some avg10=0 avg60=0 avg300=0 total=0')
    expect(await reading(r, 'pressure')).toEqual({
      cpuSomePercent: null,
      memorySomePercent: 0,
      memoryFullPercent: null,
    })
    r.files.clear()
    expect(await reading(r, 'pressure')).toBeNull()
  })

  it('uses nested container limits and parent headroom rather than host RAM', async () => {
    const r = rig('linux')
    r.files.set('/proc/self/cgroup', '0::/scope/child\n')
    r.files.set('/sys/fs/cgroup/scope/child/memory.max', '3000\n')
    r.files.set('/sys/fs/cgroup/scope/child/memory.current', '2500\n')
    r.files.set('/sys/fs/cgroup/scope/memory.max', '2000\n')
    r.files.set('/sys/fs/cgroup/scope/memory.current', '1800\n')
    expect(await r.sampler.sample()).toMatchObject({
      memoryTotalBytes: 2000,
      memoryAvailableBytes: 200,
      memoryUsedPercent: 90,
    })
    r.files.set('/sys/fs/cgroup/scope/memory.current', '2500')
    expect(await reading(r, 'memoryAvailableBytes')).toBe(0)
    r.files.delete('/sys/fs/cgroup/scope/memory.current')
    expect(await r.sampler.sample()).toMatchObject({
      memoryTotalBytes: null,
      memoryAvailableBytes: null,
      memoryUsedPercent: null,
    })
  })

  it('handles mounted cgroup subtrees and namespaces without reading outside their root', async () => {
    for (const group of ['/delegated', '/']) {
      const r = rig('linux')
      r.files.set('/proc/self/cgroup', `0::${group}\n`)
      r.files.set(
        '/proc/self/mountinfo',
        '29 23 0:26 /delegated /sys/my\\040cgroup rw - cgroup2 cgroup rw\n',
      )
      r.files.set('/sys/my cgroup/memory.max', '2000')
      r.files.set('/sys/my cgroup/memory.current', '1500')
      expect(await reading(r, 'memoryAvailableBytes')).toBe(500)
      expect(vi.mocked(r.port.read).mock.calls.map(([file]) => file)).not.toContain(
        '/sys/memory.max',
      )
    }
  })

  it('distinguishes missing root/controller attributes from denied cgroup reads', async () => {
    const r = rig('linux')
    r.files.delete('/sys/fs/cgroup/memory.max')
    expect(await reading(r, 'memoryTotalBytes')).toBe(8000)
    r.files.set('/proc/self/cgroup', '0::/scope')
    r.files.set('/sys/fs/cgroup/memory.max', '2000')
    r.files.set('/sys/fs/cgroup/memory.current', '1500')
    expect(await reading(r, 'memoryAvailableBytes')).toBe(500)
    vi.mocked(r.port.read).mockImplementation((file) =>
      Promise.resolve(file.endsWith('/scope/memory.max') ? null : r.files.get(file)),
    )
    expect(await reading(r, 'memoryAvailableBytes')).toBeNull()
  })

  it('refuses malformed cgroup paths, counters and unavailable hierarchy without treating them as unlimited', async () => {
    for (const group of ['/../../outside', '/delegated/../outside', 'relative', '/other']) {
      const r = rig('linux')
      r.files.set('/proc/self/cgroup', `0::${group}`)
      r.files.set(
        '/proc/self/mountinfo',
        '29 23 0:26 /delegated /sys/fs/cgroup rw - cgroup2 cgroup rw',
      )
      expect(await reading(r, 'memoryAvailableBytes')).toBeNull()
      expect(
        vi
          .mocked(r.port.read)
          .mock.calls.map(([file]) => file)
          .filter((file) => file.endsWith('memory.max')),
      ).toEqual([])
    }
    for (const invalid of ['0', '-1', '1.5', 'NaN', '9007199254740993', '']) {
      const r = rig('linux')
      r.files.set('/sys/fs/cgroup/memory.max', invalid)
      r.files.set('/sys/fs/cgroup/memory.current', '0')
      expect(await reading(r, 'memoryTotalBytes')).toBeNull()
    }
    const r = rig('linux')
    r.files.set('/proc/self/cgroup', '2:memory:/legacy')
    expect(await reading(r, 'memoryAvailableBytes')).toBe(3000)
    r.files.delete('/proc/self/cgroup')
    expect(await reading(r, 'memoryAvailableBytes')).toBeNull()
  })

  it('loads optional probes only when enabled and set, then clears caches when unset', async () => {
    const r = rig()
    await r.sampler.sample()
    expect(r.port.loadOptionalProbes).not.toHaveBeenCalled()
    r.settings({ gpuMaxPercent: 90 })
    expect(await r.sampler.sample()).toMatchObject({ gpuPercent: 80, diskBusyPercent: null })
    expect(r.probes.disk).not.toHaveBeenCalled()
    r.settings({ diskBusyMaxPercent: 70 })
    expect(await reading(r, 'diskBusyPercent')).toBe(30)
    expect(r.port.loadOptionalProbes).toHaveBeenCalledTimes(1)
    r.settings({ gpuMaxPercent: null, diskBusyMaxPercent: null })
    expect(await r.sampler.sample()).toMatchObject({ gpuPercent: null, diskBusyPercent: null })
    r.settings({ gpuMaxPercent: 90, diskBusyMaxPercent: 70, enabled: false })
    await r.sampler.sample()
    expect(r.probes.gpu).toHaveBeenCalledTimes(1)
    expect(r.probes.disk).toHaveBeenCalledTimes(1)
    r.settings({ enabled: true })
    await r.sampler.sample()
    expect(r.probes.gpu).toHaveBeenCalledTimes(2)
    expect(r.probes.disk).toHaveBeenCalledTimes(2)
  })

  it('bounds probe cadence, shares concurrent samples and retries unknown failed probes', async () => {
    const r = rig()
    r.settings({ gpuMaxPercent: 90, diskBusyMaxPercent: 70 })
    const first = r.sampler.sample()
    expect(r.sampler.sample()).toBe(first)
    await first
    r.tick(4999)
    await r.sampler.sample()
    expect(r.probes.gpu).toHaveBeenCalledTimes(1)
    expect(r.probes.disk).toHaveBeenCalledTimes(1)
    r.tick(1)
    vi.mocked(r.probes.gpu).mockRejectedValueOnce(new Error('lost'))
    expect(await reading(r, 'gpuPercent')).toBeNull()
    r.tick(10_000)
    vi.mocked(r.probes.disk).mockResolvedValueOnce(101)
    expect(await r.sampler.sample()).toMatchObject({ gpuPercent: 80, diskBusyPercent: null })
    expect(r.probes.disk).toHaveBeenCalledTimes(2)
    const retry = rig()
    retry.settings({ gpuMaxPercent: 90 })
    vi.mocked(retry.port.loadOptionalProbes).mockRejectedValueOnce(new Error('unavailable'))
    expect(await reading(retry, 'gpuPercent')).toBeNull()
    retry.tick()
    expect(await reading(retry, 'gpuPercent')).toBe(80)
  })
})
