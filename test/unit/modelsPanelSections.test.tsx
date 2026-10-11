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
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { fill } from '../../src/shared/l10n/text'
import type {
  ImportPreview,
  ModelsPanelState,
  ModelsWizardStep,
  PanelToHostMessage,
  PresetCard,
} from '../../src/shared/modelsPanel'
import { ModelsSection } from '../../src/webview/models/ModelsSection'
import { ProvidersSection } from '../../src/webview/models/ProvidersSection'
import type { SectionProps } from '../../src/webview/models/sections'
import { Wizard } from '../../src/webview/models/Wizard'
import { loadMoneyDisplay } from '../../src/webview/money'
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

const CHATGPT_CARD: PresetCard = {
  id: 'chatgpt',
  label: 'ChatGPT',
  description: 'ChatGPT Plus and Pro accounts',
  category: 'subscription',
  format: 'responses',
  originKind: 'fixed',
  originDisplay: 'https://api.openai.com',
  auth: 'subscription',
  connectOAuth: true,
  keyHint: '',
}

const COPILOT_CARD: PresetCard = {
  id: 'copilot',
  label: 'Copilot',
  description: 'Copilot models granted to VS Code',
  category: 'subscription',
  format: 'chat',
  originKind: 'fixed',
  originDisplay: 'https://github.com/copilot',
  auth: 'subscription',
  connectOAuth: false,
  keyHint: '',
}

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

/**
 * Opens the wizard's provider picker over the ChatGPT and Copilot cards with
 * `availability`, focused, and returns its box.
 */
function focusSignInPicker(
  post: (message: PanelToHostMessage) => void,
  availability: Partial<ModelsPanelState>,
): HTMLElement {
  const state = makeState({
    presets: [CHATGPT_CARD, COPILOT_CARD],
    ...availability,
    drafts: { edits: {}, wizard: makeDraft() },
  })
  render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
  const box = screen.getByRole('combobox')
  fireEvent.focus(box)
  return box
}

/** The usual local servers, each on its usual port. */
const LOCAL_SERVERS = [
  { presetId: 'ollama', label: 'Ollama', port: 11_434 },
  { presetId: 'lmstudio', label: 'LM Studio', port: 1234 },
]

/** The Providers section after a local scan that checked both usual servers. */
function renderLocalScan(
  post: (message: PanelToHostMessage) => void,
  found: typeof LOCAL_SERVERS,
): void {
  const state = makeState({ localScan: { found, checked: LOCAL_SERVERS } })
  render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
}

