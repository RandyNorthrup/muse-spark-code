import { setUiText } from '../../shared/l10n/text'
import { loadUsageTable, setUsageText } from '../../shared/l10n/usageTable'
import * as vscode from 'vscode'
import { UsagePanel, type UsagePanelDeps } from './usagePanel'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { agentDataFolder } from '../../runtime/dataFolder'
import { lazyUsageAdapter } from '../../runtime/usage/usageAdapter'
import { SETTINGS_SECTION, USAGE_FOLDER, USAGE_HISTORY_DAYS_DEFAULT } from '../../shared/constants'

export interface UsagePanelHostDeps extends Omit<
  UsagePanelDeps,
  'usage' | 'journalFolder' | 'usageTable'
> {
  /** Tests and native composition can inject the shared service explicitly. */
  readonly service?: Pick<UsagePanelDeps, 'usage' | 'journalFolder'>
}

export async function createUsagePanel(deps: UsagePanelHostDeps): Promise<UsagePanel> {
  setUiText(deps.l10n.table, deps.l10n.locale)
  const table = await loadUsageTable({
    language: deps.l10n.locale,
    readTableFile: async (segments) =>
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deps.extensionUri, ...segments)),
      ),
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
