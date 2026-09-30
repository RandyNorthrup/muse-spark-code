// The editor's side of the verify loop (M68, PLAN.md D49): what VS Code's
// language servers report on files an edit wrote, once they settle, and what
// the document's formatter makes of a file just written (format on edit).
// The tools write the files on disk; a document is only read here, never
// edited, so nothing is left unsaved.
//
// The servers report only on files an editor shows (measured in VS Code
// 1.139.1 and 1.125.0), so each file no editor shows is opened beside the
// active editor, without focus, as a tab of its own (so it never replaces
// the user's preview), and that tab is closed once the batch is read. One
// queue serves every caller (the Model API loop of each session, its
// subagents, and the diagnostics tool on either backend), so two callers
// never show files over each other; a stop ends the caller's wait and skips
// its remaining files. A file whose server sent no report is "not checked",
// never clean (the M68 review).

import * as vscode from 'vscode'
import { DIAGNOSTIC_SEVERITIES, type DiagnosticEntry } from '../../core/diagnostics'
import { isCodeLoading } from '../../core/verify/codeFiles'
import type { EditedFile, FileDiagnostics } from '../../core/verify/diagnosticsReport'
import { bytesFingerprint } from '../../core/verify/fingerprint'
import { applyOffsetEdits, type OffsetEdit } from '../../core/verify/textEdits'
import { confineWorkspacePath } from '../../core/workspacePath'
import {
  DIAGNOSTICS_SETTLE_FIRST_MS,
  DIAGNOSTICS_SETTLE_MAX_MS,
  DIAGNOSTICS_SETTLE_QUIET_MS,
  EDITOR_DEFAULT_TAB_SIZE,
  FORMAT_SYNC_MAX_MS,
  FORMAT_SYNC_POLL_MS,
  FORMAT_TIMEOUT_MS,
  type UncheckedReason,
  VSCODE_COMMANDS,
} from '../../shared/constants'
import type { Logger } from '../logger'

/** How long the language servers are given once a file is shown (tests shorten it). */
export interface SettleTiming {
  readonly firstMs: number
  readonly quietMs: number
  readonly maxMs: number
}

const SETTLE_TIMING: SettleTiming = {
  firstMs: DIAGNOSTICS_SETTLE_FIRST_MS,
  quietMs: DIAGNOSTICS_SETTLE_QUIET_MS,
  maxMs: DIAGNOSTICS_SETTLE_MAX_MS,
}

/** How long a document is given to catch up, and the formatter to answer. */
export interface FormatTiming {
  readonly syncMs: number
  readonly pollMs: number
  readonly formatMs: number
}

const FORMAT_TIMING: FormatTiming = {
  syncMs: FORMAT_SYNC_MAX_MS,
  pollMs: FORMAT_SYNC_POLL_MS,
  formatMs: FORMAT_TIMEOUT_MS,
}

export interface VerifyEditorDeps {
  readonly platform: NodeJS.Platform
  readonly log: Logger
  /** The first folder; the diagnostics tool's files are confined to it by real path. */
  readonly workspaceRoot: string | undefined
  /** A path's canonical form, links and junctions resolved (`canonicalPath`). */
  readonly realPath: (absolutePath: string) => Promise<string>
  readonly settle?: SettleTiming
  readonly format?: FormatTiming
}

export interface VerifyEditor {
  /** Each file's diagnostics once its server settles, or why they were not read. */
  diagnosticsAfterEdit(
    files: readonly EditedFile[],
    signal: AbortSignal,
  ): Promise<readonly FileDiagnostics[]>
  /**
   * For the diagnostics tool asked about one file: shows it (when it is in
   * the workspace by its real path and is not code the editor's tools run),
   * waits for its server, and reads the file's diagnostics while it still
   * shows (a server clears them when its tab closes). Undefined when none
   * were read: refused, no report, or stopped.
   */
  settleFile(
    absolutePath: string,
    signal?: AbortSignal,
  ): Promise<readonly DiagnosticEntry[] | undefined>
  /** The file's text as its formatter leaves it, or undefined: no formatter, no change, or not safe. */
  formatAfterEdit(absolutePath: string, text: string): Promise<string | undefined>
  /** Stops listening for the language servers' reports. */
  dispose(): void
}

