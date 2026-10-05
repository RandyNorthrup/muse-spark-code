// M91 lane X: Cline v1 script discovery. Cline names one script per event;
// the filename IS the event. Platform rules (DOC:164-174,497-506, and
// hooks-parity/raw-copilot-cline.md:24-25): Windows runs <HookName>.ps1
// only; Unix runs the extensionless <HookName> only, and it must be
// executable. Anything else is ignored, never converted (DOC:169-174:
// "Wrong-platform naming is ignored by hook discovery").
// Scopes: global ~/Documents/Cline/Hooks and project .clinerules/hooks
// (DOC:90-96). Both run when present, global first (DOC:96).
import { readdirSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { accessSync } from 'node:fs'
import path from 'node:path'
import { CLINE_CONTRACT } from './contracts/cline'

/** The v1 script names: the 8 documented hooks plus Notification, which is in
 * VALID_HOOK_TYPES but in no docs page (raw-copilot-cline.md:24). */
export const CLINE_HOOK_NAMES = [
  'TaskStart',
  'TaskResume',
  'TaskCancel',
  'TaskComplete',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'PreCompact',
  'Notification',
] as const
export type ClineHookName = (typeof CLINE_HOOK_NAMES)[number]

export interface ClineHookRef {
  /** The Cline script name, exactly as discovered. */
  readonly sourceEvent: ClineHookName
  /** The Muse event the cline contract maps it to. */
  readonly museEvent: string
  readonly path: string
  readonly scope: 'user' | 'project'
}

export interface ClineDiscoverOptions {
  readonly platform?: NodeJS.Platform | undefined
  /** Home dir for the global scope (default: the process home). */
  readonly homeDir?: string | undefined
  /** Workspace root for the project scope (omit to skip it). */
  readonly workspaceRoot?: string | undefined
  /** Injectable for tests; defaults read the real filesystem. */
  readonly readdir?: ((dir: string) => readonly string[]) | undefined
  readonly isExecutable?: ((file: string) => boolean) | undefined
}

function defaultReaddir(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function canExecute(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The filename Cline accepts for this hook on this platform
 * (DOC:169-174), or undefined when the platform has no v1 form.
 */
export function clineFileName(platform: NodeJS.Platform, name: ClineHookName): string | undefined {
  if (platform === 'win32') return `${name}.ps1`
  return platform === 'linux' || platform === 'darwin' ? name : undefined
}

/** True when this directory entry is a runnable v1 script for the hook. */
export function isClineScript(
  platform: NodeJS.Platform,
  name: ClineHookName,
  file: string,
  isExecutable: boolean,
): boolean {
  return platform === 'win32'
    ? file === `${name}.ps1`
    : (platform === 'linux' || platform === 'darwin') && file === name && isExecutable
}

function museEventOf(sourceEvent: ClineHookName): string {
  const row = CLINE_CONTRACT.rows.find((candidate) => candidate.vendor === sourceEvent)
  // Every discovered name has a contract row by construction above.
  if (row === undefined) throw new Error(`cline: ${sourceEvent} has no contract row`)
  return row.muse
}

function scan(
  dir: string,
  scope: ClineHookRef['scope'],
  platform: NodeJS.Platform,
  readdir: (dir: string) => readonly string[],
  isExecutable: (file: string) => boolean,
): readonly ClineHookRef[] {
  let entries: readonly string[]
  try {
    entries = readdir(dir)
  } catch {
    return []
  }
  const found: ClineHookRef[] = []
  for (const name of CLINE_HOOK_NAMES) {
    const file = clineFileName(platform, name)
    if (file === undefined || !entries.includes(file)) continue
    const full = path.join(dir, file)
    let isRunnable: boolean
    try {
      isRunnable = isExecutable(full)
    } catch {
      continue
    }
    if (!isClineScript(platform, name, file, isRunnable)) continue
    found.push({ sourceEvent: name, museEvent: museEventOf(name), path: full, scope })
  }
  return found
}

/**
 * The runnable v1 scripts: global scope first, then project
 * (DOC:96: "Global hooks execute first, then workspace hooks"). A directory
 * that cannot be read contributes nothing; a non-v1 filename (an SDK hook,
 * a backup, a wrong-platform name) is ignored, never converted.
 */
export function discoverClineHooks(options: ClineDiscoverOptions = {}): readonly ClineHookRef[] {
  const platform = options.platform ?? process.platform
  const readdir = options.readdir ?? defaultReaddir
  const isExecutable = options.isExecutable ?? canExecute
  const home =
    options.homeDir ??
    (platform === 'win32' ? process.env['USERPROFILE'] : process.env['HOME']) ??
    ''
  const refs: ClineHookRef[] = []
  if (home !== '') {
    const global = path.join(home, 'Documents', 'Cline', 'Hooks')
    refs.push(...scan(global, 'user', platform, readdir, isExecutable))
  }
  if (options.workspaceRoot !== undefined && options.workspaceRoot !== '') {
    const project = path.join(options.workspaceRoot, '.clinerules', 'hooks')
    refs.push(...scan(project, 'project', platform, readdir, isExecutable))
  }
  return refs
}
