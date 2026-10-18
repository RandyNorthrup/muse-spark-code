// M94 file eligibility shared by VS Code and the runtime LSP: same ignore
// policy everywhere; the hook gate runs where the caller supplies a bridge
// (the runtime LSP composes none yet, RVMSM104).
import path from 'node:path'
import { isGitExitError } from '../../host/git'
import { compileGlob } from '../backends/modelapi/globLimits'
import { isProtectedPath } from '../protectedPaths'
import { TAB_FILE_MAX_BYTES } from '../../shared/constants'
import { isPrivateFileName } from '../../shared/privateFiles'
import type { TabHookContext } from './tabHooks'

// --- `files.exclude` (Acceptance 4) ---
//
// Read from the file's own configuration scope and matched with the
// extension's own glob compiler (PLAN.md D24: `**/` spans zero or more
// folders, `*` and `?` stay in one segment, `{a,b}` alternates, `[...]` is
// a class), so `**/*.ts` excludes a root-level `file.ts` (RVM94HU 14). A
// pattern excludes a match and everything below it; a pattern without a
// slash also names a file or folder anywhere below the scope (stricter than
// VS Code, never looser). A `{ "when": "$(basename).ext" }` condition
// excludes a match only while that sibling exists. Patterns never reach the
// network.

const BASENAME_SLOT = '$(basename)'

/** The glob's matcher, or none for a pattern the compiler refuses (the user's typo). */
function matcherOf(glob: string): ((relativePath: string) => boolean) | undefined {
  try {
    return compileGlob(glob)
  } catch {
    // An uncompilable pattern excludes nothing: it is the user's own typo,
    // and failing closed here would silence Tab for a bad setting.
    return undefined
  }
}

/** The path or folder (the file itself or an ancestor) the glob matches first. */
function matchedPathOf(relativePath: string, glob: string): string | undefined {
  const matches = matcherOf(glob)
  if (matches === undefined) {
    return undefined
  }
  const segments = relativePath.split('/')
  const isNameOnly = !glob.includes('/')
  for (let count = 1; count <= segments.length; count += 1) {
    const candidate = segments.slice(0, count).join('/')
    if (matches(candidate) || (isNameOnly && matches(segments[count - 1] ?? ''))) {
      return candidate
    }
  }
  return undefined
}

/** The sibling a `when` condition names for a matched path, workspace-relative. */
function whenSibling(matchedPath: string, when: string): string {
  const name = path.posix.basename(matchedPath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const sibling = when.split(BASENAME_SLOT).join(stem)
  const folder = path.posix.dirname(matchedPath)
  return folder === '.' ? sibling : `${folder}/${sibling}`
}

/**
 * Whether a `files.exclude` table excludes the workspace-relative path. A
 * condition asks `hasSibling` about its sibling (workspace-relative).
 */
export function isFilesExcluded(
  relativePath: string,
  patterns: TabFilesExclude,
  hasSibling: (relativePath: string) => boolean = () => false,
): boolean {
  return Object.entries(patterns).some(([glob, value]) => {
    if (value === false) {
      return false
    }
    const matchedPath = matchedPathOf(relativePath, glob)
    return (
      matchedPath !== undefined &&
      (value === true || hasSibling(whenSibling(matchedPath, value.when)))
    )
  })
}

/** A private file (lane 0 widened the shared list) or a protected path. */
export function isTabForbiddenName(relativePath: string): boolean {
  return isPrivateFileName(relativePath) || isProtectedPath(relativePath)
}

// --- Fast or multi-line (D73) ---
//
// Multi-line runs when the cursor's line is blank, or ends in a block opener
// with nothing after the cursor, while `tabMultiline` is `auto`; every
// explicit Invoke is multi-line. The engine (lane C) consumes the mode.

const BLOCK_OPENERS: ReadonlySet<string> = new Set(['{', '(', '[', ':'])

export function chooseTabMode(
  lineBeforeCursor: string,
  lineAfterCursor: string,
  tabMultiline: 'auto' | 'onInvoke' | 'never',
  isInvoke: boolean,
): 'fast' | 'multiline' {
  if (isInvoke) {
    return 'multiline'
  }
  if (tabMultiline !== 'auto' || lineAfterCursor.trim() !== '') {
    return 'fast'
  }
  if (lineBeforeCursor.trim() === '') {
    return 'multiline'
  }
  return BLOCK_OPENERS.has(lineBeforeCursor.trimEnd().at(-1) ?? '') ? 'multiline' : 'fast'
}

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
}

