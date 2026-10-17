// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduleView } from '../../src/shared/schedule'
import { SchedulePanel, type SchedulePanelProps } from '../../src/webview/components/SchedulePanel'

const due: ScheduleView = {
  id: 'job-a',
  prompt: 'Review tests',
  cadence: { kind: 'interval', everyMs: 60 * 1000 },
  nextFireAtMs: 1_000_000,
  fireCount: 0,
}

function show(
  isPaidOn: boolean,
  jobs: readonly ScheduleView[] = [due],
  overrides: Partial<SchedulePanelProps> = {},
) {
  const onRun = vi.fn()
  const onCancel = vi.fn()
  const onEnable = vi.fn()
  const view = render(
    <SchedulePanel
      jobs={jobs}
      nowMs={due.nextFireAtMs}
      isPaidOn={isPaidOn}
      isInert={false}
      onRun={onRun}
      onCancel={onCancel}
      onEnable={onEnable}
      {...overrides}
    />,
  )
  return { onRun, onCancel, onEnable, ...view }
}

describe('SchedulePanel (M52)', () => {
  it.each([true, false])('renders the injected schedule list and preserves inert=%s', (isInert) => {
    const { container, onRun, onEnable } = show(false, [due], {
      surface: <section aria-label="Bound schedule list">Prepared schedules</section>,
      isInert,
    })
    expect(container.textContent).toBe('Prepared schedules')
    expect(container.firstElementChild?.hasAttribute('inert')).toBe(isInert)
    expect(onRun).not.toHaveBeenCalled()
    expect(onEnable).not.toHaveBeenCalled()
  })
  it('shows only extension-owned jobs with accessible run and cancel controls', () => {
    const { onRun, onCancel } = show(true)
    const panel = screen.getByRole('region', { name: 'Scheduled prompts for this conversation' })
    expect(panel.textContent).toContain('Model API · this workspace, conversation and key')
    expect(panel.textContent).toContain('Review tests')
    expect(panel.textContent).toContain('Due · waiting for you to run it')
    fireEvent.click(screen.getByRole('button', { name: 'Run scheduled prompt job-a' }))
    expect(onRun).toHaveBeenCalledWith('job-a', due.nextFireAtMs)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled prompt job-a' }))
    expect(onCancel).toHaveBeenCalledWith('job-a')
  })

  it('offers the paid gate when it is off, without sending a turn', () => {
    const { onEnable, onRun } = show(false)
    fireEvent.click(
      screen.getByRole('button', { name: 'Enable paid runs for scheduled prompt job-a' }),
    )
    expect(onEnable).toHaveBeenCalledOnce()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('shows the next local time and hides Run before the occurrence is due', () => {
    show(true, [{ ...due, nextFireAtMs: due.nextFireAtMs + 60 * 1000, fireCount: 2 }])
    expect(screen.getByText('Ran 2 times')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run scheduled prompt job-a' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel scheduled prompt job-a' })).toBeTruthy()
  })

  it('renders no panel for a session without schedules', () => {
    const { container } = show(true, [])
    expect(container.childElementCount).toBe(0)
  })
})
