import type { ResourceDiskSampler } from '../disk'
import { access, open, readdir } from 'node:fs/promises'
import { probeChildEnvironment, type GuardedChildEnv } from '../../executables'
import { windowsPowerShell } from '../../execGuard'
import { execFileGuarded } from '../../guardedChildProcess'
import * as os from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  RESOURCE_SAMPLE_MS,
  RESOURCE_PROBE_EMPTY_ENV_KEYS,
  RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR,
} from '../../../shared/constants'
import type { ResourceSampler, ResourceSettings } from '../../../shared/resources'
import { isErrno } from '../../fs/errno'
import { MachineResourceSampler } from './machineSampler'
import type { ResourceProbePort } from './optionalProbes'
import { DarwinMemoryReader } from './darwinMemory'

/** W supplies the named probe limits from its owned constants region. */
export interface ResourceProbeLimits {
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}
const limitsSchema = z.strictObject({
  timeoutMs: z.number().check(z.int(), z.gt(0), z.lte(RESOURCE_SAMPLE_MS)),
  maxOutputBytes: z.number().check(z.int(), z.gt(0), z.lte(BOUNDED_FILE_READ_CHUNK_BYTES)),
})

/** No filesystem/child work at construction, and no inherited credential environment. */
export function createSamplerIo(limits: ResourceProbeLimits): ResourceProbePort {
  const checked = limitsSchema.parse(limits)
  const platform = process.platform
  const paths = platform === 'win32' ? path.win32 : path.posix
  const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
  const programFiles = process.env['ProgramFiles'] ?? process.env['PROGRAMFILES']

  async function read(file: string): Promise<string | null | undefined> {
    try {
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(checked.maxOutputBytes + 1)
        let used = 0
        while (used < buffer.length) {
          const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used)
          if (bytesRead === 0) break
          used += bytesRead
        }
        return used > checked.maxOutputBytes
          ? null
          : new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used))
      } finally {
        await handle.close()
      }
    } catch (error) {
      // A missing probe file is absent; an unreadable one is unknown. Only
      // errno failures read either way: anything else is not a probe outcome.
      if (isErrno(error)) return error.code === 'ENOENT' ? undefined : null
      throw error
    }
  }

  async function executable(name: 'nvidia-smi' | 'powershell' | 'ioreg'): Promise<string | null> {
    const candidates: string[] = []
    if (platform === 'win32') {
      if (systemRoot !== undefined && paths.isAbsolute(systemRoot))
        candidates.push(
          name === 'powershell'
            ? windowsPowerShell(systemRoot, {}).file
            : paths.join(systemRoot, 'System32', 'nvidia-smi.exe'),
        )
      if (name === 'nvidia-smi' && programFiles !== undefined && paths.isAbsolute(programFiles))
        candidates.push(paths.join(programFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'))
    } else if (name === 'nvidia-smi' && platform === 'linux')
      candidates.push('/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi')
    else if (name === 'ioreg' && platform === 'darwin') candidates.push('/usr/sbin/ioreg')
    for (const candidate of candidates) {
      try {
        await access(candidate)
        return candidate
      } catch {
        /* Absent or inaccessible OS tool. */
      }
    }
    return null
  }

  /** The probe's empty environment; Windows PowerShell gets its own module path too. */
  function probeEnvironment(file: string): GuardedChildEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const name of RESOURCE_PROBE_EMPTY_ENV_KEYS) env[name] = ''
    if (platform !== 'win32' || systemRoot === undefined || !paths.isAbsolute(systemRoot))
      return probeChildEnvironment(env)
    env['SystemRoot'] = systemRoot
    env['windir'] = systemRoot
    const powershell = windowsPowerShell(systemRoot, env)
    return file === powershell.file ? powershell.env : probeChildEnvironment(env)
  }

  function run(file: string, args: readonly string[]): Promise<string | null> {
    if (!paths.isAbsolute(file)) return Promise.resolve(null)
    const env = probeEnvironment(file)
    return new Promise((resolve) => {
      execFileGuarded(
        file,
        [...args],
        {
          encoding: 'utf8',
          windowsHide: true,
          shell: false,
          cwd: os.tmpdir(),
          env,
          timeout: checked.timeoutMs,
          maxBuffer: checked.maxOutputBytes,
        },
        (error, stdout) => {
          resolve(error === null ? stdout : null)
        },
      )
    })
  }

  return {
    platform,
    read,
    executable,
    run,
    monotonicMs: () => performance.now(),
    list: async (directory) => {
      try {
        return await readdir(directory)
      } catch (error) {
        // A directory the sampler cannot list holds no probe cards. Only
        // errno failures read that way.
        if (!isErrno(error)) throw error
        return null
      }
    },
  }
}

/** G calls this on the first governed spawn, then owns its RESOURCE_SAMPLE_MS timer. */
export function createMachineResourceSampler(
  settings: () => ResourceSettings,
  limits: ResourceProbeLimits,
  disks?: ResourceDiskSampler,
): ResourceSampler {
  const io = createSamplerIo(limits)
  // Before libuv 1.52 Darwin's API returns free pages alone; use the signed helper.
  const hasUvVersion = /^\d+\.\d+\.\d+$/u.test(process.versions.uv)
  const [uvMajor = 0, uvMinor = 0] = process.versions.uv.split('.').map(Number)
  const hasDarwinHeadroom =
    hasUvVersion &&
    (uvMajor > 1 || (uvMajor === 1 && uvMinor >= RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR))
  const darwinMemory =
    hasUvVersion &&
    uvMajor === 1 &&
    uvMinor >= 0 &&
    uvMinor < RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR &&
    process.platform === 'darwin'
      ? new DarwinMemoryReader(limits)
      : undefined
  const compatibleProcess: { availableMemory?: () => number } = process
  return new MachineResourceSampler(
    {
      platform: process.platform,
      now: () => Date.now(),
      cpus: () => os.cpus().map((cpu) => cpu.times),
      totalMemory: () => os.totalmem(),
      freeMemory: () => os.freemem(),
      availableMemory: () => {
        if (darwinMemory !== undefined) return darwinMemory.read()
        return hasDarwinHeadroom || process.platform !== 'darwin'
          ? (compatibleProcess.availableMemory?.() ?? null)
          : null
      },
      dispose: () => {
        darwinMemory?.dispose()
      },
      read: io.read,
      loadOptionalProbes: async () => {
        const { createOptionalResourceProbes } = await import('./optionalProbes')
        return createOptionalResourceProbes(io)
      },
    },
    settings,
    disks,
  )
}
