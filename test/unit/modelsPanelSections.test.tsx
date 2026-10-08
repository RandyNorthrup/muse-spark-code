import { Usd } from '../../src/shared/usd'
// @vitest-environment jsdom
// The Providers and Models sections with the wizard: every wizard step,
// the provider rows with their key and test states, the undo bar, the
// import preview, and the Models table's tick, pin, sort and filter
// messages. The webview only renders and asks — each test names the
// message its control posts.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type {
  ImportPreview,
  ModelsPanelState,
  ModelsWizardStep,
  PanelToHostMessage,
} from '../../src/shared/modelsPanel'
import { ModelsSection } from '../../src/webview/models/ModelsSection'
import { ProvidersSection } from '../../src/webview/models/ProvidersSection'
import type { SectionProps } from '../../src/webview/models/sections'
import { Wizard } from '../../src/webview/models/Wizard'
import {
  makeDraft,
  makeKeyUsage,
  makeProvider,
  makeRow,
  makeState,
  makeSuggestion,
  makeTest,
} from './modelsPanelFixtures'

function fail(message: string): never {
  throw new Error(message)
}

/** A wizard whose draft stays current (the lifecycle races run on the real panel). */
const OPEN_WIZARD = { generation: 1, isCurrent: (generation: number) => generation === 1 }

function props(
  state: ModelsPanelState,
  post: (message: PanelToHostMessage) => void,
  extra: Partial<SectionProps> = {},
): SectionProps {
  return {
    panelState: state,
    post,
    navigate: vi.fn(),
    dispatch: vi.fn(),
    wizardOpen: false,
    wizardLife: OPEN_WIZARD,
    importOpen: false,
    highlightedItem: undefined,
    ...extra,
  }
}

