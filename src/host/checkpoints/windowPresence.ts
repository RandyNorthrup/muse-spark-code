// Which windows are open on a checkpoint store, and which turns run in each
// (M72, PLAN.md D51). Two VS Code windows on the same folder ("Duplicate
// Workspace", or a reload racing the old extension host) share
// `<workspace storage>/checkpoints`. Nothing there is locked: each window
// keeps a presence file of its own (its process id, its store's instance id
// and its running turns), replaced whole on every change and on every
// heartbeat, so another window reads one version or the next. A window is
// gone when its process has exited or its file has not been written for
// CHECKPOINT_OWNER_STALE_MS (a reused process id, a hung host); only then
// are its pinned captures, staged copies and index dropped.

import { randomUUID } from 'node:crypto'
import { constants as fsConstants, rmSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { CHECKPOINT_OWNER_STALE_MS, CHECKPOINT_STORAGE_MODE } from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'

const PRESENCE_DIR = 'windows'
const PRESENCE_SUFFIX = '.json'
const ASIDE_SUFFIX = '.aside'
const ALREADY_THERE = 'EEXIST'
const NO_SUCH_PROCESS = 'ESRCH'

const presenceSchema = z.object({
  pid: z.number(),
  instance: z.string(),
  running: z.optional(z.array(z.string())),
})
type Presence = z.infer<typeof presenceSchema>

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

export interface WindowPresenceDeps {
  readonly storageDir: string
  /** This store's id: one per window, so two stores in one process differ too. */
  readonly instance: string
  readonly pid: number
  readonly isProcessAlive: (pid: number) => boolean
  /** The wall clock the file times are compared with. */
  readonly clock: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly signal: AbortSignal
}

interface Seen {
  readonly presence: Presence | undefined
  readonly writtenAt: number
}

export class WindowPresence {
  private readonly presenceDir: string
  /** Whether this window keeps a presence file (from its first use until it closes). */
  private isPresent = false
  /** The turns this window last published as running. */
  private running: readonly string[] = []
  /** Presence writes, one after another: the last one carries the latest turns. */
  private writing: Promise<unknown> = Promise.resolve()

  public constructor(private readonly deps: WindowPresenceDeps) {
    this.presenceDir = path.join(deps.storageDir, PRESENCE_DIR)
  }

  private get presencePath(): string {
    return path.join(this.presenceDir, `${this.deps.instance}${PRESENCE_SUFFIX}`)
  }

  /** A presence file's window and when it was last written; undefined when gone. */
  private async read(filePath: string): Promise<Seen | undefined> {
    try {
      const [text, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      const presence = presenceSchema.safeParse(parsed)
      return {
        presence: presence.success ? presence.data : undefined,
        writtenAt: stats.mtimeMs,
      }
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return undefined
      }
      throw error
    }
  }

  /** Whether the window is gone: its process exited, or it has been silent past the stale time. */
  private isGone(seen: Seen): boolean {
    const isSilent = this.deps.clock() - seen.writtenAt > CHECKPOINT_OWNER_STALE_MS
    return seen.presence === undefined
      ? isSilent
      : isSilent || !this.deps.isProcessAlive(seen.presence.pid)
  }

  /** Whether the window has left (read afresh after an await). */
  private hasLeft(): boolean {
    return !this.isPresent
  }

  private async write(): Promise<void> {
    if (this.deps.signal.aborted || !this.isPresent) {
      return
    }
    await mkdir(this.presenceDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    await writeFileAtomically(
      this.presencePath,
      JSON.stringify({
        pid: this.deps.pid,
        instance: this.deps.instance,
        running: this.running,
      }),
      { sleep: this.deps.sleep },
    )
    // The window left while the file was being written: it goes again.
    if (this.hasLeft()) {
      await rm(this.presencePath, { force: true })
    }
  }

  /** Writes the presence file from memory, after any write before it. */
  private async writeInTurn(): Promise<void> {
    const previous = this.writing
    const current = (async () => {
      try {
        await previous
      } catch {
        // That write failed for its own caller; this one carries the latest turns.
      }
      await this.write()
    })()
    this.writing = current
    await current
  }

  /**
   * Removes a gone window's presence file, unless it was written again after
   * it was read: it is moved aside under a name no other move uses, read
   * again, and put back when that window beat meanwhile. True when removed.
   */
  private async removeIfGone(filePath: string): Promise<boolean> {
    const aside = `${filePath}.${randomUUID()}${ASIDE_SUFFIX}`
    try {
      await rename(filePath, aside)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return true
      }
      throw error
    }
    const moved = await this.read(aside)
    const isStillGone = moved === undefined || this.isGone(moved)
    if (!isStillGone) {
      try {
        await copyFile(aside, filePath, fsConstants.COPYFILE_EXCL)
      } catch (error: unknown) {
        if (errorCode(error) !== ALREADY_THERE) {
          throw error
        }
      }
    }
    await rm(aside, { force: true })
    return isStillGone
  }

  /**
   * Publishes this window as present with these turns running (no lock:
   * only this window writes its file). Resolves once the file says so.
   */
  public async publish(running: readonly string[]): Promise<void> {
    this.isPresent = true
    this.running = [...running]
    await this.writeInTurn()
  }

  /**
   * The heartbeat: the presence file is written again from memory, so a
   * file another window removed (thinking this one gone) or a failed write
   * heals within one beat.
   */
  public async beat(): Promise<void> {
    if (this.isPresent) {
      await this.writeInTurn()
    }
  }

  /**
   * The windows open on this store and the turns running in each, this one
   * included. The presence files of windows that are gone are removed.
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
      // A window's file is named by its instance.
      const instance = name.slice(0, -PRESENCE_SUFFIX.length)
      const filePath = path.join(this.presenceDir, name)
      const seen = await this.read(filePath)
      if (seen === undefined || instance === this.deps.instance) {
        continue
      }
      if (this.isGone(seen) && (await this.removeIfGone(filePath))) {
        continue
      }
      live.set(instance, seen.presence?.running ?? [])
    }
    return live
  }

  /** The window is closing: its presence goes at once, and no write brings it back. */
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
