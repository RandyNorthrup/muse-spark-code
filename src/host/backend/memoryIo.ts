// The file access behind Muse Code's memory (M49, PLAN.md D41): the Model
// API tools' own reads and existing-file replacements (UTF-8 text, a size
// cap), no-clobber publication of complete new notes, and a folder's entries
// by kind, with a link or junction
// reported as neither a file nor a folder so the store never follows one.
// The workspace's name for the project folder is taken from the path as the
// operating system spells it, which is what Muse Code hashes.

import { realpath } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { MEMORY_STAGE_FILE_MODE } from '../../shared/constants'
import type { StagedFile, ToolIo } from '../../core/backends/modelapi/tools'
import type { MemoryDirectoryEntry, MemoryIo } from '../../core/memory/memoryStore'
import { isMissingPath } from '../canonicalPath'
import { createFileExclusively } from '../fsAtomic'

/**
 * A folder's entries by kind, a link or junction reported as neither file
 * nor folder; rejects as `readdir` does (plans, M79, tell a missing folder
 * from one that is a file).
 */
export async function entriesByKind(
  absolutePath: string,
): Promise<readonly MemoryDirectoryEntry[]> {
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
}

/** A folder's entries; none when it does not exist. */
export async function listMemoryEntries(
  absolutePath: string,
): Promise<readonly MemoryDirectoryEntry[]> {
  try {
    return await entriesByKind(absolutePath)
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
    /** Existing atomic staging seam for a deterministic publication test. */
    readonly staged?: (file: StagedFile) => Promise<void>
    /** Runtime owners fence publication after asynchronous staging. */
    readonly assertCanWrite?: () => void
    /**
     * Exclusive creation has no ToolIo write call: what the tool io does
     * around a write runs here instead, the checkpoint storage refused and,
     * through a turn's recording io (M86), its intent journaled before
     * `publish` runs.
     */
    readonly aroundCreate?: (
      absolutePath: string,
      content: string,
      checkedPath: string | undefined,
      publish: (staged?: (file: StagedFile) => Promise<void>) => Promise<void>,
    ) => Promise<void>
  },
): MemoryIo {
  const admission = (assertCanWrite?: () => void) => () => {
    options.assertCanWrite?.()
    assertCanWrite?.()
  }
  const createNote = (
    absolutePath: string,
    content: string,
    checkedPath: string | undefined,
    assertCanWrite: (() => void) | undefined,
    staged?: (file: StagedFile) => Promise<void>,
  ) =>
    createFileExclusively(absolutePath, content, {
      mode: MEMORY_STAGE_FILE_MODE,
      assertCanWrite: admission(assertCanWrite),
      // The folder `locate` checked (C2-4): one swapped for a link since is refused.
      ...(checkedPath !== undefined && { expectedDirectory: path.dirname(checkedPath) }),
      // The stage is named after the note, which the model named: not logged (M39).
      warn: (_stage, isPublished, error) => {
        const when = isPublished ? 'after the note was published' : 'after the write failed'
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        options.warn(`a memory note's hidden stage could not be removed ${when} (${String(code)})`)
      },
      ...(options.publish !== undefined && { publish: options.publish }),
      staged: async (file) => {
        await options.staged?.(file)
        await staged?.(file)
      },
    })
  return {
    readFile: (absolutePath, observeSource) =>
      files.readFile(absolutePath, undefined, undefined, observeSource),
    hasUnsavedChanges: (absolutePath) => files.hasUnsavedChanges(absolutePath),
    // The checked path holds a replacement to where `locate` found the note (C2-4, M86).
    writeFile: (absolutePath, content, checkedPath, assertCanWrite) =>
      files.writeFile(absolutePath, content, checkedPath, admission(assertCanWrite)),
    createFile: async (absolutePath, content, checkedPath, assertCanWrite) => {
      const publish = (staged?: (file: StagedFile) => Promise<void>) =>
        createNote(absolutePath, content, checkedPath, assertCanWrite, staged)
      await (options.aroundCreate === undefined
        ? publish()
        : options.aroundCreate(absolutePath, content, checkedPath, publish))
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
