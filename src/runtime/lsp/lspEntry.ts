// dist/lsp.js (M104 lane H, PLAN.md D84): `muse-spark-code-acp lsp`, a
// language server on standard I/O that serves Tab to LSP editors (Neovim,
// Helix, Emacs, Sublime, Kate, Zed and the rest) through LSP 3.18's inline
// completions, the completion list and `muse.tabInvoke`. Loaded only by
// `lsp`. Without `--tab` it never reads the credential store and never
// loads the key client; with it, the store is read only when an eligible
// request would ask, and the key client only when one sends.
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { ModelApiClient } from '../../core/backends/modelapi/client'
import { canonicalPath } from '../../host/canonicalPath'
import type { ExtensionHookRunner } from '../../host/extensionHooksEntry'
import type { Logger } from '../../host/logger'
import { createTabHookBridge } from '../../host/tab/tabHookBridge'
import { TabIgnoreCache } from '../../host/tab/tabIgnore'
import { hasIgnoreFile } from '../../host/tab/tabIgnoreFile'
import { createTabServices } from '../../host/tab/tabServices'
import { TAB_LEDGER_DIR } from '../../host/tab/tabContract'
import {
  ACP_AGENT_NAME,
  LSP_MESSAGE_TYPE,
  LSP_TAB_CONSENT_FOLDER,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { isPositiveUsd } from '../../shared/usd'
import { fill, plural, setUiText } from '../../shared/l10n/text'
import type { LspOptions } from '../cliArgs'
import { workspaceKey } from '../dataFolder'
import { paidGrantFile } from '../paidGrants'
import { createLspTabConsent } from './lspConsent'
import { createLspTab } from './lspTab'
import { serveLsp, type LspEditor } from './server'

export interface LspRuntimeDeps {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly table: UiText
  readonly locale: string
  readonly log: Logger
  /** The agent's data folder: Tab's ledger and Always records live there. */
  readonly dataFolder: string
  /** Every workspace's paid grants, shared with the ACP agent (runtime/paidGrants.ts). */
  readonly grantsFile: string
  /** Whether a Model API key is stored: a store read, made only with `--tab`. */
  readonly isKeyStored: () => Promise<boolean>
  /** The stored key's client, loaded on the first request that needs it (only with `--tab`). */
  readonly keyClient: () => Pick<ModelApiClient, 'streamResponse' | 'recordMaxOutputTokens'>
  /** The workspace's extension hook runner, loaded on the first request a hook may guard. */
  readonly hookRunner: () => Promise<ExtensionHookRunner | undefined>
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** `muse.stop`: every supervised run in the workspace (dist/supervise.js). */
  readonly stopWorkspace: (workspace: string) => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Serves one editor until it exits; resolves with the process's exit code. */
export async function runLsp(options: LspOptions, deps: LspRuntimeDeps): Promise<number> {
  setUiText(deps.table, deps.locale)
  const { log } = deps
  const workspace = await realpath(options.workspace)
  const grants = paidGrantFile({ file: deps.grantsFile, log, sleep })
  if (!options.isTabOn) {
    // As in the ACP agent: a paid feature started without its flag loses
    // Always in every folder, so turning it on again asks again.
    try {
      await grants.forget(['tab'])
    } catch (error: unknown) {
      log.warn(`Tab grants could not be forgotten: ${failureForLog(error)}`)
    }
  }
  const stop = new AbortController()
  const onSignal = () => {
    stop.abort()
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  try {
    return await serveLsp(
      deps.stdin,
      deps.stdout,
      (editor: LspEditor) => {
        const services = createTabServices({
          stream: (body, signal, budget, admit) =>
            deps.keyClient().streamResponse(body, signal, undefined, budget, admit),
          ledgerDirectory: path.join(deps.dataFolder, TAB_LEDGER_DIR),
          windowId: randomUUID(),
          budgetUsd: () => options.tabBudgetUsd,
          onSent: () => {
            log.trace('Tab request sent')
          },
          onUsage: (_model, usage) => {
            log.trace(
              `Tab usage: ${String(usage.inputTokens)} in, ${String(usage.outputTokens)} out`,
            )
          },
          onTotalChanged: () => {
            // `muse.usage` reads the ledger when asked; nothing redraws.
          },
          onBudgetReached: (spent, budget) => {
            editor.notify(
              LSP_MESSAGE_TYPE.warning,
              fill(UI_TEXT.languageServer.budgetReached, {
                spent: formatUsd(spent),
                budget: formatUsd(budget),
              }),
            )
          },
          log,
        })
        const hooks = options.isTrusted
          ? createTabHookBridge(
              { isHooksEnabled: () => options.isTrusted, load: deps.hookRunner },
              () => options.isTrusted,
              log,
            )
          : undefined
        const consent = createLspTabConsent({
          workspace,
          isOn: () => options.isTabOn,
          canRemember: options.isTrusted,
          grants,
          alwaysFile: path.join(
            deps.dataFolder,
            LSP_TAB_CONSENT_FOLDER,
            `${workspaceKey(workspace)}.json`,
          ),
          budgetUsd: options.tabBudgetUsd,
          ask: (message, actions) => editor.ask(message, actions),
          notify: (text) => {
            editor.notify(LSP_MESSAGE_TYPE.warning, text)
          },
          log,
        })
        const tab = createLspTab({
          ...services,
          workspace,
          settings: {
            tabModel: options.tabModel,
            tabMaxOutputTokens: options.tabMaxOutputTokens,
            tabLanguages: SETTING_DEFAULTS.tabLanguages,
            tabMultiline: SETTING_DEFAULTS.tabMultiline,
            tabTrigger: options.tabTrigger,
          },
          isPaidOn: () => options.isTabOn,
          isTrusted: options.isTrusted,
          isKeyStored: deps.isKeyStored,
          recordMaxOutputTokens: (model) => deps.keyClient().recordMaxOutputTokens(model),
          consent,
          hooks,
          // A hook file edited since the last request applies to the next one.
          reloadHooks: async () => {
            if (!options.isTrusted) return
            const runner = await deps.hookRunner()
            await runner?.reload()
          },
          // One cache per request: an ignore file changed between requests
          // is always read again, with no watcher to keep.
          createIgnore: () =>
            new TabIgnoreCache({
              runGit: deps.runGit,
              ignoreFileExists: hasIgnoreFile,
              workspaceRoots: () => [workspace],
              onIgnoreFilesChanged: () => ({
                dispose: () => {
                  // Each cache lives for one request: there is no watcher to release.
                },
              }),
              log,
            }),
          ignoreFileExists: hasIgnoreFile,
          realPath: canonicalPath,
          log,
        })
        return {
          label: UI_TEXT.paidTabName,
          complete: tab.complete,
          accepted: tab.accepted,
          usage: () => {
            const totalUsd = services.spend.todayTotalUsd()
            const requests = services.spend.todayRequests()
            return {
              text: [
                UI_TEXT.paidTabName,
                plural(UI_TEXT.usagePaidTabRequests, requests),
                fill(UI_TEXT.usagePaidTabCostToday, { cost: formatUsd(totalUsd) }),
                isPositiveUsd(options.tabBudgetUsd)
                  ? fill(UI_TEXT.usagePaidTabBudget, { budget: formatUsd(options.tabBudgetUsd) })
                  : UI_TEXT.usagePaidTabBudgetNone,
              ].join('\n'),
              report: {
                isOn: options.isTabOn,
                model: options.tabModel,
                todayUsd: totalUsd,
                todayRequests: requests,
                budgetUsd: options.tabBudgetUsd,
              },
            }
          },
          help: () => fill(UI_TEXT.languageServer.help, { command: ACP_AGENT_NAME }),
          stop: () => deps.stopWorkspace(workspace),
          dispose: tab.dispose,
        }
      },
      log,
      stop.signal,
    )
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    // The connection ended: its input holds the process no longer.
    deps.stdin.destroy()
  }
}