const BOM = '\u{FEFF}'
const LONE_LINE_FEED = /(?<!\r)\n/g
const CRLF = '\r\n'
const CONFIGURATION_SECTION = 'editor'
const TAB_SIZE = 'tabSize'
const INSERT_SPACES = 'insertSpaces'
const NEVER_STOPPED = new AbortController().signal
// What a diagnostics tool call that stopped while it waited its turn read.
const NOTHING_READ = (): readonly DiagnosticEntry[] | undefined => undefined

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A URI as one key: case-folded where the file system is (Windows). */
function uriKey(uri: vscode.Uri, platform: NodeJS.Platform): string {
  const text = uri.toString()
  return platform === 'win32' ? text.toLowerCase() : text
}

function entryOf(file: EditedFile, diagnostic: vscode.Diagnostic): DiagnosticEntry {
  return {
    path: file.relative,
    severity: DIAGNOSTIC_SEVERITIES[diagnostic.severity] ?? 'error',
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    message: diagnostic.message,
    source: diagnostic.source,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** When each file last got a report from its language server, since the editor was made. */
interface ReportLog {
  readonly lastAt: (key: string) => number | undefined
  readonly dispose: () => void
}

function logReports(platform: NodeJS.Platform): ReportLog {
  const lastAt = new Map<string, number>()
  const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
    const at = Date.now()
    for (const uri of event.uris) {
      lastAt.set(uriKey(uri, platform), at)
    }
  })
  return {
    lastAt: (key) => lastAt.get(key),
    dispose: () => {
      subscription.dispose()
    },
  }
}

/**
 * The reports for one file, counted from the moment this is called (before
 * the file is shown, so none is missed). `settle` starts its timers when it
 * is called, once the file is shown: true once a report arrived (or one
 * arrived earlier, `hasEarlierReport`) and the server has been quiet, false
 * when none arrived in the first wait or the caller stopped.
 */
function watchReports(
  key: string,
  platform: NodeJS.Platform,
): {
  readonly settle: (
    timing: SettleTiming,
    signal: AbortSignal,
    hasEarlierReport: boolean,
  ) => Promise<boolean>
  readonly dispose: () => void
} {
  let reports = 0
  let onReport: (() => void) | undefined
  const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
    if (event.uris.every((uri) => uriKey(uri, platform) !== key)) {
      return
    }
    reports += 1
    onReport?.()
  })
  const settle = (
    timing: SettleTiming,
    signal: AbortSignal,
    hasEarlierReport: boolean,
  ): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false)
        return
      }
      let first: ReturnType<typeof setTimeout> | undefined
      let quiet: ReturnType<typeof setTimeout> | undefined
      const finish = (isSettled: boolean) => {
        clearTimeout(first)
        clearTimeout(quiet)
        clearTimeout(cap)
        onReport = undefined
        signal.removeEventListener('abort', onAbort)
        resolve(isSettled)
      }
      const onAbort = () => {
        finish(false)
      }
      const waitForQuiet = () => {
        clearTimeout(first)
        clearTimeout(quiet)
        quiet = setTimeout(() => {
          finish(true)
        }, timing.quietMs)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      const cap = setTimeout(() => {
        finish(hasEarlierReport || reports > 0)
      }, timing.maxMs)
      onReport = waitForQuiet
      if (hasEarlierReport || reports > 0) {
        waitForQuiet()
      } else {
        first = setTimeout(() => {
          finish(false)
        }, timing.firstMs)
      }
    })
  return {
    settle,
    dispose: () => {
      subscription.dispose()
    },
  }
}

/** Whether the caller stopped; a call, so a check after an await is not narrowed away. */
function isStopped(signal: AbortSignal): boolean {
  return signal.aborted
}

/** The tabs, in every group, of the document with this key. */
function tabsOf(key: string, platform: NodeJS.Platform): readonly vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter(
      (tab) => tab.input instanceof vscode.TabInputText && uriKey(tab.input.uri, platform) === key,
    ),
  )
}

