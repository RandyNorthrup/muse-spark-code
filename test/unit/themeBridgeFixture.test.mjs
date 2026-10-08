// Browser-free guard for the companion theme fixture page (M114 C, P2).
// The Chromium suite cannot launch a browser on every rig, but its page
// assembly — every emitted stylesheet linked, the lazy theme sheets carrying
// the palettes, the policy admitting the bridge nonce — is checkable through
// the bundler alone. Uses the same builder as the Chromium suite.
import { describe, expect, it } from 'vitest'
import { buildThemeFixture, themeFixtureHtml } from './themeBridgeFixture.mjs'

describe('M114 companion theme fixture page (bundler only, no browser)', () => {
  it('links every emitted stylesheet and admits the bridge nonce', async () => {
    const { assets, meta, nonce } = await buildThemeFixture()
    const outputs = Object.entries(meta.outputs)
    const startup = outputs.find(([name]) => name.replaceAll('\\', '/').endsWith('/fixture.js'))[1]
    expect(startup.imports.some((entry) => entry.kind === 'dynamic-import')).toBe(true)
    const sheets = assets
      .keys()
      .filter((name) => name.endsWith('.css'))
      .toArray()
    // The eager panel sheet plus the extracted lazy theme sheets.
    expect(sheets.length).toBeGreaterThanOrEqual(2)
    const html = themeFixtureHtml(assets, nonce)
    for (const sheet of sheets) expect(html, sheet).toContain(`href="${sheet}"`)
    expect(html).toContain(`style-src 'self' 'nonce-${nonce}'`)
    // The served bundle carries the same nonce the policy admits.
    const bundled = assets.entries().find(([name]) => name.endsWith('.js'))
    expect(bundled?.[1]).toContain(nonce)
  })
})
