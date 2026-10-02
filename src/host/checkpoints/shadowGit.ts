// The shadow repository behind turn checkpoints (M72, PLAN.md D51): a bare
// git repository in the extension's workspace storage whose work tree is
// the workspace. Its objects, refs and index are the extension's own; the
// workspace's `.git` is never written, so nothing a checkpoint copies (an
// untracked file, an ignored `.env`) can reach a push.
//
// Every command runs isolated from the user's git set-up:
// - an environment without the host's `GIT_*` variables, with the system
//   config off, an empty global config and HOME, and no system attributes;
// - hooks pointed at an empty folder, fsmonitor and the untracked cache off;
// - `info/attributes` (which outranks every `.gitattributes`) unsets text,
//   eol, filter, ident and working-tree-encoding, so no smudge or clean
//   filter runs and every file is copied byte for byte.
// The workspace's ignore rules still apply: its `.gitignore` files, its
// `info/exclude` (copied in) and the user's global excludes file, both
// looked up again before every capture.
// The storage folder is the user's alone (0700), since it holds copies of
// untracked and ignored files.
//
// Long paths (PLAN.md M72, "Long storage paths"). `core.longpaths` lets git
// open deep files, but only after it has read its configuration, so the
// repository's own path must fit git's PATH_MAX as written: `GIT_DIR` may be
// at most PATH_MAX - 40 characters as an absolute path, and `<git dir>/objects`
// must fit even when it is given relative to the working directory. So the
// repository is named relative to its own folder once the absolute spelling
// would be refused, and a path beyond even that is refused before any file is
// made, in words the user can act on. Both are decided by comparing lengths
// with git's PATH_MAX (the platform supplies only that number). The
// repository is made under a short name beside its
// final place and published by one rename, so the name git is given is never
// longer than the repository it makes.
//
// Two windows on one folder share the repository with no lock: git writes
// objects and refs atomically, each window has its own index file (seeded
// from the newest one there, as a stat cache), and the files written at set
// up are replaced whole. `git prune` spares objects younger than
// CHECKPOINT_PRUNE_GRACE_MS, so an object another window has just written
// but not yet named by a ref is never deleted.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { gitBlobOid } from '../../core/checkpoints/gitListings'
import {
  CHECKPOINT_GIT_TIMEOUT_MS,
  CHECKPOINT_INITIALIZER_DIGITS,
  CHECKPOINT_INITIALIZER_PREFIX,
  CHECKPOINT_REMOVE_RETRIES,
  CHECKPOINT_REMOVE_RETRY_MS,
  CHECKPOINT_STORAGE_MODE,
  GIT_CHANGE_DIRECTORY_MARGIN,
  GIT_DIR_CONTENTS_MARGIN,
  GIT_DIR_ENVIRONMENT_MARGIN,
  GIT_PATH_MAX_DARWIN,
  GIT_PATH_MAX_DEFAULT,
  GIT_PATH_MAX_WINDOWS,
} from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import type { GitProcess } from '../git'

const SHADOW_DIR = 'shadow.git'

/**
 * Whether a path runs through a checkpoint repository folder, of any install or
 * namespace: a tool never writes into one, since a filter planted in its config
 * would run as the user at a turn's end (Codex and Muse reviews of PR #55). The
 * name is unusual enough that a real project folder of that name is not a concern;
 * case is folded, as Windows and macOS folders fold it.
 */
export function isInShadowRepository(absolutePath: string): boolean {
  return absolutePath.split(/[\\/]/u).some((segment) => segment.toLowerCase() === SHADOW_DIR)
}
const HOME_DIR = 'home'
const HOOKS_DIR = 'hooks'
const EMPTY_CONFIG = 'empty.gitconfig'
const EMPTY_EXCLUDES = 'empty.gitignore'
// Each window's own index: `work-<instance>.index`.
const WORK_INDEX_PREFIX = 'work'
const INDEX_SUFFIX = '.index'
const MILLISECONDS_PER_SECOND = 1000
// Never created: `git status` over it sees every file as untracked.
const NO_INDEX = path.join('listing', 'none.index')
const ATTRIBUTES = path.join('info', 'attributes')
const EXCLUDE = path.join('info', 'exclude')
const LOCK_SUFFIX = '.lock'
const REFS_DIR = 'refs'
// The shadow repository's own lock files besides its refs' (git's names).
const SHADOW_LOCKS = ['packed-refs.lock', 'HEAD.lock', 'config.lock', 'shallow.lock'] as const
// Unsets every attribute that converts content between work tree and object.
const NO_CONVERSION = '* -text -eol -filter -ident -working-tree-encoding -diff -merge\n'
const GIT_VARIABLE_PREFIX = 'git_'
const HOME_VARIABLES = ['HOME', 'XDG_CONFIG_HOME'] as const

