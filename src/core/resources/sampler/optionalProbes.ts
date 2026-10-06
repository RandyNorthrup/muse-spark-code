import * as z from 'zod/mini'
import path from 'node:path'
import type { SamplerFileReader } from './linuxMemory'
import type { ResourceOptionalProbes } from './machineSampler'
import { LinuxDiskDelta } from './linuxDisk'
import { percentReading } from './readings'

export interface ResourceProbePort {
  readonly platform: NodeJS.Platform
  monotonicMs(): number
  readonly read: SamplerFileReader
  list(directory: string): Promise<readonly string[] | null>
  executable(name: 'nvidia-smi' | 'powershell'): Promise<string | null>
  run(executable: string, args: readonly string[]): Promise<string | null>
}

// CIM class/property names avoid localized performance-counter paths. No profile,
// executable from the workspace, process identity, elevation or policy bypass.
const WINDOWS_GPU_SCRIPT =
  "$ErrorActionPreference='Stop'; $v=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | ForEach-Object { [double]$_.UtilizationPercentage }); ConvertTo-Json -InputObject $v -Compress"
const WINDOWS_DISK_SCRIPT =
  "$ErrorActionPreference='Stop'; $v=@(Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { [double]$_.PercentIdleTime }); ConvertTo-Json -InputObject $v -Compress"
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
    name: 'nvidia-smi' | 'powershell',
    args: readonly string[],
  ): Promise<string | null> {
    const executable = await port.executable(name)
    return executable !== null && paths.isAbsolute(executable)
      ? await port.run(executable, args)
      : null
  }

  async function windows(script: string, isIdle: boolean): Promise<number | null> {
    const text = await run('powershell', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ])
    if (text === null) return null
    try {
      const input: unknown = JSON.parse(text)
      const parsed = percentages.safeParse(input)
      return parsed.success
        ? Math.max(...parsed.data.map((value) => (isIdle ? 100 - value : value)))
        : null
    } catch {
      return null
    }
  }

  async function gpu(): Promise<number | null> {
    // The unprivileged Darwin tools provide no qualified utilization reading.
    if (port.platform === 'darwin') return null
    if (port.platform === 'linux') {
      const cards = await port.list('/sys/class/drm')
      const values: number[] = []
      const candidates = cards ?? []
      for (const card of candidates) {
        if (!/^card\d+$/.test(card)) continue
        const text = await port.read(`/sys/class/drm/${card}/device/gpu_busy_percent`)
        if (text === undefined) continue
        const value = numericPercent(text)
        if (value === null) return null
        values.push(value)
      }
      if (values.length > 0) return Math.max(...values)
    }
    const executable = await port.executable('nvidia-smi')
    if (executable === null)
      return port.platform === 'win32' ? await windows(WINDOWS_GPU_SCRIPT, false) : null
    if (!paths.isAbsolute(executable)) return null
    const text = await port.run(executable, [
      '--query-gpu=utilization.gpu',
      '--format=csv,noheader,nounits',
    ])
    if (text === null || text.trim() === '') return null
    const values = text
      .trim()
      .split(/\r?\n/)
      .map((line) => numericPercent(line))
    return values.every((value) => value !== null) ? Math.max(...values) : null
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
    // Darwin iostat exposes throughput, not busy time. Without a qualified
    // duty-cycle counter, a fabricated percentage could clear a pause.
    return null
  }

  return {
    gpu,
    disk: readDisk,
    reset: (kind) => {
      if (kind === 'disk') disk.reset()
    },
  }
}
