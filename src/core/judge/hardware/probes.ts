// M125 lane H (D107): hardware readers. Absolute tool paths only, fixed
// argument arrays, no shell, one budget, guarded environments — the
// sampler's discipline (M107) with the scan's own budgets. A missing
// tool is unknown hardware with its reason, never an error.
import { access, constants, readdir, readFile } from 'node:fs/promises'
import { statfsSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { probeChildEnvironment } from '../../executables'
import { windowsPowerShell } from '../../execGuard'
import { isErrno } from '../../fs/errno'
import { execFileGuarded } from '../../guardedChildProcess'
import {
  JUDGE_PROBE_MAX_OUTPUT_BYTES,
  JUDGE_PROBE_TIMEOUT_MS,
  OLLAMA_DEFAULT_PORT,
} from '../../../shared/constants'
import {
  parseCimVideo,
  parseLinuxCpuinfo,
  parseNvidiaSmi,
  parseOllamaBinaryVersion,
  parseOllamaHost,
  parseOllamaTags,
  parseOllamaVersion,
  parseSysctlFeatures,
  pciVendorFromId,
} from './parse'
import type { JudgeGpuInfo, JudgeOllamaInfo } from './types'

export type ProbeRun =
  | { readonly status: 'ok'; readonly text: string }
  | { readonly status: 'absent' | 'failed' | 'timeout' | 'too-big' }

interface ExecFailure extends Error {
  readonly code?: string | number | null
  readonly killed?: boolean
}

function isExecFailure(error: unknown): error is ExecFailure {
  return error instanceof Error
}

/**
Run one probe tool. Absolute path, fixed args, no shell, guarded
environment, one budget and one output cap. Every failure mode reads
as unknown hardware with its own reason downstream.
*/
export function runProbe(
  file: string,
  args: readonly string[],
  timeoutMs: number = JUDGE_PROBE_TIMEOUT_MS,
  maxOutputBytes: number = JUDGE_PROBE_MAX_OUTPUT_BYTES,
): Promise<ProbeRun> {
  return new Promise((resolve) => {
    execFileGuarded(
      file,
      [...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        cwd: os.tmpdir(),
        env: probeChildEnvironment({}),
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ status: 'ok', text: stdout })
          return
        }
        if (!isExecFailure(error)) {
          resolve({ status: 'failed' })
          return
        }
        if (error.code === 'ENOENT') {
          resolve({ status: 'absent' })
          return
        }
        if (error.killed === true) {
          resolve({ status: 'timeout' })
          return
        }
        if (error.message.includes('maxBuffer')) {
          resolve({ status: 'too-big' })
          return
        }
        resolve({ status: 'failed' })
      },
    )
  })
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK)
    return true
  } catch (error: unknown) {
    // Unreadable means unusable; only a non-errno throw is a bug.
    if (!isErrno(error)) throw error
    return false
  }
}

/**
The first executable name found on the path value (startup PATH by
default; tests pass a scratch value over real directories).
*/
export async function findOnPath(
  names: readonly string[],
  pathValue: string | undefined = process.env['PATH'],
): Promise<string | undefined> {
  if (pathValue === undefined || pathValue === '') return undefined
  const directories = pathValue.split(path.delimiter).filter((entry) => path.isAbsolute(entry))
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

function compareCardNames(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** DRM card names under the sysfs root (/sys live; a scratch root in tests). */
export async function listDrmCards(sysfsRoot = '/sys'): Promise<readonly string[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(sysfsRoot, 'class', 'drm'))
  } catch (error: unknown) {
    // No DRM tree means no readable cards; anything else surfaces.
    if (!isErrno(error)) throw error
    return []
  }
  return entries.filter((entry) => /^card\d+$/.test(entry)).toSorted(compareCardNames)
}

/** One card's PCI vendor id bytes, or undefined when unreadable. */
export async function readPciVendor(sysfsRoot: string, card: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(sysfsRoot, 'class', 'drm', card, 'device', 'vendor'), 'utf8')
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return undefined
  }
}

const NVIDIA_SMI_LINUX = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'] as const

async function firstExecutable(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate
  }
  return undefined
}