/** A tab the loop opened: its document and its group, closed when the batch is read. */
interface OpenedTab {
  readonly key: string
  readonly column: vscode.ViewColumn
}

type Shown =
  | { readonly ok: true; readonly document: vscode.TextDocument; readonly wasVisible: boolean }
  | { readonly ok: false; readonly reason: UncheckedReason }

/**
 * Shows the file unless an editor already shows it, without focus: in the
 * group of a tab it already has outside the user's group, as that tab is
 * (its preview state kept; the Codex review of PR #54), else beside the
 * active editor as a tab of its own (never a preview, which would replace
 * the user's), noting the tabs it created. Never in the user's group, so
 * nothing the user types lands in it.
 */
async function show(
  deps: VerifyEditorDeps,
  file: EditedFile,
  key: string,
  opened: OpenedTab[],
): Promise<Shown> {
  let document: vscode.TextDocument
  try {
    document = await vscode.workspace.openTextDocument(vscode.Uri.file(file.absolute))
  } catch (error: unknown) {
    deps.log.warn(
      `Verify: ${file.relative} could not be opened for diagnostics: ${describe(error)}`,
    )
    return { ok: false, reason: 'notShown' }
  }
  if (document.isDirty) {
    return { ok: false, reason: 'unsaved' }
  }
  const isVisible = vscode.window.visibleTextEditors.some(
    (shown) => uriKey(shown.document.uri, deps.platform) === key,
  )
  if (isVisible) {
    return { ok: true, document, wasVisible: true }
  }
  const existing = tabsOf(key, deps.platform)
  const before = new Set(existing.map((tab) => tab.group.viewColumn))
  const reused = existing.find((tab) => !tab.group.isActive)
  try {
    await vscode.window.showTextDocument(document.uri, {
      viewColumn: reused?.group.viewColumn ?? vscode.ViewColumn.Beside,
      preview: reused?.isPreview ?? false,
      preserveFocus: true,
    })
  } catch (error: unknown) {
    deps.log.warn(`Verify: ${file.relative} could not be shown for diagnostics: ${describe(error)}`)
    return { ok: false, reason: 'notShown' }
  }
  for (const tab of tabsOf(key, deps.platform)) {
    if (!before.has(tab.group.viewColumn)) {
      opened.push({ key, column: tab.group.viewColumn })
    }
  }
  return { ok: true, document, wasVisible: false }
}

/**
 * Whether the server reported on the file since it was written: for a file
 * an editor already showed, that report can come before the wait starts
 * (the Codex review of PR #54).
 */
async function isReportedSinceWrite(
  file: EditedFile,
  key: string,
  reportLog: ReportLog,
): Promise<boolean> {
  const reportedAt = reportLog.lastAt(key)
  if (reportedAt === undefined) {
    return false
  }
  try {
    const { mtime } = await vscode.workspace.fs.stat(vscode.Uri.file(file.absolute))
    return reportedAt >= mtime
  } catch {
    // A file that cannot be looked up has no write time to compare: wait for a new report.
    return false
  }
}

/**
 * Whether a document an editor already showed holds what is on disk, unsaved
 * changes aside: its server has had that text, and a server that reports
 * nothing new keeps what it said about it.
 */
async function isShowingDiskText(document: vscode.TextDocument): Promise<boolean> {
  if (document.isDirty) {
    return false
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(document.uri)
    return document.getText() === new TextDecoder().decode(bytes)
  } catch {
    // A file that cannot be read cannot be compared: it stays "not checked".
    return false
  }
}

/**
 * Whether the file is still the one confinement found (its real path
 * unchanged) and, for an edited file, still holds what the edit left:
 * checked immediately before each act on it, the show and the read (the
 * Codex review of PR #54).
 */
