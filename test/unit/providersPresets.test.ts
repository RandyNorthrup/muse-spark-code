// Lane P: the preset table (M95, D74) — every preset fills exactly its
// fields, and OpenRouter's routing and attribution are exactly D74's.

import { describe, expect, it } from 'vitest'
import {
  azureOrigin,
  buildOpenRouterAuthUrl,
  customQuirksFor,
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
  it('declares DeepSeek strict tools and the full effort vocabulary (DS-G02, DS-G01 round 2)', () => {
    // DS-STRICT and DS-STRICT-PROD answer 200 with `strict: true` on
    // either address, so strict is declared, never address-gated.
    // DS-XHIGH and DS-ULTRA answer 200 to the names, so the dated
    // record carries the full vocabulary.
    expect(preset('deepseek').quirks.supportsStrictTools).toBe(true)
    const facts = preset('deepseek').reasoningFacts ?? []
    const flash = facts.find((fact) => fact.modelId === 'deepseek-flash')
    expect(flash?.fields.reasoning?.effortLevels).toEqual({
      state: 'yes',
      value: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    })
  })

  it('declares Anthropic Thinking-off facts and grok-4.5 xhigh (round 2)', () => {
    // GAPANTH-G02: the thinking table answers 400 to `disabled` on four
    // models (Sonnet 5.5 takes `between_tools` instead); Opus 5 and
    // Haiku 5.5 take `disabled`. XAI-G01: grok-4.5 takes `xhigh`.
    const facts = preset('anthropic').reasoningFacts ?? []
    const fact = (id: string) => facts.find((entry) => entry.modelId === id)
    expect(fact('claude-opus-5-5')?.fields.reasoning?.canDisable).toEqual({ state: 'no' })
    expect(fact('claude-fable-5')?.fields.reasoning?.canDisable).toEqual({ state: 'no' })
    expect(fact('claude-fable-5-1')?.fields.reasoning?.canDisable).toEqual({ state: 'no' })
    expect(fact('claude-sonnet-5-5')?.fields.reasoning?.canDisable).toEqual({ state: 'no' })
    expect(fact('claude-sonnet-5-5')?.fields.reasoning?.offSwitch).toBe('between_tools')
    expect(fact('claude-opus-5')?.fields.reasoning?.canDisable).toEqual({
      state: 'yes',
      value: true,
    })
    expect(fact('claude-haiku-5-5')?.fields.reasoning?.canDisable).toEqual({
      state: 'yes',
      value: true,
    })
    // Every 4.x row ends in "Thinking off": `disabled` rides there.
    expect(fact('claude-opus-4-5')?.fields.reasoning?.canDisable).toEqual({
      state: 'yes',
      value: true,
    })
    expect(fact('claude-opus-4-6')?.fields.reasoning?.canDisable).toEqual({
      state: 'yes',
      value: true,
    })
    const xai = preset('xai').reasoningFacts ?? []
    expect(
      xai.find((entry) => entry.modelId === 'grok-4.5')?.fields.reasoning?.effortLevels,
    ).toEqual({ state: 'yes', value: ['low', 'medium', 'high', 'xhigh'] })
  })

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

  it('hints name where the key comes from, never a key shape', () => {
    for (const candidate of PRESETS) {
      if (candidate.auth !== 'apiKey') {
        continue
      }
      expect(candidate.keyHint).not.toContain('AIza')
      expect(candidate.keyHint).not.toContain('sk-ant-')
      expect(candidate.keyHint).not.toContain('sk-or-')
      expect(candidate.keyHint).not.toContain('gsk_')
      expect(candidate.keyHint).not.toContain('fw_')
      expect(candidate.keyHint).not.toContain('hf_')
      expect(candidate.keyHint).not.toContain('xai-')
      expect(candidate.keyHint).not.toMatch(/beginning with/i)
    }
    expect(preset('fireworks').keyHint).toContain('fireworks.ai')
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
    // M101 BYO 5: OpenAI adds its documented server_error past the responses table.
    // M101 item 24: OpenAI takes strict tool schemas.
    // Lane RETRYLIMITS (review RVRETRYLIMITS): OpenAI's SDK-documented 2 retries.
    expect(quirksOf(preset('openai'))).toEqual({
      ...FORMAT_QUIRKS.responses,
      retry: { ...FORMAT_QUIRKS.responses.retry, errorKinds: ['server_error'] },
      supportsStrictTools: true,
      retryLimits: { maxRetries: 2 },
    })
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

  it('resolves custom-server quirks from format defaults plus compat (M101 BYO 14)', () => {
    expect(customQuirksFor('chat', undefined)).toEqual(FORMAT_QUIRKS.chat)
    expect(
      customQuirksFor('chat', {
        toolChoice: 'string-only',
        sendsParallelToolCalls: false,
        outputCapParam: 'max_tokens',
      }),
    ).toEqual({
      ...FORMAT_QUIRKS.chat,
      toolChoice: 'string-only',
      sendsParallelToolCalls: false,
      outputCapParam: 'max_tokens',
    })
    // Overrides never leak across servers: a bare custom server keeps Zed's defaults.
    expect(customQuirksFor('chat', undefined).sendsParallelToolCalls).toBe(
      FORMAT_QUIRKS.chat.sendsParallelToolCalls,
    )
    // An explicitly-unset override never blanks a required quirk.
    expect(customQuirksFor('chat', { toolChoice: undefined })).toEqual(FORMAT_QUIRKS.chat)
  })

  it('gates strict tool schemas per capable server (M101 item 24)', () => {
    expect(quirksOf(preset('openai')).supportsStrictTools).toBe(true)
    expect(quirksOf(preset('azure')).supportsStrictTools).toBe(true)
    expect(quirksOf(preset('deepseek')).supportsStrictTools).toBe(true)
    for (const id of ['xai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'llamacpp', 'custom']) {
      expect(quirksOf(preset(id)).supportsStrictTools).toBe(false)
    }
    // A custom server claims it only through its compatibility overrides.
    expect(customQuirksFor('chat', { supportsStrictTools: true }).supportsStrictTools).toBe(true)
    expect(customQuirksFor('chat', undefined).supportsStrictTools).toBe(false)
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
      provider: { data_collection: 'deny', order: ['a', 'b'], allow_fallbacks: false },
    })
  })

  it('nests explicit routing restrictions for every privacy choice', () => {
    for (const privacy of ['zdr', 'no-training', 'any'] as const) {
      const request = openRouterRoutingRequest(privacy, ['vendor'], false)
      expect(request).toMatchObject({ provider: { order: ['vendor'], allow_fallbacks: false } })
      expect(request).not.toHaveProperty('order')
      expect(request).not.toHaveProperty('allow_fallbacks')
    }
    expect(openRouterRoutingRequest('any')).toEqual({})
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
