import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function declarationsOf(css: string, selector: string): string | undefined {
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? '').split(',').map((candidate) => candidate.trim())
    if (selectors.includes(selector)) {
      return rule[2] ?? ''
    }
  }
  return undefined
}

describe('centered composer (owner request of 2026-10-04)', () => {
  const css = readFileSync(
    new URL('../../src/webview/styles.css', import.meta.url),
    'utf8',
  ).replaceAll(/\/\*[\s\S]*?\*\//g, '')

  it('caps the composer reading width in a named token', () => {
    expect(declarationsOf(css, ':root')).toMatch(/--ms-composer-max-width\s*:\s*760px\s*;/)
  })

  it('centers the composer area instead of stretching it', () => {
    const area = declarationsOf(css, '.composer-area')
    expect(area).toMatch(/max-width\s*:\s*var\(--ms-composer-max-width\)\s*;/)
    expect(area).toMatch(/margin-inline\s*:\s*auto\s*;/)
    // A definite width: auto cross margins must not collapse the flex item.
    expect(area).toMatch(/width\s*:\s*100%\s*;/)
  })

  it('keeps the approval dock aligned with the box', () => {
    const dock = declarationsOf(css, '.approval-dock')
    expect(dock).toMatch(/max-width\s*:\s*var\(--ms-composer-max-width\)/)
    expect(dock).toMatch(/margin-inline\s*:\s*auto\s*;/)
    expect(dock).toMatch(/width\s*:\s*100%\s*;/)
  })
})