/** The suggestions step over a $5 spending limit effective from `scope`. */
function renderBudgetStep(post: (message: PanelToHostMessage) => void, scope: string): void {
  render(
    <Wizard
      life={OPEN_WIZARD}
      panelState={makeState({
        suggestions: [makeSuggestion('defaultModel')],
        sessionBudget: {
          effectiveUsd: Usd.from(5).toAmount(),
          nowLine: fill(UI_TEXT.wizardSessionBudgetNow, { amount: formatUsd('5'), scope }),
        },
      })}
      draft={makeDraft({ step: 'suggestions', presetId: 'openrouter', blockers: [] })}
      post={post}
      onNavigateModels={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

/** Types `value` into the spending-limit field. */
function typeBudget(value: string): void {
  fireEvent.change(screen.getByLabelText(UI_TEXT.wizardSessionBudget), {
    target: { value },
  })
}

describe('ProvidersSection', () => {
  it('keeps optional OAuth actions hidden and absent usage unknown when a host does not supply bindings', () => {
    const post = vi.fn()
    const state = makeState({
      providers: [makeProvider({ id: 'openrouter', presetId: 'openrouter', auth: 'apiKey' })],
    })
    state.presets = state.presets.map((preset) => ({ ...preset, connectOAuth: false }))
    const { rerender } = render(<ProvidersSection {...props(state, post)} />)
    expect(screen.queryByRole('button', { name: UI_TEXT.reconnectAccount })).toBeNull()
    expect(screen.queryByText(UI_TEXT.usageKeyUsage)).toBeNull()
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
    expect(screen.queryByRole('button', { name: 'Connect OpenRouter Account' })).toBeNull()
    expect(
      screen.getByText(
        'Connect your OpenRouter account and view the key’s usage, limit and remaining balance.',
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
    // The host owns draft retirement; cancellation closes on its acknowledgement.
    expect(screen.getByLabelText(UI_TEXT.providerFields.address)).toBeDefined()
    rerender(<ProvidersSection {...props({ ...state, drafts: { edits: {} } }, post)} />)
    expect(screen.queryByLabelText(UI_TEXT.providerFields.address)).toBeNull()
  })

  it('offers the wizard from an empty first run', () => {
    const dispatch = vi.fn()
    render(<ProvidersSection {...props(makeState(), vi.fn(), { dispatch })} />)
    expect(screen.getByText(UI_TEXT.modelsEmpty)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-wizard' })
  })

  it("shows and edits a saved custom provider's model limits", () => {
    const post = vi.fn()
    const draft = makeDraft({
      presetId: 'custom',
      models: ['m1'],
      blockers: [],
      modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
    })
    const state = makeState({
      providers: [makeProvider({ id: 'custom', presetId: 'custom', models: ['m1'] })],
      drafts: { edits: { custom: draft } },
    })
    render(<ProvidersSection {...props(state, post)} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
    expect(screen.getByLabelText(UI_TEXT.customLimitsContext)).toHaveProperty('value', '128000')
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveProperty('value', '4000')
    fireEvent.change(screen.getByLabelText(UI_TEXT.customLimitsOutput), {
      target: { value: '8000' },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      providerId: 'custom',
      fields: { modelLimits: { m1: { contextTokens: 128_000, outputTokens: 8000 } } },
    })
  })

  it('disables both wizard Save controls while the host owns its save', () => {
    const post = vi.fn()
    const draft = makeDraft({ step: 'confirm', blockers: [], saving: true })
    render(
      <Wizard
        life={OPEN_WIZARD}
        panelState={makeState()}
        draft={draft}
        post={post}
        onNavigateModels={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const save = screen.getByRole('button', { name: UI_TEXT.saveProvider })
    const useNow = screen.getByRole('button', { name: UI_TEXT.saveAndUseNow })
    expect(save).toBeDisabled()
    expect(useNow).toBeDisabled()
    fireEvent.click(save)
    fireEvent.click(useNow)
    expect(post).not.toHaveBeenCalled()
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

  it('hides Copilot in a confidential workspace and offers ChatGPT', () => {
    const post = vi.fn()
    focusSignInPicker(post, {
      subscriptionsAvailable: true,
      copilotAvailable: false,
      confidentialWorkspace: true,
    })
    expect(screen.queryByText('Copilot')).toBeNull()
    expect(screen.getByText('ChatGPT')).toBeDefined()
  })

  it('disables ChatGPT in a remote window with its reason and never selects it', () => {
    const post = vi.fn()
    const box = focusSignInPicker(post, {
      subscriptionsAvailable: true,
      copilotAvailable: true,
      remoteWindow: true,
    })
    const reason = screen.getByText(UI_TEXT.signInRemoteWindow)
    expect(reason.closest('li')?.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(box, { target: { value: 'ChatGPT' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.mouseDown(reason.closest('li') ?? fail('chatgpt row missing'))
    expect(post).not.toHaveBeenCalled()
  })

  it('disables a sign-in with no connector as not offered, and picks an offered one', () => {
    const post = vi.fn()
    const box = focusSignInPicker(post, { subscriptionsAvailable: false, copilotAvailable: true })
    const reason = screen.getByText(UI_TEXT.signInNotOffered)
    expect(reason.closest('li')?.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(box, { target: { value: 'ChatGPT' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(post).not.toHaveBeenCalledWith({ type: 'providers/select', presetId: 'chatgpt' })
    fireEvent.change(box, { target: { value: 'Copilot' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(post).toHaveBeenCalledWith({ type: 'providers/select', presetId: 'copilot' })
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

  it('offers each answering server and fills its port on choice', () => {
    const post = vi.fn()
    renderLocalScan(post, LOCAL_SERVERS)
    fireEvent.click(screen.getByRole('button', { name: 'Ollama on Port 11434' }))
    expect(post).toHaveBeenNthCalledWith(1, { type: 'providers/select', presetId: 'ollama' })
    expect(post).toHaveBeenNthCalledWith(2, {
      type: 'providers/prefill',
      fields: { loopbackPort: 11_434 },
    })
  })

  it('says nothing is running and names each usual port', () => {
    const post = vi.fn()
    renderLocalScan(post, [])
    expect(screen.getByText('Nothing is running on this computer yet.')).toBeDefined()
    expect(screen.getByText('Ollama on Port 11434')).toBeDefined()
    expect(screen.getByText('LM Studio on Port 1234')).toBeDefined()
    expect(post).not.toHaveBeenCalled()
  })

  it('enters the key outside the webview and connects OAuth', () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({ step: 'credential', presetId: 'openrouter' }),
      },
    })
    const { rerender } = render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.enterKey }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/enterKey', mode: 'new' })
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter Account' }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/connect' })
    const draft = state.drafts.wizard
    if (draft === undefined) throw new Error('Expected a wizard draft')
    draft.connecting = true
    rerender(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    expect(screen.getByRole('button', { name: 'Connect OpenRouter Account' })).toBeDisabled()
    expect(screen.getByText('Waiting for OpenRouter in the browser…')).toBeVisible()
    draft.connecting = false
    rerender(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    expect(screen.getByRole('button', { name: 'Connect OpenRouter Account' })).toBeEnabled()
    expect(screen.queryByText('Waiting for OpenRouter in the browser…')).toBeNull()
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
    await loadMoneyDisplay()
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

  it('asks each ticked custom model for its limits and gates Continue on them', () => {
    const post = vi.fn()
    const state = makeState({
      models: [
        makeRow({
          ref: 'custom/m1',
          providerId: 'custom',
          modelId: 'm1',
          contextTokens: 128_000,
          ticked: true,
        }),
      ],
      totalModels: 1,
      drafts: {
        edits: {},
        wizard: makeDraft({
          step: 'models',
          presetId: 'custom',
          models: ['m1'],
          modelLimits: { m1: { contextTokens: 128_000 } },
          blockers: [UI_TEXT.customLimitsMissing],
        }),
      },
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    // The scan's reported window is filled; the longest reply is asked.
    expect(screen.getByLabelText(UI_TEXT.customLimitsContext)).toHaveProperty('value', '128000')
    expect(screen.getByLabelText(UI_TEXT.customLimitsOutput)).toHaveProperty('value', '')
    expect(screen.getByText(UI_TEXT.customLimitsMissing)).toBeDefined()
    expect(screen.getByRole('button', { name: UI_TEXT.wizardContinue })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.change(screen.getByLabelText(UI_TEXT.customLimitsOutput), {
      target: { value: '4000' },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      fields: { modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } } },
    })
  })

  it('shows a saved provider with a refused card as unavailable with its reason', () => {
    const post = vi.fn()
    const state = makeState({
      providers: [
        makeProvider({
          id: 'mistral-plan',
          presetId: 'mistral-plan',
          label: 'Mistral plan',
          unavailable: 'Mistral plan is unavailable: its preset changed.',
        }),
      ],
    })
    render(<ProvidersSection {...props(state, post)} />)
    expect(screen.getByText('Mistral plan is unavailable: its preset changed.')).toBeDefined()
    expect(screen.queryByRole('button', { name: UI_TEXT.testConnection })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerRemove }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/remove', providerId: 'mistral-plan' })
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
    const zdr = screen.getByRole('radio', { name: /No Data Retention/ })
    expect((zdr as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /No Training/ }))
    expect(post).toHaveBeenCalledWith({
      type: 'providers/prefill',
      fields: { privacy: 'no-training' },
    })
  })

  it('accepts the suggested default and commits the typed spending limit on Continue', () => {
    const post = vi.fn()
    const state = makeState({
      drafts: {
        edits: {},
        wizard: makeDraft({
          step: 'suggestions',
          presetId: 'ollama',
          auth: 'none',
          blockers: [],
        }),
      },
      suggestions: [makeSuggestion('defaultModel'), makeSuggestion('sessionBudget')],
    })
    render(<ProvidersSection {...props(state, post, { wizardOpen: true })} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.suggestionAccept }))
    expect(post).toHaveBeenCalledWith({ type: 'suggestions/accept', kind: 'defaultModel' })
    // The spending limit is a field now, not a second suggestion card: the
    // typed number is committed on Continue, with no Change press.
    fireEvent.change(screen.getByLabelText(UI_TEXT.wizardSessionBudget), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    expect(post).toHaveBeenCalledWith({
      type: 'suggestions/change',
      kind: 'sessionBudget',
      usd: Usd.from(5).toAmount(),
      expectedUsd: '0',
    })
    expect(post).toHaveBeenCalledWith({ type: 'providers/wizard', event: 'next' })
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
    expect(screen.getByText(UI_TEXT.importNeedsKeyLabel)).toBeDefined()
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

  it('shows the spending limit as the conversation setting, prefilled with what it is now', () => {
    const post = vi.fn()
    renderBudgetStep(post, UI_TEXT.sessionBudgetScopeWorkspace)
    expect(screen.getByText(UI_TEXT.wizardSessionBudget)).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>(UI_TEXT.wizardSessionBudget).value).toBe('5')
    // One line names the setting for every conversation, its current
    // value, and which scope it is effective from.
    expect(
      screen.getByText(
        fill(UI_TEXT.wizardSessionBudgetNow, {
          amount: formatUsd('5'),
          scope: UI_TEXT.sessionBudgetScopeWorkspace,
        }),
      ),
    ).toBeDefined()
  })

  it('commits the typed spending limit on Continue, with no separate Change press', () => {
    const post = vi.fn()
    renderBudgetStep(post, UI_TEXT.sessionBudgetScopeGlobal)
    typeBudget('2')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    expect(post).toHaveBeenNthCalledWith(1, {
      type: 'suggestions/change',
      kind: 'sessionBudget',
      usd: '2',
      expectedUsd: '5',
    })
    expect(post).toHaveBeenNthCalledWith(2, { type: 'providers/wizard', event: 'next' })
  })

  it.each([
    { initial: 0, edited: undefined },
    { initial: 5, edited: '0' },
  ])('retains the edit and prefill only when edited (initial=$initial)', ({ initial, edited }) => {
    const post = vi.fn()
    const draft = makeDraft({ step: 'suggestions', presetId: 'openrouter', blockers: [] })
    const view = (effective: number) => (
      <Wizard
        life={OPEN_WIZARD}
        panelState={makeState({
          sessionBudget: { effectiveUsd: Usd.from(effective).toAmount(), nowLine: '' },
        })}
        draft={draft}
        post={post}
        onNavigateModels={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const { rerender } = render(view(initial))
    if (edited !== undefined) {
      typeBudget(edited)
    }
    rerender(view(2))
    expect(screen.getByLabelText(UI_TEXT.wizardSessionBudget)).toHaveProperty(
      'value',
      edited ?? '2',
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    if (edited === undefined) {
      expect(post.mock.calls).toEqual([[{ type: 'providers/wizard', event: 'next' }]])
    } else {
      expect(post.mock.calls[0]).toEqual([
        { type: 'suggestions/change', kind: 'sessionBudget', usd: edited, expectedUsd: '5' },
      ])
    }
  })

  it('disables Continue while the spending limit is not a non-negative amount', () => {
    const post = vi.fn()
    renderBudgetStep(post, UI_TEXT.sessionBudgetScopeGlobal)
    // Nothing is saved until the field holds a non-negative dollar amount:
    // an unparseable number disables Continue instead of posting it, and
    // the wording of the failure stays host-side with the write.
    typeBudget('-3')
    expect(
      screen.getByRole('button', { name: UI_TEXT.wizardContinue }).getAttribute('disabled'),
    ).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    expect(post).not.toHaveBeenCalled()
  })
})

describe('ModelsSection', () => {
  it.each([
    { name: 'Models', Section: ModelsSection },
    { name: 'Providers', Section: ProvidersSection },
  ])('F7: $name clears failed scanning/cancel and offers retry', ({ Section }) => {
    const post = vi.fn()
    const state = makeState({
      providers: [makeProvider({ id: 'openrouter' })],
      scans: {
        openrouter: {
          providerId: 'openrouter',
          status: 'failed',
          detail: UI_TEXT.providerProbeUnparseable,
        },
      },
    })
    render(<Section {...props(state, post)} />)
    expect(
      screen.getByText(fill(UI_TEXT.scanFailed, { detail: UI_TEXT.providerProbeUnparseable })),
    ).toBeDefined()
    expect(screen.queryByText(UI_TEXT.providersScanning)).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.wizardCancel })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.refreshModels }))
    expect(post).toHaveBeenCalledWith({ type: 'models/scan', providerId: 'openrouter' })
  })
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
