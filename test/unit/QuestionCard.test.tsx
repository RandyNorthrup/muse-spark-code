// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Question } from '../../src/shared/agentEvents'
import { QuestionCard, type QuestionCardProps } from '../../src/webview/components/QuestionCard'

const colour: Question = {
  id: 'colour',
  header: 'Colour',
  question: 'Which colour?',
  selection: { mode: 'single' },
  options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }],
}

const toppings: Question = {
  id: 'toppings',
  header: 'Toppings',
  question: 'Pick up to two.',
  selection: { mode: 'multiple', minSelections: 1, maxSelections: 2 },
  options: [{ label: 'Ham' }, { label: 'Olives' }, { label: 'Corn' }],
}

const name: Question = {
  id: 'name',
  header: 'Name',
  question: 'What should it be called?',
  selection: { mode: 'single' },
  options: [],
}

function renderCard(questions: readonly Question[]) {
  const props: QuestionCardProps = {
    question: { userInputId: 'q1', questions },
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
  }
  render(<QuestionCard {...props} />)
  return props
}

function submit() {
  return screen.getByRole('button', { name: 'Submit' })
}

describe('QuestionCard (M16)', () => {
  it('stacks a single choice as radio buttons with an Other row, Submit off until a pick', () => {
    const props = renderCard([colour])
    expect(screen.getByRole('radio', { name: /Red/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByText('warm')).toHaveClass('question-choice-detail')
    expect(submit()).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(submit()).toBeEnabled()
    fireEvent.click(submit())
    expect(props.onAnswer).toHaveBeenCalledWith('q1', [
      { questionId: 'colour', selectedLabel: 'Blue' },
    ])
  })

  it('sends a typed Other answer as free text and drops the radio pick', () => {
    const props = renderCard([colour])
    fireEvent.click(screen.getByRole('radio', { name: /Red/ }))
    fireEvent.change(screen.getByLabelText('Other: Colour'), { target: { value: 'Teal' } })
    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Red/ })).not.toBeChecked()
    fireEvent.click(submit())
    expect(props.onAnswer).toHaveBeenCalledWith('q1', [{ questionId: 'colour', freeText: 'Teal' }])
  })

  it('stacks a multiple choice as checkboxes, honours the maximum, and adds Other as text', () => {
    const props = renderCard([toppings])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ham' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Olives' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Corn' }))
    expect(screen.getByRole('checkbox', { name: 'Corn' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Olives' }))
    fireEvent.change(screen.getByLabelText('Other: Toppings'), { target: { value: 'Pineapple' } })
    expect(screen.getByRole('checkbox', { name: 'Ham' })).toBeChecked()
    fireEvent.click(submit())
    expect(props.onAnswer).toHaveBeenCalledWith('q1', [
      { questionId: 'toppings', selectedLabels: ['Ham'], freeText: 'Pineapple' },
    ])
  })

  it('tabs between several questions and enables Submit only once every one is answered', () => {
    const props = renderCard([colour, name])
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Colour', 'Name'])
    expect(screen.getByText('Which colour?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }))
    expect(submit()).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Colour ✓' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Name' }))
    expect(screen.getByText('What should it be called?')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.change(screen.getByLabelText('Other: Name'), { target: { value: 'Muse' } })
    expect(submit()).toBeEnabled()
    fireEvent.click(submit())
    expect(props.onAnswer).toHaveBeenCalledWith('q1', [
      { questionId: 'colour', selectedLabel: 'Blue' },
      { questionId: 'name', freeText: 'Muse' },
    ])
  })

  it('cancels the prompt from the Cancel button', () => {
    const props = renderCard([colour])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalledWith('q1')
    expect(props.onAnswer).not.toHaveBeenCalled()
  })
})
