// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionGoal } from '../../src/shared/agentEvents'
import { GoalPanel } from '../../src/webview/components/GoalPanel'

// The goal block as `session/goalChanged` carries it (captured live 2026-09-25).
const active: SessionGoal = {
  objective: 'Make the parser tests pass',
  status: 'active',
  percentComplete: 60,
  currentWork: 'Writing the parser tests',
  nextWork: 'Fix the precedence bug',
}

function show(goal: SessionGoal | undefined) {
  const onCommand = vi.fn<(verb: string, objective?: string) => void>()
  const view = render(<GoalPanel goal={goal} onCommand={onCommand} />)
  return { onCommand, ...view }
}

const button = (name: string) => screen.queryByRole('button', { name })
const click = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('GoalPanel (M45)', () => {
  it('is not there without a goal', () => {
    const { container } = show(undefined)
    expect(container.childElementCount).toBe(0)
  })

  it('shows the objective, the status in words, the progress and what is now and next', () => {
    show(active)
    const strip = screen.getByRole('region', { name: 'Session goal' })
    expect(strip.textContent).toContain('Make the parser tests pass')
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('60% done')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Goal progress' })
    expect(bar.getAttribute('value')).toBe('60')
    expect(screen.getByText('Writing the parser tests')).toBeTruthy()
    expect(screen.getByText('Fix the precedence bug')).toBeTruthy()
  })

  it('clamps the bar, not the number, and shows an unknown status as it came', () => {
    show({ objective: 'o', status: 'superseded', percentComplete: 140 })
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('100')
    expect(screen.getByText('140% done')).toBeTruthy()
    expect(screen.getByText('superseded')).toBeTruthy()
    expect(screen.queryByText('Now')).toBeNull()
  })

  it('offers the verbs the status allows, and sends them', () => {
    const { onCommand, rerender } = show(active)
    expect(button('Resume')).toBeNull()
    click('Pause')
    expect(onCommand).toHaveBeenLastCalledWith('pause')
    rerender(<GoalPanel goal={{ ...active, status: 'paused' }} onCommand={onCommand} />)
    expect(button('Pause')).toBeNull()
    click('Resume')
    expect(onCommand).toHaveBeenLastCalledWith('resume')
    expect(button('Edit')).toBeTruthy()
    rerender(
      <GoalPanel
        goal={{ ...active, status: 'complete', percentComplete: 100 }}
        onCommand={onCommand}
      />,
    )
    expect(button('Pause')).toBeNull()
    expect(button('Resume')).toBeNull()
    expect(button('Edit')).toBeNull()
    click('Clear')
    expect(onCommand).toHaveBeenLastCalledWith('clear')
  })

  it('edits the objective in place: save sends it, an unchanged one or Escape sends nothing', () => {
    const { onCommand } = show(active)
    const edit = screen.getByRole('button', { name: 'Edit' })
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Goal objective' })
    expect(field.value).toBe('Make the parser tests pass')
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: '  ' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(field, { target: { value: ' Ship on Friday ' } })
    click('Save')
    expect(onCommand).toHaveBeenLastCalledWith('edit', 'Ship on Friday')
    expect(screen.queryByRole('textbox')).toBeNull()
    click('Edit')
    click('Save')
    expect(onCommand).toHaveBeenCalledTimes(1)
    click('Edit')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    click('Edit')
    click('Cancel')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onCommand).toHaveBeenCalledTimes(1)
  })

  it('closes the field when the goal can no longer be edited', () => {
    const { onCommand, rerender } = show(active)
    click('Edit')
    rerender(<GoalPanel goal={{ ...active, status: 'complete' }} onCommand={onCommand} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Make the parser tests pass')).toBeTruthy()
  })

  it('updates an open objective editor when the host changes the objective, but keeps typing on progress updates', () => {
    const { onCommand, rerender } = show(active)
    click('Edit')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My unfinished edit' } })
    rerender(<GoalPanel goal={{ ...active, percentComplete: 70 }} onCommand={onCommand} />)
    expect(screen.getByRole('textbox')).toHaveValue('My unfinished edit')
    rerender(
      <GoalPanel goal={{ ...active, objective: 'Host changed objective' }} onCommand={onCommand} />,
    )
    expect(screen.getByRole('textbox')).toHaveValue('Host changed objective')
  })

  it('does not reopen an old editor when a cleared goal returns with the same objective', () => {
    const { onCommand, rerender } = show(active)
    click('Edit')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Old unfinished edit' } })
    rerender(<GoalPanel goal={undefined} onCommand={onCommand} />)
    rerender(<GoalPanel goal={{ ...active }} onCommand={onCommand} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(active.objective)).toBeTruthy()
  })

  it('gives the focus back to Edit when the field closes, never to the page', () => {
    show(active)
    const edit = screen.getByRole('button', { name: 'Edit' })
    fireEvent.click(edit)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(document.activeElement).toBe(edit)
    fireEvent.click(edit)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship on Friday' } })
    click('Save')
    expect(document.activeElement).toBe(edit)
  })
})
