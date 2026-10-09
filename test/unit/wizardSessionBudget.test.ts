// PROVWIZ2 round 3 (RVSETTINGSIA F1): the wizard's spending limit IS the
// conversation spending limit setting (`museSpark.modelApiSessionBudgetUsd`).
// Both save paths write through the one shared function only when the
// number changed, at the scope it is effective from; a failed write shows
// its specific error and reports no setup success. Admission then reads
// the new cap through the real settings reader.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { window as fakeWindow, FakeUri } from './mocks/vscode'
import {
  reserveRequest,
  SessionBudgetExceededError,
} from '../../src/core/backends/modelapi/sessionBudget'
import { createModelsPanel, type ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import {
  runAddProviderQuickPick,
  type ProviderQuickPickUi,
} from '../../src/host/models/modelsQuickPick'
import {
  applyWizardSessionBudget,
  createSessionBudgetConfig,
} from '../../src/host/models/sessionBudget'
import { readSettings } from '../../src/host/settings'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, formatUsd } from '../../src/shared/l10n/text'
import { parseHostToPanelMessage, type ModelsPanelState } from '../../src/shared/modelsPanel'
import { Usd, isPositiveUsd } from '../../src/shared/usd'
import { scannedTwoModels, testProvidersHost } from './helpers/m95kFixtures'
import {
  FakeWebviewPanel,
  fakeSettingsSource,
  memoryProvidersStore,
  memorySessionBudgetConfig,
} from './helpers/fakes'

function panelSetup(overrides: Partial<ModelsPanelDeps> = {}): {
  panel: FakeWebviewPanel
  warnings: string[]
  saved: ReturnType<typeof vi.fn>
} {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      ...scannedTwoModels(),
    },
  })
  const warnings: string[] = []
  const saved = vi.fn()
  createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
    providers,
    log: {
      trace: () => undefined,
      info: () => undefined,
      error: (message) => {
        warnings.push(message)
      },
      warn: (message) => {
        warnings.push(message)
      },
    },
    writeExportFile: () => Promise.resolve(),
    readImportFile: () => Promise.resolve(undefined),
    confirmImport: () => Promise.resolve(true),
    onWizardSaved: saved,
    sessionBudget: memorySessionBudgetConfig(),
    ...overrides,
  })
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('Expected panel')
  }
  return { panel, warnings, saved }
}

function latestState(panel: FakeWebviewPanel): ModelsPanelState {
  for (const call of vi.mocked(panel.webview.postMessage).mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      return parsed.message.state
    }
  }
  throw new Error('No valid state')
}

async function send(panel: FakeWebviewPanel, message: unknown, done: () => void): Promise<void> {
  panel.webview.messages.fire(message)
  await vi.waitFor(done)
}

/** Drives the openrouter wizard to a saved draft, with the budget committed. */
async function saveOpenRouter(
  panel: FakeWebviewPanel,
  budget: string,
  shouldUseNow = true,
): Promise<void> {
  await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
    expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
  })
  await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
    expect(latestState(panel).drafts.wizard).toMatchObject({ keyPresent: true, keyShapeOk: true })
  })
  await send(panel, { type: 'providers/test', acceptCost: false }, () => {
    expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
  })
  await send(
    panel,
    { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'openrouter/m1', ticked: true },
    () => {
      expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
    },
  )
  await send(
    panel,
    { type: 'suggestions/change', kind: 'sessionBudget', usd: Usd.from(budget).toAmount() },
    () => {
      expect(latestState(panel).drafts.wizard?.sessionBudgetUsd).toBe(Usd.from(budget).toAmount())
    },
  )
  await send(panel, { type: 'providers/save', useNow: shouldUseNow }, () => {
    expect(latestState(panel).drafts.wizard).toBeUndefined()
  })
}

function scriptedUi(script: {
  readonly pickOne?: (string | undefined)[]
  readonly pickMany?: (readonly string[] | undefined)[]
  readonly inputText?: (string | undefined)[]
  readonly confirmSave?: boolean[]
}): ProviderQuickPickUi & { readonly errors: string[]; readonly notices: string[] } {
  const errors: string[] = []
  const notices: string[] = []
  const pickOne = [...(script.pickOne ?? [])]
  const pickMany = [...(script.pickMany ?? [])]
  const inputText = [...(script.inputText ?? [])]
  const confirmSave = [...(script.confirmSave ?? [])]
  return {
    errors,
    notices,
    pickOne: () => Promise.resolve(pickOne.shift()),
    pickMany: () => Promise.resolve(pickMany.shift()),
    inputText: () => Promise.resolve(inputText.shift()),
    confirmSave: () => Promise.resolve(confirmSave.shift() ?? false),
    showError: (message) => {
      errors.push(message)
    },
    showNotice: (message) => {
      notices.push(message)
    },
  }
}

