// Tab in the language server (M104 lane H, PLAN.md D73, D84): one editor's
// requests through RLF-TAB's single copy of Tab — its eligibility and
// ignore checks, the workspace's Tab hooks (`beforeTabFileRead` on every
// read, `afterTabFileEdit` on every accept), the keyed consent, the cross-
// window ledger's spend gate and the engine. The output cap is the
// person's `--tab-max-output-tokens` when set, else the model's record
// maximum. Every byte sent passed `redactSecrets`; the log gets reasons,
// counts and timings, never code, a completion or a path.
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { failureForLog } from '../../core/backends/musecode/logText'
import { redactSecrets } from '../../core/redact'
import { contextWindow } from '../../core/tab/tabContext'
import type { TabHookContext } from '../../core/tab/tabHooks'
import { tabRequestMaxOutputTokens, tabUserText } from '../../core/tab/tabRequest'
import type { Logger } from '../../host/logger'
import type { TabUseConsent } from '../../host/tab/tabConsent'
import {
  chooseTabMode,
  isTabFileEligible,
  isTabForbiddenName,
  isTabPathEligible,
  redactedHalves,
  relativeInside,
  tabAcceptArgsOf,
  type TabFileCheckDeps,
} from '../../host/tab/tabEligibility'
import type { TabIgnoreCache } from '../../host/tab/tabIgnore'
import { isTabLanguageOn } from '../../host/tab/tabYield'
import type {
  TabAcceptArgs,
  TabEngineServices,
  TabHookBridge,
  TabQuietReason,
} from '../../host/tab/tabContract'
import {
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_LINES,
  type TabMultiline,
  type TabTrigger,
} from '../../shared/constants'
import { documentOffset, type LspDocument } from './documents'
import type { Position } from './protocol'
import type { LspSuggestion } from './server'

/** The server's Tab settings, fixed for its run (its flags and the product's defaults). */
export interface LspTabSettings {
  readonly tabModel: string
  /** 0 is the model's record maximum (D121). */
  readonly tabMaxOutputTokens: number
  readonly tabLanguages: Readonly<Record<string, boolean>>
  readonly tabMultiline: TabMultiline
  readonly tabTrigger: TabTrigger
}

export interface LspTabDeps extends TabEngineServices {
  /** The workspace root, links resolved. */
  readonly workspace: string
  readonly settings: LspTabSettings
  /** `--tab`: the paid feature on. */
  readonly isPaidOn: () => boolean
  /** `--trust-workspace`. */
  readonly isTrusted: boolean
  /** The stored key's presence, read from the store only when a request would otherwise ask. */
  readonly isKeyStored: () => Promise<boolean>
  /** The provider's maximum output tokens for the model, from its capability record. */
  readonly recordMaxOutputTokens: (model: string) => number
  readonly consent: TabUseConsent
  readonly hooks: TabHookBridge | undefined
  /** Re-reads the hook files before a request binds to them. */
  readonly reloadHooks: () => Promise<void>
  /** A fresh ignore cache for one request. */
  readonly createIgnore: () => TabIgnoreCache
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Resolves links; rejects when it cannot. */
  readonly realPath: (absolutePath: string) => Promise<string>
  readonly log: Logger
}

/** A request never sent settles at zero: nothing was billed. */
const NOTHING_SENT = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 } as const

/** A request that sends nothing, with the reason the log names. */
interface Quiet {
  readonly quiet: TabQuietReason
}

function quiet(reason: TabQuietReason): Quiet {
  return { quiet: reason }
}

/** The served suggestion, kept until its accept command or the next suggestion. */
interface TrackedSuggestion extends TabAcceptArgs {
  readonly context: TabHookContext
  readonly lineText: string
}

/** One request's fixed facts, read before anything of the file's text. */
interface RequestScope {
  readonly document: LspDocument
  readonly absolutePath: string
  readonly relativePath: string
  readonly context: TabHookContext
  readonly checks: TabFileCheckDeps
  readonly isPolicyCurrent: () => boolean
}

