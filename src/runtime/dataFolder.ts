// Where the ACP agent keeps what the panel keeps in VS Code's storage
// (PLAN.md D62): the user's data folder per platform, then one folder per
// workspace, named by a hash of its path so no path lands in a file name.

import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  ACP_DATA_FOLDER,
  ACP_PAID_GRANTS_FILE,
  ACP_SESSIONS_SUBFOLDER,
  ACP_WORKSPACE_HASH_CHARS,
  MODEL_API_SESSIONS_DIR,
} from '../shared/constants'

export interface DataFolderInput {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
}

function pathModuleFor(input: DataFolderInput): path.PlatformPath {
  return input.platform === 'win32' ? path.win32 : path.posix
}

/** `%LOCALAPPDATA%\Muse Spark Code`, `~/Library/Application Support/Muse Spark Code`, `$XDG_DATA_HOME/muse-spark-code`. */
export function agentDataFolder(input: DataFolderInput): string {
  const { platform, env, homeDir } = input
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? path.win32.join(homeDir, 'AppData', 'Local')
    return path.win32.join(localAppData, ACP_DATA_FOLDER.win32)
  }
  if (platform === 'darwin') {
    return path.posix.join(homeDir, 'Library', 'Application Support', ACP_DATA_FOLDER.darwin)
  }
  const dataHome = env['XDG_DATA_HOME'] ?? path.posix.join(homeDir, '.local', 'share')
  return path.posix.join(dataHome, ACP_DATA_FOLDER.other)
}

/** A workspace's name in the data folder: the start of its path's SHA-256. */
export function workspaceKey(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, ACP_WORKSPACE_HASH_CHARS)
}

/** The Model API sessions of one workspace. */
export function workspaceSessionsFolder(input: DataFolderInput, workspaceRoot: string): string {
  return pathModuleFor(input).join(
    agentDataFolder(input),
    ACP_SESSIONS_SUBFOLDER,
    workspaceKey(workspaceRoot),
    MODEL_API_SESSIONS_DIR,
  )
}

/** Every workspace's "Allow always" for paid uses (M58, PLAN.md D48). */
export function paidGrantsFile(input: DataFolderInput): string {
  return pathModuleFor(input).join(
    agentDataFolder(input),
    ACP_SESSIONS_SUBFOLDER,
    ACP_PAID_GRANTS_FILE,
  )
}
