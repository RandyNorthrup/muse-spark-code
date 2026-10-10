// @vitest-environment jsdom
// The models panel's lazy money (STARTUP017 review): consent and budget
// changes against a held or failed money chunk, on the real panel and its
// reducer. A pending budget change posts only to the wizard draft it was
// made for; a cancelled or reopened wizard drops it. A failed load is said
// with Retry, keeps the typed amount, and never offers Accept.
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
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
  return { post, UI_TEXT }
}

async function suggestionsState(): Promise<ModelsPanelState> {
  const { makeDraft, makeState, makeSuggestion } = await import('./modelsPanelFixtures')
  return makeState({
    drafts: {
      edits: {},
      wizard: makeDraft({ step: 'suggestions', presetId: 'ollama', auth: 'none' }),
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

function changeBudget(text: typeof UiTextTable, amount: string) {
  fireEvent.change(screen.getByLabelText(text.suggestSessionBudget), { target: { value: amount } })
  const change = screen.getAllByRole('button', { name: text.suggestionChange })[1]
  if (change === undefined) throw new Error('budget Change missing')
  fireEvent.click(change)
}

describe('wizard budget change against a held money chunk', () => {
  it('posts to the draft it was made for once the chunk arrives', async () => {
    const { post, UI_TEXT } = await mountPanel(await suggestionsState())
    changeBudget(UI_TEXT, '7.5')
    expect(budgetChanges(post)).toEqual([])
    await release()
    const { Usd } = await import('../../src/shared/usd')
    await waitFor(() => {
      expect(budgetChanges(post)).toEqual([
        { type: 'suggestions/change', kind: 'sessionBudget', usd: Usd.from('7.5').toAmount() },
      ])
    })
  })

  it('drops the change when the wizard is cancelled, and when it reopens over a new draft', async () => {
    const { post, UI_TEXT } = await mountPanel(await suggestionsState())
    changeBudget(UI_TEXT, '7.5')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/wizard', event: 'cancel' })
    // Reopened before the chunk arrives: a new generation, not the old draft.
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
    await release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(budgetChanges(post)).toEqual([])
  })

  it('says a failed load with Retry, keeps the typed amount and posts nothing', async () => {
    chunk.shouldFail = true
    const { post, UI_TEXT } = await mountPanel(await suggestionsState())
    changeBudget(UI_TEXT, '7.5')
    await release()
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.moneyLoadFailed)
    expect(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry })).toBeEnabled()
    expect(screen.getByLabelText(UI_TEXT.suggestSessionBudget)).toHaveValue(7.5)
    expect(budgetChanges(post)).toEqual([])
    // The suggested amount was never stated, so its Accept is never offered.
    const budgetAccept = screen.getAllByRole('button', { name: UI_TEXT.suggestionAccept })[1]
    expect(budgetAccept).toBeDisabled()
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
