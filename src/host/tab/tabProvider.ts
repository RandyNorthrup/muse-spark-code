// Tab's inline completions on the host side (M94, PLAN.md D73): the
// `InlineCompletionItemProvider`, the eligibility of every file a request
// reads (Acceptance 3–4), the Copilot yield, the accept command and the
// inferred partial accept. The completion engine (lane C), the spend gate
// over the ledger and the once-per-window question (lane L) and the hooks
// (lane K) arrive as the dependencies `tabBundle.ts` declares.
// `vscode` is the host's external module, as in every host file.

import { Buffer } from 'node:buffer'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { isGitExitError } from '../git'
import { compileGlob } from '../../core/backends/modelapi/globLimits'
import { redactSecrets } from '../../core/redact'
import { isProtectedPath } from '../../core/protectedPaths'
import { contextWindow, orderSnippets, type TabSnippet } from '../../core/tab/tabContext'
import { tabUserText } from '../../core/tab/tabRequest'
import {
  TAB_CONTEXT_FILES,
  TAB_CONTEXT_SNIPPET_LINES,
  TAB_UTF8_BYTES_PER_CODE_UNIT,
  TAB_FAST_MAX_OUTPUT_TOKENS,
  VSCODE_COMMANDS,
  TAB_FILE_MAX_BYTES,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_LINES,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
} from '../../shared/constants'
import { isPrivateFileName } from '../../shared/privateFiles'
import {
  TAB_COMMAND_IDS,
  isTabLanguageOn,
  readCopilotPosture,
  shouldYieldToCopilot,
  type TabAcceptArgs,
  type TabCompletionSnapshot,
  type TabDocumentChange,
  type TabFilesExclude,
  type TabHookBridge,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabQuietReason,
  type TabUri,
} from './tabBundle'

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

// --- The inferred partial accept (V9, D73) ---
//
// VS Code's Accept Word/Line need no provider round-trip (V7). A partial
// accept has no stable signal, so it is inferred when a single change of at
// least two characters inserts the start of the item's unaccepted rest at
// its position. Such an edit carries `"inferred": true`; Cursor's adapter
// drops the field. Ordinary keystroke typing (one character a change) never
// fires it.

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
    if (!(await deps.hooks.beforeRead(candidate.absolutePath, candidate.content))) {
      return false
    }
  }
  return true
}

/** `file` under `root`, forward-slashed, or undefined when it is not inside. */
function relativeInside(root: string, file: string): string | undefined {
  const relative = path.relative(root, file)
  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join('/')
}

/**
 * The redacted request halves: the whole text is redacted at the cursor's
 * split, so no secret is cut by the window's edges, and a secret spanning
 * the cursor (which neither half would match alone) refuses the request
 * (RVM94HU 15).
 */
function redactedHalves(
  text: string,
  offset: number,
): { readonly before: string; readonly after: string } | undefined {
  const before = redactSecrets(text.slice(0, offset))
  const after = redactSecrets(text.slice(offset))
  return redactSecrets(text) === before + after ? { before, after } : undefined
}

// --- The provider ---

// What a request never sent settles: it was billed nothing.
const NOTHING_SENT = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 } as const

// The item command's title never renders (no palette entry; lane W leaves it
// out of package.json): a fixed technical word, not a table string.
const TAB_ACCEPT_COMMAND_TITLE = 'Tab accept'

/**
 * The document parts the provider reads. `vscode.TextDocument` satisfies it
 * structurally, so the registered wrapper passes the document straight
 * through and the tests hand in fakes.
 */
export interface TabDocument {
  readonly uri: TabUri
  readonly languageId: string
  readonly lineAt: (line: number) => { readonly text: string }
  getText(): string
}

export interface TabPosition {
  readonly line: number
  readonly character: number
}

