// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { createModelsPanel } from '../../src/host/models/modelsPanel'
import type { ProviderEntry } from '../../src/host/providers/providerPorts'
import { PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { parseHostToPanelMessage, type PanelToHostMessage } from '../../src/shared/modelsPanel'
import { ProvidersSection } from '../../src/webview/models/ProvidersSection'
import { FakeWebviewPanel, memorySessionBudgetConfig } from './helpers/fakes'
import { testProvidersHost, testRow } from './helpers/m95kFixtures'
import { FakeUri, window as fakeWindow } from './mocks/vscode'
import { makeState } from './modelsPanelFixtures'

const folders: string[] = []
beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
})
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function editSurface(
  options: {
    entry?: ProviderEntry
    defaultModel?: string | null
    flow?: 'Edit' | 'Change key' | 'Change key → Edit'
    confirmPrivateNetwork?: () => Promise<boolean>
    /** The first credential-snapshot read fails with this, before Edit opens. */
    snapshotFailure?: unknown
  } = {},
) {
  const folder = await mkdtemp(path.join(tmpdir(), 'models-edit-'))
  folders.push(folder)
  const configFile = path.join(folder, 'providers.json')
  const seam = createModelsPanelSeam({
    configFile,
    subscriptionModels: () => Promise.resolve([]),
  })
  const { providers, secrets } = testProvidersHost({
    ...(options.confirmPrivateNetwork !== undefined && {
      confirmPrivateNetwork: options.confirmPrivateNetwork,
    }),
    deps: {
      policy: {
        check: (address) =>
          address.includes('192.168.') ? { kind: 'private', address } : { kind: 'ok' },
      },
      store: seam.store,
      catalog: seam.catalog,
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  const entry: ProviderEntry = options.entry ?? {
    id: 'custom',
    preset: 'custom',
    address: 'https://llm.example',
    auth: 'apiKey',
    format: 'chat',
    models: ['m1'],
    modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
  }
  await seam.store.add(entry)
  await seam.store.setDefaultModel(
    options.defaultModel === null
      ? undefined
      : (options.defaultModel ?? `${entry.id}/${entry.models[0] ?? ''}`),
  )
  await secrets.store(
    `${PROVIDER_SECRET_PREFIX}${entry.id}`,
    JSON.stringify({
      v: 1,
      auth: 'apiKey',
      origin: new URL(entry.address).origin,
      secret: 'synthetic-edit-key',
    }),
  )
  const saved = vi.fn()
  const warnings: string[] = []
  if (options.snapshotFailure !== undefined) {
    vi.spyOn(providers, 'credentialSnapshot').mockRejectedValueOnce(options.snapshotFailure)
  }
  const log = {
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: (text: string) => {
      warnings.push(text)
    },
  }
  const sessionBudget = memorySessionBudgetConfig()
  const host = createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
    providers,
    log,
    sessionBudget,
    onWizardSaved: saved,
    writeExportFile: () => Promise.resolve(),
    readImportFile: () => Promise.resolve(undefined),
    confirmImport: () => Promise.resolve(true),
  })
  const panel = fakeWindow.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) throw new TypeError('Expected panel')
  const post = vi.fn((message: PanelToHostMessage) => {
    panel.webview.messages.fire(message)
  })
  const props = {
    post,
    navigate: vi.fn(),
    dispatch: vi.fn(),
    wizardOpen: false,
    wizardLife: { generation: 1, isCurrent: (generation: number) => generation === 1 },
    importOpen: false,
    highlightedItem: undefined,
  }
  let state = makeState()
  const surface = render(<ProvidersSection {...props} panelState={state} />)
  panel.webview.postMessage.mockImplementation((message: unknown) => {
    const parsed = parseHostToPanelMessage(message)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') {
      state = parsed.message.state
      act(() => {
        surface.rerender(<ProvidersSection {...props} panelState={state} />)
      })
    }
    return Promise.resolve(true)
  })
  post({ type: 'modelsPanel/ready' })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: UI_TEXT.providerEdit })).toBeDefined()
  })
  if (options.flow !== undefined && options.flow !== 'Edit') {
    fakeWindow.showInputBox.mockResolvedValueOnce('synthetic-replacement-key')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.changeKey }))
    await waitFor(() => {
      expect(state.drafts.edits[entry.id]?.keyPresent).toBe(true)
    })
  }
  if (options.flow !== 'Change key') {
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
  }
  await waitFor(() => {
    expect(screen.getByLabelText(UI_TEXT.providerFields.address)).toHaveValue(entry.address)
  })
  if (entry.preset === 'custom') {
    await waitFor(() => {
      expect(screen.getAllByLabelText(UI_TEXT.customLimitsOutput)[0]).toHaveValue(
        entry.modelLimits?.[entry.models[0] ?? '']?.outputTokens,
      )
    })
  }
  return {
    configFile,
    seam,
    providers,
    secrets,
    saved,
    warnings,
    host,
    post,
    sessionBudget,
    state: () => state,
  }
}

async function changeReplyLimit() {
  fireEvent.change(screen.getByLabelText(UI_TEXT.customLimitsOutput), { target: { value: '8000' } })
  await waitFor(() => {
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
  })
}

