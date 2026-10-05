// Tab's status bar, its menu and the snooze (M94, PLAN.md D73): one item
// while the feature is on, naming each state D73 names (on, snoozed,
// budget reached, no key, untrusted, the language off, on Invoke for
// Copilot, the last failure's class). The menu turns Tab off, snoozes,
// opens the languages and the multi-line mode, offers the Copilot rows and
// takes the user to Account & usage. Its icon is a codicon, never
// `$(sparkle)` (the owner's branding rule).

import * as vscode from 'vscode'
import {
  CONTEXT_KEYS,
  TAB_SNOOZE_LONG_MINUTES,
  TAB_SNOOZE_SHORT_MINUTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'
import {
  TAB_COMMAND_IDS,
  isTabLanguageOn,
  readCopilotPosture,
  shouldYieldToCopilot,
  type TabFailureKind,
  type TabLanguagesCommandDeps,
  type TabOutcome,
  type TabSettingValue,
  type TabSnooze,
  type TabSnoozeStore,
  type TabStatusDeps,
  type TabStatusHandle,
  type TabWritableSetting,
} from './tabBundle'

// The status bar's place: with the language and indentation items on the right.
const TAB_STATUS_PRIORITY = 100

const MS_PER_MINUTE = 60_000

/** The snooze: timed across every window, or until restart in this one. */
export function createTabSnooze(store: TabSnoozeStore): TabSnooze {
  let isUntilRestart = false
  return {
    isSnoozed: (nowMs) => isUntilRestart || (store.readSnoozedUntil() ?? 0) > nowMs,
    minutesLeft: (nowMs) => {
      if (isUntilRestart) {
        return
      }
      const end = store.readSnoozedUntil()
      return end === undefined || end <= nowMs
        ? undefined
        : Math.max(1, Math.ceil((end - nowMs) / MS_PER_MINUTE))
    },
    snoozeMinutes: async (minutes, nowMs) => {
      isUntilRestart = false
      await store.writeSnoozedUntil(nowMs + minutes * MS_PER_MINUTE)
    },
    snoozeUntilRestart: () => {
      isUntilRestart = true
    },
  }
}

interface TabMenuRow {
  readonly label: string
  readonly run: () => unknown
}

/** The status bar item and its menu, over the shim's readers and writers. */
export function createTabStatus(deps: TabStatusDeps): TabStatusHandle {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    TAB_STATUS_PRIORITY,
  )
  item.command = TAB_COMMAND_IDS.menu
  let lastFailure: TabFailureKind | undefined
  let lastContext: boolean | undefined

  const setTabOn = (isOn: boolean): void => {
    if (lastContext === isOn) {
      return;
    }

    lastContext = isOn
    void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.tabOn, isOn)
  }

  function refresh(): void {
    const table = deps.table()
    if (!deps.isOn()) {
      item.hide()
      setTabOn(false)
      return
    }
    setTabOn(true)
    const spend = deps.todaySpend()
    const spendText = formatUsd(spend.totalUsd, 2)
    const budgetText = formatUsd(deps.budgetUsd(), 2)
    const tooltip = fill(table.tabStatusTooltip, {
      model: deps.model(),
      requests: spend.requests,
      spend: spendText,
      budget: budgetText,
    })
    if (deps.snooze.isSnoozed(Date.now())) {
      const left = deps.snooze.minutesLeft(Date.now())
      item.text =
        left === undefined
          ? `$(clock) ${table.tabMenuSnoozeRestart}`
          : `$(clock) ${fill(table.tabStatusSnoozed, { left })}`
      item.tooltip = table.tabStatusSnoozed
      item.backgroundColor = undefined
    } else if (deps.isBudgetReached()) {
      item.text = `$(warning) ${table.tabStatusBudget}`
      item.tooltip = tooltip
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    } else if (!deps.isKeyStored()) {
      // No key: the bar says so and Tab never prompts for one (Acceptance 2).
      item.text = `$(circle-slash) ${table.tabStatusNoKey}`
      item.tooltip = table.tabStatusNoKey
      item.backgroundColor = undefined
    } else if (deps.isTrusted()) {
      const language = deps.activeLanguageId()
      const isYields =
        language !== undefined &&
        shouldYieldToCopilot(
          readCopilotPosture({
            isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
            foreignSetting: deps.foreignSetting,
            tabWithCopilot: deps.tabWithCopilot(),
            languageId: language,
          }),
        )
      if (language !== undefined && !isTabLanguageOn(deps.tabLanguages(), language)) {
        item.text = `$(circle-slash) ${fill(table.tabStatusLanguageOff, { language })}`
        item.tooltip = fill(table.tabStatusLanguageOff, { language })
      } else if (isYields) {
        item.text = `$(code) ${table.tabStatusCopilot}`
        item.tooltip = table.tabStatusCopilot
      } else if (lastFailure === undefined) {
        item.text = `$(code) ${fill(table.tabStatusSpend, { spend: spendText })}`
        item.tooltip = tooltip
      } else {
        item.text = `$(error) ${fill(table.tabStatusError, { kind: lastFailure })}`
        item.tooltip = fill(table.tabStatusError, { kind: lastFailure })
      }
      item.backgroundColor = undefined
    } else {
      item.text = `$(circle-slash) ${table.tabStatusUntrusted}`
      item.tooltip = table.tabStatusUntrusted
      item.backgroundColor = undefined
    }
    item.show()
  }

  async function showMenu(): Promise<void> {
    const table = deps.table()
    const rows: TabMenuRow[] = [
      {
        label: table.tabMenuTurnOff,
        run: () => deps.runCommand(TAB_COMMAND_IDS.turnOff),
      },
      {
        label: table.tabMenuSnoozeShort,
        run: async () => {
          await deps.snooze.snoozeMinutes(TAB_SNOOZE_SHORT_MINUTES, Date.now())
          refresh()
        },
      },
      {
        label: table.tabMenuSnoozeLong,
        run: async () => {
          await deps.snooze.snoozeMinutes(TAB_SNOOZE_LONG_MINUTES, Date.now())
          refresh()
        },
      },
      {
        label: table.tabMenuSnoozeRestart,
        run: () => {
          deps.snooze.snoozeUntilRestart()
          refresh()
        },
      },
      {
        label: table.tabMenuLanguages,
        run: () => deps.runCommand(TAB_COMMAND_IDS.languages),
      },
      {
        label: table.tabMenuMultiline,
        run: () => pickTabMultiline(deps),
      },
    ]
    const language = deps.activeLanguageId()
    if (
      language !== undefined &&
      shouldYieldToCopilot(
        readCopilotPosture({
          isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
          foreignSetting: deps.foreignSetting,
          tabWithCopilot: deps.tabWithCopilot(),
          languageId: language,
        }),
      )
    ) {
      rows.push({
        label: fill(table.tabMenuCopilotOff, { language }),
        run: async () => {
          if (await deps.confirmCopilotDisable(language)) {
            await deps.disableCopilotFor(language)
          }
          refresh()
        },
      }, {
        label: table.tabMenuRunBoth,
        run: async () => {
          await deps.updateSetting('tabWithCopilot', 'both')
          refresh()
        },
      })
    }
    rows.push({
      label: table.tabMenuUsage,
      run: () => deps.openAccountUsage(),
    })
    const picked = await vscode.window.showQuickPick(
      rows.map((row) => ({ label: row.label })),
      { title: table.paidTabName },
    )
    const row = rows.find((candidate) => candidate.label === picked?.label)
    if (row !== undefined) {
      await row.run()
    }
  }

  function noteOutcome(outcome: TabOutcome): void {
    if (outcome.kind === 'failed') {
      lastFailure = outcome.failure
    } else {
      // A later trigger clears the failure: quiet states have their own rows.
      lastFailure = undefined
    }
    refresh()
  }

  refresh()
  return {
    refresh,
    // The menu runs from the item's command, registered once by the shim.
    showMenu,
    noteOutcome,
    dispose: () => {
      item.dispose()
    },
  }
}

