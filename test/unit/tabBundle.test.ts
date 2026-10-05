// Tab's bundle surface and the activation shim (M94, PLAN.md D73): the
// types-only interface and loader, the deferred secret read, and the shim
// that loads the lazy bundle only while the setting is on. The bundle
// builds the engine and the spend gate (`createTabServices`); activation
// hands it the key client's stream, the ledger folder and the question.

import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { commands, languages, window } from 'vscode'
import {
  TAB_BUNDLE_FILE,
  TAB_COMMAND_IDS,
  TAB_LANGUAGE_WILDCARD,
  TAB_SNOOZE_STATE_KEY,
  TAB_WRITABLE_SETTINGS,
  createTabActivation,
  deferredRefresh,
  isTabBundle,
  isTabLanguageOn,
  readCopilotPosture,
  shouldYieldToCopilot,
  tabLoader,
  type TabActivationDeps,
  type TabOutcome,
  type TabProviderDeps,
  type TabServices,
  type TabServicesDeps,
  type TabStatusDeps,
  type TabUseConsent,
} from '../../src/host/tab/tabBundle'
import { createTabSnooze } from '../../src/host/tab/tabStatus'
import {
  createTabServices as entryServices,
  createTabSnooze as entrySnooze,
  createTabProvider as entryProvider,
  createTabStatus as entryStatus,
  snoozeTabCommand as entrySnoozeCommand,
  tabLanguagesCommand as entryLanguagesCommand,
} from '../../src/host/tab/tabEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { BASE_LOCALE } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FakeStatusBarItem } from './mocks/vscode'
import { sharedUiText } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'
import { pickOne } from './helpers/vscodeViews'

const built = { folder: '', file: '' }

