// One window at a time in a checkpoint store (M72, PLAN.md D51). Two VS Code
// windows on the same folder ("Duplicate Workspace", or a reload racing the
// old extension host) share `<workspace storage>/checkpoints`: its records,
// its private index and its refs. Every operation of the store runs under an
// exclusive lock file there, naming its owner (process id and the store's
// instance id), its time kept fresh by a heartbeat while held. A lock is
// taken over only when its owner is gone: the process has exited, or it has
// not beaten for CHECKPOINT_OWNER_STALE_MS (a reused process id, a hung
// host). Each open store also keeps a presence file beating, so another
// window can tell a live window's pinned captures, tool copies and running
// turns from those of a window that is gone.

import { rmSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_FILE_MODE,
  CHECKPOINT_LOCK_RETRY_MS,
  CHECKPOINT_OWNER_STALE_MS,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import type { Logger } from '../logger'

const LOCK_FILE = 'store.lock'
const PRESENCE_DIR = 'windows'
const PRESENCE_SUFFIX = '.json'
const SET_ASIDE_SUFFIX = '.taken'
const ALREADY_THERE = 'EEXIST'
// Windows answers EPERM for a file whose deletion is still pending.
const BUSY_CODES: ReadonlySet<string> = new Set([ALREADY_THERE, 'EPERM', 'EBUSY'])
const NO_SUCH_PROCESS = 'ESRCH'

const ownerSchema = z.object({ pid: z.number(), instance: z.string() })
type Owner = z.infer<typeof ownerSchema>

/** The lock was not taken in time, or another window took it over: the action is refused. */
export class StoreBusyError extends Error {
  public constructor(detail: string) {
    super(`another window on this folder holds its checkpoints: ${detail}`)
    this.name = 'StoreBusyError'
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/** Whether a process with this id exists (one we may not signal still exists). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return errorCode(error) !== NO_SUCH_PROCESS
  }
}

export interface StoreLockDeps {
  readonly storageDir: string
  /** This store's id: one per window, so two stores in one process differ too. */
  readonly instance: string
  readonly pid: number
  readonly isProcessAlive: (pid: number) => boolean
  /** The wall clock the file times are compared with. */
  readonly clock: () => number
  readonly sleep: (ms: number) => Promise<void>
  /** How long an operation waits for another window's (CHECKPOINT_LOCK_WAIT_MS). */
  readonly waitMs: number
  readonly signal: AbortSignal
  readonly log: Logger
}

interface Seen {
  readonly owner: Owner | undefined
  readonly modifiedAt: number
}

function isSameOwner(left: Owner | undefined, right: Owner | undefined): boolean {
  return left?.pid === right?.pid && left?.instance === right?.instance
}

export class StoreLock {
  private readonly lockPath: string
  private readonly presenceDir: string
  private isHeld = false
  private isPresent = false

  public constructor(private readonly deps: StoreLockDeps) {
    this.lockPath = path.join(deps.storageDir, LOCK_FILE)
    this.presenceDir = path.join(deps.storageDir, PRESENCE_DIR)
  }

  private get presencePath(): string {
    return path.join(this.presenceDir, `${this.deps.instance}${PRESENCE_SUFFIX}`)
  }

  private get self(): Owner {
    return { pid: this.deps.pid, instance: this.deps.instance }
  }

  /** The owner a lock or presence file names, and when it last beat; undefined when gone. */
  private async read(filePath: string): Promise<Seen | undefined> {
    try {
      const [text, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      const owner = ownerSchema.safeParse(parsed)
      return { owner: owner.success ? owner.data : undefined, modifiedAt: stats.mtimeMs }
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return undefined
      }
      throw error
    }
  }

  /** Whether the owner is gone: exited, or silent past the stale time. */
  private isGone(seen: Seen): boolean {
    const isSilent = this.deps.clock() - seen.modifiedAt > CHECKPOINT_OWNER_STALE_MS
    if (seen.owner === undefined) {
      // Still being written, or unreadable: only its age tells.
      return isSilent
    }
    return isSilent || !this.deps.isProcessAlive(seen.owner.pid)
  }

  private async tryCreate(): Promise<boolean> {
    try {
      const handle = await open(this.lockPath, 'wx', CHECKPOINT_FILE_MODE)
      try {
        await handle.writeFile(JSON.stringify(this.self))
      } finally {
        await handle.close()
      }
      return true
    } catch (error: unknown) {
      if (BUSY_CODES.has(errorCode(error) ?? '')) {
        return false
      }
      throw error
    }
  }

  /**
   * Takes a gone owner's lock away: it is moved aside, and deleted only if
   * it is still the one judged gone. A lock taken in between is put back,
   * unless yet another has been taken by then.
   */
  private async takeOver(seen: Seen): Promise<void> {
    const aside = `${this.lockPath}.${this.deps.instance}${SET_ASIDE_SUFFIX}`
    try {
      await rename(this.lockPath, aside)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return
      }
      throw error
    }
    const moved = await this.read(aside)
    if (moved !== undefined && !isSameOwner(moved.owner, seen.owner)) {
      try {
        await copyFile(aside, this.lockPath, fsConstants.COPYFILE_EXCL)
      } catch (error: unknown) {
        if (errorCode(error) !== ALREADY_THERE) {
          throw error
        }
      }
    } else {
      this.deps.log.warn(
        `Took over the checkpoint lock of a window that is gone (process ${String(seen.owner?.pid ?? 'unknown')})`,
      )
    }
    await rm(aside, { force: true })
  }

  private async acquire(): Promise<void> {
    await mkdir(this.deps.storageDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    const deadline = this.deps.clock() + this.deps.waitMs
    let holder: Owner | undefined
    for (;;) {
      if (this.deps.signal.aborted) {
        throw new StoreBusyError('the window is closing')
      }
      if (await this.tryCreate()) {
        this.isHeld = true
        return
      }
      const seen = await this.read(this.lockPath)
      if (seen !== undefined && isSameOwner(seen.owner, this.self)) {
        // Ours, left behind by a task that could not let go of it.
        this.isHeld = true
        return
      }
      if (seen !== undefined && this.isGone(seen)) {
        await this.takeOver(seen)
        continue
      }
      holder = seen?.owner ?? holder
      if (this.deps.clock() >= deadline) {
        throw new StoreBusyError(`process ${String(holder?.pid ?? 'unknown')} held it`)
      }
      await this.deps.sleep(CHECKPOINT_LOCK_RETRY_MS)
    }
  }

  private async release(): Promise<void> {
    this.isHeld = false
    const seen = await this.read(this.lockPath)
    if (seen !== undefined && isSameOwner(seen.owner, this.self)) {
      await rm(this.lockPath, { force: true })
    }
  }

  /** Marks this window present, so its pins, copies and running turns count as live. */
  private async markPresent(): Promise<void> {
    if (this.isPresent) {
      return
    }
    await mkdir(this.presenceDir, { recursive: true })
    await rm(this.presencePath, { force: true })
    const handle = await open(this.presencePath, 'wx', CHECKPOINT_FILE_MODE)
    try {
      await handle.writeFile(JSON.stringify(this.self))
    } finally {
      await handle.close()
    }
    this.isPresent = true
  }

  /** Runs the task holding the lock; StoreBusyError when it was not taken in time. */
  public async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      await this.markPresent()
      return await task()
    } finally {
      await this.release()
    }
  }

  /** Before a write: still ours, or another window took it over (this one then refuses). */
  public async assertHeld(): Promise<void> {
    const lost = new StoreBusyError('its lock was taken over')
    if (!this.isHeld) {
      throw lost
    }
    const seen = await this.read(this.lockPath)
    if (seen === undefined || !isSameOwner(seen.owner, this.self)) {
      throw lost
    }
  }

  /** The heartbeat: the presence file, and the lock while held, get a fresh time. */
  public async beat(): Promise<void> {
    const now = new Date(this.deps.clock())
    const beaten = [
      ...(this.isPresent ? [this.presencePath] : []),
      ...(this.isHeld ? [this.lockPath] : []),
    ]
    for (const filePath of beaten) {
      try {
        await utimes(filePath, now, now)
      } catch (error: unknown) {
        if (!isMissingPath(error)) {
          throw error
        }
      }
    }
  }

  /**
   * The instances of the windows open on this store, this one included; the
   * presence files of windows that are gone are removed (held lock only).
   */
  public async liveInstances(): Promise<ReadonlySet<string>> {
    const live = new Set([this.deps.instance])
    let names: string[]
    try {
      names = await readdir(this.presenceDir)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return live
      }
      throw error
    }
    const presenceFiles = names.filter((entry) => entry.endsWith(PRESENCE_SUFFIX))
    for (const name of presenceFiles) {
      const filePath = path.join(this.presenceDir, name)
      const seen = await this.read(filePath)
      if (seen?.owner === undefined || seen.owner.instance === this.deps.instance) {
        continue
      }
      if (this.isGone(seen)) {
        await rm(filePath, { force: true })
      } else {
        live.add(seen.owner.instance)
      }
    }
    return live
  }

  /** The window is closing: its presence goes at once (a held lock goes with its task). */
  public leave(): void {
    if (!this.isPresent) {
      return
    }
    this.isPresent = false
    try {
      rmSync(this.presencePath, { force: true })
    } catch {
      // Gone with its folder, or not removable: its age marks it gone.
    }
  }
}
