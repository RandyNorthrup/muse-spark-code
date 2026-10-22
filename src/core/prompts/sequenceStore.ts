// M88, lane A: the prompt sequence file store. One JSON file per sequence
// in its scope's `sequences/` subfolder (so the prompt scan keeps skipping
// the folder); the library engine's shape — segmented folders with link
// rejection, a damaged scope in fixed words, one write lock, atomic rename.
import { rm } from 'node:fs/promises'
import {
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
import { LibraryFiles } from './libraryFiles'

/** Portable disk store beside the prompt store; no VS Code state, no sync. */
export class SequenceStore {
  private readonly files: LibraryFiles<SavedSequence>

  public constructor(dataFolder: string, workspaceRoot?: string) {
    this.files = new LibraryFiles(dataFolder, workspaceRoot, {
      userSegments: [PROMPT_USER_FOLDER, SEQUENCE_SUBFOLDER],
      workspaceSegments: [...PROMPT_WORKSPACE_FOLDER.split('/'), SEQUENCE_SUBFOLDER],
      fileSuffix: SEQUENCE_FILE_SUFFIX,
      read: (text) => savedSequenceSchema.parse(parseSequenceFile(text)),
      serialise: (sequence) => serialiseSequenceFile(sequence),
      scopeOf: (sequence) => sequence.scope,
      idOf: (sequence) => sequence.id,
    })
  }

  /** False without a folder: the workspace scope is then unavailable. */
  public get hasWorkspace(): boolean {
    return this.files.hasWorkspace
  }

  /**
  Save a new or edited sequence; a blank name, no steps or a blank step
  refuses in words (D121: only the blank refuses). Answers the saved row,
  stamped on the host clock, keeping a known row's creation time.
  */
  public async save(input: SavedSequence): Promise<SavedSequence> {
    const sequence = validateSequenceInput(input)
    return await this.files.mutate(sequence.scope, async (directory) => {
      const rows = await this.files.scan(sequence.scope)
      const existing = rows.find((row) => row.value.id === sequence.id)
      const now = new Date().toISOString()
      const next: SavedSequence = savedSequenceSchema.parse({
        ...sequence,
        createdAt: existing?.value.createdAt ?? now,
        updatedAt: now,
      })
      if (
        existing !== undefined &&
        serialiseSequenceFile({ ...next, updatedAt: existing.value.updatedAt }) ===
          serialiseSequenceFile(existing.value)
      ) {
        return existing.value
      }
      const target = this.files.fileFor(directory, sequence.id, existing?.file)
      await this.files.commit(
        directory,
        target,
        serialiseSequenceFile(next),
        existing === undefined
          ? undefined
          : { file: target, serialised: serialiseSequenceFile(existing.value) },
      )
      return next
    })
  }

  /** Remove one sequence; an id that is already gone resolves. */
  public async remove(scope: SequenceScope, id: string): Promise<void> {
    await this.files.mutate(scope, async () => {
      const rows = await this.files.scan(scope)
      const row = rows.find((entry) => entry.value.id === id)
      if (row !== undefined) {
        await rm(row.file)
      }
    })
  }

  /** User first, then workspace, in library order; a damaged scope refuses. */
  public async library(): Promise<SavedSequence[]> {
    try {
      const user = await this.files.scan('user')
      const workspace = this.files.hasWorkspace ? await this.files.scan('workspace') : []
      return mergeSequenceScopes(
        user.map((row) => row.value),
        workspace.map((row) => row.value),
      )
    } catch (error) {
      throw new Error(UI_TEXT.promptStoreDamaged, { cause: error })
    }
  }
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