/** The multi-line mode's picker (the menu's row): auto, on Invoke, never. */
async function pickTabMultiline(deps: TabStatusDeps): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [{ label: 'auto' }, { label: 'onInvoke' }, { label: 'never' }],
    { title: deps.table().tabMenuMultiline },
  )
  const label = picked?.label
  if (label === undefined) {
    return
  }
  switch (label) {
    case 'auto':
    case 'onInvoke':
    case 'never': {
      const key: TabWritableSetting = 'tabMultiline'
      const value: TabSettingValue = label
      await deps.updateSetting(key, value)
      // The shim refreshes the item on the configuration change.
      break
    }
    // No default: an unknown label writes nothing.
  }
}

/** The Snooze command's durations: 15 minutes, an hour, until restart. */
export async function snoozeTabCommand(snooze: TabSnooze): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: UI_TEXT.tabMenuSnoozeShort },
      { label: UI_TEXT.tabMenuSnoozeLong },
      { label: UI_TEXT.tabMenuSnoozeRestart },
    ],
    { title: UI_TEXT.paidTabName },
  )
  switch (picked?.label) {
  case UI_TEXT.tabMenuSnoozeShort: {
    await snooze.snoozeMinutes(TAB_SNOOZE_SHORT_MINUTES, Date.now())
  
  break;
  }
  case UI_TEXT.tabMenuSnoozeLong: {
    await snooze.snoozeMinutes(TAB_SNOOZE_LONG_MINUTES, Date.now())
  
  break;
  }
  case UI_TEXT.tabMenuSnoozeRestart: {
    snooze.snoozeUntilRestart()
  
  break;
  }
  // No default
  }
}

/** The Languages command: every language VS Code knows, flipped for Tab. */
export async function tabLanguagesCommand(deps: TabLanguagesCommandDeps): Promise<void> {
  const known = await deps.languages()
  const picked = await vscode.window.showQuickPick(
    known.map((language) => ({ label: language })),
    {
      title: UI_TEXT.tabMenuLanguages,
      placeHolder: UI_TEXT.tabMenuLanguages,
    },
  )
  if (picked === undefined) {
    return
  }
  const table = deps.tabLanguages()
  const isCurrent = table[picked.label] ?? table['*'] ?? true
  await deps.updateSetting('tabLanguages', { ...table, [picked.label]: !isCurrent })
}
