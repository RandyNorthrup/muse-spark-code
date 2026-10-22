// M104L adapts dirty LSP documents to M94's engine and cross-window ledger.
import type { UsdAmount } from '../shared/usdSchema'
import { realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { TabHookBridge } from '../core/tab/tabEligibility'
import type { Logger } from '../host/logger'
import { contextWindow, cursorLine, selectMode } from '../core/tab/tabContext'
import { TabIgnoreCache, isTabFileEligible, isTabForbiddenName } from '../core/tab/tabEligibility'
import { createTabEngine, type TabStream } from '../core/tab/tabEngine'
import { tabUserText } from '../core/tab/tabRequest'
import { redactSecrets } from '../core/redact'
import { createTabLedger } from '../host/tab/tabLedger'
import { createTabSpendGate } from '../host/tab/tabSpendGate'
import {
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
  TAB_MODEL_TEXT,
  SETTING_DEFAULTS,
} from '../shared/constants'
import type { PaidFeatureGate, PaidUsage } from '../core/paid/paidFeatures'
import type { LspDocument } from './lsp/documents'
import { documentOffset } from './lsp/documents'
import type { Position } from './lsp/protocol'
import type { LspTransport } from './lsp/transport'

export interface RuntimeTabDeps {
  readonly workspace: string
  readonly ledgerDirectory: string
  readonly instance: string
  readonly log: Logger
  readonly model: string
  readonly budgetUsd: UsdAmount
  readonly trusted: boolean
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  readonly stream: TabStream
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly consent: (client: LspTransport) => Promise<boolean>
  readonly hooks?: TabHookBridge
}

export function runtimeTab(deps: RuntimeTabDeps) {
  const ledger = createTabLedger({
    directory: deps.ledgerDirectory,
    windowId: deps.instance,
    now: Date.now,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    log: deps.log,
  })
  const spend = createTabSpendGate({
    ledger,
    budgetUsd: () => deps.budgetUsd,
    now: Date.now,
    onTotalChanged: () => {
      /* Usage is sampled by the LSP usage command. */
    },
    log: deps.log,
  })
  const engine = createTabEngine({
    stream: deps.stream,
    onSent: () => {
      deps.usage.addTabRequest()
    },
    onUsage: (model, usage) => {
      deps.usage.addTabUsage(model, usage)
    },
  })
  // A per-trigger cache avoids retaining stale ignore decisions without a watcher.
  const ignore = () =>
    new TabIgnoreCache({
      runGit: deps.runGit,
      ignoreFileExists: existsSync,
      workspaceRoots: () => [deps.workspace],
      onIgnoreFilesChanged: () => ({
        dispose() {
          /* One fresh cache per eligibility check; no watcher to release. */
        },
      }),
      trace: (message) => {
        deps.log.trace(message)
      },
    })
  async function isEligible(document: LspDocument): Promise<boolean> {
    const relative = path.relative(deps.workspace, document.path).split(path.sep).join('/')
    let target: string
    try {
      const [root, file] = await Promise.all([realpath(deps.workspace), realpath(document.path)])
      target = path.relative(root, file).split(path.sep).join('/')
    } catch {
      return false
    }
    if (target.startsWith('..') || path.isAbsolute(target) || isTabForbiddenName(target))
      return false
    const checks = ignore()
    try {
      return await isTabFileEligible(
        {
          absolutePath: document.path,
          relativePath: relative,
          sizeBytes: Buffer.byteLength(document.text),
          content: document.text,
        },
        { rootAbs: deps.workspace, filesExclude: {}, ignore: checks, hooks: deps.hooks },
      )
    } finally {
      checks.dispose()
    }
  }
  return {
    complete: async (
      document: LspDocument,
      position: Position,
      isInvoke: boolean,
      signal: AbortSignal,
      client: LspTransport,
    ): Promise<string | undefined> => {
      const isCancelled = () => signal.aborted || !deps.gate.isOn('tab')
      if (!isInvoke || !deps.trusted || isCancelled()) return undefined
      const languages: Readonly<Record<string, boolean>> = SETTING_DEFAULTS.tabLanguages
      if (
        (languages[document.languageId] ?? languages['*']) !== true ||
        !(await isEligible(document))
      )
        return undefined
      if (!(await deps.consent(client)) || isCancelled()) return undefined
      const offset = documentOffset(document.text, position)
      const before = redactSecrets(document.text.slice(0, offset))
      const after = redactSecrets(document.text.slice(offset))
      if (redactSecrets(document.text) !== before + after) return undefined
      const line = cursorLine(before + after, before.length)
      const mode = selectMode({
        trigger: 'onInvoke',
        multiline: SETTING_DEFAULTS.tabMultiline,
        blankLine: line.isBlank,
        blockOpener:
          line.after.trim() === '' &&
          new Set(['{', '(', '[', ':']).has(line.before.trimEnd().at(-1) ?? ''),
      })
      const window = contextWindow(before + after, before.length, mode)
      const relativePath = redactSecrets(
        path.relative(deps.workspace, document.path).split(path.sep).join('/'),
      )
      const sent =
        TAB_MODEL_TEXT.tabSystem +
        tabUserText({
          path: relativePath,
          languageId: document.languageId,
          prefix: window.prefix,
          suffix: window.suffix,
          snippets: '',
        })
      const reservation = await spend.reserve({
        model: deps.model,
        inputBytes: Buffer.byteLength(sent),
        maxOutputTokens:
          mode === 'fast' ? TAB_FAST_MAX_OUTPUT_TOKENS : TAB_MULTILINE_MAX_OUTPUT_TOKENS,
      })
      if (reservation === undefined) return undefined
      if (isCancelled() || !(await isEligible(document))) {
        spend.settle(reservation, { inputTokens: 0, outputTokens: 0, cachedTokens: 0 })
        return undefined
      }
      const precedingLines = before.split('\n').slice(0, -1)
      const answer = await engine.complete({
        model: deps.model,
        absolutePath: document.path,
        relativePath,
        languageId: document.languageId,
        prefix: window.prefix,
        suffix: window.suffix,
        snippets: '',
        mode,
        isInvoke,
        cursorLineBefore: line.before,
        lineAbove: precedingLines.at(-1) ?? '',
        linesBelow: after.split('\n').slice(1),
        isCancelled: () => isCancelled(),
      })
      void answer.usage
        .then((usage) => {
          spend.settle(reservation, usage)
        })
        .catch(() => {
          deps.log.warn('Tab usage missing; reservation retained')
        })
      return isCancelled() ? undefined : answer.completion
    },
    usage: () => ({
      paid: true,
      tally: deps.usage.current,
      totalUsd: spend.todayTotalUsd(),
      budgetUsd: deps.budgetUsd,
    }),
  }
}
