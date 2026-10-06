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
