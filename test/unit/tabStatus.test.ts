import { Usd } from '../../src/shared/usd'
// Tab's status bar, its menu and the snooze (M94, PLAN.md D73): every
// state D73 names, the menu's rows, and the timed and until-restart
// snoozes. Snooze timing is asserted against a controlled clock.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, languages, window } from 'vscode'
import { pickOne } from './helpers/vscodeViews'
import {
  TAB_COMMAND_IDS,
  type TabStatusDeps,
  type TabStatusHandle,
  type TabSnoozeStore,
} from '../../src/host/tab/tabBundle'
import { showTabMenu, snoozeTabCommand, tabLanguagesCommand } from '../../src/host/tab/tabStatus'
import { createTabSnooze, createTabStatusItem } from '../../src/host/tab/tabBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { FakeStatusBarItem } from './mocks/vscode'

const MINUTE_MS = 60_000

beforeEach(() => {
  vi.mocked(window.createStatusBarItem).mockReset()
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(window.showWarningMessage).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
  vi.mocked(languages.getLanguages).mockReset()
})

function memoryStore(end?: number): TabSnoozeStore & { values: { end: number | undefined } } {
  const values = { end }
  return {
    values,
    readSnoozedUntil: () => values.end,
    writeSnoozedUntil: (next: number | undefined) => {
      values.end = next
      return Promise.resolve()
    },
    nowMs: () => Date.now(),
  }
}

describe('createTabSnooze', () => {
  it('snoozes every window until the end, then ends on time', async () => {
    const store = memoryStore()
    const snooze = createTabSnooze(store)
    expect(snooze.isSnoozed(1000)).toBe(false)
    await snooze.snoozeMinutes(15, 1000)
    expect(store.values.end).toBe(1000 + 15 * MINUTE_MS)
    expect(snooze.isSnoozed(1000 + 14 * MINUTE_MS)).toBe(true)
    expect(snooze.minutesLeft(1000 + 14 * MINUTE_MS)).toBe(1)
    expect(snooze.isSnoozed(1000 + 15 * MINUTE_MS)).toBe(false)
    expect(snooze.minutesLeft(1000 + 15 * MINUTE_MS)).toBe(undefined)
  })

  it('snoozes until restart in this window only', () => {
    const snooze = createTabSnooze(memoryStore())
    snooze.snoozeUntilRestart()
    expect(snooze.isSnoozed(Date.now())).toBe(true)
    expect(snooze.minutesLeft(Date.now())).toBe(undefined)
  })
})

interface StatusHarness {
  readonly item: FakeStatusBarItem
  readonly status: TabStatusHandle
  readonly runCommand: ReturnType<typeof vi.fn>
  readonly updateSetting: ReturnType<typeof vi.fn>
  readonly confirmCopilotDisable: ReturnType<typeof vi.fn>
  readonly disableCopilotFor: ReturnType<typeof vi.fn>
  readonly openAccountUsage: ReturnType<typeof vi.fn>
  readonly snooze: ReturnType<typeof createTabSnooze>
  readonly picked: { label: string | undefined }
}

function statusHarness(overrides: Partial<TabStatusDeps> = {}): StatusHarness {
  const item = new FakeStatusBarItem()
  vi.mocked(window.createStatusBarItem).mockReturnValue(item)
  const runCommand = vi.fn((): Promise<void> => Promise.resolve())
  const updateSetting = vi.fn((): Promise<void> => Promise.resolve())
  const confirmCopilotDisable = vi.fn((): Promise<boolean> => Promise.resolve(true))
  const disableCopilotFor = vi.fn((): Promise<void> => Promise.resolve())
  const openAccountUsage = vi.fn((): Promise<void> => Promise.resolve())
  const snooze = createTabSnooze(memoryStore())
  const picked = { label: undefined as string | undefined }
  vi.mocked(pickOne).mockImplementation((items) =>
    Promise.resolve(items.find((item) => item.label === picked.label)),
  )
  const statusDeps: TabStatusDeps = {
    isOn: () => true,
    isKeyStored: () => true,
    isTrusted: () => true,
    activeLanguageId: () => 'typescript',
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    tabWithCopilot: () => 'yield',
    todaySpend: () => ({ totalUsd: Usd.from(0.12).toAmount(), requests: 3 }),
    isBudgetReached: () => false,
    model: () => 'muse-spark-1.3',
    budgetUsd: () => Usd.from(1).toAmount(),
    snooze,
    updateSetting,
    tabLanguages: () => ({ '*': true }),
    knownLanguages: () => Promise.resolve(['typescript', 'plaintext']),
    confirmCopilotDisable,
    disableCopilotFor,
    runCommand,
    openAccountUsage,
    table: () => UI_TEXT,
    ...overrides,
  }
  const status = createTabStatusItem(statusDeps, () => showTabMenu(statusDeps))
  return {
    item,
    status,
    runCommand,
    updateSetting,
    confirmCopilotDisable,
    disableCopilotFor,
    openAccountUsage,
    snooze,
    picked,
  }
}

