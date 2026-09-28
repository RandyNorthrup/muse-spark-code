// One window at a time in a checkpoint store (M72, PLAN.md D51). Two VS Code
// windows on the same folder ("Duplicate Workspace", or a reload racing the
// old extension host) share `<workspace storage>/checkpoints`: its records,
// its private index and its refs. Every operation of the store runs under an
// exclusive lock file there, naming its owner (process id and the store's
// instance id), its time kept fresh by a heartbeat while held. A lock is
// taken over only when its owner is gone: the process has exited, or it has
// not beaten for CHECKPOINT_OWNER_STALE_MS (a reused process id, a hung
// host). Each open store also keeps a presence file beating, with the turns
// running in it (published with no lock, before a turn may edit a file), so
// another window can tell a live window's pinned captures and running turns
// from those of a window that is gone.

import { randomUUID } from 'node:crypto'
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
import { writeFileAtomically } from '../fsAtomic'
import type { Logger } from '../logger'

const LOCK_FILE = 'store.lock'
const PRESENCE_DIR = 'windows'
const PRESENCE_SUFFIX = '.json'
const SET_ASIDE_SUFFIX = '.aside'
const ALREADY_THERE = 'EEXIST'
// Windows answers EPERM for a file whose deletion is still pending, or one
// another process has open.
const IN_USE_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])
const BUSY_CODES: ReadonlySet<string> = new Set([ALREADY_THERE, ...IN_USE_CODES])
// Letting go of the lock tries this many times, a short wait apart, while the
// file is in use.
const RELEASE_ATTEMPTS = 5
const RELEASE_RETRY_MS = 50
const NO_SUCH_PROCESS = 'ESRCH'

