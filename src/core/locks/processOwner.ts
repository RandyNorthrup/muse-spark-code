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
//   (`GetProcessTimes`, read in milliseconds) through a small native reader
//   (below). A later clock step does not change it; it is only as right as
//   the clock was at creation.
// - macOS: the start time the kernel stored (`ps -o lstart=`, printed in UTC
//   so no timezone change moves it), to the second.
// On Windows and macOS two processes that had one id and started within
// the tolerance cannot be told apart; a birth that cannot be read proves
// nothing. Queries use absolute paths, no shell, and a timeout.

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  ACP_DATA_FOLDER,
  MILLISECONDS_PER_SECOND,
  PROCESS_START_QUERY_TIMEOUT_MS,
  PROCESS_START_TOLERANCE_MS,
  WINDOWS_BIRTH_READER_FOLDER,
  WINDOWS_FRAMEWORK_RELATIVE_PATH,
} from '../../shared/constants'

const NO_SUCH_PROCESS = 'ESRCH'
const NO_SUCH_FILE = 'ENOENT'
const NOT_EXECUTABLE = 'ENOEXEC'
// `/proc/<pid>/stat` after the command's closing parenthesis: field 3 is
// the first, so field 22 (the start time, in clock ticks since boot) is the
// twentieth.
const LINUX_START_FIELD = 19
const LINUX_BOOT_ID = '/proc/sys/kernel/random/boot_id'
const DECIMAL = /^\d+$/u
const WINDOWS_BIRTH_READER_STEM = 'MuseSparkBirth-'
const WINDOWS_BIRTH_READER_DIGEST_LENGTH = 16
// Windows' birth reader, C# 5 for the .NET Framework that ships with Windows.
// Windows PowerShell spent 300 to 600 ms of CPU starting before it read one
// birth, and its first start on a fresh hosted runner passed the query bound
// (docs/certification/windows-process-birth.md); this asks the kernel
// directly in about 55 ms. Exit 1: no running process has the id, or it
// cannot be opened.
const WINDOWS_BIRTH_READER_SOURCE = `using System;
using System.Globalization;
using System.Runtime.InteropServices;

static class MuseSparkBirth
{
    const uint QueryLimitedInformation = 0x1000;
    const uint StillActive = 259;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    static int Main(string[] args)
    {
        uint pid;
        if (args.Length != 1 || !uint.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out pid)) return 2;
        IntPtr process = OpenProcess(QueryLimitedInformation, false, pid);
        if (process == IntPtr.Zero) return 1;
        try
        {
            uint exitCode;
            long creation, exit, kernel, user;
            // An exited process keeps its times while a handle to it is open.
            if (!GetExitCodeProcess(process, out exitCode) || exitCode != StillActive) return 1;
            if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) return 1;
            Console.Out.Write(DateTimeOffset.FromFileTime(creation).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture));
            return 0;
        }
        finally
        {
            CloseHandle(process);
        }
    }
}
`

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

/** Whether the program never started (Node names the `spawn` call); not an exit or a kill. */
function isSpawnFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'syscall' in error &&
    String(error.syscall).startsWith('spawn')
  )
}

async function isFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file)
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * The birth reader for this source: compiled once per user by Windows' own
 * C# compiler into the user's data folder, named by the source's digest, and
 * moved into place whole, so a reader another process compiles at the same
 * time is never half written.
 */
async function prepareWindowsBirthReader(systemRoot: string): Promise<string> {
  // Only an absolute folder is built in: a relative one would put the reader
  // under whatever folder this process happens to run in.
  const fromEnv = process.env['LOCALAPPDATA']
  const localAppData =
    fromEnv !== undefined && path.win32.isAbsolute(fromEnv)
      ? fromEnv
      : path.win32.join(homedir(), 'AppData', 'Local')
  const folder = path.win32.join(localAppData, ACP_DATA_FOLDER.win32, WINDOWS_BIRTH_READER_FOLDER)
  const digest = createHash('sha256')
    .update(WINDOWS_BIRTH_READER_SOURCE)
    .digest('hex')
    .slice(0, WINDOWS_BIRTH_READER_DIGEST_LENGTH)
  const reader = path.win32.join(folder, `${WINDOWS_BIRTH_READER_STEM}${digest}.exe`)
  if (await isFile(reader)) {
    return reader
  }
  await mkdir(folder, { recursive: true })
  const stem = path.win32.join(folder, randomUUID())
  try {
    await writeFile(`${stem}.cs`, WINDOWS_BIRTH_READER_SOURCE, 'utf8')
    await run(
      path.win32.join(systemRoot, WINDOWS_FRAMEWORK_RELATIVE_PATH, 'csc.exe'),
      ['/nologo', '/noconfig', '/target:exe', `/out:${stem}.exe`, `${stem}.cs`],
      { SystemRoot: systemRoot },
    )
    try {
      await rename(`${stem}.exe`, reader)
    } catch (error: unknown) {
      // Another process put the same reader in place first.
      if (!(await isFile(reader))) {
        throw error
      }
    }
  } finally {
    await rm(`${stem}.cs`, { force: true })
    await rm(`${stem}.exe`, { force: true })
  }
  return reader
}

const windowsBirthReader: { ready?: Promise<string> | undefined } = {}

async function windowsStartTime(pid: number): Promise<number | undefined> {
  // The system folder the environment names (never an assumed drive, and
  // never a relative one: the compiler under it would be looked up from
  // whatever folder this process happens to run in).
  const systemRoot = [process.env['SystemRoot'], process.env['windir']].find(
    (root) => root !== undefined && path.win32.isAbsolute(root),
  )
  if (systemRoot === undefined) {
    return undefined
  }
  const ready = (windowsBirthReader.ready ??= prepareWindowsBirthReader(systemRoot))
  let reader: string
  try {
    reader = await ready
  } catch (error: unknown) {
    // A failed build is not kept: the next read tries again. Only this
    // build is forgotten, never a newer one another read already started.
    if (windowsBirthReader.ready === ready) {
      windowsBirthReader.ready = undefined
    }
    throw error
  }
  let output: string
  try {
    output = await run(reader, [String(pid)], { SystemRoot: systemRoot })
  } catch (error: unknown) {
    // A reader that is gone or damaged is built again on the next read; one
    // the machine's policy refuses to start stays, since building the same
    // reader again would be refused the same way on every read. An exit
    // code is the reader's own answer.
    const code = errorCode(error)
    if (isSpawnFailure(error) && (code === NO_SUCH_FILE || code === NOT_EXECUTABLE)) {
      if (windowsBirthReader.ready === ready) {
        windowsBirthReader.ready = undefined
      }
      try {
        await rm(reader, { force: true })
      } catch {
        // Another process is running it: it stays, and is tried again.
      }
    }
    throw error
  }
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
