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
import { TabIgnoreCache } from './tabIgnore'
import { failureForLog } from '../../core/backends/musecode/logText'
import { redactSecrets } from '../../core/redact'
import { contextWindow, orderSnippets, type TabSnippet } from '../../core/tab/tabContext'
import type { TabHookContext } from '../../core/tab/tabHooks'
import { tabRequestMaxOutputTokens, tabUserText } from '../../core/tab/tabRequest'
import {
  TAB_CONTEXT_FILES,
  TAB_CONTEXT_SNIPPET_LINES,
  TAB_UTF8_BYTES_PER_CODE_UNIT,
  VSCODE_COMMANDS,
  TAB_FILE_MAX_BYTES,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_LINES,
} from '../../shared/constants'
import {
  TAB_COMMAND_IDS,
  type TabAcceptArgs,
  type TabCompletionSnapshot,
  type TabDocumentChange,
  type TabFilesExclude,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabQuietReason,
  type TabUri,
} from './tabBundle'
import { createTabConsent, tabPriceFingerprint } from './tabConsent'
import {
  chooseTabMode,
  inferTabPartialAccept,
  isFilesExcluded,
  isTabFileEligible,
  isTabForbiddenName,
  isTabPathEligible,
  redactedHalves,
  relativeInside,
  tabAcceptArgsOf,
  tabTextChangeEvent,
  type TabFileCheckDeps,
  type TabTrackedItem,
} from './tabEligibility'
import { isTabLanguageOn, readCopilotPosture, shouldYieldToCopilot } from './tabYield'

// --- The provider ---

// What a request never sent settles: it was billed nothing.
const NOTHING_SENT = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 } as const

// The item command's title never renders (no palette entry; lane W leaves it
// out of package.json): a fixed technical word, not a table string.
const TAB_ACCEPT_COMMAND_TITLE = 'Tab accept'

/**
The document parts the provider reads. `vscode.TextDocument` satisfies it
structurally, so the registered wrapper passes the document straight
through and the integration test drives real documents.
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

/**
What one request is bound to from its start (RVM94KR 2–3): the trust, the
Tab settings (its model among them), every `files.exclude` scope it read,
the ignore files' generation and the hook policy. `isCurrent` is read again
before the question, before sending and before the answer is used.
*/
interface TabRequestPolicy {
  /** The settings the request runs with: its model and its modes come from here. */
  readonly settings: ReturnType<TabProviderDeps['settings']>
  /** A file's `files.exclude`, bound to the request on its first read. */
  readonly filesExclude: (uri: TabUri) => TabFilesExclude
  readonly isCurrent: () => boolean
}

interface TabTracked extends TabTrackedItem {
  readonly hookContext: TabHookContext
  readonly lineText: string
  readonly generationId: string
  readonly model: string
  /** The whole suggestion arrived in one change: the item's command follows (V8). */
  readonly isWholeInserted: boolean
  /** Some of it was accepted by partial accepts already. */
  readonly isPartlyAccepted: boolean
}

