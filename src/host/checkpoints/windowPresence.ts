// Which windows are open on a checkpoint store, and which turns run in each
// (M72, M86; PLAN.md D51, D63). Two VS Code windows on the same folder
// ("Duplicate Workspace", or a reload racing the old extension host) share
// `<global storage>/checkpoints/<namespace>`. Nothing there is locked: each
// window keeps a presence file of its own (its process id, its store's
// instance id and its running turns), replaced whole on every change and on
// every heartbeat, so another window reads one version or the next. A window
// is gone on process exit only when its current attestation contains no
// native or unresolved process activity. Native/unknown state remains closed
// until explicitly confirmed recovery; age and owner PID death never prove
// that workspace-capable descendants stopped.
//
// Mixed versions (M86, spec section 7): this version publishes
// `fenced-window-v2`. A 0.10.0 window knows only v1, so it reads this one as
// unfenced and refuses its own restores while this one is live; this version
// reads a v1 window as a legacy window, whose restores it cannot see, and
// refuses its own. A window that has seen a v1 window since it opened leaves
// its presence file behind when it closes, so the 0.10.0 window stays fenced
// until it reloads (0.10.0 never removes a v2 file); this version removes a
// gone window's file only while no v1 window is live.

import { randomUUID } from 'node:crypto'
import { constants as fsConstants, rmSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_LEGACY_FENCED_WINDOW,
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'

const PRESENCE_DIR = 'windows'
const PRESENCE_SUFFIX = '.json'
const ASIDE_SUFFIX = '.aside'
const ALREADY_THERE = 'EEXIST'
const NO_SUCH_PROCESS = 'ESRCH'
const UNREADABLE_TURN = 'unreadable-presence'

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

/** The text as JSON; undefined when it is not JSON. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Runs `task` once `previous` settled, whichever way: that write failed for its own caller. */
async function afterSettled(previous: Promise<unknown>, task: () => Promise<void>): Promise<void> {
  try {
    await previous
  } catch {
    // This write carries the latest state regardless.
  }
  await task()
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

/** Whether a window's running list is fenced by this version or by 0.10.0. */
function isFenced(running: readonly string[]): boolean {
  return (
    running.includes(CHECKPOINT_FENCED_WINDOW) || running.includes(CHECKPOINT_LEGACY_FENCED_WINDOW)
  )
}

/** A 0.10.0 window: fenced with v1 only. Its restores and records are its own. */
export function isLegacyWindow(running: readonly string[]): boolean {
  return (
    running.includes(CHECKPOINT_LEGACY_FENCED_WINDOW) && !running.includes(CHECKPOINT_FENCED_WINDOW)
  )
}

export interface WindowPresenceDeps {
  readonly storageDir: string
  /** This store's id: one per window, so two stores in one process differ too. */
  readonly instance: string
  readonly pid: number
  readonly isProcessAlive: (pid: number) => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly signal: AbortSignal
}

interface Seen {
  readonly presence: Presence | undefined
}

export class WindowPresence {
  private readonly presenceDir: string
  /** Whether this window keeps a presence file (from its first use until it closes). */
  private isPresent = false
  /** The turns this window last published as running. */
  private running: readonly string[] = []
  /** Presence writes, one after another: the last one carries the latest turns. */
  private writing: Promise<unknown> = Promise.resolve()
  /** A 0.10.0 window was live at some read since this one opened: its file stays at close. */
  private hasSeenLegacy = false

  public constructor(private readonly deps: WindowPresenceDeps) {
    this.presenceDir = path.join(deps.storageDir, PRESENCE_DIR)
  }

  private get presencePath(): string {
    return path.join(this.presenceDir, `${this.deps.instance}${PRESENCE_SUFFIX}`)
  }

  /** A presence file's window; undefined when gone. */
  private async read(filePath: string): Promise<Seen | undefined> {
    try {
      const text = await readFile(filePath, 'utf8')
      const presence = presenceSchema.safeParse(parsedJson(text))
      return {
        presence: presence.success ? presence.data : undefined,
      }
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return undefined
      }
      throw error
    }
  }

  /** Owner exit cannot prove native descendants or an unknown window stopped. */
  private isGone(seen: Seen): boolean {
    const running = seen.presence?.running ?? []
    return (
      seen.presence !== undefined &&
      isFenced(running) &&
      !running.includes(CHECKPOINT_NATIVE_WINDOW) &&
      running.every((key) => !key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) &&
      !this.deps.isProcessAlive(seen.presence.pid)
    )
  }

  private turnsOf(presence: Presence | undefined): readonly string[] {
    if (presence === undefined) {
      return [UNREADABLE_TURN]
    }
    const running = presence.running ?? []
    const isUnprovedActivity =
      running.some((key) => key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) &&
      !this.deps.isProcessAlive(presence.pid)
    return isUnprovedActivity ? [CHECKPOINT_NATIVE_WINDOW, ...running] : running
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
    // The window left while the file was being written: it goes again,
    // unless it must stay for a 0.10.0 window.
    if (this.hasLeft() && !this.hasSeenLegacy) {
      await rm(this.presencePath, { force: true })
    }
  }

  /** Writes the presence file from memory, after any write before it. */
  private async writeInTurn(): Promise<void> {
    const current = afterSettled(this.writing, () => this.write())
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
   * included. The presence files of windows that are gone are removed, but
   * only while no 0.10.0 window is live: a file a window of this version
   * left behind for it keeps it fenced.
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
    const gone: string[] = []
    const presenceFiles = names.filter((entry) => entry.endsWith(PRESENCE_SUFFIX))
    for (const name of presenceFiles) {
      // A window's file is named by its instance.
      const instance = name.slice(0, -PRESENCE_SUFFIX.length)
      const filePath = path.join(this.presenceDir, name)
      const seen = await this.read(filePath)
      if (seen === undefined || instance === this.deps.instance) {
        continue
      }
      if (this.isGone(seen)) {
        gone.push(name)
        continue
      }
      live.set(instance, this.turnsOf(seen.presence))
    }
    for (const running of live.values()) {
      if (isLegacyWindow(running)) {
        this.hasSeenLegacy = true
        return live
      }
    }
    for (const name of gone) {
      const filePath = path.join(this.presenceDir, name)
      await this.removeIfGone(filePath)
      // A heartbeat may have replaced the original while its old file
      // was aside. Read the current file, including its current turns.
      const current = await this.read(filePath)
      if (current !== undefined && !this.isGone(current)) {
        live.set(name.slice(0, -PRESENCE_SUFFIX.length), this.turnsOf(current.presence))
      }
    }
    return live
  }

  /**
   * The window is closing: its presence goes at once, and no write brings it
   * back. It stays when this window may still have work under way, and when
   * a 0.10.0 window was seen since this one opened (that window stays fenced
   * until it reloads; a later window of this version removes the file once
   * no 0.10.0 window is live).
   */
  public leave(): void {
    if (
      !this.isPresent ||
      !this.running.includes(CHECKPOINT_FENCED_WINDOW) ||
      this.running.includes(CHECKPOINT_NATIVE_WINDOW) ||
      this.running.some((key) => key.startsWith(CHECKPOINT_ACTIVITY_PREFIX))
    ) {
      return
    }
    this.isPresent = false
    if (this.hasSeenLegacy) {
      return
    }
    try {
      rmSync(this.presencePath, { force: true })
    } catch {
      // An uncertain leftover remains closed to destructive operations.
    }
  }
}
