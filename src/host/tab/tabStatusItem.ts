// Tab's status bar item (M94, PLAN.md D73): the vscode-bound shell around
// the pure status model. It creates the one item, resolves the snapshot
// the model reads, applies the view, and redraws on outcomes, spend and
// the snooze countdown. Activation carries it, so the bar shows at
// startup without loading the engine or reading a secret.

import * as vscode from 'vscode'
import { CONTEXT_KEYS } from '../../shared/constants'
import {
  TAB_COMMAND_IDS,
  type TabOutcome,
  type TabStatusDeps,
  type TabStatusHandle,
} from './tabBundle'
import { nextTabFailureState, TAB_FAILURE_STATE_INIT, tabStatusViewOf } from './tabStatusModel'
import { isTabLanguageOn, readCopilotPosture, shouldYieldToCopilot } from './tabYield'

const TAB_STATUS_PRIORITY = 100

const MS_PER_MINUTE = 60_000

export function createTabStatusItem(
  deps: TabStatusDeps,
  showMenu: () => Promise<void>,
): TabStatusHandle {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    TAB_STATUS_PRIORITY,
  )
  item.command = TAB_COMMAND_IDS.menu
  let failure = TAB_FAILURE_STATE_INIT
  let lastContext: boolean | undefined
  // While a timed snooze runs, the bar redraws each minute, so its minutes
  // left count down and its end shows without another event (RVM94HU 9).
  let snoozeTimer: ReturnType<typeof setTimeout> | undefined

  const setTabOn = (isOn: boolean): void => {
    if (lastContext === isOn) {
      return
    }

    lastContext = isOn
    void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.tabOn, isOn)
  }

  function refresh(): void {
    if (snoozeTimer !== undefined) {
      clearTimeout(snoozeTimer)
      snoozeTimer = undefined
    }
    const spend = deps.todaySpend()
    const budget = deps.budgetUsd()
    const language = deps.activeLanguageId()
    const view = tabStatusViewOf({
      isOn: deps.isOn(),
      totalUsd: spend.totalUsd,
      requests: spend.requests,
      budgetUsd: budget,
      model: deps.model(),
      snoozed: deps.snooze.isSnoozed(Date.now()),
      minutesLeft: deps.snooze.minutesLeft(Date.now()),
      budgetReached: deps.isBudgetReached(),
      isKeyStored: deps.isKeyStored(),
      isTrusted: deps.isTrusted(),
      hooksInvalid: failure.hooksInvalid,
      language,
      languageOn: language === undefined || isTabLanguageOn(deps.tabLanguages(), language),
      yieldsToCopilot:
        language !== undefined &&
        shouldYieldToCopilot(
          readCopilotPosture({
            isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
            foreignSetting: deps.foreignSetting,
            tabWithCopilot: deps.tabWithCopilot(),
            languageId: language,
          }),
        ),
      lastFailure: failure.lastFailure,
      table: deps.table(),
    })
    if (!view.shown) {
      item.hide()
      setTabOn(false)
      return
    }
    setTabOn(true)
    item.text = view.text
    item.tooltip = view.tooltip
    item.backgroundColor = view.backgroundWarning
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined
    if (view.minuteTick) {
      snoozeTimer = setTimeout(refresh, MS_PER_MINUTE)
    }
    item.show()
  }

  function noteOutcome(outcome: TabOutcome): void {
    failure = nextTabFailureState(failure, outcome)
    refresh()
  }

  refresh()
  return {
    refresh,
    // The menu runs from the item's command, registered once by the shim.
    showMenu,
    noteOutcome,
    dispose: () => {
      if (snoozeTimer !== undefined) {
        clearTimeout(snoozeTimer)
      }
      // The Alt+\ binding goes with the item (RVM94HU 8).
      setTabOn(false)
      item.dispose()
    },
  }
}
