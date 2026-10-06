// Lane P: the preset table (M95, D74) — every preset fills exactly its
// fields, and OpenRouter's routing and attribution are exactly D74's.

import { describe, expect, it } from 'vitest'
import {
  azureOrigin,
  buildOpenRouterAuthUrl,
  listedPresets,
  OPENROUTER_ATTRIBUTION,
  OPENROUTER_PRIVACY_CHOICES,
  openRouterKeyPage,
  openRouterRoutingRequest,
  openRouterTokenRequestBody,
  isUserSuppliedOrigin,
  presetById,
  presetsByCategory,
  PRESETS,
  quirksOf,
  isKeyShape,
  FORMAT_QUIRKS,
  type ProviderPreset,
} from '../../src/core/providers/presets'

function preset(id: string): ProviderPreset {
  const found = presetById(id)
  if (found === undefined) {
    throw new Error(`missing preset ${id}`)
  }
  return found
}

describe('the preset table', () => {
  it('holds eighteen presets with unique, valid ids', () => {
    expect(PRESETS.length).toBe(18)
    const ids = PRESETS.map((candidate) => candidate.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
    }
  })

  it('lists only captured presets until the rig captures complete (rule 13)', () => {
    const listed = listedPresets().map((candidate) => candidate.id)
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
      expect(listed).toContain(id)
    }
    for (const id of ['azure', 'ollama', 'lmstudio', 'vllm', 'llamacpp', 'custom']) {
      expect(listed).not.toContain(id)
    }
  })

  it('gives every preset a label, a description and a category', () => {
    for (const candidate of PRESETS) {
      expect(candidate.label.trim()).not.toBe('')
      expect(candidate.description.trim()).not.toBe('')
      expect(presetsByCategory(candidate.category)).toContain(candidate)
    }
    expect(presetsByCategory('local').map((candidate) => candidate.id)).toEqual([
      'ollama',
      'lmstudio',
      'vllm',
      'llamacpp',
    ])
  })

  it('gives every keyed preset its key hint', () => {
    for (const candidate of PRESETS) {
      if (candidate.auth === 'apiKey') {
        expect(candidate.keyHint.trim(), candidate.id).not.toBe('')
      }
    }
  })

  it('fixes cloud origins and leaves user origins to the user', () => {
    expect(isUserSuppliedOrigin(preset('openai'))).toBe(false)
    expect(isUserSuppliedOrigin(preset('azure'))).toBe(true)
    expect(isUserSuppliedOrigin(preset('ollama'))).toBe(true)
    expect(isUserSuppliedOrigin(preset('custom'))).toBe(true)
    expect(preset('openai').origin).toEqual({ kind: 'fixed', origin: 'https://api.openai.com' })
    expect(preset('anthropic').origin).toEqual({
      kind: 'fixed',
      origin: 'https://api.anthropic.com',
    })
    expect(preset('azure').origin).toEqual({ kind: 'azure-resource' })
    expect(preset('ollama').origin).toEqual({ kind: 'loopback', defaultPort: 11_434 })
    expect(preset('custom').origin).toEqual({ kind: 'custom' })
  })

  it('sends each origin the header it documents', () => {
    expect(preset('anthropic').authHeader).toBe('bearer')
    expect(preset('gemini').authHeader).toBe('x-goog-api-key')
    expect(preset('azure').authHeader).toBe('api-key')
    expect(preset('openai').authHeader).toBe('bearer')
    expect(preset('ollama').authHeader).toBeUndefined()
  })

  it('checks key shapes as they are typed', () => {
    const anthropicKey = ['sk', '-', 'ant', '-', 'test-key-00001'].join('')
    expect(isKeyShape(preset('anthropic').keyShape, anthropicKey)).toBe(true)
    expect(isKeyShape(preset('anthropic').keyShape, 'sk-test-key-1')).toBe(false)
    expect(isKeyShape(preset('anthropic').keyShape, '')).toBe(false)
    const groqKey = ['gsk', '_', 'test-key-0000001'].join('')
    expect(isKeyShape(preset('groq').keyShape, groqKey)).toBe(true)
    const zaiKey = `${'a'.repeat(32)}.${'b'.repeat(16)}`
    expect(isKeyShape(preset('zai').keyShape, zaiKey)).toBe(true)
    expect(isKeyShape(preset('zai').keyShape, 'not-a-key')).toBe(false)
    expect(isKeyShape(preset('mistral').keyShape, 'short')).toBe(false)
    expect(isKeyShape(preset('mistral').keyShape, 'long-enough-key-1')).toBe(true)
  })

  it('tests keys for free where a check exists, else states a paid token', () => {
    expect(preset('openai').keyTest).toEqual({ kind: 'models-list' })
    expect(preset('openrouter').keyTest).toEqual({ kind: 'provider-key', path: '/api/v1/key' })
    expect(preset('huggingface').keyTest).toEqual({
      kind: 'provider-key',
      path: '/api/whoami-v2',
      origin: 'https://huggingface.co',
    })
    expect(preset('azure').keyTest).toEqual({ kind: 'paid-token' })
  })

  it('reads quirks from the preset over its format defaults', () => {
    expect(quirksOf(preset('openai'))).toEqual(FORMAT_QUIRKS.responses)
    expect(quirksOf(preset('openrouter')).reasoningField).toBe('reasoning_details')
    expect(quirksOf(preset('deepseek')).reasoningField).toBe('reasoning_content')
    expect(quirksOf(preset('gemini')).reasoningField).toBe('thoughtSignature')
    expect(quirksOf(preset('anthropic')).reasoningField).toBe('thinking')
    expect(quirksOf(preset('llamacpp')).toolChoice).toBe('string-only')
    expect(quirksOf(preset('together')).outputCapParam).toBe('max_tokens')
    for (const candidate of PRESETS) {
      expect(quirksOf(candidate).neverSendEmptyTools).toBe(true)
      expect(quirksOf(candidate).keepToolsWithHistory).toBe(true)
    }
  })

  it('builds Azure origins from resource names only', () => {
    expect(azureOrigin('my-resource')).toBe('https://my-resource.openai.azure.com/openai/v1')
    expect(azureOrigin('  My-Resource  ')).toBe('https://my-resource.openai.azure.com/openai/v1')
    expect(azureOrigin('has space')).toBeUndefined()
    expect(azureOrigin('ab')).toBeUndefined()
    expect(azureOrigin('has.dot')).toBeUndefined()
  })
})

