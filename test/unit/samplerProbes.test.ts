import { describe, expect, it, vi } from 'vitest'
import {
  createOptionalResourceProbes,
  type ResourceProbePort,
} from '../../src/core/resources/sampler/optionalProbes'

function rig(platform: NodeJS.Platform = 'linux') {
  let atMs = 0
  const files = new Map<string, string>()
  const port: ResourceProbePort = {
    platform,
    monotonicMs: () => atMs,
    read: vi.fn((file: string) => Promise.resolve(files.get(file))),
    list: vi.fn(() => Promise.resolve(['card0', 'card1', 'card0-DP-1'])),
    executable: vi.fn(() => Promise.resolve<string | null>(null)),
    run: vi.fn(() => Promise.resolve<string | null>(null)),
  }
  return {
    port,
    files,
    probes: createOptionalResourceProbes(port),
    tick: (ms = 15_000) => {
      atMs += ms
    },
  }
}
function disk(name: string, ioMs: number, minor = 0) {
  return `8 ${String(minor)} ${name} 0 0 0 0 0 0 0 0 0 ${String(ioMs)} 0\n`
}

describe('optional resource probes', () => {
  it('starts no discovery at construction and uses Linux GPU busy files without connectors', async () => {
    const r = rig()
    expect(r.port.list).not.toHaveBeenCalled()
    expect(r.port.executable).not.toHaveBeenCalled()
    r.files.set('/sys/class/drm/card0/device/gpu_busy_percent', '20\n')
    r.files.set('/sys/class/drm/card1/device/gpu_busy_percent', '80\n')
    expect(await r.probes.gpu()).toBe(80)
    expect(r.port.read).toHaveBeenCalledTimes(2)
    expect(r.port.executable).toHaveBeenCalledWith('nvidia-smi')
    expect(r.port.run).not.toHaveBeenCalled()
  })

  it('rejects failed or malformed GPU files rather than calling them idle', async () => {
    const r = rig()
    for (const invalid of ['101', '-1', 'NaN', '', '20 trailing', 'Infinity']) {
      r.files.set('/sys/class/drm/card0/device/gpu_busy_percent', invalid)
      expect(await r.probes.gpu()).toBeNull()
    }
    vi.mocked(r.port.read).mockResolvedValue(null)
    expect(await r.probes.gpu()).toBeNull()
    expect(r.port.run).not.toHaveBeenCalled()
  })

  it('uses installed absolute nvidia-smi with argument arrays and the busiest returned GPU', async () => {
    const r = rig()
    vi.mocked(r.port.executable).mockResolvedValue('/usr/bin/nvidia-smi')
    vi.mocked(r.port.run).mockResolvedValue('0\n75\n25\n')
    expect(await r.probes.gpu()).toBe(75)
    expect(r.port.run).toHaveBeenCalledWith('/usr/bin/nvidia-smi', [
      '--query-gpu=utilization.gpu',
      '--format=csv,noheader,nounits',
    ])
    for (const invalid of ['N/A', '', '0\n101', '0\n-1', 'NaN']) {
      vi.mocked(r.port.run).mockResolvedValue(invalid)
      expect(await r.probes.gpu()).toBeNull()
    }
    vi.mocked(r.port.run).mockResolvedValue(null)
    expect(await r.probes.gpu()).toBeNull()
  })

  it('merges independently probed Nvidia and DRM GPUs and keeps failed installed probes unknown', async () => {
    const r = rig()
    r.files.set('/sys/class/drm/card0/device/gpu_busy_percent', '5')
    vi.mocked(r.port.executable).mockResolvedValue('/usr/bin/nvidia-smi')
    vi.mocked(r.port.run).mockResolvedValue('95\n')
    expect(await r.probes.gpu()).toBe(95)
    expect(r.port.run).toHaveBeenCalledWith('/usr/bin/nvidia-smi', [
      '--query-gpu=utilization.gpu',
      '--format=csv,noheader,nounits',
    ])
    r.files.set('/sys/class/drm/card0/device/gpu_busy_percent', '98')
    expect(await r.probes.gpu()).toBe(98)
    for (const failed of [null, '', 'N/A', '95\n101']) {
      vi.mocked(r.port.run).mockResolvedValue(failed)
      expect(await r.probes.gpu()).toBeNull()
    }
    vi.mocked(r.port.executable).mockResolvedValue('./nvidia-smi')
    expect(await r.probes.gpu()).toBeNull()
    vi.mocked(r.port.executable).mockResolvedValue(null)
    expect(await r.probes.gpu()).toBe(98)
  })

  it('refuses relative executables for nvidia and Windows counters', async () => {
    const linux = rig()
    vi.mocked(linux.port.executable).mockResolvedValue('./nvidia-smi')
    expect(await linux.probes.gpu()).toBeNull()
    expect(linux.port.run).not.toHaveBeenCalled()
    const windows = rig('win32')
    vi.mocked(windows.port.executable).mockImplementation((name) =>
      Promise.resolve(name === 'powershell' ? 'powershell.exe' : null),
    )
    expect(await windows.probes.gpu()).toBeNull()
    expect(await windows.probes.disk()).toBeNull()
    expect(windows.port.run).not.toHaveBeenCalled()
  })

  it('uses Windows GPU engine utilization and disk idle counters without aggregate duplication', async () => {
    const r = rig('win32')
    vi.mocked(r.port.executable).mockImplementation((name) =>
      Promise.resolve(
        name === 'powershell'
          ? String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
          : null,
      ),
    )
    vi.mocked(r.port.run).mockResolvedValue('[0,15,90]')
    expect(await r.probes.gpu()).toBe(90)
    vi.mocked(r.port.run).mockResolvedValue('[80,30]')
    expect(await r.probes.disk()).toBe(70)
    const calls = vi.mocked(r.port.run).mock.calls
    expect(calls[0]![1].slice(0, 4)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ])
    expect(calls[0]![1][4]).toContain('Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine')
    expect(calls[0]![1][4]).toContain('UtilizationPercentage')
    expect(calls[1]![1][4]).toContain('PercentIdleTime')
    expect(calls[1]![1][4]).toContain("$_.Name -ne '_Total'")
  })

  it('validates every Windows counter response; absent counters remain unknown', async () => {
    const r = rig('win32')
    vi.mocked(r.port.executable).mockResolvedValue(String.raw`C:\Windows\nvidia-smi.exe`)
    vi.mocked(r.port.run).mockResolvedValue('50\r\n')
    expect(await r.probes.gpu()).toBe(50)
    vi.mocked(r.port.executable).mockImplementation((name) =>
      Promise.resolve(name === 'powershell' ? String.raw`C:\Windows\powershell.exe` : null),
    )
    for (const invalid of [
      '[]',
      '90',
      '{"value":90}',
      '["90"]',
      '[101]',
      '[-1]',
      '[null]',
      'invalid JSON',
    ]) {
      vi.mocked(r.port.run).mockResolvedValue(invalid)
      expect(await r.probes.gpu()).toBeNull()
      expect(await r.probes.disk()).toBeNull()
    }
    vi.mocked(r.port.run).mockResolvedValue('[0]')
    expect(await r.probes.gpu()).toBe(0)
    expect(await r.probes.disk()).toBe(100)
    vi.mocked(r.port.executable).mockResolvedValue(null)
    expect(await r.probes.gpu()).toBeNull()
    expect(await r.probes.disk()).toBeNull()
  })

  it('preserves missing and null Windows CIM properties in the projection before validating counters', async () => {
    const r = rig('win32')
    vi.mocked(r.port.executable).mockImplementation((name) =>
      Promise.resolve(name === 'powershell' ? String.raw`C:\Windows\powershell.exe` : null),
    )
    vi.mocked(r.port.run).mockResolvedValue('[null,null,0]')
    expect(await r.probes.gpu()).toBeNull()
    expect(await r.probes.disk()).toBeNull()
    const calls = vi.mocked(r.port.run).mock.calls
    // Preserve the native values: PowerShell's [double] cast converts null to 0.
    expect(calls[0]![1][4]).toContain('ForEach-Object { $_.UtilizationPercentage }')
    expect(calls[1]![1][4]).toContain('ForEach-Object { $_.PercentIdleTime }')
    vi.mocked(r.port.run).mockResolvedValue('[0]')
    expect(await r.probes.gpu()).toBe(0)
    expect(await r.probes.disk()).toBe(100)
  })

  it('reports Darwin GPU/disk unavailable without root, throughput substitution or child probes', async () => {
    const r = rig('darwin')
    expect(await r.probes.gpu()).toBeNull()
    expect(await r.probes.disk()).toBeNull()
    expect(r.port.read).not.toHaveBeenCalled()
    expect(r.port.list).not.toHaveBeenCalled()
    expect(r.port.executable).not.toHaveBeenCalled()
    expect(r.port.run).not.toHaveBeenCalled()
  })

  it('uses Linux whole-device busy deltas, excluding partitions and memory disks', async () => {
    const r = rig()
    vi.mocked(r.port.list).mockResolvedValue(['sda', 'sdb', 'loop0', 'ram0', 'zram0'])
    r.files.set(
      '/proc/diskstats',
      disk('sda', 100) + disk('sdb', 200, 16) + disk('sda1', 40_000, 1) + disk('loop0', 8000),
    )
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set(
      '/proc/diskstats',
      disk('sda', 3100) + disk('sdb', 7700, 16) + disk('sda1', 100_000, 1) + disk('loop0', 50_000),
    )
    expect(await r.probes.disk()).toBe(50)
    r.tick()
    expect(await r.probes.disk()).toBe(0)
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 50_000) + disk('sdb', 7700, 16))
    expect(await r.probes.disk()).toBe(100)
  })

  it('resets disk baselines across failures, hotplug, reused identities, rollback and disabled intervals', async () => {
    const r = rig()
    vi.mocked(r.port.list).mockResolvedValue(['sda'])
    r.files.set('/proc/diskstats', disk('sda', 100))
    await r.probes.disk()
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 200, 1))
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 0, 1))
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 100, 1))
    expect(await r.probes.disk()).toBeCloseTo(2 / 3)
    r.probes.reset('disk')
    r.tick()
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.delete('/proc/diskstats')
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 100, 1))
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    r.files.set('/proc/diskstats', disk('sda', 200, 1) + disk('sdb', 1000, 16))
    vi.mocked(r.port.list).mockResolvedValue(['sda', 'sdb'])
    expect(await r.probes.disk()).toBeNull()
    r.tick()
    vi.mocked(r.port.list).mockResolvedValue(['sda'])
    expect(await r.probes.disk()).toBeNull()
  })

  it('rejects malformed disk counters, duplicate rows and unavailable device lists', async () => {
    const r = rig()
    vi.mocked(r.port.list).mockResolvedValue(['sda'])
    for (const text of [
      '',
      '8 0 sda',
      disk('sda', NaN),
      disk('sda', -1),
      disk('sda', 0.5),
      disk('sda', Number.MAX_SAFE_INTEGER + 1),
      disk('sda', 0) + disk('sda', 0),
    ]) {
      r.files.set('/proc/diskstats', disk('sda', 0))
      await r.probes.disk()
      r.tick()
      r.files.set('/proc/diskstats', text)
      expect(await r.probes.disk()).toBeNull()
      r.tick()
      r.files.set('/proc/diskstats', disk('sda', 0))
      expect(await r.probes.disk()).toBeNull()
    }
    r.files.set('/proc/diskstats', disk('sda', 100))
    await r.probes.disk()
    r.tick()
    vi.mocked(r.port.list).mockResolvedValue(null)
    expect(await r.probes.disk()).toBeNull()
    vi.mocked(r.port.list).mockResolvedValue(['loop0'])
    expect(await r.probes.disk()).toBeNull()
  })

  it('rejects failed monotonic clocks instead of clearing disk pressure', async () => {
    for (const invalid of [NaN, Infinity, -1]) {
      const r = rig()
      vi.mocked(r.port.list).mockResolvedValue(['sda'])
      r.files.set('/proc/diskstats', disk('sda', 0))
      await r.probes.disk()
      r.tick(invalid)
      expect(await r.probes.disk()).toBeNull()
    }
  })
})
