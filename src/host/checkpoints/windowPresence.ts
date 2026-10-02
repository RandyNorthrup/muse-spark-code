// Which windows are open on a checkpoint store, and which turns run in each
// (M72, PLAN.md D51). Two VS Code windows on the same folder ("Duplicate
// Workspace", or a reload racing the old extension host) share
// `<workspace storage>/checkpoints`. Nothing there is locked: each window
// keeps a presence file of its own (its process id, its store's instance id
// and its running turns), replaced whole on every change and on every
// heartbeat, so another window reads one version or the next. A window is
// gone on process exit only when its current attestation contains no native
// or unresolved process activity. Native/unknown state remains closed until
// explicitly confirmed recovery; age and owner PID death never prove that
// workspace-capable descendants stopped.
//
// Beside its presence file each window keeps a saves file: the files the
// user saved in it, with when, written whole the same way whether or not a
// turn runs there. A turn's end reads every other window's saves file, so a
// save in an idle window (or one closed since) is the user's, not the
// turn's. A saves file outlives its window until no turn can need it.

import { randomUUID } from 'node:crypto'
import { constants as fsConstants, rmSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_FILE_TIME_SLACK_MS,
  CHECKPOINT_PEER_SAVE_KEEP_MS,
  CHECKPOINT_PEER_SAVES_MAX,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'

const PRESENCE_DIR = 'windows'
const PRESENCE_SUFFIX = '.json'
// Not `.json`: a saves file is no window's presence.
const SAVES_SUFFIX = '.saves'
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

const savesSchema = z.object({
  pid: z.number(),
  saves: z.array(z.object({ path: z.string(), at: z.number() })),
  /** The newest save the count limit let go of; absent when it let none go. */
  droppedThrough: z.optional(z.number()),
})
type Saves = z.infer<typeof savesSchema>

/** What the user saved in the other windows since a time, and which files cannot say. */
interface PeerSaves {
  readonly saved: ReadonlySet<string>
  /** The saves files (or their folder) that may hold such a save and cannot tell. */
  readonly unknown: readonly string[]
}

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
  /** When the user last saved each file in this window, oldest first, as the saves file holds it. */
  private readonly saves = new Map<string, number>()
  /** The newest save the count limit let go of. */
  private droppedThrough: number | undefined
  /** Saves-file writes, one after another: the last one carries every save. */
  private savesWriting: Promise<unknown> = Promise.resolve()

  public constructor(private readonly deps: WindowPresenceDeps) {
    this.presenceDir = path.join(deps.storageDir, PRESENCE_DIR)
  }

  private get presencePath(): string {
    return path.join(this.presenceDir, `${this.deps.instance}${PRESENCE_SUFFIX}`)
  }

  private get savesName(): string {
    return `${this.deps.instance}${SAVES_SUFFIX}`
  }

  /** A presence file's window and when it was last written; undefined when gone. */
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
      running.includes(CHECKPOINT_FENCED_WINDOW) &&
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
    // The window left while the file was being written: it goes again.
    if (this.hasLeft()) {
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

  /** The saves files' names, this window's included. */
  private async savesNames(): Promise<readonly string[]> {
    try {
      const names = await readdir(this.presenceDir)
      return names.filter((name) => name.endsWith(SAVES_SUFFIX))
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return []
      }
      throw error
    }
  }

  /** A saves file; undefined when gone; `saves` undefined when it cannot be read. */
  private async readSaves(
    filePath: string,
  ): Promise<{ readonly saves: Saves | undefined } | undefined> {
    let text: string
    try {
      text = await readFile(filePath, 'utf8')
    } catch (error: unknown) {
      return isMissingPath(error) ? undefined : { saves: undefined }
    }
    const saves = savesSchema.safeParse(parsedJson(text))
    return { saves: saves.success ? saves.data : undefined }
  }

  /**
   * Whether a file may have been written at or after `since`: every save
   * rewrites its window's file, so one last written before holds no save
   * made since. Unsure (the file cannot be looked at) counts as written.
   */
  private async isWrittenSince(filePath: string, since: number): Promise<boolean> {
    try {
      const stats = await stat(filePath)
      return stats.mtimeMs >= since - CHECKPOINT_FILE_TIME_SLACK_MS
    } catch (error: unknown) {
      return !isMissingPath(error)
    }
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
      if (this.isGone(seen)) {
        await this.removeIfGone(filePath)
        // A heartbeat may have replaced the original while its old file
        // was aside. Read the current file, including its current turns.
        const current = await this.read(filePath)
        if (current === undefined || this.isGone(current)) {
          continue
        }
        live.set(instance, this.turnsOf(current.presence))
        continue
      }
      live.set(instance, this.turnsOf(seen.presence))
    }
    return live
  }

  /** The window is closing: its presence goes at once, and no write brings it back. */
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
    try {
      rmSync(this.presencePath, { force: true })
    } catch {
      // An uncertain leftover remains closed to destructive operations.
    }
  }

  /**
   * The user saved a file in this window (relative to the workspace), noted
   * in the order the saves came, for the next `writeSaves`: the newest save
   * of each file is kept. Saves older than the keep time go; past the count
   * limit the oldest go, and the newest of those is noted.
   */
  public noteSave(relative: string, at: number): void {
    this.saves.delete(relative)
    this.saves.set(relative, at)
    for (const [saved, savedAt] of this.saves) {
      if (at - savedAt > CHECKPOINT_PEER_SAVE_KEEP_MS) {
        this.saves.delete(saved)
      }
    }
    for (const [saved, savedAt] of this.saves) {
      if (this.saves.size <= CHECKPOINT_PEER_SAVES_MAX) {
        break
      }
      this.saves.delete(saved)
      this.droppedThrough = Math.max(this.droppedThrough ?? savedAt, savedAt)
    }
  }

  /**
   * Writes the saves file whole from memory (no lock: only this window
   * writes it), after the write before it: the last one carries every save.
   */
  public async writeSaves(): Promise<void> {
    const current = afterSettled(this.savesWriting, async () => {
      await mkdir(this.presenceDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
      const saves: Saves = {
        pid: this.deps.pid,
        saves: Array.from(this.saves, ([relative, at]) => ({ path: relative, at })),
        ...(this.droppedThrough !== undefined && { droppedThrough: this.droppedThrough }),
      }
      await writeFileAtomically(
        path.join(this.presenceDir, this.savesName),
        JSON.stringify(saves),
        { sleep: this.deps.sleep },
      )
    })
    this.savesWriting = current
    await current
  }

  /**
   * What the user saved at or after `since` in the folder's other windows,
   * closed ones included: a save there was the user's all the same. Never
   * throws: what cannot be read is named in `unknown` instead, when it may
   * hold such a save (a file that does not parse and was written since, or
   * one whose count limit let such a save go).
   */
  public async peerSaves(since: number): Promise<PeerSaves> {
    const saved = new Set<string>()
    const unknown: string[] = []
    let names: readonly string[]
    try {
      names = await this.savesNames()
    } catch {
      return { saved, unknown: [PRESENCE_DIR] }
    }
    for (const name of names) {
      if (name === this.savesName) {
        continue
      }
      const filePath = path.join(this.presenceDir, name)
      const seen = await this.readSaves(filePath)
      if (seen?.saves === undefined) {
        if (seen !== undefined && (await this.isWrittenSince(filePath, since))) {
          unknown.push(name)
        }
        continue
      }
      if ((seen.saves.droppedThrough ?? -Infinity) >= since) {
        unknown.push(name)
      }
      for (const save of seen.saves.saves) {
        if (save.at >= since) {
          saved.add(save.path)
        }
      }
    }
    return { saved, unknown }
  }

  /**
   * Removes the saves files of windows whose process is gone (it writes no
   * more) once their newest save is older than the keep time: a turn that
   * started before that save has run past the keep time, and its end counts
   * every save as unknown. A file that cannot be read stays: whose it is
   * cannot be told.
   */
  public async dropGoneSaves(now: number): Promise<void> {
    const names = await this.savesNames()
    for (const name of names) {
      const filePath = path.join(this.presenceDir, name)
      const seen = await this.readSaves(filePath)
      const saves = seen?.saves
      if (saves === undefined || this.deps.isProcessAlive(saves.pid)) {
        continue
      }
      const newest = Math.max(
        saves.droppedThrough ?? -Infinity,
        ...saves.saves.map((save) => save.at),
      )
      if (now - newest > CHECKPOINT_PEER_SAVE_KEEP_MS) {
        await rm(filePath, { force: true })
      }
    }
  }
}
