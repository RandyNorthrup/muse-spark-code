// Timed callers retain their legacy host/birth comparison. Vaults require
// installation, boot and PID-namespace evidence before comparing a PID.
// Hostnames are display labels, never vault death evidence.
import { execFile } from 'node:child_process'
import { readFile, readlink } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_SECOND,
  PROCESS_START_QUERY_TIMEOUT_MS,
  PROCESS_START_TOLERANCE_MS,
  PROCESS_OWNER_FAILURE_CACHE_MS,
  WINDOWS_FILETIME_TICKS_PER_MS,
  WINDOWS_FILETIME_EPOCH_MS,
} from '../../shared/constants'
import { loadDeveloperMachineId } from '../developer/machineId'
import { agentDataFolder } from '../../runtime/dataFolder'

const NO_SUCH_PROCESS = 'ESRCH'
// `/proc/<pid>/stat` after the command's closing parenthesis: field 3 is
// the first, so field 22 (the start time, in clock ticks since boot) is the
// twentieth.
const LINUX_START_FIELD = 19
const LINUX_BOOT_ID = '/proc/sys/kernel/random/boot_id'
const DECIMAL = /^\d+$/u
const BOOT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu

export const processOwnerSchema = z.object({
  host: z.string(),
  pid: z.number(),
  /**
   * The process's birth: clock ticks since boot on Linux (with `bootId`),
   * epoch milliseconds on Windows and macOS.
   */
  processStart: z.number(),
  /** Linux: the boot the process ran in. */
  bootId: z.optional(z.string()),
  /** Exact OS birth token. Absent in legacy notes; numeric estimates never prove reuse for a vault. */
  exactBirth: z.optional(z.string()),
  /** Installation identity; hostname is only a display label. */
  machineId: z.optional(z.string()),
  /** Linux PID namespace inode; native on systems without PID namespaces. */
  pidNamespace: z.optional(z.string()),
})

/** A process, as a lock note or a pending checkout names its owner. */
export type ProcessOwner = z.infer<typeof processOwnerSchema>

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function run(file: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        timeout: PROCESS_START_QUERY_TIMEOUT_MS,
        windowsHide: true,
        ...(env !== undefined && { env }),
      },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout)
        } else {
          reject(error instanceof Error ? error : new Error('The command failed'))
        }
      },
    )
  })
}

async function linuxStartTicks(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
  // The command name may hold spaces and parentheses: fields follow the last `)`.
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(' ')
  const ticks = Number(fields[LINUX_START_FIELD])
  return Number.isSafeInteger(ticks) ? ticks : undefined
}

async function darwinStartTime(pid: number): Promise<number | undefined> {
  // `lstart` in the C locale and UTC: "Thu Oct  9 08:05:19 2026".
  const output = await run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
    ...process.env,
    LC_ALL: 'C',
    TZ: 'UTC0',
  })
  const started = Date.parse(`${output.trim()} GMT`)
  return Number.isFinite(started) ? started : undefined
}

async function windowsStartTime(pid: number): Promise<number | undefined> {
  // The system's own Windows PowerShell, from the system folder the
  // environment names (never an assumed drive).
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir']
  if (systemRoot === undefined) {
    return undefined
  }
  const powershell = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const output = await run(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `[DateTimeOffset]::new((Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`,
  ])
  const text = output.trim()
  return DECIMAL.test(text) ? Number(text) : undefined
}

/**
 * Process `pid`'s birth as the system recorded it: clock ticks since boot
 * on Linux, epoch milliseconds on Windows and macOS; undefined when it
 * cannot say (no such process, no permission, an unsupported system).
 * Never throws.
 */
export async function processStartTime(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<number | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return undefined
  }
  try {
    switch (platform) {
      case 'linux': {
        return await linuxStartTicks(pid)
      }
      case 'darwin': {
        return await darwinStartTime(pid)
      }
      case 'win32': {
        return await windowsStartTime(pid)
      }
      default: {
        return undefined
      }
    }
  } catch {
    return undefined
  }
}

/** Linux: this boot's id, which every process birth there belongs to. Never throws. */
export async function systemBootId(
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform !== 'linux') {
    return undefined
  }
  try {
    const text = await readFile(LINUX_BOOT_ID, 'utf8')
    const bootId = text.trim()
    return bootId === '' ? undefined : bootId
  } catch {
    return undefined
  }
}

