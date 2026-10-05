// Tab's inline completions on the host side (M94, PLAN.md D73): the
// `InlineCompletionItemProvider`, the eligibility of every file a request
// reads (Acceptance 3–4), the Copilot yield, the accept command and the
// inferred partial accept. The completion engine (lane C), the spend gate
// over the ledger and the once-per-window question (lane L) and the hooks
// (lane K) arrive as the dependencies `tabBundle.ts` declares.
// `vscode` is the host's external module, as in every host file.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import * as vscode from 'vscode'
import { isGitExitError } from '../git'
import { redactSecrets } from '../../core/redact'
import { isProtectedPath } from '../../core/protectedPaths'
import { contextWindow } from '../../core/tab/tabContext'
import { tabUserText } from '../../core/tab/tabRequest'
import {
  TAB_FAST_MAX_OUTPUT_TOKENS,
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
  type TabHookBridge,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabQuietReason,
  type TabUri,
} from './tabBundle'

// --- `files.exclude` (Acceptance 4) ---
//
// Read from the file's own configuration scope and matched here, with VS
// Code's own rules as far as they can be written small: `*` spans a segment,
// `**` spans segments, `?` is one character, `{a,b}` is an alternative, and
// a pattern without a slash matches the name in any folder. A pattern that
// matches with its switch on excludes; patterns never reach the network.

function globAlternativeToRegExp(choice: string): string {
  return `(?:${choice
    .split(',')
    .map((branch) => globBodyToRegExp(branch))
    .join('|')}`
}

const GLOB_SPECIAL = new Set(['.', '+', '^', '$', '(', ')', '|', '[', ']', '\\', '}'])

/** One glob atom as a regex, and the index past it. */
function globAtomToRegExp(glob: string, index: number): { text: string; next: number } {
  const char = glob[index]
  switch (char) {
    case '*': {
      const isDouble = glob[index + 1] === '*'
      return { text: isDouble ? '.*' : '[^/]*', next: index + (isDouble ? 2 : 1) }
    }
    case '?': {
      return { text: '[^/]', next: index + 1 }
    }
    case '{': {
      const close = glob.indexOf('}', index)
      if (close === -1) {
        return { text: String.raw`\{`, next: index + 1 }
      }
      return {
        text: `${globAlternativeToRegExp(glob.slice(index + 1, close))})`,
        next: close + 1,
      }
    }
    case undefined: {
      return { text: '', next: index }
    }
    default: {
      // Only regex metacharacters are escaped: `\b` would mean a word
      // boundary, not a literal `b`.
      return { text: GLOB_SPECIAL.has(char) ? `\\${char}` : char, next: index + 1 }
    }
  }
}

function globBodyToRegExp(glob: string): string {
  let out = ''
  let index = 0
  while (index < glob.length) {
    const atom = globAtomToRegExp(glob, index)
    if (atom.next <= index) {
      break
    }
    out += atom.text
    index = atom.next
  }
  return out
}

function globToRegExp(glob: string): RegExp {
  const body = globBodyToRegExp(glob)
  // A pattern without a slash names a file anywhere below the scope.
  const anchored = glob.includes('/') ? `^${body}$` : `(?:^|/)${body}$`
  return new RegExp(anchored)
}

function isGlobMatch(relativePath: string, glob: string): boolean {
  try {
    return globToRegExp(glob).test(relativePath)
  } catch {
    // An uncompilable pattern excludes nothing: it is the user's own typo,
    // and failing closed here would silence Tab for a bad setting.
    return false
  }
}

