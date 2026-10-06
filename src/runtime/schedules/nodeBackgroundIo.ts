import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { storeErrorCode } from '../../host/backend/storeErrors'
import {
  CHECKPOINT_STORAGE_MODE,
  REPORT_STORAGE_FILE_MODE,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_POLL_INTERVAL_MS,
  SCHEDULE_WAKE_WAIT_MS,
  SCHEDULE_WAKE_RETRY_MS,
  SCHEDULE_NATIVE_MAX_OUTPUT_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { agentDataFolder } from '../dataFolder'
import {
  unsafeScheduleLauncher,
  backgroundDefinitionPaths,
  backgroundRecordPath,
  backgroundRegistrationId,
  backgroundWakeRecordSchema,
  type ScheduleWakeAuthorization,
} from './registration'
import type { BackgroundFilePort, BackgroundProcessResult } from './nativeBackground'
import type { TrustedPathVerifier } from '../trustedPathPort'
import { windowsTrustedPathVerifier } from '../windowsTrustedPath'
import { effectiveBackgroundDefinition, scheduleWindowsOwner } from './effectiveDefinition'

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
  shouldWait = true,
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
    if (!shouldWait || io.now() >= deadline)
      throw new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable)
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

/** M104/TRUSTED-PATH supplies POSIX verification; missing bindings refuse. */
export async function trustedBackgroundPath(
  file: string,
  platform: NodeJS.Platform,
  _uid: number,
  verifier?: TrustedPathVerifier,
  kind?: 'definition' | 'directory' | 'search-directory',
): Promise<string> {
  const trusted =
    verifier ??
    (platform === 'win32'
      ? windowsTrustedPathVerifier(backgroundProcessRunner(process.env))
      : undefined)
  if (trusted === undefined) throw unsafeScheduleLauncher(file)
  let target = file
  if (kind === 'search-directory') {
    if (platform !== 'linux' || !path.posix.isAbsolute(file) || /[\p{Cc}\\]/u.test(file))
      throw unsafeScheduleLauncher(file)
    for (const candidate of ancestors(path.posix, file)) {
      try {
        await lstat(candidate)
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') continue
        throw unsafeScheduleLauncher(candidate)
      }
      target = candidate
      break
    }
  }
  const result = await trusted.verify(target, {
    leafKind: kind === 'directory' || kind === 'search-directory' ? 'directory' : 'file',
  })
  if ('refused' in result) throw unsafeScheduleLauncher(result.component)
  return result.path
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
    homeDir?: string
    dataDir?: string
    read?: BackgroundFilePort['read']
    hash?: BackgroundFilePort['hash']
    run?: (file: string, args: readonly string[]) => Promise<BackgroundProcessResult>
  },
  registrationId?: string,
): Promise<ScheduleWakeAuthorization> {
  const io: NonNullable<typeof deps> = deps ?? {
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    effectiveUid: process.geteuid?.() ?? 0,
    trustedPath: nodeTrustedPath,
  }
  if (io.platform !== 'win32' && (io.uid === 0 || io.effectiveUid === 0))
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  if (io.platform === 'win32')
    await scheduleWindowsOwner(io.run ?? backgroundProcessRunner(process.env))
  const launcher = await io.trustedPath(executable, io.platform, io.uid)
  const script = await io.trustedPath(agentFile, io.platform, io.uid)
  if (registrationId === undefined) return { scheduledPrompts: false }
  const homeDir = io.homeDir ?? homedir()
  const dataDir =
    io.dataDir ?? agentDataFolder({ platform: io.platform, env: process.env, homeDir })
  if (registrationId !== backgroundRegistrationId(homeDir))
    throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
  const files = nodeBackgroundFiles()
  const recordFile = backgroundRecordPath(io.platform, dataDir)
  await io.trustedPath(recordFile, io.platform, io.uid, 'definition')
  const record = backgroundWakeRecordSchema.parse(
    JSON.parse((await (io.read ?? files.read)(recordFile)) ?? 'null'),
  )
  const p = io.platform === 'win32' ? path.win32 : path.posix
  const normalize = (file: string) => p.normalize(file).replaceAll('\\', '/')
  const isSamePath = (left: string, right: string) => {
    return io.platform === 'win32'
      ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
      : normalize(left) === normalize(right)
  }
  if (
    record.id !== registrationId ||
    !isSamePath(record.executable, launcher) ||
    !isSamePath(record.agentFile, script)
  )
    throw unsafeScheduleLauncher(recordFile)
  if (record.disabledAtMs !== undefined) throw unsafeScheduleLauncher(recordFile)
  const definitions = backgroundDefinitionPaths(io.platform, homeDir, dataDir)
  const effective = await effectiveBackgroundDefinition({
    platform: io.platform,
    id: registrationId,
    definitions,
    executable: launcher,
    trustedPath: io.trustedPath,
    uid: io.uid,
    hash: io.hash ?? files.hash,
    read: io.read ?? files.read,
    run: io.run ?? backgroundProcessRunner(process.env),
  })
  if (record.files.length !== effective.files.length) throw unsafeScheduleLauncher(recordFile)
  for (const [index, expected] of record.files.entries()) {
    const actual = effective.files[index]
    if (
      actual === undefined ||
      !isSamePath(expected.path, actual.path) ||
      expected.sha256 !== actual.sha256
    )
      throw unsafeScheduleLauncher(actual?.path ?? recordFile)
  }
  if (record.definitionSha256 !== effective.sha256) throw unsafeScheduleLauncher(recordFile)
  if (record.scheduledPrompts !== true) return { scheduledPrompts: false }
  if (record.maxBudgetUsd === undefined || !Number.isFinite(record.maxBudgetUsd))
    throw new Error(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
  return { scheduledPrompts: true, maxBudgetUsd: record.maxBudgetUsd }
}

function systemProgram(file: string, env: NodeJS.ProcessEnv): string {
  if (file === 'launchctl') return '/bin/launchctl'
  if (file === 'systemctl') return '/usr/bin/systemctl'
  if (file === 'systemd-analyze') return '/usr/bin/systemd-analyze'
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
        maxBuffer: SCHEDULE_NATIVE_MAX_OUTPUT_BYTES,
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

/** State and definition hashing share the same bounded, file-only read. */
async function backgroundBytes(file: string): Promise<Buffer | undefined> {
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
      if (bytesRead === 0) return bytes.subarray(0, offset)
    }
  } finally {
    await handle.close()
  }
}