/** Which index a command reads and writes. */
export type ShadowIndex = 'work' | 'none'

export interface ShadowLayout {
  readonly storageDir: string
  /** The work tree: the repository's top when the workspace is in one, else the workspace. */
  readonly top: string
  readonly platform: NodeJS.Platform
  /** This window's store instance: its own index file. */
  readonly instance: string
  /** The longest path git takes here; the platform's own unless a test lowers it. */
  readonly gitPathMax?: number | undefined
  /** The folder holding every window's checkpoint storage (this one's own folder by default). */
  readonly storageRoot?: string | undefined
}

/**
 * git's PATH_MAX on a platform, terminator included. Only Windows is ever
 * near it; a test lowers it to reach the same decisions with short paths.
 */
export function gitPathMax(platform: NodeJS.Platform): number {
  if (platform === 'win32') {
    return GIT_PATH_MAX_WINDOWS
  }
  return platform === 'darwin' ? GIT_PATH_MAX_DARWIN : GIT_PATH_MAX_DEFAULT
}

/** A path git cannot use, named by which one; nothing was made or run. */
export class ShadowPathTooLongError extends Error {
  public constructor(
    public readonly which: 'storage' | 'workspace',
    length: number,
    limit: number,
  ) {
    super(
      `the ${which} path is ${String(length)} characters long and git takes at most ${String(limit)}`,
    )
    this.name = 'ShadowPathTooLongError'
  }
}

/**
 * The checkpoint storage and the workspace hold one another, so the model's file
 * tools could rewrite the repository's own configuration (a clean filter runs as
 * the user at the turn's end). Nothing was made or run.
 */
export class ShadowStorageInWorkspaceError extends Error {
  public constructor() {
    super('the checkpoint storage and the workspace overlap')
    this.name = 'ShadowStorageInWorkspaceError'
  }
}

