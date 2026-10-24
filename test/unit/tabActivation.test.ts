import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createTabActivation,
  deferredRefresh,
  TAB_COMMAND_IDS,
  type TabActivationDeps,
  type TabStatusDeps,
  type TabStatusHandle,
} from '../../src/host/vscode/tab/tabBundle'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { collectingLogger } from './helpers/collectingLogger'
import { quietTabServices } from './helpers/tabQuietFixtures'
import { removeFolder } from './helpers/temporaryFolders'

// M94 acceptance 1 (off sends nothing and loads nothing; on arms the
// registration) and acceptance 18 (no secret, process or bundle at
// activation; the bundle loads on first use): the real shim over
// recording seams and a real missing bundle. The first request's load is
// the integration test's (real documents); here the Tab commands drive
// the same first-use path.

const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-tab-activation-')))
afterAll(async () => {
  await removeFolder(base)
})

interface ShimState {
  isOn: boolean
  bundlePath: string
  loads: string[]
  keyReads: number
  registrations: number
  teardowns: number
  contexts: boolean[]
  commands: Map<string, (...args: readonly unknown[]) => unknown>
  statuses: number
  refreshes: number
}

function depsOf(state: ShimState): TabActivationDeps {
  const ensureKeyPresence = deferredRefresh(() => {
    state.keyReads += 1
  })
  return {
    bundlePath: state.bundlePath,
    log: collectingLogger([]),
    loadBundle: (file) => {
      state.loads.push(file)
      throw new Error(`no bundle at ${file}`)
    },
    isTabSettingOn: () => state.isOn,
    tabSettings: () => ({
      tabModel: 'muse-spark-1.3',
      tabMaxOutputTokens: 0,
      tabLanguages: {},
      tabMultiline: 'auto',
      tabTrigger: 'automatic',
      tabWithCopilot: 'yield',
      tabDailyBudgetUsd: Usd.from(0).toAmount(),
    }),
    isPaidOn: () => true,
    isKeyStored: () => false,
    isTrusted: () => true,
    ensureKeyPresence,
    updateSetting: () => Promise.resolve(),
    registerCommand: (id, run) => {
      state.commands.set(id, run)
      return { dispose: () => undefined }
    },
    realPath: (absolutePath) => Promise.resolve(absolutePath),
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    filesExclude: () => ({}),
    registerProvider: () => {
      state.registrations += 1
      return {
        dispose: () => {
          state.teardowns += 1
        },
      }
    },
    setTabOnContext: (isOn) => {
      state.contexts.push(isOn)
    },
    workspaceRoots: () => [],
    ignoreFileExists: () => false,
    runGit: () => Promise.resolve(''),
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: () => ({ dispose: () => undefined }),
    activeLanguageId: () => undefined,
    ...quietTabServices(),
    snoozeStore: {
      readSnoozedUntil: () => undefined,
      writeSnoozedUntil: () => Promise.resolve(),
      nowMs: () => Date.now(),
    },
    services: {
      stream: () => {
        throw new Error('no request is ever sent')
      },
      resolveByo: () => Promise.reject(new Error('no bring-your-own model is ever resolved')),
      recordMaxOutputTokens: () => 0,
      ledgerDirectory: base,
      windowId: 'activation-test',
      onSent: () => undefined,
      onUsage: () => undefined,
    },
    consentDeps: {
      ask: () => Promise.resolve(undefined),
      isOn: () => false,
      isRemembered: () => false,
      windowOnceToken: () => undefined,
      revocations: () => 0,
      readAlways: () => undefined,
      writeAlways: () => Promise.resolve(),
      log: collectingLogger([]),
    },
    createStatus: (_deps: TabStatusDeps, showMenu: () => Promise<void>): TabStatusHandle => {
      state.statuses += 1
      return {
        refresh: () => {
          state.refreshes += 1
        },
        showMenu,
        noteOutcome: () => undefined,
        dispose: () => undefined,
      }
    },
    notifyBudgetReached: () => undefined,
  }
}

function fresh(): ShimState {
  return {
    isOn: false,
    bundlePath: path.join(base, 'dist', 'tab.js'),
    loads: [],
    keyReads: 0,
    registrations: 0,
    teardowns: 0,
    contexts: [],
    commands: new Map<string, (...args: readonly unknown[]) => unknown>(),
    statuses: 0,
    refreshes: 0,
  }
}