/** Owner-only files; no recursive deletion, and a missing file alone reads absent. */
const nodeTrustedPath: BackgroundFilePort['trustedPath'] = (file, platform, uid, kind) =>
  trustedBackgroundPath(file, platform, uid, undefined, kind)

export function nodeBackgroundFiles(verifier?: TrustedPathVerifier): BackgroundFilePort {
  const trustedPath: BackgroundFilePort['trustedPath'] = (file, platform, uid, kind) =>
    trustedBackgroundPath(file, platform, uid, verifier, kind)
  return {
    trustedPath,
    waitForWake: (dataDir, shouldWait) => waitForScheduleWake(dataDir, undefined, shouldWait),
    async prepare(file, platform, uid) {
      const p = platform === 'win32' ? path.win32 : path.posix
      const missing: string[] = []
      let hasTrustedAncestor = false
      const directories = ancestors(p, p.dirname(file))
      for (const directory of directories) {
        try {
          await lstat(directory)
        } catch (error: unknown) {
          if (storeErrorCode(error) !== 'ENOENT') throw unsafeScheduleLauncher(directory)
          missing.push(directory)
          continue
        }
        await trustedPath(directory, platform, uid, 'directory')
        hasTrustedAncestor = true
        break
      }
      if (!hasTrustedAncestor) throw unsafeScheduleLauncher(file)
      for (const directory of missing.toReversed()) {
        await mkdir(directory, { mode: CHECKPOINT_STORAGE_MODE })
        await trustedPath(directory, platform, uid, 'directory')
      }
      try {
        await lstat(file)
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') return
        throw unsafeScheduleLauncher(file)
      }
      await trustedPath(file, platform, uid, 'definition')
    },
    async hash(file) {
      const bytes = await backgroundBytes(file)
      return bytes === undefined ? undefined : createHash('sha256').update(bytes).digest('hex')
    },
    async read(file) {
      const bytes = await backgroundBytes(file)
      return bytes === undefined
        ? undefined
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
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
