import { describe, expect, it } from 'vitest'
import { escapeHtml, highlight, resolveLanguage } from '../../src/webview/highlight'

describe('resolveLanguage', () => {
  it('accepts registered grammars and their aliases, case-insensitively', () => {
    expect(resolveLanguage('typescript')).toBe('typescript')
    expect(resolveLanguage('TS')).toBe('typescript')
    expect(resolveLanguage('sh')).toBe('bash')
    expect(resolveLanguage('html')).toBe('xml')
    expect(resolveLanguage('ps1')).toBe('powershell')
    expect(resolveLanguage('brainfuck')).toBeUndefined()
    expect(resolveLanguage(undefined)).toBeUndefined()
  })
})

describe('highlight', () => {
  it('annotates known languages with highlight.js classes', () => {
    const html = highlight('const x = "y"', 'ts')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-string')
  })

  it('escapes unknown languages and never lets markup through', () => {
    expect(highlight('<script>alert(1)</script>', undefined)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(highlight('<b>', 'json')).not.toContain('<b>')
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})
