import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const matrix = JSON.parse(
  readFileSync(new URL('../harness/visual-matrix.json', import.meta.url), 'utf8'),
)

describe('M114 lane 0 visual contract', () => {
  it('covers every React component and the separate What’s New surface for A’s audit', () => {
    const components = readdirSync('src/webview', { recursive: true })
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `src/webview/${name.replaceAll('\\', '/')}`)
    components.push('src/webview/whatsNew/whatsNewPage.ts')
    expect(matrix.componentAuditInputs).toEqual(
      components.toSorted((a, b) => {
        if (a === b) return 0
        return a < b ? -1 : 1
      }),
    )
  })

  it('fixes six themes, narrow and regular widths, and every interaction state for S', () => {
    expect(matrix.themes).toEqual([
      'light',
      'dark',
      'hc-dark',
      'hc-light',
      'one-dark-pro',
      'dracula',
    ])
    expect(matrix.widths).toEqual([320, 690])
    expect(matrix.states).toEqual([
      'default',
      'hover',
      'focus-visible',
      'pressed',
      'disabled',
      'selected',
    ])
    expect(matrix.goldenPath).toBe(
      'test/harness/goldens/{surface}/{component}/{state}/{theme}/{width}.png',
    )
  })

  it('requires reviewed golden updates with a stable capture environment and named external owners', () => {
    expect(matrix.capture).toEqual({
      locale: 'en',
      timezone: 'UTC',
      reducedMotion: true,
      animations: 'disabled',
      reviewedUpdatesOnly: true,
    })
    expect(matrix.height).toBe(760)
    expect(matrix.deviceScaleFactor).toBe(1)
    expect(matrix.pendingSurfaceOwners).toEqual({
      companion: 'C',
      native: 'C',
      node: 'N',
      desktop: 'D',
      installer: 'D',
      tui: 'N / TD',
    })
  })
})
