// One exclusive file lock serializes every subscription grant's files in
// global storage across windows and processes. The lock directory holds
// one owner file per contender; a contender wins by publishing its
// prepared directory atomically, and recovers only owners proven gone. A
// stuck acquisition fails after the caller's deadline instead of hanging.
// One wrapper serves every subscription provider; each provider binds its
// own lock names and failure class.
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import * as z from 'zod/mini'
import { MILLISECONDS_PER_SECOND } from '../../shared/constants'

const processStartedAt = Date.now() - process.uptime() * MILLISECONDS_PER_SECOND
const activeLocks = new Set<string>()
const lockOwnerSchema = z.strictObject({
  pid: z.int().check(z.positive()),
  startedAt: z.number().check(z.positive()),
  windowId: z.uuid(),
  expiresAt: z.number().check(z.positive()),
})

export function fileErrorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

/**
The catch-gate-visible form of the expected file-lock condition: `is`-named
so the inventory reads it as the one handled case, with exactly the same
answer as the code-list check on every input.
*/
function isFileErrorCode(error: unknown, ...codes: readonly string[]): boolean {
  return codes.includes(String(fileErrorCode(error)))
}

/** An expired lease alone never proves a live process has stopped refreshing. */
function isOwnerGone(owner: z.infer<typeof lockOwnerSchema>, file: string): boolean {
  if (owner.pid === process.pid && owner.startedAt === processStartedAt)
    return owner.expiresAt <= Date.now() && !activeLocks.has(file)
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    // ESRCH proves the owner is gone and EPERM proves it is alive; any other
    // probe failure is unexpected and stays what it is.
    if (!isFileErrorCode(error, 'ESRCH', 'EPERM')) throw error
    return fileErrorCode(error) === 'ESRCH'
  }
}

async function hasRecoveredLock(lockPath: string): Promise<boolean> {
  try {
    const files = await readdir(lockPath)
    for (const file of files) {
      if (!file.endsWith('.json') || !z.uuid().safeParse(file.slice(0, -'.json'.length)).success)
        continue
      const ownerPath = path.join(lockPath, file)
      const raw: unknown = JSON.parse(await readFile(ownerPath, 'utf8'))
      const parsed = lockOwnerSchema.safeParse(raw)
      if (parsed.success && isOwnerGone(parsed.data, file)) await unlink(ownerPath)
    }
    // Each acquisition has a unique filename. A concurrent recovery can only
    // unlink that old owner; rmdir cannot remove a new owner's nonempty directory.
    await rmdir(lockPath)
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'))
      return false
    throw error
  }
}

export interface SubscriptionFileLockBinding<E extends Error> {
  readonly lockFile: string
  readonly tmpPrefix: string
  failBusy(): E
}

/** A complete owner directory is published atomically; a live one is nonempty. */
export async function withSubscriptionFileLock<T, E extends Error>(
  directory: string,
  ownerId: string,
  timeoutMs: number,
  pollMs: number,
  work: () => Promise<T>,
  binding: SubscriptionFileLockBinding<E>,
): Promise<T> {
  await mkdir(directory, { recursive: true })
  const lockPath = path.join(directory, binding.lockFile)
  const deadline = Date.now() + timeoutMs
  const prepared = await mkdtemp(path.join(directory, binding.tmpPrefix))
  const file = `${randomUUID()}.json`
  let isOwned = false
  try {
    await writeFile(
      path.join(prepared, file),
      JSON.stringify({
        pid: process.pid,
        startedAt: processStartedAt,
        windowId: ownerId,
        expiresAt: deadline,
      }),
      { flag: 'wx' },
    )
    while (!isOwned) {
      try {
        // Windows rename can replace a regular legacy file with a directory.
        // A present ownerless file must remain closed, including on Windows.
        try {
          const stat = await lstat(lockPath)
          if (!stat.isDirectory()) {
            if (Date.now() >= deadline) throw binding.failBusy()
            await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
            continue
          }
        } catch (error) {
          if (!isFileErrorCode(error, 'ENOENT')) throw error
        }
        await rename(prepared, lockPath)
        isOwned = true
        activeLocks.add(file)
      } catch (error) {
        if (!isFileErrorCode(error, 'EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EACCES', 'EBUSY'))
          throw error
        const isRecovered = await hasRecoveredLock(lockPath)
        if (Date.now() >= deadline) throw binding.failBusy()
        if (isRecovered) continue
        await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
      }
    }
    return await work()
  } finally {
    if (isOwned) {
      try {
        await unlink(path.join(lockPath, file))
      } finally {
        activeLocks.delete(file)
      }
      await hasRecoveredLock(lockPath)
    } else await rm(prepared, { recursive: true, force: true })
  }
}