async function isStillAsConfined(deps: VerifyEditorDeps, file: EditedFile): Promise<boolean> {
  try {
    if ((await deps.realPath(file.absolute)) !== file.absolute) {
      return false
    }
    if (file.fingerprint === undefined) {
      return true
    }
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file.absolute))
    return bytesFingerprint(bytes) === file.fingerprint
  } catch (error: unknown) {
    deps.log.warn(`Verify: ${file.relative} could not be checked again: ${describe(error)}`)
    return false
  }
}

/** Each group's active tab, by the group's column. */
function activeTabs(): ReadonlyMap<vscode.ViewColumn, vscode.Tab | undefined> {
  return new Map(vscode.window.tabGroups.all.map((group) => [group.viewColumn, group.activeTab]))
}

/** A tab's document key, or undefined for a tab that shows no text document. */
function tabKey(tab: vscode.Tab | undefined, platform: NodeJS.Platform): string | undefined {
  return tab?.input instanceof vscode.TabInputText ? uriKey(tab.input.uri, platform) : undefined
}

function isSameTab(
  a: vscode.Tab | undefined,
  b: vscode.Tab | undefined,
  platform: NodeJS.Platform,
): boolean {
  return a?.label === b?.label && tabKey(a, platform) === tabKey(b, platform)
}

/**
 * Brings back to the front, in each group where the loop left one of its
 * files in front, the tab that was there before the batch (the Codex review
 * of PR #54): a reused tab stays open, and would otherwise hide the user's.
 * A text tab is shown again as it was, without focus; any other kind is
 * logged.
 */
async function restoreActiveTabs(
  deps: VerifyEditorDeps,
  before: ReadonlyMap<vscode.ViewColumn, vscode.Tab | undefined>,
  shownKeys: ReadonlySet<string>,
): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    const previous = before.get(group.viewColumn)
    const nowKey = tabKey(group.activeTab, deps.platform)
    const isOurs = nowKey !== undefined && shownKeys.has(nowKey)
    if (!isOurs || isSameTab(group.activeTab, previous, deps.platform)) {
      continue
    }
    const still = group.tabs.find((tab) => isSameTab(tab, previous, deps.platform))
    if (still === undefined) {
      continue
    }
    if (!(still.input instanceof vscode.TabInputText)) {
      deps.log.warn(`Verify: ${still.label} could not be brought back to the front`)
      continue
    }
    try {
      await vscode.window.showTextDocument(still.input.uri, {
        viewColumn: group.viewColumn,
        preview: still.isPreview,
        preserveFocus: true,
      })
    } catch (error: unknown) {
      deps.log.warn(`Verify: ${still.label} could not be brought back: ${describe(error)}`)
    }
  }
}

/** Closes the tabs the loop opened, unless the user has since changed their text. */
async function closeOpened(deps: VerifyEditorDeps, opened: readonly OpenedTab[]): Promise<void> {
  const tabs = opened.flatMap(({ key, column }) =>
    tabsOf(key, deps.platform).filter((tab) => tab.group.viewColumn === column && !tab.isDirty),
  )
  if (tabs.length === 0) {
    return
  }
  try {
    await vscode.window.tabGroups.close([...tabs], true)
  } catch (error: unknown) {
    deps.log.warn(`Verify: the files shown for diagnostics could not be closed: ${describe(error)}`)
  }
}

