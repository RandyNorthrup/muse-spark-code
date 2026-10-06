import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { storeErrorCode } from '../../host/backend/storeErrors'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_STORAGE_FILE_MODE,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_POLL_INTERVAL_MS,
  SCHEDULE_UNTRUSTED_WRITE_MODE,
  SCHEDULE_STICKY_MODE,
  SCHEDULE_WAKE_WAIT_MS,
  SCHEDULE_WAKE_RETRY_MS,
  UI_TEXT,
} from '../../shared/constants'
import { unsafeScheduleLauncher } from './registration'
import type { BackgroundFilePort, BackgroundProcessResult } from './nativeBackground'

const wakeLockSchema = z.strictObject({
  pid: z.int().check(z.gte(1)),
  startIdentity: z.string().check(z.minLength(1)),
})

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function* ancestors(p: path.PlatformPath, file: string): Generator<string> {
  let target = file
  for (;;) {
    yield target
    const parent = p.dirname(target)
    if (parent === target) return
    target = parent
  }
}

/** PID plus the kernel's start identity prevents PID reuse from pinning a wake. */
async function startIdentity(
  pid: number,
  run = backgroundProcessRunner(process.env),
): Promise<string | undefined> {
  const result = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='])
  if (result.exitCode === 1 && result.stdout.trim() === '') return
  if (result.exitCode !== 0 || result.stdout.trim() === '')
    throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
  return result.stdout.trim()
}

export async function waitForScheduleWake(
  dataDir: string,
  deps?: {
    now: () => number
    pause: (ms: number) => Promise<void>
    identity: (pid: number) => Promise<string | undefined>
  },
): Promise<void> {
  const io = deps ?? { now: Date.now, pause, identity: startIdentity }
  const directory = path.join(dataDir, 'background-wakes')
  const deadline = io.now() + SCHEDULE_WAKE_WAIT_MS
  for (;;) {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error: unknown) {
      if (storeErrorCode(error) === 'ENOENT') return
      throw error
    }
    let isActive = false
    for (const entry of entries) {
      if (/^[\w-]+\.json\.[\w-]+\.tmp$/.test(entry)) continue
      if (!/^[\w-]+\.json$/.test(entry)) throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
      const file = path.join(directory, entry)
      const text = await nodeBackgroundFiles().read(file)
      if (text === undefined) continue
      const lock = wakeLockSchema.parse(JSON.parse(text))
      if ((await io.identity(lock.pid)) === lock.startIdentity) isActive = true
      else await rm(file, { force: true })
    }
    if (!isActive) return
    if (io.now() >= deadline) throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
    await io.pause(SCHEDULE_WAKE_RETRY_MS)
  }
}