/** Absolute nvidia-smi candidates; never a PATH search. */
export function nvidiaSmiCandidates(
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  programFiles: string | undefined,
): readonly string[] {
  if (platform === 'linux') return NVIDIA_SMI_LINUX
  if (platform !== 'win32' || systemRoot === undefined || !path.win32.isAbsolute(systemRoot)) {
    return []
  }
  const candidates = [path.win32.join(systemRoot, 'System32', 'nvidia-smi.exe')]
  if (programFiles !== undefined && path.win32.isAbsolute(programFiles)) {
    candidates.push(path.win32.join(programFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'))
  }
  return candidates
}

/** Whether an nvidia-smi answers on this machine. */
export async function hasUsableNvidiaSmi(): Promise<boolean> {
  const candidates = nvidiaSmiCandidates(
    process.platform,
    process.env['SystemRoot'] ?? process.env['SYSTEMROOT'],
    process.env['ProgramFiles'],
  )
  return (await firstExecutable(candidates)) !== undefined
}

const UNKNOWN_GPU: JudgeGpuInfo = {
  vendor: 'unknown',
  backend: 'cpu',
  reason: 'no GPU reading: CPU only',
}

async function probeLinuxGpu(sysfsRoot: string): Promise<JudgeGpuInfo> {
  const cards = await listDrmCards(sysfsRoot)
  const vendors = new Map<string, string>()
  for (const card of cards) {
    const id = await readPciVendor(sysfsRoot, card)
    if (id !== undefined) vendors.set(card, pciVendorFromId(id))
  }
  const found = new Set(vendors.values())
  const smi = await firstExecutable(nvidiaSmiCandidates('linux', undefined, undefined))
  if (smi !== undefined) {
    const run = await runProbe(smi, [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader,nounits',
    ])
    if (run.status === 'ok') {
      const gpus = parseNvidiaSmi(run.text)
      // The first GPU answers for the card the judge would use.
      const first = gpus?.[0]
      if (first !== undefined) {
        return {
          vendor: 'nvidia',
          model: first.name,
          vramBytes: first.vramBytes,
          backend: 'cuda',
          reason: `usable through CUDA (driver ${first.driverVersion})`,
        }
      }
    }
    if (found.has('nvidia')) {
      return {
        vendor: 'nvidia',
        backend: 'cpu',
        reason: `an NVIDIA card is present but its driver did not answer (${run.status}): CPU only`,
      }
    }
  }
  if (found.has('nvidia')) {
    return {
      vendor: 'nvidia',
      backend: 'cpu',
      reason: 'an NVIDIA card is present but nvidia-smi is missing: CPU only',
    }
  }
  if (found.has('amd')) {
    try {
      await access('/dev/kfd')
      return {
        vendor: 'amd',
        backend: 'cpu',
        reason: 'an AMD card is present but its VRAM is unreadable here: CPU only',
      }
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      return {
        vendor: 'amd',
        backend: 'cpu',
        reason: 'an AMD card is present but ROCm is not loaded: CPU only',
      }
    }
  }
  if (found.has('intel')) {
    return {
      vendor: 'intel',
      model: 'Intel integrated graphics',
      backend: 'cpu',
      reason: 'integrated graphics use system memory: CPU only',
    }
  }
  return cards.length === 0
    ? UNKNOWN_GPU
    : { vendor: 'unknown', backend: 'cpu', reason: 'an unrecognised card is present: CPU only' }
}

function probeDarwinGpu(): JudgeGpuInfo {
  if (process.arch === 'arm64') {
    return {
      vendor: 'apple',
      model: 'Apple silicon',
      vramBytes: os.totalmem(),
      backend: 'metal',
      reason: 'unified memory, usable through Metal',
    }
  }
  return {
    vendor: 'unknown',
    backend: 'cpu',
    reason: 'discrete VRAM is unreadable on this Intel Mac: CPU only',
  }
}

const WINDOWS_VIDEO_SCRIPT =
  "$ErrorActionPreference='Stop'; Get-CimInstance -ClassName Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress"

async function probeWindowsGpu(systemRoot: string | undefined): Promise<JudgeGpuInfo> {
  const smi = await firstExecutable(
    nvidiaSmiCandidates('win32', systemRoot, process.env['ProgramFiles']),
  )
  if (smi !== undefined) {
    const run = await runProbe(smi, [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader,nounits',
    ])
    if (run.status === 'ok') {
      const first = parseNvidiaSmi(run.text)?.[0]
      if (first !== undefined) {
        return {
          vendor: 'nvidia',
          model: first.name,
          vramBytes: first.vramBytes,
          backend: 'cuda',
          reason: `usable through CUDA (driver ${first.driverVersion})`,
        }
      }
    }
  }
  if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot)) return UNKNOWN_GPU
  const shell = windowsPowerShell(systemRoot)
  const run = await runProbe(shell.file, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_VIDEO_SCRIPT,
  ])
  if (run.status !== 'ok') return UNKNOWN_GPU
  const controllers = parseCimVideo(run.text)
  const first = controllers?.[0]
  if (first === undefined) return UNKNOWN_GPU
  const name = first.name.toLowerCase()
  if (name.includes('nvidia')) {
    return {
      vendor: 'nvidia',
      model: first.name,
      backend: 'cpu',
      reason: 'an NVIDIA card is present but nvidia-smi is missing: CPU only',
    }
  }
  if (name.includes('intel')) {
    return {
      vendor: 'intel',
      model: first.name,
      backend: 'cpu',
      reason: 'integrated graphics use system memory: CPU only',
    }
  }
  return {
    vendor: 'unknown',
    model: first.name,
    backend: 'cpu',
    reason: `${first.name} has no CUDA path on Windows: CPU only`,
  }
}

