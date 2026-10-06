import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { scheduleViewV2Of, type ScheduleRequest } from '../../../src/shared/scheduleV2'
import { ScheduleSurface } from '../../../src/webview/schedules/ScheduleSurface'
import { draftOf } from '../../../src/webview/schedules/ScheduleEditor'
import type { ScheduleSurfaceProps } from '../../../src/webview/schedules/ports'
import { fakeSchedule } from './schedules/fixtures'
export function showScheduleSurface(
  overrides: Partial<ScheduleSurfaceProps> = {},
  handler?: (input: ScheduleRequest) => unknown,
) {
  const schedule = scheduleViewV2Of(
    fakeSchedule({
      revision: 2,
      creator: {
        kind: 'agent',
        agentId: 'lead',
        sessionId: 'origin',
        orchestratorId: 'orchestrator',
      },
      delivery: 'interrupt',
      grant: {
        rules: [{ id: 'read-src', kind: 'path', access: 'read', glob: 'src/**' }],
        destinationIds: [],
        paidCapUsd: 1,
      },
      paidCapUsd: 1,
    }),
  )
  const responseFor = (input: ScheduleRequest): unknown => {
    switch (input.method) {
      case 'schedules/list': {
        return { kind: 'list', schedules: [schedule] }
      }
      case 'schedules/eventSources': {
        return {
          kind: 'eventSources',
          sources: [
            { id: 'git', kinds: ['branchUpdated'], capability: { available: true } },
            {
              id: 'github',
              kinds: ['pullRequestMerged'],
              capability: { available: false, reason: 'Network disabled' },
            },
          ],
        }
      }
      case 'schedules/grantAudit': {
        return {
          kind: 'grantAudit',
          scheduleId: schedule.id,
          entries: [
            {
              scheduleId: schedule.id,
              kind: 'used',
              atMs: schedule.createdAtMs,
              ruleId: 'read-src',
              runId: 'run-1',
              actionClass: 'edit',
            },
          ],
        }
      }
      case 'schedules/timeline': {
        return {
          kind: 'timeline',
          entries: [
            {
              scheduleId: schedule.id,
              atMs: schedule.createdAtMs,
              target: schedule.target,
              creator: schedule.creator,
              collisionIds: ['other'],
            },
          ],
        }
      }
      default: {
        return { kind: 'accepted' }
      }
    }
  }
  const request = vi.fn((input: ScheduleRequest) =>
    Promise.resolve(handler?.(input) ?? responseFor(input)),
  )
  const preview = vi.fn(() => Promise.resolve({ available: true, times: [schedule.createdAtMs] }))
  const context: ScheduleSurfaceProps = {
    workspaceKey: schedule.workspaceKey,
    port: { request, preview },
    targets: [
      {
        id: 'current',
        label: 'Build conversation',
        target: schedule.target,
        capability: { available: true },
      },
      {
        id: 'fresh',
        label: 'Fresh session',
        target: { kind: 'newConversation', backend: 'modelApi' },
        capability: { available: true },
      },
      {
        id: 'team',
        label: 'Team',
        target: { kind: 'team', teamId: 'team-1' },
        capability: { available: false, reason: 'Team support unavailable' },
      },
    ],
    defaultDraft: draftOf(schedule),
    nowMs: schedule.createdAtMs,
    ...overrides,
  }
  const { unmount } = render(<ScheduleSurface {...context} />)
  return { request, preview, schedule, context, unmount }
}

export async function editSchedule() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit schedule' }))
  return screen.getByRole('region', { name: 'Edit schedule' })
}

export async function saveSchedule(
  form: HTMLElement,
  request: ReturnType<typeof showScheduleSurface>['request'],
) {
  fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
  await waitFor(() => {
    expect(request.mock.calls.some(([input]) => input.method === 'schedules/update')).toBe(true)
  })
  return request.mock.calls.find(([input]) => input.method === 'schedules/update')?.[0]
}

export async function refuseScheduleSave(
  form: HTMLElement,
  request: ReturnType<typeof showScheduleSurface>['request'],
) {
  fireEvent.click(within(form).getByRole('button', { name: 'Save schedule' }))
  const alert = await screen.findByRole('alert')
  expect(request.mock.calls.some(([input]) => input.method === 'schedules/update')).toBe(false)
  return alert
}

export function showSchedulePreview(preview: ScheduleSurfaceProps['port']['preview']) {
  return showScheduleSurface({
    port: {
      request: (input) =>
        Promise.resolve(
          input.method === 'schedules/list'
            ? { kind: 'list', schedules: [] }
            : { kind: 'eventSources', sources: [] },
        ),
      preview,
    },
    initialView: 'editor',
  })
}
