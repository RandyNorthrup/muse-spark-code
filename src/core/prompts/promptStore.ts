import { rm } from 'node:fs/promises'
import { PROMPT_USER_FOLDER, PROMPT_WORKSPACE_FOLDER, UI_TEXT } from '../../shared/constants'
import {
  mergePromptScopes,
  parsePromptFile,
  serialisePromptFile,
  type PromptStoragePort,
  type SavedPrompt,
} from '../../shared/prompts'
import { LibraryFiles } from './libraryFiles'

export { readPromptFile } from './promptFile'

/**
Reject a blank title at every ingress, including imported and synced
files. D121: any title/body length stands — the removed 80/10000 ceilings
were invented. NOLIMITS1FIX: the prompt file bound is gone too, so only
a blank title refuses.
*/
export function validatePrompt(prompt: SavedPrompt): SavedPrompt {
  const checked = parsePromptFile(serialisePromptFile(prompt))
  if (checked.title.trim() === '') {
    throw new Error(UI_TEXT.promptTitleRequired)
  }
  return checked
}

/**
The library moved under a writer that named its expected generation: the
write did not land, and the writer is stale (Codex on PR #227).
*/
export class PromptLibraryStaleError extends Error {
  public constructor() {
    super('prompt library changed under the writer')
    this.name = 'PromptLibraryStaleError'
  }
}

/** Portable disk store shared by VS Code, ACP and native hosts; no VS Code state. */
export class PromptStore implements PromptStoragePort {
  private readonly files: LibraryFiles<SavedPrompt>

  public constructor(dataFolder: string, workspaceRoot?: string) {
    this.files = new LibraryFiles(dataFolder, workspaceRoot, {
      userSegments: [PROMPT_USER_FOLDER],
      workspaceSegments: PROMPT_WORKSPACE_FOLDER.split('/'),
      fileSuffix: '.md',
      read: (text) => validatePrompt(parsePromptFile(text)),
      serialise: (prompt) => serialisePromptFile(prompt),
      scopeOf: (prompt) => prompt.scope,
      idOf: (prompt) => prompt.id,
    })
  }

  public async list(scope: SavedPrompt['scope']): Promise<readonly SavedPrompt[]> {
    try {
      const rows = await this.files.scan(scope)
      return rows.map((row) => row.value)
    } catch (error) {
      // An unreadable scope reads damaged in fixed words, carrying the
      // failure that proved it; the library marks the scope for the person.
      throw new Error(UI_TEXT.promptStoreDamaged, { cause: error })
    }
  }

  /**
  Writes the prompt, holding the scope's write lock. With
  `expectedLibraryGeneration` the library's generation (newest revision,
  0 when empty) is recomputed under that same lock first, and a mismatch
  throws `PromptLibraryStaleError` instead of landing a save approved
  from a stale view (Codex on PR #227).
  */
  public async write(
    input: SavedPrompt,
    shouldKeepNewer = false,
    expectedLibraryGeneration?: number,
  ): Promise<void> {
    const prompt = validatePrompt(input)
    await this.files.mutate(prompt.scope, async (directory) => {
      const rows = await this.files.scan(prompt.scope)
      if (expectedLibraryGeneration !== undefined) {
        // The same generation the connector's `libraryGeneration` reads
        // (the newest revision, 0 when empty): recomputed under this lock,
        // so a save approved from a stale view cannot land after a newer
        // one changed the library.
        let newest = 0
        for (const row of rows) newest = Math.max(newest, Date.parse(row.value.updatedAt))
        if (newest !== expectedLibraryGeneration) throw new PromptLibraryStaleError()
      }
      const existing = rows.find((row) => row.value.id === prompt.id)
      // Trust cannot be upgraded by an edit or synchronization.
      // Sync's snapshot may be stale: choose the revision again under this same lock.
      const winner =
        shouldKeepNewer &&
        existing !== undefined &&
        Date.parse(existing.value.updatedAt) >= Date.parse(prompt.updatedAt)
          ? existing.value
          : prompt
      const next = { ...winner, untrusted: prompt.untrusted || existing?.value.untrusted === true }
      if (
        existing !== undefined &&
        serialisePromptFile(next) === serialisePromptFile(existing.value)
      )
        return
      const target = this.files.fileFor(directory, prompt.id, existing?.file)
      await this.files.commit(
        directory,
        target,
        serialisePromptFile(next),
        existing === undefined
          ? undefined
          : { file: target, serialised: serialisePromptFile(existing.value) },
      )
    })
  }

  public async remove(scope: SavedPrompt['scope'], id: string): Promise<void> {
    await this.files.mutate(scope, async () => {
      const rows = await this.files.scan(scope)
      const row = rows.find((entry) => entry.value.id === id)
      if (row === undefined) throw new Error(UI_TEXT.promptFileInvalid)
      await rm(row.file)
    })
  }

  public async library(): Promise<SavedPrompt[]> {
    return mergePromptScopes(
      await this.list('user'),
      this.files.hasWorkspace ? await this.list('workspace') : [],
    )
  }
}
