// Lane P: the preset table (M95, D74) — every preset fills exactly its
// fields, and OpenRouter's routing and attribution are exactly D74's.

import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  azureDeploymentRefusal,
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
  PLAN_KEY_PRESETS,
  planKeyPresetById,
  presetById,
  presetsByCategory,
  PRESETS,
  quirksOf,
  replayFieldFor,
  isKeyShape,
  wireModelFor,
  responsesTurnPath,
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

  it('holds twenty presets with unique, valid ids', () => {
    expect(PRESETS.length).toBe(20)
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
      // C-M95-4: live captures in docs/certification/m95-captures/<llamacpp|lmstudio>/.
      'lmstudio',
      'llamacpp',
    ]) {
      expect(listed).toContain(id)
    }
    for (const id of ['azure', 'ollama', 'vllm', 'custom', 'moonshot', 'ollama-cloud']) {
      expect(listed).not.toContain(id)
    }
  })

  it('defines Moonshot and Ollama Cloud uncaptured until the lead records their wires', () => {
    const moonshot = preset('moonshot')
    expect(moonshot.origin).toEqual({ kind: 'fixed', origin: 'https://api.moonshot.ai' })
    expect(moonshot.format).toBe('chat')
    expect(moonshot.authHeader).toBe('bearer')
    expect(moonshot.keyPage).toBe('https://platform.kimi.ai/console/api-keys')
    expect(moonshot.keyTest).toEqual({ kind: 'models-list' })
    expect(moonshot.modelsList.path).toBe('/v1/models')
    expect(moonshot.wireCapture).toBe(false)
    const cloud = preset('ollama-cloud')
    expect(cloud.origin).toEqual({ kind: 'fixed', origin: 'https://ollama.com' })
    expect(cloud.format).toBe('chat')
    expect(cloud.authHeader).toBe('bearer')
    expect(cloud.keyPage).toBe('https://ollama.com/settings/keys')
    expect(cloud.keyTest).toEqual({ kind: 'models-list' })
    expect(cloud.wireCapture).toBe(false)
    expect(isUserSuppliedOrigin(moonshot)).toBe(false)
    expect(isUserSuppliedOrigin(cloud)).toBe(false)
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

  it('keeps every fixed origin host-only so the pin and the paths compose', () => {
    // A versioned path in a fixed origin rejects every request at the pin
    // and doubles the composed URL (`/v1` + `/v1/models`); versions live in
    // the models-list and turn paths only.
    for (const candidate of [...PRESETS, ...PLAN_KEY_PRESETS]) {
      if (candidate.origin.kind !== 'fixed') continue
      expect(new URL(candidate.origin.origin).pathname, candidate.id).toBe('/')
      expect(candidate.modelsList.path.startsWith('/'), candidate.id).toBe(true)
    }
    const alibaba = planKeyPresetById('alibaba-plan')
    if (alibaba?.origin.kind !== 'fixed') throw new Error('missing Alibaba origin')
    expect(`${alibaba.origin.origin}${alibaba.modelsList.path}`).toBe(
      'https://coding-intl.dashscope.aliyuncs.com/v1/models',
    )
    expect(
      `${alibaba.origin.origin}${alibaba.modelsList.path.replace(/models$/, 'chat/completions')}`,
    ).toBe('https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions')
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
    expect(isKeyShape(preset('anthropic').keyShape, '[REDACTED]')).toBe(false)
    expect(isKeyShape(preset('anthropic').keyShape, '')).toBe(false)
    const groqKey = ['gsk', '_', 'test-key-0000001'].join('')
    expect(isKeyShape(preset('groq').keyShape, groqKey)).toBe(true)
    const zaiKey = `${'a'.repeat(32)}.${'b'.repeat(16)}`
    expect(isKeyShape(preset('zai').keyShape, zaiKey)).toBe(true)
    expect(isKeyShape(preset('zai').keyShape, 'not-a-key')).toBe(false)
    expect(isKeyShape(preset('mistral').keyShape, 'short')).toBe(false)
    expect(isKeyShape(preset('mistral').keyShape, 'long-enough-key-1')).toBe(true)
  })

  it('accepts the captured Fireworks underscore key prefix', () => {
    const key = ['fw', '_', 'synthetic-fixture-00001'].join('')
    expect(isKeyShape(preset('fireworks').keyShape, key)).toBe(true)
    expect(isKeyShape(preset('fireworks').keyShape, key.replace('_', '-'))).toBe(false)
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
    // EXECPROVR7: OpenAI documents an exact input-token count for the request.
    expect(quirksOf(preset('openai'))).toEqual({
      ...FORMAT_QUIRKS.responses,
      retry: { ...FORMAT_QUIRKS.responses.retry, errorKinds: ['server_error'] },
      supportsStrictTools: true,
      retryLimits: { maxRetries: 2 },
      exactCount: 'responses-input-tokens',
    })
    expect(quirksOf(preset('openrouter')).reasoningField).toBe('reasoning_details')
    expect(quirksOf(preset('deepseek')).reasoningField).toBe('reasoning_content')
    // C-M95-4: LM Studio streams `reasoning_content` (capture 02-plain-reply).
    expect(quirksOf(preset('lmstudio')).reasoningField).toBe('reasoning_content')
    // C-M95-4: LM Studio's list carries no window (capture 01-models-list).
    expect(preset('lmstudio').modelsList.windowField).toBeUndefined()
    expect(quirksOf(preset('gemini')).reasoningField).toBe('thoughtSignature')
    expect(quirksOf(preset('anthropic')).reasoningField).toBe('thinking')
    // C-M95-4: b11541 accepts the object form (capture 12-toolchoice-object).
    expect(quirksOf(preset('llamacpp')).toolChoice).toBe('auto')
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

  it('sends the Azure deployment as the wire model, never the family', () => {
    // PROVM95, research §1.2 [AZ1, AZ6]: `model` is the deployment name;
    // records resolve by the family, so the deployment never leaks into one.
    expect(wireModelFor({ preset: 'azure', deployment: 'my-gpt-deploy' }, 'gpt-5.4-nano')).toBe(
      'my-gpt-deploy',
    )
    expect(wireModelFor({ preset: 'openai', deployment: 'my-gpt-deploy' }, 'gpt-5.6-luna')).toBe(
      'gpt-5.6-luna',
    )
    expect(() => wireModelFor({ preset: 'azure' }, 'gpt-5.4-nano')).toThrow()
    expect(() => wireModelFor({ preset: 'azure', deployment: '' }, 'gpt-5.4-nano')).toThrow()
  })

  it('never replays thinking to an unversioned local server (fail closed)', () => {
    // C-M95-4 R2: neither local list carries a version, so a build older
    // or newer than the capture may not understand the captured replay
    // field. Local presets replay nothing; the decoder still displays
    // every reasoning field.
    for (const id of ['ollama', 'lmstudio', 'vllm', 'llamacpp']) {
      expect(replayFieldFor(preset(id))).toBe('none')
    }
    expect(replayFieldFor(preset('openrouter'))).toBe('details')
    expect(replayFieldFor(preset('deepseek'))).toBe('content')
    expect(replayFieldFor(preset('openai'))).toBe('none')
    expect(replayFieldFor(preset('groq'))).toBe('none')
  })

  it('stamps the captured server build on captured local presets only', () => {
    // C-M95-4 R2: the stamp names what the quirks were proven against
    // (the capture ledgers); the scan names it when it fails closed.
    expect(preset('llamacpp').capturedBuild).toBe('b11541 (0.6.0-dev, commit f2918cabb)')
    expect(preset('lmstudio').capturedBuild).toBe('llmster 0.0.25-1')
    for (const id of ['openai', 'ollama', 'vllm', 'custom']) {
      expect(preset(id).capturedBuild).toBeUndefined()
    }
  })

  it('posts an Azure deployment turn under its resource path, with the deployment as model', () => {
    // The address already ends in `/openai/v1`, so the turn and the list
    // read relative to it; the deployment is the request's model.
    expect(responsesTurnPath(preset('azure'))).toBe('/responses')
    expect(responsesTurnPath(preset('openai'))).toBe('/v1/responses')
    expect(responsesTurnPath(preset('xai'))).toBe('/v1/responses')
    expect(preset('azure').modelsList.path).toBe('/models')
  })

  it('refuses an unknown Azure deployment in plain words, and nothing else', () => {
    expect(azureDeploymentRefusal(404)).toBe(UI_TEXT.azureDeploymentInvalid)
    expect(UI_TEXT.azureDeploymentInvalid.trim()).not.toBe('')
    expect(azureDeploymentRefusal(401)).toBeUndefined()
    expect(azureDeploymentRefusal(429)).toBeUndefined()
    expect(azureDeploymentRefusal(500)).toBeUndefined()
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
