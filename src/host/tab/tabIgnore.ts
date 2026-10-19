import path from 'node:path'
import { failureForLog } from '../../core/backends/musecode/logText'
import { isGitExitError } from '../git'
import type { Logger } from '../logger'

// --- git's answer, cached (Acceptance 4) ---
//
// `git check-ignore` per path: exit 0 is ignored, exit 1 is allowed, any
// other failure leaves git unable to answer. A workspace root's
// `.cursorignore` and `.continueignore` are always checked too, through the
// same call with `-c core.excludesFile=<file>` and `--no-index`, so a
// tracked file is caught even where git's own answer is "not ignored"
// (RVM94HU 10). Where git cannot answer and an ignore file is present in
// the file's folder or any folder above it up to the root, nothing there is
// read (RVM94HU 11). The cache drops when an ignore file changes, and an
// answer begun before that change is asked again rather than cached
// (RVM94HU 1).

const IGNORE_FILENAMES = ['.gitignore', '.cursorignore', '.continueignore'] as const
const CURSOR_IGNORE_FILENAMES = ['.cursorignore', '.continueignore'] as const
// A bound, not a tuning: the map holds one boolean per path asked about.
const IGNORE_CACHE_MAX_ENTRIES = 512
// An answer outdated this many times in a row while it was asked refuses
// the read: the ignore files keep changing under it.
const IGNORE_STALE_RETRIES = 3

export interface TabIgnoreDeps {
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Whether an ignore file exists at an absolute path. */
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Absolute workspace folder paths holding the file, innermost first. */
  readonly workspaceRoots: (absolutePath: string) => readonly string[]
  /** Clears the cache when an ignore file changes. */
  readonly onIgnoreFilesChanged: (clear: () => void) => { dispose(): void }
  /** Traces the blind rule's cause; git stays quiet on the typing path. */
  readonly log: Logger
}

async function checkIgnore(
  runGit: TabIgnoreDeps['runGit'],
  log: Logger,
  args: readonly string[],
  cwd: string,
): Promise<boolean | undefined> {
  try {
    await runGit(args, cwd)
    return true
  } catch (error: unknown) {
    // Exit 1: git answered, and the path is not ignored.
    if (isGitExitError(error) && error.exitCode === 1) {
      return false
    }
    if (!isGitExitError(error)) {
      // git never answered (no binary, a spawn failure): name it at trace.
      log.trace(`Tab ignore check without git: ${failureForLog(error)}`)
    }
    // git ran but cannot answer (no repository, a bad config): blind.
    return undefined
  }
}

/** The folders from the file's own up to the root, workspace-relative (`''` is the root). */
function foldersUpToRoot(relativePath: string): string[] {
  const folders: string[] = []
  let folder = path.posix.dirname(relativePath)
  while (folder !== '.' && folder !== '/' && folder !== '') {
    folders.push(folder)
    folder = path.posix.dirname(folder)
  }
  folders.push('')
  return folders
}

/** git's ignore answer per path, with the fail-closed blind rule. */
export class TabIgnoreCache {
  private readonly verdicts = new Map<string, boolean>()
  private readonly watcher: { dispose(): void }
  /** Moves whenever an ignore file changes: an answer begun before is stale. */
  private generation = 0

  public constructor(private readonly deps: TabIgnoreDeps) {
    this.watcher = deps.onIgnoreFilesChanged(() => {
      this.generation += 1
      this.verdicts.clear()
    })
  }

  private async askGit(rootAbs: string, relativePath: string): Promise<boolean> {
    const ignored = await checkIgnore(
      this.deps.runGit,
      this.deps.log,
      ['check-ignore', '-q', '--', relativePath],
      rootAbs,
    )
    if (ignored === true) {
      return true
    }
    // Cursor's and Continue's files apply whatever git's own answer was.
    for (const name of CURSOR_IGNORE_FILENAMES) {
      const file = path.join(rootAbs, name)
      if (!this.deps.ignoreFileExists(file)) {
        continue
      }
      const matched = await checkIgnore(
        this.deps.runGit,
        this.deps.log,
        ['-c', `core.excludesFile=${file}`, 'check-ignore', '--no-index', '-q', '--', relativePath],
        rootAbs,
      )
      // Ignored, or git cannot answer while the file is present: not read.
      if (matched !== false) {
        return true
      }
    }
    if (ignored === false) {
      return false
    }
    // git cannot answer the plain check: refuse where an ignore file sits in
    // the file's folder or any folder above it, since only there could git
    // have had something to say.
    return foldersUpToRoot(relativePath).some((folder) =>
      IGNORE_FILENAMES.some((name) =>
        this.deps.ignoreFileExists(path.join(rootAbs, ...folder.split('/'), name)),
      ),
    )
  }

  /** The ignore files' generation: a check made under an older one is asked again. */
  public get currentGeneration(): number {
    return this.generation
  }

  /** Whether git ignores the path, or git is blind where an ignore file sits. */
  public async isIgnored(rootAbs: string, relativePath: string): Promise<boolean> {
    const key = `${rootAbs} ${relativePath}`
    for (let attempt = 0; attempt < IGNORE_STALE_RETRIES; attempt += 1) {
      const cached = this.verdicts.get(key)
      if (cached !== undefined) {
        return cached
      }
      const asked = this.generation
      const isGitIgnored = await this.askGit(rootAbs, relativePath)
      if (asked !== this.generation) {
        // An ignore file changed while git answered: ask again.
        continue
      }
      if (this.verdicts.size >= IGNORE_CACHE_MAX_ENTRIES) {
        this.verdicts.clear()
      }
      this.verdicts.set(key, isGitIgnored)
      return isGitIgnored
    }
    return true
  }

  public dispose(): void {
    this.watcher.dispose()
  }
}