/** The marker remains until kernel exit; a detached trusted helper cleans/rearms then. */
export async function beginScheduleWake(
  dataDir: string,
  executable: string,
  agentFile: string,
  deps?: {
    identity: (pid: number) => Promise<string | undefined>
    trustedPath: BackgroundFilePort['trustedPath']
    write: BackgroundFilePort['write']
    launch: (
      file: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => Pick<ChildProcess, 'once' | 'unref'>
  },
): Promise<() => Promise<void>> {
  const io = deps ?? {
    identity: startIdentity,
    trustedPath: trustedBackgroundPath,
    write: (file: string, text: string) => nodeBackgroundFiles().write(file, text),
    launch: (file: string, args: readonly string[], options: SpawnOptions) =>
      spawn(file, [...args], options),
  }
  const launcher = await io.trustedPath(executable, process.platform, process.getuid?.() ?? 0)
  const script = await io.trustedPath(agentFile, process.platform, process.getuid?.() ?? 0)
  const identity = await io.identity(process.pid)
  if (identity === undefined) throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
  const file = path.join(dataDir, 'background-wakes', `${String(process.pid)}-${randomUUID()}.json`)
  await io.write(file, JSON.stringify({ pid: process.pid, startIdentity: identity }))
  return async () => {
    // Start its bounded wait after settlement, so long turns use no retry budget.
    const child = io.launch(launcher, [script, 'schedule', 'background-maintain', '--json'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: withoutCredentials(process.env),
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
  }
}

/** Check both the named chain and the canonical chain, including the root. */
export async function trustedBackgroundPath(
  file: string,
  platform: NodeJS.Platform,
  uid: number,
  deps?: {
    realpath: (file: string) => Promise<string>
    lstat: (
      file: string,
    ) => Promise<Pick<Stats, 'uid' | 'mode' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>>
    run: (file: string, args: readonly string[]) => Promise<BackgroundProcessResult>
  },
): Promise<string> {
  const io = deps ?? { realpath, lstat, run: backgroundProcessRunner(process.env) }
  const p = platform === 'win32' ? path.win32 : path.posix
  if (!p.isAbsolute(file) || /\p{Cc}/u.test(file)) throw unsafeScheduleLauncher(file)
  let resolved: string
  try {
    resolved = await io.realpath(file)
    const info = await io.lstat(resolved)
    if (!info.isFile()) throw unsafeScheduleLauncher(file)
  } catch {
    throw unsafeScheduleLauncher(file)
  }
  const checked = new Set<string>()
  for (const initial of [file, resolved]) {
    for (const target of ancestors(p, initial)) {
      if (checked.has(target)) {
        continue
      }

      checked.add(target)
      try {
        const info = await io.lstat(target)
        if (platform === 'win32') {
          // Reject every untrusted allow ACE, even if a deny ACE also exists.
          const literal = target.replaceAll("'", "''")
          const script = `$ErrorActionPreference = 'Stop'; $identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $trusted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'); $acl = Get-Acl -LiteralPath '${literal}'; $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; $safe = ($trusted -contains $owner) -and ($identity.User.Value -match '^S-1-(?:5-21|12-1)-') -and -not $identity.IsSystem -and -not ($identity.Groups.Value -contains 'S-1-5-6') -and -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { if ($ace.AccessControlType -eq 'Allow' -and ([int]$ace.FileSystemRights -band 0x000D0156) -ne 0 -and $trusted -notcontains $ace.IdentityReference.Value) { $safe = $false } }; ConvertTo-Json -Compress -InputObject ([bool]$safe)`
          const result = await io.run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ])
          if (result.exitCode !== 0 || !z.boolean().parse(JSON.parse(result.stdout)))
            throw unsafeScheduleLauncher(target)
        } else if (
          (info.uid !== uid && info.uid !== 0) ||
          (!info.isSymbolicLink() &&
            (info.mode & SCHEDULE_UNTRUSTED_WRITE_MODE) !== 0 &&
            (!info.isDirectory() || (info.mode & SCHEDULE_STICKY_MODE) === 0))
        )
          throw unsafeScheduleLauncher(target)
      } catch {
        throw unsafeScheduleLauncher(target)
      }
    }
  }
  return resolved
}

/** Native wakes reverify the very launcher and script that started this process. */
export async function verifyScheduleWake(
  executable: string,
  agentFile: string,
  deps?: {
    platform: NodeJS.Platform
    uid: number
    effectiveUid: number
    trustedPath: BackgroundFilePort['trustedPath']
  },
): Promise<void> {
  const io = deps ?? {
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    effectiveUid: process.geteuid?.() ?? 0,
    trustedPath: trustedBackgroundPath,
  }
  if (io.platform !== 'win32' && (io.uid === 0 || io.effectiveUid === 0))
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  await io.trustedPath(executable, io.platform, io.uid)
  await io.trustedPath(agentFile, io.platform, io.uid)
}

function systemProgram(file: string, env: NodeJS.ProcessEnv): string {
  if (file === 'launchctl') return '/bin/launchctl'
  if (file === 'systemctl') return '/usr/bin/systemctl'
  if (file !== 'powershell.exe' && file !== 'schtasks.exe') return file
  const root = Object.entries(env).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1]
  if (root === undefined || !path.win32.isAbsolute(root) || /[\p{Cc}]/u.test(root))
    throw new Error(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
  return file === 'powershell.exe'
    ? path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', file)
    : path.win32.join(root, 'System32', file)
}

/** Only the fixed OS programs receive this credential-free environment. */
export function backgroundProcessRunner(
  env: NodeJS.ProcessEnv,
): (file: string, args: readonly string[]) => Promise<BackgroundProcessResult> {
  return async (file, args) => {
    try {
      const result = await promisify(execFile)(systemProgram(file, env), [...args], {
        env: withoutCredentials(env),
        windowsHide: true,
        timeout: SCHEDULE_POLL_INTERVAL_MS,
        maxBuffer: SCHEDULE_MAX_PROMPT_CHARS,
      })
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number' &&
        'stdout' in error &&
        typeof error.stdout === 'string' &&
        'stderr' in error &&
        typeof error.stderr === 'string'
      )
        return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }
      throw new Error(UI_TEXT.scheduleV2.runtime.unavailable, { cause: error })
    }
  }
}

/** Owner-only files; no recursive deletion, and a missing file alone reads absent. */
export function nodeBackgroundFiles(): BackgroundFilePort {
  return {
    trustedPath: trustedBackgroundPath,
    waitForWake: (dataDir) => waitForScheduleWake(dataDir),
    async read(file) {
      let handle
      try {
        handle = await open(file, 'r')
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') return
        throw error
      }
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > SCHEDULE_MAX_PROMPT_CHARS)
          throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
        const bytes = Buffer.alloc(SCHEDULE_MAX_PROMPT_CHARS + 1)
        let offset = 0
        for (;;) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
          offset += bytesRead
          if (offset > SCHEDULE_MAX_PROMPT_CHARS)
            throw new Error(UI_TEXT.scheduleV2.runtime.invalidResponse)
          if (bytesRead === 0)
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))
        }
      } finally {
        await handle.close()
      }
    },
    async write(file, text, encoding) {
      await mkdir(path.dirname(file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', REPORT_STORAGE_FILE_MODE)
        try {
          await handle.writeFile(
            encoding === 'utf16le' ? Buffer.from(`\u{FEFF}${text}`, 'utf16le') : text,
            'utf8',
          )
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    async remove(file) {
      await rm(file, { force: true })
    },
  }
}
