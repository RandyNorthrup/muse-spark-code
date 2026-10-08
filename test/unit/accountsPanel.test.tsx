// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AccountsSection,
  AccountsConfirmationDialog,
  AccountChip,
  AccountNotices,
} from '../../src/webview/models/sections/accounts/accountsEntry'
import type { AccountsSectionPort } from '../../src/webview/models/sections/accounts/AccountsSection'
import { ThresholdEditor } from '../../src/webview/models/sections/accounts/ThresholdEditor'
import { App } from '../../src/webview/App'
import { UI_TEXT } from '../../src/shared/constants'
import { usdInputSchema } from '../../src/shared/usdSchema'
import { panelQuestion, panelSlice } from './helpers/accounts/panel'
import { initialUiState } from '../../src/webview/state/uiState'
import { createUiStore } from '../../src/webview/state/store'
import { testSettings } from './helpers/fakes'
import { poolRig, POOL_NOW } from './helpers/accounts/pool'
import { AccountPoolStoppedError } from '../../src/core/accounts/pool'
import { accountNoticeFor } from '../../src/host/models/accountsHandler'
import { fill, formatDateTime } from '../../src/shared/l10n/text'

function section(value = panelSlice()) {
  const port: AccountsSectionPort = {
    request: vi.fn(() => Promise.resolve(value)),
    accept: vi.fn(),
    openLink: vi.fn(),
  }
  const view = render(<AccountsSection value={value} port={port} />)
  return { ...view, port }
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
    await Promise.resolve()
  })
}

