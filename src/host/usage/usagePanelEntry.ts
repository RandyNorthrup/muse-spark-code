import { Usd } from '../../shared/usd'
import { setUiText } from '../../shared/l10n/text'
import { loadUsageTable, setUsageText } from '../../shared/l10n/usageTable'
import { readUsageTableFile } from '../../runtime/usage/usageTableFile'
import * as vscode from 'vscode'
import { UsagePanel, type UsagePanelDeps } from './usagePanel'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { agentDataFolder } from '../../runtime/dataFolder'
import { lazyUsageAdapter, type UsageAccessDeps } from '../../runtime/usage/usageAdapter'
import {
  SETTINGS_SECTION,
  USAGE_FOLDER,
  USAGE_HISTORY_DAYS_DEFAULT,
  TAB_DAILY_BUDGET_DEFAULT_USD,
} from '../../shared/constants'
import { createPaidDailyBudget } from '../paid/paidDailyBudget'

import { createTabLedger } from '../tab/tabLedger'

export interface UsagePanelHostDeps extends Omit<
  UsagePanelDeps,
  'usage' | 'journalFolder' | 'usageTable'
> {
  /** Tests and native composition can inject the shared service explicitly. */
  readonly service?: Pick<UsagePanelDeps, 'usage' | 'journalFolder'>
  readonly live?: UsageAccessDeps['live']
  readonly beforeRead?: UsageAccessDeps['beforeRead']
  readonly budgetStorageFolder?: string
}

export function createUsageBudget(
  deps: Parameters<typeof createPaidDailyBudget>[0] & Pick<UsagePanelDeps, 'l10n'>,
) {
  setUiText(deps.l10n.table, deps.l10n.locale)
  return createPaidDailyBudget(deps)
}

export async function createUsagePanel(deps: UsagePanelHostDeps): Promise<UsagePanel> {
  setUiText(deps.l10n.table, deps.l10n.locale)
  const table = await loadUsageTable({
    language: deps.l10n.locale,
    readTableFile: async (segments) => {
      try {
        return new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deps.extensionUri, ...segments)),
        )
      } catch {
        return await readUsageTableFile(deps.extensionUri.fsPath, segments)
      }
    },
    warn: (message) => {
      deps.log.warn(message)
    },
  })
  setUsageText(table.table)
  const dataFolder = agentDataFolder({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  })
  const service = deps.service ?? {
    usage: lazyUsageAdapter({
      dataFolder,
      packageRoot: deps.extensionUri.fsPath,
      host: hostname(),
      locale: deps.l10n.locale,
      uiText: deps.l10n.table,
      log: deps.log,
      ...(deps.beforeRead !== undefined && { beforeRead: deps.beforeRead }),
      ...(deps.live !== undefined && {
        live: {
          ...deps.live,
          readBudgets: async () => {
            const budgets = (await deps.live?.readBudgets()) ?? []
            if (deps.budgetStorageFolder === undefined) return budgets
            const result = [...budgets]
            const sources: readonly {
              folder: string
              setting: string
              fallback: number
              id: string
              kind: 'tabDaily' | 'vscodeChatDaily'
            }[] = [
              {
                folder: 'tab-spend',
                setting: 'tabDailyBudgetUsd',
                fallback: TAB_DAILY_BUDGET_DEFAULT_USD,
                id: 'tab-daily',
                kind: 'tabDaily',
              },
              {
                folder: 'editor-chat-spend',
                setting: 'editorChatDailyBudgetUsd',
                fallback: 0,
                id: 'editor-chat-daily',
                kind: 'vscodeChatDaily',
              },
            ]
            for (const source of sources) {
              const ledger = createTabLedger({
                directory: path.join(deps.budgetStorageFolder, source.folder),
                windowId: 'usage-reader',
                now: Date.now,
                sleep: () => Promise.resolve(),
                log: deps.log,
              })
              const total = await ledger.todayUsage()
              if (!total.ok) throw new Error('usageDailyLedgerUnavailable')
              const capUsd = vscode.workspace
                .getConfiguration(SETTINGS_SECTION)
                .get<number>(source.setting, source.fallback)
              const resets = new Date()
              resets.setHours(0, 0, 0, 0)
              resets.setDate(resets.getDate() + 1)
              result.push({
                budget: {
                  id: source.id,
                  kind: source.kind,
                  capUsd,
                  spentUsd: Number(total.totalUsd),
                  stopped: Usd.from(total.totalUsd).compare(Usd.from(capUsd)) >= 0,
                  resetsAt: resets.getTime(),
                  ...(total.uncertainUsd !== undefined && {
                    uncertainUsd: Number(total.uncertainUsd),
                  }),
                },
              })
            }
            return result
          },
        },
      }),
      historySettings: () => {
        const config = vscode.workspace.getConfiguration(SETTINGS_SECTION)
        return {
          enabled: config.get<boolean>('usageHistory', true),
          days: config.get<number>('usageHistoryDays', USAGE_HISTORY_DAYS_DEFAULT),
        }
      },
    }).access(),
    journalFolder: vscode.Uri.file(path.join(dataFolder, USAGE_FOLDER)),
  }
  return new UsagePanel({ ...deps, ...service, usageTable: table })
}
