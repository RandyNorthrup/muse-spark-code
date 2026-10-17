import { stat } from 'node:fs/promises'
import path from 'node:path'
import { projectMemoryKey } from '../../core/memory/memoryLocation'
import { CHECKPOINTS_DIR, UI_TEXT } from '../../shared/constants'
import { systemPath } from '../backend/memoryIo'

export interface CheckpointLocation {
  readonly canonicalRoot: string
  readonly storageDir: string
}

/** One physical root, across VS Code workspace identities in this global storage. */
export async function checkpointLocation(
  workspaceRoot: string | undefined,
  globalStorageDir: string,
  platform: NodeJS.Platform,
): Promise<CheckpointLocation | undefined> {
  if (workspaceRoot === undefined) {
    return undefined
  }
  const canonicalRoot = await systemPath(workspaceRoot)
  const folder = await stat(canonicalRoot)
  if (!folder.isDirectory()) {
    throw new Error(UI_TEXT.checkpointFailed)
  }
  const normalized =
    platform === 'win32'
      ? path.win32.normalize(canonicalRoot).toLowerCase()
      : path.posix.normalize(canonicalRoot)
  return {
    canonicalRoot,
    storageDir: path.join(
      globalStorageDir,
      CHECKPOINTS_DIR,
      projectMemoryKey(normalized, platform),
    ),
  }
}