describe('M108 Accounts section', () => {
  it('keeps malformed display metadata and adapter errors off the surface', async () => {
    const h = section()
    vi.mocked(h.port.request).mockResolvedValueOnce({
      ...panelSlice(),
      secret: 'planted-private-text',
    })
    await click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    expect(h.port.accept).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.actionFailed)
    vi.mocked(h.port.request).mockRejectedValueOnce(new Error('planted-private-text'))
    await click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    expect(document.body).not.toHaveTextContent('planted-private-text')
    h.rerender(
      <AccountsSection value={{ ...panelSlice(), secret: 'planted-private-text' }} port={h.port} />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.invalidAccount)
  })
  it('allows one pending mutation despite stale enabled form controls', async () => {
    const h = section()
    const held = Promise.withResolvers<unknown>()
    vi.mocked(h.port.request).mockReturnValueOnce(held.promise)
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.add }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.id), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), { target: { value: 'Org' } })
    const form = document.querySelector('form')!
    fireEvent.submit(form)
    // A stale enabled control can dispatch again; the latch must own the request.
    form.querySelector('fieldset')!.disabled = false
    fireEvent.submit(form)
    expect(h.port.request).toHaveBeenCalledTimes(1)
    await act(async () => {
      held.resolve(panelSlice())
      await held.promise
    })
  })
  it('adds metadata and keeps credential input off the page', async () => {
    const { port } = section()
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.add }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.id), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), { target: { value: 'Org' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.limitGroup), {
      target: { value: 'project' },
    })
    await click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(port.request).toHaveBeenCalledWith({
      type: 'accounts/add',
      provider: 'openai',
      account: { id: 'team', label: 'Org', limitGroup: 'project', order: 2, thresholds: {} },
    })
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })
  it('edits labels, changes pool order and confirms destructive removal', async () => {
    const { port } = section()
    const personal = screen.getByText('Personal (personal)').closest('li')!
    await click(within(personal).getByRole('button', { name: UI_TEXT.accounts.earlier }))
    expect(port.request).toHaveBeenLastCalledWith({
      type: 'accounts/order',
      provider: 'openai',
      accounts: ['personal', 'work'],
    })
    await click(within(personal).getByRole('button', { name: UI_TEXT.queuedEdit }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), { target: { value: 'Home' } })
    await click(within(personal).getAllByRole('button', { name: UI_TEXT.goalEditSave })[0]!)
    expect(port.request).toHaveBeenLastCalledWith({
      type: 'accounts/update',
      provider: 'openai',
      account: { ...panelSlice().accounts[1], label: 'Home' },
    })
    await click(within(personal).getByRole('button', { name: UI_TEXT.accounts.remove }))
    expect(port.request).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'accounts/remove' }),
    )
    expect(screen.getByText(/stored credential will be deleted/)).toBeVisible()
    await click(within(personal).getByRole('button', { name: UI_TEXT.accounts.confirm }))
    expect(port.request).toHaveBeenLastCalledWith({
      type: 'accounts/remove',
      provider: 'openai',
      account: 'personal',
    })
  })
  it('revokes a machine-local confirmation', async () => {
    const { port } = section(panelSlice({ confirmation: 'confirm' }))
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.revoke }))
    expect(port.request).toHaveBeenCalledWith({
      type: 'accounts/revoke',
      provider: 'openai',
      product: 'api',
    })
  })
  it('refuses credential selection and addition without a captured or offered product', () => {
    const value = panelSlice()
    value.policy = { ...value.policy!, product: 'muse-code' }
    section(value)
    expect(screen.getByText(UI_TEXT.accounts.museCodeUnavailable)).toBeVisible()
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.add })).toBeDisabled()
    expect(
      screen
        .getAllByRole('button', { name: UI_TEXT.accounts.use })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true)
    for (const label of [
      UI_TEXT.queuedEdit,
      UI_TEXT.accounts.remove,
      UI_TEXT.accounts.earlier,
      UI_TEXT.accounts.later,
    ]) {
      expect(
        screen
          .getAllByRole('button', { name: label })
          .every((button) => button.hasAttribute('disabled')),
      ).toBe(true)
    }
  })
  it('rejects invalid input before sending and refuses malformed or cross-provider replies', async () => {
    const { port } = section()
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.add }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.id), { target: { value: 'INVALID' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), { target: { value: 'Team' } })
    await click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(port.request).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.invalidAccount)
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.id), { target: { value: 'team' } })
    vi.mocked(port.request).mockResolvedValueOnce({ ...panelSlice(), provider: 'other' })
    await click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(port.accept).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.actionFailed)
  })
  it('does not adopt an old reply after the selected provider changes', async () => {
    const { port, rerender } = section()
    const held = Promise.withResolvers<unknown>()
    vi.mocked(port.request).mockReturnValueOnce(held.promise)
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    rerender(<AccountsSection value={panelSlice({ provider: 'other' })} port={port} />)
    await act(async () => {
      held.resolve(panelSlice())
      await held.promise
    })
    expect(port.accept).not.toHaveBeenCalled()
  })
  it('discards an obsolete reply after leaving and returning to the same provider', async () => {
    const h = section()
    const held = Promise.withResolvers<unknown>()
    vi.mocked(h.port.request).mockReturnValueOnce(held.promise)
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    h.rerender(<AccountsSection value={panelSlice({ provider: 'other' })} port={h.port} />)
    h.rerender(<AccountsSection value={panelSlice({ currentAccount: 'personal' })} port={h.port} />)
    await act(async () => {
      held.resolve(panelSlice({ currentAccount: 'work' }))
      await held.promise
    })
    expect(h.port.accept).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('keeps a settled error on its owning displayed slice', async () => {
    const h = section()
    vi.mocked(h.port.request).mockRejectedValueOnce(new Error('failed'))
    await click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.actionFailed)
    h.rerender(<AccountsSection value={panelSlice({ provider: 'other' })} port={h.port} />)
    expect(screen.queryByRole('alert')).toBeNull()
    h.rerender(<AccountsSection value={panelSlice()} port={h.port} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('discards an obsolete rejection and releases only its owned pending request', async () => {
    const value = panelSlice()
    const h = section(value)
    const old = Promise.withResolvers<unknown>()
    vi.mocked(h.port.request).mockReturnValueOnce(old.promise)
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    const other = panelSlice({ provider: 'other' })
    h.rerender(<AccountsSection value={other} port={h.port} />)
    // Navigation cannot open a second mutation while the first still owns the view.
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    expect(h.port.request).toHaveBeenCalledTimes(1)
    await act(async () => {
      old.reject(new Error('obsolete adapter error'))
      try {
        await old.promise
      } catch {
        // The obsolete request is deliberately rejected.
      }
    })
    expect(screen.queryByRole('alert')).toBeNull()
    h.rerender(<AccountsSection value={value} port={h.port} />)
    expect(screen.queryByRole('alert')).toBeNull()
    h.rerender(<AccountsSection value={other} port={h.port} />)
    const current = Promise.withResolvers<unknown>()
    vi.mocked(h.port.request).mockReturnValueOnce(current.promise)
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.accounts.use })[1]!)
    expect(h.port.request).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.add })).toBeDisabled()
    await act(async () => {
      current.resolve({ ...other, currentAccount: 'personal' })
      await current.promise
    })
    expect(h.port.accept).toHaveBeenCalledTimes(1)
    expect(h.port.accept).toHaveBeenCalledWith({ ...other, currentAccount: 'personal' })
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.add })).toBeEnabled()
  })
  it('resets edit fields when two providers use the same account id', async () => {
    const h = section()
    await click(screen.getAllByRole('button', { name: UI_TEXT.queuedEdit })[0]!)
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), {
      target: { value: 'Old draft' },
    })
    const spend = document.querySelector<HTMLInputElement>('input[name="spendUsd.day"]')!
    fireEvent.change(spend, { target: { value: '9' } })
    const value = panelSlice({ provider: 'other' })
    value.accounts[0] = {
      ...value.accounts[0]!,
      label: 'New account',
      thresholds: { spendUsd: { day: usdInputSchema.parse('0.7') } },
    }
    h.rerender(<AccountsSection value={value} port={h.port} />)
    expect(screen.getByLabelText(UI_TEXT.accounts.label)).toHaveValue('New account')
    expect(document.querySelector('input[name="spendUsd.day"]')).toHaveValue(0.7)
    vi.mocked(h.port.request).mockResolvedValueOnce(value)
    const thresholds = document.querySelector<HTMLFormElement>('.account-thresholds')!
    await click(within(thresholds).getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(h.port.request).toHaveBeenCalledWith({
      type: 'accounts/thresholds',
      provider: 'other',
      account: 'work',
      thresholds: { spendUsd: { day: '0.7' } },
    })
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.add }))
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.id), { target: { value: 'old-draft' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.accounts.label), {
      target: { value: 'Old add' },
    })
    h.rerender(<AccountsSection value={panelSlice()} port={h.port} />)
    expect(screen.getByLabelText(UI_TEXT.accounts.id)).toHaveValue('')
    expect(screen.getByLabelText(UI_TEXT.accounts.label)).toHaveValue('')
  })
  it('shows stale policy evidence with clause, source and dates', () => {
    const value = panelSlice()
    value.policy!.isStale = true
    section(value)
    expect(screen.getByRole('status')).toHaveTextContent(/Re-check it before release/)
    expect(screen.getByText(value.policy!.sources[0]!.quote)).toBeVisible()
    expect(screen.getByRole('link')).toHaveAttribute('href', value.policy!.sources[0]!.url)
    expect(screen.getByText(/Source date:/)).toBeVisible()
  })
})

