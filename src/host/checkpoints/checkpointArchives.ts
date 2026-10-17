// Archived conversations for the checkpoint store (M72, PLAN.md D51). When
// a conversation is archived, a small file saying so is written at once
// into `<workspace storage>/checkpoints/archives/` (one file per archive,
// replaced whole, no lock and no git, so it works in Restricted Mode and
// never waits for another window). Every window honours it from then on: the
// conversation's checkpoints taken before the archive are no longer listed
// or restored, and no capture taken before it is recorded. A window that may
// run git deletes their records and refs; the file stays for
// CHECKPOINT_FORGOTTEN_KEEP_MS, then goes.

import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { CHECKPOINT_STORAGE_MODE } from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'

const ARCHIVES_DIR = 'archives'
const ARCHIVE_SUFFIX = '.json'

const archiveSchema = z.object({ sessionId: z.string(), at: z.number() })
export type Archive = z.infer<typeof archiveSchema>

/** An archive and its file. */
export interface ArchiveFile {
  readonly file: string
  readonly archive: Archive
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Writes the archive, durable before this resolves. */
export async function writeArchive(
  storageDir: string,
  id: string,
  archive: Archive,
): Promise<void> {
  const folder = path.join(storageDir, ARCHIVES_DIR)
  await mkdir(folder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
  await writeFileAtomically(path.join(folder, `${id}${ARCHIVE_SUFFIX}`), JSON.stringify(archive), {
    sleep: pause,
  })
}

/** Every archive on disk; a file that does not parse is skipped. */
export async function readArchives(storageDir: string): Promise<readonly ArchiveFile[]> {
  const folder = path.join(storageDir, ARCHIVES_DIR)
  let names: string[]
  try {
    names = await readdir(folder)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return []
    }
    throw error
  }
  const files: ArchiveFile[] = []
  const archiveNames = names.filter((name) => name.endsWith(ARCHIVE_SUFFIX))
  for (const name of archiveNames) {
    const file = path.join(folder, name)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        continue
      }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const result = archiveSchema.safeParse(parsed)
    if (result.success) {
      files.push({ file, archive: result.data })
    }
  }
  return files
}

/** Whether something of this conversation made at `createdAt` was archived since. */
export function isArchived(
  archives: readonly ArchiveFile[],
  sessionId: string,
  createdAt: number,
): boolean {
  return archives.some(
    (entry) => entry.archive.sessionId === sessionId && createdAt <= entry.archive.at,
  )
}

export async function removeArchive(entry: ArchiveFile): Promise<void> {
  await rm(entry.file, { force: true })
}
