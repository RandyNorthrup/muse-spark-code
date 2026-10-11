// PROVWIZ2 round 3 (RVSETTINGSIA F1): the wizard's spending limit IS the
// conversation spending limit setting (`museSpark.modelApiSessionBudgetUsd`).
// Both save paths write through the one shared function only when the
// number changed, at the scope it is effective from; a failed write shows
// its specific error and reports no setup success. Admission then reads
// the new cap through the real settings reader.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { beforeEach, onTestFinished, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import {
  reserveRequest,
  SessionBudgetExceededError,
} from '../../src/core/backends/modelapi/sessionBudget'
import type { ModelsPanelDeps } from '../../src/host/models/modelsPanel'
import {
  runAddProviderQuickPick,
  type ProviderQuickPickUi,
} from '../../src/host/models/modelsQuickPick'
import {
  applyWizardSessionBudget,
  createSessionBudgetConfig,
  type SessionBudgetConfig,
} from '../../src/host/models/sessionBudget'
import type { ProvidersHost } from '../../src/host/providers/providersHost'
import { loadUiTable } from '../../src/host/l10n'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { readSettings } from '../../src/host/settings'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'
import { Usd, isPositiveUsd } from '../../src/shared/usd'
import { scannedTwoModels, testProvidersHost } from './helpers/m95kFixtures'
import {
  type FakeWebviewPanel,
  fakeSettingsSource,
  memoryProvidersStore,
  memorySessionBudgetConfig,
} from './helpers/fakes'
import {
  chooseOpenRouter,
  latestState,
  openModelsPanel,
  resetModelsPanelWindow,
  send,
  testAndTickFirstModel,
  type OpenedModelsPanel,
} from './helpers/modelsPanelHarness'
import { scriptedUi } from './helpers/providerQuickPickScript'

function panelSetup(overrides: Partial<ModelsPanelDeps> = {}): OpenedModelsPanel {
  const { providers } = testProvidersHost({
    deps: {
      store: memoryProvidersStore(),
      ...scannedTwoModels(),
    },
  })
  return openModelsPanel({ providers, ...overrides })
}

/** Prepares the host-owned draft before Save. */
async function prepareOpenRouter(
  panel: FakeWebviewPanel,
  budget: string | undefined,
  expected = '0',
): Promise<void> {
  await chooseOpenRouter(panel)
  await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
    expect(latestState(panel).drafts.wizard).toMatchObject({ keyPresent: true, keyShapeOk: true })
  })
  await testAndTickFirstModel(panel, 'openrouter')
  if (budget === undefined) return
  await send(
    panel,
    {
      type: 'suggestions/change',
      kind: 'sessionBudget',
      usd: Usd.from(budget).toAmount(),
      expectedUsd: Usd.from(expected).toAmount(),
    },
    () => {
      expect(latestState(panel).drafts.wizard?.sessionBudgetUsd).toBe(Usd.from(budget).toAmount())
    },
  )
}