describe('M108 threshold editor', () => {
  it('edits every period and supported window, preserves hidden capability values and exact money', async () => {
    const save = vi.fn()
    render(
      <ThresholdEditor
        value={{
          spendUsd: { day: usdInputSchema.parse('0.3') },
          planWindowPercent: { weekly: 75 },
        }}
        capabilities={{ planWindows: ['five-hour'], hasRateHeadroom: true }}
        isPending={false}
        onSave={save}
      />,
    )
    const inputs = document.querySelectorAll<HTMLInputElement>('input')
    for (const input of inputs) {
      let value = '42'
      if (input.name.startsWith('spendUsd')) value = '0.100000001'
      else if (input.name.startsWith('window') || input.name.startsWith('headroom')) value = '28.5'
      fireEvent.change(input, { target: { value } })
    }
    await click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(save).toHaveBeenCalledWith({
      spendUsd: { day: '0.100000001', week: '0.100000001', month: '0.100000001' },
      inputTokens: { day: 42, week: 42, month: 42 },
      outputTokens: { day: 42, week: 42, month: 42 },
      requests: { day: 42, week: 42, month: 42 },
      planWindowPercent: { weekly: 75, 'five-hour': 28.5 },
      rateLimitHeadroomPercent: { requests: 28.5, tokens: 28.5 },
    })
  })
  it.each(['0.0000000001', '-1', 'NaN'])(
    'refuses inexact or invalid USD %s without sending',
    (amount) => {
      const save = vi.fn()
      render(
        <ThresholdEditor
          value={{}}
          capabilities={{ planWindows: [], hasRateHeadroom: false }}
          isPending={false}
          onSave={save}
        />,
      )
      fireEvent.change(document.querySelector('input[name="spendUsd.day"]')!, {
        target: { value: amount },
      })
      // Browser validity also blocks negatives; direct submit verifies the parser itself.
      if (amount === 'NaN') {
        // number inputs erase non-numbers, so exercise unsafe counts instead.
        fireEvent.change(document.querySelector('input[name="requests.day"]')!, {
          target: { value: '9007199254740992' },
        })
      }
      fireEvent.submit(document.querySelector('form')!)
      expect(save).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.invalidAccount)
    },
  )
})

