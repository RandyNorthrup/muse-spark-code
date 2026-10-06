// Tab's shipped CommonJS bundle (M94, PLAN.md D6): the engine and the
// ledger's spend gate, the provider and the
// menu commands. esbuild builds this file into dist/tab.js, which `tabLoader`
// requires on the first Tab request, so none of it is in the bundle VS Code
// loads at activation. `vscode` is the host's external module. Every entry
// installs the caller's display table before use (PLAN.md D33): the bundle
// keeps its own installed-language state beside the activation's.

import { createTabEngine } from '../../core/tab/tabEngine'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type TabBundleTable,
  type TabLanguagesCommandDeps,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabServices,
  type TabServicesDeps,
  type TabSnooze,
  type TabStatusDeps,
} from './tabBundle'
import { createTabLedger } from './tabLedger'
import { createTabProvider as createProvider } from './tabProvider'
import { createTabSpendGate } from './tabSpendGate'
import {
  showTabMenu as showMenu,
  snoozeTabCommand as runSnoozeCommand,
  tabLanguagesCommand as runLanguagesCommand,
} from './tabStatus'

function now(): number {
  return Date.now()
}

/** The engine (lane C) over the key client, and the spend gate over this window's ledger (lane L). */
export function createTabServices(deps: TabServicesDeps): TabServices {
  const ledger = createTabLedger({
    directory: deps.ledgerDirectory,
    windowId: deps.windowId,
    now,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    log: deps.log,
  })
  return {
    engine: createTabEngine({
      stream: deps.stream,
      onSent: deps.onSent,
      onUsage: deps.onUsage,
      now,
    }),
    spend: createTabSpendGate({
      ledger,
      budgetUsd: deps.budgetUsd,
      now,
      onTotalChanged: deps.onTotalChanged,
      log: deps.log,
    }),
  }
}

export function createTabProvider(deps: TabProviderDeps & TabBundleTable): TabProviderHandle {
  setUiText(deps.uiTable, deps.locale)
  return createProvider(deps)
}

export async function showTabMenu(deps: TabStatusDeps & TabBundleTable): Promise<void> {
  setUiText(deps.uiTable, deps.locale)
  await showMenu(deps)
}

export async function snoozeTabCommand(
  snooze: TabSnooze,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  await runSnoozeCommand(snooze)
}

export async function tabLanguagesCommand(
  deps: TabLanguagesCommandDeps & TabBundleTable,
): Promise<void> {
  setUiText(deps.uiTable, deps.locale)
  await runLanguagesCommand(deps)
}