/** Whether `candidate` is `folder` or below it, by path segment and the platform's own case rules. */
export function isWithinFolder(candidate: string, folder: string): boolean {
  const relative = path.relative(folder, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

/** Any checkpoint storage inside the workspace, or the workspace inside this storage. */
function isTangled(storageRoot: string, storage: string, workspace: string): boolean {
  return (
    isWithinFolder(storageRoot, workspace) ||
    isWithinFolder(storage, workspace) ||
    isWithinFolder(workspace, storage)
  )
}

/** The folder a window's initializer is made in: a short name, unique to the window. */
function initializerName(instance: string): string {
  const digest = createHash('sha256').update(instance).digest('hex')
  return `${CHECKPOINT_INITIALIZER_PREFIX}${digest.slice(0, CHECKPOINT_INITIALIZER_DIGITS)}`
}

/** Removes an initializer folder and what is in it; no folder is no error. */
function removeInitializer(folder: string): Promise<void> {
  return rm(folder, {
    recursive: true,
    force: true,
    maxRetries: CHECKPOINT_REMOVE_RETRIES,
    retryDelay: CHECKPOINT_REMOVE_RETRY_MS,
  })
}

/** Whether a name in the storage folder is some window's initializer. */
function isInitializerName(name: string): boolean {
  const digits = name.slice(CHECKPOINT_INITIALIZER_PREFIX.length)
  return (
    name.startsWith(CHECKPOINT_INITIALIZER_PREFIX) &&
    digits.length === CHECKPOINT_INITIALIZER_DIGITS &&
    /^[0-9a-f]+$/u.test(digits)
  )
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** The index file name of a window's store instance. */
export function indexFileName(instance: string): string {
  return `${WORK_INDEX_PREFIX}-${instance}${INDEX_SUFFIX}`
}

/** The instance an index file belongs to; undefined for another file. */
export function indexFileInstance(name: string): string | undefined {
  const prefix = `${WORK_INDEX_PREFIX}-`
  return name.startsWith(prefix) && name.endsWith(INDEX_SUFFIX)
    ? name.slice(prefix.length, -INDEX_SUFFIX.length)
    : undefined
}

export interface ShadowGitDeps {
  readonly git: GitProcess
  /** The extension host's environment: PATH and the like pass, `GIT_*` does not. */
  readonly env: NodeJS.ProcessEnv
  /** Aborted when the window closes: every git still running is ended. */
  readonly signal: AbortSignal
}

export interface ShadowCommand {
  readonly index?: ShadowIndex
  readonly input?: string | Uint8Array
  /** `GIT_LITERAL_PATHSPECS`: off for the commands that refuse it (`check-ignore`). */
  readonly literalPathspecs?: boolean
  /** Record finalization after a stop uses a separate signal; file work keeps the window's. */
  readonly signal?: AbortSignal
}

export class ShadowGit {
  private readonly shadowDir: string
  private readonly homeDir: string
  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly initializer: string
  /** The longest repository path git opens, and the longest it accepts written absolute. */
  private readonly repositoryMax: number
  private readonly absoluteMax: number
  /** The longest folder git changes into: the work tree, and the repository it makes. */
  private readonly directoryMax: number
  /** Whether the repository is named relative to its folder, which git then starts in. */
  private readonly isRelative: boolean
  private excludesFile: string

  public constructor(
    private readonly layout: ShadowLayout,
    private readonly deps: ShadowGitDeps,
  ) {
    const pathMax = layout.gitPathMax ?? gitPathMax(layout.platform)
    this.repositoryMax = pathMax - GIT_DIR_CONTENTS_MARGIN
    this.absoluteMax = pathMax - GIT_DIR_ENVIRONMENT_MARGIN
    this.directoryMax = pathMax - GIT_CHANGE_DIRECTORY_MARGIN
    this.shadowDir = path.join(layout.storageDir, SHADOW_DIR)
    this.isRelative = this.shadowDir.length > this.absoluteMax
    this.initializer = initializerName(layout.instance)
    this.homeDir = path.join(layout.storageDir, HOME_DIR)
    this.excludesFile = path.join(layout.storageDir, EMPTY_EXCLUDES)
    const env: NodeJS.ProcessEnv = {}
    const inherited = Object.entries(withoutGitVariables(deps.env))
    for (const [key, value] of inherited) {
      if (HOME_VARIABLES.every((name) => name.toLowerCase() !== key.toLowerCase())) {
        env[key] = value
      }
    }
    this.baseEnv = {
      ...env,
      HOME: this.homeDir,
      XDG_CONFIG_HOME: this.homeDir,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(layout.storageDir, EMPTY_CONFIG),
      GIT_ATTR_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    }
  }

  /**
   * This window's index, when it has none yet, starts as a copy of the
   * newest index there (a stat cache, so the first capture does not hash
   * the whole workspace again). git replaces an index whole, so the copy is
   * one version or another, never half of one.
   */
  private async seedIndex(): Promise<void> {
    const own = this.indexPath('work')
    if (await isPresent(own)) {
      return
    }
    const names = await readdir(this.layout.storageDir)
    const candidates = names.filter(
      (name) => name.startsWith(WORK_INDEX_PREFIX) && name.endsWith(INDEX_SUFFIX),
    )
    let newest: { readonly file: string; readonly at: number } | undefined
    for (const name of candidates) {
      const file = path.join(this.layout.storageDir, name)
      const at = await modifiedAt(file)
      if (at !== undefined && (newest === undefined || at > newest.at)) {
        newest = { file, at }
      }
    }
    if (newest === undefined) {
      return
    }
    try {
      await copyFile(newest.file, own)
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw error
      }
    }
  }

  /**
   * Makes the repository in a short, unique folder beside its final place,
   * then publishes it with one rename (atomic, and on the same volume by
   * being in the same folder). Whatever the outcome, this window's own
   * initializer folder is gone afterwards: a failed or cancelled `git init`
   * leaves no half-made repository behind.
   */
  private async initialize(): Promise<void> {
    const { storageDir } = this.layout
    const initializing = path.join(storageDir, this.initializer)
    try {
      await this.deps.git(
        [
          '-c',
          'core.longpaths=true',
          'init',
          '--bare',
          '--quiet',
          '--object-format=sha1',
          `--template=${path.join(storageDir, HOOKS_DIR)}`,
          this.initializer,
        ],
        {
          cwd: storageDir,
          env: this.baseEnv,
          timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
          signal: this.deps.signal,
        },
      )
      try {
        await rename(initializing, this.shadowDir)
      } catch (error: unknown) {
        if (!(await isPresent(path.join(this.shadowDir, 'HEAD')))) {
          throw error
        }
      }
    } finally {
      // The name comes from this window's own id: the folder is this window's.
      await removeInitializer(initializing)
    }
  }

  public get top(): string {
    return this.layout.top
  }

  /** The files a checkpoint holds, other than the shadow repository. */
  public indexPath(index: ShadowIndex): string {
    const name = { work: indexFileName(this.layout.instance), none: NO_INDEX }[index]
    return path.join(this.layout.storageDir, name)
  }

  /** Deletes objects no ref names, sparing any younger than `graceMs` (another window's in flight). */
  public async prune(graceMs: number): Promise<void> {
    const seconds = Math.ceil(graceMs / MILLISECONDS_PER_SECOND)
    await this.run(['prune', `--expire=${String(seconds)}.seconds.ago`])
  }

  /**
   * Creates the shadow repository and its empty surroundings when missing,
   * and brings the workspace's own `info/exclude` and the user's global
   * excludes file in (read, never run).
   */
  public async prepare(
    userExclude: string | undefined,
    globalExcludesFile: string | undefined,
  ): Promise<void> {
    const { storageDir } = this.layout
    await mkdir(storageDir, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    if (this.layout.platform !== 'win32') {
      await chmod(storageDir, CHECKPOINT_STORAGE_MODE)
    }
    await mkdir(path.join(storageDir, HOOKS_DIR), { recursive: true })
    await mkdir(this.homeDir, { recursive: true })
    await mkdir(path.dirname(this.indexPath('none')), { recursive: true })
    await rm(this.indexPath('none'), { force: true })
    await writeFileAtomically(path.join(storageDir, EMPTY_CONFIG), '', { sleep: pause })
    await writeFileAtomically(path.join(storageDir, EMPTY_EXCLUDES), '', { sleep: pause })
    if (!(await isPresent(path.join(this.shadowDir, 'HEAD')))) {
      await this.initialize()
    }
    await mkdir(path.join(this.shadowDir, 'info'), { recursive: true })
    await writeFileAtomically(path.join(this.shadowDir, ATTRIBUTES), NO_CONVERSION, {
      sleep: pause,
    })
    await this.refreshExcludes(userExclude, globalExcludesFile)
    await this.seedIndex()
    // A restore compares files with captures by hashing them here; the
    // repository must name objects as `gitBlobOid` does.
    const probe = await this.text(['hash-object', '--stdin'], { input: '' })
    if (probe !== gitBlobOid(Buffer.alloc(0))) {
      throw new Error('the checkpoint repository does not use SHA-1 object names')
    }
  }

  /**
   * The workspace's `info/exclude` and the user's global excludes file as they
   * are now: the store calls this before every capture, so a rule added or
   * dropped since the repository was opened applies (Codex review of PR #55).
   * The copy is replaced whole, and only when it differs: every window on the
   * folder copies the same file into it.
   */
  public async refreshExcludes(
    userExclude: string | undefined,
    globalExcludesFile: string | undefined,
  ): Promise<void> {
    const copy = path.join(this.shadowDir, EXCLUDE)
    // No `info/exclude` in the workspace is an empty copy: git reads the two alike.
    const wanted = userExclude ?? ''
    if ((await readOptionalText(copy)) !== wanted) {
      await writeFileAtomically(copy, wanted, { sleep: pause })
    }
    this.excludesFile = globalExcludesFile ?? path.join(this.layout.storageDir, EMPTY_EXCLUDES)
  }

  /**
   * Refuses a layout git cannot open, before any file is made or git is
   * run (the store asks first, then prepares). A longer repository path than
   * git's `PATH_MAX` leaves is not reachable by any spelling (measured with
   * git 2.52.0.windows.1), nor is a work tree beyond the folders it can
   * change into.
   */
  public assertFits(): void {
    const repository = this.shadowDir.length
    if (repository > this.repositoryMax) {
      throw new ShadowPathTooLongError('storage', repository, this.repositoryMax)
    }
    const top = this.layout.top.length
    if (top > this.directoryMax) {
      throw new ShadowPathTooLongError('workspace', top, this.directoryMax)
    }
  }

  /**
   * Refuses a workspace that holds the checkpoint storage (or is held by it): the
   * model's file tools could then rewrite `shadow.git/config` or plant a hook,
   * and git would run it as the user. Checked before any file is made, on the
   * paths as written and as resolved: a link or junction on the way to the
   * storage (VS Code's own profile folder, say) can put it inside the workspace.
   */
  public async assertSeparate(): Promise<void> {
    const { storageDir, top } = this.layout
    const root = this.layout.storageRoot ?? storageDir
    const [realRoot, realStorage, realTop] = await Promise.all([
      canonicalPath(root),
      canonicalPath(storageDir),
      canonicalPath(top),
    ])
    if (isTangled(root, storageDir, top) || isTangled(realRoot, realStorage, realTop)) {
      throw new ShadowStorageInWorkspaceError()
    }
  }

  /**
   * Removes the lock files older than `staleMs` that a git ended mid-command
   * left in the shadow repository and beside this window's index (a crash, a
   * window closed), and initializer folders a window that died mid-`init`
   * left. `staleMs` is well over the time any git may run, so no live
   * window's lock or initializer is removed.
   */
  public async clearStaleLocks(now: number, staleMs: number): Promise<void> {
    const names = await readdir(this.layout.storageDir)
    for (const name of names) {
      if (!isInitializerName(name)) {
        continue
      }
      const folder = path.join(this.layout.storageDir, name)
      const since = await modifiedAt(folder)
      if (since !== undefined && now - since >= staleMs) {
        await removeInitializer(folder)
      }
    }
    const refsDir = path.join(this.shadowDir, REFS_DIR)
    const refs = (await isPresent(refsDir)) ? await readdir(refsDir, { recursive: true }) : []
    const candidates = [
      `${this.indexPath('work')}${LOCK_SUFFIX}`,
      ...SHADOW_LOCKS.map((name) => path.join(this.shadowDir, name)),
      ...refs.map((entry) => path.join(refsDir, entry)),
    ]
    for (const lock of candidates) {
      if (!lock.endsWith(LOCK_SUFFIX)) {
        continue
      }
      const since = await modifiedAt(lock)
      if (since !== undefined && now - since >= staleMs) {
        await rm(lock, { force: true })
      }
    }
  }

  /**
   * Runs one git command in the shadow repository over the work tree. A
   * repository path git would refuse as `GIT_DIR` (PATH_MAX - 40 or longer)
   * is named relative to its own folder, which is then the working directory:
   * git changes into the work tree itself, and the index and work tree stay
   * absolute because they are read after that change.
   */
  public async run(args: readonly string[], command: ShadowCommand = {}): Promise<Buffer> {
    this.assertFits()
    const env: NodeJS.ProcessEnv = {
      ...this.baseEnv,
      GIT_DIR: this.isRelative ? SHADOW_DIR : this.shadowDir,
      GIT_WORK_TREE: this.layout.top,
      GIT_INDEX_FILE: this.indexPath(command.index ?? 'work'),
      ...(command.literalPathspecs !== false && { GIT_LITERAL_PATHSPECS: '1' }),
    }
    return await this.deps.git(
      [
        '-c',
        `core.hooksPath=${path.join(this.layout.storageDir, HOOKS_DIR)}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.safecrlf=false',
        '-c',
        'core.splitIndex=false',
        '-c',
        'core.longpaths=true',
        '-c',
        'core.bare=false',
        '-c',
        'gc.auto=0',
        '-c',
        `core.excludesFile=${this.excludesFile}`,
        ...args,
      ],
      {
        cwd: this.isRelative ? this.layout.storageDir : this.layout.top,
        env,
        timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
        signal: command.signal ?? this.deps.signal,
        ...(command.input !== undefined && { input: command.input }),
      },
    )
  }

  /**
   * A work tree file as a command's argument. Git changes into the work tree
   * for most commands, but `hash-object` opens the file from where it was
   * started: the work tree itself, unless the repository is named relative
   * to its own folder (see `run`), when the file is named in full.
   */
  public fileArgument(topRelative: string): string {
    return this.isRelative ? path.join(this.layout.top, topRelative) : topRelative
  }

  /** A command's output as text, trailing line break dropped. */
  public async text(args: readonly string[], command: ShadowCommand = {}): Promise<string> {
    const output = await this.run(args, command)
    return output.toString('utf8').trimEnd()
  }
}

/** The environment without a single `GIT_*` variable (any case, for Windows). */
export function withoutGitVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.toLowerCase().startsWith(GIT_VARIABLE_PREFIX)) {
      kept[key] = value
    }
  }
  return kept
}

/** When the file was last modified; undefined when there is none. */
async function modifiedAt(filePath: string): Promise<number | undefined> {
  try {
    const stats = await stat(filePath)
    return stats.mtimeMs
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

async function isPresent(filePath: string): Promise<boolean> {
  return (await modifiedAt(filePath)) !== undefined
}

/** A text file's content, or undefined when there is no such file. */
export async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}