describe('M108 picker, transcript and policy question', () => {
  it('shows the pool recovery after all account blockers instead of the first trigger reset', async () => {
    const t = poolRig()
    t.rows[0]!.thresholds = { requests: { day: 1 } }
    t.counts.set('a', 1)
    const firstReset = new Date(POOL_NOW + 60_000).toISOString()
    t.blocks.set('a', { blocked: { reason: 'rateLimited', resetAt: firstReset } })
    t.blocks.set('b', { blocked: { reason: 'quota', resetAt: null } })
    t.blocks.set('c', { blocked: { reason: 'quota', resetAt: null } })
    let stopped: unknown
    try {
      await t.run()
    } catch (error) {
      stopped = error
    }
    expect(stopped).toBeInstanceOf(AccountPoolStoppedError)
    if (!(stopped instanceof AccountPoolStoppedError)) throw new Error('expected pool stop')
    const dailyReset = new Date(new Date(POOL_NOW).setHours(24, 0, 0, 0)).toISOString()
    expect(stopped.resetAt).toBe(dailyReset)
    const h = render(
      <AccountNotices
        value={panelSlice({
          provider: 'anthropic',
          providerLabel: 'Anthropic',
          accounts: t.rows,
          currentAccount: 'a',
        })}
        events={t.events.map((event) => accountNoticeFor(event, stopped))}
        onOpenLink={vi.fn()}
      />,
    )
    expect(screen.getByRole('log')).toHaveTextContent(
      fill(UI_TEXT.accounts.stopped, {
        provider: 'Anthropic',
        reset: formatDateTime(Date.parse(dailyReset)),
      }),
    )
    h.rerender(
      <AccountNotices
        value={panelSlice({
          provider: 'anthropic',
          providerLabel: 'Anthropic',
          accounts: t.rows,
          currentAccount: 'a',
        })}
        events={t.events.map((event) => accountNoticeFor(event))}
        onOpenLink={vi.fn()}
      />,
    )
    expect(screen.getByRole('log')).toHaveTextContent(
      fill(UI_TEXT.accounts.resetUnknown, { provider: 'Anthropic' }),
    )
    expect(screen.getByRole('log')).not.toHaveTextContent(formatDateTime(Date.parse(firstReset)))
    h.unmount()
  })
  it('resets acknowledgement for a new question with the identical clause and echoes its identity', async () => {
    const onChoose = vi.fn(() => Promise.resolve())
    const old = panelQuestion()
    const props = { provider: 'openai', providerLabel: 'OpenAI', onChoose, onOpenLink: vi.fn() }
    const h = render(<AccountsConfirmationDialog {...props} value={old} />)
    await click(screen.getByRole('checkbox'))
    const current = {
      ...old,
      questionId: 'e91141d9-1dc9-44d5-9e14-702a889fe3c1',
      providerGeneration: 2,
    }
    h.rerender(<AccountsConfirmationDialog {...props} value={current} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.confirm })).toBeDisabled()
    await click(screen.getByRole('checkbox'))
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.confirm }))
    expect(onChoose).toHaveBeenCalledWith({
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      choice: 'confirm',
      questionId: current.questionId,
      providerGeneration: current.providerGeneration,
    })
  })
  it('disables account switching for products whose credentials are not held', () => {
    const value = panelSlice()
    value.policy!.isCredentialHeld = false
    render(<AccountChip value={value} isPending={false} onUse={vi.fn()} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
  it('keeps an in-flight confirmation from accepting a second answer', async () => {
    const held = Promise.withResolvers<undefined>()
    const onChoose = vi.fn(() => held.promise)
    render(
      <AccountsConfirmationDialog
        provider="openai"
        providerLabel="OpenAI"
        value={panelQuestion()}
        onChoose={onChoose}
        onOpenLink={vi.fn()}
      />,
    )
    await click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.accounts.confirm }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledTimes(1)
    await act(async () => {
      held.resolve(undefined)
      await held.promise
    })
  })
  it('asks again when the quoted row changes and supports Only at my own caps', async () => {
    const onChoose = vi.fn(() => Promise.resolve())
    const value = panelQuestion()
    const props = { provider: 'openai', providerLabel: 'OpenAI', onChoose, onOpenLink: vi.fn() }
    const { rerender } = render(<AccountsConfirmationDialog {...props} value={value} />)
    await click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.confirm })).toBeEnabled()
    rerender(
      <AccountsConfirmationDialog
        {...props}
        value={{
          ...value,
          policy: {
            ...value.policy,
            sources: [{ ...value.policy.sources[0]!, quote: 'Updated clause' }],
          },
        }}
      />,
    )
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: UI_TEXT.accounts.confirm })).toBeDisabled()
    await click(screen.getByRole('button', { name: UI_TEXT.accounts.ownCapsOnly }))
    expect(onChoose).toHaveBeenCalledWith({
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      questionId: panelQuestion().questionId,
      providerGeneration: 1,
      choice: 'ownCapsOnly',
    })
  })
  it('leaves the single-account pill unchanged and names both accounts in the picker', () => {
    const onUse = vi.fn()
    const value = panelSlice()
    const { rerender } = render(
      <AccountChip
        value={{ ...value, accounts: [value.accounts[0]] }}
        isPending={false}
        onUse={onUse}
      />,
    )
    expect(screen.queryByRole('combobox')).toBeNull()
    rerender(<AccountChip value={value} isPending={false} onUse={onUse} />)
    expect(screen.getByLabelText('Current account: OpenAI · Work')).toHaveValue('work')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } })
    expect(onUse).toHaveBeenCalledWith({
      type: 'accounts/use',
      provider: 'openai',
      account: 'personal',
    })
    rerender(
      <AccountChip value={{ ...value, currentAccount: null }} isPending={false} onUse={onUse} />,
    )
    expect(screen.getByLabelText(`Current account: OpenAI · ${UI_TEXT.accounts.none}`)).toHaveValue(
      '',
    )
    expect(screen.getByRole('option', { name: UI_TEXT.accounts.none })).toBeDisabled()
  })
  it('shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events', () => {
    const trigger = {
      kind: 'userCap',
      metric: 'spendUsd',
      period: 'day',
      value: usdInputSchema.parse('0.3'),
      threshold: usdInputSchema.parse('0.3'),
      resetAt: '2026-10-07T00:00:00Z',
    }
    render(
      <AccountNotices
        value={panelSlice()}
        onOpenLink={vi.fn()}
        events={[
          {
            type: 'swap',
            provider: 'openai',
            account: 'personal',
            previousAccount: 'work',
            time: '2026-10-06T00:00:00Z',
            trigger,
            coldCacheUsd: usdInputSchema.parse('0.000000001'),
          },
          {
            type: 'stop',
            provider: 'openai',
            account: 'personal',
            time: '2026-10-06T00:00:00Z',
            trigger,
          },
          {
            type: 'swap',
            provider: 'other',
            account: 'personal',
            previousAccount: 'work',
            time: '2026-10-06T00:00:00Z',
            trigger,
            coldCacheUsd: usdInputSchema.parse('999'),
          },
        ].map((event) => ({ event, resetAt: event.type === 'stop' ? trigger.resetAt : null }))}
      />,
    )
    expect(screen.getByRole('log')).toHaveTextContent(
      'Now on OpenAI · Personal: Work reached User cap: Spend in USD (Day) $0.3000.',
    )
    expect(screen.getByText('Estimated context re-read cost: $0.000000001.')).toBeVisible()
    expect(screen.getByRole('log')).toHaveTextContent('Resets')
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://provider.invalid/usage')
    expect(screen.getByRole('log')).not.toHaveTextContent('999')
  })
  it('injects account pill and transcript nodes into the shared chat', () => {
    render(
      <App
        postMessage={vi.fn()}
        store={createUiStore({
          ...initialUiState,
          settings: testSettings,
          auth: { ...initialUiState.auth, status: 'signedIn' },
        })}
        accounts={{
          label: 'OpenAI · Work',
          pill: <span>OpenAI · Work</span>,
          transcript: <span>Account changed</span>,
        }}
      />,
    )
    expect(document.querySelector('main')).toHaveTextContent('Account changed')
    expect(screen.getByRole('button', { name: UI_TEXT.modelPillLabel })).toHaveTextContent(
      'OpenAI · Work',
    )
  })
  it('requires legitimate-account acknowledgement, quotes the clause and traps keyboard focus', async () => {
    const choose = vi.fn(() => Promise.resolve())
    render(
      <AccountsConfirmationDialog
        provider="openai"
        providerLabel="OpenAI"
        value={panelQuestion()}
        onChoose={choose}
        onOpenLink={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('The vendor may act against your accounts.')
    expect(dialog).toHaveTextContent(panelSlice().policy!.sources[0]!.quote)
    const confirm = screen.getByRole('button', { name: UI_TEXT.accounts.confirm })
    expect(confirm).toBeDisabled()
    await click(confirm)
    expect(choose).not.toHaveBeenCalled()
    await click(screen.getByRole('checkbox'))
    await click(confirm)
    expect(choose).toHaveBeenCalledWith({
      type: 'accounts/confirm',
      provider: 'openai',
      product: 'api',
      questionId: panelQuestion().questionId,
      providerGeneration: 1,
      choice: 'confirm',
    })
    const cancel = screen.getByRole('button', { name: UI_TEXT.accounts.cancel })
    cancel.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(screen.getByRole('button', { name: UI_TEXT.usageClose })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(choose).toHaveBeenLastCalledWith(expect.objectContaining({ choice: 'cancel' }))
  })
})