async function testEditConnection(state: () => ReturnType<typeof makeState>) {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.testConnection }))
  await waitFor(() => {
    expect(state().drafts.edits['custom']?.test?.status).toBe('ok')
  })
}

async function saveEditSurface() {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
  await waitFor(() => {
    expect(screen.queryByLabelText(UI_TEXT.providerFields.address)).toBeNull()
  })
}

async function saveConflictingEdit() {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
  await waitFor(() => {
    expect(screen.getByText(UI_TEXT.providerEditConflict)).toBeDefined()
  })
  expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
}

describe('Saved custom provider Edit through the shared form and production store', () => {
  it('saves limits without a connection test, reports success and reopens saved values', async () => {
    const { configFile, seam, providers, saved, host } = await editSurface()
    const test = vi.spyOn(providers, 'testCredential')
    await changeReplyLimit()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(
        screen.getByText(
          fill(UI_TEXT.setupComplete, { provider: 'Custom Server', model: 'custom/m1' }),
        ),
      ).toBeDefined()
    })
    expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    const stored = await seam.store.list()
    expect(stored[0]?.modelLimits?.['m1']?.outputTokens).toBe(8000)
    expect(await readFile(configFile, 'utf8')).toContain('"outputTokens": 8000')
    expect(test).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
    await waitFor(() => {
      expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
    })
    expect(screen.getByLabelText(UI_TEXT.customLimitsContext)).toHaveValue(128_000)
    host.dispose()
  })

  it('keeps typed limits after a specific, redacted write failure and retries without retyping', async () => {
    const { seam, warnings, state, host } = await editSurface()
    const write = vi
      .spyOn(seam.store, 'replaceAll')
      .mockRejectedValueOnce(new Error('disk full: synthetic-edit-key'))
    await changeReplyLimit()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(screen.getByText('disk full: [redacted]')).toBeDefined()
    })
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
    expect(state().notice).not.toBe(UI_TEXT.actionFailed)
    expect(JSON.stringify(state())).not.toContain('synthetic-edit-key')
    expect(warnings.join(' ')).not.toContain('synthetic-edit-key')
    const unchanged = await seam.store.list()
    expect(unchanged[0]?.modelLimits?.['m1']?.outputTokens).toBe(4000)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    })
    const retried = await seam.store.list()
    expect(retried[0]?.modelLimits?.['m1']?.outputTokens).toBe(8000)
    expect(write).toHaveBeenCalledTimes(2)
    host.dispose()
  })

  it.each([
    { privacy: 'zdr', order: ['anthropic'], allowFallbacks: true },
    { privacy: 'any' },
    undefined,
  ] as const)(
    'unchanged OpenRouter Edit → Save preserves routing %j byte-exact',
    async (routing) => {
      const entry: ProviderEntry = {
        id: 'openrouter',
        preset: 'openrouter',
        address: 'https://openrouter.ai',
        auth: 'apiKey',
        models: ['m1'],
        pinned: ['m1'],
        ...(routing !== undefined && { routing }),
      }
      const { seam, configFile, providers, secrets, host } = await editSurface({ entry })
      const before = await readFile(configFile, 'utf8')
      const write = vi.spyOn(seam.store, 'replaceAll')
      const defaultWrite = vi.spyOn(seam.store, 'setDefaultModel')
      const test = vi.spyOn(providers, 'testCredential')
      const secretWrite = vi.spyOn(secrets, 'store')
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
      await waitFor(() => {
        expect(screen.queryByLabelText(UI_TEXT.providerFields.address)).toBeNull()
      })
      expect(await readFile(configFile, 'utf8')).toBe(before)
      expect(write).not.toHaveBeenCalled()
      expect(secretWrite).not.toHaveBeenCalled()
      expect(defaultWrite).not.toHaveBeenCalled()
      expect(test).not.toHaveBeenCalled()
      host.dispose()
    },
  )

  it.each(['custom/m2', 'another/m2', null])(
    'a limit-only save keeps the stored default %s and optional fields',
    async (defaultModel) => {
      const entry: ProviderEntry = {
        id: 'custom',
        preset: 'custom',
        address: 'https://llm.example',
        auth: 'apiKey',
        models: ['m1', 'm2'],
        modelLimits: {
          m1: { contextTokens: 128_000, outputTokens: 4000 },
          m2: { contextTokens: 128_000, outputTokens: 4000 },
          spare: { contextTokens: 128_000, outputTokens: 4000 },
        },
        pinned: ['m2'],
        compat: { toolChoice: 'omit' },
        prices: { m1: { input: 1, output: 2 } },
      }
      const { seam, state, host } = await editSurface({ entry, defaultModel })
      expect(state().drafts.edits['custom']?.defaultModel).toBe(defaultModel ?? undefined)
      const defaultWrite = vi.spyOn(seam.store, 'setDefaultModel')
      fireEvent.change(
        screen.getAllByLabelText(UI_TEXT.customLimitsOutput)[0] ??
          (() => {
            throw new Error('Missing first limit')
          })(),
        { target: { value: '8000' } },
      )
      await waitFor(() => {
        expect(screen.getAllByLabelText(UI_TEXT.customLimitsOutput)[0]).toHaveValue(8000)
      })
      await saveEditSurface()
      expect(await seam.store.defaultModel()).toBe(defaultModel ?? undefined)
      expect(defaultWrite).not.toHaveBeenCalled()
      expect(await seam.store.list()).toEqual([
        {
          ...entry,
          modelLimits: { ...entry.modelLimits, m1: { contextTokens: 128_000, outputTokens: 8000 } },
        },
      ])
      host.dispose()
    },
  )

  it('an explicit default choice changes the saved default', async () => {
    const { seam, post, host } = await editSurface({ defaultModel: 'another/m2' })
    post({ type: 'providers/prefill', providerId: 'custom', fields: { defaultModel: 'custom/m1' } })
    await saveEditSurface()
    expect(await seam.store.defaultModel()).toBe('custom/m1')
    host.dispose()
  })

  it.each(['rotated', 'removed'] as const)(
    'a limit-only save keeps an untouched credential that was %s elsewhere',
    async (change) => {
      const { providers, secrets, host } = await editSurface()
      const key = `${PROVIDER_SECRET_PREFIX}custom`
      if (change === 'rotated') {
        await secrets.store(
          key,
          JSON.stringify({
            v: 1,
            auth: 'apiKey',
            origin: 'https://llm.example',
            secret: 'synthetic-rotated-key',
          }),
        )
      } else {
        await secrets.delete(key)
      }
      const secretWrite = vi.spyOn(secrets, 'store')
      await changeReplyLimit()
      await saveEditSurface()
      const entries = await providers.providers()
      expect(entries[0]?.modelLimits?.['m1']?.outputTokens).toBe(8000)
      expect(
        await providers.storedCredential(
          entries[0] ??
            (() => {
              throw new Error('Missing entry')
            })(),
        ),
      ).toBe(change === 'rotated' ? 'synthetic-rotated-key' : undefined)
      expect(secretWrite).not.toHaveBeenCalled()
      host.dispose()
    },
  )

  it('merges untouched fields changed while the private-network question waits', async () => {
    const entry: ProviderEntry = {
      id: 'custom',
      preset: 'custom',
      address: 'https://192.168.1.20/v1',
      auth: 'apiKey',
      format: 'chat',
      models: ['m1'],
      pinned: ['m1'],
      privateNetwork: true,
      modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
    }
    const consent = Promise.withResolvers<boolean>()
    const confirmPrivateNetwork = vi.fn(() => consent.promise)
    const { seam, host } = await editSurface({ entry, confirmPrivateNetwork })
    await changeReplyLimit()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(confirmPrivateNetwork).toHaveBeenCalledOnce()
    })
    const concurrent: ProviderEntry = {
      ...entry,
      pinned: [],
      compat: { toolChoice: 'omit' },
      modelLimits: { m1: { contextTokens: 256_000, outputTokens: 4000 } },
    }
    await seam.store.replaceAll([concurrent])
    consent.resolve(true)
    await waitFor(() => {
      expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    })
    expect(await seam.store.list()).toEqual([
      { ...concurrent, modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } } },
    ])
    host.dispose()
  })

  it.each(['limit', 'default', 'key'] as const)(
    'stops when the edited %s also changed elsewhere and offers a working reload',
    async (field) => {
      const { seam, configFile, providers, secrets, post, state, warnings, host } =
        await editSurface(field === 'default' ? { defaultModel: 'another/m1' } : {})
      await changeReplyLimit()
      if (field === 'default') {
        post({
          type: 'providers/prefill',
          providerId: 'custom',
          fields: { defaultModel: 'custom/m1' },
        })
        await waitFor(() => {
          expect(state().drafts.edits['custom']?.defaultModel).toBe('custom/m1')
        })
        await seam.store.setDefaultModel('newer/m1')
      } else if (field === 'key') {
        fakeWindow.showInputBox.mockResolvedValueOnce('synthetic-replacement-key')
        fireEvent.click(screen.getByRole('button', { name: UI_TEXT.changeKey }))
        await testEditConnection(state)
        await secrets.store(
          `${PROVIDER_SECRET_PREFIX}custom`,
          JSON.stringify({
            v: 1,
            auth: 'apiKey',
            origin: 'https://llm.example',
            secret: 'synthetic-rotated-key',
          }),
        )
      } else {
        const entries = await seam.store.list()
        await seam.store.replaceAll(
          entries.map((entry) => ({
            ...entry,
            modelLimits: { m1: { contextTokens: 128_000, outputTokens: 6000 } },
          })),
        )
      }
      const before = await readFile(configFile, 'utf8')
      const secretBefore = await secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)
      const secretWrite = vi.spyOn(secrets, 'store')
      await saveConflictingEdit()
      expect(await readFile(configFile, 'utf8')).toBe(before)
      expect(await secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)).toBe(secretBefore)
      expect(secretWrite).not.toHaveBeenCalled()
      expect(state().drafts.edits['custom']?.saveConflict).toBe(true)
      expect(JSON.stringify(state())).not.toContain('synthetic-')
      expect(warnings.join(' ')).not.toContain('synthetic-')
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
      await waitFor(() => {
        expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(
          field === 'limit' ? 6000 : 4000,
        )
        expect(screen.queryByText(UI_TEXT.providerEditConflict)).toBeNull()
      })
      if (field === 'default') expect(state().drafts.edits['custom']?.defaultModel).toBe('newer/m1')
      await changeReplyLimit()
      await saveEditSurface()
      const reloadedEntries = await seam.store.list()
      expect(
        await providers.storedCredential(
          reloadedEntries[0] ??
            (() => {
              throw new Error('Missing entry')
            })(),
        ),
      ).toBe(field === 'key' ? 'synthetic-rotated-key' : 'synthetic-edit-key')
      host.dispose()
    },
  )

  it.each(['Edit', 'Change key', 'Change key → Edit'] as const)(
    'one full snapshot preserves untouched concurrent fields via %s',
    async (flow) => {
      const entry: ProviderEntry = {
        id: 'custom',
        preset: 'custom',
        address: 'https://llm.example',
        auth: 'apiKey',
        format: 'responses',
        models: ['m1'],
        pinned: ['m1'],
        compat: { toolChoice: 'omit' },
        modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
      }
      const { seam, providers, post, state, host } = await editSurface({ entry, flow })
      const concurrent = {
        ...entry,
        pinned: [],
        prices: { m1: { input: 1, output: 2 } },
        privateNetwork: false,
        models: ['m1', 'm2'],
        modelLimits: {
          m1: { contextTokens: 256_000, outputTokens: 4000 },
          m2: { contextTokens: 128_000, outputTokens: 4000 },
        },
      }
      await seam.store.replaceAll([concurrent])
      await seam.store.setDefaultModel('another/m2')
      await changeReplyLimit()
      if (flow !== 'Edit') {
        await testEditConnection(state)
      }
      post({ type: 'providers/save', providerId: 'custom', useNow: false })
      await waitFor(() => {
        expect(screen.queryByLabelText(UI_TEXT.providerFields.address)).toBeNull()
      })
      expect(await seam.store.list()).toEqual([
        {
          ...concurrent,
          modelLimits: {
            ...concurrent.modelLimits,
            m1: { contextTokens: 256_000, outputTokens: 8000 },
          },
        },
      ])
      expect(await seam.store.defaultModel()).toBe('another/m2')
      expect(await providers.storedCredential(entry)).toBe(
        flow === 'Edit' ? 'synthetic-edit-key' : 'synthetic-replacement-key',
      )
      host.dispose()
    },
  )

  it('keeps a newer default when it changes after preflight and the compared write refuses', async () => {
    const { seam, post, state, host } = await editSurface({ defaultModel: 'another/m1' })
    await changeReplyLimit()
    post({ type: 'providers/prefill', providerId: 'custom', fields: { defaultModel: 'custom/m1' } })
    await waitFor(() => {
      expect(state().drafts.edits['custom']?.defaultModel).toBe('custom/m1')
    })
    const writeDefault = seam.store.setDefaultModel
    vi.spyOn(seam.store, 'setDefaultModel').mockImplementationOnce(async (ref, expected) => {
      await writeDefault('newer/m1')
      await writeDefault(ref, expected)
    })
    await saveEditSurface()
    expect(state().notice).toBe(
      [
        UI_TEXT.providerSaved,
        fill(UI_TEXT.providerDefaultSaveFailed, { detail: UI_TEXT.providerEditConflict }),
      ].join(' '),
    )
    expect(await seam.store.defaultModel()).toBe('newer/m1')
    expect(await seam.store.list()).toMatchObject([{ modelLimits: { m1: { outputTokens: 8000 } } }])
    host.dispose()
  })

  it('keeps saved limits after a key-write failure, keeping unrelated concurrent changes', async () => {
    const { seam, secrets, state, host } = await editSurface({ flow: 'Change key' })
    const [initial] = await seam.store.list()
    if (initial === undefined) throw new Error('Missing fixture provider')
    const other = { ...initial, id: 'other' }
    await changeReplyLimit()
    await testEditConnection(state)
    await seam.store.add(other)
    await seam.store.add({ ...initial, id: 'removed' })
    vi.spyOn(secrets, 'store').mockImplementationOnce(async () => {
      await seam.store.replaceAll((entries) => [
        ...entries
          .filter((entry) => entry.id !== 'removed')
          .map((entry): ProviderEntry =>
            entry.id === 'custom'
              ? {
                  ...entry,
                  pinned: ['m1'],
                  compat: { toolChoice: 'omit' },
                  modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } },
                }
              : { ...entry, pinned: ['m1'] },
          ),
        { ...initial, id: 'added' },
      ])
      throw new Error('credential write refused')
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(state().notice).toBe(
        [
          UI_TEXT.providerSaved,
          fill(UI_TEXT.providerKeySaveFailed, { detail: 'credential write refused' }),
        ].join(' '),
      )
    })
    expect(await seam.store.list()).toEqual([
      {
        ...initial,
        pinned: ['m1'],
        compat: { toolChoice: 'omit' },
        modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } },
      },
      { ...other, pinned: ['m1'] },
      { ...initial, id: 'added' },
    ])
    expect(await secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)).toContain('synthetic-edit-key')
    expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    host.dispose()
  })

  it('rejects an inexact budget before writing, then saves after clearing it', async () => {
    const { seam, post, sessionBudget, state, host } = await editSurface()
    await changeReplyLimit()
    const wanted = Usd.from('9007199254740993').toAmount()
    post({ type: 'providers/prefill', providerId: 'custom', fields: { sessionBudgetUsd: wanted } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(state().drafts.edits['custom']?.errors).toEqual([UI_TEXT.wizardSessionBudgetInvalid])
    })
    expect(await seam.store.list()).toMatchObject([{ modelLimits: { m1: { outputTokens: 4000 } } }])
    expect(sessionBudget.read().effectiveUsd).toBe(Usd.from(0).toAmount())
    const providerWrite = vi.spyOn(seam.store, 'replaceAll')
    post({
      type: 'providers/prefill',
      providerId: 'custom',
      fields: { sessionBudgetUsd: undefined },
    })
    await waitFor(() => {
      expect(state().drafts.edits['custom']?.sessionBudgetUsd).toBeUndefined()
    })
    await saveEditSurface()
    expect(providerWrite).toHaveBeenCalledOnce()
    expect(sessionBudget.writes).toEqual([])
    host.dispose()
  })

  it('says the store failed instead of asking for a key when the edit snapshot cannot be read', async () => {
    const { state, warnings, host } = await editSurface({
      snapshotFailure: new Error('store down: synthetic-edit-key'),
    })
    await waitFor(() => {
      expect(state().drafts.edits['custom']?.errors).toEqual([UI_TEXT.providerSaveSecretFailed])
    })
    expect(warnings.join('\n')).toContain('could not read a credential snapshot (Error)')
    expect(warnings.join('\n')).not.toContain('synthetic-edit-key')
    expect(JSON.stringify(state())).not.toContain('synthetic-edit-key')
    host.dispose()
  })

  it('records a foreign save failure with the fixed sentence and keeps the queue', async () => {
    const foreign: unknown = 'a string failure'
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      if (reason === foreign) seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const { providers, state, warnings, host } = await editSurface()
      await changeReplyLimit()
      vi.spyOn(providers, 'saveDraft').mockImplementationOnce(() => {
        throw foreign
      })
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
      await waitFor(() => {
        expect(state().drafts.edits['custom']?.errors).toEqual([UI_TEXT.providerSaveWriteConflict])
      })
      expect(warnings.join('\n')).toContain('Models panel operation failed')
      // The queue survives the foreign failure: saving again still works.
      await saveEditSurface()
      expect(state().drafts.edits['custom']).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(seen).toEqual([])
      host.dispose()
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })

  it.each(['provider', 'credential', 'panel'] as const)(
    'acknowledges the saved provider and retires the draft when the %s refresh fails',
    async (source) => {
      const { seam, providers, state, warnings, host } = await editSurface()
      await changeReplyLimit()
      const save = providers.saveDraft
      vi.spyOn(providers, 'saveDraft').mockImplementationOnce(async (draft, budget) => {
        const outcome = await save(draft, budget)
        const error = new Error('refresh unavailable: synthetic-edit-key')
        if (source === 'provider') {
          vi.spyOn(providers, 'providers').mockRejectedValueOnce(error)
        } else if (source === 'credential') {
          vi.spyOn(providers, 'credentialSnapshot').mockRejectedValueOnce(error)
        } else {
          vi.spyOn(providers, 'providerStates').mockRejectedValue(error)
        }
        return outcome
      })
      await saveEditSurface()
      expect(await seam.store.list()).toMatchObject([
        { modelLimits: { m1: { outputTokens: 8000 } } },
      ])
      expect(state().notice).toBe(UI_TEXT.providerSavedRefreshFailed)
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.providerSavedRefreshFailed)
      expect(JSON.stringify(state())).not.toContain('synthetic-edit-key')
      expect(warnings.join(' ')).not.toContain('synthetic-edit-key')
      host.dispose()
    },
  )

  it('reports the spending-limit failure too when the saved snapshot cannot refresh', async () => {
    const { seam, providers, post, state, sessionBudget, host } = await editSurface()
    await changeReplyLimit()
    post({
      type: 'providers/prefill',
      providerId: 'custom',
      fields: { sessionBudgetUsd: Usd.from(2).toAmount() },
    })
    vi.spyOn(sessionBudget, 'write').mockRejectedValueOnce(new Error('limit refused'))
    const save = providers.saveDraft
    vi.spyOn(providers, 'saveDraft').mockImplementationOnce(async (draft, budget) => {
      const outcome = await save(draft, budget)
      vi.spyOn(providers, 'credentialSnapshot').mockRejectedValueOnce(
        new Error('refresh unavailable'),
      )
      return outcome
    })
    await saveEditSurface()
    expect(state().notice).toContain(UI_TEXT.providerSaved)
    expect(state().notice).toContain(UI_TEXT.providerRefreshFailed)
    expect(state().notice).toContain(
      fill(UI_TEXT.sessionBudgetPartialSave, { detail: 'limit refused' }),
    )
    expect(await seam.store.list()).toMatchObject([{ modelLimits: { m1: { outputTokens: 8000 } } }])
    expect(sessionBudget.read().effectiveUsd).toBe(Usd.from(0).toAmount())
    host.dispose()
  })

  it('keeps a credential rotated after preflight while the edited provider is written', async () => {
    const { seam, configFile, secrets, state, host } = await editSurface({ flow: 'Change key' })
    await changeReplyLimit()
    await testEditConnection(state)
    const before = await readFile(configFile, 'utf8')
    const writeProviders = seam.store.replaceAll
    vi.spyOn(seam.store, 'replaceAll').mockImplementationOnce(async (entries, options) => {
      const previous = await writeProviders(entries, options)
      await secrets.store(
        `${PROVIDER_SECRET_PREFIX}custom`,
        JSON.stringify({
          v: 1,
          auth: 'apiKey',
          origin: 'https://llm.example',
          secret: 'synthetic-rotated-key',
        }),
      )
      return previous
    })
    await saveEditSurface()
    expect(state().notice).toBe(
      [
        UI_TEXT.providerSaved,
        fill(UI_TEXT.providerKeySaveFailed, { detail: UI_TEXT.providerEditConflict }),
      ].join(' '),
    )
    expect(await readFile(configFile, 'utf8')).not.toBe(before)
    expect(await seam.store.list()).toMatchObject([{ modelLimits: { m1: { outputTokens: 8000 } } }])
    expect(await secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)).toContain('synthetic-rotated-key')
    host.dispose()
  })

  it.each(['entry', 'key', 'default', 'limit'] as const)(
    'keeps the exact %s outcome when its post-save panel refresh also fails (RVPROVWIZ8C P2-3)',
    async (step) => {
      const f = await editSurface({
        flow: step === 'key' ? 'Change key' : 'Edit',
        defaultModel: 'another/m1',
      })
      await changeReplyLimit()
      const before = await readFile(f.configFile, 'utf8')
      let expected: string
      switch (step) {
        case 'entry': {
          vi.spyOn(f.seam.store, 'replaceAll').mockRejectedValueOnce(new Error('entry refused'))
          expected = 'entry refused'
          break
        }
        case 'key': {
          await testEditConnection(f.state)
          vi.spyOn(f.secrets, 'store').mockRejectedValueOnce(new Error('key refused'))
          expected = [
            UI_TEXT.providerSaved,
            fill(UI_TEXT.providerKeySaveFailed, { detail: 'key refused' }),
          ].join(' ')
          break
        }
        case 'default': {
          f.post({
            type: 'providers/prefill',
            providerId: 'custom',
            fields: { defaultModel: 'custom/m1' },
          })
          await waitFor(() => {
            expect(f.state().drafts.edits['custom']?.defaultModel).toBe('custom/m1')
          })
          vi.spyOn(f.seam.store, 'setDefaultModel').mockRejectedValueOnce(
            new Error('default refused'),
          )
          expected = [
            UI_TEXT.providerSaved,
            fill(UI_TEXT.providerDefaultSaveFailed, { detail: 'default refused' }),
          ].join(' ')
          break
        }
        case 'limit': {
          f.post({
            type: 'providers/prefill',
            providerId: 'custom',
            fields: { sessionBudgetUsd: Usd.from(2).toAmount() },
          })
          await waitFor(() => {
            expect(f.state().drafts.edits['custom']?.sessionBudgetUsd).toBe(Usd.from(2).toAmount())
          })
          vi.spyOn(f.sessionBudget, 'write').mockRejectedValueOnce(new Error('limit refused'))
          expected = [
            UI_TEXT.providerSaved,
            fill(UI_TEXT.sessionBudgetPartialSave, { detail: 'limit refused' }),
          ].join(' ')
          break
        }
      }
      const save = f.providers.saveDraft
      vi.spyOn(f.providers, 'saveDraft').mockImplementationOnce(async (...args) => {
        try {
          return await save(...args)
        } finally {
          vi.spyOn(f.providers, 'providerStates').mockRejectedValueOnce(
            new Error('panel refresh unavailable: synthetic-edit-key'),
          )
        }
      })
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
      await waitFor(() => {
        if (step === 'entry')
          expect(f.state().drafts.edits['custom']?.errors).toEqual([
            expected,
            UI_TEXT.providerRefreshFailed,
          ])
        else expect(f.state().notice).toBe([expected, UI_TEXT.providerRefreshFailed].join(' '))
      })
      if (step === 'entry') expect(await readFile(f.configFile, 'utf8')).toBe(before)
      else {
        expect(f.state().drafts.edits['custom']).toBeUndefined()
        expect(
          screen.getByText([expected, UI_TEXT.providerRefreshFailed].join(' ')),
        ).toHaveAttribute('role', 'status')
        expect(await f.seam.store.list()).toMatchObject([
          { modelLimits: { m1: { outputTokens: 8000 } } },
        ])
      }
      expect(await f.seam.store.defaultModel()).toBe('another/m1')
      expect(f.sessionBudget.read().effectiveUsd).toBe(Usd.from(0).toAmount())
      expect(f.saved).not.toHaveBeenCalled()
      expect(JSON.stringify(f.state())).not.toContain('synthetic-edit-key')
      expect(f.warnings.join(' ')).not.toContain('synthetic-edit-key')
      f.host.dispose()
    },
  )

  it.each([undefined, 'https://new.example', 'https://llm.example'])(
    'repairs an origin-refused key after reopening unless it changed elsewhere (%s)',
    async (concurrentOrigin) => {
      const f = await editSurface()
      fireEvent.change(screen.getByLabelText(UI_TEXT.providerFields.address), {
        target: { value: 'https://new.example/v1' },
      })
      await waitFor(() => {
        expect(f.state().drafts.edits['custom']?.address).toBe('https://new.example/v1')
      })
      fakeWindow.showInputBox.mockResolvedValueOnce('synthetic-new-origin-key')
      f.post({ type: 'providers/enterKey', providerId: 'custom', mode: 'change' })
      await waitFor(() => {
        expect(f.state().drafts.edits['custom']?.keyPresent).toBe(true)
      })
      await testEditConnection(f.state)
      vi.spyOn(f.secrets, 'store').mockRejectedValueOnce(new Error('key refused'))
      await saveEditSurface()
      expect(f.state().providers[0]?.address).toBe('https://new.example/v1')
      expect(f.state().providers[0]?.key.state).toBe('missing')
      expect(f.state().notice).toBe(
        [
          UI_TEXT.providerSaved,
          fill(UI_TEXT.providerKeySaveFailed, { detail: 'key refused' }),
        ].join(' '),
      )
      const [entry] = await f.seam.store.list()
      if (entry === undefined) throw new Error('Missing fixture provider')
      await expect(f.providers.storedCredential(entry)).rejects.toThrow(UI_TEXT.importNeedsKey)
      expect(await f.secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)).toContain('synthetic-edit-key')
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
      await waitFor(() => {
        expect(screen.getByLabelText(UI_TEXT.providerFields.address)).toHaveValue(
          'https://new.example/v1',
        )
      })
      expect(f.state().drafts.edits['custom']?.keyPresent).toBe(false)
      fakeWindow.showInputBox.mockResolvedValueOnce('synthetic-repair-key')
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.changeKey }))
      await testEditConnection(f.state)
      const beforeRepair = await readFile(f.configFile, 'utf8')
      if (concurrentOrigin === undefined) {
        await saveEditSurface()
        expect(f.state().providers[0]?.key.state).toBe('stored')
        expect(await f.providers.storedCredential(entry)).toBe('synthetic-repair-key')
      } else {
        await f.secrets.store(
          `${PROVIDER_SECRET_PREFIX}custom`,
          JSON.stringify({
            v: 1,
            auth: 'apiKey',
            origin: concurrentOrigin,
            secret: 'synthetic-concurrent-key',
          }),
        )
        fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
        await waitFor(() => {
          expect(f.state().drafts.edits['custom']?.errors).toEqual([UI_TEXT.providerEditConflict])
        })
        expect(await f.secrets.get(`${PROVIDER_SECRET_PREFIX}custom`)).toContain(
          'synthetic-concurrent-key',
        )
      }
      expect(await readFile(f.configFile, 'utf8')).toBe(beforeRepair)
      expect(await f.seam.store.defaultModel()).toBe('custom/m1')
      expect(f.sessionBudget.writes).toEqual([])
      const published = JSON.stringify(f.state()) + f.warnings.join(' ')
      for (const secret of [
        'synthetic-edit-key',
        'synthetic-new-origin-key',
        'synthetic-repair-key',
        'synthetic-concurrent-key',
      ]) {
        expect(published).not.toContain(secret)
      }
      f.host.dispose()
    },
  )

  it('queues one Save, disables the form and keeps its successful outcome on duplicate delivery', async () => {
    const { seam, providers, post, state, host } = await editSurface()
    await changeReplyLimit()
    const heldSave = Promise.withResolvers<undefined>()
    const save = providers.saveDraft
    const held = vi.spyOn(providers, 'saveDraft').mockImplementation(async (draft, budget) => {
      await heldSave.promise
      return await save(draft, budget)
    })
    post({ type: 'providers/save', providerId: 'custom', useNow: false })
    post({ type: 'providers/save', providerId: 'custom', useNow: false })
    await waitFor(() => {
      expect(held).toHaveBeenCalledOnce()
    })
    expect(screen.getByRole('button', { name: UI_TEXT.saveProvider })).toBeDisabled()
    heldSave.resolve(undefined)
    await waitFor(() => {
      expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    })
    expect(held).toHaveBeenCalledOnce()
    expect(await seam.store.list()).toMatchObject([{ modelLimits: { m1: { outputTokens: 8000 } } }])
    expect(state().notice).toBe(
      fill(UI_TEXT.setupComplete, { provider: 'Custom Server', model: 'custom/m1' }),
    )
    post({ type: 'providers/save', providerId: 'custom', useNow: false })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
    await waitFor(() => {
      expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
    })
    expect(held).toHaveBeenCalledOnce()
    expect(state().notice).toBe(
      fill(UI_TEXT.setupComplete, { provider: 'Custom Server', model: 'custom/m1' }),
    )
    host.dispose()
  })

  it('the first wizard Save owns duplicate deliveries and unlocks its draft after failure', async () => {
    const { seam, providers, post, state, host } = await editSurface()
    post({ type: 'providers/select', presetId: 'openrouter' })
    await waitFor(() => {
      expect(state().drafts.wizard?.presetId).toBe('openrouter')
    })
    fakeWindow.showInputBox.mockResolvedValueOnce('sk-or-synthetic-wizard-key')
    post({ type: 'providers/enterKey', mode: 'new' })
    post({ type: 'providers/test', acceptCost: false })
    await waitFor(() => {
      expect(state().drafts.wizard?.test?.status).toBe('ok')
    })
    post({ type: 'models/tick', scope: { scope: 'wizard' }, ref: 'openrouter/m1', ticked: true })
    await waitFor(() => {
      expect(state().drafts.wizard?.models).toEqual(['m1'])
    })
    const heldSave = Promise.withResolvers<undefined>()
    const held = vi.spyOn(providers, 'saveDraft').mockImplementationOnce(async () => {
      await heldSave.promise
      throw new Error('disk full: sk-or-synthetic-wizard-key')
    })
    post({ type: 'providers/save', useNow: false })
    post({ type: 'providers/save', useNow: false })
    await waitFor(() => {
      expect(held).toHaveBeenCalledOnce()
    })
    expect(state().drafts.wizard?.saving).toBe(true)
    heldSave.resolve(undefined)
    await waitFor(() => {
      expect(state().drafts.wizard?.errors).toEqual(['disk full: [redacted]'])
      expect(state().drafts.wizard?.saving).toBe(false)
    })
    expect(held).toHaveBeenCalledOnce()
    const failedEntries = await seam.store.list()
    expect(failedEntries.map((entry) => entry.id)).toEqual(['custom'])
    post({ type: 'providers/save', useNow: false })
    await waitFor(() => {
      expect(state().drafts.wizard).toBeUndefined()
    })
    expect(held).toHaveBeenCalledTimes(2)
    const savedEntries = await seam.store.list()
    expect(savedEntries.map((entry) => entry.id)).toEqual(['custom', 'openrouter'])
    expect(await seam.store.defaultModel()).toBe('openrouter/m1')
    host.dispose()
  })

  it('private-network refusal keeps limits and says to confirm access before retrying', async () => {
    const entry: ProviderEntry = {
      id: 'custom',
      preset: 'custom',
      address: 'https://192.168.1.20/v1',
      auth: 'apiKey',
      format: 'chat',
      models: ['m1'],
      privateNetwork: true,
      modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
    }
    const confirmPrivateNetwork = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { seam, state, host } = await editSurface({ entry, confirmPrivateNetwork })
    expect(state().drafts.edits['custom']?.privateConfirmed).toBe(true)
    await changeReplyLimit()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(screen.getByText(UI_TEXT.providerPrivateConfirm)).toBeDefined()
    })
    expect(await seam.store.list()).toEqual([entry])
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
    await waitFor(() => {
      expect(screen.queryByLabelText(UI_TEXT.customLimitsOutput)).toBeNull()
    })
    expect(confirmPrivateNetwork).toHaveBeenCalledTimes(2)
    expect(await seam.store.list()).toMatchObject([
      { privateNetwork: true, modelLimits: { m1: { outputTokens: 8000 } } },
    ])
    host.dispose()
  })

  it('reports the production writer refusing an invalid entry without exposing file contents', async () => {
    const { seam, configFile, host } = await editSurface()
    const before = await readFile(configFile, 'utf8')
    const entries = await seam.store.list()
    await expect(
      seam.store.replaceAll(
        entries.map((entry) => ({
          ...entry,
          modelLimits: { m1: { contextTokens: 1, outputTokens: 2 } },
        })),
      ),
    ).rejects.toThrow(fill(UI_TEXT.providerSaveFailed, { reason: 'invalid' }))
    expect(await readFile(configFile, 'utf8')).toBe(before)
    host.dispose()
  })

  it.each(['address', 'key', 'format', 'failed test'] as const)(
    'keeps limits while requiring a passing connection test (%s)',
    async (field) => {
      const { seam, providers, post, state, host } = await editSurface()
      await changeReplyLimit()
      switch (field) {
        case 'address': {
          fireEvent.change(screen.getByLabelText(UI_TEXT.providerFields.address), {
            target: { value: 'https://llm.example/v2' },
          })
          await waitFor(() => {
            expect(screen.getByLabelText(UI_TEXT.providerFields.address)).toHaveValue(
              'https://llm.example/v2',
            )
          })

          break
        }
        case 'key': {
          fakeWindow.showInputBox.mockResolvedValueOnce('synthetic-new-key')
          fireEvent.click(screen.getByRole('button', { name: UI_TEXT.changeKey }))

          break
        }
        case 'failed test': {
          vi.spyOn(providers, 'testCredential').mockResolvedValueOnce({
            kind: 'failed',
            detail: 'refused',
          })
          fireEvent.click(screen.getByRole('button', { name: UI_TEXT.testConnection }))
          await waitFor(() => {
            expect(state().drafts.edits['custom']?.test?.status).toBe('failed')
          })

          break
        }
        default: {
          post({
            type: 'providers/prefill',
            providerId: 'custom',
            fields: { customFormat: 'responses' },
          })
        }
      }
      const save = vi.spyOn(providers, 'saveDraft')
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveProvider }))
      await waitFor(() => {
        expect(screen.getByText(UI_TEXT.providerText.wizard.test)).toBeDefined()
      })
      expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
      expect(save).not.toHaveBeenCalled()
      const unchanged = await seam.store.list()
      expect(unchanged[0]?.modelLimits?.['m1']?.outputTokens).toBe(4000)
      host.dispose()
    },
  )
})
