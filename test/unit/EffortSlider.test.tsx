// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EffortSlider } from '../../src/webview/components/EffortSlider'

const levels = ['low', 'medium', 'high'] as const

describe('EffortSlider', () => {
  it('fills the dots up to the current tier and selects on click without taking focus or bubbling', () => {
    const onSelect = vi.fn()
    const onOuterClick = vi.fn()
    render(
      <div onClick={onOuterClick}>
        <EffortSlider levels={levels} current="medium" onSelect={onSelect} />
      </div>,
    )
    const dots = screen.getAllByRole('button')
    expect(dots.map((dot) => dot.className)).toEqual([
      'slider-step slider-step-on',
      'slider-step slider-step-on',
      'slider-step',
    ])
    expect(dots[1]).toHaveAttribute('aria-pressed', 'true')
    expect(fireEvent.mouseDown(dots[2]!)).toBe(false)
    fireEvent.click(dots[2]!)
    expect(onSelect).toHaveBeenCalledWith('high')
    expect(onOuterClick).not.toHaveBeenCalled()
  })

  it('renders read-only dots without a handler', () => {
    render(<EffortSlider levels={levels} current="low" onSelect={undefined} />)
    for (const dot of screen.getAllByRole('button')) {
      expect(dot).toBeDisabled()
    }
  })
})
