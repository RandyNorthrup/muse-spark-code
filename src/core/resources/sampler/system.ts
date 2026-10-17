import type { ResourceDiskSampler } from '../disk'
import { execFile } from 'node:child_process'
import { access, open, readdir } from 'node:fs/promises'
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
import { MachineResourceSampler } from './machineSampler'
import type { ResourceProbePort } from './optionalProbes'

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
      return typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
        ? undefined
        : null
    }
  }

  async function executable(name: 'nvidia-smi' | 'powershell'): Promise<string | null> {
    const candidates: string[] = []
    if (platform === 'win32') {
      if (systemRoot !== undefined && paths.isAbsolute(systemRoot))
        candidates.push(
          paths.join(
            systemRoot,
            'System32',
            name === 'powershell'
              ? String.raw`WindowsPowerShell\v1.0\powershell.exe`
              : 'nvidia-smi.exe',
          ),
        )
      if (name === 'nvidia-smi' && programFiles !== undefined && paths.isAbsolute(programFiles))
        candidates.push(paths.join(programFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'))
    } else if (name === 'nvidia-smi' && platform === 'linux')
      candidates.push('/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi')
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

  function run(file: string, args: readonly string[]): Promise<string | null> {
    if (!paths.isAbsolute(file)) return Promise.resolve(null)
    const env: NodeJS.ProcessEnv = {}
    for (const name of RESOURCE_PROBE_EMPTY_ENV_KEYS) env[name] = ''
    if (platform === 'win32' && systemRoot !== undefined && paths.isAbsolute(systemRoot)) {
      env['SystemRoot'] = systemRoot
      env['windir'] = systemRoot
    }
    return new Promise((resolve) => {
      execFile(
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
      } catch {
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
  // Before libuv 1.52 Darwin's API returns free pages alone, not usable headroom.
  // Such runtimes, or ones without availableMemory, must report unknown (D87).
  const [uvMajor = 0, uvMinor = 0] = process.versions.uv.split('.').map(Number)
  const hasDarwinHeadroom =
    uvMajor > 1 || (uvMajor === 1 && uvMinor >= RESOURCE_DARWIN_HEADROOM_LIBUV_MIN_MINOR)
  const compatibleProcess: { availableMemory?: () => number } = process
  return new MachineResourceSampler(
    {
      platform: process.platform,
      now: () => Date.now(),
      cpus: () => os.cpus().map((cpu) => cpu.times),
      totalMemory: () => os.totalmem(),
      freeMemory: () => os.freemem(),
      availableMemory: () =>
        !hasDarwinHeadroom && process.platform === 'darwin'
          ? null
          : (compatibleProcess.availableMemory?.() ?? null),
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