describe('ProvidersSection', () => {
  it('hides unavailable OpenRouter connect and usage with an honest status (PR136 VE)', () => {
    const post = vi.fn()
    const state = makeState({
      providers: [makeProvider({ id: 'openrouter', presetId: 'openrouter', auth: 'apiKey' })],
    })
    state.presets = state.presets.map((preset) => ({ ...preset, connectOAuth: false }))
    const { rerender } = render(<ProvidersSection {...props(state, post)} />)
    expect(screen.queryByRole('button', { name: UI_TEXT.reconnectAccount })).toBeNull()
    expect(
      screen.getByText(
        'OpenRouter account connection and key usage are not available yet. Paste a key to use models.',
      ),
    ).toBeDefined()
    rerender(
      <ProvidersSection
        {...props(
          {
            ...state,
            providers: [],
            drafts: {
              edits: {},
              wizard: makeDraft({ step: 'credential', presetId: 'openrouter' }),
            },
          },
          post,
          { wizardOpen: true },
        )}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Connect OpenRouter account' })).toBeNull()
    expect(
      screen.getByText(
        'OpenRouter account connection and key usage are not available yet. Paste a key to use models.',
      ),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.enterKey }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/enterKey', mode: 'new' })
  })
  it('connects subscription actions from explicit clicks and hides Copilot when the host refuses it', () => {
    const post = vi.fn()
    const state = makeState({ subscriptionsAvailable: true, copilotAvailable: true })
    const { rerender } = render(<ProvidersSection {...props(state, post)} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.acpChatGpt.actions.add }))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.copilotConnect }))
    expect(post.mock.calls).toEqual([
      [{ type: 'providers/connectSubscription', providerId: 'chatgpt' }],
      [{ type: 'providers/connectSubscription', providerId: 'copilot' }],
    ])
    rerender(<ProvidersSection {...props({ ...state, copilotAvailable: false }, post)} />)
    expect(screen.queryByRole('button', { name: UI_TEXT.planUi.copilotConnect })).toBeNull()
  })

  it('requests an edit draft and targets changes and cancellation to that provider', () => {
    const post = vi.fn()
    const state = makeState({ providers: [makeProvider()] })
    const { rerender } = render(<ProvidersSection {...props(state, post)} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/edit', providerId: 'ollama' })
    rerender(
      <ProvidersSection
        {...props(
          {
            ...state,
            drafts: {
              edits: {
                ollama: makeDraft({ address: 'http://127.0.0.1:11434', blockers: [] }),
              },
            },
          },
          post,
        )}
      />,
    )
    fireEvent.change(screen.getByLabelText(UI_TEXT.providerFields.address), {
      target: { value: 'http://127.0.0.1:11435' },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      providerId: 'ollama',
      fields: { address: 'http://127.0.0.1:11435' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(post).toHaveBeenCalledWith({
      type: 'providers/wizard',
      event: 'cancel',
      providerId: 'ollama',
    })
    expect(screen.queryByLabelText(UI_TEXT.providerFields.address)).toBeNull()
  })

  it('offers the wizard from an empty first run', () => {
    const dispatch = vi.fn()
    render(<ProvidersSection {...props(makeState(), vi.fn(), { dispatch })} />)
    expect(screen.getByText(UI_TEXT.modelsEmpty)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-wizard' })
  })

  it('lists a provider with its key state and removes with Undo', () => {
    const post = vi.fn()
    const state = makeState({
      providers: [makeProvider()],
      pendingRemovals: [{ providerId: 'openrouter', label: 'OpenRouter' }],
    })
    render(<ProvidersSection {...props(state, post)} />)
    expect(screen.getByText('Ollama')).toBeDefined()
    expect(screen.getByText(UI_TEXT.keyMissing)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerRemove }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/remove', providerId: 'ollama' })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.undoAction }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/undoRemove', providerId: 'openrouter' })
  })

  it('picks a provider from the wizard search', () => {
    const post = vi.fn()
    const state = makeState({ drafts: { edits: {}, wizard: makeDraft() } })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'Ollama' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(post).toHaveBeenCalledWith({ type: 'providers/select', presetId: 'ollama' })
  })

  it('prefills the loopback port where the preset allows it', () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'configure', presetId: 'ollama', auth: 'none' }),
      },
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    fireEvent.change(screen.getByLabelText(UI_TEXT.providerDetailFields.loopbackPort), {
      target: { value: '11434' },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      fields: { loopbackPort: 11_434 },
    })
  })

  it('enters the key outside the webview and connects OAuth', () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'credential', presetId: 'openrouter' }),
      },
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.enterKey }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/enterKey', mode: 'new' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter account' }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/connect' })
  })

  it('tests free, then accepts the paid check only after its cost', async () => {
    const post = vi.fn()
    const testing = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'test', presetId: 'openrouter' }),
      },
    })
    const { rerender } = render(
      <ProvidersSection {...props(testing, post, { wizardOpen: true })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.testConnection }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/test', acceptCost: false })
    rerender(
      <ProvidersSection
        {...props(
          makeState({
            drafts: {
              edits: {},
              wizard: makeDraft({
                step: 'test',
                presetId: 'openrouter',
                test: makeTest({ status: 'needs-cost', costUsd: Usd.from(0.000002).toAmount() }),
              }),
            },
          }),
          post,
          { wizardOpen: true },
        )}
      />,
    )
    // Accept waits for the stated cost (STARTUP017): the money chunk is lazy.
    const accept = screen.getByRole('button', { name: UI_TEXT.suggestionAccept })
    await waitFor(() => {
      expect(accept).toBeEnabled()
    })
    fireEvent.click(accept)
    expect(post).toHaveBeenCalledWith({ type: 'providers/test', acceptCost: true })
  })

  it('ticks the draft models as a delta', () => {
    const post = vi.fn()
    const state = makeState({
      models: [makeRow()],
      totalModels: 1,
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'models', presetId: 'ollama', auth: 'none' }),
      },
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(post).toHaveBeenCalledWith({
      type: 'models/tick',
      scope: { scope: 'wizard' },
      ref: 'ollama/qwen3:8b',
      ticked: true,
    })
  })

  it('keeps OpenRouter private by default and routes on choice', () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'privacy', presetId: 'openrouter' }),
      },
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    const zdr = screen.getByRole('radio', { name: /No data retention/ })
    expect((zdr as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /No training/ }))
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      fields: { privacy: 'no-training' },
    })
  })

  it('accepts the suggested default and overrides the budget', async () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'suggestions', presetId: 'ollama', auth: 'none' }),
      },
      suggestions: [makeSuggestion('defaultModel'), makeSuggestion('sessionBudget')],
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    const acceptButtons = screen.getAllByRole('button', { name: UI_TEXT.suggestionAccept })
    fireEvent.click(acceptButtons[0] ?? fail('default accept missing'))
    expect(post).toHaveBeenCalledWith({ type: 'suggestions/accept', kind: 'defaultModel' })
    fireEvent.change(screen.getByLabelText(UI_TEXT.suggestSessionBudget), {
      target: { value: '5' },
    })
    const changeButtons = screen.getAllByRole('button', { name: UI_TEXT.suggestionChange })
    fireEvent.click(changeButtons[1] ?? fail('budget change missing'))
    // The positivity check waits for the lazy money chunk (STARTUP017).
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith({
        type: 'suggestions/change',
        kind: 'sessionBudget',
        usd: Usd.from(5).toAmount(),
      })
    })
  })

  it('keeps Save disabled until the form is valid, with each blocker inline', () => {
    const post = vi.fn()
    const blocked = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({
          step: 'confirm',
          presetId: 'ollama',
          auth: 'none',
          blockers: ['Tick at least one model.'],
        }),
      },
    })
    const { rerender } = render(
      <ProvidersSection {...props(blocked, post, { wizardOpen: true })} />,
    )
    const save = screen.getByRole('button', { name: UI_TEXT.saveProvider })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByText('Tick at least one model.')).toBeDefined()
    fireEvent.click(save)
    expect(post).not.toHaveBeenCalled()
    rerender(
      <ProvidersSection
        {...props(
          makeState({
            drafts: {
              edits: {},
              wizard: makeDraft({
                step: 'confirm',
                presetId: 'ollama',
                auth: 'none',
                models: ['ollama/qwen3:8b'],
                blockers: [],
              }),
            },
          }),
          post,
          { wizardOpen: true },
        )}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.saveAndUseNow }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/save', useNow: true })
  })

  it('shows a stored key bound to its origin and the key usage', () => {
    const post = vi.fn()
    const state = makeState({
      providers: [
        makeProvider({
          id: 'openrouter',
          presetId: 'openrouter',
          label: 'OpenRouter',
          auth: 'apiKey',
          key: { state: 'stored', origin: 'https://openrouter.ai' },
          keyUsage: makeKeyUsage(),
        }),
      ],
    })
    render(<ProvidersSection {...props(state, post)} />)
    expect(
      screen.getByText(fill(UI_TEXT.keyBoundState, { origin: 'https://openrouter.ai' })),
    ).toBeDefined()
    expect(screen.getByText(UI_TEXT.usageKeyUsage)).toBeDefined()
    expect(screen.getByText(UI_TEXT.usageRemaining)).toBeDefined()
  })

  it('previews an import as a diff with every provider needing a key', () => {
    const post = vi.fn()
    const preview: ImportPreview = {
      providers: [{ id: 'openrouter', label: 'OpenRouter', address: 'https://openrouter.ai' }],
      errors: [],
    }
    const state = makeState({ importPreview: preview })
    render(<ProvidersSection {...props(state, post, { importOpen: true })} />)
    expect(screen.getByText(UI_TEXT.providerImportPreviewTitle)).toBeDefined()
    expect(screen.getByText(UI_TEXT.importUntrusted)).toBeDefined()
    expect(screen.getByText(UI_TEXT.importNeedsKey)).toBeDefined()
    const confirm = screen.getAllByRole('button', { name: UI_TEXT.providerImport }).at(-1)
    fireEvent.click(confirm ?? fail('import confirm missing'))
    expect(post).toHaveBeenCalledWith({
      type: 'providers/import',
      json: '',
      confirmed: true,
    })
  })
})