async function checkIgnore(
  runGit: TabIgnoreDeps['runGit'],
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
    // Anything else: git cannot answer (no git, no repository, a bad config).
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

// --- One file's eligibility (Acceptance 4) ---

export interface TabFileCandidate {
  readonly absolutePath: string
  readonly relativePath: string
  readonly sizeBytes: number
  /** The file's full text when already in hand (the open document, lane C's context). */
  readonly content?: string | undefined
}

export interface TabFileCheckDeps {
  readonly filesExclude: TabFilesExclude
  readonly ignore: TabIgnoreCache
  /** The innermost workspace folder holding the file (git's cwd). */
  readonly rootAbs: string
  /** Whether a workspace-relative sibling exists (a `files.exclude` condition). */
  readonly hasSibling?: ((relativePath: string) => boolean) | undefined
  /** Lane K's bridge; absent until lane K lands (then every failure refuses). */
  readonly hooks?: TabHookBridge | undefined
  readonly hookContext?: TabHookContext | undefined
}

/**
 * Whether the path may be read at all, before any of its text is: not
 * private or protected, not `files.exclude`d and not ignored (Acceptance 4;
 * RVM94HU 17).
 */
export async function isTabPathEligible(
  relativePath: string,
  deps: TabFileCheckDeps,
): Promise<boolean> {
  return (
    !isTabForbiddenName(relativePath) &&
    !isFilesExcluded(relativePath, deps.filesExclude, deps.hasSibling) &&
    !(await deps.ignore.isIgnored(deps.rootAbs, relativePath))
  )
}

/**
 * Whether the file may enter a request, as the current file or as context:
 * its path eligible, not oversize, and allowed by `beforeTabFileRead`.
 */
export async function isTabFileEligible(
  candidate: TabFileCandidate,
  deps: TabFileCheckDeps,
): Promise<boolean> {
  if (
    candidate.sizeBytes > TAB_FILE_MAX_BYTES ||
    !(await isTabPathEligible(candidate.relativePath, deps))
  ) {
    return false
  }
  if (deps.hooks !== undefined) {
    if (candidate.content === undefined) {
      // The hook reads the full text; without it the hook cannot run, and
      // every hook failure fails closed.
      return false
    }
    if (
      deps.hookContext === undefined ||
      !(await deps.hooks.beforeRead(candidate.absolutePath, candidate.content, deps.hookContext))
    ) {
      return false
    }
  }
  return true
}

/** One accept lane K observes (src/core/tab/tabHooks.ts, M94 step 7). */
export interface TabAcceptedEdit {
  /** Absolute path of the edited file. */
  readonly filePath: string
  /** The Tab request's id. */
  readonly generationId: string
  /** The model the suggestion came from. */
  readonly model: string
  /** Actual line text around the accepted insertion. */
  readonly oldLine: string
  readonly newLine: string
  readonly workspaceRoots: readonly string[]
  /** 1-based start/end line and column. */
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  readonly oldString: string
  readonly newString: string
  /** True when the accept was inferred from typing, not from the command. */
  readonly inferred: boolean
}

/**
 * Lane K's hook bridge (M94 step 7, after M91 merges): `beforeRead` answers
 * whether a file's text may enter a request (every failure refuses, and an
 * oversize payload is refused unrun); `afterEdit` observes an accept and
 * never blocks. Absent until lane K lands: with no hooks configured every
 * read is allowed and every accept unobserved.
 */
export interface TabHookBridge {
  beforeRead(absolutePath: string, content: string, context: TabHookContext): Promise<boolean>
  afterEdit(edit: TabAcceptedEdit): void
}

/**
 * A `files.exclude` table as VS Code reads it: a switch per glob, or a
 * condition (`{ "when": "$(basename).ts" }`) that excludes a match only
 * while the named sibling exists (RVM94HU 14).
 */
export type TabFilesExclude = Readonly<Record<string, boolean | { readonly when: string }>>
