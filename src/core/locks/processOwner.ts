// Which process holds a file lease (fileLease.ts) or runs a pending
// checkout (M123, PLAN.md M123's lock protocol): its host, its id, and its
// birth as the operating system records it. A process id alone proves nothing once
// the system has given it to another process (Windows reuses ids quickly),
// so a live id is the same owner only while its birth matches the one
// recorded.
//
// Births come from the system, read the same way for every process this
// one looks at, its own included, and never converted through the
// adjustable wall clock afterwards:
// - Linux: the kernel's start time in clock ticks since boot
//   (`/proc/<pid>/stat`, field 22) with the boot id
//   (`/proc/sys/kernel/random/boot_id`). Exact, and no clock step changes
//   either; an owner from another boot is gone.
// - Windows: the creation time the kernel stored when the process started
//   (Windows PowerShell's `Get-Process`, read in milliseconds). A later
//   clock step does not change it; it is only as right as the clock was at
//   creation.
// - macOS: the start time the kernel stored (`ps -o lstart=`, printed in UTC
//   so no timezone change moves it), to the second.
// On Windows and macOS two processes that had one id and started within
// the tolerance cannot be told apart; a birth that cannot be read proves
// nothing. Queries use absolute paths, no shell, and a timeout.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MILLISECONDS_PER_SECOND,
  PROCESS_START_QUERY_TIMEOUT_MS,
  PROCESS_START_TOLERANCE_MS,
} from '../../shared/constants'

const NO_SUCH_PROCESS = 'ESRCH'
// `/proc/<pid>/stat` after the command's closing parenthesis: field 3 is
// the first, so field 22 (the start time, in clock ticks since boot) is the
// twentieth.
const LINUX_START_FIELD = 19
const LINUX_BOOT_ID = '/proc/sys/kernel/random/boot_id'
const DECIMAL = /^\d+$/u

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
  readonly isAlive: (pid: number) => boolean
  readonly startTimeOf: (pid: number) => Promise<number | undefined>
  readonly exactBirthOf: (pid: number) => Promise<string | undefined>
  readonly exactOnly: boolean
}

// Same libproc ABI used by the repository's orphan recovery. No wall-clock estimate.
const DARWIN_BIRTH = `
import ctypes,sys
class BSD(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint32) for n in
        ('flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','reserved')]+[
        ('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[
        (n,ctypes.c_uint32) for n in ('nfiles','pgid','pjobc','tdev','tpgid')]+[
        ('nice',ctypes.c_int32),('seconds',ctypes.c_uint64),('microseconds',ctypes.c_uint64)]
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
info=BSD()
pid=int(sys.argv[1])
if (lib.proc_pidinfo(pid,3,0,ctypes.byref(info),ctypes.sizeof(info))!=ctypes.sizeof(info)
    or info.pid!=pid or info.seconds==0 or info.microseconds>=1000000): sys.exit(1)
print(str(info.seconds)+':'+str(info.microseconds))
`

/** Exact kernel birth, in native units, or absent. No rounded epoch/tolerance comparison. */
export async function exactProcessBirth(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try {
    if (process.platform === 'linux') {
      const boot = await systemBootId()
      const ticks = await linuxStartTicks(pid)
      return boot !== undefined && ticks !== undefined ? `${boot}:${String(ticks)}` : undefined
    }
    if (process.platform === 'darwin') {
      const output = await run('/usr/bin/python3', ['-I', '-c', DARWIN_BIRTH, String(pid)])
      const value = output.trim()
      return /^\d+:\d+$/u.test(value) ? value : undefined
    }
    const root = process.env['SystemRoot'] ?? process.env['windir']
    if (root === undefined || process.platform !== 'win32') return undefined
    const output = await run(
      path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc().ToString()`,
      ],
    )
    const value = output.trim()
    return DECIMAL.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Vault acquisition retries twice; a failed probe never creates an estimated-owner lock. */
const exactSelf: { owner?: ProcessOwner } = {}
export async function exactCurrentProcessOwner(
  birthOf: (pid: number) => Promise<string | undefined> = exactProcessBirth,
): Promise<ProcessOwner | undefined> {
  if (birthOf === exactProcessBirth) {
    const cached = exactSelf.owner
    if (cached) return cached
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const exactBirth = await birthOf(process.pid)
    if (exactBirth === undefined) continue
    const processStart = await processStartTime(process.pid)
    if (processStart === undefined) continue
    const bootId = await systemBootId()
    if (bootId === undefined && process.platform === 'linux') continue
    const owner: ProcessOwner = {
      host: hostname(),
      pid: process.pid,
      processStart,
      exactBirth,
      ...(bootId !== undefined && { bootId }),
    }
    if (birthOf === exactProcessBirth) exactSelf.owner = owner
    return owner
  }
  return undefined
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
  if (owner.host !== me.host) {
    return false
  }
  if (!(probe?.isAlive ?? isProcessAlive)(owner.pid)) {
    return true
  }
  if (probe?.exactOnly === true) {
    if (owner.exactBirth === undefined) return false
    const birth =
      owner.pid === me.pid && probe.exactBirthOf === undefined
        ? me.exactBirth
        : await (probe.exactBirthOf ?? exactProcessBirth)(owner.pid)
    return birth !== undefined && birth !== owner.exactBirth
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