export function createLspTab(deps: LspTabDeps) {
  let requests = 0
  let suggestions = 0
  let isSnoozed = false
  let isDisposed = false
  let isKeyFound = false
  let tracked: TrackedSuggestion | undefined

  /** The cheap checks, run first and again before the send. */
  function stateReason(document: LspDocument, isInvoke: boolean): TabQuietReason | undefined {
    if (!isInvoke && deps.settings.tabTrigger !== 'automatic') return 'trigger-setting'
    if (isSnoozed) return 'snoozed'
    if (!deps.isPaidOn()) return 'paid-off'
    if (!deps.isTrusted) return 'untrusted'
    return isTabLanguageOn(deps.settings.tabLanguages, document.languageId)
      ? undefined
      : 'language-off'
  }

  /** The path's checks and the hook policy the request binds to (RVM94KR 2-3). */
  async function scopeOf(
    document: LspDocument,
    isInvoke: boolean,
    ignore: TabIgnoreCache,
  ): Promise<RequestScope | Quiet> {
    if (document.path === undefined) return quiet('scheme')
    const absolutePath = document.path
    const relativePath = relativeInside(deps.workspace, absolutePath)
    if (relativePath === undefined) return quiet('outside-workspace')
    const early = stateReason(document, isInvoke)
    if (early !== undefined) return quiet(early)
    // A hook file edited since the last request applies to this one.
    if (deps.hooks !== undefined) await deps.reloadHooks()
    const hookPolicy = await deps.hooks?.bindPolicy()
    if (hookPolicy?.isConfigurationInvalid === true) return quiet('hooks-invalid')
    if (hookPolicy?.isReloading === true) return quiet('policy-changed')
    const generation = ignore.currentGeneration
    requests += 1
    const context: TabHookContext = {
      workspaceRoots: [deps.workspace],
      model: deps.settings.tabModel,
      generationId: `request-${String(requests)}`,
    }
    return {
      document,
      absolutePath,
      relativePath,
      context,
      checks: {
        filesExclude: {},
        ignore,
        rootAbs: deps.workspace,
        hasSibling: (sibling) =>
          deps.ignoreFileExists(path.join(deps.workspace, ...sibling.split('/'))),
        hooks: deps.hooks,
        hookContext: context,
      },
      isPolicyCurrent: () =>
        !isDisposed &&
        ignore.currentGeneration === generation &&
        (deps.hooks?.policyKey() ?? '') === (hookPolicy?.key ?? ''),
    }
  }

  /**
  Links resolved, the file stays inside the workspace and is neither
  private nor protected (RVM94HU 12); nothing of its text is read before
  its path passed. Then the text itself, through `beforeTabFileRead`.
  */
  async function isEligible(scope: RequestScope): Promise<boolean> {
    let target: string | undefined
    try {
      const [realRoot, realFile] = await Promise.all([
        deps.realPath(deps.workspace),
        deps.realPath(scope.absolutePath),
      ])
      target = relativeInside(realRoot, realFile)
    } catch (error: unknown) {
      // A path that cannot be resolved has no verified location.
      deps.log.trace(`Tab path unresolved: ${failureForLog(error)}`)
      return false
    }
    if (
      target === undefined ||
      isTabForbiddenName(target) ||
      !(await isTabPathEligible(scope.relativePath, scope.checks))
    )
      return false
    return await isTabFileEligible(
      {
        absolutePath: scope.absolutePath,
        relativePath: scope.relativePath,
        sizeBytes: Buffer.byteLength(scope.document.text, 'utf8'),
        content: scope.document.text,
      },
      scope.checks,
    )
  }

  async function suggest(
    scope: RequestScope,
    position: Position,
    isInvoke: boolean,
    signal: AbortSignal,
  ): Promise<LspSuggestion | Quiet> {
    const { document } = scope
    if (!(await isEligible(scope))) return quiet('ineligible-file')
    if (!scope.isPolicyCurrent()) return quiet('policy-changed')
    // The store is read only now: an ineligible file never reads it. A key
    // once found stays found; an absent one is read again next time.
    isKeyFound ||= await deps.isKeyStored()
    if (!isKeyFound) return quiet('no-key')
    const model = scope.context.model
    // Read through a call: the signal's readonly flag moves across awaits.
    const isAborted = (): boolean => signal.aborted
    // D48's question for this model and price; Deny snoozes this connection.
    const grant = await deps.consent.requestUse(model)
    if (isAborted()) return quiet('cancelled-before-send')
    if (grant === undefined) {
      isSnoozed = true
      return quiet('consent-denied')
    }
    const isCurrent = () => scope.isPolicyCurrent() && grant.isCurrent()
    if (!isCurrent()) return quiet('policy-changed')
    const lines = document.text.split('\n')
    const lineText = lines[position.line] ?? ''
    const mode = chooseTabMode(
      lineText.slice(0, position.character),
      lineText.slice(position.character),
      deps.settings.tabMultiline,
      isInvoke,
    )
    const halves = redactedHalves(document.text, documentOffset(document.text, position))
    if (halves === undefined) return quiet('secret-at-cursor')
    const { prefix, suffix } = contextWindow(
      halves.before + halves.after,
      halves.before.length,
      mode,
    )
    // The person's cap when they set one, else the model's record maximum
    // (M94 goal, D121): the request and its worst-case reservation share it.
    const maxOutputTokens = tabRequestMaxOutputTokens(
      deps.settings.tabMaxOutputTokens,
      deps.recordMaxOutputTokens(model),
    )
    const redactedPath = redactSecrets(scope.relativePath)
    const userText = tabUserText({
      path: redactedPath,
      languageId: document.languageId,
      prefix,
      suffix,
      snippets: '',
    })
    const reservation = await deps.spend.reserve({
      model,
      inputBytes: Buffer.byteLength(TAB_MODEL_TEXT.tabSystem + userText, 'utf8'),
      maxOutputTokens,
    })
    if (reservation === undefined) return quiet('budget')
    const blocker = (): TabQuietReason | undefined =>
      stateReason(document, isInvoke) ?? (isCurrent() ? undefined : 'policy-changed')
    const late = isAborted() ? 'cancelled-before-send' : blocker()
    if (late !== undefined) {
      deps.spend.settle(reservation, NOTHING_SENT)
      return quiet(late)
    }
    const answer = await deps.engine.complete({
      model,
      absolutePath: scope.absolutePath,
      relativePath: redactedPath,
      languageId: document.languageId,
      prefix,
      suffix,
      snippets: '',
      mode,
      maxOutputTokens,
      isInvoke,
      cursorLineBefore: lineText.slice(0, position.character),
      lineAbove: lines[position.line - 1] ?? '',
      linesBelow: lines.slice(position.line + 1, position.line + 1 + TAB_MULTILINE_MAX_LINES),
      // Read when the debounce ends and last at the HTTP send (RVM94KR2 4).
      isCancelled: () => isAborted() || blocker() !== undefined,
    })
    // Reported usage replaces the reservation when the request ends; one
    // that reports none keeps it (M82).
    void answer.usage
      .then((usage) => {
        deps.spend.settle(reservation, usage)
      })
      .catch((error: unknown) => {
        deps.log.warn(
          `Tab request reported no usage; its reservation stands: ${failureForLog(error)}`,
        )
      })
    if (!isCurrent()) return quiet('policy-changed')
    if (answer.completion === undefined) return quiet('no-suggestion')
    // A sent request runs to its end; only the suggestion is dropped.
    if (isAborted()) return quiet('cancelled-before-send')
    suggestions += 1
    const accept: TabAcceptArgs = {
      filePath: scope.absolutePath,
      generationId: `suggestion-${String(suggestions)}`,
      model,
      positionLine: position.line,
      positionCharacter: position.character,
      completion: answer.completion,
    }
    tracked = { ...accept, context: scope.context, lineText }
    deps.log.info(
      `Tab suggestion served (${mode}, ${String(prefix.length + suffix.length)} window bytes)`,
    )
    return { text: answer.completion, accept }
  }

  return {
    complete: async (
      document: LspDocument,
      position: Position,
      isInvoke: boolean,
      signal: AbortSignal,
    ): Promise<LspSuggestion | undefined> => {
      const ignore = deps.createIgnore()
      try {
        const scope = await scopeOf(document, isInvoke, ignore)
        const outcome = 'quiet' in scope ? scope : await suggest(scope, position, isInvoke, signal)
        if (!('quiet' in outcome)) return outcome
        deps.log.trace(`Tab quiet (${outcome.quiet})`)
        return undefined
      } catch (error: unknown) {
        // A failed request reported no usage, so its reservation stands (M82).
        deps.log.warn(`Tab request failed: ${failureForLog(error)}`)
        return undefined
      } finally {
        ignore.dispose()
      }
    },
    /** The suggestion's accept command: the accept hook observes the whole suggestion. */
    accepted: (raw: unknown): void => {
      const args = tabAcceptArgsOf(raw)
      const at = tracked
      if (at === undefined || args?.generationId !== at.generationId) return
      tracked = undefined
      const line = at.positionLine + 1
      const column = at.positionCharacter + 1
      const edited =
        at.lineText.slice(0, at.positionCharacter) +
        at.completion +
        at.lineText.slice(at.positionCharacter)
      deps.hooks?.afterEdit({
        filePath: at.filePath,
        generationId: at.context.generationId,
        model: at.model,
        workspaceRoots: at.context.workspaceRoots,
        oldLine: at.lineText,
        newLine: edited.split('\n', 1)[0] ?? '',
        range: {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        },
        oldString: '',
        newString: at.completion,
        inferred: false,
      })
    },
    dispose: (): void => {
      isDisposed = true
      deps.hooks?.dispose?.()
    },
  }
}
