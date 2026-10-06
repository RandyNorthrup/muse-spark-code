// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SCHEDULE_PROTOCOL_VERSION } from '../../src/shared/constants'
import { scheduleViewV2Of, type ScheduleRequest } from '../../src/shared/scheduleV2'
import { showScheduleSurface } from './helpers/scheduleSurface'
import { fakeSchedule } from './helpers/schedules/fixtures'

function openAudit(card: HTMLElement) {
  const details = within(card).getByText('Grant audit').parentElement
  if (!(details instanceof HTMLDetailsElement)) throw new Error('Missing audit details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  return details
}

describe('RVM115V authority regressions', () => {
  it('keeps Pause and Revoke clickable during a pending audit and serializes each schedule', async () => {
    const pendingAudit = Promise.withResolvers<unknown>()
    const pendingPause = Promise.withResolvers<unknown>()
    const { request, schedule } = showScheduleSurface({}, (input) => {
      if (input.method === 'schedules/grantAudit') return pendingAudit.promise
      return input.method === 'schedules/pause' ? pendingPause.promise : undefined
    })
    const card = await screen.findByRole('article')
    openAudit(card)
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'schedules/grantAudit' }),
      )
    })
    const pause = within(card).getByRole('button', { name: 'Pause schedule' })
    const revoke = within(card).getByRole('button', { name: 'Revoke grant' })
    expect(pause).toBeEnabled()
    expect(revoke).toBeEnabled()
    fireEvent.click(pause)
    fireEvent.click(revoke)
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'schedules/pause' }))
    })
    expect(request.mock.calls.some(([input]) => input.method === 'schedules/revokeGrant')).toBe(
      false,
    )
    act(() => {
      pendingPause.resolve({ kind: 'accepted' })
    })
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'schedules/revokeGrant' }),
      )
    })
    act(() => {
      pendingAudit.resolve({ kind: 'grantAudit', scheduleId: schedule.id, entries: [] })
    })
  })

  it.each(['refresh', 'acknowledgement'])(
    'shows unknown authority after a lost %s and retries safely',
    async (failure) => {
      let lists = 0
      let shouldFail = true
      const stored = scheduleViewV2Of(
        fakeSchedule({ paused: true, grant: { rules: [], destinationIds: [], paidCapUsd: 0 } }),
      )
      const { request } = showScheduleSurface({}, (input) => {
        if (failure === 'acknowledgement' && input.method === 'schedules/pause')
          return Promise.reject(new Error('Lost reply'))
        if (input.method === 'schedules/list' && lists++ > 0) {
          return shouldFail
            ? Promise.reject(new Error('Read failed'))
            : { kind: 'list', schedules: [stored] }
        }
        return undefined
      })
      const card = await screen.findByRole('article')
      fireEvent.click(within(card).getByRole('button', { name: 'Pause schedule' }))
      await within(card).findByText('State unknown — Retry')
      expect(within(card).queryByRole('button', { name: 'Resume schedule' })).toBeNull()
      expect(within(card).getByRole('button', { name: 'Run now' })).toBeDisabled()
      expect(card.textContent).not.toContain('src/**')
      expect(within(card).getByRole('button', { name: 'Revoke grant' })).toBeEnabled()
      shouldFail = false
      fireEvent.click(within(card).getByRole('button', { name: 'Retry' }))
      await within(card).findByRole('button', { name: 'Resume schedule' })
      expect(within(card).queryByText('State unknown — Retry')).toBeNull()
      expect(
        request.mock.calls.filter(([input]) => input.method === 'schedules/pause'),
      ).toHaveLength(1)
    },
  )

  it('retains loaded schedules and authority controls when event sources fail', async () => {
    showScheduleSurface({}, (input) =>
      input.method === 'schedules/eventSources'
        ? Promise.reject(new Error('Sources offline'))
        : undefined,
    )
    const card = await screen.findByRole('article')
    await screen.findByRole('alert')
    expect(screen.queryByText('No schedules in this workspace.')).toBeNull()
    expect(within(card).getByRole('button', { name: 'Revoke grant' })).toBeEnabled()
  })

  it('rereads validated workspace changes while mounted and unsubscribes on close', async () => {
    const subscribeChanges = vi.fn<(listener: (message: unknown) => void) => () => void>()
    const unsubscribe = vi.fn()
    subscribeChanges.mockReturnValue(unsubscribe)
    let stored = scheduleViewV2Of(fakeSchedule())
    const request = vi.fn((input: ScheduleRequest) =>
      Promise.resolve(
        input.method === 'schedules/list'
          ? { kind: 'list', schedules: [stored] }
          : { kind: 'eventSources', sources: [] },
      ),
    )
    const { context, unmount } = showScheduleSurface({
      port: {
        request,
        preview: () => Promise.resolve({ available: true, times: [] }),
        subscribeChanges,
      },
    })
    const card = await screen.findByRole('article')
    const change = subscribeChanges.mock.calls[0]?.[0]
    expect(change).toBeTypeOf('function')
    stored = { ...stored, paused: true, fireCount: 3 }
    act(() => {
      change?.({
        type: 'scheduleChanged',
        version: SCHEDULE_PROTOCOL_VERSION,
        workspaceKey: 'other',
        revision: 1,
      })
      change?.({
        type: 'scheduleChanged',
        version: SCHEDULE_PROTOCOL_VERSION,
        workspaceKey: context.workspaceKey,
        revision: -1,
      })
    })
    expect(request.mock.calls.filter(([input]) => input.method === 'schedules/list')).toHaveLength(
      1,
    )
    act(() => {
      change?.({
        type: 'scheduleChanged',
        version: SCHEDULE_PROTOCOL_VERSION,
        workspaceKey: context.workspaceKey,
        revision: 1,
      })
    })
    await within(card).findByRole('button', { name: 'Resume schedule' })
    expect(card.textContent).toContain('Ran 3 times')
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('refetches an open audit after a successful mutation', async () => {
    let audits = 0
    const { schedule } = showScheduleSurface({}, (input) =>
      input.method === 'schedules/grantAudit'
        ? {
            kind: 'grantAudit',
            scheduleId: input.id,
            entries: [{ scheduleId: input.id, atMs: 1, kind: audits++ === 0 ? 'used' : 'changed' }],
          }
        : undefined,
    )
    const card = await screen.findByRole('article', { name: schedule.name })
    const details = openAudit(card)
    await within(details).findByText(/Used ·/)
    fireEvent.click(within(card).getByRole('button', { name: 'Pause schedule' }))
    await within(details).findByText(/Changed ·/)
    expect(details.open).toBe(true)
    expect(audits).toBe(2)
  })

  it('uses the supplied conversation title on cards and timelines', async () => {
    showScheduleSurface({
      targets: [
        {
          id: 'current',
          label: 'Build conversation',
          target: { backend: 'modelApi', sessionId: 'session-1', kind: 'conversation' },
          capability: { available: true },
        },
      ],
    })
    const card = await screen.findByRole('article')
    expect(card.textContent).toContain('Build conversation')
    expect(card.textContent).not.toContain('This conversation')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit schedule' }))
    expect(screen.getByLabelText('Target')).toHaveValue('current')
    fireEvent.click(screen.getByRole('button', { name: 'Schedule timeline' }))
    const timeline = await screen.findByRole('region', { name: 'Schedule timeline' })
    expect(timeline.textContent).toContain('Build conversation')
    expect(timeline.textContent).not.toContain('This conversation')
  })
  it('keeps authority on another schedule independent of a pending mutation', async () => {
    const pending = Promise.withResolvers<unknown>()
    const second = scheduleViewV2Of(fakeSchedule({ id: 'second', name: 'Second schedule' }))
    const { request } = showScheduleSurface({}, (input) => {
      if (input.method === 'schedules/list')
        return { kind: 'list', schedules: [scheduleViewV2Of(fakeSchedule()), second] }
      return input.method === 'schedules/pause' ? pending.promise : undefined
    })
    const cards = await screen.findAllByRole('article')
    const first = cards[0]
    if (first === undefined) throw new Error('Missing first schedule')
    fireEvent.click(within(first).getByRole('button', { name: 'Pause schedule' }))
    fireEvent.click(
      within(screen.getByRole('article', { name: second.name })).getByRole('button', {
        name: 'Revoke grant',
      }),
    )
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'schedules/revokeGrant', id: second.id }),
      )
    })
    act(() => {
      pending.resolve({ kind: 'accepted' })
    })
  })

  it('keeps the newest list when older change reads arrive late', async () => {
    const older = Promise.withResolvers<unknown>()
    const newer = Promise.withResolvers<unknown>()
    let listReads = 0
    const stored = scheduleViewV2Of(fakeSchedule())
    let change: ((message: unknown) => void) | undefined
    const request = (input: ScheduleRequest) => {
      if (input.method !== 'schedules/list')
        return Promise.resolve({ kind: 'eventSources', sources: [] })
      const reads = listReads++
      if (reads === 0) return Promise.resolve({ kind: 'list', schedules: [stored] })
      return reads === 1 ? older.promise : newer.promise
    }
    showScheduleSurface({
      port: {
        request,
        preview: () => Promise.resolve({ available: true, times: [] }),
        subscribeChanges: (listener) => {
          change = listener
          return () => {
            change = undefined
          }
        },
      },
    })
    const card = await screen.findByRole('article')
    act(() => {
      for (const revision of [1, 2])
        change?.({
          type: 'scheduleChanged',
          version: SCHEDULE_PROTOCOL_VERSION,
          workspaceKey: stored.workspaceKey,
          revision,
        })
      newer.resolve({ kind: 'list', schedules: [{ ...stored, paused: true, fireCount: 3 }] })
    })
    await within(card).findByRole('button', { name: 'Resume schedule' })
    await act(async () => {
      older.resolve({ kind: 'list', schedules: [stored] })
      await older.promise
    })
    expect(within(card).getByRole('button', { name: 'Resume schedule' })).toBeEnabled()
    expect(card.textContent).toContain('Ran 3 times')
  })

  it('keeps a refreshed audit when its older request arrives after a mutation', async () => {
    const older = Promise.withResolvers<unknown>()
    let auditReads = 0
    showScheduleSurface({}, (input) => {
      if (input.method !== 'schedules/grantAudit') return undefined
      if (auditReads++ === 0) return older.promise
      return {
        kind: 'grantAudit',
        scheduleId: input.id,
        entries: [{ scheduleId: input.id, kind: 'changed', atMs: 1 }],
      }
    })
    const card = await screen.findByRole('article')
    const details = openAudit(card)
    fireEvent.click(within(card).getByRole('button', { name: 'Pause schedule' }))
    await within(details).findByText(/Changed ·/)
    await act(async () => {
      older.resolve({ kind: 'grantAudit', scheduleId: 'schedule-1', entries: [] })
      await older.promise
    })
    expect(within(details).getByText(/Changed ·/)).toBeTruthy()
  })
  it.each(['pause', 'revokeGrant'] as const)(
    'shows acknowledged %s authority while the following read is pending',
    async (method) => {
      let reads = 0
      const refresh = Promise.withResolvers<unknown>()
      showScheduleSurface({}, (input) =>
        input.method === 'schedules/list' && reads++ > 0 ? refresh.promise : undefined,
      )
      const card = await screen.findByRole('article')
      const labels = { pause: 'Pause schedule', revokeGrant: 'Revoke grant' }
      fireEvent.click(within(card).getByRole('button', { name: labels[method] }))
      await waitFor(() => {
        if (method === 'pause')
          expect(within(card).getByRole('button', { name: 'Resume schedule' })).toBeEnabled()
        else expect(card.textContent).not.toContain('read-src')
      })
      expect(within(card).queryByText('State unknown — Retry')).toBeNull()
      act(() => {
        refresh.resolve({
          kind: 'list',
          schedules: [scheduleViewV2Of(fakeSchedule({ paused: method === 'pause' }))],
        })
      })
    },
  )
  it('does not restore an unknown grant after a later Pause acknowledgement', async () => {
    let reads = 0
    const refresh = Promise.withResolvers<unknown>()
    showScheduleSurface({}, (input) => {
      if (input.method === 'schedules/revokeGrant')
        return Promise.reject(new Error('Lost revoke reply'))
      return input.method === 'schedules/list' && reads++ > 0 ? refresh.promise : undefined
    })
    const card = await screen.findByRole('article')
    fireEvent.click(within(card).getByRole('button', { name: 'Revoke grant' }))
    await within(card).findByText('State unknown — Retry')
    fireEvent.click(within(card).getByRole('button', { name: 'Pause schedule' }))
    await waitFor(() => {
      expect(reads).toBe(2)
    })
    expect(within(card).getByText('State unknown — Retry')).toBeTruthy()
    expect(card.textContent).not.toContain('read-src')
    expect(within(card).getByRole('button', { name: 'Run now' })).toBeDisabled()
    act(() => {
      refresh.resolve({
        kind: 'list',
        schedules: [scheduleViewV2Of(fakeSchedule({ paused: true }))],
      })
    })
  })
})
