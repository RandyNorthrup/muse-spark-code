// Tab's shipped CommonJS bundle (M94, PLAN.md D6): the engine and the
// ledger's spend gate, the provider and the
// menu commands. esbuild builds this file into dist/tab.js, which `tabLoader`
// requires on the first Tab request, so none of it is in the bundle VS Code
// loads at activation. `vscode` is the host's external module. Every entry
// installs the caller's display table before use (PLAN.md D33): the bundle
// keeps its own installed-language state beside the activation's.

import { createTabEngine } from '../../core/tab/tabEngine'
import { createTabHooks, type TabHooksDeps } from '../../core/tab/tabHooks'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type TabBundleTable,
  type TabLanguagesCommandDeps,
  type TabLoadedHandle,
  type TabLoadedWiring,
  type TabProviderDeps,
  type TabProviderHandle,
  type TabServices,
  type TabServicesDeps,
  type TabStatusDeps,
} from './tabBundle'
import type { TabSnooze } from './tabSnooze'
import { createTabLedger } from './tabLedger'
import { createTabProvider as createProvider } from './tabProvider'
import { createTabSpendGate } from './tabSpendGate'
import { createTabByoResolutions } from './tabByo'
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
    }),
    spend: createTabSpendGate({
      ledger,
      budgetUsd: deps.budgetUsd,
      now,
      onTotalChanged: deps.onTotalChanged,
      ...(deps.onBudgetReached !== undefined && { onBudgetReached: deps.onBudgetReached }),
      log: deps.log,
    }),
  }
}

export function createTabProvider(deps: TabProviderDeps & TabBundleTable): TabProviderHandle {
  setUiText(deps.uiTable, deps.locale)
  if (deps.hooks !== undefined || deps.hookDispatch === undefined) return createProvider(deps)
  const dispatch = deps.hookDispatch
  let runner: Awaited<ReturnType<Extract<typeof dispatch, { load: unknown }>['load']>>
  const hookDispatch: Omit<TabHooksDeps, 'isWorkspaceTrusted' | 'log'> =
    'load' in dispatch
      ? {
          isHooksEnabled: dispatch.isHooksEnabled,
          configurationVersion: () => runner?.configurationVersion() ?? '',
          isReloading: () => runner?.isReloading() ?? false,
          hookState: async (event) => {
            runner = await dispatch.load()
            if (runner === undefined) throw new Error('Tab hook dispatch unavailable')
            return await runner.tabHookState(event)
          },
          run: async (request) => {
            runner = await dispatch.load()
            return await runner?.runTab(request)
          },
        }
      : dispatch
  const hooks = createTabHooks({
    ...hookDispatch,
    isWorkspaceTrusted: deps.isTrusted,
    log: (message) => {
      deps.log.info(message)
    },
  })
  return createProvider({
    ...deps,
    hooks: {
      beforeRead: hooks.beforeRead,
      afterEdit: (edit) => {
        hooks.afterEdit({ ...edit, acceptance: edit.inferred ? 'partial' : 'full' }, edit)
      },
      bindPolicy: hooks.bindPolicy,
      policyKey: hooks.policyKey,
      dispose: hooks.dispose,
    },
  })
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

/**
Wires a loaded Tab from activation's readers: the engine and the spend
gate, the provider over them, and the command runners. Lives in the lazy
bundle, so activation carries none of the wiring: the shim only passes
its deps through on the first request.
*/
export function createTabLoaded(wiring: TabLoadedWiring): TabLoadedHandle {
  // The engine (lane C) and the ledger's spend gate (lane L) live in the
  // bundle; the status bar redraws when today's total moves.
  // M95c part 7: bring-your-own Tab models resolve per request; a BYO
  // request's usage reaches Account & usage at its provider's card.
  const byo = createTabByoResolutions(wiring.services.resolveByo)
  const { engine, spend } = createTabServices({
    ...wiring.services,
    onUsage: (model, usage) => {
      const price = byo.current(model)?.price
      const costUsd = price?.settle(usage)
      wiring.services.onUsage(model, costUsd === undefined ? usage : { ...usage, costUsd })
    },
    budgetUsd: () => wiring.tabSettings().tabDailyBudgetUsd,
    onTotalChanged: () => {
      wiring.status.refresh()
      wiring.onTodayTotalChanged?.()
    },
    // Hitting the daily budget is never silent: one notice per day
    // naming the spend, the budget and how to raise it, with a direct
    // way into Settings.
    onBudgetReached: (spent, budget) => {
      wiring.notifyBudgetReached(spent, budget)
    },
    log: wiring.log,
  })
  const settingsOf = (): ReturnType<TabProviderDeps['settings']> => {
    const settings = wiring.tabSettings()
    return {
      tabModel: settings.tabModel,
      tabMaxOutputTokens: settings.tabMaxOutputTokens,
      tabLanguages: settings.tabLanguages,
      tabMultiline: settings.tabMultiline,
      tabTrigger: settings.tabTrigger,
      tabWithCopilot: settings.tabWithCopilot,
    }
  }
  const provider = createProvider({
    settings: settingsOf,
    recordMaxOutputTokens: wiring.services.recordMaxOutputTokens,
    byo,
    isPaidOn: wiring.isPaidOn,
    isKeyStored: wiring.isKeyStored,
    isTrusted: wiring.isTrusted,
    isSnoozed: () => wiring.snooze.isSnoozed(Date.now()),
    realPath: wiring.realPath,
    foreignSetting: wiring.foreignSetting,
    isCopilotExtensionPresent: wiring.isCopilotExtensionPresent,
    filesExclude: wiring.filesExclude,
    workspaceRoots: wiring.workspaceRoots,
    ignoreFileExists: wiring.ignoreFileExists,
    runGit: wiring.runGit,
    onIgnoreFilesChanged: wiring.onIgnoreFilesChanged,
    onDidChangeTextDocument: wiring.onDidChangeTextDocument,
    recentEdits: wiring.recentEdits,
    engine,
    spend,
    consentDeps: wiring.consentDeps,
    hooks: wiring.hooks,
    hookDispatch: wiring.hookDispatch,
    onOutcome: (outcome) => {
      // Deny snoozes the window (Q-M94a): set it before the status redraws.
      if (outcome.kind === 'quiet' && outcome.reason === 'consent-denied') {
        wiring.snooze.snoozeUntilRestart()
      }
      wiring.status.noteOutcome(outcome)
    },
    log: wiring.log,
  })
  return {
    provider,
    spend,
    showMenu: () =>
      showTabMenu({ ...wiring.statusDeps, uiTable: wiring.uiTable, locale: wiring.locale }),
    runSnooze: async () => {
      await snoozeTabCommand(wiring.snooze, wiring.uiTable, wiring.locale)
      // The palette's snooze redraws the bar, as the menu's rows do (RVM94HU 9).
      wiring.status.refresh()
    },
    runLanguages: () =>
      tabLanguagesCommand({
        languages: wiring.knownLanguages,
        tabLanguages: () => wiring.tabSettings().tabLanguages,
        updateSetting: wiring.updateSetting,
        uiTable: wiring.uiTable,
        locale: wiring.locale,
      }),
    accept: (args) => {
      provider.acceptNotified(args)
    },
    dispose: () => {
      provider.dispose()
    },
  }
}
