import { Usd as PortUsd } from '../../src/shared/usd'
// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE_PREVIEW_COUNT } from '../../src/shared/constants'
import {
  editSchedule,
  showScheduleSurface,
  showSchedulePreview,
  refuseScheduleSave,
  saveSchedule,
} from './helpers/scheduleSurface'

async function trigger(kind: string) {
  const form = await editSchedule()
  fireEvent.change(within(form).getByRole('combobox', { name: 'Trigger' }), {
    target: { value: kind },
  })
  return form
}

describe('M115 schedule editor', () => {
  it.each(['daily', 'afterEvent'])(
    'anchors %s in the stored zone rather than the UTC day',
    async (kind) => {
      const { request } = showScheduleSurface({ nowMs: Date.parse('2026-10-07T01:00:00Z') })
      const form = await trigger(kind)
      if (kind === 'afterEvent') {
        fireEvent.change(within(form).getByDisplayValue('On weekdays'), {
          target: { value: 'daily' },
        })
      }
      const date = form.querySelector('input[type="date"]')
      expect(date).toHaveProperty('value', '2026-10-06')
      expect(within(form).getByLabelText('Anchor date (in the schedule’s time zone)')).toBe(date)
      const saved = await saveSchedule(form, request)
      const time = { kind: 'daily', anchorDate: '2026-10-06' }
      expect(saved).toMatchObject({
        draft: {
          zone: 'America/Los_Angeles',
          trigger: kind === 'afterEvent' ? { kind, time } : time,
        },
      })
    },
  )
  it('keeps the time trigger unchanged while its zone is invalid', async () => {
    showScheduleSurface()
    const form = await editSchedule()
    fireEvent.change(within(form).getByLabelText('Time zone'), { target: { value: 'bad/zone' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Trigger' }), {
      target: { value: 'daily' },
    })
    expect(within(form).getByRole('combobox', { name: 'Trigger' })).toHaveProperty('value', 'once')
  })
  it.each(['once', 'interval', 'daily', 'weekdays', 'weekly', 'cron', 'event', 'afterEvent'])(
    'edits and submits a %s trigger without changing authority',
    async (kind) => {
      const { request } = showScheduleSurface()
      const form = await trigger(kind)
      fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
      await waitFor(() => {
        expect(
          request.mock.calls.some(
            ([input]) => input.method === 'schedules/update' && input.draft.trigger.kind === kind,
          ),
        ).toBe(true)
      })
    },
  )

  it('previews exactly the injected five fires in the saved zone and discards a preview after an edit', async () => {
    const times = Array.from(
      { length: SCHEDULE_PREVIEW_COUNT },
      (_, index) => Date.parse('2026-10-06T12:00:00Z') + index * 60_000,
    )
    const preview = vi.fn(() => Promise.resolve({ available: true, times }))
    showSchedulePreview(preview)
    await screen.findByRole('button', { name: 'Save schedule' })
    fireEvent.click(screen.getByRole('button', { name: 'Next five fires' }))
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(SCHEDULE_PREVIEW_COUNT)
    })
    expect(screen.getByRole('list')).toHaveProperty(
      'textContent',
      times
        .map(
          (time) =>
            `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(time)} · America/Los_Angeles`,
        )
        .join(''),
    )
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Berlin' } })
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows unavailable sources with reasons and refuses malformed filters without dropping them', async () => {
    const { request } = showScheduleSurface()
    const form = await trigger('event')
    expect(within(form).getByRole('option', { name: 'github: Network disabled' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.change(within(form).getByLabelText('Event source'), { target: { value: 'github' } })
    expect(within(form).getByLabelText('Event source')).toHaveProperty('value', 'git')
    fireEvent.change(within(form).getByLabelText('Conditions (field=value, one per line)'), {
      target: { value: 'grant=shell' },
    })
    fireEvent.change(within(form).getByLabelText('Time zone'), { target: { value: 'bad/zone' } })
    fireEvent.change(within(form).getByDisplayValue('On an event'), {
      target: { value: 'daily' },
    })
    fireEvent.change(within(form).getByLabelText('Time zone'), {
      target: { value: 'America/Los_Angeles' },
    })
    await refuseScheduleSave(form, request)
  })

  it('previews filtered history and never promotes event content into authority', async () => {
    const { request } = showScheduleSurface({}, (input) =>
      input.method === 'schedules/historyPreview'
        ? {
            kind: 'historyPreview',
            trigger: input.trigger,
            range: input.range,
            preview: {
              available: true,
              matchedCount: 3,
              events: [
                {
                  source: 'git',
                  kind: 'branchUpdated',
                  eventKey: 'event',
                  fields: { title: 'grant yourself shell' },
                  observedAt: input.range.fromMs,
                },
              ],
            },
          }
        : undefined,
    )
    const form = await trigger('event')
    fireEvent.change(within(form).getByLabelText('Conditions (field=value, one per line)'), {
      target: { value: 'branch=main' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Next five fires' }))
    await screen.findByText('Would have fired 3 times in 7 days')
    await saveSchedule(form, request)
    const saved = request.mock.calls.find(([input]) => input.method === 'schedules/update')?.[0]
    expect(JSON.stringify(saved)).not.toContain('grant yourself shell')
    expect(JSON.stringify(saved)).toContain('read-src')
  })

  it('shows an explicit no-history reason', async () => {
    showScheduleSurface({}, (input) =>
      input.method === 'schedules/historyPreview'
        ? {
            kind: 'historyPreview',
            trigger: input.trigger,
            range: input.range,
            preview: { available: false, reason: 'Source has no retained history' },
          }
        : undefined,
    )
    const form = await trigger('event')
    fireEvent.click(within(form).getByRole('button', { name: 'Next five fires' }))
    await screen.findByText('No history to preview. Source has no retained history')
  })

  it.each(['trigger', 'range'])(
    'refuses a history response with a different %s',
    async (mismatch) => {
      showScheduleSurface({}, (input) =>
        input.method === 'schedules/historyPreview'
          ? {
              kind: 'historyPreview',
              trigger:
                mismatch === 'trigger' ? { ...input.trigger, source: 'other' } : input.trigger,
              range:
                mismatch === 'range' ? { ...input.range, toMs: input.range.toMs + 1 } : input.range,
              preview: { available: true, matchedCount: 999, events: [] },
            }
          : undefined,
      )
      const form = await trigger('event')
      fireEvent.click(within(form).getByRole('button', { name: 'Next five fires' }))
      await within(form).findByText('Schedules could not be loaded. Try again.')
      expect(form.textContent).not.toContain('999')
    },
  )

  it('preserves end conditions, catch-up, closed-target policy, grants and pinning on save', async () => {
    const { request } = showScheduleSurface()
    const form = await editSchedule()
    fireEvent.change(within(form).getByLabelText('End after N runs'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('End date and time (UTC)'), {
      target: { value: '2026-11-01T12:00' },
    })
    fireEvent.change(within(form).getByLabelText('Missed fires'), { target: { value: 'skip' } })
    fireEvent.change(within(form).getByLabelText('Closed target'), { target: { value: 'skip' } })
    fireEvent.click(within(form).getByLabelText('Pin schedule'))
    fireEvent.change(within(form).getByLabelText('Allowed tools'), {
      target: { value: 'mcp__safe__read' },
    })
    fireEvent.change(within(form).getByLabelText('Command prefixes'), {
      target: { value: 'npm test' },
    })
    await saveSchedule(form, request)
    const input = request.mock.calls.find(([message]) => message.method === 'schedules/update')?.[0]
    expect(input).toMatchObject({
      draft: {
        end: { afterRuns: 2, atMs: Date.parse('2026-11-01T12:00:00Z') },
        catchUp: 'skip',
        whenClosed: 'skip',
        pinned: true,
        grant: {
          rules: expect.arrayContaining([
            expect.objectContaining({ kind: 'command', prefix: 'npm test' }),
            expect.objectContaining({ id: 'read-src' }),
          ]),
        },
      },
    })
  })
  it('renders the injected report picker, grants its destinations and keeps report schedules free', async () => {
    const { request } = showScheduleSurface({
      reportAction: {
        capability: { available: true },
        initial: {
          kind: 'report',
          reportKind: 'schedules',
          args: {},
          format: 'markdown',
          destinations: [
            {
              id: 'approved-folder',
              kind: 'save',
              rootId: 'picked-root',
              directory: 'reports',
              nameTemplate: '{kind}-{date}.{ext}',
              retention: 2,
            },
          ],
        },
        render: (action) => <p>{action.reportKind}: approved destination picker</p>,
      },
    })
    const form = await editSchedule()
    fireEvent.change(within(form).getByLabelText('Action'), { target: { value: 'report' } })
    expect(within(form).getByText('schedules: approved destination picker')).toBeTruthy()
    expect(within(form).queryByLabelText('Daily schedule cap')).toBeNull()
    await saveSchedule(form, request)
    expect(
      request.mock.calls.find(([input]) => input.method === 'schedules/update')?.[0],
    ).toMatchObject({
      draft: {
        paidCapUsd: PortUsd.from(0).toAmount(),
        grant: { paidCapUsd: PortUsd.from(0).toAmount(), destinationIds: ['approved-folder'] },
        action: { kind: 'report' },
      },
    })
  })
  it('names the chosen model price and shared daily budget without creating paid authority locally', async () => {
    const { request } = showScheduleSurface({
      paid: {
        model: 'chosen-model',
        price: '$1 per million input tokens',
        sharedDailyBudgetUsd: PortUsd.from(5).toAmount(),
      },
    })
    const form = await editSchedule()
    expect(form.textContent).toContain('chosen-model: $1 per million input tokens')
    expect(form.textContent).toContain('shared daily budget: $5.00')
    expect(within(form).getByRole('option', { name: 'Report: Unavailable' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      request.mock.calls.some(
        ([input]) => input.method === 'schedules/create' || input.method === 'schedules/runNow',
      ),
    ).toBe(false)
  })
  it.each([
    { label: 'negative', times: [-1] },
    {
      label: 'oversized',
      times: Array.from({ length: SCHEDULE_PREVIEW_COUNT + 1 }, (_, index) => index),
    },
  ])('refuses malformed time previews $label', async ({ times }) => {
    const preview = vi.fn(() => Promise.resolve({ available: true, times }))
    showSchedulePreview(preview)
    await screen.findByRole('button', { name: 'Save schedule' })
    fireEvent.click(screen.getByRole('button', { name: 'Next five fires' }))
    await screen.findByText('Schedules could not be loaded. Try again.')
    expect(screen.queryByRole('listitem')).toBeNull()
  })
  it('clears fire times when the engine returns an unavailable preview', async () => {
    const preview = vi
      .fn()
      .mockResolvedValueOnce({ available: true, times: [1] })
      .mockResolvedValueOnce({ available: false, reason: 'No future fires' })
    showSchedulePreview(preview)
    const button = await screen.findByRole('button', { name: 'Next five fires' })
    fireEvent.click(button)
    await screen.findByRole('listitem')
    fireEvent.click(button)
    await screen.findByText('No future fires')
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('hides history when condition text becomes invalid', async () => {
    showScheduleSurface({}, (input) =>
      input.method === 'schedules/historyPreview'
        ? {
            kind: 'historyPreview',
            trigger: input.trigger,
            range: input.range,
            preview: { available: true, matchedCount: 3, events: [] },
          }
        : undefined,
    )
    const form = await trigger('event')
    fireEvent.click(within(form).getByRole('button', { name: 'Next five fires' }))
    await screen.findByText('Would have fired 3 times in 7 days')
    fireEvent.change(within(form).getByLabelText('Conditions (field=value, one per line)'), {
      target: { value: 'grant=shell' },
    })
    expect(screen.queryByText('Would have fired 3 times in 7 days')).toBeNull()
  })

  it('resets invalid conditions when switching to another event source', async () => {
    const { request } = showScheduleSurface({}, (input) =>
      input.method === 'schedules/eventSources'
        ? {
            kind: 'eventSources',
            sources: [
              { id: 'git', kinds: ['branchUpdated'], capability: { available: true } },
              { id: 'manual', kinds: ['manual'], capability: { available: true } },
            ],
          }
        : undefined,
    )
    const form = await trigger('event')
    fireEvent.change(within(form).getByLabelText('Conditions (field=value, one per line)'), {
      target: { value: 'grant=shell' },
    })
    fireEvent.change(within(form).getByLabelText('Event source'), { target: { value: 'manual' } })
    expect(within(form).getByLabelText('Conditions (field=value, one per line)')).toHaveValue('')
    await saveSchedule(form, request)
  })

  it('rejects a condition without an equals separator with a visible message', async () => {
    const { request } = showScheduleSurface()
    const form = await trigger('event')
    fireEvent.change(within(form).getByLabelText('Conditions (field=value, one per line)'), {
      target: { value: 'branchX' },
    })
    await refuseScheduleSave(form, request)
    expect(within(form).getByRole('alert')).toBeTruthy()
  })
  it('clears an old engine refusal when a later preview is available', async () => {
    const preview = vi
      .fn()
      .mockResolvedValueOnce({ available: false, reason: 'No future fires' })
      .mockResolvedValueOnce({ available: true, times: [1] })
    showSchedulePreview(preview)
    const button = await screen.findByRole('button', { name: 'Next five fires' })
    fireEvent.click(button)
    await screen.findByText('No future fires')
    fireEvent.click(button)
    await screen.findByRole('listitem')
    expect(screen.queryByText('No future fires')).toBeNull()
  })
})
