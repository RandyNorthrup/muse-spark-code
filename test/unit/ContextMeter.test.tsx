// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { ContextMeter } from '../../src/webview/components/ContextMeter'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('ContextMeter (M87 item 1)', () => {
  it.each([
    [0, '0', 'normal'],
    [0.4, '<1', 'normal'],
    [42, '42', 'normal'],
    [69.9, '69', 'normal'],
    [70, '70', 'medium'],
    [89.9, '89', 'medium'],
    [90, '90', 'high'],
    [99.6, '99', 'high'],
    [100, '100', 'high'],
    [104, '100', 'high'],
  ])('draws %s%% clockwise with %s inside, at level %s', (usedTokens, number, level) => {
    const { container } = render(
      <ContextMeter
        context={{ usedTokens, windowTokens: 100, pressure: 'future-wire-word' }}
        onCompact={vi.fn()}
      />,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass(`context-meter-${level}`)
    expect(container.querySelector(':scope svg text')).toHaveTextContent(number)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const arc = container.querySelector('.context-meter-arc')
    expect(arc).toHaveAttribute('pathLength', '100')
    expect(arc).toHaveAttribute('stroke-dasharray', `${String(Math.min(usedTokens, 100))} 100`)
    expect(arc).toHaveAttribute('transform', 'rotate(-90 11 11)')
    expect(
      container.querySelector(':scope svg text')?.classList.contains('context-meter-number-full'),
    ).toBe(usedTokens >= 100)
    expect(button).toHaveAccessibleName(
      `Context ${String(Math.floor(usedTokens))}% used · ${String(usedTokens)} of 100 tokens · pressure future-wire-word${usedTokens > 100 ? ' · Over the context window' : ''}`,
    )
    expect(button.title).toContain('Click to compact now')
    expect(button.title.includes('Over the context window')).toBe(usedTokens > 100)
  })

  it.each([
    undefined,
    { usedTokens: 10, pressure: 'normal' },
    { usedTokens: 10, windowTokens: 0, pressure: 'normal' },
  ])('hides a missing window: %j', (context) => {
    render(<ContextMeter context={context} onCompact={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('compacts on click and reads the installed locale at render time', () => {
    setUiText(EN, 'de')
    const onCompact = vi.fn()
    render(
      <ContextMeter
        context={{ usedTokens: 104, windowTokens: 100, pressure: 'normal' }}
        onCompact={onCompact}
      />,
    )
    const button = screen.getByRole('button', { name: /Context 104\s% used/ })
    fireEvent.click(button)
    expect(onCompact).toHaveBeenCalledOnce()
    expect(button).toHaveTextContent('100')
  })
})