/** One file shown and read once its server settles, or why it was not read. */
async function settledDiagnostics(
  deps: VerifyEditorDeps,
  reportLog: ReportLog,
  file: EditedFile,
  signal: AbortSignal,
  opened: OpenedTab[],
  shownKeys: Set<string>,
): Promise<FileDiagnostics> {
  if (signal.aborted) {
    return { file, entries: [], unchecked: 'stopped' }
  }
  const key = uriKey(vscode.Uri.file(file.absolute), deps.platform)
  if (!(await isStillAsConfined(deps, file))) {
    return { file, entries: [], unchecked: 'changed' }
  }
  const reports = watchReports(key, deps.platform)
  try {
    const shown = await show(deps, file, key, opened)
    if (!shown.ok) {
      return { file, entries: [], unchecked: shown.reason }
    }
    shownKeys.add(key)
    // A file an editor already showed may have been reported on before the
    // wait began, and showing it again brings no new report.
    const hasEarlierReport = shown.wasVisible && (await isReportedSinceWrite(file, key, reportLog))
    const isSettled =
      (await reports.settle(deps.settle ?? SETTLE_TIMING, signal, hasEarlierReport)) ||
      (shown.wasVisible && !isStopped(signal) && (await isShowingDiskText(shown.document)))
    if (isStopped(signal)) {
      return { file, entries: [], unchecked: 'stopped' }
    }
    if (!isSettled) {
      return { file, entries: [], unchecked: 'noReport' }
    }
    // What the servers hold is about the text the editor has: read it only
    // while that is still what the edit left, at the path it left it.
    if (shown.document.isDirty) {
      return { file, entries: [], unchecked: 'unsaved' }
    }
    if (!(await isStillAsConfined(deps, file))) {
      return { file, entries: [], unchecked: 'changed' }
    }
    const held = vscode.languages
      .getDiagnostics()
      .find(([candidate]) => uriKey(candidate, deps.platform) === key)
    return { file, entries: (held?.[1] ?? []).map((diagnostic) => entryOf(file, diagnostic)) }
  } finally {
    reports.dispose()
  }
}

/**
 * Each file in turn, then the tabs opened for them closed and each group's
 * front tab as it was before.
 */
async function readFiles(
  deps: VerifyEditorDeps,
  reportLog: ReportLog,
  files: readonly EditedFile[],
  signal: AbortSignal,
): Promise<readonly FileDiagnostics[]> {
  const opened: OpenedTab[] = []
  const shownKeys = new Set<string>()
  const before = activeTabs()
  const results: FileDiagnostics[] = []
  try {
    for (const file of files) {
      results.push(await settledDiagnostics(deps, reportLog, file, signal, opened, shownKeys))
    }
  } finally {
    await closeOpened(deps, opened)
    await restoreActiveTabs(deps, before, shownKeys)
  }
  return results
}

/**
 * The diagnostics tool's file, confined by its real path (a link inside the
 * workspace to a file outside it is never opened) and never a file the
 * editor's tools run as code: its entries as read before its tab closed
 * (the integration run found the JSON server clearing them on close).
 */
async function toolFileDiagnostics(
  deps: VerifyEditorDeps,
  reportLog: ReportLog,
  absolutePath: string,
  signal: AbortSignal,
): Promise<readonly DiagnosticEntry[] | undefined> {
  if (deps.workspaceRoot === undefined) {
    return undefined
  }
  const resolved = await confineWorkspacePath(deps.workspaceRoot, absolutePath, deps.platform, {
    realPath: deps.realPath,
  })
  if (!resolved.ok || isCodeLoading(resolved.relative) || isCodeLoading(resolved.canonical)) {
    return undefined
  }
  const [result] = await readFiles(
    deps,
    reportLog,
    [{ relative: resolved.relative, absolute: resolved.checkedAbsolute }],
    signal,
  )
  return result?.unchecked === undefined ? result?.entries : undefined
}

const TIMED_OUT: unique symbol = Symbol('timed out')

/** `work`, or TIMED_OUT once `ms` pass first. */
async function within<T>(work: Thenable<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT)
    }, ms)
  })
  try {
    return await Promise.race([Promise.resolve(work), late])
  } finally {
    clearTimeout(timer)
  }
}

/** Waits for an open document to hold what the tool wrote; false when it never does. */
async function isCaughtUp(
  document: vscode.TextDocument,
  expected: string,
  timing: FormatTiming,
): Promise<boolean> {
  const deadline = Date.now() + timing.syncMs
  while (document.getText() !== expected) {
    if (document.isDirty || Date.now() >= deadline) {
      return false
    }
    await sleep(timing.pollMs)
  }
  return true
}

function formattingOptions(document: vscode.TextDocument): vscode.FormattingOptions {
  const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION, document)
  return {
    tabSize: configuration.get<number>(TAB_SIZE) ?? EDITOR_DEFAULT_TAB_SIZE,
    insertSpaces: configuration.get<boolean>(INSERT_SPACES) ?? true,
  }
}

