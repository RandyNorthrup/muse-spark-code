/** @vitest-environment jsdom */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import {
  GOLDEN_ROOT,
  RENDERERS,
  REPORT_THEME,
  REPORT_THEMES,
  renderFixture,
} from './reportRenderFixtures'

describe('static report HTML', () => {
  it.each(REPORT_KINDS)('matches the %s HTML golden', async (kind) => {
    expect(RENDERERS.html(renderFixture(kind), 'en', REPORT_THEME)).toBe(
      await readFile(path.join(GOLDEN_ROOT, `${kind}.html.golden`), 'utf8'),
    )
  })
  it.each(REPORT_THEMES)(
    'has an accessible outline and named scoped tables in theme %#',
    (theme) => {
      const parsed = new DOMParser().parseFromString(
        RENDERERS.html(renderFixture(), 'en', theme),
        'text/html',
      )
      expect(parsed.documentElement.lang).toBe('en')
      expect(parsed.querySelectorAll('h1')).toHaveLength(1)
      expect(parsed.querySelector(':scope main h2')?.textContent).toBe('Needs you')
      for (const table of parsed.querySelectorAll('table')) {
        expect(table.querySelector('caption')?.textContent).not.toBe('')
        for (const header of table.querySelectorAll('th'))
          expect(header.getAttribute('scope')).toBe('col')
      }
      expect(parsed.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain(
        'width=device-width',
      )
      expect(parsed.querySelector('style')?.textContent).toContain('overflow-x:auto')
      expect(parsed.querySelectorAll('script,img,iframe,link,object,a')).toHaveLength(0)
    },
  )
  it('escapes source markup and rejects CSS, closing-tag and URL injection in every theme field', () => {
    const document = renderFixture()
    document.header.scope = '</p><img src="https://evil.invalid" onerror="alert(1)"> & \'quoted\''
    const output = RENDERERS.html(finalizeReport(document), 'en', REPORT_THEME)
    expect(output).toContain('&lt;/p&gt;&lt;img')
    expect(output).toContain('&amp; &#39;quoted&#39;')
    const parsed = new DOMParser().parseFromString(output, 'text/html')
    expect(parsed.querySelectorAll('[onerror],img,script')).toHaveLength(0)
    for (const key of Object.keys(REPORT_THEME)) {
      const theme = { ...REPORT_THEME, [key]: 'red;}body{background:url(https://evil.invalid)}/*' }
      expect(() => RENDERERS.html(renderFixture(), 'en', theme)).toThrow(
        'Invalid report theme color',
      )
    }
    expect(() =>
      RENDERERS.html(renderFixture(), 'en', {
        ...REPORT_THEME,
        accent: '</style><script>alert(1)</script>',
      }),
    ).toThrow()
    for (const color of ['#12345', '#1234567'])
      expect(() =>
        RENDERERS.html(renderFixture(), 'en', { ...REPORT_THEME, accent: color }),
      ).toThrow('Invalid report theme color')
  })
})
