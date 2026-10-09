// Which process holds the worktree records' lock or runs a pending checkout
// (M123, PLAN.md M123's lock protocol): its host, its id, and its start
// time as the operating system reports it. A process id alone proves
// nothing once the system has given it to another process (Windows reuses
// ids quickly), so a live id is the same owner only while its start time
// matches the one recorded.
//
// Start times come from the system, the same way for every process this one
// looks at, its own included: `/proc` on Linux, `ps` on macOS, Windows
// PowerShell's `Get-Process` on Windows (absolute paths, no shell, a
// timeout). A start time that cannot be read proves nothing.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  LINUX_CLOCK_TICKS_PER_SECOND,
  MILLISECONDS_PER_SECOND,
  PROCESS_START_QUERY_TIMEOUT_MS,
  PROCESS_START_TOLERANCE_MS,
} from '../../../shared/constants'

const NO_SUCH_PROCESS = 'ESRCH'
// `/proc/<pid>/stat` after the command's closing parenthesis: field 3 is
// the first, so field 22 (the start time, in clock ticks since boot) is the
// twentieth.
const LINUX_START_FIELD = 19
const LINUX_BOOT_TIME = /^btime (\d+)$/mu
const DECIMAL = /^\d+$/u

export const processOwnerSchema = z.object({
  host: z.string(),
  pid: z.number(),
  processStart: z.number(),
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

async function linuxStartTime(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8')
  // The command name may hold spaces and parentheses: fields follow the last `)`.
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(' ')
  const ticks = Number(fields[LINUX_START_FIELD])
  const bootSeconds = Number(LINUX_BOOT_TIME.exec(await readFile('/proc/stat', 'utf8'))?.[1])
  return Number.isSafeInteger(ticks) && Number.isSafeInteger(bootSeconds)
    ? bootSeconds * MILLISECONDS_PER_SECOND +
        Math.round((ticks * MILLISECONDS_PER_SECOND) / LINUX_CLOCK_TICKS_PER_SECOND)
    : undefined
}

async function darwinStartTime(pid: number): Promise<number | undefined> {
  // `lstart` in the C locale: "Thu Oct  9 08:05:19 2026", local time.
  const output = await run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
    ...process.env,
    LC_ALL: 'C',
  })
  const started = Date.parse(output.trim())
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
 * When process `pid` started, epoch ms, as the system reports it;
 * undefined when it cannot say (no such process, no permission, an
 * unsupported system). Never throws.
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
        return await linuxStartTime(pid)
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

async function readCurrentOwner(): Promise<ProcessOwner> {
  return {
    host: hostname(),
    pid: process.pid,
    processStart:
      (await processStartTime(process.pid)) ??
      Math.round(Date.now() - process.uptime() * MILLISECONDS_PER_SECOND),
  }
}

const current: { owner?: Promise<ProcessOwner> } = {}

/** This process: its host, its id and its start time (the system's, read once). */
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
  readonly self: ProcessOwner
  readonly isAlive: (pid: number) => boolean
  readonly startTimeOf: (pid: number) => Promise<number | undefined>
}

/**
 * Whether `owner` is provably gone: on this host, no process has its id,
 * or the process that has it now started at another time (the system gave
 * the id to someone else). Another host's process, or a live id whose start
 * time cannot be read, is never provably gone.
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
  const started =
    owner.pid === me.pid
      ? me.processStart
      : await (probe?.startTimeOf ?? processStartTime)(owner.pid)
  return (
    started !== undefined && Math.abs(started - owner.processStart) > PROCESS_START_TOLERANCE_MS
  )
}