async function readCurrentOwner(): Promise<ProcessOwner> {
  const bootId = await systemBootId()
  const started = await processStartTime(process.pid)
  // A Linux birth without its boot, or no birth at all: the uptime estimate
  // (epoch ms, never compared exactly, since it names no boot).
  const isComplete = process.platform !== 'linux' || bootId !== undefined
  return isComplete && started !== undefined
    ? {
        host: hostname(),
        pid: process.pid,
        processStart: started,
        ...(bootId !== undefined && { bootId }),
      }
    : {
        host: hostname(),
        pid: process.pid,
        processStart: Math.round(Date.now() - process.uptime() * MILLISECONDS_PER_SECOND),
      }
}

const current: { owner?: Promise<ProcessOwner> } = {}

/** This process: its host, its id and its birth (the system's, read once). */
export function currentProcessOwner(): Promise<ProcessOwner> {
  current.owner ??= readCurrentOwner()
  return current.owner
}

/** Whether a process with this id exists (one we may not signal still does). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return errorCode(error) !== NO_SUCH_PROCESS
  }
}

export interface ProcessOwnerProbe {
  /** This process, whose boot and birth reading the comparison uses. */
  readonly self: ProcessOwner
  readonly isAlive: (pid: number) => boolean | undefined
  readonly startTimeOf: (pid: number) => Promise<number | undefined>
  readonly exactBirthOf: (pid: number) => Promise<string | undefined>
  readonly exactOnly: boolean
}

interface ExactEvidence {
  readonly birth: string
  readonly started: number
  readonly boot: string
  readonly namespace: string
}
const exactReadings = new Map<number, { evidence: ExactEvidence | undefined; retryAt: number }>()
const pendingReadings = new Map<number, Promise<ExactEvidence | undefined>>()
const darwinBoot: { value?: string } = {}
async function readExactEvidence(pid: number): Promise<ExactEvidence | undefined> {
  try {
    switch (process.platform) {
      case 'linux': {
        const [boot, ticks, namespace] = await Promise.all([
          systemBootId(),
          linuxStartTicks(pid),
          readlink('/proc/self/ns/pid'),
        ])
        if (boot && ticks !== undefined && /^pid:\[\d+\]$/u.test(namespace))
          return { birth: String(ticks), started: ticks, boot, namespace }
        break
      }
      case 'darwin': {
        // Both tools ship in base macOS: no Xcode shim or developer tool.
        const output =
          darwinBoot.value ?? (await run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']))
        const boot = output.trim()
        if (boot) darwinBoot.value = boot
        const started = await darwinStartTime(pid)
        if (boot && started !== undefined)
          return { birth: String(started), started, boot, namespace: 'native' }

        break
      }
      case 'win32': {
        const root = process.env['SystemRoot'] ?? process.env['windir']
        if (!root) return undefined
        // One bounded launch reads both exact FILETIME and the current boot.
        const output = await run(
          path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '$ErrorActionPreference = "Stop"; $birth = (Get-Process -Id ' +
              String(pid) +
              ').StartTime.ToFileTimeUtc(); Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class MuseLeaseBoot { [StructLayout(LayoutKind.Sequential)] public struct Info { public Guid Id; public uint Firmware; public ulong Flags; } [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int kind, out Info value, int size, out int returned); public static string Read() { Info value; int returned; if (NtQuerySystemInformation(90, out value, Marshal.SizeOf(typeof(Info)), out returned) != 0 || value.Id == Guid.Empty) throw new InvalidOperationException(); return value.Id.ToString(); } }\'; Write-Output ($birth.ToString()+":"+[MuseLeaseBoot]::Read())',
          ],
        )
        const [birth, boot] = output.trim().split(':', 2)
        if (birth && boot && DECIMAL.test(birth) && /^[a-f0-9-]{36}$/iu.test(boot))
          return {
            birth,
            started: Number(
              BigInt(birth) / WINDOWS_FILETIME_TICKS_PER_MS - WINDOWS_FILETIME_EPOCH_MS,
            ),
            boot,
            namespace: 'native',
          }
        break
      }
      default: {
        break
      }
    }
  } catch {
    // Failed or unreadable evidence is unknown, never death.
  }
  return undefined
}
async function exactEvidence(pid: number): Promise<ExactEvidence | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const cached = exactReadings.get(pid)
  if (cached && performance.now() < cached.retryAt) return cached.evidence
  const pending = pendingReadings.get(pid)
  if (pending) return await pending
  const reading = readExactEvidence(pid)
  pendingReadings.set(pid, reading)
  let evidence
  try {
    evidence = await reading
  } finally {
    pendingReadings.delete(pid)
  }
  // Only this process's successful birth is immutable. Never cache another
  // PID's successful reading: it may have been reused on the next attempt.
  if (!evidence || pid === process.pid)
    exactReadings.set(pid, {
      evidence,
      retryAt: evidence ? Infinity : performance.now() + PROCESS_OWNER_FAILURE_CACHE_MS,
    })
  return evidence
}
/** Native birth token; macOS second resolution is paired with its boot UUID. */
export async function exactProcessBirth(pid: number): Promise<string | undefined> {
  const evidence = await exactEvidence(pid)
  return evidence?.birth
}
const exactSelf = new Map<string, { owner: ProcessOwner | undefined; retryAt: number }>()
/** Read this process once, with the installation identity shared by all hosts. */
export async function exactCurrentProcessOwner(
  dataDir = agentDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
): Promise<ProcessOwner | undefined> {
  const cached = exactSelf.get(dataDir)
  if (cached && performance.now() < cached.retryAt) return cached.owner
  let owner: ProcessOwner | undefined
  try {
    const evidence = await exactEvidence(process.pid)
    if (evidence)
      owner = {
        host: hostname(),
        pid: process.pid,
        processStart: evidence.started,
        machineId: await loadDeveloperMachineId(dataDir),
        bootId: evidence.boot.toLowerCase(),
        pidNamespace: evidence.namespace,
        exactBirth: evidence.birth,
      }
  } catch {
    // Identity storage failure also refuses without an estimated owner.
  }
  exactSelf.set(dataDir, {
    owner,
    retryAt: owner ? Infinity : performance.now() + PROCESS_OWNER_FAILURE_CACHE_MS,
  })
  return owner
}