// A presence file also lists the window's running turns (opaque keys).
const ownerSchema = z.object({
  pid: z.number(),
  instance: z.string(),
  running: z.optional(z.array(z.string())),
})
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
  /** Whether this window keeps a presence file (from its first use until it closes). */
  private isPresent = false
  /** Whether the presence file says what `running` says. */
  private isWritten = false
  /** The turns this window last published as running. */
  private running: readonly string[] = []
  /** Presence writes, one after another: the last one carries the latest turns. */
  private publishing: Promise<unknown> = Promise.resolve()

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

  /** A name to move the lock to that no other move uses. */
  private asidePath(): string {
    return `${this.lockPath}.${randomUUID()}${SET_ASIDE_SUFFIX}`
  }

  /** Puts a lock moved aside back, unless another has been taken by then. */
  private async putBack(aside: string): Promise<void> {
    try {
      await copyFile(aside, this.lockPath, fsConstants.COPYFILE_EXCL)
    } catch (error: unknown) {
      if (errorCode(error) !== ALREADY_THERE) {
        throw error
      }
    }
  }

  /**
   * Takes a gone owner's lock away: it is moved aside (under a name no other
   * move uses), and deleted only if it is still the one judged gone. A lock
   * taken in between is put back, unless yet another has been taken by
   * then. False when the lock could not be moved yet (in use): try later.
   */
  private async takeOver(seen: Seen): Promise<boolean> {
    const aside = this.asidePath()
    try {
      await rename(this.lockPath, aside)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return true
      }
      if (IN_USE_CODES.has(errorCode(error) ?? '')) {
        return false
      }
      throw error
    }
    const moved = await this.read(aside)
    if (moved !== undefined && !isSameOwner(moved.owner, seen.owner)) {
      await this.putBack(aside)
    } else {
      this.deps.log.warn(
        `Took over the checkpoint lock of a window that is gone (process ${String(seen.owner?.pid ?? 'unknown')})`,
      )
    }
    await rm(aside, { force: true })
    return true
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
        // Ours, left behind by a task that could not let go of it: fresh again.
        const now = new Date(this.deps.clock())
        await utimes(this.lockPath, now, now)
        this.isHeld = true
        return
      }
      if (seen !== undefined && this.isGone(seen) && (await this.takeOver(seen))) {
        continue
      }
      holder = seen?.owner ?? holder
      if (this.deps.clock() >= deadline) {
        throw new StoreBusyError(`process ${String(holder?.pid ?? 'unknown')} held it`)
      }
      await this.deps.sleep(CHECKPOINT_LOCK_RETRY_MS)
    }
  }

  /** Moves the lock aside to let go of it, trying again while it is in use. */
  private async moveAside(aside: string): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(this.lockPath, aside)
        return true
      } catch (error: unknown) {
        if (isMissingPath(error)) {
          return false
        }
        if (!IN_USE_CODES.has(errorCode(error) ?? '') || attempt >= RELEASE_ATTEMPTS) {
          throw error
        }
        await this.deps.sleep(RELEASE_RETRY_MS)
      }
    }
  }

  /**
   * Lets go of the lock: it is moved aside, so what is deleted is exactly
   * the file this window checked is its own; another window's lock (it took
   * this one over meanwhile) is put back. A lock that cannot be let go is
   * logged and left: this window takes it again next time, fresh.
   */
  private async release(): Promise<void> {
    this.isHeld = false
    const aside = this.asidePath()
    try {
      if (!(await this.moveAside(aside))) {
        return
      }
      const moved = await this.read(aside)
      if (moved !== undefined && !isSameOwner(moved.owner, this.self)) {
        await this.putBack(aside)
      }
      await rm(aside, { force: true })
    } catch (error: unknown) {
      this.deps.log.warn(`The checkpoint lock was not let go: ${String(error)}`)
    }
  }

  private async writePresence(): Promise<void> {
    if (this.deps.signal.aborted || !this.isPresent) {
      return
    }
    try {
      await mkdir(this.presenceDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
      await writeFileAtomically(
        this.presencePath,
        JSON.stringify({ ...this.self, running: this.running }),
        { sleep: this.deps.sleep },
      )
    } catch (error: unknown) {
      this.isWritten = false
      throw error
    }
    this.isWritten = true
  }

  /** Writes the presence file from memory, after any write before it. */
  private async writeInTurn(): Promise<void> {
    const previous = this.publishing
    const write = (async () => {
      try {
        await previous
      } catch {
        // That write failed for its own caller; this one carries the latest turns.
      }
      await this.writePresence()
    })()
    this.publishing = write
    await write
  }

  /**
   * Publishes this window as present with these turns running. No lock: only
   * this window writes its presence file, replaced whole, so another window
   * reads one version or the next. Resolves once the file says so.
   */
  public async publish(running: readonly string[]): Promise<void> {
    this.isPresent = true
    this.running = [...running]
    await this.writeInTurn()
  }

  /** Runs the task holding the lock; StoreBusyError when it was not taken in time. */
  public async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      this.isPresent = true
      if (!this.isWritten) {
        await this.writeInTurn()
      }
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

  /**
   * The heartbeat: a lock this window holds gets a fresh time, and the
   * presence file is written again from memory, so a missing file (removed
   * by a window that thought this one gone) or a failed write heals.
   */
  public async beat(): Promise<void> {
    if (this.isHeld) {
      const now = new Date(this.deps.clock())
      try {
        await utimes(this.lockPath, now, now)
      } catch (error: unknown) {
        if (!isMissingPath(error)) {
          throw error
        }
      }
    }
    if (this.isPresent) {
      await this.writeInTurn()
    }
  }

  /**
   * The windows open on this store and the turns running in each, this one
   * included; the presence files of windows that are gone are removed (held
   * lock only).
   */
  public async liveWindows(): Promise<ReadonlyMap<string, readonly string[]>> {
    const live = new Map<string, readonly string[]>([[this.deps.instance, this.running]])
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
        live.set(seen.owner.instance, seen.owner.running ?? [])
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
    this.isWritten = false
    try {
      rmSync(this.presencePath, { force: true })
    } catch {
      // Gone with its folder, or not removable: its age marks it gone.
    }
  }
}