function quickPickProviders(): ReturnType<typeof testProvidersHost> {
  return testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      ...scannedTwoModels(),
      setComposerModel: () => Promise.resolve(),
    },
  })
}

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  vi.mocked(window.showInputBox).mockReset()
})

describe('applyWizardSessionBudget (the one shared function)', () => {
  it('writes the contributed numeric type through the production settings writer', async () => {
    let effective: unknown = 0
    const update = vi.fn((_section: string, value: unknown) => {
      effective = value
      return Promise.resolve()
    })
    const config = createSessionBudgetConfig(
      { get: () => effective, inspect: () => undefined, update },
      { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    )
    expect(await applyWizardSessionBudget(Usd.from('2.05').toAmount(), config)).toEqual({
      status: 'written',
      scope: 'global',
    })
    expect(update).toHaveBeenCalledWith('modelApiSessionBudgetUsd', 2.05, 'global')
    expect(config.read().effectiveUsd).toBe('2.05')
  })

  it.each(['0.10000000000000001', '9007199254740993', '1' + '0'.repeat(400)])(
    'refuses a limit the contributed number cannot store exactly: %s',
    async (value) => {
      const budget = memorySessionBudgetConfig()
      const outcome = await applyWizardSessionBudget(Usd.from(value).toAmount(), budget)
      expect(outcome.status).toBe('failed')
      expect(budget.writes).toEqual([])
    },
  )

  it('writes nothing when the wizard value is untouched', async () => {
    const budget = memorySessionBudgetConfig()
    expect(await applyWizardSessionBudget(undefined, budget)).toEqual({ status: 'unchanged' })
    expect(budget.writes).toEqual([])
  })

  it('writes nothing when the typed number equals the effective value', async () => {
    const budget = memorySessionBudgetConfig({ effective: '2' })
    expect(await applyWizardSessionBudget(Usd.from(2).toAmount(), budget)).toEqual({
      status: 'unchanged',
    })
    expect(budget.writes).toEqual([])
  })

  it('writes a changed number at the global scope it is effective from', async () => {
    const budget = memorySessionBudgetConfig()
    expect(await applyWizardSessionBudget(Usd.from(2).toAmount(), budget)).toEqual({
      status: 'written',
      scope: 'global',
    })
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
    expect(budget.read().effectiveUsd).toBe('2')
  })

  it('respects an existing workspace value and writes at the workspace scope', async () => {
    const budget = memorySessionBudgetConfig({ effective: '5', scope: 'workspace' })
    expect(await applyWizardSessionBudget(Usd.from(2).toAmount(), budget)).toEqual({
      status: 'written',
      scope: 'workspace',
    })
    expect(budget.writes).toEqual([{ value: '2', scope: 'workspace' }])
  })

  it('rejects a negative amount with the setting schema error and writes nothing', async () => {
    const budget = memorySessionBudgetConfig()
    const outcome = await applyWizardSessionBudget(Usd.from(-1).toAmount(), budget)
    expect(outcome).toEqual({ status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
    expect(budget.writes).toEqual([])
  })

  it('reports a failed write with the specific error', async () => {
    const budget = memorySessionBudgetConfig({ failWrite: true })
    const outcome = await applyWizardSessionBudget(Usd.from(2).toAmount(), budget)
    expect(outcome).toEqual({
      status: 'failed',
      error: fill(UI_TEXT.sessionBudgetWriteFailed, {
        detail: 'settings are read-only in this test',
      }),
    })
    expect(budget.read().effectiveUsd).toBe('0')
  })
})

describe('panel save path', () => {
  it('writes the changed budget and the next admission sees the new cap', async () => {
    const budget = memorySessionBudgetConfig()
    const { panel, saved, warnings } = panelSetup({ sessionBudget: budget })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    await saveOpenRouter(panel, '2')
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.calls[0]?.[0]).toMatchObject({
      providerId: 'openrouter',
      modelRef: 'openrouter/m1',
      sessionBudgetUsd: '2',
      composerSet: true,
    })
    expect(warnings).toEqual([])
    // The panel shows what enforcement reads now, with the line naming
    // its value and scope.
    expect(latestState(panel).sessionBudget).toEqual({
      effectiveUsd: '2',
      nowLine: fill(UI_TEXT.wizardSessionBudgetNow, {
        amount: formatUsd('2'),
        scope: UI_TEXT.sessionBudgetScopeGlobal,
      }),
    })
    // The next request admission reads the new cap through the real
    // settings reader: unlimited before, fitted after.
    const quiet = {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const before = readSettings(
      fakeSettingsSource({ modelApiSessionBudgetUsd: 0 }),
      quiet,
    ).modelApiSessionBudgetUsd
    expect(isPositiveUsd(before)).toBe(false)
    const cap = readSettings(
      fakeSettingsSource({ modelApiSessionBudgetUsd: budget.read().effectiveUsd }),
      quiet,
    ).modelApiSessionBudgetUsd
    expect(cap).toBe('2')
    expect(() =>
      reserveRequest({
        capUsd: cap,
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 1_000_000_000,
        modelId: 'muse-spark-1.3',
      }),
    ).toThrow(SessionBudgetExceededError)
  })

  it('writes nothing when the number is unchanged', async () => {
    const budget = memorySessionBudgetConfig()
    const { panel, saved } = panelSetup({ sessionBudget: budget })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    await saveOpenRouter(panel, '0')
    expect(budget.writes).toEqual([])
    expect(saved).toHaveBeenCalledOnce()
  })

  it('a failed write keeps the typed value, shows the error and reports no success', async () => {
    const budget = memorySessionBudgetConfig({ failWrite: true })
    const { panel, saved } = panelSetup({ sessionBudget: budget })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    await send(panel, { type: 'providers/select', presetId: 'openrouter' }, () => {
      expect(latestState(panel).drafts.wizard?.presetId).toBe('openrouter')
    })
    await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
      expect(latestState(panel).drafts.wizard).toMatchObject({ keyPresent: true })
    })
    await send(panel, { type: 'providers/test', acceptCost: false }, () => {
      expect(latestState(panel).drafts.wizard?.test?.status).toBe('ok')
    })
    await send(
      panel,
      { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'openrouter/m1', ticked: true },
      () => {
        expect(latestState(panel).drafts.wizard?.models).toEqual(['m1'])
      },
    )
    await send(
      panel,
      { type: 'suggestions/change', kind: 'sessionBudget', usd: Usd.from(2).toAmount() },
      () => {
        expect(latestState(panel).drafts.wizard?.sessionBudgetUsd).toBe('2')
      },
    )
    const expected = fill(UI_TEXT.sessionBudgetWriteFailed, {
      detail: 'settings are read-only in this test',
    })
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(latestState(panel).drafts.wizard?.errors).toEqual([expected])
    })
    expect(saved).not.toHaveBeenCalled()
    // The draft (and its typed value) is kept, and nothing was written.
    expect(latestState(panel).drafts.wizard?.sessionBudgetUsd).toBe('2')
    expect(budget.writes).toEqual([])
  })
})