/**
 * Whether `owner` is provably gone: on this host, no process has its id;
 * or it was born in another boot (Linux); or the process that has its id
 * now was born at another time (the system gave the id to someone else).
 * Another host's process, or a live id whose birth cannot be read or
 * compared, is never provably gone.
 */
export async function isProcessOwnerGone(
  owner: ProcessOwner,
  probe?: Partial<ProcessOwnerProbe>,
): Promise<boolean> {
  const me = probe?.self ?? (await currentProcessOwner())
  if (probe?.exactOnly === true) {
    if (
      !owner.machineId ||
      !me.machineId ||
      owner.machineId !== me.machineId ||
      !owner.bootId ||
      !me.bootId
    )
      return false
    // A former Windows boot timestamp is not a kernel boot identity.
    // Incomparable legacy evidence cannot prove a reboot or a PID's absence.
    if (BOOT_UUID.test(me.bootId) && !BOOT_UUID.test(owner.bootId)) return false
    if (owner.bootId.toLowerCase() !== me.bootId.toLowerCase()) return true
    if (
      !owner.pidNamespace ||
      !me.pidNamespace ||
      owner.pidNamespace !== me.pidNamespace ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0
    )
      return false
    try {
      const alive = (probe.isAlive ?? isProcessAlive)(owner.pid)
      if (alive === false) return true
      if (alive === undefined || !owner.exactBirth) return false
      const birth =
        owner.pid === me.pid && probe.exactBirthOf === undefined
          ? me.exactBirth
          : await (probe.exactBirthOf ?? exactProcessBirth)(owner.pid)
      return birth !== undefined && birth !== owner.exactBirth
    } catch {
      return false
    }
  }
  if (owner.host !== me.host) {
    return false
  }
  if (!(probe?.isAlive ?? isProcessAlive)(owner.pid)) {
    return true
  }
  const isBootBound = owner.bootId !== undefined || me.bootId !== undefined
  if (isBootBound && (owner.bootId === undefined || me.bootId === undefined)) {
    // One birth names its boot and the other does not: not comparable.
    return false
  }
  if (isBootBound && owner.bootId !== me.bootId) {
    return true
  }
  const started =
    owner.pid === me.pid
      ? me.processStart
      : await (probe?.startTimeOf ?? processStartTime)(owner.pid)
  if (started === undefined) {
    return false
  }
  // Ticks since one boot are exact; epoch births agree within the tolerance.
  return isBootBound
    ? started !== owner.processStart
    : Math.abs(started - owner.processStart) > PROCESS_START_TOLERANCE_MS
}