/**
The `InlineCompletionItemProvider` (V2, V7–V10): quiet wherever D73 says
quiet, one item otherwise. Every file the request reads passed
`isTabFileEligible`; every byte sent passed `redactSecrets`. The log gets
counts, sizes, timings and outcome classes, never code, a completion or a
path. The shim registers it (the handle's `provider`).
*/
export function createTabProvider(deps: TabProviderDeps): TabProviderHandle {
  const ignore = new TabIgnoreCache({
    runGit: deps.runGit,
    ignoreFileExists: deps.ignoreFileExists,
    workspaceRoots: deps.workspaceRoots,
    onIgnoreFilesChanged: deps.onIgnoreFilesChanged,
    log: deps.log,
  })
  // Lane L's once-per-window question, built here in the lazy bundle from
  // the deps activation handed over; the price fingerprint is the bundle's
  // own, so activation carries none of the question.
  const consent = createTabConsent({ ...deps.consentDeps, priceOf: tabPriceFingerprint })
  let generation = 0
  let request = 0
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

  const keyOf = (currentSettings: unknown, currentHookKey: string): string =>
    JSON.stringify([deps.isTrusted(), currentSettings, ignore.currentGeneration, currentHookKey])

  /** Binds a request to the policy in force; the hook part was settled by the caller. */
  function bindRequestPolicy(
    hookKey: string,
    settings: ReturnType<TabProviderDeps['settings']>,
  ): TabRequestPolicy {
    const bound = keyOf(settings, hookKey)
    // At most the current file and TAB_CONTEXT_FILES context files.
    const scopes: { readonly uri: TabUri; readonly table: string }[] = []
    return {
      settings,
      filesExclude: (uri) => {
        const table = deps.filesExclude(uri)
        if (scopes.every((scope) => scope.uri.toString() !== uri.toString())) {
          scopes.push({ uri, table: JSON.stringify(table) })
        }
        return table
      },
      isCurrent: () =>
        !isDisposed() &&
        keyOf(deps.settings(), deps.hooks?.policyKey() ?? '') === bound &&
        scopes.every((scope) => JSON.stringify(deps.filesExclude(scope.uri)) === scope.table),
    }
  }

  /** Related files pass every privacy check before opening or reading text. */
  async function contextSnippets(
    document: TabDocument,
    lineNumber: number,
    lineText: string,
    isCancelled: () => boolean,
    hookContext: TabHookContext,
    policy: TabRequestPolicy,
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
        filesExclude: policy.filesExclude(candidate.uri),
        ignore,
        rootAbs,
        hasSibling: (sibling) => deps.ignoreFileExists(path.join(rootAbs, ...sibling.split('/'))),
        hooks: deps.hooks,
        hookContext,
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
          isFilesExcluded(relativePath, policy.filesExclude(candidate.uri), checks.hasSibling)
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
    // The request binds to the policy in force now, the hook configuration
    // settled first (RVM94KR 2–3). A hook file that did not load whole
    // refuses every read until it is fixed (RVM94KR 1).
    const settings = deps.settings()
    // Read through a call: the token's readonly getter can change across awaits.
    const isCancelled = (): boolean => token.isCancellationRequested || isDisposed()
    const hookPolicy = await deps.hooks?.bindPolicy()
    if (isDisposed()) {
      return []
    }
    if (hookPolicy?.isConfigurationInvalid === true) {
      return quiet('hooks-invalid')
    }
    // A change was detected and its reload has not published: nothing is
    // read under a policy that is already out of date (RVM94KR2 3).
    if (hookPolicy?.isReloading === true) {
      return quiet('policy-changed')
    }
    const policy = bindRequestPolicy(hookPolicy?.key ?? '', settings)
    if (!policy.isCurrent()) return quiet('policy-changed')
    // Everything the request reads, asks and sends names this one model.
    const model = settings.tabModel
    // M94 goal (D121): the mode's output cap is the person's setting when
    // they set one, else the provider's maximum for the model from its
    // capability record. The request and its worst-case reservation below
    // both use this one number.
    const maxOutputTokens = tabRequestMaxOutputTokens(
      settings.tabMaxOutputTokens,
      deps.recordMaxOutputTokens(model),
    )
    request += 1
    const hookContext: TabHookContext = {
      workspaceRoots: deps.workspaceRoots(document.uri.fsPath),
      model,
      generationId: `request-${String(request)}`,
    }
    const checks: TabFileCheckDeps = {
      filesExclude: policy.filesExclude(document.uri),
      ignore,
      rootAbs,
      hasSibling: (sibling) => deps.ignoreFileExists(path.join(rootAbs, ...sibling.split('/'))),
      hooks: deps.hooks,
      hookContext,
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
      // A path that cannot be resolved has no verified location: ineligible.
      targetRelative = undefined
    }
    if (!policy.isCurrent()) return quiet('policy-changed')
    // Nothing of the text is read before its path passed (RVM94HU 17).
    if (
      targetRelative === undefined ||
      isTabForbiddenName(targetRelative) ||
      !(await isTabPathEligible(relativePath, checks))
    ) {
      return quiet('ineligible-file')
    }
    if (!policy.isCurrent()) return quiet('policy-changed')
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
    // A guard, a setting or the model changed under the read: nothing is asked.
    if (!policy.isCurrent()) {
      return quiet('policy-changed')
    }
    // The D48 question (Q-M94a, lane L) for the request's own model and
    // price: Deny sends nothing. The shim snoozes the window on
    // `consent-denied`. The grant is bound to its key and read again at
    // every later check, the send's included (RVM94KR2 1–2).
    const grant = await consent.requestUse(model)
    if (isCancelled()) return quiet('cancelled-before-send')
    if (grant === undefined) {
      return quiet('consent-denied')
    }
    // Consent for a model the settings no longer name is never used (RVM94KR 3).
    if (!policy.isCurrent() || !grant.isCurrent()) {
      return quiet('policy-changed')
    }
    const line = document.lineAt(position.line).text
    const mode = chooseTabMode(
      line.slice(0, position.character),
      line.slice(position.character),
      settings.tabMultiline,
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
    const { prefix, suffix } = contextWindow(
      halves.before + halves.after,
      halves.before.length,
      mode,
    )
    const snippets =
      mode === 'multiline'
        ? await contextSnippets(
            document,
            position.line,
            line,
            () => isCancelled() || !policy.isCurrent() || !grant.isCurrent(),
            hookContext,
            policy,
          )
        : ''
    if (isCancelled()) return quiet('cancelled-before-send')
    if (!policy.isCurrent() || !grant.isCurrent()) return quiet('policy-changed')
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
      maxOutputTokens,
    })
    if (reservation === undefined) {
      return quiet('budget')
    }
    // Everything checked before the waits is checked again: a snooze, the
    // setting, the key, trust, the folders, the language, Copilot, the
    // ignore files or the bound policy may have changed meanwhile (RVM94HU
    // 2, RVM94KR 2). Nothing was sent, so the reservation is released.
    const sendBlocker = (): TabQuietReason | undefined =>
      stateQuietReason(document, rootAbs, isInvoke) ??
      (ignore.currentGeneration === ignoreGeneration ? undefined : 'ineligible-file') ??
      (policy.isCurrent() && grant.isCurrent() ? undefined : 'policy-changed')
    const lateReason = isDisposed() ? 'cancelled-before-send' : sendBlocker()
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
      maxOutputTokens,
      isInvoke,
      cursorLineBefore: line.slice(0, position.character),
      lineAbove: lines[position.line - 1] ?? '',
      linesBelow: lines.slice(position.line + 1, position.line + 1 + TAB_MULTILINE_MAX_LINES),
      // Read when the engine's debounce ends the wait, and last
      // synchronously inside the client's send path, after its credential,
      // pacing and admission waits: a keystroke since, a disposed provider,
      // or any change the late check refuses, the bound policy and consent
      // included, sends nothing (RVM94HU 3, RVM94KR 2, RVM94KR2 4).
      isCancelled: () =>
        token.isCancellationRequested || isDisposed() || sendBlocker() !== undefined,
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
    } catch (error: unknown) {
      // No usage was reported, so the reservation stands (M82); the log gets
      // the class and the closed-vocabulary cause, never a path.
      if (!isDisposed()) {
        deps.onOutcome({ kind: 'failed', failure: 'request' })
      }
      deps.log.warn('Tab request failed (request)')
      deps.log.trace(`Tab request failure: ${failureForLog(error)}`)
      return []
    }
    // An answer reached under a policy that has since moved is not shown.
    if (!policy.isCurrent() || !grant.isCurrent()) {
      return quiet('policy-changed')
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
      hookContext,
      lineText: line,
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
      generationId: at.hookContext.generationId,
      model: at.model,
      workspaceRoots: at.hookContext.workspaceRoots,
      oldLine: at.lineText,
      newLine:
        (at.lineText.slice(0, at.character) + newString + at.lineText.slice(at.character)).split(
          '\n',
          1,
        )[0] ?? '',
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
    emitEdit(accepted, accepted.isPartlyAccepted ? accepted.rest : args.completion, false)
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
    const editedLines = (
      tracked.lineText.slice(0, tracked.character) +
      change.insertedText +
      tracked.lineText.slice(tracked.character)
    ).split('\n')
    tracked =
      rest === ''
        ? undefined
        : { ...tracked, ...next, rest, lineText: editedLines.at(-1) ?? '', isPartlyAccepted: true }
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
    for (const change of tabTextChangeEvent(event).changes) {
      onTextChanged(change)
    }
  })

  return {
    provider,
    dispose: () => {
      lifecycle.isDisposed = true
      textWatcher.dispose()
      ignore.dispose()
      deps.hooks?.dispose?.()
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