async function formatAfterEdit(
  deps: VerifyEditorDeps,
  absolutePath: string,
  text: string,
): Promise<string | undefined> {
  // The real path the edit wrote: a link retargeted since would open another
  // file (the Codex review of PR #54). The text is compared once it opens.
  if ((await deps.realPath(absolutePath)) !== absolutePath) {
    deps.log.warn(`Format on edit skipped ${absolutePath}: its path now leads to another file`)
    return undefined
  }
  const timing = deps.format ?? FORMAT_TIMING
  const hasBom = text.startsWith(BOM)
  const expected = hasBom ? text.slice(BOM.length) : text
  const uri = vscode.Uri.file(absolutePath)
  const document = await vscode.workspace.openTextDocument(uri)
  if (!(await isCaughtUp(document, expected, timing))) {
    deps.log.info(`Format on edit skipped ${absolutePath}: the editor did not show the new text`)
    return undefined
  }
  const edits = await within(
    vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      VSCODE_COMMANDS.formatDocument,
      uri,
      formattingOptions(document),
    ),
    timing.formatMs,
  )
  if (edits === TIMED_OUT) {
    deps.log.warn(
      `Format on edit skipped ${absolutePath}: the formatter did not answer in ${String(timing.formatMs)} ms`,
    )
    return undefined
  }
  if (edits === undefined || edits.length === 0 || document.getText() !== expected) {
    return undefined
  }
  const isCrlf = document.eol === vscode.EndOfLine.CRLF
  const offsets: OffsetEdit[] = edits.map((edit) => ({
    start: document.offsetAt(edit.range.start),
    end: document.offsetAt(edit.range.end),
    newText: isCrlf ? edit.newText.replaceAll(LONE_LINE_FEED, () => CRLF) : edit.newText,
  }))
  const formatted = applyOffsetEdits(expected, offsets)
  if (formatted === undefined) {
    deps.log.warn(`Format on edit skipped ${absolutePath}: the formatter's edits overlap`)
    return undefined
  }
  return formatted === expected ? undefined : `${hasBom ? BOM : ''}${formatted}`
}

/** True once `waited` settles, false when the caller stops first. */
function reachedBeforeStop(waited: Promise<void>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void (async () => {
      await waited
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    })()
  })
}

/**
 * Once `first` settles and then `second` does, however `second` ended: the
 * queue only waits on a caller, whose own error goes to that caller.
 */
async function afterBoth(first: Promise<void>, second: Promise<unknown>): Promise<void> {
  await first
  try {
    await second
  } catch {
    // The caller that ran it receives this error; the next caller only waits.
  }
}

export function createVerifyEditor(deps: VerifyEditorDeps): VerifyEditor {
  const reportLog = logReports(deps.platform)
  // One queue for every caller: files are shown and read one batch at a time,
  // each batch starting once every one before it ended, however that ended.
  // A caller that stops while it waits leaves at once (the Codex review of
  // PR #54); the next one still waits for those ahead of it.
  let tail: Promise<void> = Promise.resolve()
  const enqueue = async <T>(
    signal: AbortSignal,
    stopped: () => T,
    work: () => Promise<T>,
  ): Promise<T> => {
    const previous = tail
    // No Promise.withResolvers here: VS Code 1.99's extension host runs Node 20.
    const turn = (async () =>
      (await reachedBeforeStop(previous, signal)) ? await work() : stopped())()
    tail = afterBoth(previous, turn)
    return await turn
  }
  return {
    diagnosticsAfterEdit: (files, signal) =>
      enqueue(
        signal,
        () => files.map((file) => ({ file, entries: [], unchecked: 'stopped' as const })),
        () => readFiles(deps, reportLog, files, signal),
      ),
    settleFile: (absolutePath, signal = NEVER_STOPPED) =>
      enqueue(signal, NOTHING_READ, () =>
        toolFileDiagnostics(deps, reportLog, absolutePath, signal),
      ),
    formatAfterEdit: (absolutePath, text) => formatAfterEdit(deps, absolutePath, text),
    dispose: () => {
      reportLog.dispose()
    },
  }
}
