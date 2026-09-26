// The file access behind Muse Code's memory (M49, PLAN.md D41): the Model
// API tools' own reads and existing-file replacements (UTF-8 text, a size
// cap), no-clobber publication of complete new notes, and a folder's entries
// by kind, with a link or junction
// reported as neither a file nor a folder so the store never follows one.
// The workspace's name for the project folder is taken from the path as the
// operating system spells it, which is what Muse Code hashes.

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs'
import { link, mkdir, open, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ATOMIC_TEMPORARY_SUFFIX, MEMORY_STAGE_FILE_MODE } from '../../shared/constants'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import type { MemoryDirectoryEntry, MemoryIo } from '../../core/memory/memoryStore'
import { isMissingPath } from '../canonicalPath'

/** A folder's entries; none when it does not exist. */
export async function listMemoryEntries(
  absolutePath: string,
): Promise<readonly MemoryDirectoryEntry[]> {
  try {
    const entries = await readdir(absolutePath, { withFileTypes: true })
    return entries.map((entry) => {
      let kind: MemoryDirectoryEntry['kind'] = 'other'
      if (entry.isFile()) {
        kind = 'file'
      } else if (entry.isDirectory()) {
        kind = 'directory'
      }
      return { name: entry.name, kind }
    })
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return []
    }
    throw error
  }
}

export function createMemoryIo(
  files: Pick<ToolIo, 'readFile' | 'writeFile' | 'realPath' | 'hasUnsavedChanges'>,
  options: {
    /** A warning when cleanup fails after the target has already been published. */
    readonly warn: (message: string) => void
    /** Replace the hard-link call in a deterministic publication test. */
    readonly publish?: (stage: string, target: string) => Promise<void>
  },
): MemoryIo {
  return {
    readFile: (absolutePath) => files.readFile(absolutePath),
    hasUnsavedChanges: (absolutePath) => files.hasUnsavedChanges(absolutePath),
    writeFile: (absolutePath, content) => files.writeFile(absolutePath, content),
    async createFile(absolutePath, content) {
      const directory = path.dirname(absolutePath)
      await mkdir(directory, { recursive: true })
      const stage = path.join(
        directory,
        `.${path.basename(absolutePath)}.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`,
      )
      let hasOwnedStage = false
      try {
        const handle = await open(stage, 'wx', MEMORY_STAGE_FILE_MODE)
        hasOwnedStage = true
        try {
          await handle.writeFile(content, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        // A same-folder hard link publishes complete bytes under the target
        // name without replacing another writer's note. Unsupported file
        // systems fail closed; copy and rename cannot make both guarantees.
        await (options.publish ?? link)(stage, absolutePath)
      } finally {
        if (hasOwnedStage) {
          try {
            await rm(stage, { force: true })
          } catch (error: unknown) {
            // Once linked, the note is complete. Keep that success so its
            // index line is written; the hidden stage can be cleaned later.
            options.warn(`memory stage ${stage} could not be removed: ${String(error)}`)
          }
        }
      }
    },
    realPath: (absolutePath) => files.realPath(absolutePath),
    listEntries: listMemoryEntries,
  }
}

/**
 * The folder as the operating system names it: links resolved and each
 * name in its own letter case (VS Code lowers a Windows drive letter; Muse
 * Code's `canonicalize` does not).
 */
export const systemPath: (absolutePath: string) => Promise<string> = promisify(realpath.native)