describe('quick pick save path', () => {
  it('writes the typed budget through the shared function, prefilled from the setting', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const seen: { title: string; placeholder: string; value?: string }[] = []
    const base = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1', 'm2']],
      inputText: ['2'],
      confirmSave: [true],
    })
    const ui: typeof base = {
      ...base,
      inputText: (options) => {
        seen.push({
          title: options.title,
          placeholder: options.placeholder,
          ...(options.value !== undefined && { value: options.value }),
        })
        return base.inputText(options)
      },
    }
    const outcome = await runAddProviderQuickPick({
      providers,
      isRemote: false,
      ui,
      sessionBudget: budget,
    })
    expect(outcome).toEqual({
      providerId: 'openrouter',
      modelRef: 'openrouter/m1',
      sessionBudgetUsd: '2',
    })
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
    expect(ui.notices.at(-1)).toContain('openrouter/m1')
    // The field is the spending-limit setting, prefilled with what it is now.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.title).toBe(UI_TEXT.wizardSessionBudget)
    expect(seen[0]?.value).toBe('0')
    expect(seen[0]?.placeholder).toBe(
      fill(UI_TEXT.wizardSessionBudgetNow, {
        amount: formatUsd('0'),
        scope: UI_TEXT.sessionBudgetScopeGlobal,
      }),
    )
  })

  it('writes nothing when the typed number equals the effective value', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig({ effective: '2' })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1', 'm2']],
      inputText: ['2'],
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({
      providers,
      isRemote: false,
      ui,
      sessionBudget: budget,
    })
    expect(outcome?.sessionBudgetUsd).toBe('2')
    expect(budget.writes).toEqual([])
    expect(ui.notices.at(-1)).toContain('openrouter/m1')
  })

  it('a failed write shows the error and no success banner, and saves nothing', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig({ failWrite: true })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1', 'm2']],
      inputText: ['2'],
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({
      providers,
      isRemote: false,
      ui,
      sessionBudget: budget,
    })
    expect(outcome).toBeUndefined()
    expect(ui.errors).toEqual([
      fill(UI_TEXT.sessionBudgetWriteFailed, { detail: 'settings are read-only in this test' }),
    ])
    // No setup-success banner: the key-test progress notice may stand, but
    // nothing names the saved provider and model.
    expect(ui.notices.some((notice) => notice.includes('openrouter/m1'))).toBe(false)
    expect(await providers.providers()).toEqual([])
  })

  it('an invalid answer is refused and asked again, never saved silently', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1', 'm2']],
      inputText: ['nope', '2'],
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({
      providers,
      isRemote: false,
      ui,
      sessionBudget: budget,
    })
    expect(outcome?.sessionBudgetUsd).toBe('2')
    expect(ui.errors).toEqual([UI_TEXT.wizardSessionBudgetInvalid])
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
  })
})
