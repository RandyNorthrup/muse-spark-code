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
// `info/exclude` (copied in) and the user's global excludes file.

import type { Buffer } from 'node:buffer'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHECKPOINT_GIT_TIMEOUT_MS } from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import type { GitProcess } from '../git'

const SHADOW_DIR = 'shadow.git'
const HOME_DIR = 'home'
const HOOKS_DIR = 'hooks'
const EMPTY_CONFIG = 'empty.gitconfig'
const EMPTY_EXCLUDES = 'empty.gitignore'
const WORK_INDEX = 'work.index'
// Never created: `git status` over it sees every file as untracked.
const NO_INDEX = path.join('listing', 'none.index')
const ATTRIBUTES = path.join('info', 'attributes')
const EXCLUDE = path.join('info', 'exclude')
const LOCK_SUFFIX = '.lock'
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
}

export interface ShadowGitDeps {
  readonly git: GitProcess
  /** The extension host's environment: PATH and the like pass, `GIT_*` does not. */
  readonly env: NodeJS.ProcessEnv
}

export interface ShadowCommand {
  readonly index?: ShadowIndex
  readonly input?: string | Uint8Array
  /** `GIT_LITERAL_PATHSPECS`: off for the commands that refuse it (`check-ignore`). */
  readonly literalPathspecs?: boolean
}

export class ShadowGit {
  private readonly shadowDir: string
  private readonly homeDir: string
  private readonly baseEnv: NodeJS.ProcessEnv
  private excludesFile: string

  public constructor(
    private readonly layout: ShadowLayout,
    private readonly deps: ShadowGitDeps,
  ) {
    this.shadowDir = path.join(layout.storageDir, SHADOW_DIR)
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

  public get top(): string {
    return this.layout.top
  }

  /** The files a checkpoint holds, other than the shadow repository. */
  public indexPath(index: ShadowIndex): string {
    const name = { work: WORK_INDEX, none: NO_INDEX }[index]
    return path.join(this.layout.storageDir, name)
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
    await mkdir(path.join(storageDir, HOOKS_DIR), { recursive: true })
    await mkdir(this.homeDir, { recursive: true })
    await mkdir(path.dirname(this.indexPath('none')), { recursive: true })
    await rm(this.indexPath('none'), { force: true })
    await writeFile(path.join(storageDir, EMPTY_CONFIG), '')
    await writeFile(path.join(storageDir, EMPTY_EXCLUDES), '')
    if (!(await isPresent(path.join(this.shadowDir, 'HEAD')))) {
      await this.deps.git(['init', '--bare', '--quiet', this.shadowDir], {
        cwd: storageDir,
        env: this.baseEnv,
        timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
      })
    }
    await mkdir(path.join(this.shadowDir, 'info'), { recursive: true })
    await writeFile(path.join(this.shadowDir, ATTRIBUTES), NO_CONVERSION)
    await writeFile(path.join(this.shadowDir, EXCLUDE), userExclude ?? '')
    this.excludesFile = globalExcludesFile ?? path.join(storageDir, EMPTY_EXCLUDES)
  }

  /** Removes an index lock older than `staleMs` (a crash mid-command). */
  public async clearStaleLock(index: ShadowIndex, now: number, staleMs: number): Promise<void> {
    const lock = `${this.indexPath(index)}${LOCK_SUFFIX}`
    const since = await modifiedAt(lock)
    if (since !== undefined && now - since > staleMs) {
      await rm(lock, { force: true })
    }
  }

  /** Runs one git command in the shadow repository over the work tree. */
  public async run(args: readonly string[], command: ShadowCommand = {}): Promise<Buffer> {
    const env: NodeJS.ProcessEnv = {
      ...this.baseEnv,
      GIT_DIR: this.shadowDir,
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
        cwd: this.layout.top,
        env,
        timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
        ...(command.input !== undefined && { input: command.input }),
      },
    )
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
