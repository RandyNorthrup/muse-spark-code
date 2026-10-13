// Lane PROVKEYS: a pasted provider key is never refused for its shape.
// Pure logic through the real module: blank is refused (nothing can be
// sent); inner whitespace, a URL, a file path or placeholder text each
// raises a question the person answers; everything else is sent for the
// provider to judge.

import { describe, expect, it } from 'vitest'
import {
  inspectProviderKey,
  isKeyShape,
  presetById,
  providerKeyNoticeText,
  type ProviderKeyNotice,
} from '../../src/core/providers/presets'

const SHAPE = { kind: 'any' } as const

describe('inspectProviderKey', () => {
  it('refuses only a blank value', () => {
    expect(inspectProviderKey('')).toBe('empty')
    expect(inspectProviderKey(' '.repeat(3))).toBe('empty')
    expect(inspectProviderKey('\n\t ')).toBe('empty')
  })

  it('sends real-looking keys without a question, whatever their shape', () => {
    // The released defect's shape: a working Gemini key beginning `AQ.`.
    for (const key of [
      'AQ.synthetic-fixture-00001-no-frozen-prefix',
      'sk-ant-synthetic-fixture-00001',
      'sk-synthetic-fixture-00001',
      'xai-synthetic-fixture-00001',
      'sk-or-synthetic-fixture-00001',
      'gsk_synthetic-fixture-00001',
      'fw_synthetic-fixture-00001',
      'hf_synthetic-fixture-00001',
      'x',
      'a'.repeat(32) + '.' + 'b'.repeat(16),
      'my-s3cr3t!with$ymbols~ok',
    ]) {
      expect(inspectProviderKey(key)).toBe('ok')
      expect(isKeyShape(SHAPE, key)).toBe(true)
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

  it('does not flag real keys that merely contain placeholder words', () => {
    expect(inspectProviderKey('example2-synthetic-key')).toBe('ok')
    expect(inspectProviderKey('xx-synthetic-key')).toBe('ok')
    expect(inspectProviderKey('mykey-synthetic-00001')).toBe('ok')
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

describe('provider presets carry no frozen key shape', () => {
  it('every keyed preset accepts the wrong-for-all key for sending', () => {
    for (const id of [
      'openai',
      'xai',
      'anthropic',
      'gemini',
      'openrouter',
      'groq',
      'deepseek',
      'mistral',
      'together',
      'fireworks',
      'huggingface',
      'zai',
    ]) {
      const preset = presetById(id)
      expect(preset).toBeDefined()
      expect(isKeyShape(preset?.keyShape ?? SHAPE, 'MADEUP-KEY-0001-NO-PREFIX')).toBe(true)
    }
  })
})