export interface TabCompletionRequest {
  readonly triggerKind: vscode.InlineCompletionTriggerKind
  readonly selectedCompletionInfo: vscode.SelectedCompletionInfo | undefined
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

/** The position after `inserted` is typed at `line`/`character`. */
function positionAfter(
  line: number,
  character: number,
  inserted: string,
): { readonly line: number; readonly character: number } {
  const breaks = inserted.split('\n')
  return breaks.length === 1
    ? { line, character: character + inserted.length }
    : { line: line + breaks.length - 1, character: (breaks.at(-1) ?? '').length }
}

interface TabTracked extends TabTrackedItem {
  readonly generationId: string
  readonly model: string
  /** The whole suggestion arrived in one change: the item's command follows (V8). */
  readonly isWholeInserted: boolean
  /** Some of it was accepted by partial accepts already. */
  readonly isPartlyAccepted: boolean
}

/**
 * The `InlineCompletionItemProvider` (V2, V7–V10): quiet wherever D73 says
 * quiet, one item otherwise. Every file the request reads passed
 * `isTabFileEligible`; every byte sent passed `redactSecrets`. The log gets
 * counts, sizes, timings and outcome classes, never code, a completion or a
 * path. The shim registers it (the handle's `provider`).
 */
export function createTabProvider(deps: TabProviderDeps): TabProviderHandle {
  const ignore = new TabIgnoreCache({
    runGit: deps.runGit,
    ignoreFileExists: deps.ignoreFileExists,
    workspaceRoots: deps.workspaceRoots,
    onIgnoreFilesChanged: deps.onIgnoreFilesChanged,
  })
  let generation = 0
  let tracked: TabTracked | undefined
  // Disposed: pending work stops at its next step and reports nothing
  // (RVM94HU 2).
  const lifecycle = { isDisposed: false }
  // Read through a call: a wait may dispose the provider under any branch.
  const isDisposed = (): boolean => lifecycle.isDisposed

  const quiet = (reason: TabQuietReason): vscode.InlineCompletionItem[] => {
    if (!isDisposed()) {
      deps.onOutcome({ kind: 'quiet', reason })
    }
    return []
  }

  /** The cheap state checks D73 quiets on: run first, and again after every wait. */
  function stateQuietReason(
    document: TabDocument,
    rootAbs: string,
    isInvoke: boolean,
  ): TabQuietReason | undefined {
    const settings = deps.settings()
    if (!isInvoke && settings.tabTrigger !== 'automatic') {
      return 'trigger-setting'
    }
    if (deps.isSnoozed()) {
      return 'snoozed'
    }
    if (!deps.isPaidOn()) {
      return 'paid-off'
    }
    // No key: no request, and never a prompt for one (Acceptance 2).
    if (!deps.isKeyStored()) {
      return 'no-key'
    }
    if (!deps.isTrusted()) {
      return 'untrusted'
    }
    if (!deps.workspaceRoots(document.uri.fsPath).includes(rootAbs)) {
      return 'outside-workspace'
    }
    if (!isTabLanguageOn(settings.tabLanguages, document.languageId)) {
      return 'language-off'
    }
    if (
      !isInvoke &&
      shouldYieldToCopilot(
        readCopilotPosture({
          isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
          foreignSetting: deps.foreignSetting,
          tabWithCopilot: settings.tabWithCopilot,
          languageId: document.languageId,
        }),
      )
    ) {
      return 'copilot'
    }
    return undefined
  }

  /** Related files pass every privacy check before opening or reading text. */
  async function contextSnippets(
    document: TabDocument,
    lineNumber: number,
    lineText: string,
    isCancelled: () => boolean,
  ): Promise<string> {
    const checkedGeneration = ignore.currentGeneration
    const candidates = [...(deps.recentEdits?.() ?? [])]
    const identifiers = lineText.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)
    let queries = 0
    for (const identifier of identifiers) {
      if (queries >= TAB_CONTEXT_FILES || candidates.length >= TAB_CONTEXT_FILES) break
      queries += 1
      if (isCancelled() || !deps.isTrusted()) return ''
      try {
        const locations = await vscode.commands.executeCommand<
          readonly (vscode.Location | vscode.LocationLink)[] | undefined
        >(
          VSCODE_COMMANDS.executeDefinitionProvider,
          document.uri,
          new vscode.Position(lineNumber, identifier.index),
        )
        const available = (locations ?? []).slice(
          0,
          Math.max(0, TAB_CONTEXT_FILES - candidates.length),
        )
        for (const location of available) {
          const uri = 'targetUri' in location ? location.targetUri : location.uri
          const range = 'targetRange' in location ? location.targetRange : location.range
          candidates.push({ uri, line: range.start.line })
        }
      } catch {
        // A language service without a definition supplies no context.
      }
      if (candidates.length >= TAB_CONTEXT_FILES) break
    }
    const snippets: TabSnippet[] = []
    const seen = new Set<string>([document.uri.toString()])
    for (const candidate of candidates.slice(0, TAB_CONTEXT_FILES)) {
      if (isCancelled() || !deps.isTrusted()) return ''
      if (candidate.uri.scheme !== 'file' || seen.has(candidate.uri.toString())) continue
      seen.add(candidate.uri.toString())
      const rootAbs = deps.workspaceRoots(candidate.uri.fsPath).at(0)
      const relativePath =
        rootAbs === undefined ? undefined : relativeInside(rootAbs, candidate.uri.fsPath)
      if (rootAbs === undefined || relativePath === undefined) continue
      const checks: TabFileCheckDeps = {
        filesExclude: deps.filesExclude(candidate.uri),
        ignore,
        rootAbs,
        hasSibling: (sibling) => deps.ignoreFileExists(path.join(rootAbs, ...sibling.split('/'))),
        hooks: deps.hooks,
      }
      try {
        const target = relativeInside(
          await deps.realPath(rootAbs),
          await deps.realPath(candidate.uri.fsPath),
        )
        if (
          target === undefined ||
          isTabForbiddenName(target) ||
          !(await isTabPathEligible(relativePath, checks))
        )
          continue
        const metadata = await stat(candidate.uri.fsPath)
        if (metadata.size > TAB_FILE_MAX_BYTES) continue
        if (isCancelled() || !deps.isTrusted()) return ''
        const related = await vscode.workspace.openTextDocument(candidate.uri)
        if (isCancelled() || !deps.isTrusted() || ignore.currentGeneration !== checkedGeneration)
          return ''
        if (
          !isTabLanguageOn(deps.settings().tabLanguages, related.languageId) ||
          isFilesExcluded(relativePath, deps.filesExclude(candidate.uri), checks.hasSibling)
        )
          continue
        // A large unsaved buffer is refused before reading its text too.
        if (
          related.offsetAt(related.lineAt(related.lineCount - 1).range.end) *
            TAB_UTF8_BYTES_PER_CODE_UNIT >
          TAB_FILE_MAX_BYTES
        )
          continue
        const text = related.getText()
        if (
          !(await isTabFileEligible(
            {
              absolutePath: candidate.uri.fsPath,
              relativePath,
              sizeBytes: Buffer.byteLength(text, 'utf8'),
              content: text,
            },
            checks,
          ))
        )
          continue
        // Redact the full text before cutting: secrets spanning an excerpt edge are still caught.
        const lines = redactSecrets(text).split('\n')
        const start = Math.max(0, candidate.line - Math.floor(TAB_CONTEXT_SNIPPET_LINES / 2))
        snippets.push({
          path: redactSecrets(relativePath),
          text: lines.slice(start, start + TAB_CONTEXT_SNIPPET_LINES).join('\n'),
        })
      } catch {
        // Unreadable related files never prevent a current-file completion.
      }
    }
    return orderSnippets(snippets)
  }

