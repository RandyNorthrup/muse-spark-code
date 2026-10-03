// Mark live journal/record content, then sweep every unreferenced copy, including
// files created before an intent and crash-left blob stages. The caller holds
// the cleanup reservation and has freshly proved that no writer is live.
import type { Dir } from 'node:fs'
import { opendir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Owner, WriteRecord } from '../../core/checkpoints/toolWrites'
import { lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  CHECKPOINT_BLOBS_DIR,
  CHECKPOINT_COPY_GRACE_MS,
  CHECKPOINT_COPY_SWEEP_MAX_FILES,
  CHECKPOINT_COPY_SWEEP_MAX_MS,
  CHECKPOINT_WRITES_DIR,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { WriteJournal } from './writeJournal'

interface CopyFolder {
  readonly instance: string
  readonly directory: Dir
}

function ownerKey(owner: Owner): string {
  return JSON.stringify([owner.instance, owner.sessionId, owner.unitKind, owner.unitId])
}

function mark(write: WriteRecord, needed: Set<string>): void {
  for (const state of [write.before, write.after]) {
    if (state.present && state.oid !== undefined) needed.add(state.oid)
  }
}

async function directoryOrMissing(folder: string): Promise<Dir | undefined> {
  try {
    return await opendir(folder)
  } catch (error: unknown) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

export class CheckpointCopies {
  private root: Dir | undefined
  private current: CopyFolder | undefined

  public constructor(private readonly storageDir: string) {}

  private async marked(
    instance: string,
    retired: ReadonlySet<string>,
    writes: readonly WriteRecord[],
  ): Promise<ReadonlySet<string> | undefined> {
    const journal = await WriteJournal.readInstance(this.storageDir, instance)
    // An unexplained tail may refer to any copy: retain all recovery inputs.
    if (journal !== undefined && journal.tornTail !== 'none') return undefined
    const needed = new Set<string>()
    const entries = journal?.entries ?? []
    for (const entry of entries) {
      if (entry.kind === 'intent' && !retired.has(ownerKey(entry.write.owner)))
        mark(entry.write, needed)
    }
    for (const write of writes) {
      if (write.instance === instance) mark(write, needed)
    }
    return needed
  }

  /** Metadata-folder removal waits until its directory cursor is closed. */
  public isScanning(instance: string): boolean {
    return this.current?.instance === instance
  }

  /** Count/time bounded traversal, with open directory cursors carried to the next pass. */
  public async sweep(
    retiredOwners: readonly Owner[],
    liveWrites: readonly WriteRecord[],
  ): Promise<void> {
    const until = performance.now() + CHECKPOINT_COPY_SWEEP_MAX_MS
    const retired = new Set(retiredOwners.map((owner) => ownerKey(owner)))
    this.root ??= await directoryOrMissing(path.join(this.storageDir, CHECKPOINT_WRITES_DIR))
    let visited = 0
    let markedInstance: string | undefined
    let needed: ReadonlySet<string> | undefined
    while (
      this.root !== undefined &&
      visited < CHECKPOINT_COPY_SWEEP_MAX_FILES &&
      performance.now() < until
    ) {
      if (this.current === undefined) {
        const entry = await this.root.read()
        visited += 1
        if (entry === null) {
          await this.close()
          return
        }
        if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) continue
        const directory = await directoryOrMissing(
          path.join(this.root.path, entry.name, CHECKPOINT_BLOBS_DIR),
        )
        if (directory === undefined) continue
        this.current = { instance: entry.name, directory }
      }
      const { instance, directory } = this.current
      if (markedInstance !== instance) {
        needed = await this.marked(instance, retired, liveWrites)
        markedInstance = instance
      }
      if (needed === undefined) {
        await directory.close()
        this.current = undefined
        continue
      }
      const entry = await directory.read()
      visited += 1
      if (entry === null) {
        await directory.close()
        this.current = undefined
        continue
      }
      if (!entry.isFile() || needed.has(entry.name)) continue
      const file = path.join(directory.path, entry.name)
      try {
        const sample = await lstatIdentity(file)
        if (!sample.isFile() || Date.now() - Number(sample.mtimeMs) < CHECKPOINT_COPY_GRACE_MS)
          continue
        const current = await lstatIdentity(file)
        if (
          sameFile(sample, current) &&
          sample.mtimeNs === current.mtimeNs &&
          sample.size === current.size
        ) {
          await rm(file, { force: true })
        }
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
      }
    }
  }

  public async close(): Promise<void> {
    const current = this.current
    const root = this.root
    this.current = undefined
    this.root = undefined
    await current?.directory.close()
    await root?.close()
  }
}