const unavailable = fill(UI_TEXT.tabStatusError, { kind: 'load' })

describe('createTabActivation', () => {
  it('registers only the commands while the setting is off', () => {
    const state = fresh()
    const tab = createTabActivation(depsOf(state))
    try {
      tab.refresh()
      expect(state.registrations).toBe(0)
      expect(state.statuses).toBe(0)
      expect(state.loads).toEqual([])
      expect(state.keyReads).toBe(0)
      expect(state.contexts).toEqual([])
      expect(new Set(state.commands.keys())).toEqual(
        new Set([
          TAB_COMMAND_IDS.turnOn,
          TAB_COMMAND_IDS.turnOff,
          TAB_COMMAND_IDS.snooze,
          TAB_COMMAND_IDS.menu,
          TAB_COMMAND_IDS.languages,
          TAB_COMMAND_IDS.afterAccept,
        ]),
      )
      expect(tab.isRegistered()).toBe(false)
      expect(tab.isActive()).toBe(false)
      expect(tab.todayTotalUsd()).toBeUndefined()
    } finally {
      tab.dispose()
    }
  })

  it('loads nothing for a Tab command while the setting is off', async () => {
    const state = fresh()
    const tab = createTabActivation(depsOf(state))
    try {
      tab.refresh()
      await state.commands.get(TAB_COMMAND_IDS.snooze)?.()
      await state.commands.get(TAB_COMMAND_IDS.languages)?.()
      state.commands.get(TAB_COMMAND_IDS.afterAccept)?.({ foreign: true })
      expect(state.loads).toEqual([])
      expect(state.keyReads).toBe(0)
    } finally {
      tab.dispose()
    }
  })

  it('arms the registration and the status while the setting is on, still loading nothing', () => {
    const state = fresh()
    state.isOn = true
    const tab = createTabActivation(depsOf(state))
    try {
      tab.refresh()
      expect(tab.isRegistered()).toBe(true)
      expect(tab.isActive()).toBe(false)
      expect(state.registrations).toBe(1)
      expect(state.statuses).toBe(1)
      expect(state.contexts).toEqual([true])
      expect(state.loads).toEqual([])
      expect(state.keyReads).toBe(0)
      // A second refresh arms nothing twice.
      tab.refresh()
      expect(state.registrations).toBe(1)
      expect(state.statuses).toBe(1)
    } finally {
      tab.dispose()
    }
  })

  it('loads on the first Tab command, reads the key first, and tries again', async () => {
    const state = fresh()
    state.isOn = true
    const tab = createTabActivation(depsOf(state))
    try {
      tab.refresh()
      await expect(state.commands.get(TAB_COMMAND_IDS.snooze)?.()).rejects.toThrow(unavailable)
      expect(state.keyReads).toBe(1)
      expect(state.loads).toEqual([state.bundlePath])
      expect(tab.isActive()).toBe(false)
      tab.refreshStatus()
      expect(state.refreshes).toBe(1)
      await expect(state.commands.get(TAB_COMMAND_IDS.snooze)?.()).rejects.toThrow(unavailable)
      expect(state.loads).toEqual([state.bundlePath, state.bundlePath])
      // The secret read ran once for both first-use attempts.
      expect(state.keyReads).toBe(1)
    } finally {
      tab.dispose()
    }
  })

  it('tears the registration and the status down with the setting', () => {
    const state = fresh()
    state.isOn = true
    const tab = createTabActivation(depsOf(state))
    try {
      tab.refresh()
      expect(tab.isRegistered()).toBe(true)
      state.isOn = false
      tab.refresh()
      expect(tab.isRegistered()).toBe(false)
      expect(tab.isActive()).toBe(false)
      expect(state.teardowns).toBe(1)
      expect(state.contexts).toEqual([true, false])
    } finally {
      tab.dispose()
    }
  })
})

describe('deferredRefresh', () => {
  it('runs the refresh once and shares its promise', async () => {
    let runs = 0
    const ensure = deferredRefresh(() => {
      runs += 1
    })
    await Promise.all([ensure(), ensure(), ensure()])
    expect(runs).toBe(1)
  })
})
