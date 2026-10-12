// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../../src/shared/constants'
import { EmptyState } from '../../src/webview/components/EmptyState'

// The panel's empty state shows the extension's own mark beside the product
// name: never another company's logo, never a sparkle (lane PANELMARK, the
// sibling of the activity-bar icon lane and its activityIcon.test.mjs).
const ROOT = process.cwd()
// The distinctive start of the old Meta-logo path that used to render here.
const OLD_PATH_START = 'M27.651 112.136'
const NEEDLES = ['MetaLogo', '--ms-meta-', OLD_PATH_START]

function* filesUnder(relative: string): Generator<string> {
  const absolute = path.join(ROOT, relative)
  for (const name of readdirSync(absolute)) {
    const full = path.join(absolute, name)
    if (statSync(full).isDirectory()) yield* filesUnder(path.relative(ROOT, full))
    else yield full
  }
}

function hitsFor(needle: string, dirs: readonly string[]): string[] {
  const hits: string[] = []
  for (const dir of dirs) {
    for (const file of filesUnder(dir)) {
      if (statSync(file).size > 2_000_000) continue
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (text.includes(needle)) hits.push(path.relative(ROOT, file))
    }
  }
  return hits
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

  it.each(NEEDLES)('has no trace of %s anywhere under src/webview or design/', (needle) => {
    expect(hitsFor(needle, ['src/webview', 'design'])).toEqual([])
  })
})
