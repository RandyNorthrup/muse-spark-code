// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { ScheduleRunBody } from '../../src/webview/schedules/ScheduleRunBody'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { tool } from './helpers/transcriptFixtures'

function fire(outcome: 'ran' | 'refused' | 'missed') {
  const schedule = fakeSchedule()
  return scheduleFireRecordSchema.parse({
    runId: 'schedule:occurrence',
    scheduleId: schedule.id,
    workspaceKey: schedule.workspaceKey,
    occurrenceMs: schedule.createdAtMs,
    observedAtMs: schedule.createdAtMs,
    target: schedule.target,
    delivery: 'whenIdle',
    outcome,
    reason: outcome === 'missed' ? 'Target closed' : undefined,
    refusedActions:
      outcome === 'refused'
        ? [
            { actionClass: 'shell', tool: 'shell', reason: 'No matching grant' },
            { actionClass: 'physical', tool: 'device', reason: 'Physical actions always refused' },
          ]
        : [],
    cost: { usd: 0.25, certainty: 'unknown', retainedLiabilityUsd: 1 },
  })
}

describe('schedule settlement transcript rows', () => {
  it.each(['ran', 'refused', 'missed'] as const)(
    'renders %s with target, delivery and truthful cost',
    (outcome) => {
      const { container } = render(
        <ScheduleRunBody
          entry={tool({
            tool: 'scheduled_prompt',
            output: JSON.stringify({ type: 'scheduleFire', fire: fire(outcome) }),
          })}
        />,
      )
      expect(
        screen.getByText(
          outcome === 'ran' ? 'Sent on schedule' : outcome === 'refused' ? 'Refused' : 'Missed',
        ),
      ).toBeTruthy()
      expect(container.textContent).toContain('New turn when idle')
      expect(container.textContent).toContain('Cost: $0.25 (Unknown); Retained liability: $1.00')
      if (outcome === 'refused') {
        expect(container.textContent).toContain(
          'Refused on schedule: shell needs approval and is not in this schedule’s grant.',
        )
        expect(container.textContent).toContain('Physical actions always refused')
        expect(container.querySelector('[role="dialog"]')).toBeNull()
      } else if (outcome === 'missed') expect(container.textContent).toContain('Target closed')
    },
  )

  it('keeps existing M52 output and rejects a malformed internal settlement', () => {
    const { container, rerender } = render(
      <ScheduleRunBody
        entry={tool({ tool: 'scheduled_prompt', output: 'Scheduled prompt sent.' })}
      />,
    )
    expect(container.textContent).toContain('Scheduled prompt sent.')
    rerender(
      <ScheduleRunBody
        entry={tool({
          tool: 'scheduled_prompt',
          output: JSON.stringify({
            type: 'scheduleFire',
            fire: {
              ...fire('ran'),
              cost: { usd: -1, certainty: 'exact', retainedLiabilityUsd: 0 },
            },
          }),
        })}
      />,
    )
    expect(screen.queryByText('Sent on schedule')).toBeNull()
  })
})