describe('OpenRouter first-class', () => {
  it('sends exactly D74 attribution headers on every request', () => {
    expect(OPENROUTER_ATTRIBUTION.refererHeader).toBe('HTTP-Referer')
    expect(OPENROUTER_ATTRIBUTION.referer).toBe('https://github.com/RandyNorthrup/muse-spark-code')
    expect(OPENROUTER_ATTRIBUTION.titleHeader).toBe('X-OpenRouter-Title')
    expect(OPENROUTER_ATTRIBUTION.title).toBe('Muse Spark Code (Unofficial)')
    expect(OPENROUTER_ATTRIBUTION.categoriesHeader).toBe('X-OpenRouter-Categories')
    expect(OPENROUTER_ATTRIBUTION.categories).toBe('ide-extension')
  })

  it('defaults privacy to no data retention, with all three choices explained', () => {
    const zdr = OPENROUTER_PRIVACY_CHOICES.find((choice) => choice.id === 'zdr')
    expect(zdr?.request).toEqual({ provider: { zdr: true } })
    expect(OPENROUTER_PRIVACY_CHOICES.map((choice) => choice.id)).toEqual([
      'zdr',
      'no-training',
      'any',
    ])
    for (const choice of OPENROUTER_PRIVACY_CHOICES) {
      expect(choice.blurb.trim()).not.toBe('')
    }
    expect(openRouterRoutingRequest('zdr')).toEqual({ provider: { zdr: true } })
    expect(openRouterRoutingRequest('no-training', ['a', 'b'], false)).toEqual({
      provider: { data_collection: 'deny' },
      order: ['a', 'b'],
      allow_fallbacks: false,
    })
  })

  it('builds the connect URL and the single-use exchange', () => {
    const url = buildOpenRouterAuthUrl({
      challenge: 'challenge-value',
      state: 'state-value',
      callbackUrl: 'http://127.0.0.1:54321/callback',
      keyLabel: 'Muse Spark',
    })
    expect(url.startsWith('https://openrouter.ai/auth?')).toBe(true)
    expect(url).toContain('code_challenge=challenge-value')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('state=state-value')
    expect(url).toContain('callback_url=')
    const pasted = buildOpenRouterAuthUrl({ challenge: 'c', state: 's' })
    expect(pasted).not.toContain('callback_url')
    expect(openRouterTokenRequestBody({ code: 'code', verifier: 'verifier' })).toEqual({
      url: 'https://openrouter.ai/api/v1/auth/keys',
      method: 'POST',
      body: { code: 'code', code_verifier: 'verifier', code_challenge_method: 'S256' },
    })
    expect(openRouterKeyPage('ab'.repeat(32))).toBe(`https://openrouter.ai/keys/${'ab'.repeat(32)}`)
  })
})