  async function provide(
    document: TabDocument,
    position: TabPosition,
    context: TabCompletionRequest,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    // While the suggest widget has a selection, Tab returns nothing (V2).
    if (context.selectedCompletionInfo !== undefined) {
      return quiet('suggest-selection')
    }
    if (document.uri.scheme !== 'file') {
      return quiet('scheme')
    }
    const isInvoke = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
    // The innermost workspace folder holding the file: the path checked,
    // the path git is asked about and the path the model sees are all
    // relative to it (RVM94HU 13).
    const rootAbs = deps.workspaceRoots(document.uri.fsPath).at(0)
    const relativePath =
      rootAbs === undefined ? undefined : relativeInside(rootAbs, document.uri.fsPath)
    if (rootAbs === undefined || relativePath === undefined) {
      return quiet('outside-workspace')
    }
    const firstReason = stateQuietReason(document, rootAbs, isInvoke)
    if (firstReason !== undefined) {
      return quiet(firstReason)
    }
    const checks: TabFileCheckDeps = {
      filesExclude: deps.filesExclude(document.uri),
      ignore,
      rootAbs,
      hasSibling: (sibling) => deps.ignoreFileExists(path.join(rootAbs, ...sibling.split('/'))),
      hooks: deps.hooks,
    }
    // Links resolved: the target must stay inside the folder and must not be
    // private or protected itself (RVM94HU 12).
    let targetRelative: string | undefined
    try {
      const [realFile, realRoot] = await Promise.all([
        deps.realPath(document.uri.fsPath),
        deps.realPath(rootAbs),
      ])
      targetRelative = relativeInside(realRoot, realFile)
    } catch {
      targetRelative = undefined
    }
    // Nothing of the text is read before its path passed (RVM94HU 17).
    if (
      targetRelative === undefined ||
      isTabForbiddenName(targetRelative) ||
      !(await isTabPathEligible(relativePath, checks))
    ) {
      return quiet('ineligible-file')
    }
    const startedAt = Date.now()
    const ignoreGeneration = ignore.currentGeneration
    const text = document.getText()
    if (
      !(await isTabFileEligible(
        {
          absolutePath: document.uri.fsPath,
          relativePath,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
          content: text,
        },
        checks,
      ))
    ) {
      return quiet('ineligible-file')
    }
    if (isDisposed()) {
      return []
    }
    // The D48 question, once per window (Q-M94a, lane L): Deny sends nothing.
    // The shim snoozes the window on `consent-denied`.
    if (!(await deps.consent.requestUse())) {
      return quiet('consent-denied')
    }
    const line = document.lineAt(position.line).text
    const mode = chooseTabMode(
      line.slice(0, position.character),
      line.slice(position.character),
      deps.settings().tabMultiline,
      isInvoke,
    )
    const offset = toOffset(text, position)
    const halves = redactedHalves(text, offset)
    if (halves === undefined) {
      return quiet('secret-at-cursor')
    }
    // The request's window (lane C's anchored prefix and bounded suffix) over
    // the redacted text: a secret reaches the engine only as the mark
    // (Acceptance 5).
    const window = contextWindow(halves.before + halves.after, halves.before.length, mode)
    const { prefix, suffix } = window
    const snippets =
      mode === 'multiline'
        ? await contextSnippets(
            document,
            position.line,
            line,
            () => token.isCancellationRequested || isDisposed(),
          )
        : ''
    const model = deps.settings().tabModel
    const redactedPath = redactSecrets(relativePath)
    // The worst case is priced on everything sent: the instructions and the
    // one user message (D73, M82's one token per UTF-8 byte; RVM94HU 16).
    const sentText =
      TAB_MODEL_TEXT.tabSystem +
      tabUserText({
        path: redactedPath,
        languageId: document.languageId,
        prefix,
        suffix,
        snippets,
      })
    const reservation = await deps.spend.reserve({
      model,
      inputBytes: Buffer.byteLength(sentText, 'utf8'),
      maxOutputTokens:
        mode === 'fast' ? TAB_FAST_MAX_OUTPUT_TOKENS : TAB_MULTILINE_MAX_OUTPUT_TOKENS,
    })
    if (reservation === undefined) {
      return quiet('budget')
    }
    // Everything checked before the waits is checked again: a snooze, the
    // setting, the key, trust, the folders, the language, Copilot or the
    // ignore files may have changed meanwhile (RVM94HU 2). Nothing was sent,
    // so the reservation is released.
    const lateReason = isDisposed()
      ? 'cancelled-before-send'
      : (stateQuietReason(document, rootAbs, isInvoke) ??
        (ignore.currentGeneration === ignoreGeneration ? undefined : 'ineligible-file'))
    if (lateReason !== undefined) {
      deps.spend.settle(reservation, NOTHING_SENT)
      return quiet(lateReason)
    }
    if (token.isCancellationRequested) {
      // Keystrokes inside the wait send nothing, and no request starts: the
      // reservation is released, since nothing was billed.
      deps.spend.settle(reservation, NOTHING_SENT)
      return quiet('cancelled-before-send')
    }
    const lines = text.split('\n')
    const snapshot: TabCompletionSnapshot = {
      model,
      absolutePath: document.uri.fsPath,
      relativePath: redactedPath,
      languageId: document.languageId,
      prefix,
      suffix,
      snippets,
      mode,
      isInvoke,
      cursorLineBefore: line.slice(0, position.character),
      lineAbove: lines[position.line - 1] ?? '',
      linesBelow: lines.slice(position.line + 1, position.line + 1 + TAB_MULTILINE_MAX_LINES),
      // Read when the engine's debounce or a free slot ends the wait: a
      // keystroke since, or a disposed provider, sends nothing (RVM94HU 3).
      isCancelled: () => token.isCancellationRequested || isDisposed(),
    }
    let completion: string | undefined
    try {
      const answer = await deps.engine.complete(snapshot)
      // Reported usage replaces the reservation when the request ends (the
      // suggestion is published at the closing tag, before that), even for
      // a refusal the provider drops and when the token has been cancelled.
      // A request that reports none keeps its reservation (M82).
      void answer.usage
        .then((usage) => {
          deps.spend.settle(reservation, usage)
        })
        .catch(() => {
          deps.log.warn('Tab request reported no usage; its reservation stands')
        })
      completion = answer.completion
    } catch {
      // No usage was reported, so the reservation stands (M82); the log gets
      // the class, never the cause (it may name a path).
      if (!isDisposed()) {
        deps.onOutcome({ kind: 'failed', failure: 'request' })
      }
      deps.log.warn('Tab request failed (request)')
      return []
    }
    if (completion === undefined) {
      return quiet('no-suggestion')
    }
    if (snapshot.isCancelled()) {
      // A sent request runs to its end: its answer reached the engine's
      // cache and its usage the ledger; only the ghost text is dropped.
      if (!isDisposed()) {
        deps.onOutcome({ kind: 'served', mode })
      }
      return []
    }
    generation += 1
    const generationId = `suggestion-${String(generation)}`
    tracked = {
      uriString: document.uri.toString(),
      filePath: document.uri.fsPath,
      line: position.line,
      character: position.character,
      rest: completion,
      generationId,
      model,
      isWholeInserted: false,
      isPartlyAccepted: false,
    }
    const args: TabAcceptArgs = {
      filePath: document.uri.fsPath,
      generationId,
      model,
      positionLine: position.line,
      positionCharacter: position.character,
      completion,
    }
    const item = new vscode.InlineCompletionItem(
      completion,
      new vscode.Range(position.line, position.character, position.line, position.character),
    )
    item.command = {
      command: TAB_COMMAND_IDS.afterAccept,
      title: TAB_ACCEPT_COMMAND_TITLE,
      arguments: [args],
    }
    const elapsedMs = Date.now() - startedAt
    deps.log.info(
      `Tab suggestion served (${mode}, ${String(prefix.length + suffix.length)} window bytes, ${String(elapsedMs)} ms)`,
    )
    deps.onOutcome({ kind: 'served', mode })
    return [item]
  }