describe('Wizard', () => {
  // Every step renders its own screen (M95 acceptance 18: the harness
  // covers each state; this pins the step switch underneath it).
  const steps: readonly { readonly step: ModelsWizardStep; readonly marker: string }[] = [
    { step: 'pick-provider', marker: UI_TEXT.wizardPickProvider },
    { step: 'configure', marker: 'https://openrouter.ai' },
    { step: 'credential', marker: UI_TEXT.enterKey },
    { step: 'test', marker: UI_TEXT.testConnection },
    { step: 'models', marker: UI_TEXT.providerFields.models },
    { step: 'privacy', marker: UI_TEXT.privacyNoRetention },
    { step: 'suggestions', marker: UI_TEXT.suggestDefaultModel },
    { step: 'confirm', marker: UI_TEXT.saveProvider },
    { step: 'done', marker: UI_TEXT.saveAndUseNow },
  ]

  it('renders every step', () => {
    for (const { step, marker } of steps) {
      const { unmount } = render(
        <Wizard
          panelState={makeState({
            models: [makeRow()],
            totalModels: 1,
            suggestions: [makeSuggestion('defaultModel')],
          })}
          draft={makeDraft({ step, presetId: 'openrouter', blockers: [] })}
          life={OPEN_WIZARD}
          post={vi.fn()}
          onNavigateModels={vi.fn()}
          onClose={vi.fn()}
        />,
      )
      expect(screen.getByText(marker)).toBeDefined()
      unmount()
    }
  })
})