async function saveOpenRouter(
  panel: FakeWebviewPanel,
  budget: string,
  shouldUseNow = true,
): Promise<void> {
  await prepareOpenRouter(panel, budget)
  await send(panel, { type: 'providers/save', useNow: shouldUseNow }, () => {
    expect(latestState(panel).drafts.wizard).toBeUndefined()
  })
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

/**
 * The quick-pick answers that add OpenRouter on a pasted key with both
 * models ticked, giving the spending-limit field `budgetAnswers` in turn.
 */
function openRouterScript(budgetAnswers: string[]): ReturnType<typeof scriptedUi> {
  return scriptedUi({
    pickOne: ['openrouter', 'paste', 'accept'],
    pickMany: [['m1', 'm2']],
    inputText: budgetAnswers,
    confirmSave: [true],
  })
}

/** Runs the quick pick in a local window against `sessionBudget`. */
function runQuickPick(
  providers: ProvidersHost,
  ui: ProviderQuickPickUi,
  sessionBudget: SessionBudgetConfig,
): ReturnType<typeof runAddProviderQuickPick> {
  return runAddProviderQuickPick({ providers, isRemote: false, ui, sessionBudget })
}

beforeEach(resetModelsPanelWindow)

describe('applyWizardSessionBudget (the one shared function)', () => {
  it('refuses an edited limit without its prefill and never writes it', async () => {
    const budget = memorySessionBudgetConfig()
    const outcome = await applyWizardSessionBudget(Usd.from(2).toAmount(), budget, undefined)
    expect(outcome).toEqual({ status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
    expect(budget.writes).toEqual([])
  })

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
    expect(
      await applyWizardSessionBudget(
        Usd.from('2.05').toAmount(),
        config,
        config.read().effectiveUsd,
      ),
    ).toEqual({
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
      const outcome = await applyWizardSessionBudget(
        Usd.from(value).toAmount(),
        budget,
        budget.read().effectiveUsd,
      )
      expect(outcome.status).toBe('failed')
      expect(budget.writes).toEqual([])
    },
  )

  it('writes nothing when the wizard value is untouched', async () => {
    const budget = memorySessionBudgetConfig()
    expect(await applyWizardSessionBudget(undefined, budget, budget.read().effectiveUsd)).toEqual({
      status: 'unchanged',
    })
    expect(budget.writes).toEqual([])
  })

  it('writes nothing when the typed number equals the effective value', async () => {
    const budget = memorySessionBudgetConfig({ effective: '2' })
    expect(
      await applyWizardSessionBudget(Usd.from(2).toAmount(), budget, budget.read().effectiveUsd),
    ).toEqual({
      status: 'unchanged',
    })
    expect(budget.writes).toEqual([])
  })

  it('writes a changed number at the global scope it is effective from', async () => {
    const budget = memorySessionBudgetConfig()
    expect(
      await applyWizardSessionBudget(Usd.from(2).toAmount(), budget, budget.read().effectiveUsd),
    ).toEqual({
      status: 'written',
      scope: 'global',
    })
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
    expect(budget.read().effectiveUsd).toBe('2')
  })

  it('respects an existing workspace value and writes at the workspace scope', async () => {
    const budget = memorySessionBudgetConfig({ effective: '5', scope: 'workspace' })
    expect(
      await applyWizardSessionBudget(Usd.from(2).toAmount(), budget, budget.read().effectiveUsd),
    ).toEqual({
      status: 'written',
      scope: 'workspace',
    })
    expect(budget.writes).toEqual([{ value: '2', scope: 'workspace' }])
  })

  it('rejects a negative amount with the setting schema error and writes nothing', async () => {
    const budget = memorySessionBudgetConfig()
    const outcome = await applyWizardSessionBudget(
      Usd.from(-1).toAmount(),
      budget,
      budget.read().effectiveUsd,
    )
    expect(outcome).toEqual({ status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
    expect(budget.writes).toEqual([])
  })

  it('reports a failed write with the specific error', async () => {
    const budget = memorySessionBudgetConfig({ failWrite: true })
    const outcome = await applyWizardSessionBudget(
      Usd.from(2).toAmount(),
      budget,
      budget.read().effectiveUsd,
    )
    expect(outcome).toEqual({
      status: 'failed',
      error: 'settings are read-only in this test',
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
    await chooseOpenRouter(panel)
    await send(panel, { type: 'providers/enterKey', mode: 'new' }, () => {
      expect(latestState(panel).drafts.wizard).toMatchObject({ keyPresent: true })
    })
    await testAndTickFirstModel(panel, 'openrouter')
    await send(
      panel,
      {
        type: 'suggestions/change',
        kind: 'sessionBudget',
        usd: Usd.from(2).toAmount(),
        expectedUsd: Usd.from(0).toAmount(),
      },
      () => {
        expect(latestState(panel).drafts.wizard?.sessionBudgetUsd).toBe('2')
      },
    )
    const expected = fill(UI_TEXT.sessionBudgetPartialSave, {
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
    const base = openRouterScript(['2'])
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
    const outcome = await runQuickPick(providers, ui, budget)
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
    const ui = openRouterScript(['2'])
    const outcome = await runQuickPick(providers, ui, budget)
    expect(outcome?.sessionBudgetUsd).toBeUndefined()
    expect(budget.writes).toEqual([])
    expect(ui.notices.at(-1)).toContain('openrouter/m1')
  })

  it('a failed write reports provider saved and shows no success banner', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig({ failWrite: true })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const ui = openRouterScript(['2'])
    const outcome = await runQuickPick(providers, ui, budget)
    expect(outcome).toBeUndefined()
    expect(ui.errors).toEqual([
      [
        UI_TEXT.providerSaved,
        UI_TEXT.providerKeySaved,
        UI_TEXT.providerDefaultSaved,
        fill(UI_TEXT.sessionBudgetPartialSave, { detail: 'settings are read-only in this test' }),
        UI_TEXT.providerComposerSkipped,
      ].join(' '),
    ])
    // No setup-success banner: the key-test progress notice may stand, but
    // nothing names the saved provider and model.
    expect(ui.notices.some((notice) => notice.includes('openrouter/m1'))).toBe(false)
    expect(await providers.providers()).toHaveLength(1)
  })

  it('an invalid answer is refused and asked again, never saved silently', async () => {
    const { providers } = quickPickProviders()
    const budget = memorySessionBudgetConfig()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-test-key')
    const ui = openRouterScript(['nope', '2'])
    const outcome = await runQuickPick(providers, ui, budget)
    expect(outcome?.sessionBudgetUsd).toBe('2')
    expect(ui.errors).toEqual([UI_TEXT.wizardSessionBudgetInvalid])
    expect(budget.writes).toEqual([{ value: '2', scope: 'global' }])
  })
})

/** Real file validation, credential transaction and settings writer; synthetic VS Code/service boundaries. */
async function productionBudgetFixture(failure?: string) {
  const folder = await mkdtemp(path.join(tmpdir(), 'provider-wizard-review-'))
  onTestFinished(() => rm(folder, { recursive: true, force: true }))
  vi.mocked(window.showInputBox).mockResolvedValue('sk-or-synthetic')
  const seam = createModelsPanelSeam({
    configFile: path.join(folder, 'providers.json'),
    subscriptionModels: () => Promise.resolve([]),
  })
  const controls = { effective: 5, failWrite: false }
  const write = vi.fn((_section: string, value: unknown) => {
    if (controls.failWrite) return Promise.reject(new Error('settings are read-only'))
    if (typeof value !== 'number') throw new Error('Expected contributed numeric setting')
    controls.effective = value
    return Promise.resolve()
  })
  const budget = createSessionBudgetConfig(
    { get: () => controls.effective, inspect: () => undefined, update: write },
    { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  )
  const { providers, secrets } = testProvidersHost({
    deps: {
      store: seam.store,
      catalog: seam.catalog,
      ...scannedTwoModels(),
      setComposerModel: () =>
        failure === 'composer' ? Promise.reject(new Error('composer refused')) : Promise.resolve(),
    },
  })
  switch (failure) {
    case 'provider': {
      vi.spyOn(seam.store, 'add').mockRejectedValueOnce(new Error('provider persistence refused'))
      break
    }
    case 'credential': {
      vi.spyOn(secrets, 'store').mockRejectedValueOnce(new Error('credential persistence refused'))
      break
    }
    case 'default': {
      vi.spyOn(seam.store, 'setDefaultModel').mockRejectedValueOnce(
        new Error('default persistence refused'),
      )
      break
    }
  }
  return { folder, providers, store: seam.store, controls, budget, write }
}

function partialLimitNotice(detail: string): string {
  return [
    UI_TEXT.providerSaved,
    UI_TEXT.providerKeySaved,
    UI_TEXT.providerDefaultSaved,
    fill(UI_TEXT.sessionBudgetPartialSave, { detail }),
    UI_TEXT.providerComposerSkipped,
  ].join(' ')
}

describe('RVPROVWIZ2 production save paths', () => {
  it.each(
    ['provider', 'credential', 'default', 'composer'].flatMap((failure) =>
      ['panel', 'quick pick'].map((mode) => ({ failure, mode })),
    ),
  )('keeps completed writes after $failure failure in the $mode', async ({ failure, mode }) => {
    const f = await productionBudgetFixture(failure)
    if (mode === 'panel') {
      const { panel, saved } = panelSetup({ providers: f.providers, sessionBudget: f.budget })
      await prepareOpenRouter(panel, '0', '5')
      await send(panel, { type: 'providers/save', useNow: true }, () => {
        const detail =
          failure === 'composer' ? 'composer refused' : `${failure} persistence refused`
        if (failure === 'provider') {
          expect(latestState(panel).drafts.wizard?.errors).toEqual([detail])
          expect(latestState(panel).notice).toBeUndefined()
        } else {
          expect(latestState(panel).drafts.wizard).toBeUndefined()
          expect(latestState(panel).notice).toContain(detail)
          expect(latestState(panel).notice).toContain(UI_TEXT.providerSaved)
        }
      })
      await send(panel, { type: 'providers/wizard', event: 'cancel' }, () => {
        expect(latestState(panel).drafts.wizard).toBeUndefined()
      })
      expect(saved).not.toHaveBeenCalled()
    } else {
      const ui = scriptedUi({
        pickOne: ['openrouter', 'paste', 'accept'],
        pickMany: [['m1']],
        inputText: ['0'],
        confirmSave: [true],
      })
      const run = runAddProviderQuickPick({
        providers: f.providers,
        sessionBudget: f.budget,
        ui,
        isRemote: false,
      })
      if (failure === 'provider') await expect(run).rejects.toThrow('provider persistence refused')
      else {
        expect(await run).toBeUndefined()
        expect(ui.errors.join(' ')).toContain(UI_TEXT.providerSaved)
        expect(ui.errors.join(' ')).toContain(
          failure === 'composer' ? 'composer refused' : `${failure} persistence refused`,
        )
      }
      expect(ui.notices.some((notice) => notice.includes('openrouter/m1'))).toBe(false)
    }
    if (failure === 'composer')
      expect(f.write).toHaveBeenCalledWith('modelApiSessionBudgetUsd', 0, 'global')
    else expect(f.write).not.toHaveBeenCalled()
    expect(f.controls.effective).toBe(failure === 'composer' ? 0 : 5)
    expect(await f.store.list()).toHaveLength(failure === 'provider' ? 0 : 1)
  })

  it('preserves a concurrent setting change when the panel limit was untouched', async () => {
    const f = await productionBudgetFixture()
    const { panel, saved } = panelSetup({ providers: f.providers, sessionBudget: f.budget })
    await prepareOpenRouter(panel, undefined)
    f.controls.effective = 2
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
    expect(f.controls.effective).toBe(2)
    expect(f.write).not.toHaveBeenCalled()
    expect(await f.store.list()).toHaveLength(1)
  })

  it('shows the concurrent current limit and waits for another Save to confirm the panel edit', async () => {
    const f = await productionBudgetFixture()
    const { panel, saved } = panelSetup({ providers: f.providers, sessionBudget: f.budget })
    await prepareOpenRouter(panel, '0', '5')
    // A change during the real provider transaction must be checked
    // after it completes, immediately before the setting write.
    const setDefault = f.store.setDefaultModel
    vi.spyOn(f.store, 'setDefaultModel').mockImplementationOnce(async (...args) => {
      await setDefault(...args)
      f.controls.effective = 2
    })
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(latestState(panel).providers).toHaveLength(1)
    })
    expect(f.write).not.toHaveBeenCalled()
    expect(latestState(panel).sessionBudget.effectiveUsd).toBe('2')
    expect(latestState(panel).drafts.wizard).toMatchObject({ sessionBudgetUsd: '0' })
    expect(latestState(panel).drafts.wizard?.errors.join(' ')).toContain('confirm')
    expect(saved).not.toHaveBeenCalled()
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
    expect(f.write).toHaveBeenCalledWith('modelApiSessionBudgetUsd', 0, 'global')
    expect(await f.store.list()).toHaveLength(1)
  })

  it('keeps a concurrent quick-pick limit when the prefilled number was accepted unchanged', async () => {
    const f = await productionBudgetFixture()
    const base = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1']],
      inputText: ['5'],
      confirmSave: [true],
    })
    const ui = {
      ...base,
      confirmSave: (title: string, detail: string) => {
        f.controls.effective = 2
        return base.confirmSave(title, detail)
      },
    }
    const outcome = await runAddProviderQuickPick({
      providers: f.providers,
      sessionBudget: f.budget,
      ui,
      isRemote: false,
    })
    expect(outcome?.sessionBudgetUsd).toBeUndefined()
    expect(outcome?.modelRef).toBe('openrouter/m1')
    expect(ui.errors).toEqual([])
    expect(f.controls.effective).toBe(2)
    expect(f.write).not.toHaveBeenCalled()
    expect(await f.store.list()).toHaveLength(1)
  })

  it.each([BASE_LOCALE, ...TABLE_LOCALES])(
    'keeps all completed receipts after a confirmed quick-pick budget retry fails (%s)',
    async (language) => {
      onTestFinished(() => {
        setUiText(EN, BASE_LOCALE)
      })
      const loaded = await loadUiTable({
        language,
        readExtensionFile: (segments) => readFile(path.join(process.cwd(), ...segments), 'utf8'),
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      })
      expect(loaded.locale).toBe(language)
      const f = await productionBudgetFixture()
      const base = scriptedUi({
        pickOne: ['openrouter', 'paste', 'accept'],
        pickMany: [['m1']],
        inputText: ['0'],
        confirmSave: [true, true],
      })
      const ui = {
        ...base,
        confirmSave: (title: string, detail: string) => {
          if (title === UI_TEXT.saveProvider) f.controls.effective = 2
          else f.controls.failWrite = true
          return base.confirmSave(title, detail)
        },
      }
      expect(
        await runAddProviderQuickPick({
          providers: f.providers,
          sessionBudget: f.budget,
          ui,
          isRemote: false,
        }),
      ).toBeUndefined()
      const [entry] = await f.store.list()
      if (entry === undefined) throw new Error('Missing fixture provider')
      expect(await f.providers.storedCredential(entry)).toBe('sk-or-synthetic')
      expect(await f.store.defaultModel()).toBe('openrouter/m1')
      expect(f.controls.effective).toBe(2)
      expect(f.write).toHaveBeenCalledOnce()
      expect(f.write).toHaveBeenCalledWith('modelApiSessionBudgetUsd', 0, 'global')
      expect(ui.errors).toEqual([partialLimitNotice('settings are read-only')])
      expect(ui.errors.join(' ')).not.toContain('sk-or-synthetic')
      expect(ui.notices.some((notice) => notice.includes('openrouter/m1'))).toBe(false)
    },
  )

  it('reports a failed quick-pick limit write after the production provider was saved', async () => {
    const f = await productionBudgetFixture()
    f.controls.failWrite = true
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1']],
      inputText: ['0'],
      confirmSave: [true],
    })
    expect(
      await runAddProviderQuickPick({
        providers: f.providers,
        sessionBudget: f.budget,
        ui,
        isRemote: false,
      }),
    ).toBeUndefined()
    expect(ui.errors).toEqual([partialLimitNotice('settings are read-only')])
    expect(ui.notices.some((notice) => notice.includes('openrouter/m1'))).toBe(false)
    expect(f.controls.effective).toBe(5)
    expect(await f.store.list()).toHaveLength(1)
  })

  it('reports provider saved on a limit-write failure and retries without a duplicate provider', async () => {
    const f = await productionBudgetFixture()
    f.controls.failWrite = true
    const { panel, saved } = panelSetup({ providers: f.providers, sessionBudget: f.budget })
    await prepareOpenRouter(panel, '0', '5')
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(latestState(panel).drafts.wizard?.errors.length).toBe(1)
    })
    expect(await f.store.list()).toHaveLength(1)
    expect(latestState(panel).drafts.wizard?.errors).toEqual([
      'Provider saved; the spending limit was not changed: settings are read-only',
    ])
    expect(f.controls.effective).toBe(5)
    expect(saved).not.toHaveBeenCalled()
    f.controls.failWrite = false
    await send(panel, { type: 'providers/save', useNow: true }, () => {
      expect(saved).toHaveBeenCalledOnce()
    })
    expect(await f.store.list()).toHaveLength(1)
    expect(f.controls.effective).toBe(0)
  })

  it.each([false, true])(
    'requires confirmation of a concurrent quick-pick limit (confirm=%s)',
    async (confirm) => {
      const f = await productionBudgetFixture()
      const base = scriptedUi({
        pickOne: ['openrouter', 'paste', 'accept'],
        pickMany: [['m1']],
        inputText: ['0'],
        confirmSave: [true, confirm],
      })
      const confirmations: string[] = []
      const ui = {
        ...base,
        confirmSave: async (title: string, detail: string) => {
          confirmations.push(detail)
          if (confirmations.length === 1) f.controls.effective = 2
          else
            await f.store.replaceAll((entries) =>
              entries.map((entry) => ({
                ...entry,
                pinned: ['m1'],
                routing: { privacy: 'zdr', order: ['newer'] },
              })),
            )
          return await base.confirmSave(title, detail)
        },
      }
      const outcome = await runAddProviderQuickPick({
        providers: f.providers,
        sessionBudget: f.budget,
        ui,
        isRemote: false,
      })
      expect(confirmations).toHaveLength(2)
      expect(confirmations[1]).toContain(formatUsd('2'))
      expect(confirmations[1]).toContain(formatUsd('0'))
      expect(await f.store.list()).toMatchObject([
        { pinned: ['m1'], routing: { privacy: 'zdr', order: ['newer'] } },
      ])
      if (confirm) {
        expect(f.controls.effective).toBe(0)
        expect(outcome?.modelRef).toBe('openrouter/m1')
      } else {
        expect(f.controls.effective).toBe(2)
        expect(f.write).not.toHaveBeenCalled()
        expect(outcome).toBeUndefined()
        expect(ui.errors.join(' ')).toContain('Provider saved;')
      }
    },
  )
})
