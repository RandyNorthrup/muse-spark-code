// Tab's shipped CommonJS bundle (M94, PLAN.md D6): the provider, the
// status bar, the snooze and the menu commands, composed over the injected
// lane seams. esbuild builds this file into dist/tab.js, which `tabLoader`
// requires on the first Tab request, so none of it is in the bundle VS Code
// loads at activation. `vscode` is the host's external module. Every entry
// installs the caller's display table before use (PLAN.md D33): the bundle
// keeps its own installed-language state beside the activation's.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type TabBundleTable,
  type TabLanguagesCommandDeps,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabSnooze,
  type TabSnoozeStore,
  type TabStatusDeps,
  type TabStatusHandle,
} from './tabBundle'
import { createTabProvider as createProvider } from './tabProvider'
import {
  createTabSnooze as createSnooze,
  createTabStatus as createStatus,
  snoozeTabCommand as runSnoozeCommand,
  tabLanguagesCommand as runLanguagesCommand,
} from './tabStatus'

export function createTabSnooze(store: TabSnoozeStore): TabSnooze {
  return createSnooze(store)
}

export function createTabProvider(deps: TabProviderDeps & TabBundleTable): TabProviderHandle {
  setUiText(deps.uiTable, deps.locale)
  return createProvider(deps)
}

export function createTabStatus(deps: TabStatusDeps & TabBundleTable): TabStatusHandle {
  setUiText(deps.uiTable, deps.locale)
  return createStatus(deps)
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