  /** The hook's edit for text inserted at a 0-based position (1-based, as Cursor sends it). */
  function emitEdit(at: TabTracked, newString: string, isInferred: boolean): void {
    if (deps.hooks === undefined) {
      return
    }
    const startLine = at.line + 1
    const startColumn = at.character + 1
    deps.hooks.afterEdit({
      filePath: at.filePath,
      generationId: at.generationId,
      model: at.model,
      oldLine: startLine,
      newLine: startLine,
      range: {
        startLineNumber: startLine,
        startColumn,
        endLineNumber: startLine,
        endColumn: startColumn,
      },
      oldString: '',
      newString,
      inferred: isInferred,
    })
  }

  function acceptNotified(raw: unknown): void {
    if (tracked === undefined) {
      return
    }
    const args = tabAcceptArgsOf(raw)
    if (args?.generationId !== tracked.generationId) {
      return
    }
    const accepted = tracked
    tracked = undefined
    // A full accept is known exactly from the item's command (V8), whether
    // its document change arrived first or not (RVM94HU 5). Lane K caps the
    // strings and counts the cut.
    emitEdit(accepted, args.completion, false)
  }

  function onTextChanged(change: TabDocumentChange): void {
    if (tracked === undefined || tracked.isWholeInserted) {
      return
    }
    const rest = inferTabPartialAccept(tracked, change)
    if (rest === undefined) {
      // Not the item's rest at its position: the item is stale, but only a
      // change at its position proves it (a change elsewhere may leave the
      // ghost text standing).
      if (
        change.uriString === tracked.uriString &&
        change.startLine === tracked.line &&
        change.startCharacter === tracked.character
      ) {
        tracked = undefined
      }
      return
    }
    if (rest === '' && !tracked.isPartlyAccepted) {
      // The whole suggestion in one change: a full accept, whose command
      // follows and reports it exactly (RVM94HU 5).
      tracked = { ...tracked, isWholeInserted: true }
      return
    }
    emitEdit(tracked, change.insertedText, true)
    // The rest now starts where the accepted text ended (RVM94HU 6).
    const next = positionAfter(tracked.line, tracked.character, change.insertedText)
    tracked = rest === '' ? undefined : { ...tracked, ...next, rest, isPartlyAccepted: true }
  }

  const provider: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems: async (document, position, context, token) =>
      await provide(
        document,
        { line: position.line, character: position.character },
        {
          triggerKind: context.triggerKind,
          selectedCompletionInfo: context.selectedCompletionInfo,
        },
        token,
      ),
  }

  const textWatcher = deps.onDidChangeTextDocument((event) => {
    for (const change of event.changes) {
      onTextChanged(change)
    }
  })

  return {
    provider,
    dispose: () => {
      lifecycle.isDisposed = true
      textWatcher.dispose()
      ignore.dispose()
    },
    acceptNotified,
  }
}

/** A document offset for a position, over `\n` splits (the window slices here). */
function toOffset(text: string, position: TabPosition): number {
  const lines = text.split('\n')
  let offset = 0
  for (let line = 0; line < position.line && line < lines.length; line += 1) {
    offset += (lines[line] ?? '').length + 1
  }
  return offset + Math.min(position.character, (lines[position.line] ?? '').length)
}
