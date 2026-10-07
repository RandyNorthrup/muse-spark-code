import { describe, expect, it } from 'vitest'
import { buildWebviewHtml, createNonce } from '../../src/host/html'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'

const L10N_OPEN = `<script type="application/json" id="${WEBVIEW_L10N_ELEMENT_ID}">`

/** The data element's text, as the browser ends it: at the first `</script>`. */
function embeddedText(html: string): string {
  const start = html.indexOf(L10N_OPEN)
  if (start === -1) {
    throw new Error('no l10n script element')
  }
  const from = start + L10N_OPEN.length
  return html.slice(from, html.indexOf('</script>', from))
}

/** The JSON the webview reads, as it would read it: the element's text, parsed. */
function embeddedTable(html: string): unknown {
  return JSON.parse(embeddedText(html))
}

describe('createNonce', () => {
  it('returns 32 base64url characters', () => {
    expect(createNonce()).toMatch(/^[\w-]{32}$/)
  })

  it('does not repeat', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()))
    expect(nonces.size).toBe(50)
  })
})

describe('buildWebviewHtml', () => {
  const options = {
    scriptUri: 'vscode-resource://ext/dist/webview/main.js',
    styleUri: 'vscode-resource://ext/dist/webview/main.css',
    cspSource: 'vscode-webview://abc',
    nonce: 'NONCE123',
    l10n: { locale: 'en', table: EN },
  }
  const html = buildWebviewHtml(options)

  it('locks scripts to the nonce and forbids everything else by default', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'nonce-NONCE123'")
    expect(html).not.toContain('unsafe-inline')
    expect(html).not.toContain('unsafe-eval')
  })

  it('allows styles and images only from the webview origin', () => {
    expect(html).toContain("style-src vscode-webview://abc 'nonce-NONCE123'")
    expect(html).toContain('img-src vscode-webview://abc data:')
  })

  it('references the bundled script and stylesheet with the nonce', () => {
    expect(html).toContain(
      `<script type="module" nonce="NONCE123" src="${options.scriptUri}"></script>`,
    )
    expect(html).toContain(`<link rel="stylesheet" href="${options.styleUri}" nonce="NONCE123">`)
  })

  it('provides the React mount point', () => {
    expect(html).toContain('<div id="root"></div>')
  })

  it('marks only the read-only tasks document and keeps its CSP', () => {
    const tasks = buildWebviewHtml({ ...options, surface: 'tasks' })
    expect(tasks).toContain('<body data-native-context-menu="true" data-surface="tasks">')
    expect(html).toContain('<body data-native-context-menu="true">')
    expect(tasks).toContain("script-src 'nonce-NONCE123'")
    expect(tasks).not.toContain('unsafe-inline')
  })

  it('names the document language and embeds the table as data before the bundle (D33)', () => {
    const german = buildWebviewHtml({
      ...options,
      l10n: { locale: 'de', table: { ...EN, sendTitle: 'Senden' } },
    })
    expect(german).toContain('<html lang="de">')
    expect(embeddedTable(german)).toEqual({ locale: 'de', table: { ...EN, sendTitle: 'Senden' } })
    // Data, not a script: no nonce, so the CSP never lets it run; and it is
    // in place before the bundle that reads it.
    const data = german.indexOf(`id="${WEBVIEW_L10N_ELEMENT_ID}"`)
    expect(data).toBeGreaterThan(-1)
    expect(data).toBeLessThan(german.indexOf(`src="${options.scriptUri}"`))
    expect(html).toContain('<html lang="en">')
  })

  it('escapes text that could end the script element or break a line', () => {
    const hostile = '</script><script>alert(1)</script><!-- \u{2028} \u{2029}'
    const built = buildWebviewHtml({
      ...options,
      l10n: { locale: 'en', table: { ...EN, sendTitle: hostile } },
    })
    const element = embeddedText(built)
    expect(element).not.toContain('<')
    expect(element).not.toMatch(/[\u{2028}\u{2029}]/u)
    expect(element).toContain(String.raw`\u003c/script>`)
    // Parsed back, the text is exactly what the table held.
    expect(embeddedTable(built)).toEqual({ locale: 'en', table: { ...EN, sendTitle: hostile } })
  })
})

describe('shared host CSP for ESM chunks', () => {
  it.each([
    ['VS Code', 'https://file+.vscode-resource.vscode-cdn.net'],
    ['VSCodium', 'https://file+.vscode-resource.vscode-cdn.net'],
    ['code-server', 'https://editor.example.test'],
    ['Theia', 'https://webview.example.test'],
    ['shared companion UI', 'https://companion.example.test'],
  ])('%s permits a relative lazy chunk from its asset origin', (_host, origin) => {
    const script = `${origin}/extension/dist/webview/main.js`
    const chunk = new URL('chunks/optional.js?load=0.5', script)
    const html = buildWebviewHtml({
      scriptUri: script,
      styleUri: `${origin}/extension/dist/webview/main.css`,
      cspSource: origin,
      nonce: 'N',
      l10n: { locale: 'en', table: EN },
    })
    const scripts = /script-src ([^;"\n]+)/.exec(html)?.[1]?.split(' ')
    expect(scripts).toContain(chunk.origin)
    expect(scripts).toContain("'nonce-N'")
    expect(scripts).not.toContain('https:')
    expect(html).not.toContain('unsafe-inline')
    expect(html).not.toContain('unsafe-eval')
  })
})