describe('createTabStatus', () => {
  it('shows today’s spend with the model, requests and budget behind it', () => {
    const harness = statusHarness()
    expect(harness.item.visible).toBe(true)
    expect(harness.item.text).toBe(
      `$(code) ${fill(UI_TEXT.tabStatusSpend, { spend: formatUsd(0.12, 2) })}`,
    )
    expect(harness.item.tooltip).toBe(
      fill(UI_TEXT.tabStatusTooltip, {
        model: 'muse-spark-1.3',
        requests: 3,
        spend: formatUsd(0.12, 2),
        budget: formatUsd(1, 2),
      }),
    )
    expect(harness.item.command).toBe(TAB_COMMAND_IDS.menu)
  })

  it('hides while the feature is off and maintains the tabOn context', () => {
    const off = statusHarness({ isOn: () => false })
    expect(off.item.visible).toBe(false)
    expect(commands.executeCommand).toHaveBeenCalledWith('setContext', 'museSpark.tabOn', false)
    const on = statusHarness()
    expect(on.item.visible).toBe(true)
    expect(commands.executeCommand).toHaveBeenCalledWith('setContext', 'museSpark.tabOn', true)
  })

  it('names each state D73 names', () => {
    const spend = { totalUsd: Usd.from(0.12).toAmount(), requests: 3 }
    const states: [string, Partial<TabStatusDeps>, string][] = [
      ['budget', { isBudgetReached: () => true }, UI_TEXT.tabStatusBudget],
      ['no key', { isKeyStored: () => false }, UI_TEXT.tabStatusNoKey],
      ['untrusted', { isTrusted: () => false }, UI_TEXT.tabStatusUntrusted],
      [
        'language off',
        {
          activeLanguageId: () => 'plaintext',
          tabLanguages: () => ({ '*': true, plaintext: false }),
        },
        fill(UI_TEXT.tabStatusLanguageOff, { language: 'plaintext' }),
      ],
      [
        'copilot',
        {
          isCopilotExtensionPresent: () => true,
          foreignSetting: (section) => (section === 'github.copilot' ? { '*': true } : undefined),
        },
        UI_TEXT.tabStatusCopilot,
      ],
    ]
    for (const [name, extra, text] of states) {
      const harness = statusHarness({ todaySpend: () => spend, ...extra })
      expect(harness.item.text, name).toContain(text)
    }
    const snoozed = statusHarness()
    void snoozed.snooze.snoozeMinutes(15, Date.now())
    snoozed.status.refresh()
    expect(snoozed.item.text).toContain(fill(UI_TEXT.tabStatusSnoozed, { left: 15 }))
    const restart = statusHarness()
    restart.snooze.snoozeUntilRestart()
    restart.status.refresh()
    expect(restart.item.text).toContain(UI_TEXT.tabMenuSnoozeRestart)
  })

  it('fills the snoozed tooltip, never the template (RVM94HU 26)', () => {
    const snoozed = statusHarness()
    void snoozed.snooze.snoozeMinutes(15, Date.now())
    snoozed.status.refresh()
    expect(snoozed.item.tooltip).toBe(fill(UI_TEXT.tabStatusSnoozed, { left: 15 }))
    snoozed.status.dispose()
  })

  it('shows a timed snooze’s end without another event (RVM94HU 9)', async () => {
    vi.useFakeTimers()
    try {
      const snoozed = statusHarness()
      await snoozed.snooze.snoozeMinutes(15, Date.now())
      snoozed.status.refresh()
      expect(snoozed.item.text).toContain(fill(UI_TEXT.tabStatusSnoozed, { left: 15 }))
      await vi.advanceTimersByTimeAsync(16 * 60_000)
      expect(snoozed.item.text).not.toContain(fill(UI_TEXT.tabStatusSnoozed, { left: 1 }))
      expect(snoozed.item.text).toContain(formatUsd(0.12, 2))
      snoozed.status.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the tabOn context when the item goes (RVM94HU 8)', () => {
    const harness = statusHarness()
    vi.mocked(commands.executeCommand).mockClear()
    harness.status.dispose()
    expect(commands.executeCommand).toHaveBeenCalledWith('setContext', 'museSpark.tabOn', false)
  })

  it('marks the budget in the warning colour', () => {
    const harness = statusHarness({ isBudgetReached: () => true })
    expect(harness.item.backgroundColor).toMatchObject({ id: 'statusBarItem.warningBackground' })
  })

  it('shows the last failure’s class until the next trigger', () => {
    const harness = statusHarness()
    harness.status.noteOutcome({ kind: 'failed', failure: 'request' })
    expect(harness.item.text).toContain(fill(UI_TEXT.tabStatusError, { kind: 'request' }))
    harness.status.noteOutcome({ kind: 'quiet', reason: 'snoozed' })
    expect(harness.item.text).not.toContain('failed')
  })

  it('turns off, snoozes and opens languages from the menu', async () => {
    const harness = statusHarness()
    harness.picked.label = UI_TEXT.tabMenuTurnOff
    await harness.status.showMenu()
    expect(harness.runCommand).toHaveBeenCalledWith(TAB_COMMAND_IDS.turnOff)
    harness.picked.label = UI_TEXT.tabMenuSnoozeShort
    await harness.status.showMenu()
    expect(harness.snooze.isSnoozed(Date.now())).toBe(true)
    harness.picked.label = UI_TEXT.tabMenuLanguages
    await harness.status.showMenu()
    expect(harness.runCommand).toHaveBeenCalledWith(TAB_COMMAND_IDS.languages)
  })

  it('offers the Copilot rows only while yielding, confirmed before writing', async () => {
    const yielding = statusHarness({
      isCopilotExtensionPresent: () => true,
      foreignSetting: (section) => (section === 'github.copilot' ? { '*': true } : undefined),
    })
    yielding.picked.label = fill(UI_TEXT.tabMenuCopilotOff, { language: 'typescript' })
    await yielding.status.showMenu()
    expect(yielding.confirmCopilotDisable).toHaveBeenCalledWith('typescript')
    expect(yielding.disableCopilotFor).toHaveBeenCalledWith('typescript')
    yielding.confirmCopilotDisable.mockResolvedValue(false)
    yielding.picked.label = fill(UI_TEXT.tabMenuCopilotOff, { language: 'typescript' })
    await yielding.status.showMenu()
    expect(yielding.disableCopilotFor).toHaveBeenCalledOnce()

    yielding.picked.label = UI_TEXT.tabMenuRunBoth
    await yielding.status.showMenu()
    expect(yielding.updateSetting).toHaveBeenCalledWith('tabWithCopilot', 'both')

    const both = statusHarness({
      isCopilotExtensionPresent: () => true,
      tabWithCopilot: () => 'both',
      foreignSetting: (section) => (section === 'github.copilot' ? { '*': true } : undefined),
    })
    both.picked.label = UI_TEXT.tabMenuUsage
    await both.status.showMenu()
    expect(both.openAccountUsage).toHaveBeenCalledOnce()
    expect(both.confirmCopilotDisable).not.toHaveBeenCalled()
  })

  it('uses translated multi-line labels and writes their stable values', async () => {
    for (const [label, value] of [
      [UI_TEXT.tabMultilineAuto, 'auto'],
      [UI_TEXT.tabMultilineOnInvoke, 'onInvoke'],
      [UI_TEXT.tabMultilineNever, 'never'],
    ]) {
      const harness = statusHarness()
      let isFirst = true
      vi.mocked(pickOne).mockImplementation((items) => {
        const selected = items.find(
          (item) => item.label === (isFirst ? UI_TEXT.tabMenuMultiline : label),
        )
        isFirst = false
        return Promise.resolve(selected)
      })
      await harness.status.showMenu()
      expect(harness.updateSetting).toHaveBeenCalledWith('tabMultiline', value)
      harness.status.dispose()
    }
  })

  it('never shows Copilot’s icon: every icon is a codicon, never $(sparkle)', () => {
    const harness = statusHarness({
      isCopilotExtensionPresent: () => true,
      foreignSetting: (section) => (section === 'github.copilot' ? { '*': true } : undefined),
    })
    for (const label of [harness.item.text]) {
      expect(label).not.toContain('$(sparkle)')
    }
  })
})

describe('snoozeTabCommand', () => {
  it('snoozes for the picked duration', async () => {
    const snooze = createTabSnooze(memoryStore())
    vi.mocked(pickOne).mockResolvedValue({ label: UI_TEXT.tabMenuSnoozeLong })
    await snoozeTabCommand(snooze)
    expect(snooze.minutesLeft(Date.now())).toBe(60)
    vi.mocked(pickOne).mockResolvedValue({ label: UI_TEXT.tabMenuSnoozeRestart })
    await snoozeTabCommand(snooze)
    expect(snooze.isSnoozed(Date.now())).toBe(true)
    expect(snooze.minutesLeft(Date.now())).toBe(undefined)
  })

  it('does nothing when the picker closes', async () => {
    const snooze = createTabSnooze(memoryStore())
    vi.mocked(pickOne).mockResolvedValue(undefined)
    await snoozeTabCommand(snooze)
    expect(snooze.isSnoozed(Date.now())).toBe(false)
  })
})

describe('tabLanguagesCommand', () => {
  it('flips the picked language and leaves the rest', async () => {
    const updateSetting = vi.fn((): Promise<void> => Promise.resolve())
    vi.mocked(pickOne).mockResolvedValue({ label: 'plaintext' })
    await tabLanguagesCommand({
      languages: () => Promise.resolve(['typescript', 'plaintext']),
      tabLanguages: () => ({ '*': true, plaintext: false }),
      updateSetting,
    })
    expect(updateSetting).toHaveBeenCalledWith('tabLanguages', { '*': true, plaintext: true })
  })
})
