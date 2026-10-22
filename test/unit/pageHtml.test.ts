// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { buildPageHtml } from '../../src/host/ui/pageHtml'

const options = {
  bridge: 'companion' as const,
  binding: { surface: 'surface', sessionId: 'session', surfaceKind: 'chat' as const },
  scriptUri: '/main.js',
  styleUri: '/main.css',
  nonce: 'trusted-nonce',
  assetOrigin: "'self'",
  l10n: { locale: 'en', table: EN },
  theme: { kind: 'dark' as const, tokens: { '--muse-foreground': '#fff' } },
}
describe('portable page HTML', () => {
  it('includes the binding, theme, language and companion connect policy without credentials', () => {
    const html = buildPageHtml(options)
    expect(html).toContain('data-bridge="companion"')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('--ms-foreground:#fff')
    expect(html).toContain("connect-src 'self'")
    expect(html).toContain('id="muse-panel"')
    expect(html).not.toContain('Bearer ')
  })
  it('escapes a surface id that could close the data element', () => {
    const html = buildPageHtml({
      ...options,
      binding: { ...options.binding, surface: '</script><img src=x>' },
    })
    expect(html).not.toContain('</script><img')
    expect(html).toContain(String.raw`\u003c/script>`)
  })
  it.each(['&quot;', '" onload="attacker()', '<script>', '</script>', "' onclick='attacker()"])(
    'preserves %s as attribute data without creating markup',
    (hostile) => {
      const document = new DOMParser().parseFromString(
        buildPageHtml({ ...options, scriptUri: hostile, styleUri: hostile }),
        'text/html',
      )
      expect(document.querySelector('script[src]')?.getAttribute('src')).toBe(hostile)
      expect(document.querySelector('link')?.getAttribute('href')).toBe(hostile)
      expect(document.querySelectorAll('[onload], [onclick]')).toHaveLength(0)
      expect(document.querySelectorAll('script')).toHaveLength(3)
    },
  )
  it.each([
    ['&', '&amp;'],
    ['"', '&quot;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
  ])('encodes the attribute metacharacter %s once', (value, encoded) => {
    const html = buildPageHtml({ ...options, scriptUri: value, styleUri: value })
    expect(html).toContain(`src="${encoded}"`)
    expect(html).toContain(`href="${encoded}"`)
  })
  it.each(['nonce" onload="attacker()', "nonce' 'unsafe-inline", 'nonce; script-src *'])(
    'refuses a nonce that could change markup or CSP: %s',
    (nonce) => {
      expect(() => buildPageHtml({ ...options, nonce })).toThrow('MHP_INVALID_NONCE')
    },
  )
  it('round-trips hostile binding data and line separators in a single inert element', () => {
    const binding = {
      ...options.binding,
      surface: '</ScRiPt><script>attacker()</script><!--\u{2028}\u{2029}',
      sessionId: '"&<tag>\'session',
    }
    const document = new DOMParser().parseFromString(
      buildPageHtml({ ...options, binding }),
      'text/html',
    )
    const text = document.querySelector('#muse-panel')?.textContent
    expect(text).toBeDefined()
    expect(text).not.toMatch(/[<\u{2028}\u{2029}]/u)
    expect(JSON.parse(text ?? '')).toEqual(binding)
    expect(document.querySelectorAll('script')).toHaveLength(3)
  })
  it.each(['red; color:blue', '</style><script>', 'url(https://attacker.invalid)', '@import'])(
    'rejects theme injection %s',
    (value) => {
      expect(() =>
        buildPageHtml({
          ...options,
          theme: { kind: 'light', tokens: { '--muse-foreground': value } },
        }),
      ).toThrow('MHP_INVALID_THEME')
    },
  )
  it('renders Tasks in a native panel and prohibits network connections', () => {
    const html = buildPageHtml({
      ...options,
      bridge: 'native',
      binding: { ...options.binding, surfaceKind: 'tasks' },
    })
    expect(html).toContain('data-surface="tasks"')
    expect(html).toContain("connect-src 'none'")
  })
})
