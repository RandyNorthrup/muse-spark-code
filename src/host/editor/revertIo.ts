// What a Revert publishes (M5's edit review, M70's review pane), in the
// user's name: each change only while the file is still what the Revert read
// under its checkpoint admission, at the checked canonical path with no link
// or junction on the way, through the guarded conditional writes the model's
// tools use (`fsAtomic`, PLAN.md D27). A save or a swap since the read refuses
// it instead of being overwritten. Once a change lands the file is the user's,
// as their own save is (M72); one refused leaves it to whoever changed it.

import { lstat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { ConditionalWrite, ToolIo } from '../../core/backends/modelapi/tools'
import { isMissingPath } from '../canonicalPath'
import type { CheckpointPort } from '../checkpoints/checkpointHost'
import { deleteFileIfUnchanged, writeFileIfUnchanged } from '../fsAtomic'
import type { RevertIo } from './editReview'

export interface RevertIoDeps {
  /**
   * The tools' own file access, without their checkpoint copies: a Revert is
   * the user's edit, not the turn's.
   */
  readonly io: Pick<ToolIo, 'writeFileIfUnchanged' | 'hasUnsavedChanges'>
  readonly checkpoints: Pick<CheckpointPort, 'noteUserSave'>
  readonly platform: NodeJS.Platform
  /** Moves a file to the trash (VS Code's `workspace.fs.delete` with `useTrash`). */
  readonly trash: (absolutePath: string) => Promise<void>
}

/** Whether nothing (a file, a folder, a link) is at the path. */
async function isAbsent(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath)
    return false
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return true
    }
    throw error
  }
}

export function createRevertIo(deps: RevertIoDeps): RevertIo {
  /** The writes’ last word: no editor holds unsaved text at any of the paths. */
  const editorsSaved = (unsavedAt: readonly string[]) => () =>
    unsavedAt.every((open) => !deps.io.hasUnsavedChanges(open))
  const owned = (absolutePath: string, outcome: ConditionalWrite): ConditionalWrite => {
    if (outcome === 'written') {
      deps.checkpoints.noteUserSave(absolutePath)
    }
    return outcome
  }
  return {
    writeFileIfUnchanged: async (absolutePath, expectedFingerprint, content, options) =>
      owned(
        absolutePath,
        await deps.io.writeFileIfUnchanged(absolutePath, expectedFingerprint, content, options),
      ),
    trashFileIfUnchanged: async (absolutePath, expectedFingerprint, options) =>
      owned(
        absolutePath,
        await deleteFileIfUnchanged(absolutePath, expectedFingerprint, {
          expectedCanonicalPath: options.expectedCanonicalPath,
          platform: deps.platform,
          assertCanWrite: options.assertCanWrite,
          isReplaceable: editorsSaved(options.unsavedAt),
          remove: deps.trash,
        }),
      ),
    // Absent when read: written only while nothing is there, as a restore
    // brings a deleted file back.
    createFileIfAbsent: async (absolutePath, content, options) =>
      owned(
        absolutePath,
        await writeFileIfUnchanged(
          absolutePath,
          async () => await isAbsent(absolutePath),
          content,
          {
            sleep: delay,
            expectedCanonicalPath: options.expectedCanonicalPath,
            platform: deps.platform,
            assertCanWrite: options.assertCanWrite,
            isReplaceable: editorsSaved(options.unsavedAt),
          },
        ),
      ),
  }
}