/** Whether a `files.exclude` table excludes the workspace-relative path. */
export function isFilesExcluded(
  relativePath: string,
  patterns: Readonly<Record<string, boolean>>,
): boolean {
  return Object.entries(patterns).some(([glob, isOn]) => isOn && isGlobMatch(relativePath, glob))
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
// other failure leaves git unable to answer. `.cursorignore` and
// `.continueignore` go through the same call with `-c
// core.excludesFile=<file>` and `--no-index`, so a tracked file is caught
// too. Where git cannot answer and an ignore file is present, nothing in
// that folder is read. The cache drops when an ignore file changes.

const IGNORE_FILENAMES = ['.gitignore', '.cursorignore', '.continueignore'] as const
const CURSOR_IGNORE_FILENAMES = ['.cursorignore', '.continueignore'] as const
// A bound, not a tuning: the map holds one boolean per path asked about.
const IGNORE_CACHE_MAX_ENTRIES = 512

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

/** git's ignore answer per path, with the fail-closed blind rule. */
export class TabIgnoreCache {
  private readonly verdicts = new Map<string, boolean>()
  private readonly watcher: { dispose(): void }

  public constructor(private readonly deps: TabIgnoreDeps) {
    this.watcher = deps.onIgnoreFilesChanged(() => {
      this.verdicts.clear()
    })
  }

  private async askGit(rootAbs: string, relativePath: string): Promise<boolean> {
    const ignored = await checkIgnore(
      this.deps.runGit,
      ['check-ignore', '-q', '--', relativePath],
      rootAbs,
    )
    if (ignored !== undefined) {
      return ignored
    }
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
      if (matched === true) {
        return true
      }
      if (matched === undefined) {
        // git cannot answer this check either: the file is present, so
        // nothing in the folder is read.
        return true
      }
    }
    // git cannot answer the plain check: refuse only where an ignore file is
    // present, since only then could git have had something to say.
    return IGNORE_FILENAMES.some((name) => this.deps.ignoreFileExists(path.join(rootAbs, name)))
  }

  /** Whether git ignores the path, or git is blind where an ignore file sits. */
  public async isIgnored(rootAbs: string, relativePath: string): Promise<boolean> {
    const key = `${rootAbs} ${relativePath}`
    const cached = this.verdicts.get(key)
    if (cached !== undefined) {
      return cached
    }
    const isGitIgnored = await this.askGit(rootAbs, relativePath)
    if (this.verdicts.size >= IGNORE_CACHE_MAX_ENTRIES) {
      this.verdicts.clear()
    }
    this.verdicts.set(key, isGitIgnored)
    return isGitIgnored
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
  readonly filesExclude: Readonly<Record<string, boolean>>
  readonly ignore: TabIgnoreCache
  /** The innermost workspace folder holding the file (git's cwd). */
  readonly rootAbs: string
  /** Lane K's bridge; absent until lane K lands (then every failure refuses). */
  readonly hooks?: TabHookBridge | undefined
}

/**
 * Whether the file may enter a request, as the current file or as context:
 * inside the workspace, not private or protected, not oversize, not
 * `files.exclude`d, not git-ignored and allowed by `beforeTabFileRead`.
 */
export async function isTabFileEligible(
  candidate: TabFileCandidate,
  deps: TabFileCheckDeps,
): Promise<boolean> {
  if (
    isTabForbiddenName(candidate.relativePath) ||
    candidate.sizeBytes > TAB_FILE_MAX_BYTES ||
    isFilesExcluded(candidate.relativePath, deps.filesExclude) ||
    (await deps.ignore.isIgnored(deps.rootAbs, candidate.relativePath))
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

/**
 * The `InlineCompletionItemProvider` (V2, V7–V10): quiet wherever D73 says
 * quiet, one item otherwise. Every file the request reads passed
 * `isTabFileEligible`; every byte sent passed `redactSecrets`. The log gets
 * counts, sizes, timings and outcome classes, never code, a completion or a
 * path.
 */
export function createTabProvider(deps: TabProviderDeps): TabProviderHandle {
  const ignore = new TabIgnoreCache({
    runGit: deps.runGit,
    ignoreFileExists: deps.ignoreFileExists,
    workspaceRoots: deps.workspaceRoots,
    onIgnoreFilesChanged: deps.onIgnoreFilesChanged,
  })
  let generation = 0
  let tracked: (TabTrackedItem & { generationId: string; model: string }) | undefined

  const quiet = (reason: TabQuietReason): vscode.InlineCompletionItem[] => {
    deps.onOutcome({ kind: 'quiet', reason })
    return []
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
    const settings = deps.settings()
    const isInvoke = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke
    if (!isInvoke && settings.tabTrigger !== 'automatic') {
      return quiet('trigger-setting')
    }
    if (deps.isSnoozed()) {
      return quiet('snoozed')
    }
    if (!deps.isPaidOn()) {
      return quiet('paid-off')
    }
    // No key: no request, and never a prompt for one (Acceptance 2).
    if (!deps.isKeyStored()) {
      return quiet('no-key')
    }
    if (!deps.isTrusted()) {
      return quiet('untrusted')
    }
    if (document.uri.scheme !== 'file') {
      return quiet('scheme')
    }
    const relativePath = deps.relativeInWorkspace(document.uri)
    if (relativePath === undefined) {
      return quiet('outside-workspace')
    }
    if (!isTabLanguageOn(settings.tabLanguages, document.languageId)) {
      return quiet('language-off')
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
      return quiet('copilot')
    }
    const startedAt = Date.now()
    const text = document.getText()
    const line = document.lineAt(position.line).text
    const mode = chooseTabMode(
      line.slice(0, position.character),
      line.slice(position.character),
      settings.tabMultiline,
      isInvoke,
    )
    const rootAbs = deps.workspaceRoots(document.uri.fsPath).at(0)
    const isEligible =
      rootAbs !== undefined &&
      (await isTabFileEligible(
        {
          absolutePath: document.uri.fsPath,
          relativePath,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
          content: text,
        },
        {
          filesExclude: deps.filesExclude(document.uri),
          ignore,
          rootAbs,
          hooks: deps.hooks,
        },
      ))
    if (!isEligible) {
      return quiet('ineligible-file')
    }
    // The D48 question, once per window (Q-M94a, lane L): Deny sends nothing.
    // The shim snoozes the window on `consent-denied`.
    if (!(await deps.consent.requestUse())) {
      return quiet('consent-denied')
    }
    // The request's window (lane C's anchored prefix and bounded suffix),
    // and every byte sent passed `redactSecrets`: a secret reaches the
    // engine only as the mark (Acceptance 5).
    const offset = toOffset(text, position)
    const window = contextWindow(text, offset, mode)
    const prefix = redactSecrets(window.prefix)
    const suffix = redactSecrets(window.suffix)
    // The worst case is priced on what is sent: the instructions and the
    // one user message (D73, M82's one token per UTF-8 byte).
    const sentText =
      TAB_MODEL_TEXT.tabSystem +
      tabUserText({
        path: relativePath,
        languageId: document.languageId,
        prefix,
        suffix,
        snippets: '',
      })
    const reservation = await deps.spend.reserve({
      model: settings.tabModel,
      inputBytes: Buffer.byteLength(sentText, 'utf8'),
      maxOutputTokens:
        mode === 'fast' ? TAB_FAST_MAX_OUTPUT_TOKENS : TAB_MULTILINE_MAX_OUTPUT_TOKENS,
    })
    if (reservation === undefined) {
      return quiet('budget')
    }
    const isCancelledBeforeSend = token.isCancellationRequested
    if (isCancelledBeforeSend) {
      // Keystrokes inside the wait send nothing, and no request starts: the
      // reservation is released, since nothing was billed.
      deps.spend.settle(reservation, NOTHING_SENT)
      return quiet('cancelled-before-send')
    }
    const lines = text.split('\n')
    const snapshot: TabCompletionSnapshot = {
      model: settings.tabModel,
      absolutePath: document.uri.fsPath,
      relativePath,
      languageId: document.languageId,
      prefix,
      suffix,
      mode,
      isInvoke,
      cursorLineBefore: line.slice(0, position.character),
      lineAbove: lines[position.line - 1] ?? '',
      linesBelow: lines.slice(position.line + 1, position.line + 1 + TAB_MULTILINE_MAX_LINES),
      // Read when the engine's debounce ends: a keystroke since sends nothing.
      isCancelled: () => token.isCancellationRequested,
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
      deps.onOutcome({ kind: 'failed', failure: 'request' })
      deps.log.warn('Tab request failed (request)')
      return []
    }
    if (completion === undefined) {
      return quiet('no-suggestion')
    }
    const isCancelledAfterSend = token.isCancellationRequested
    if (isCancelledAfterSend) {
      // A sent request runs to its end: its answer reached the engine's
      // cache and its usage the ledger; only the ghost text is dropped.
      deps.onOutcome({ kind: 'served', mode })
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
      model: settings.tabModel,
    }
    const args: TabAcceptArgs = {
      filePath: document.uri.fsPath,
      generationId,
      model: settings.tabModel,
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
      `Tab suggestion served (${mode}, ${String(snapshot.prefix.length + snapshot.suffix.length)} window bytes, ${String(elapsedMs)} ms)`,
    )
    deps.onOutcome({ kind: 'served', mode })
    return [item]
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
    if (deps.hooks === undefined) {
      return
    }
    // A full accept is known exactly from the item's command (V8). Lines and
    // columns count from 1; lane K caps the strings and counts the cut.
    const startLine = accepted.line + 1
    const startColumn = accepted.character + 1
    deps.hooks.afterEdit({
      filePath: accepted.filePath,
      generationId: accepted.generationId,
      model: accepted.model,
      oldLine: startLine,
      newLine: startLine,
      range: {
        startLineNumber: startLine,
        startColumn,
        endLineNumber: startLine,
        endColumn: startColumn,
      },
      oldString: '',
      newString: args.completion,
      inferred: false,
    })
  }

  function onTextChanged(change: TabDocumentChange): void {
    if (tracked === undefined) {
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
    if (deps.hooks !== undefined) {
      const startLine = tracked.line + 1
      const startColumn = tracked.character + 1
      deps.hooks.afterEdit({
        filePath: tracked.filePath,
        generationId: tracked.generationId,
        model: tracked.model,
        oldLine: startLine,
        newLine: startLine,
        range: {
          startLineNumber: startLine,
          startColumn,
          endLineNumber: startLine,
          endColumn: startColumn,
        },
        oldString: '',
        newString: change.insertedText,
        inferred: true,
      })
    }
    tracked = rest === '' ? undefined : { ...tracked, rest }
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

  const registration = vscode.languages.registerInlineCompletionItemProvider(
    { scheme: 'file' },
    provider,
  )
  const textWatcher = deps.onDidChangeTextDocument((event) => {
    for (const change of event.changes) {
      onTextChanged(change)
    }
  })

  return {
    dispose: () => {
      registration.dispose()
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