describe('ModelsSection', () => {
  it('shows badged rows, ticks as a delta, and pins', () => {
    const post = vi.fn()
    const state = makeState({
      models: [makeRow()],
      totalModels: 1,
      scans: { ollama: { providerId: 'ollama', status: 'done', newCount: 1 } },
    })
    render(<ModelsSection {...props(state, post)} />)
    expect(screen.getByRole('row', { name: 'ollama/qwen3:8b' })).toBeDefined()
    expect(screen.getByText(UI_TEXT.modelBadges.recommended)).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: /Offer ollama\/qwen3:8b/ }))
    expect(post).toHaveBeenCalledWith({
      type: 'models/tick',
      scope: { scope: 'provider', providerId: 'ollama' },
      ref: 'ollama/qwen3:8b',
      ticked: false,
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Pin ollama\/qwen3:8b/ }))
    expect(post).toHaveBeenCalledWith({
      type: 'models/pin',
      providerId: 'ollama',
      ref: 'ollama/qwen3:8b',
      pinned: true,
    })
  })

  it('sorts from its headers and filters from the bar', () => {
    const post = vi.fn()
    const state = makeState({ models: [makeRow()], totalModels: 1 })
    render(<ModelsSection {...props(state, post)} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.modelColumns.name }))
    expect(post).toHaveBeenCalledWith({
      type: 'models/filter',
      filter: {},
      sort: { key: 'name', direction: 'desc' },
    })
    fireEvent.change(screen.getByPlaceholderText(UI_TEXT.modelsSearchPlaceholder), {
      target: { value: 'qwen' },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'models/filter',
      filter: { search: 'qwen' },
      sort: { key: 'name', direction: 'asc' },
    })
  })

  it('activates a row with Enter to tick it', () => {
    const post = vi.fn()
    const state = makeState({
      models: [makeRow({ ticked: false })],
      totalModels: 1,
    })
    render(<ModelsSection {...props(state, post)} />)
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(post).toHaveBeenCalledWith({
      type: 'models/tick',
      scope: { scope: 'provider', providerId: 'ollama' },
      ref: 'ollama/qwen3:8b',
      ticked: true,
    })
  })
})
