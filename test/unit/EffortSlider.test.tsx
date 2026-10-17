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

  it('uses the catalogue order, descriptions and default, including tiers outside the old family table', () => {
    const onSelect = vi.fn()
    const onSelectVariant = vi.fn()
    render(
      <EffortSlider
        levels={levels}
        current="low"
        onSelect={onSelect}
        model={{
          variants: ['none', 'high', 'ultra'],
          defaultReasoningEffort: 'high',
          reasoningEffortVariants: [
            { tier: 'none', description: 'No reasoning' },
            { tier: 'ultra', description: 'Deepest reasoning' },
          ],
          onSelect: onSelectVariant,
        }}
      />,
    )
    const dots = screen.getAllByRole('button')
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveAccessibleName('No reasoning')
    expect(dots[1]).toHaveAttribute('aria-pressed', 'true')
    expect(dots[2]).toHaveAccessibleName('Deepest reasoning')
    fireEvent.click(dots[2]!)
    expect(onSelectVariant).toHaveBeenCalledExactlyOnceWith('ultra')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the selected catalogue tier ahead of the default and stays read-only without its handler', () => {
    render(
      <EffortSlider
        levels={levels}
        current="low"
        onSelect={vi.fn()}
        model={{
          variants: ['minimal', 'high'],
          current: 'minimal',
          defaultReasoningEffort: 'high',
        }}
      />,
    )
    const dots = screen.getAllByRole('button')
    expect(dots[0]).toHaveAttribute('aria-pressed', 'true')
    for (const dot of dots) expect(dot).toBeDisabled()
  })

  it('keeps the legacy range when capabilities are unknown and respects a known empty range', () => {
    const { rerender } = render(
      <EffortSlider
        levels={levels}
        current="low"
        onSelect={undefined}
        model={{ variants: 'unknown' }}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(3)
    rerender(
      <EffortSlider levels={levels} current="low" onSelect={undefined} model={{ variants: [] }} />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps catalogue variants inside an option mouse-only', () => {
    const onSelect = vi.fn()
    render(
      <EffortSlider
        levels={levels}
        current="low"
        onSelect={undefined}
        isInsideOption
        model={{ variants: ['high', 'ultra'], defaultReasoningEffort: 'ultra', onSelect }}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    fireEvent.click(screen.getByTitle('ultra'))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('ultra')
  })
})
