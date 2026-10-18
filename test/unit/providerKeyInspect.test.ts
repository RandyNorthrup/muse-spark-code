// Lane PROVKEYS: a pasted provider key is never refused for its shape.
// Pure logic through the real module: blank is refused (nothing can be
// sent); inner whitespace, a URL, a file path or placeholder text each
// raises a question the person answers; everything else is sent for the
// provider to judge. The inputs below are generic strings exercising a
// provider-agnostic classifier — none of them pretends to be any
// provider's key, so no outside-world input is involved.

import { describe, expect, it } from 'vitest'
import {
  inspectProviderKey,
  providerKeyNoticeText,
  type ProviderKeyNotice,
} from '../../src/core/providers/presets'

describe('inspectProviderKey', () => {
  it('refuses only a blank value', () => {
    expect(inspectProviderKey('')).toBe('empty')
    expect(inspectProviderKey(' '.repeat(3))).toBe('empty')
    expect(inspectProviderKey('\n\t ')).toBe('empty')
  })

  it('sends ordinary non-blank values without a question, whatever their shape', () => {
    for (const key of [
      'opaque-token-00001',
      'token.abcdef',
      'x',
      'with-dashes-and-0123456789',
      'my-s3cr3t!with$ymbols~ok',
    ]) {
      expect(inspectProviderKey(key)).toBe('ok')
    }
  })

  it('asks about inner whitespace instead of refusing', () => {
    expect(inspectProviderKey('two words')).toBe('whitespace')
    expect(inspectProviderKey('trailing-space ')).toBe('ok')
    expect(inspectProviderKey('line\nbreak')).toBe('whitespace')
  })

  it('asks about a URL instead of refusing', () => {
    expect(inspectProviderKey('https://example.com/key')).toBe('url')
    expect(inspectProviderKey('http://127.0.0.1:8080/x')).toBe('url')
  })

  it('asks about a file path instead of refusing', () => {
    for (const path of [
      '/home/person/.config/key',
      String.raw`C:\Users\person\key.txt`,
      String.raw`\\server\share\key`,
      '~/.config/key',
      './relative/key',
      '../up/key',
    ]) {
      expect(inspectProviderKey(path)).toBe('path')
    }
  })

  it('asks about placeholder text instead of refusing', () => {
    for (const placeholder of [
      'YOUR_API_KEY',
      'your-key-here',
      'xxx',
      '***',
      '<api-key>',
      'paste-key-here',
      'example',
      'changeme',
    ]) {
      expect(inspectProviderKey(placeholder)).toBe('placeholder')
    }
  })

  it('does not flag ordinary values that merely contain placeholder words', () => {
    expect(inspectProviderKey('example2-token')).toBe('ok')
    expect(inspectProviderKey('xx-token')).toBe('ok')
    expect(inspectProviderKey('mykey-token-00001')).toBe('ok')
  })
})

describe('providerKeyNoticeText', () => {
  it('asks a use-it-anyway question for every notice', () => {
    const notices: readonly ProviderKeyNotice[] = ['whitespace', 'url', 'path', 'placeholder']
    for (const notice of notices) {
      const text = providerKeyNoticeText(notice)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/anyway/i)
    }
  })
})
