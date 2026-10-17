// Tab's status bar, its menu and the snooze (M94, PLAN.md D73): one item
// while the feature is on, naming each state D73 names (on, snoozed,
// budget reached, no key, untrusted, the language off, on Invoke for
// Copilot, the last failure's class). The menu turns Tab off, snoozes,
// opens the languages and the multi-line mode, offers the Copilot rows and
// takes the user to Account & usage. Its icon is a codicon, never
// `$(sparkle)` (the owner's branding rule).

import * as vscode from 'vscode'
import { TAB_SNOOZE_LONG_MINUTES, TAB_SNOOZE_SHORT_MINUTES, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  TAB_COMMAND_IDS,
  readCopilotPosture,
  shouldYieldToCopilot,
  type TabLanguagesCommandDeps,
  type TabSnooze,
  type TabStatusDeps,
} from './tabBundle'

interface TabMenuRow {
  readonly label: string
  readonly run: () => unknown
}

/** The status bar item and its menu, over the shim's readers and writers. */
export async function showTabMenu(deps: TabStatusDeps): Promise<void> {
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
        // The activation shim refreshes after the menu action.
      },
    },
    {
      label: table.tabMenuSnoozeLong,
      run: async () => {
        await deps.snooze.snoozeMinutes(TAB_SNOOZE_LONG_MINUTES, Date.now())
        // The activation shim refreshes after the menu action.
      },
    },
    {
      label: table.tabMenuSnoozeRestart,
      run: () => {
        deps.snooze.snoozeUntilRestart()
        // The activation shim refreshes after the menu action.
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
    rows.push(
      {
        label: fill(table.tabMenuCopilotOff, { language }),
        run: async () => {
          if (await deps.confirmCopilotDisable(language)) {
            await deps.disableCopilotFor(language)
          }
          // The activation shim refreshes after the menu action.
        },
      },
      {
        label: table.tabMenuRunBoth,
        run: async () => {
          await deps.updateSetting('tabWithCopilot', 'both')
          // The activation shim refreshes after the menu action.
        },
      },
    )
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

/** The multi-line mode's picker (the menu's row): auto, on Invoke, never. */
async function pickTabMultiline(deps: TabStatusDeps): Promise<void> {
  const table = deps.table()
  const choices = [
    { label: table.tabMultilineAuto, value: 'auto' },
    { label: table.tabMultilineOnInvoke, value: 'onInvoke' },
    { label: table.tabMultilineNever, value: 'never' },
  ] as const
  const picked = await vscode.window.showQuickPick(choices, { title: table.tabMenuMultiline })
  if (picked !== undefined) {
    await deps.updateSetting('tabMultiline', picked.value)
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

      break
    }
    case UI_TEXT.tabMenuSnoozeLong: {
      await snooze.snoozeMinutes(TAB_SNOOZE_LONG_MINUTES, Date.now())

      break
    }
    case UI_TEXT.tabMenuSnoozeRestart: {
      snooze.snoozeUntilRestart()

      break
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
