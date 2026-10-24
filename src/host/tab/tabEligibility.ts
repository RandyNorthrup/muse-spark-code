// Tab's file decisions (M94, PLAN.md D73): the `files.exclude` match, the
// private/protected names, one file's eligibility for a request, the
// fast-or-multi-line mode choice, the inferred partial accept, the accept
// args and the redacted halves. The provider calls them for every file a
// request reads (Acceptance 3–5, 8, 13). Pure: no `vscode` import.

import path from 'node:path'
import { compileGlob } from '../../core/backends/modelapi/globLimits'
import { isProtectedPath } from '../../core/protectedPaths'
import { redactSecrets } from '../../core/redact'
import { TAB_FILE_MAX_BYTES } from '../../shared/constants'
import { isPrivateFileName } from '../../shared/privateFiles'
import type { TabIgnoreCache } from './tabIgnore'
import type {
  TabAcceptArgs,
  TabDocumentChange,
  TabFilesExclude,
  TabHookBridge,
} from './tabContract'
import type { TabHookContext } from '../../core/tab/tabHooks'

// --- `files.exclude` (Acceptance 4) ---
//
// Read from the file's own configuration scope and matched with the
// extension's own glob compiler (PLAN.md D24: `**/` spans zero or more
// folders, `*` and `?` stay in one segment, `{a,b}` alternates, `[...]`
// is a class), so `**/*.ts` excludes a root-level `file.ts` (RVM94HU
// 14). A pattern excludes a match and everything below it; a pattern
// without a slash also names a file or folder anywhere below the scope
// (stricter than VS Code, never looser). A `{ "when":
// "$(basename).ext" }` condition excludes a match only while that
// sibling exists. Patterns never reach the network.

const BASENAME_SLOT = '$(basename)'

/** The glob's matcher, or none for a pattern the compiler refuses (the user's typo). */
function matcherOf(glob: string): ((relativePath: string) => boolean) | undefined {
  try {
    return compileGlob(glob)
  } catch (error) {
    // An over-limit pattern excludes nothing: it is the user's own typo,
    // and failing closed here would silence Tab for a bad setting.
    if (error instanceof RangeError) {
      return undefined
    }
    throw error
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
Whether a `files.exclude` table excludes the workspace-relative path. A
condition asks `hasSibling` about its sibling (workspace-relative).
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
// Multi-line runs when the cursor's line is blank, or ends in a block
// opener with nothing after the cursor, while `tabMultiline` is `auto`;
// every explicit Invoke is multi-line. The engine (lane C) consumes the
// mode.

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

// --- The inferred partial accept (V9, D73) ---
//
// VS Code's Accept Word/Line need no provider round-trip (V7). A partial
// accept has no stable signal, so it is inferred when a single change of
// at least two characters inserts the start of the item's unaccepted rest
// at its position. Such an edit carries `"inferred": true`; Cursor's
// adapter drops the field. Ordinary keystroke typing (one character a
// change) never fires it.

export interface TabTrackedItem {
  readonly uriString: string
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly rest: string
}

/** The rest after the change, when the change is an inferred partial accept. */
export function inferTabPartialAccept(
  tracked: TabTrackedItem,
  change: TabDocumentChange,
): string | undefined {
  if (change.uriString !== tracked.uriString) {
    return undefined
  }
  if (change.startLine !== tracked.line || change.startCharacter !== tracked.character) {
    return undefined
  }
  if (change.endLine !== tracked.line || change.endCharacter !== tracked.character) {
    // A replacement, not an insertion at the item's position.
    return undefined
  }
  if (change.insertedText.length < 2) {
    return undefined
  }
  return tracked.rest.startsWith(change.insertedText)
    ? tracked.rest.slice(change.insertedText.length)
    : undefined
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
Whether the path may be read at all, before any of its text is: not
private or protected, not `files.exclude`d and not ignored (Acceptance 4;
RVM94HU 17).
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
Whether the file may enter a request, as the current file or as context:
its path eligible, not oversize, and allowed by `beforeTabFileRead`.
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

/** `file` under `root`, forward-slashed, or undefined when it is not inside. */
export function relativeInside(root: string, file: string): string | undefined {
  const relative = path.relative(root, file)
  return relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join('/')
}

/**
The redacted request halves: the whole text is redacted at the cursor's
split, so no secret is cut by the window's edges, and a secret spanning
the cursor (which neither half would match alone) refuses the request
(RVM94HU 15).
*/
export function redactedHalves(
  text: string,
  offset: number,
): { readonly before: string; readonly after: string } | undefined {
  const before = redactSecrets(text.slice(0, offset))
  const after = redactSecrets(text.slice(offset))
  return redactSecrets(text) === before + after ? { before, after } : undefined
}

/** An accept the item's command reports (over the real command args in production). */
export function tabAcceptArgsOf(value: unknown): TabAcceptArgs | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const { filePath, generationId, model, positionLine, positionCharacter, completion } = fields
  return typeof filePath === 'string' &&
    typeof generationId === 'string' &&
    typeof model === 'string' &&
    typeof positionLine === 'number' &&
    typeof positionCharacter === 'number' &&
    typeof completion === 'string'
    ? { filePath, generationId, model, positionLine, positionCharacter, completion }
    : undefined
}
