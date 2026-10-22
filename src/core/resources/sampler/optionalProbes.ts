import * as z from 'zod/mini'
import path from 'node:path'
import type { SamplerFileReader } from './linuxMemory'
import type { ResourceOptionalProbes } from './machineSampler'
import { DarwinDiskDelta } from './darwinDisk'
import { LinuxDiskDelta } from './linuxDisk'
import { percentReading } from './readings'

export interface ResourceProbePort {
  readonly platform: NodeJS.Platform
  monotonicMs(): number
  readonly read: SamplerFileReader
  list(directory: string): Promise<readonly string[] | null>
  executable(name: 'nvidia-smi' | 'powershell' | 'ioreg'): Promise<string | null>
  run(executable: string, args: readonly string[]): Promise<string | null>
}

// CIM class/property names avoid localized performance-counter paths. No profile,
// executable from the workspace, process identity, elevation or policy bypass.
const WINDOWS_GPU_SCRIPT =
  "$ErrorActionPreference='Stop'; $v=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | ForEach-Object { $_.UtilizationPercentage }); ConvertTo-Json -InputObject $v -Compress"
const WINDOWS_DISK_SCRIPT =
  "$ErrorActionPreference='Stop'; $v=@(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { $_.PercentIdleTime }); ConvertTo-Json -InputObject $v -Compress"
const percentages = z.array(z.number().check(z.gte(0), z.lte(100))).check(z.minLength(1))

function numericPercent(text: string | null | undefined): number | null {
  const value = text?.trim()
  return value !== undefined && /^\d+(?:\.\d+)?$/.test(value) ? percentReading(Number(value)) : null
}

/** Optional module: discovery and child probes happen only inside gpu()/disk(). */
export function createOptionalResourceProbes(port: ResourceProbePort): ResourceOptionalProbes {
  const disk = new LinuxDiskDelta()
  const paths = port.platform === 'win32' ? path.win32 : path.posix

  async function run(
    name: 'nvidia-smi' | 'powershell' | 'ioreg',
    args: readonly string[],
  ): Promise<string | null> {
    const executable = await port.executable(name)
    return executable !== null && paths.isAbsolute(executable)
      ? await port.run(executable, args)
      : null
  }

  async function windows(script: string, isIdle: boolean): Promise<number | null> {
    // A pure `-Command` with no script file needs no policy flag.
    const text = await run('powershell', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ])
    if (text === null) return null
    let input: unknown
    try {
      input = JSON.parse(text)
    } catch (error) {
      // JSON.parse throws only SyntaxError; anything else is not a probe
      // outcome and must not read as no reading.
      if (!(error instanceof SyntaxError)) throw error
      return null
    }
    const parsed = percentages.safeParse(input)
    return parsed.success
      ? Math.max(...parsed.data.map((value) => (isIdle ? 100 - value : value)))
      : null
  }

  async function darwinGpu(): Promise<number | null> {
    // The drivers' own instantaneous utilization, unprivileged: Intel, AMD
    // and Apple-silicon parts all publish Device Utilization % in the
    // accelerator's PerformanceStatistics.
    const text = await run('ioreg', ['-r', '-c', 'IOAccelerator', '-d', '1'])
    if (text === null) return null
    const values: number[] = []
    for (const match of text.matchAll(/"Device Utilization %"=(\d+(?:\.\d+)?)/g)) {
      const raw = match[1]
      const value = raw === undefined ? null : percentReading(Number(raw))
      if (value === null) return null
      values.push(value)
    }
    return values.length > 0 ? Math.max(...values) : null
  }

  async function gpu(): Promise<number | null> {
    if (port.platform === 'darwin') return await darwinGpu()
    const values: number[] = []
    if (port.platform === 'linux') {
      const cards = await port.list('/sys/class/drm')
      const candidates = cards ?? []
      for (const card of candidates) {
        if (!/^card\d+$/.test(card)) continue
        const text = await port.read(`/sys/class/drm/${card}/device/gpu_busy_percent`)
        if (text === undefined) continue
        const value = numericPercent(text)
        if (value === null) return null
        values.push(value)
      }
    }
    const executable = await port.executable('nvidia-smi')
    if (executable === null) {
      if (port.platform === 'win32') return await windows(WINDOWS_GPU_SCRIPT, false)
      return values.length > 0 ? Math.max(...values) : null
    }
    if (!paths.isAbsolute(executable)) return null
    const text = await port.run(executable, [
      '--query-gpu=utilization.gpu',
      '--format=csv,noheader,nounits',
    ])
    if (text === null || text.trim() === '') return null
    const nvidiaValues = text
      .trim()
      .split(/\r?\n/)
      .map((line) => numericPercent(line))
    return nvidiaValues.every((value) => value !== null)
      ? Math.max(...values, ...nvidiaValues)
      : null
  }

  const darwinDisk = new DarwinDiskDelta()

  async function darwinDiskRead(): Promise<number | null> {
    // IOKit's cumulative Total Time counters are the duty-cycle source Darwin
    // iostat lacks: busy nanoseconds differenced over wall time, like Linux.
    const text = await run('ioreg', ['-r', '-c', 'IOBlockStorageDriver', '-d', '1'])
    return darwinDisk.read(text, port.monotonicMs())
  }

  async function readDisk(): Promise<number | null> {
    if (port.platform === 'linux') {
      const [text, devices] = await Promise.all([
        port.read('/proc/diskstats'),
        port.list('/sys/block'),
      ])
      return disk.read(text, devices, port.monotonicMs())
    }
    if (port.platform === 'win32') return await windows(WINDOWS_DISK_SCRIPT, true)
    return port.platform === 'darwin' ? await darwinDiskRead() : null
  }

  return {
    gpu,
    disk: readDisk,
    reset: (kind) => {
      if (kind !== 'disk') {
        return
      }

      disk.reset()
      darwinDisk.reset()
    },
  }
}