/** The GPU the pinned Ollama can use, or CPU only with its reason. */
export async function probeGpu(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env['SystemRoot'] ?? process.env['SYSTEMROOT'],
  sysfsRoot = '/sys',
): Promise<JudgeGpuInfo> {
  if (platform === 'linux') return await probeLinuxGpu(sysfsRoot)
  if (platform === 'darwin') return probeDarwinGpu()
  return platform === 'win32' ? await probeWindowsGpu(systemRoot) : UNKNOWN_GPU
}

export interface JudgeCpuReading {
  readonly model: string
  readonly cores: number
  readonly features: readonly string[]
}

/** CPU model, cores and instruction features. NEON is ARMv8 baseline. */
export async function probeCpu(
  platform: NodeJS.Platform = process.platform,
  cpuinfoPath = '/proc/cpuinfo',
): Promise<JudgeCpuReading> {
  const cpus = os.cpus()
  const observed = cpus[0]?.model.trim()
  const model = observed === undefined || observed === '' ? 'unknown' : observed
  const cores = cpus.length
  if (process.arch === 'arm64') {
    return { model, cores, features: ['neon'] }
  }
  if (platform === 'linux') {
    let text: string | undefined
    try {
      text = await readFile(cpuinfoPath, 'utf8')
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      text = undefined
    }
    if (text === undefined) return { model, cores, features: [] }
    const parsed = parseLinuxCpuinfo(text)
    return parsed === undefined
      ? { model, cores, features: [] }
      : { model: parsed.model, cores: parsed.cores, features: parsed.features }
  }
  if (platform === 'darwin') {
    const sysctl = await firstExecutable(['/usr/sbin/sysctl', '/sbin/sysctl'])
    if (sysctl === undefined) return { model, cores, features: [] }
    const run = await runProbe(sysctl, ['-n', 'machdep.cpu.leaf7_features'])
    if (run.status !== 'ok') return { model, cores, features: [] }
    return {
      model,
      cores,
      features: parseSysctlFeatures(`machdep.cpu.leaf7_features: ${run.text}`) ?? [],
    }
  }
  return { model, cores, features: [] }
}

/** Free bytes on installPath's volume (the nearest existing parent wins). */
export function probeDiskFree(installPath: string): number | undefined {
  let directory = path.resolve(installPath)
  for (;;) {
    try {
      const volume = statfsSync(directory)
      return volume.bavail * volume.bsize
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      const parent = path.dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }
}

export interface OllamaEndpoint {
  readonly host: string
  readonly port: number
}

function ollamaEndpoint(env: NodeJS.ProcessEnv = process.env): OllamaEndpoint {
  return (
    parseOllamaHost(env['OLLAMA_HOST'] ?? '') ?? { host: '127.0.0.1', port: OLLAMA_DEFAULT_PORT }
  )
}

async function fetchOllama(endpoint: OllamaEndpoint, route: string): Promise<string | undefined> {
  let response: Response
  try {
    response = await fetch(`http://${endpoint.host}:${String(endpoint.port)}${route}`, {
      signal: AbortSignal.timeout(JUDGE_PROBE_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    // Unreachable or refused: not running.
    if (error instanceof TypeError) return undefined
    // The probe budget ran out: not answering.
    if (error instanceof DOMException) return undefined
    throw error
  }
  if (!response.ok) return undefined
  try {
    return await response.text()
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
}

/** An existing Ollama: installed, versioned, running, and its models. */
export async function probeOllama(env: NodeJS.ProcessEnv = process.env): Promise<JudgeOllamaInfo> {
  const names = process.platform === 'win32' ? ['ollama.exe', 'ollama'] : ['ollama']
  const binary = await findOnPath(names, env['PATH'])
  const endpoint = ollamaEndpoint(env)
  const versionText = await fetchOllama(endpoint, '/api/version')
  const version = versionText === undefined ? undefined : parseOllamaVersion(versionText)
  if (version !== undefined) {
    const tagsText = await fetchOllama(endpoint, '/api/tags')
    const tags = tagsText === undefined ? undefined : parseOllamaTags(tagsText)
    return {
      installed: true,
      ...(binary !== undefined && { path: binary }),
      version,
      running: true,
      ...(tags !== undefined && {
        models: tags.map((tag) => ({ name: tag.name, digest: tag.digest })),
      }),
    }
  }
  if (binary === undefined) return { installed: false, running: false }
  const run = await runProbe(binary, ['--version'])
  const binaryVersion = run.status === 'ok' ? parseOllamaBinaryVersion(run.text) : undefined
  return {
    installed: true,
    path: binary,
    ...(binaryVersion !== undefined && { version: binaryVersion }),
    running: false,
  }
}