// Built as scripts/build.mjs builds it (lane W owns the entry; the shape is
// the plan's: the entry bundled for node, `vscode` external, the shared
// English fallback beside it).
beforeAll(async () => {
  built.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-tab-bundle-')))
  built.file = path.join(built.folder, TAB_BUNDLE_FILE)
  const vscodeDirectory = path.join(built.folder, 'node_modules', 'vscode')
  mkdirSync(vscodeDirectory, { recursive: true })
  writeFileSync(path.join(vscodeDirectory, 'index.js'), 'module.exports = {}\n')
  writeFileSync(path.join(vscodeDirectory, 'package.json'), '{"main":"index.js"}\n')
  await build({
    entryPoints: [path.resolve('src/shared/l10n/en.ts')],
    outfile: path.join(built.folder, 'uiText.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
  })
  await build({
    entryPoints: [path.resolve('src/host/tab/tabEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    external: ['vscode'],
    format: 'cjs',
    target: 'node20.18',
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
})
afterAll(() => removeFolder(built.folder))

beforeEach(() => {
  vi.mocked(window.showQuickPick).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
})

describe('TAB_COMMAND_IDS', () => {
  it('names the five user commands and the internal accept, all museSpark.tab*', () => {
    expect(Object.values(TAB_COMMAND_IDS)).toHaveLength(6)
    for (const id of Object.values(TAB_COMMAND_IDS)) {
      expect(id.startsWith('museSpark.tab')).toBe(true)
    }
    expect(TAB_COMMAND_IDS.afterAccept).toBe('museSpark.tabAfterAccept')
  })

  it('writes only machine-scoped settings (D73: no workspace widening)', () => {
    expect([...TAB_WRITABLE_SETTINGS]).toEqual([
      'modelApiTab',
      'tabMultiline',
      'tabLanguages',
      'tabWithCopilot',
    ])
  })
})

describe('isTabLanguageOn', () => {
  it('prefers the language, then the wildcard, then on', () => {
    expect(isTabLanguageOn({ '*': true, plaintext: false }, 'plaintext')).toBe(false)
    expect(isTabLanguageOn({ '*': false }, 'typescript')).toBe(false)
    expect(isTabLanguageOn({}, 'typescript')).toBe(true)
    expect(TAB_LANGUAGE_WILDCARD).toBe('*')
  })
})

describe('shouldYieldToCopilot', () => {
  const posture = {
    extensionPresent: true,
    enabledForLanguage: true,
    aiFeaturesDisabled: false,
    tabWithCopilot: 'yield' as const,
  }

  it('yields by default while Copilot is on, and never on both', () => {
    expect(shouldYieldToCopilot(posture)).toBe(true)
    expect(shouldYieldToCopilot({ ...posture, tabWithCopilot: 'both' })).toBe(false)
    expect(shouldYieldToCopilot({ ...posture, extensionPresent: false })).toBe(false)
    expect(shouldYieldToCopilot({ ...posture, enabledForLanguage: false })).toBe(false)
    expect(shouldYieldToCopilot({ ...posture, aiFeaturesDisabled: true })).toBe(false)
  })

  it('reads the posture around one language', () => {
    expect(
      readCopilotPosture({
        isCopilotExtensionPresent: () => true,
        foreignSetting: (section) =>
          section === 'github.copilot' ? { typescript: false } : undefined,
        tabWithCopilot: 'yield',
        languageId: 'typescript',
      }).enabledForLanguage,
    ).toBe(false)
    expect(
      readCopilotPosture({
        isCopilotExtensionPresent: () => false,
        foreignSetting: () => undefined,
        tabWithCopilot: 'yield',
        languageId: 'typescript',
      }).enabledForLanguage,
    ).toBe(true)
  })
})

describe('isTabBundle', () => {
  it('accepts the entry’s six functions, and nothing else', () => {
    expect(
      isTabBundle({
        createTabServices: () => undefined,
        createTabSnooze: () => undefined,
        createTabProvider: () => undefined,
        createTabStatus: () => undefined,
        snoozeTabCommand: () => undefined,
        tabLanguagesCommand: () => undefined,
      }),
    ).toBe(true)
    expect(isTabBundle({ createTabProvider: () => undefined })).toBe(false)
    // The five host entries without the services are not the bundle.
    expect(
      isTabBundle({
        createTabSnooze: () => undefined,
        createTabProvider: () => undefined,
        createTabStatus: () => undefined,
        snoozeTabCommand: () => undefined,
        tabLanguagesCommand: () => undefined,
      }),
    ).toBe(false)
    expect(isTabBundle({})).toBe(false)
    expect(isTabBundle(null)).toBe(false)
  })
})

describe('tabLoader', () => {
  const bundle = {
    createTabServices: () => undefined,
    createTabSnooze: () => undefined,
    createTabProvider: () => undefined,
    createTabStatus: () => undefined,
    snoozeTabCommand: () => undefined,
    tabLanguagesCommand: () => undefined,
  }

  it('loads the bundle once and keeps it', () => {
    const loadBundle = vi.fn(() => bundle)
    const load = tabLoader({
      bundlePath: '/dist/tab.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(load()).toBe(bundle)
    expect(load()).toBe(bundle)
    expect(loadBundle).toHaveBeenCalledOnce()
    expect(loadBundle).toHaveBeenCalledWith('/dist/tab.js')
  })

  it('refuses a missing bundle with the table’s sentence', () => {
    const log = new FakeLogOutputChannel()
    const load = tabLoader({
      bundlePath: '/dist/tab.js',
      log,
      loadBundle: () => {
        throw new Error('Cannot find module')
      },
    })
    expect(() => load()).toThrow(UI_TEXT.tabStatusError.replace('{kind}', 'load'))
  })

  it('logs fixed loader failures without paths', () => {
    const log = new FakeLogOutputChannel()
    const load = tabLoader({
      bundlePath: '/home/private/tab.js',
      log,
      loadBundle: () => {
        throw new Error('opaque-demo-value in /home/private/tab.js')
      },
    })
    expect(() => load()).toThrow()
    expect(log.error).toHaveBeenCalledExactlyOnceWith('The Tab bundle could not be loaded')
  })

  it('refuses a module that does not export Tab, without its path', () => {
    const log = new FakeLogOutputChannel()
    const load = tabLoader({
      bundlePath: '/home/private/tab.js',
      log,
      loadBundle: () => ({ somethingElse: true }),
    })
    expect(() => load()).toThrow()
    expect(log.error).toHaveBeenCalledExactlyOnceWith('The Tab bundle does not export the Tab')
  })
})

describe('deferredRefresh', () => {
  it('runs the refresh once, on the first call', () => {
    const refresh = vi.fn()
    const ensure = deferredRefresh(refresh)
    ensure()
    ensure()
    expect(refresh).toHaveBeenCalledOnce()
  })
})

// --- The activation shim ---

interface ActivationHarness {
  readonly activation: ReturnType<typeof createTabActivation>
  readonly loadBundle: ReturnType<typeof vi.fn>
  readonly keyPresence: string[]
  readonly keyReads: { count: number }
  readonly gitRuns: string[][]
  readonly updated: [string, unknown][]
  readonly registered: Map<string, (...args: readonly unknown[]) => unknown>
  readonly disposables: ReturnType<typeof vi.fn>[]
  readonly providerDeps: () => TabProviderDeps | undefined
  readonly statusDeps: () => TabStatusDeps | undefined
  readonly outcomes: () => TabOutcome[]
  readonly servicesDeps: () => TabServicesDeps | undefined
  readonly consent: TabUseConsent
  readonly services: TabServices
  settingOn: boolean
}

/** The services the harness bundle hands out: plain recorders, never sent. */
function harnessServices(overrides: Partial<TabServices['spend']> = {}): TabServices {
  return {
    engine: {
      complete: () =>
        Promise.resolve({
          completion: undefined,
          usage: Promise.resolve({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 }),
        }),
    },
    spend: {
      reserve: () => Promise.resolve(undefined),
      settle: () => undefined,
      todayTotalUsd: () => 0,
      todayRequests: () => 0,
      ...overrides,
    },
  }
}

function activationHarness(
  overrides: Partial<TabActivationDeps> & {
    readonly loadModule?: unknown
    readonly loadThrows?: boolean
    readonly bundleServices?: TabServices
  } = {},
): ActivationHarness {
  const {
    loadModule,
    loadThrows,
    bundleServices: services = harnessServices(),
    ...deps
  } = overrides
  const consent: TabUseConsent = { requestUse: () => Promise.resolve(true) }
  let servicesFound: TabServicesDeps | undefined
  const log = new FakeLogOutputChannel()
  const loadBundle = vi.fn(() => {
    if (loadThrows === true) {
      throw new Error('Cannot find module')
    }
    return (
      loadModule ?? {
        createTabServices: (found: TabServicesDeps) => {
          servicesFound = found
          return services
        },
        createTabSnooze: (store: never) => createTabSnooze(store),
        createTabProvider: (found: TabProviderDeps) => {
          providerFound = found
          return { dispose: providerDispose, acceptNotified }
        },
        createTabStatus: (found: TabStatusDeps) => {
          statusFound = found
          return {
            refresh: () => undefined,
            showMenu: () => Promise.resolve(),
            noteOutcome: (outcome: TabOutcome) => {
              seenOutcomes.push(outcome)
            },
            dispose: statusDispose,
          }
        },
        snoozeTabCommand: () => Promise.resolve(),
        tabLanguagesCommand: () => Promise.resolve(),
      }
    )
  })
  const harness: Omit<ActivationHarness, 'activation'> = {
    loadBundle,
    keyPresence: [],
    keyReads: { count: 0 },
    gitRuns: [],
    updated: [],
    registered: new Map(),
    disposables: [],
    providerDeps: () => providerFound,
    statusDeps: () => statusFound,
    outcomes: () => seenOutcomes,
    servicesDeps: () => servicesFound,
    consent,
    services,
    settingOn: false,
  }
  let providerFound: TabProviderDeps | undefined
  let statusFound: TabStatusDeps | undefined
  const seenOutcomes: TabOutcome[] = []
  const providerDispose = vi.fn()
  const statusDispose = vi.fn()
  const acceptNotified = vi.fn()
  const activation = createTabActivation({
    bundlePath: '/dist/tab.js',
    log,
    loadBundle,
    isTabSettingOn: () => harness.settingOn,
    tabSettings: () => ({
      tabModel: 'muse-spark-1.3',
      tabLanguages: { '*': true },
      tabMultiline: 'auto',
      tabTrigger: 'automatic',
      tabWithCopilot: 'yield',
      tabDailyBudgetUsd: 1,
    }),
    isPaidOn: () => true,
    isKeyStored: () => {
      harness.keyReads.count += 1
      return true
    },
    isTrusted: () => true,
    ensureKeyPresence: () => {
      harness.keyPresence.push('refresh')
    },
    updateSetting: (key, value) => {
      harness.updated.push([key, value])
      return Promise.resolve()
    },
    registerCommand: (id, run) => {
      harness.registered.set(id, run)
      const dispose = vi.fn()
      harness.disposables.push(dispose)
      return { dispose }
    },
    relativeInWorkspace: () => 'file.ts',
    foreignSetting: () => undefined,
    isCopilotExtensionPresent: () => false,
    filesExclude: () => ({}),
    workspaceRoots: () => ['/ws'],
    ignoreFileExists: () => false,
    runGit: (args, cwd) => {
      harness.gitRuns.push([...args, `cwd=${cwd}`])
      return Promise.reject(new Error('no git'))
    },
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: () => ({ dispose: () => undefined }),
    activeLanguageId: () => 'typescript',
    knownLanguages: () => Promise.resolve([]),
    confirmCopilotDisable: () => Promise.resolve(true),
    disableCopilotFor: () => Promise.resolve(),
    openAccountUsage: () => Promise.resolve(),
    runCommand: () => Promise.resolve(),
    table: () => UI_TEXT,
    locale: () => BASE_LOCALE,
    snoozeStore: {
      readSnoozedUntil: () => undefined,
      writeSnoozedUntil: () => Promise.resolve(),
      nowMs: () => Date.now(),
    },
    services: {
      stream: () => {
        throw new Error('the harness never streams')
      },
      ledgerDirectory: '/storage/tab-spend',
      windowId: 'window-1',
      onSent: () => undefined,
      onUsage: () => undefined,
    },
    consent,
    ...deps,
  })
  // The same object the deps read: a spread copy would leave `settingOn`
  // unseen by `isTabSettingOn`.
  const full: ActivationHarness = Object.assign(harness, { activation })
  return full
}

describe('createTabActivation', () => {
  it('registers the commands but loads nothing while the setting is off', () => {
    const harness = activationHarness()
    expect(harness.registered.size).toBe(Object.values(TAB_COMMAND_IDS).length)
    for (const id of Object.values(TAB_COMMAND_IDS)) {
      expect(harness.registered.has(id)).toBe(true)
    }
    harness.activation.refresh()
    expect(harness.activation.isActive()).toBe(false)
    expect(harness.loadBundle).not.toHaveBeenCalled()
    expect(harness.keyReads.count).toBe(0)
    expect(harness.gitRuns).toEqual([])
    expect(harness.keyPresence).toEqual([])
  })

  it('loads once on enable, and tears down when turned off', () => {
    const harness = activationHarness()
    harness.settingOn = true
    harness.activation.refresh()
    expect(harness.activation.isActive()).toBe(true)
    expect(harness.loadBundle).toHaveBeenCalledOnce()
    expect(harness.keyPresence).toEqual(['refresh'])
    harness.activation.refresh()
    expect(harness.loadBundle).toHaveBeenCalledOnce()
    harness.settingOn = false
    harness.activation.refresh()
    expect(harness.activation.isActive()).toBe(false)
    harness.activation.dispose()
    for (const dispose of harness.disposables) {
      expect(dispose).toHaveBeenCalledOnce()
    }
  })

  it('retries after a missing bundle: the loader logged, the next change loads', () => {
    const failing = activationHarness({ loadThrows: true })
    failing.settingOn = true
    failing.activation.refresh()
    expect(failing.activation.isActive()).toBe(false)
    const working = activationHarness()
    working.settingOn = true
    working.activation.refresh()
    expect(working.activation.isActive()).toBe(true)
  })

  it('snoozes the window on Deny, before the status redraws', () => {
    const harness = activationHarness()
    harness.settingOn = true
    harness.activation.refresh()
    const providerDeps = harness.providerDeps()
    expect(providerDeps).toBeDefined()
    expect(providerDeps?.isSnoozed()).toBe(false)
    providerDeps?.onOutcome({ kind: 'quiet', reason: 'consent-denied' })
    expect(harness.outcomes()).toEqual([{ kind: 'quiet', reason: 'consent-denied' }])
    // Deny snoozes the window (Q-M94a): the provider reads it live.
    expect(providerDeps?.isSnoozed()).toBe(true)
  })

  it('routes the accept command to the running provider only', () => {
    const acceptNotified = vi.fn()
    const harness = activationHarness({
      loadModule: {
        createTabServices: () => harnessServices(),
        createTabSnooze: (store: never) => createTabSnooze(store),
        createTabProvider: () => ({ dispose: () => undefined, acceptNotified }),
        createTabStatus: () => ({
          refresh: () => undefined,
          showMenu: () => Promise.resolve(),
          noteOutcome: () => undefined,
          dispose: () => undefined,
        }),
        snoozeTabCommand: () => Promise.resolve(),
        tabLanguagesCommand: () => Promise.resolve(),
      },
    })
    const afterAccept = harness.registered.get(TAB_COMMAND_IDS.afterAccept)
    expect(afterAccept).toBeDefined()
    // Stale while off: answers nothing, throws nothing.
    afterAccept?.({ generationId: 'nope' })
    expect(acceptNotified).not.toHaveBeenCalled()
    harness.settingOn = true
    harness.activation.refresh()
    afterAccept?.({ generationId: 'live' })
    expect(acceptNotified).toHaveBeenCalledWith({ generationId: 'live' })
  })

  it('turns the setting on and off through the commands', async () => {
    const harness = activationHarness()
    await harness.registered.get(TAB_COMMAND_IDS.turnOn)?.()
    await harness.registered.get(TAB_COMMAND_IDS.turnOff)?.()
    expect(harness.updated).toEqual([
      ['modelApiTab', true],
      ['modelApiTab', false],
    ])
  })

  it('reads the budget state off the bundle’s spend gate', () => {
    const harness = activationHarness({
      bundleServices: harnessServices({ todayTotalUsd: () => 5, todayRequests: () => 21 }),
    })
    harness.settingOn = true
    harness.activation.refresh()
    const statusDeps = harness.statusDeps()
    expect(statusDeps?.todaySpend()).toEqual({ totalUsd: 5, requests: 21 })
    expect(statusDeps?.isBudgetReached()).toBe(true)
  })

  it('wires the bundle’s engine and ledger and the activation’s question into the provider', () => {
    const harness = activationHarness()
    harness.settingOn = true
    harness.activation.refresh()
    const providerDeps = harness.providerDeps()
    expect(providerDeps?.engine).toBe(harness.services.engine)
    expect(providerDeps?.spend).toBe(harness.services.spend)
    expect(providerDeps?.consent).toBe(harness.consent)
    const servicesDeps = harness.servicesDeps()
    expect(servicesDeps?.ledgerDirectory).toBe('/storage/tab-spend')
    expect(servicesDeps?.windowId).toBe('window-1')
    // The budget is read live from the settings, at each request.
    expect(servicesDeps?.budgetUsd()).toBe(1)
  })
})

describe('the shipped Tab bundle', () => {
  it('is the module the loader accepts', () => {
    const loaded = tabLoader({
      bundlePath: built.file,
      log: new FakeLogOutputChannel(),
    })()
    expect(isTabBundle(loaded)).toBe(true)
  })

  it('loads the shared English fallback without copying it into the bundle', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('require("./uiText.js")')
    expect(text).not.toContain(UI_TEXT.tabStatusSpend)
  })

  it('installs the handed table before the snooze command reads it', async () => {
    const seen: string[][] = []
    vi.mocked(pickOne).mockImplementation((items) => {
      seen.push(items.map((item) => item.label))
      return Promise.resolve(undefined)
    })
    const snooze = entrySnooze({
      readSnoozedUntil: () => undefined,
      writeSnoozedUntil: () => Promise.resolve(),
      nowMs: () => Date.now(),
    })
    await entrySnoozeCommand(
      snooze,
      { ...UI_TEXT, tabMenuSnoozeShort: 'Marker short.' },
      BASE_LOCALE,
    )
    expect(seen[0]).toContain('Marker short.')
  })

  it('installs the handed table before the languages command reads it', async () => {
    const titles: (string | undefined)[] = []
    vi.mocked(pickOne).mockImplementation((_items, options) => {
      titles.push(options?.title)
      return Promise.resolve(undefined)
    })
    await entryLanguagesCommand({
      languages: () => Promise.resolve(['typescript']),
      tabLanguages: () => ({}),
      updateSetting: () => Promise.resolve(),
      uiTable: { ...UI_TEXT, tabMenuLanguages: 'Marker languages.' },
      locale: BASE_LOCALE,
    })
    expect(titles).toContain('Marker languages.')
  })

  it('creates the status from the entry with the handed table', () => {
    const item = new FakeStatusBarItem()
    vi.mocked(window.createStatusBarItem).mockReturnValue(item)
    const status = entryStatus({
      isOn: () => true,
      isKeyStored: () => true,
      isTrusted: () => true,
      activeLanguageId: () => 'typescript',
      foreignSetting: () => undefined,
      isCopilotExtensionPresent: () => false,
      tabWithCopilot: () => 'yield',
      todaySpend: () => ({ totalUsd: 0.12, requests: 1 }),
      isBudgetReached: () => false,
      model: () => 'muse-spark-1.3',
      budgetUsd: () => 1,
      snooze: entrySnooze({
        readSnoozedUntil: () => undefined,
        writeSnoozedUntil: () => Promise.resolve(),
        nowMs: () => Date.now(),
      }),
      updateSetting: () => Promise.resolve(),
      tabLanguages: () => ({ '*': true }),
      knownLanguages: () => Promise.resolve([]),
      confirmCopilotDisable: () => Promise.resolve(true),
      disableCopilotFor: () => Promise.resolve(),
      runCommand: () => Promise.resolve(),
      openAccountUsage: () => Promise.resolve(),
      table: () => ({ ...UI_TEXT, tabStatusSpend: 'Marker {spend}.' }),
      uiTable: UI_TEXT,
      locale: BASE_LOCALE,
    })
    expect(item.text).toContain('Marker')
    status.dispose()
  })

  it('creates the engine and the ledger’s spend gate from the entry', () => {
    const services = entryServices({
      stream: () => {
        throw new Error('never streamed here')
      },
      ledgerDirectory: path.join(built.folder, 'tab-spend'),
      windowId: 'window-1',
      budgetUsd: () => 1,
      onSent: () => undefined,
      onUsage: () => undefined,
      onTotalChanged: () => undefined,
      log: new FakeLogOutputChannel(),
    })
    expect(typeof services.engine.complete).toBe('function')
    expect(services.spend.todayTotalUsd()).toBe(0)
    expect(services.spend.todayRequests()).toBe(0)
  })

  it('creates the provider from the entry', () => {
    vi.mocked(languages.registerInlineCompletionItemProvider).mockReturnValue({
      dispose: () => undefined,
    })
    const provider = entryProvider({
      settings: () => ({
        tabModel: 'muse-spark-1.3',
        tabLanguages: { '*': true },
        tabMultiline: 'auto',
        tabTrigger: 'automatic',
        tabWithCopilot: 'yield',
      }),
      isPaidOn: () => true,
      isKeyStored: () => true,
      isTrusted: () => true,
      isSnoozed: () => false,
      relativeInWorkspace: () => 'file.ts',
      foreignSetting: () => undefined,
      isCopilotExtensionPresent: () => false,
      filesExclude: () => ({}),
      workspaceRoots: () => ['/ws'],
      ignoreFileExists: () => false,
      runGit: () => Promise.reject(new Error('no git')),
      onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
      onDidChangeTextDocument: () => ({ dispose: () => undefined }),
      engine: {
        complete: () =>
          Promise.resolve({
            completion: undefined,
            usage: Promise.resolve({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 }),
          }),
      },
      spend: {
        reserve: () =>
          Promise.resolve({ model: 'muse-spark-1.3', worstCaseUsd: 0, date: '2026-10-04' }),
        settle: () => undefined,
        todayTotalUsd: () => 0,
        todayRequests: () => 0,
      },
      consent: { requestUse: () => Promise.resolve(true) },
      onOutcome: () => undefined,
      log: new FakeLogOutputChannel(),
      uiTable: UI_TEXT,
      locale: BASE_LOCALE,
    })
    provider.dispose()
  })
})

describe('TAB_SNOOZE_STATE_KEY', () => {
  it('is extension-private global state, never a setting', () => {
    expect(TAB_SNOOZE_STATE_KEY).toBe('museSpark.tabSnoozedUntil')
  })
})
