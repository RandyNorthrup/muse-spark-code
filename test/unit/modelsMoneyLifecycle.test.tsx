// @vitest-environment jsdom
// The models panel's lazy money (STARTUP017 review): consent and budget
// changes against a held or failed money chunk, on the real panel and its
// reducer. The wizard's spending limit commits without the chunk, only for
// the draft it was typed in; a cancelled or reopened wizard posts none, and
// a failed load keeps the typed amount. The paid check's cost is said with
// Retry when its load fails, and never offers Accept until stated.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useReducer } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UI_TEXT as UiTextTable } from '../../src/shared/constants'
import type { ModelsPanelState, PanelToHostMessage } from '../../src/shared/modelsPanel'

const chunk = { gate: Promise.withResolvers<undefined>(), shouldFail: false }

afterEach(cleanup)

beforeEach(() => {
  chunk.gate = Promise.withResolvers<undefined>()
  chunk.shouldFail = false
  // A fresh document per test: the money hub keeps one load per document,
  // and the money chunk's real module is held until the test releases it.
  vi.resetModules()
  vi.doMock('../../src/shared/paid', async (importOriginal) => {
    await chunk.gate.promise
    if (chunk.shouldFail) throw new Error('chunk gone')
    return await importOriginal()
  })
})

async function mountPanel(state: ModelsPanelState) {
  const [{ ModelsPanel }, { INITIAL_PANEL_UI, panelUiReducer }, { UI_TEXT }] = await Promise.all([
    import('../../src/webview/models/panel'),
    import('../../src/webview/models/reducer'),
    import('../../src/shared/constants'),
  ])
  const post = vi.fn<(message: PanelToHostMessage) => void>()
  function Panel() {
    const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
    useEffect(() => {
      dispatch({ type: 'host-state', state })
    }, [])
    return <ModelsPanel panelState={state} ui={ui} post={post} dispatch={dispatch} />
  }
  render(<Panel />)
  // The providers section loads behind the shared deferred boundary.
  const pick = await screen.findByRole('button', { name: UI_TEXT.wizardPickProvider })
  fireEvent.click(pick)
  return { post, UI_TEXT }
}

async function suggestionsState(): Promise<ModelsPanelState> {
  const { makeDraft, makeState, makeSuggestion } = await import('./modelsPanelFixtures')
  return makeState({
    drafts: {
      edits: {},
      wizard: makeDraft({ step: 'suggestions', presetId: 'ollama', auth: 'none', blockers: [] }),
    },
    suggestions: [makeSuggestion('defaultModel'), makeSuggestion('sessionBudget')],
  })
}

async function costState(): Promise<ModelsPanelState> {
  const { makeDraft, makeState } = await import('./modelsPanelFixtures')
  const { Usd } = await import('../../src/shared/usd')
  return makeState({
    drafts: {
      edits: {},
      wizard: makeDraft({
        step: 'test',
        presetId: 'openrouter',
        keyPresent: true,
        keyShapeOk: true,
        test: { status: 'needs-cost', costUsd: Usd.from(0.000002).toAmount() },
        blockers: [],
      }),
    },
  })
}

async function release(): Promise<void> {
  await act(async () => {
    chunk.gate.resolve(undefined)
    // Wait for the document's one money load (started by the mounted panel)
    // to settle, not for a fixed tick: on a loaded runner resolving the
    // chunk's imports outlasts a tick and the alert's default 1 s wait.
    const { loadMoneyDisplay } = await import('../../src/webview/money')
    try {
      await loadMoneyDisplay()
    } catch {
      // The failure case asserts the panel's alert.
    }
  })
}

function budgetChanges(post: ReturnType<typeof vi.fn>): readonly unknown[] {
  return post.mock.calls
    .map(([message]) => message as PanelToHostMessage)
    .filter((message) => message.type === 'suggestions/change' && message.kind === 'sessionBudget')
}

function typeLimit(text: typeof UiTextTable, amount: string) {
  fireEvent.change(screen.getByLabelText(text.wizardSessionBudget), { target: { value: amount } })
}

