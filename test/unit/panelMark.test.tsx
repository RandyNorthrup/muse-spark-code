// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../../src/shared/constants'
import { EmptyState } from '../../src/webview/components/EmptyState'

// The panel's empty state shows the extension's own mark beside the product
// name: never another company's logo, never a sparkle (lane PANELMARK, the
// sibling of the activity-bar icon lane).
const ROOT = process.cwd()

function pathRatio(d: string): number {
  const numbers: number[] = []
  const pattern = /-?\d+(?:\.\d+)?/g
  let token = pattern.exec(d)
  while (token !== null) {
    numbers.push(Number(token[0]))
    token = pattern.exec(d)
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = numbers[i] ?? NaN
    const y = numbers[i + 1] ?? NaN
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return (maxX - minX) / (maxY - minY)
}

afterEach(cleanup)

describe('panel empty state mark', () => {
  it('renders the product mark, decorative beside the product name', () => {
    render(
      <EmptyState hint="Say hello." isOnboardingShown={false} onHideOnboarding={() => undefined} />,
    )
    const mark = document.querySelector('svg.product-mark')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.querySelector('title')).toBeNull()
    expect(mark?.querySelector('linearGradient')).toBeNull()
    expect(screen.getByText(PRODUCT_NAME)).not.toBeNull()
  })

  // RVPANELMARKB P3: preserveAspectRatio="none" stretched the mark (the box
  // is 24:16 while the cropped view box is 20:11.14). The mark meets the box
  // instead, so the width fills, the height centres, and the rendered path
  // keeps the Marketplace path's proportions within 1%.
  it('keeps the Marketplace mark proportions instead of stretching to the box', () => {
    render(
      <EmptyState hint="Say hello." isOnboardingShown={false} onHideOnboarding={() => undefined} />,
    )
    const mark = document.querySelector('svg.product-mark')
    expect(mark?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    // The box itself stays the old logo's, and the stroke weight is unchanged.
    expect(mark?.getAttribute('width')).toBe('24')
    expect(mark?.getAttribute('height')).toBe('16')
    expect(mark?.getAttribute('stroke-width')).toBe('2')
    const viewBox = mark?.getAttribute('viewBox')?.split(' ').map(Number) ?? []
    expect(viewBox).toHaveLength(4)
    const viewWidth = viewBox[2] ?? NaN
    const viewHeight = viewBox[3] ?? NaN
    expect(Number.isFinite(viewWidth)).toBe(true)
    expect(Number.isFinite(viewHeight)).toBe(true)
    // The width is the limiting dimension: it fills while the height centres.
    expect(24 / viewWidth).toBeLessThan(16 / viewHeight)
    const panelRatio = pathRatio(mark?.querySelector('path')?.getAttribute('d') ?? '')
    const marketplaceD =
      /<path[^>]* d="([^"]+)"/.exec(
        readFileSync(path.join(ROOT, 'media/marketplace-icon.svg'), 'utf8'),
      )?.[1] ?? ''
    expect(marketplaceD.length).toBeGreaterThan(0)
    const marketplaceRatio = pathRatio(marketplaceD)
    expect(Math.abs(panelRatio - marketplaceRatio) / marketplaceRatio).toBeLessThan(0.01)
  })
})
