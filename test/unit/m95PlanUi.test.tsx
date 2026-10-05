// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHATGPT_MANAGE_USAGE_URL,
  CHATGPT_PLAN_LIMIT_ERROR_KIND,
  CHATGPT_PLAN_NOTICE_STORAGE_KEY,
  COPILOT_REPORT_URL,
  COPILOT_MANAGE_USAGE_URL,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { planUsageSchema } from '../../src/core/providers/subscriptions/planUsage'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { EMPTY_PAID_TALLY } from '../../src/shared/paid'
import {
  parseHostToWebviewMessage,
  type ModelOption,
  type WebviewToHostMessage,
} from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import {
  PlanSurface,
  PlanUsageSection,
  type PlanNoticePort,
} from '../../src/webview/components/PlanUi'
import { UsageDialog } from '../../src/webview/components/UsageDialog'
import { createUiStore, type UiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { testSettings } from './helpers/fakes'

const model: ModelOption = {
  modelId: 'chatgpt/gpt-6-astra',
  displayLabel: 'GPT-6 Astra',
  isDefault: true,
  providerId: 'chatgpt',
  providerLabel: 'ChatGPT',
  pricing: 'plan',
}
const tallies = [
  {
    providerId: 'chatgpt',
    requests: 4,
    reported: { requests: 1, inputTokens: 1234, outputTokens: 56 },
    estimated: { requests: 2, inputTokens: 2000, outputTokens: 300 },
  },
]
const acknowledged: PlanNoticePort = { isAcknowledged: () => true, acknowledge: vi.fn() }
// Owner run 577bc807, HTTP 200 SSE error; copied exactly from the scrubbed findings.
const CAPTURED_LIMIT_MESSAGE =
  'The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.'

function readyStore(option = model) {
  return createUiStore({
    ...initialUiState,
    phase: 'ready',
    settings: testSettings,
    auth: { status: 'signedIn', detail: undefined, backend: 'modelApi', methods: ['byo'] },
    model: { modelId: option.modelId, contextLimit: undefined },
    models: [option],
  })
}
function showApp(store = readyStore(), planNoticePort: PlanNoticePort | null = acknowledged) {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  const view = render(
    <App
      store={store}
      postMessage={postMessage}
      {...(planNoticePort === null ? {} : { planNoticePort })}
    />,
  )
  return { ...view, store, postMessage }
}
function endTurn(
  store: UiStore,
  reason: string,
  errorKind?: string,
  terminal = 'failed',
  turnId = 't1',
) {
  act(() => {
    store.dispatch({
      type: 'hostMessage',
      at: 0,
      message: {
        type: 'agentEvent',
        event: {
          type: 'turnCompleted',
          turnId,
          terminal,
          reason,
          ...(errorKind !== undefined && { errorKind }),
        },
      },
    })
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  setUiText(EN, 'en')
  vi.restoreAllMocks()
})

describe('M95b shared subscription UI', () => {
  it('keeps a single bare Muse model unchanged', async () => {
    const { postMessage, container } = showApp(
      readyStore({ modelId: 'muse-spark-1.3', displayLabel: 'Muse', isDefault: true }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('.plan-mark')).toBeNull()
    expect(screen.queryByText(UI_TEXT.planUi.chatGptMark)).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.planUi.manage })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(UI_TEXT.planUi.aiContent)).toBeNull()
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
  })

  it('marks the ChatGPT pill and opens usage without a model or paid call', async () => {
    const { postMessage, container } = showApp()
    expect(container.querySelector('.composer-area')?.hasAttribute('inert')).toBe(true)
    expect(await screen.findByText(UI_TEXT.planUi.chatGptMark)).toBeTruthy()
    expect(container.querySelector('.composer-area')?.hasAttribute('inert')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.manage }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'openExternal',
      url: CHATGPT_MANAGE_USAGE_URL,
    })
    expect(postMessage.mock.calls.flat().filter((message) => message.type !== 'ready')).toEqual([
      { type: 'openExternal', url: CHATGPT_MANAGE_USAGE_URL },
    ])
  })

  it('acknowledges the notice once across remounts and explains credits and eligibility', async () => {
    let isSeen = false
    const port: PlanNoticePort = {
      isAcknowledged: () => isSeen,
      acknowledge: () => {
        isSeen = true
      },
    }
    const view = showApp(readyStore(), port)
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.planUi.noticeTitle })
    expect(within(dialog).getByText(UI_TEXT.planUi.noticeDetail)).toBeTruthy()
    expect(within(dialog).getByText(UI_TEXT.planUi.credits)).toBeTruthy()
    expect(view.container.querySelector('.composer-area')?.hasAttribute('inert')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.planUi.understood }))
    expect(isSeen).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    showApp(readyStore(), port)
    await screen.findByText(UI_TEXT.planUi.chatGptMark)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('persists browser acknowledgement and fails closed when storage cannot be read', async () => {
    const view = showApp(readyStore(), null)
    fireEvent.click(await screen.findByRole('button', { name: UI_TEXT.planUi.understood }))
    expect(localStorage.getItem(CHATGPT_PLAN_NOTICE_STORAGE_KEY)).toBe('1')
    view.unmount()
    const again = showApp(readyStore(), null)
    await screen.findByText(UI_TEXT.planUi.chatGptMark)
    expect(screen.queryByRole('dialog')).toBeNull()
    again.unmount()
    showApp(readyStore(), {
      isAcknowledged: () => {
        throw new Error('storage unavailable')
      },
      acknowledge: vi.fn(),
    })
    expect(await screen.findByRole('dialog', { name: UI_TEXT.planUi.noticeTitle })).toBeTruthy()
  })

  it('handles the captured SSE limit message even with a generic error kind', async () => {
    const { store, postMessage, container } = showApp()
    endTurn(store, CAPTURED_LIMIT_MESSAGE, 'modelapi_error')
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.planUi.limitTitle })
    expect(within(dialog).getByText(UI_TEXT.planUi.limitDetail)).toBeTruthy()
    expect(container.querySelector('.composer-area')?.hasAttribute('inert')).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.planUi.manage }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'openExternal',
      url: CHATGPT_MANAGE_USAGE_URL,
    })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setModel' }))
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.planUi.chooseModel }))
    expect(screen.queryByRole('dialog', { name: UI_TEXT.planUi.limitTitle })).toBeNull()
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
  })

  it('retains a typed plan failure through the reducer and a validated snapshot', async () => {
    const { store } = showApp()
    endTurn(store, 'localized refusal', CHATGPT_PLAN_LIMIT_ERROR_KIND)
    expect(await screen.findByRole('dialog', { name: UI_TEXT.planUi.limitTitle })).toBeTruthy()
    const restored = restoredUiState(webviewStateOf(store.getState(), true))
    expect(restored.transcript.at(-1)).toMatchObject({ errorKind: CHATGPT_PLAN_LIMIT_ERROR_KIND })
  })

  it('does not infer plan limits from ordinary failures, other providers or old turns', async () => {
    const view = showApp()
    await screen.findByText(UI_TEXT.planUi.chatGptMark)
    endTurn(view.store, 'Usage limit reached')
    expect(screen.queryByRole('dialog')).toBeNull()
    endTurn(view.store, CAPTURED_LIMIT_MESSAGE, undefined, 'failed', 't2')
    expect(await screen.findByRole('dialog', { name: UI_TEXT.planUi.limitTitle })).toBeTruthy()
    endTurn(view.store, '', undefined, 'completed', 't3')
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    const other = showApp(
      readyStore({
        ...model,
        modelId: 'openai/gpt-6-astra',
        providerId: 'openai',
        pricing: 'priced',
      }),
    )
    endTurn(other.store, CAPTURED_LIMIT_MESSAGE, CHATGPT_PLAN_LIMIT_ERROR_KIND)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dismisses one failure but shows a later plan limit again', async () => {
    const { store } = showApp()
    endTurn(store, CAPTURED_LIMIT_MESSAGE)
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.planUi.limitTitle })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    endTurn(store, CAPTURED_LIMIT_MESSAGE, undefined, 'failed', 't2')
    expect(await screen.findByRole('dialog', { name: UI_TEXT.planUi.limitTitle })).toBeTruthy()
  })

  it('shows Copilot reduced capabilities, AI content, credit caveat and the report destination', async () => {
    const { postMessage } = showApp(
      readyStore({
        ...model,
        modelId: 'copilot/auto',
        providerId: 'copilot',
        providerLabel: 'Copilot',
      }),
    )
    expect(await screen.findByText(UI_TEXT.planUi.reduced)).toBeTruthy()
    expect(await screen.findByText(UI_TEXT.planUi.aiContent)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.reportContent }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'openExternal', url: COPILOT_REPORT_URL })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.manage }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'openExternal',
      url: COPILOT_MANAGE_USAGE_URL,
    })
  })

  it('uses injected plan-key metadata even when the configured provider id is custom', async () => {
    const url = 'https://docs.mistral.ai/admin/billing-usage/subscriptions'
    const { postMessage } = showApp(
      readyStore({
        ...model,
        modelId: 'office/codestral',
        providerId: 'office',
        providerLabel: 'Mistral',
        planLimitsUrl: url,
      }),
    )
    expect(await screen.findByText('Using Mistral plan')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.manage }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'openExternal', url })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads installed language text when rendering the plan UI', async () => {
    setUiText(
      {
        ...EN,
        planUi: {
          ...EN.planUi,
          manage: 'Nutzung verwalten',
          chatGptMark: 'ChatGPT-Abo wird verwendet',
        },
      },
      'de',
    )
    showApp()
    expect(await screen.findByText('ChatGPT-Abo wird verwendet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nutzung verwalten' })).toBeTruthy()
  })

  it('renders requests, reported and estimated tokens separately and marks unknown requests', () => {
    const onOpenExternal = vi.fn()
    render(<PlanUsageSection rows={tallies} models={[model]} onOpenExternal={onOpenExternal} />)
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText(UI_TEXT.planUi.reportedTokens)).toBeTruthy()
    expect(screen.getByText(UI_TEXT.planUi.estimatedTokens)).toBeTruthy()
    expect(screen.getByText(UI_TEXT.planUi.unknownTokens)).toBeTruthy()
    expect(screen.getByText(UI_TEXT.planUi.unknownTokens).nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText('1,234 input · 56 output · requests: 1')).toBeTruthy()
    expect(screen.getByText('2,000 input · 300 output · requests: 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.planUi.manage }))
    expect(onOpenExternal).toHaveBeenCalledWith(CHATGPT_MANAGE_USAGE_URL)
  })

  it.each(['chatgpt', 'copilot'])(
    'keeps %s plan billing tied to the session when the catalogue is cleared or inconsistent',
    async (providerId) => {
      const option = { ...model, modelId: `${providerId}/auto`, providerId }
      const { store, postMessage, container } = showApp(readyStore(option))
      await screen.findByRole('button', { name: UI_TEXT.planUi.manage })
      const deliver = (raw: unknown) => {
        const parsed = parseHostToWebviewMessage(raw)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) {
          act(() => {
            store.dispatch({ type: 'hostMessage', at: 0, message: parsed.message })
          })
        }
      }
      deliver({ type: 'modelList', models: [] })
      deliver({ type: 'usageReport', backend: 'modelApi', plans: tallies })
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.commandsTitle }))
      const filter = screen.getByRole('combobox')
      fireEvent.change(filter, { target: { value: '/usage' } })
      fireEvent.keyDown(filter, { key: 'Enter' })
      const dialog = await screen.findByRole('dialog', { name: UI_TEXT.usageLabel })
      const assertPlan = () => {
        expect(within(dialog).queryByText(UI_TEXT.usagePlanPayAsYouGo)).toBeNull()
        expect(within(dialog).queryByText(UI_TEXT.usageModelApiNote)).toBeNull()
        expect(within(dialog).queryByText(UI_TEXT.backendModelApi)).toBeNull()
        expect(within(dialog).queryByText(UI_TEXT.usageAuthKey)).toBeNull()
        expect(
          within(dialog).getByText(fill(UI_TEXT.planUi.providerMark, { provider: providerId })),
        ).toBeTruthy()
        expect(
          within(dialog).getByRole('region', { name: UI_TEXT.planUi.usageHeading }),
        ).toBeTruthy()
      }
      assertPlan()
      deliver({
        type: 'modelList',
        models: [{ ...option, providerId: 'meta', providerLabel: 'Meta', pricing: 'priced' }],
      })
      assertPlan()
      expect(container.querySelector('.plan-mark')).not.toBeNull()
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
      expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setModel' }))
    },
  )

  it('shows plan rows in Account & usage and never displays an invented dollar cost', () => {
    render(
      <UsageDialog
        report={{
          backend: 'modelApi',
          subscription: undefined,
          account: { signInMethod: 'apiKey' },
          insights: undefined,
          providers: [
            {
              providerId: 'chatgpt',
              providerLabel: 'ChatGPT',
              pricing: 'plan',
              inputTokens: 10,
              outputTokens: 20,
              costUsd: 99,
            },
          ],
          plans: tallies,
        }}
        usage={{ inputTokens: 10, outputTokens: 20, cachedTokens: 0 }}
        context={undefined}
        modelId={model.modelId}
        modelPricing="plan"
        models={[model]}
        paid={{ features: [], tally: EMPTY_PAID_TALLY, isKeyStored: false, alwaysAllowed: [] }}
        auth={initialUiState.auth}
        onInstallMuseCode={vi.fn()}
        onSetupSignIn={vi.fn()}
        onForgetPaidUse={vi.fn()}
        now={() => 0}
        onOpenExternal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('region', { name: UI_TEXT.planUi.usageHeading })).toBeTruthy()
    expect(screen.queryByText(UI_TEXT.usageCost)).toBeNull()
    expect(screen.queryByText(UI_TEXT.usagePlanPayAsYouGo)).toBeNull()
    expect(screen.queryByText(/\$99/)).toBeNull()
    expect(screen.queryByText(UI_TEXT.usageModelApiNote)).toBeNull()
    expect(screen.queryByText(UI_TEXT.backendModelApi)).toBeNull()
    expect(screen.queryByText(UI_TEXT.usageAuthKey)).toBeNull()
    expect(screen.getByText('Using ChatGPT plan')).toBeTruthy()
  })

  it('leaves tokens unknown when a dispatched request has no usage instead of showing zero', () => {
    render(
      <PlanUsageSection
        models={[model]}
        onOpenExternal={vi.fn()}
        rows={[
          {
            providerId: 'chatgpt',
            requests: 1,
            reported: { requests: 0, inputTokens: 0, outputTokens: 0 },
            estimated: { requests: 0, inputTokens: 0, outputTokens: 0 },
          },
        ]}
      />,
    )
    expect(screen.getByText(UI_TEXT.planUi.unknownTokens)).toBeTruthy()
    expect(screen.queryByText(UI_TEXT.planUi.reportedTokens)).toBeNull()
    expect(screen.queryByText(UI_TEXT.planUi.estimatedTokens)).toBeNull()
  })

  it('validates plan tallies at the host boundary and retains the data in UI state', () => {
    const message = { type: 'usageReport', backend: 'modelApi', plans: tallies }
    const parsed = parseHostToWebviewMessage(message)
    expect(planUsageSchema.safeParse(tallies).success).toBe(true)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    const store = readyStore()
    store.dispatch({ type: 'hostMessage', message: parsed.message, at: 0 })
    expect(store.getState().usageReport?.plans).toEqual(tallies)
    for (const plans of [
      [{ ...tallies[0], requests: 0 }],
      [...tallies, ...tallies],
      [{ ...tallies[0], requests: -1 }],
      [{ ...tallies[0], providerId: 'meta' }],
      [{ ...tallies[0], providerId: 'Invalid!' }],
      [{ ...tallies[0], requests: 1.5 }],
      [{ ...tallies[0], reported: { requests: 1, inputTokens: -1, outputTokens: 56 } }],
      [{ ...tallies[0], reported: { requests: 1, inputTokens: 1.5, outputTokens: 56 } }],
    ]) {
      expect(parseHostToWebviewMessage({ ...message, plans }).ok).toBe(false)
      expect(planUsageSchema.safeParse(plans).success).toBe(false)
    }
    expect(
      parseHostToWebviewMessage({
        type: 'modelList',
        models: [{ ...model, planLimitsUrl: 'javascript:alert(1)' }],
      }).ok,
    ).toBe(false)
  })

  it('waits behind an existing modal and opens once that modal closes', () => {
    const props = {
      state: readyStore().getState(),
      providerId: 'chatgpt',
      onModalChange: vi.fn(),
      onChooseModel: vi.fn(),
      postMessage: vi.fn(),
      port: { isAcknowledged: () => false, acknowledge: vi.fn() },
    }
    const view = render(<PlanSurface {...props} isOtherModalOpen />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(props.onModalChange).toHaveBeenLastCalledWith(false)
    view.rerender(<PlanSurface {...props} isOtherModalOpen={false} />)
    expect(screen.getByRole('dialog', { name: UI_TEXT.planUi.noticeTitle })).toBeTruthy()
    expect(props.onModalChange).toHaveBeenLastCalledWith(true)
  })
})
