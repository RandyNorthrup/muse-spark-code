// @vitest-environment jsdom
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { renderCompanionPage, type CompanionPageContent } from '../../src/runtime/companion/page'

const NONCE = 'a'.repeat(64)
function content(overrides?: Partial<CompanionPageContent>): CompanionPageContent {
  return {
    locale: 'en',
    title: 'Usage & cost',
    stylesheets: ['/usage.css', '/theme.css'],
    modules: ['/usage.js'],
    imports: { 'muse-usage/usage.js': 'data:text/javascript;charset=utf-8,export{}' },
    uiTable: { locale: 'en', table: {} },
    usageTable: { type: 'usage/table' },
    ...overrides,
  }
}

describe('companion themed page', () => {
  it('links the entry, theme and font sheets in order with the page nonce', () => {
    const html = renderCompanionPage(
      NONCE,
      content({ stylesheets: ['/usage.css', '/theme.css', '/fonts/fonts.css'] }),
    )
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(
      [...page.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute('href')),
    ).toEqual(['/usage.css', '/theme.css', '/fonts/fonts.css'])
    for (const script of page.querySelectorAll('script[nonce]'))
      expect(script.getAttribute('nonce')).toBe(NONCE)
    expect(page.querySelector<HTMLElement>('#root')?.dataset['themeNonce']).toBe(NONCE)
    expect(page.body.dataset['hostBridge']).toBe('http')
    expect(page.querySelectorAll('script[type="module"]')).toHaveLength(1)
  })
  it('transports display copy as inert data, never markup', () => {
    const copy = '</script><img src=x onerror="alert(1)"> & themed'
    const html = renderCompanionPage(
      NONCE,
      content({ locale: 'es', uiTable: { locale: 'es', table: { title: copy } } }),
    )
    expect(html).toContain('lang="es"')
    expect(html).not.toContain(copy)
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelectorAll('img')).toHaveLength(0)
    const embedded: unknown = JSON.parse(page.querySelector('#muse-l10n')?.textContent ?? '')
    if (
      typeof embedded !== 'object' ||
      embedded === null ||
      !('table' in embedded) ||
      typeof embedded.table !== 'object' ||
      embedded.table === null ||
      !('title' in embedded.table)
    )
      throw new Error('missing embedded table title')
    expect(embedded.table.title).toBe(copy)
  })
  it.each([
    ['nonce', content(), '0'.repeat(31)],
    ['nonce', content(), 'test-nonce'],
    ['stylesheet', content({ stylesheets: ['https://foreign.example/theme.css'] })],
    ['stylesheet', content({ stylesheets: ['/theme.css', '/chunks/..%2f/x.css'] })],
    ['module', content({ modules: ['/usage.js', 'data:text/javascript,alert(1)'] })],
    ['import', content({ imports: { 'muse-usage/usage.js': 'https://foreign.example/x.js' } })],
    ['import', content({ imports: { '"><evil': 'data:text/javascript;charset=utf-8,x' } })],
  ])(
    'refuses a forged %s instead of serving a half-escaped page: %s',
    (_label, body, nonce = NONCE) => {
      expect(() => renderCompanionPage(nonce, body)).toThrow('EPANEL_PAGE')
    },
  )
  it('has no axe accessibility violations on the served shell', async () => {
    document.documentElement.innerHTML = renderCompanionPage(NONCE, content())
    document.documentElement.lang = 'en'
    // jsdom computes no colours, so contrast stays off; structure still asserts.
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations).toEqual([])
  })
  it('escapes the document title', () => {
    const page = new DOMParser().parseFromString(
      renderCompanionPage(NONCE, content({ title: '</title><img src=x onerror="alert(1)">' })),
      'text/html',
    )
    expect(page.title).toBe('</title><img src=x onerror="alert(1)">')
    expect(page.querySelectorAll('img')).toHaveLength(0)
  })
})
