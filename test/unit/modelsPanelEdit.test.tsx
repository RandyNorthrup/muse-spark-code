// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { createModelsPanel } from '../../src/host/models/modelsPanel'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
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

async function editSurface() {
  const folder = await mkdtemp(path.join(tmpdir(), 'models-edit-'))
  folders.push(folder)
  const configFile = path.join(folder, 'providers.json')
  const seam = createModelsPanelSeam({
    configFile,
    subscriptionModels: () => Promise.resolve([]),
  })
  const { providers } = testProvidersHost({
    deps: {
      store: seam.store,
      catalog: seam.catalog,
      fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
    },
  })
  await providers.saveDraft({
    provider: {
      id: 'custom',
      preset: 'custom',
      address: 'https://llm.example',
      auth: 'apiKey',
      format: 'chat',
      models: ['m1'],
      modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
    },
    credential: 'synthetic-edit-key',
    credentialAuth: 'apiKey',
    defaultModel: 'custom/m1',
    useNow: false,
  })
  const saved = vi.fn()
  const warnings: string[] = []
  const log = {
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: (text: string) => {
      warnings.push(text)
    },
  }
  const host = createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
    providers,
    log,
    sessionBudget: memorySessionBudgetConfig(),
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
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
  await waitFor(() => {
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(4000)
  })
  return { configFile, seam, providers, saved, warnings, host, post, state: () => state }
}

async function changeReplyLimit() {
  fireEvent.change(screen.getByLabelText(UI_TEXT.customLimitsOutput), { target: { value: '8000' } })
  await waitFor(() => {
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveValue(8000)
  })
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
          fill(UI_TEXT.setupComplete, { provider: 'Custom server', model: 'custom/m1' }),
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