// 0.17.1 merge: the provider fix made the wizard's budget the conversation
// spending-limit setting's own field (compare-and-set, committed on Continue)
// and removed the budget suggestion card and its Change press, which were
// the only money-chunk work on this step. These cases keep STARTUP017's
// guarantees for the field: nothing on it waits for the chunk, a cancelled
// or reopened wizard posts no limit, and a failed load loses no typed amount.
describe('wizard spending limit against a held money chunk', () => {
  it('commits the typed limit on Continue without waiting for the chunk', async () => {
    const state = await suggestionsState()
    const { post, UI_TEXT } = await mountPanel(state)
    typeLimit(UI_TEXT, '7.5')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    const { Usd } = await import('../../src/shared/usd')
    // The chunk is still held: the field's commit needs none of it.
    expect(budgetChanges(post)).toEqual([
      {
        type: 'suggestions/change',
        kind: 'sessionBudget',
        usd: Usd.from('7.5').toAmount(),
        expectedUsd: state.sessionBudget.effectiveUsd,
      },
    ])
    await release()
    expect(budgetChanges(post)).toHaveLength(1)
  })

  it('posts no limit when the wizard is cancelled, nor once it reopens over a new draft', async () => {
    const { post, UI_TEXT } = await mountPanel(await suggestionsState())
    typeLimit(UI_TEXT, '7.5')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/wizard', event: 'cancel' })
    // Reopened before the chunk arrives: a new generation, not the old draft.
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
    await release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(budgetChanges(post)).toEqual([])
  })

  it('keeps the typed limit through a failed load and offers no budget Accept', async () => {
    chunk.shouldFail = true
    const { post, UI_TEXT } = await mountPanel(await suggestionsState())
    typeLimit(UI_TEXT, '7.5')
    await release()
    expect(screen.getByLabelText(UI_TEXT.wizardSessionBudget)).toHaveValue(7.5)
    expect(budgetChanges(post)).toEqual([])
    // No budget suggestion card: only the default model's Accept is offered.
    expect(screen.getAllByRole('button', { name: UI_TEXT.suggestionAccept })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
    expect(budgetChanges(post)).toHaveLength(1)
  })
})

/** The paid check's Accept, unavailable: pressing it posts no consent. */
function expectNoConsent(post: ReturnType<typeof vi.fn>, label: string): HTMLElement {
  const accept = screen.getByRole('button', { name: label })
  expect(accept).toBeDisabled()
  fireEvent.click(accept)
  expect(post).not.toHaveBeenCalledWith({ type: 'providers/test', acceptCost: true })
  return accept
}

describe('paid check consent against the money chunk', () => {
  it('offers Accept only once the cost is stated', async () => {
    const { post, UI_TEXT } = await mountPanel(await costState())
    const accept = expectNoConsent(post, UI_TEXT.suggestionAccept)
    await release()
    await waitFor(() => {
      expect(accept).toBeEnabled()
    })
    expect(screen.getByText(/0\.000002/)).toBeInTheDocument()
    fireEvent.click(accept)
    expect(post).toHaveBeenCalledWith({ type: 'providers/test', acceptCost: true })
  })

  it('keeps Accept unavailable when the cost cannot load, and says so with Retry', async () => {
    chunk.shouldFail = true
    const { post, UI_TEXT } = await mountPanel(await costState())
    await release()
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.moneyLoadFailed)
    expectNoConsent(post, UI_TEXT.suggestionAccept)
  })
})

it('marks every key usage amount until the held money chunk has formatted it', async () => {
  const { makeProvider, makeKeyUsage, makeState } = await import('./modelsPanelFixtures')
  const { UI_TEXT } = await mountPanel(
    makeState({ providers: [makeProvider({ keyUsage: makeKeyUsage() })] }),
  )
  const amounts = document.querySelectorAll('.models-usage dd')
  expect(amounts).toHaveLength(4)
  for (const amount of amounts) {
    expect(amount.querySelector('[data-deferred-loading]')).not.toBeNull()
    expect(amount).toHaveTextContent('')
  }
  await release()
  expect(await screen.findByText('$1.20')).toBeInTheDocument()
  expect(screen.getByText('$3.40')).toBeInTheDocument()
  expect(screen.getByText('$10.00')).toBeInTheDocument()
  expect(screen.getByText('$6.60')).toBeInTheDocument()
  expect(document.querySelector('.models-usage [data-deferred-loading]')).toBeNull()
  expect(screen.queryByText(UI_TEXT.moneyLoadFailed)).toBeNull()
})
