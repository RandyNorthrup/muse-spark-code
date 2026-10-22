// M88, lane A: the prompt sequence file store. One JSON file per sequence
// in its scope's `sequences/` subfolder (so the prompt scan keeps skipping
// the folder); the prompt store's own shape — segmented folders with link
// rejection, a damaged scope in fixed words, one write lock, atomic rename.
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  PROMPT_FILE_MODE,
  PROMPT_FOLDER_MODE,
  PROMPT_USER_FOLDER,
  PROMPT_WORKSPACE_FOLDER,
  SEQUENCE_FILE_SUFFIX,
  SEQUENCE_SUBFOLDER,
  UI_TEXT,
} from '../../shared/constants'
import {
  mergeSequenceScopes,
  parseSequenceFile,
  savedSequenceSchema,
  serialiseSequenceFile,
  type SavedSequence,
  type SequenceScope,
} from '../../shared/sequences'
import { lstatIdentity, sameFile } from '../fs/fileIdentity'
import { readPromptFile } from './promptFile'

/** Portable disk store beside the prompt store; no VS Code state, no sync. */
export class SequenceStore {
  public constructor(
    private readonly dataFolder: string,
    private readonly workspaceRoot?: string,
  ) {}

  private async checkedFolder(
    scope: SequenceScope,
    shouldCreate: boolean,
  ): Promise<string | undefined> {
    const base = scope === 'user' ? this.dataFolder : this.workspaceRoot
    if (base === undefined) throw new Error(UI_TEXT.promptWorkspaceRequired)
    if (shouldCreate && scope === 'user')
      await mkdir(base, { recursive: true, mode: PROMPT_FOLDER_MODE })
    // Resolve the host-selected root; reject links in every directory segment.
    const root = await realpath(base)
    let current = root
    const segments =
      scope === 'user'
        ? [PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER]
        : [...PROMPT_WORKSPACE_FOLDER.split('/'), SEQUENCE_SUBFOLDER]
    for (const segment of segments) {
      current = path.join(current, segment)
      if (shouldCreate) {
        try {
          await mkdir(current, { mode: PROMPT_FOLDER_MODE })
        } catch (error: unknown) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
      }
      let stat
      try {
        stat = await lstat(current)
      } catch (error: unknown) {
        if (!shouldCreate && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return undefined
        }
        throw error
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(UI_TEXT.promptStoreDamaged)
    }
    return current
  }

  private async scan(scope: SequenceScope): Promise<{ sequence: SavedSequence; file: string }[]> {
    let directory: string | undefined
    try {
      directory = await this.checkedFolder(scope, false)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    if (directory === undefined) return []
    const entries = await readdir(directory, { withFileTypes: true })
    const rows: { sequence: SavedSequence; file: string }[] = []
    for (const entry of entries) {
      if (!entry.name.endsWith(SEQUENCE_FILE_SUFFIX)) continue
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(UI_TEXT.promptStoreDamaged)
      const file = path.join(directory, entry.name)
      let sequence: SavedSequence
      try {
        sequence = validateSequenceFile(parseSequenceFile(await readPromptFile(file)))
      } catch (error: unknown) {
        throw new Error(UI_TEXT.promptStoreDamaged, { cause: error })
      }
      if (sequence.scope !== scope || rows.some((row) => row.sequence.id === sequence.id)) {
        throw new Error(UI_TEXT.promptStoreDamaged)
      }
      rows.push({ sequence, file })
    }
    return rows
  }

  private async mutate<T>(
    scope: SequenceScope,
    run: (directory: string) => Promise<T>,
  ): Promise<T> {
    const directory = await this.checkedFolder(scope, true)
    if (directory === undefined) throw new Error(UI_TEXT.promptStoreDamaged)
    const identity = await lstatIdentity(directory)
    const lock = path.join(directory, '.write-lock')
    let handle
    try {
      handle = await open(lock, 'wx', PROMPT_FILE_MODE)
    } catch (error) {
      // A lock that cannot be taken is contention: the fixed words reach
      // the caller, carrying the failure that proved it.
      throw new Error(UI_TEXT.promptStoreBusy, { cause: error })
    }
    try {
      if (!sameFile(identity, await lstatIdentity(directory)))
        throw new Error(UI_TEXT.promptStoreDamaged)
      return await run(directory)
    } finally {
      await handle.close()
      await rm(lock)
    }
  }

  /** False without a folder: the workspace scope is then unavailable. */
  public get hasWorkspace(): boolean {
    return this.workspaceRoot !== undefined
  }

  /**
  Save a new or edited sequence; a blank name, no steps or a blank step
  refuses in words (D121: only the blank refuses). Answers the saved row,
  stamped on the host clock, keeping a known row's creation time.
  */
  public async save(input: SavedSequence): Promise<SavedSequence> {
    const sequence = validateSequenceInput(input)
    return await this.mutate(sequence.scope, async (directory) => {
      const rows = await this.scan(sequence.scope)
      const existing = rows.find((row) => row.sequence.id === sequence.id)
      const now = new Date().toISOString()
      const next: SavedSequence = savedSequenceSchema.parse({
        ...sequence,
        createdAt: existing?.sequence.createdAt ?? now,
        updatedAt: now,
      })
      if (
        existing !== undefined &&
        serialiseSequenceFile({ ...next, updatedAt: existing.sequence.updatedAt }) ===
          serialiseSequenceFile(existing.sequence)
      ) {
        return existing.sequence
      }
      const digest = createHash('sha256').update(sequence.id).digest('hex')
      const target = existing?.file ?? path.join(directory, `${digest}${SEQUENCE_FILE_SUFFIX}`)
      const temp = path.join(directory, `.${randomUUID()}.tmp`)
      const identity = await lstatIdentity(directory)
      const handle = await open(temp, 'wx', PROMPT_FILE_MODE)
      try {
        await handle.writeFile(serialiseSequenceFile(next), 'utf8')
        await handle.sync()
        await handle.close()
        if (!sameFile(identity, await lstatIdentity(directory)))
          throw new Error(UI_TEXT.promptStoreDamaged)
        if (existing !== undefined) {
          const current = validateSequenceFile(parseSequenceFile(await readPromptFile(target)))
          if (serialiseSequenceFile(current) !== serialiseSequenceFile(existing.sequence))
            throw new Error(UI_TEXT.promptStoreBusy)
        }
        await rename(temp, target)
      } finally {
        await handle.close()
        await rm(temp, { force: true })
      }
      return next
    })
  }

  /** Remove one sequence; an id that is already gone resolves. */
  public async remove(scope: SequenceScope, id: string): Promise<void> {
    await this.mutate(scope, async () => {
      const rows = await this.scan(scope)
      const row = rows.find((entry) => entry.sequence.id === id)
      if (row !== undefined) {
        await rm(row.file)
      }
    })
  }

  /** User first, then workspace, in library order; a damaged scope refuses. */
  public async library(): Promise<SavedSequence[]> {
    try {
      const user = await this.scan('user')
      const workspace = this.workspaceRoot === undefined ? [] : await this.scan('workspace')
      return mergeSequenceScopes(
        user.map((row) => row.sequence),
        workspace.map((row) => row.sequence),
      )
    } catch (error) {
      throw new Error(UI_TEXT.promptStoreDamaged, { cause: error })
    }
  }
}

/**
A stored file's shape: well-formed JSON of the schema, whatever its
blanks. Blanks refuse at save and at the run's start, never the read, so
a hand-edited file stays listed and fixable.
*/
function validateSequenceFile(sequence: SavedSequence): SavedSequence {
  return savedSequenceSchema.parse(sequence)
}

/**
Reject a blank name, no steps or a blank step at every ingress, including
hand-edited files. D121: any name/step count stands — only the blank
refuses.
*/
export function validateSequenceInput(input: SavedSequence): SavedSequence {
  const checked = parseSequenceFile(serialiseSequenceFile(input))
  if (checked.name.trim() === '') {
    throw new Error(UI_TEXT.promptTitleRequired)
  }
  if (checked.steps.length === 0) {
    throw new Error(UI_TEXT.sequenceNeedsStep)
  }
  if (checked.steps.some((step) => step.trim() === '')) {
    throw new Error(UI_TEXT.sequenceStepRequired)
  }
  return checked
}
