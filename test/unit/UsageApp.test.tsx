// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageApp } from '../../src/webview/usage/UsageApp'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { usagePageStateSchema, type UsagePageState } from '../../src/shared/usagePage'
import { usageStateFor, usageTotals, USAGE_SCENARIOS } from './helpers/usageFixtures'
import type { HostBridge } from '../../src/webview/hostBridge'

const NOW = new Date(2026, 9, 5, 12).getTime()
function setup(state: UsagePageState = usageStateFor('one-provider', NOW)) {
  const messages = new EventTarget()
  const host: HostBridge = {
    post: vi.fn(),
    savedState: () => undefined,
    saveState: vi.fn(),
    messages,
  }
  const view = render(<UsageApp host={host} now={() => NOW} />)
  const send = (data: unknown) => {
    act(() => {
      messages.dispatchEvent(new MessageEvent('message', { data }))
    })
  }
  send({ type: 'usage/state', state })
  return { host, send, state, ...view }
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

it('explains unavailable editor actions on the page and disables their controls', () => {
  const state = usageStateFor('one-provider', NOW)
  state.capabilities = {
    settings: false,
    folder: false,
    models: false,
    external: false,
    export: true,
    deleteHistory: true,
    setHistory: true,
    exportMaxBytes: 100,
  }
  setup(state)
  expect(screen.getByText(USAGE_EN.editorActionsUnavailable)).toBeTruthy()
  expect(screen.getByRole('button', { name: USAGE_EN.settings }).hasAttribute('disabled')).toBe(
    true,
  )
  expect(screen.getByRole('button', { name: USAGE_EN.revealFolder }).hasAttribute('disabled')).toBe(
    true,
  )
  expect(screen.getByText(/Browser exports are limited/)).toBeTruthy()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUsageText(USAGE_EN)
  setUiText(EN, 'en')
  vi.useRealTimers()
})

describe('UsageApp', () => {
  it('compares the selected metric with its previous period without inventing a zero baseline', () => {
    const state = usageStateFor('one-provider', NOW)
    const { send } = setup(state)
    expect(screen.getByText('No usage in the previous period.')).toBeInTheDocument()
    state.previousTotals = usageTotals('reported', 2)
    send({ type: 'usage/state', state })
    expect(screen.getByText('-50% compared with the previous period')).toBeInTheDocument()
    state.query.metric = 'requests'
    send({ type: 'usage/state', state })
    expect(screen.getByText('0% compared with the previous period')).toBeInTheDocument()
    state.previousTotals.records = 0
    send({ type: 'usage/state', state })
    expect(screen.getByText('No usage in the previous period.')).toBeInTheDocument()
    state.previousTotals = usageTotals('reported')
    state.previousTotals.costs[0]!.usd = 0
    state.query.metric = 'cost'
    send({ type: 'usage/state', state })
    expect(screen.queryByText(/compared with the previous period/)).toBeNull()
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0)
  })
  it('reports newer records and incomplete lines without hiding the empty state', () => {
    const state = usageStateFor('empty', NOW)
    state.history.newerVersionRecords = 7
    state.history.tornLines = 1
    setup(state)
    expect(screen.getByRole('heading', { name: 'No usage yet' })).toBeInTheDocument()
    expect(screen.getByText('7 records from a newer version')).toBeInTheDocument()
    expect(screen.getByText('1 incomplete line skipped')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Breakdown' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Usage by feature' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Muse Code model attempts' })).toBeNull()
  })
  it('makes no data/network request while rendering and operating the page', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { host } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open provider console' }))
    expect(host.post).toHaveBeenCalledWith({ type: 'usage/refresh' })
    expect(host.post).toHaveBeenCalledWith({
      type: 'usage/openExternal',
      url: 'https://aistudio.google.com/',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(USAGE_SCENARIOS)(
    'renders the checked %s harness state and keeps live sources',
    (scenario) => {
      const state = usageStateFor(scenario, NOW)
      expect(usagePageStateSchema.safeParse(state).success).toBe(true)
      setup(state)
      expect(screen.getByRole('heading', { name: 'Usage & cost', level: 1 })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Limits & budgets' })).toBeInTheDocument()
      expect(screen.getByText('History is stored on win11 · remote workspace.')).toBeInTheDocument()
      expect(
        screen.getByText('gemini does not report a limit here.', { exact: false }),
      ).toBeInTheDocument()
    },
  )

  it('registers before ready, cleans up delivery and makes malformed boundaries explicit', () => {
    const { host, send, unmount } = setup()
    expect(host.post).toHaveBeenCalledWith({ type: 'usage/ready' })
    send({ type: 'usage/state', state: { tokens: { input: -1 } } })
    expect(screen.getByRole('alert')).toHaveTextContent('could not be validated')
    unmount()
    send({ type: 'usage/error', code: 'readFailed' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends every range, group and metric and ignores a superseded query response', () => {
    const { host, state, send } = setup()
    for (const [name, range] of [
      ['7 days', '7d'],
      ['30 days', '30d'],
      ['90 days', '90d'],
      ['Today', 'today'],
    ] as const) {
      fireEvent.click(screen.getByRole('radio', { name }))
      expect(host.post).toHaveBeenLastCalledWith({
        type: 'usage/query',
        query: { range, groupBy: 'provider', metric: 'cost' },
      })
    }
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'model' } })
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'tokens' } })
    expect(host.post).toHaveBeenLastCalledWith({
      type: 'usage/query',
      query: { range: 'today', groupBy: 'model', metric: 'tokens' },
    })
    send({ type: 'usage/state', state })
    expect(screen.getByLabelText('Metric')).toHaveValue('tokens')
    send({
      type: 'usage/state',
      state: { ...state, query: { range: 'today', groupBy: 'model', metric: 'tokens' } },
    })
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
    expect(
      screen.getByText('Input & output tokens over time', { selector: 'figcaption' }),
    ).toBeInTheDocument()
  })

  it('refuses incomplete or backwards custom dates and sends inclusive valid dates', () => {
    const { host } = setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Custom range' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-04' } })
    expect(screen.getByText('Choose an end date on or after the start date.')).toBeInTheDocument()
    expect(host.post).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-05' } })
    expect(host.post).toHaveBeenLastCalledWith({
      type: 'usage/query',
      query: {
        range: 'custom',
        from: '2026-10-05',
        to: '2026-10-05',
        groupBy: 'provider',
        metric: 'cost',
      },
    })
    expect(screen.queryByText('Choose an end date on or after the start date.')).toBeNull()
  })
  it('shows a host-supplied custom range and keeps incomplete edits local', () => {
    const state = usageStateFor('one-provider', NOW)
    state.query = {
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-05',
      groupBy: 'provider',
      metric: 'cost',
    }
    const { host } = setup(state)
    expect(screen.getByRole('radio', { name: 'Custom range' })).toBeChecked()
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-05')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
    expect(screen.getByLabelText('From')).toHaveValue('')
    expect(host.post).toHaveBeenCalledTimes(1)
  })
  it('refuses unknown grouping and metrics from a control event', () => {
    const { host } = setup()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'invented' } })
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'invented' } })
    expect(host.post).toHaveBeenCalledTimes(1)
  })

  it('preserves custom-date input identity and focus across consecutive valid edits and host replies', () => {
    const state = usageStateFor('one-provider', NOW)
    state.query = {
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-05',
      groupBy: 'provider',
      metric: 'cost',
    }
    const { host, send } = setup(state)
    for (const [label, dates] of [
      ['From', ['2026-10-02', '2026-10-03']],
      ['To', ['2026-10-06', '2026-10-07']],
    ] as const) {
      const input = screen.getByLabelText(label)
      input.focus()
      for (const value of dates) {
        fireEvent.change(input, { target: { value } })
        expect(screen.getByLabelText(label)).toBe(input)
        expect(input).toHaveFocus()
        const message = vi.mocked(host.post).mock.calls.at(-1)?.[0]
        if (message?.type !== 'usage/query') throw new Error('Missing custom query')
        expect(message.query[label === 'From' ? 'from' : 'to']).toBe(value)
        send({ type: 'usage/state', state: { ...state, query: message.query } })
        expect(input).toHaveFocus()
      }
    }
  })

  it('synchronizes changed host ranges without overwriting incomplete local date drafts', () => {
    const { state, send } = setup()
    const query = {
      ...state.query,
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-05',
    } as const
    send({ type: 'usage/state', state: { ...state, query } })
    const input = screen.getByLabelText('From')
    fireEvent.change(input, { target: { value: '' } })
    send({ type: 'usage/state', state: { ...state, query } })
    expect(input).toHaveValue('')
    send({
      type: 'usage/state',
      state: { ...state, query: { ...query, from: '2026-10-02' } },
    })
    expect(screen.getByLabelText('From')).toBe(input)
    expect(input).toHaveValue('2026-10-02')
    send({ type: 'usage/state', state })
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    expect(screen.queryByLabelText('From')).toBeNull()
  })

  it('recovers from native action send failures with localized text, cleared busy state and retry', () => {
    const { host, send, state } = setup()
    send({
      type: 'usage/table',
      locale: 'de',
      table: { ...USAGE_EN, readFailed: 'Der Nutzungsverlauf konnte nicht gelesen werden.' },
    })
    for (const label of ['Refresh', 'Usage settings']) {
      vi.mocked(host.post).mockImplementationOnce(() => {
        throw new Error('Private native transport detail')
      })
      expect(() => fireEvent.click(screen.getByRole('button', { name: label }))).not.toThrow()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Der Nutzungsverlauf konnte nicht gelesen werden.',
      )
      expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false')
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled()
      expect(screen.queryByText(/Private native transport detail/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(host.post).toHaveBeenLastCalledWith({ type: 'usage/refresh' })
      send({ type: 'usage/state', state })
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })

  it('drops failed action correlations and accepts the current host query after retrying a failed query send', () => {
    const { host, send, state } = setup()
    vi.mocked(host.post).mockImplementationOnce(() => {
      throw new Error('Native send failed')
    })
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    expect(screen.getByRole('alert')).toHaveTextContent(USAGE_EN.readFailed)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    send({ type: 'usage/state', state })
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false')
    for (const action of ['export', 'deleteHistory'] as const) {
      vi.mocked(host.post).mockImplementationOnce(() => {
        throw new Error('Native send failed')
      })
      if (action === 'export') {
        fireEvent.click(screen.getByRole('button', { name: 'Export' }))
        fireEvent.click(screen.getByRole('button', { name: 'Versioned JSON' }))
      } else fireEvent.click(screen.getByRole('button', { name: 'Delete usage history…' }))
      const message = vi.mocked(host.post).mock.calls.at(-1)?.[0]
      if (message === undefined || !('requestId' in message)) throw new Error('Missing action')
      send({ type: 'usage/result', requestId: message.requestId, action, outcome: 'completed' })
      expect(screen.queryByText(USAGE_EN.exportComplete)).toBeNull()
      expect(screen.queryByText(USAGE_EN.deleteComplete)).toBeNull()
      expect(screen.getByRole('alert')).toHaveTextContent(USAGE_EN.readFailed)
    }
  })

  it('exports each format with the exact query and correlates results without inventing grants', () => {
    const { host, state, send } = setup()
    for (const [name, format] of [
      ['Per-call CSV (last 30 days)', 'callsCsv'],
      ['Summary CSV', 'summaryCsv'],
      ['Versioned JSON', 'json'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }))
      fireEvent.click(screen.getByRole('button', { name }))
      expect(host.post).toHaveBeenLastCalledWith({
        type: 'usage/export',
        requestId: expect.any(String),
        query: state.query,
        format,
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Versioned JSON' }).closest('div')!, {
      key: 'Escape',
    })
    expect(screen.queryByRole('button', { name: 'Versioned JSON' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Delete usage history…' }))
    expect(host.post).toHaveBeenLastCalledWith({
      type: 'usage/deleteHistory',
      requestId: expect.any(String),
    })
    const call = vi.mocked(host.post).mock.calls.at(-1)?.[0]
    if (call?.type !== 'usage/deleteHistory') throw new Error('Missing delete')
    send({
      type: 'usage/result',
      requestId: 'unrelated',
      action: 'deleteHistory',
      outcome: 'completed',
    })
    expect(screen.queryByText('Usage history deleted.')).toBeNull()
    send({
      type: 'usage/result',
      requestId: call.requestId,
      action: 'deleteHistory',
      outcome: 'completed',
    })
    expect(screen.getByText('Usage history deleted.')).toBeInTheDocument()
  })

  it('history off still shows subscription and budget; enabling, settings, folder and console use the bridge', () => {
    const { host } = setup(usageStateFor('history-off', NOW))
    expect(
      screen.getByText(
        'New calls are not recorded. Live subscription and budget sources still appear.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: '62% used, resets in 2h 5m' }),
    ).toBeInTheDocument()
    for (const [label, message] of [
      ['Turn on usage history', { type: 'usage/setHistory', enabled: true }],
      ['Usage settings', { type: 'usage/openSettings' }],
      ['Open history folder', { type: 'usage/revealFolder' }],
      [
        'Open provider console',
        { type: 'usage/openExternal', url: 'https://aistudio.google.com/' },
      ],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(host.post).toHaveBeenLastCalledWith(message)
    }
  })

  it('shows unknown values and per-record certainty without charging reasoning or API-equivalent plan prices twice', () => {
    const state = usageStateFor('plan-only', NOW)
    state.totals.tokens = {}
    state.totals.durationMs = undefined
    state.totals.costs.push(
      { certainty: 'uncertain', records: 1, usd: 0.04 },
      { certainty: 'unpriced', records: 1 },
    )
    setup(state)
    const total = screen.getByText('Total cost', { selector: 'dt' }).closest('div')
    expect(total).toHaveTextContent('Unknown')
    expect(
      screen.getByText('API-equivalent cost', { selector: 'dt' }).closest('div'),
    ).toHaveTextContent('$0.10')
    expect(screen.getByText('Input tokens', { selector: 'dt' }).closest('div')).toHaveTextContent(
      'Unknown',
    )
    expect(
      screen.getByText('Total request time', { selector: 'dt' }).closest('div'),
    ).toHaveTextContent('Unknown')
    expect(
      screen.getByText('No price card is available. Unknown cost is not zero.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Reasoning is included in output; it is not charged twice.'),
    ).toBeInTheDocument()
  })

  it('sorts breakdowns with aria-sort, keeps unknown last, and deep-links model detail to prices', () => {
    const state = usageStateFor('nine-providers', NOW)
    state.breakdown[0]!.totals = {
      ...state.breakdown[0]!.totals,
      costs: [{ certainty: 'unpriced', records: 2 }],
    }
    state.breakdown.push({ ...state.breakdown[0]!, id: 'unknown-tail', label: 'unknown-tail' })
    const { host, send } = setup(state)
    const table = screen.getByRole('table', { name: 'Breakdown' })
    fireEvent.click(within(table).getByRole('button', { name: 'Cost: Sort ascending' }))
    expect(
      within(table).getByRole('button', { name: 'Cost: Sort descending' }).closest('th'),
    ).toHaveAttribute('aria-sort', 'ascending')
    expect(within(table).getAllByRole('row').at(-2)).toHaveTextContent('meta')
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('unknown-tail')
    fireEvent.click(within(table).getByRole('button', { name: 'Cost: Sort descending' }))
    expect(within(table).getAllByRole('row').at(-2)).toHaveTextContent('meta')
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('unknown-tail')
    fireEvent.click(within(table).getByRole('button', { name: 'openai' }))
    expect(host.post).toHaveBeenLastCalledWith({
      type: 'usage/modelDetail',
      provider: 'openai',
      model: 'model-1',
    })
    send({
      type: 'usage/state',
      state: {
        ...state,
        modelDetail: {
          provider: 'openai',
          model: 'model-1',
          totals: state.totals,
          trend: state.buckets,
          pricedLater: true,
          price: {
            inputPerMillion: 0.5,
            cachedPerMillion: 0.002,
            outputPerMillion: 2,
            source: 'user',
            date: '2026-10-05',
          },
        },
      },
    })
    expect(
      screen.getByText('Shown with a newer price card; stored history is unchanged.'),
    ).toBeInTheDocument()
    expect(screen.getByText('$0.002000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set price' }))
    expect(host.post).toHaveBeenLastCalledWith({
      type: 'usage/openModels',
      provider: 'openai',
      model: 'model-1',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('heading', { name: 'Model detail: openai / model-1' })).toBeNull()
  })

  it('keeps an empty model trend readable without an empty chart table', () => {
    const state = usageStateFor('one-provider', NOW)
    state.modelDetail = {
      provider: 'meta',
      model: 'model-0',
      totals: state.totals,
      trend: [],
      pricedLater: false,
    }
    setup(state)
    const detail = screen
      .getByRole('heading', { name: 'Model detail: meta / model-0' })
      .closest('section')!
    expect(within(detail).getByText('No model calls in this range.')).toBeInTheDocument()
    expect(within(detail).queryByRole('table', { hidden: true })).toBeNull()
    expect(within(detail).getAllByText('Unknown').length).toBeGreaterThan(0)
  })

  it('installs checked runtime translations and Intl formats, refusing invalid locale or table', () => {
    const { send } = setup()
    send({
      type: 'usage/table',
      locale: 'de',
      table: { ...USAGE_EN, title: 'Nutzung und Kosten', refresh: 'Aktualisieren' },
    })
    expect(screen.getByRole('heading', { name: 'Nutzung und Kosten' })).toBeInTheDocument()
    expect(screen.getByText('Input tokens', { selector: 'dt' }).closest('div')).toHaveTextContent(
      '1.000',
    )
    send({ type: 'usage/table', locale: 'invalid_locale!', table: USAGE_EN })
    expect(screen.getByRole('heading', { name: 'Nutzung und Kosten' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('could not be validated')
    send({ type: 'usage/table', locale: 'en', table: { title: 'Incomplete' } })
    expect(screen.getByRole('heading', { name: 'Nutzung und Kosten' })).toBeInTheDocument()
  })

  it('reports read/write/export failures using localized text and retries through refresh', () => {
    const { host, send } = setup()
    for (const [code, text] of [
      ['readFailed', 'Usage history could not be read.'],
      ['writeFailed', 'Usage history could not be written.'],
      ['exportRange', 'Per-call export is available only for the last 30 days.'],
      ['unsupported', 'This host does not support that usage action.'],
    ]) {
      send({ type: 'usage/error', code })
      expect(screen.getByRole('alert')).toHaveTextContent(text!)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(host.post).toHaveBeenLastCalledWith({ type: 'usage/refresh' })
  })
})
