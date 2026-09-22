import { describe, expect, it } from 'vitest'
import { buildWebviewHtml, createNonce } from '../../src/host/html'

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
    expect(html).toContain(`<script nonce="NONCE123" src="${options.scriptUri}"></script>`)
    expect(html).toContain(`<link rel="stylesheet" href="${options.styleUri}" nonce="NONCE123">`)
  })

  it('provides the React mount point', () => {
    expect(html).toContain('<div id="root"></div>')
  })
})
