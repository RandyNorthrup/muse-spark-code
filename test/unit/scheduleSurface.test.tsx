// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { scheduleViewV2Of } from '../../src/shared/scheduleV2'
import { draftOf } from '../../src/webview/schedules/ScheduleEditor'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { showScheduleSurface as setup, editSchedule as edit } from './helpers/scheduleSurface'
describe('M115 schedule surface', () => {
  it('shows creator, interrupt warning, grant and argument-free audit with Revoke and Pause', async () => {
    const { request, schedule } = setup()
    const card = await screen.findByRole('article', { name: schedule.name })
    expect(card.textContent).toContain('Set by lead in origin')
    expect(card.textContent).toContain('Interrupt can stop your own running turn.')
    expect(card.textContent).toContain('src/**')
    fireEvent.click(within(card).getByText('Grant audit'))
    fireEvent(within(card).getByText('Grant audit').parentElement ?? card, new Event('toggle'))
    await screen.findByText(/Used ·/)
    fireEvent.click(within(card).getByRole('button', { name: 'Revoke grant' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        method: 'schedules/revokeGrant',
        workspaceKey: schedule.workspaceKey,
        id: schedule.id,
      })
    })
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Pause schedule' })).toHaveProperty(
        'disabled',
        false,
      )
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Pause schedule' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        method: 'schedules/pause',
        workspaceKey: schedule.workspaceKey,
        id: schedule.id,
      })
    })
  })

  it('shows the host timeline collisions and creator, requesting either supported range', async () => {
    const { request, schedule } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule timeline' }))
    const timeline = await screen.findByRole('region', { name: 'Schedule timeline' })
    expect(timeline.textContent).toContain('collide; they run in creation order')
    expect(timeline.textContent).toContain('other')
    expect(timeline.textContent).toContain('Set by lead in origin')
    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule timeline' }), {
      target: { value: '168' },
    })
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        method: 'schedules/timeline',
        workspaceKey: schedule.workspaceKey,
        hours: 168,
      })
    })
  })

  it('submits a revision-bearing edit without creator, consent or migration authority', async () => {
    const { request, schedule } = setup()
    const form = await edit()
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith({
        method: 'schedules/update',
        workspaceKey: schedule.workspaceKey,
        id: schedule.id,
        revision: 2,
        draft: { ...draftOf(schedule), name: 'Renamed' },
      })
    })
    const editRequest = request.mock.calls.find(
      ([input]) => input.method === 'schedules/update',
    )?.[0]
    expect(JSON.stringify(editRequest)).not.toMatch(
      /creator|paidConsent|migration|accountId|allowAgentReschedule/,
    )
  })

  it('refuses an invalid draft and unavailable target without sending it', async () => {
    const { request } = setup()
    const form = await edit()
    const target = within(form).getByLabelText('Target')
    expect(
      within(target).getByRole('option', { name: 'Team: Team support unavailable' }),
    ).toHaveProperty('disabled', true)
    fireEvent.change(target, { target: { value: 'team' } })
    expect(target).toHaveProperty('value', 'current')
    fireEvent.change(within(form).getByLabelText('Time zone'), { target: { value: 'bad/zone' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Check the schedule fields, target availability and standing grant before saving.',
    )
    expect(request.mock.calls.some(([input]) => input.method === 'schedules/update')).toBe(false)
  })

  it('offers no Bypass, confines paths, and allows parallel only with fresh-session delivery', async () => {
    const { request } = setup()
    const form = await edit()
    expect(within(form).queryByRole('option', { name: 'Bypass permissions' })).toBeNull()
    expect(within(form).getByLabelText('Run in parallel')).toHaveProperty('disabled', true)
    fireEvent.change(within(form).getByLabelText('Target'), { target: { value: 'fresh' } })
    expect(within(form).getByLabelText('Delivery')).toHaveProperty('value', 'newConversation')
    fireEvent.click(within(form).getByLabelText('Run in parallel'))
    fireEvent.change(within(form).getByLabelText('Workspace paths'), {
      target: { value: '../escape/**' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
    await screen.findByRole('alert')
    expect(request.mock.calls.some(([input]) => input.method === 'schedules/update')).toBe(false)
  })

  it('reloads after a revision conflict, closes the stale editor and never retries stale grants', async () => {
    const { request } = setup({}, (input) =>
      input.method === 'schedules/update'
        ? { kind: 'refused', reason: 'Revision conflict' }
        : undefined,
    )
    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Revision conflict')
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Edit schedule' })).toBeNull()
    })
    expect(
      request.mock.calls.filter(([input]) => input.method === 'schedules/update'),
    ).toHaveLength(1)
    expect(request.mock.calls.filter(([input]) => input.method === 'schedules/list')).toHaveLength(
      2,
    )
  })

  it('does not render malformed or other-workspace snapshots as successful lists', async () => {
    setup({}, (input) =>
      input.method === 'schedules/list'
        ? {
            kind: 'list',
            schedules: [scheduleViewV2Of(fakeSchedule({ workspaceKey: 'different' }))],
          }
        : undefined,
    )
    await screen.findByRole('alert')
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('does not show another schedule’s audit on this card', async () => {
    const { schedule } = setup({}, (input) =>
      input.method === 'schedules/grantAudit'
        ? {
            kind: 'grantAudit',
            scheduleId: 'other',
            entries: [{ scheduleId: 'other', kind: 'used', atMs: 1, ruleId: 'private-rule' }],
          }
        : undefined,
    )
    const card = await screen.findByRole('article', { name: schedule.name })
    fireEvent.click(within(card).getByText('Grant audit'))
    fireEvent(within(card).getByText('Grant audit').parentElement ?? card, new Event('toggle'))
    await screen.findByRole('alert')
    expect(card.textContent).not.toContain('private-rule')
  })

  it('shows a refused paid run without treating it as a successful mutation', async () => {
    const { schedule } = setup({}, (input) =>
      input.method === 'schedules/runNow'
        ? { kind: 'refused', reason: 'Schedule cap reached; no paid request sent' }
        : undefined,
    )
    const card = await screen.findByRole('article', { name: schedule.name })
    fireEvent.click(within(card).getByRole('button', { name: 'Run now' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Schedule cap reached; no paid request sent',
    )
  })
})
