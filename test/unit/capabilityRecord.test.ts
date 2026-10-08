import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesOf,
  capabilityEffortLevels,
  metaCapabilityRecord,
  resolveModelCapabilities,
  type CapabilityOverrides,
  type CapabilityEvidence,
} from '../../src/core/providers/capabilities'
import { nativeCapabilityEvidence } from '../../src/core/providers/modelMetadata'
import { capturedCapabilities } from '../../src/core/providers/capturedCapabilities'
import { providersFileSchema, readProvidersFile } from '../../src/core/providers/providersFile'
import {
  parseAnthropicModelsList,
  encodeAnthropicRequest,
} from '../../src/core/backends/modelapi/codecs/anthropic'
import {
  parseGeminiModelsList,
  encodeGeminiRequest,
} from '../../src/core/backends/modelapi/codecs/gemini'
import { parseResponsesModelsList } from '../../src/core/backends/modelapi/codecs/responses'
import { parseChatModelsList } from '../../src/core/backends/modelapi/codecs/chat'
import { parseOllamaModelsList } from '../../src/core/backends/modelapi/codecs/ollama'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { AttachmentStore } from '../../src/core/attachments'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import { pdfFixture } from './helpers/pdfFixture'

const identity = { provider: 'custom-id', nativeModel: 'native', format: 'chat' as const }
const source = { kind: 'user' as const }
const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })
const record = (fields: CapabilityOverrides = {}) =>
  resolveModelCapabilities(identity, [{ source, fields }])
const body: CreateResponseBody = {
  model: 'muse-spark-1.3',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] }],
  instructions: '',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'high', summary: 'auto' },
  max_output_tokens: 4096,
  stream: true,
  store: false,
  include: [],
  prompt_cache_key: 'fixture',
  prompt_cache_retention: 'in_memory',
}
function samples(provider: string, file = '01-models-list.json'): unknown {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL(`../../docs/certification/m95-captures/${provider}/${file}`, import.meta.url),
      'utf8',
    ),
  )
  if (typeof raw !== 'object' || raw === null || !('response' in raw))
    throw new Error('Missing capture response')
  const response = raw.response
  if (typeof response !== 'object' || response === null || !('bodySummary' in response))
    throw new Error('Missing summary')
  const summary = response.bodySummary
  if (typeof summary !== 'object' || summary === null || !('sample' in summary))
    throw new Error('Missing sample')
  return summary.sample
}

function catalogueModel(provider: string, id: string): unknown {
  const snapshot: unknown = JSON.parse(
    readFileSync(new URL('../../vendor/models-dev/snapshot.json', import.meta.url), 'utf8'),
  )
  if (typeof snapshot !== 'object' || snapshot === null || !('providers' in snapshot))
    throw new Error('Missing catalogue')
  const providers = snapshot.providers
  if (typeof providers !== 'object' || providers === null) throw new Error('Missing providers')
  const section: unknown = Reflect.get(providers, provider)
  if (typeof section !== 'object' || section === null || !('models' in section))
    throw new Error('Missing models')
  const models = section.models
  if (typeof models !== 'object' || models === null) throw new Error('Missing rows')
  return Reflect.get(models, id)
}

describe('RVM95N joined regressions', () => {
  it('keeps enabled Gemini thinking positive through a zero catalogue minimum', () => {
    const model = 'gemini-2.5-flash'
    const resolved = resolveModelCapabilities(
      { provider: 'gemini', nativeModel: model, format: 'gemini' },
      [nativeCapabilityEvidence('gemini', catalogueModel('gemini', model), { kind: 'catalogue' })],
    )
    expect(resolved.reasoning.budget?.min).toBe(0)
    expect(encodeGeminiRequest(body, model, resolved).body['generationConfig']).toMatchObject({
      thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
    })
    expect(() => encodeGeminiRequest(body, model, resolved, 0)).toThrow(/thinking_budget/)
    expect(
      encodeGeminiRequest(
        { ...body, reasoning: { effort: 'none', summary: 'auto' } },
        model,
        resolved,
      ).body['generationConfig'],
    ).toMatchObject({ thinkingConfig: { thinkingBudget: 0 } })
    const manual = record({ reasoning: { modes: yes(['manual']), budget: { min: 0 } } })
    expect(
      encodeAnthropicRequest(body, {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 4096,
        effort: 'high',
        capabilityRecord: manual,
      }).body.thinking,
    ).toEqual({ type: 'enabled', budget_tokens: 1024 })
  })

  it.each([{ state: 'no' as const }, { state: 'unknown' as const }, yes(['low'])])(
    'omits unsupported effort while keeping adaptive and level thinking (%j)',
    (effortLevels) => {
      const adaptive = record({ reasoning: { modes: yes(['adaptive']), effortLevels } })
      const anthropic = encodeAnthropicRequest(body, {
        model: 'claude-sonnet-5-5',
        maxTokens: 4096,
        effort: 'high',
        capabilityRecord: adaptive,
      }).body
      expect(anthropic.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(anthropic).not.toHaveProperty('output_config')
      const level = record({ reasoning: { modes: yes(['level']), effortLevels } })
      expect(
        encodeGeminiRequest(body, 'gemini-3.5-flash-lite', level).body['generationConfig'],
      ).toEqual({ maxOutputTokens: 4096, thinkingConfig: { includeThoughts: true } })
    },
  )

  it('derives Gemini level mode from committed effort-only catalogue evidence', () => {
    const model = 'gemini-3.5-flash-lite'
    const row = parseGeminiModelsList({ models: samples('gemini') }).find(
      (item) => item.id === model,
    )
    const resolved = resolveModelCapabilities(
      { provider: 'gemini', nativeModel: model, format: 'gemini' },
      [
        nativeCapabilityEvidence('gemini', row?.native, { kind: 'models-list' }),
        nativeCapabilityEvidence('gemini', catalogueModel('gemini', model), { kind: 'catalogue' }),
      ],
    )
    expect(resolved.reasoning.modes).toMatchObject({
      value: ['level'],
      source: { kind: 'catalogue' },
    })
    expect(encodeGeminiRequest(body, model, resolved).body['generationConfig']).toMatchObject({
      thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
    })
    expect(
      nativeCapabilityEvidence('xai', { reasoning: { supported_efforts: ['low', 'high'] } }, source)
        .fields.reasoning?.modes,
    ).toMatchObject({ value: ['level'] })
    const anthropic = nativeCapabilityEvidence(
      'anthropic',
      {
        capabilities: { effort: { supported: true, high: { supported: true } } },
      },
      source,
    )
    const adaptive = resolveModelCapabilities({ ...identity, format: 'anthropic' }, [anthropic])
    expect(
      encodeAnthropicRequest(body, {
        model: 'native',
        maxTokens: 4096,
        effort: 'high',
        capabilityRecord: adaptive,
      }).body,
    ).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
  })

  it('enforces documented Anthropic image bytes from captured list evidence at admission and replay', () => {
    const row = parseAnthropicModelsList({
      data: samples('anthropic', '01-models-list-x-api-key.json'),
    })[0]
    const resolved = resolveModelCapabilities(
      { provider: 'anthropic', nativeModel: row?.id ?? '', format: 'anthropic' },
      [nativeCapabilityEvidence('anthropic', row?.native, { kind: 'models-list' })],
    )
    expect(resolved.modalities.image).toMatchObject({ value: { maxBytes: 10_000_000 } })
    const png = new Uint8Array(12 * 1024 * 1024)
    png.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      1, 0, 0, 0, 1,
    ])
    expect(new AttachmentStore(() => 'image').add('large.png', png, true, false, resolved).ok).toBe(
      false,
    )
    const image = {
      type: 'input_image' as const,
      image_url: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      detail: 'auto' as const,
    }
    expect(
      new MediaBudget().fit([{ type: 'message', role: 'user', content: [image] }], resolved)[0],
    ).toMatchObject({ content: [{ type: 'input_text' }] })
  })

  it('retains sparse native Anthropic versions and Gemini generation methods', () => {
    const anthropic = {
      id: 'bare',
      version: 'fixture-version',
      max_input_tokens: 8192,
      max_tokens: 4096,
    }
    const a = parseAnthropicModelsList({ data: [anthropic] })[0]
    expect(a?.native).toEqual(anthropic)
    expect(nativeCapabilityEvidence('anthropic', a?.native, source).fields.servedVersion).toBe(
      'fixture-version',
    )
    const gemini = {
      name: 'models/bare',
      inputTokenLimit: 8192,
      outputTokenLimit: 4096,
      supportedGenerationMethods: ['generateContent', 'countTokens', 'createCachedContent'],
    }
    expect(parseGeminiModelsList({ models: [gemini] })[0]?.native).toEqual(gemini)
  })

  it('attributes uncaptured Gemini 2.5 budget mode to research without capture precedence', () => {
    const fallback = capturedCapabilities('gemini', 'gemini-2.5-pro')
    expect(fallback.reasoning.modes).toMatchObject({
      value: ['budget'],
      source: { kind: 'preset', ref: 'docs/certification/m95-research.md' },
    })
    expect(fallback.sources['reasoning.modes']?.kind).toBe('preset')
  })

  it.each(['support', 'mime', 'limit'] as const)(
    'explains media %s refusal without blaming newer media',
    (reason) => {
      const image = {
        type: 'input_image' as const,
        image_url: 'data:image/png;base64,AQ==',
        detail: 'auto' as const,
      }
      const resolved = record(
        reason === 'support'
          ? undefined
          : {
              modalities: {
                image: yes({
                  mimes: [reason === 'mime' ? 'image/jpeg' : 'image/png'],
                  maxBytes: 1,
                }),
              },
            },
      )
      const part = {
        ...image,
        image_url: reason === 'limit' ? 'data:image/png;base64,AQID' : image.image_url,
      }
      const budget = new MediaBudget()
      const user = budget.fit([{ type: 'message', role: 'user', content: [part] }], resolved)
      const tool = budget.fit(
        [{ type: 'function_call_output', call_id: 'image', output: [part] }],
        resolved,
      )
      const phrases = { support: 'support', mime: 'MIME', limit: 'model media limits' }
      const phrase = phrases[reason]
      expect(user[0]).toMatchObject({
        content: [{ type: 'input_text', text: expect.stringContaining(phrase) }],
      })
      expect(tool[0]).toMatchObject({
        output: [{ type: 'input_text', text: expect.stringContaining(phrase) }],
      })
      expect(JSON.stringify(user)).not.toContain('newer media')
      expect(JSON.stringify(tool)).not.toContain('newer media')
      expect(budget.omitted).toBe(true)
    },
  )
})

describe('normalized capability record', () => {
  it('unknown never proves tools, reasoning, images or parallel calls', () => {
    const unknown = resolveModelCapabilities(identity)
    expect(unknown.tools.calling).toEqual({ state: 'unknown' })
    expect(capabilitiesOf({ capabilityRecord: unknown })).toEqual({
      toolCalling: false,
      vision: false,
      reasoning: false,
      parallelToolCalls: false,
    })
    expect(capabilityEffortLevels(unknown)).toEqual([])
  })
  it('resolves each field by source priority, including explicit no, independent of input order', () => {
    const evidence: CapabilityEvidence[] = [
      {
        source: { kind: 'user' },
        fields: { tools: { calling: { state: 'no' } }, limits: { loadedContextTokens: 8192 } },
      },
      {
        source: { kind: 'preset', ref: 'preset' },
        fields: { tools: { calling: yes(true), parallel: yes(true) } },
      },
      {
        source: { kind: 'catalogue', ref: 'catalogue' },
        fields: { modalities: { image: yes({ mimes: ['image/png'] }) } },
      },
      {
        source: { kind: 'capture', ref: 'capture' },
        fields: {
          reasoning: { effortLevels: yes(['low', 'high']) },
          limits: { contextTokens: 64_000 },
        },
      },
      {
        source: { kind: 'models-list', ref: 'list' },
        fields: { limits: { contextTokens: 32_000, inputTokens: 31_000 } },
      },
    ]
    const resolved = resolveModelCapabilities(identity, evidence)
    expect(resolved.tools.calling).toEqual({ state: 'no', source: { kind: 'user' } })
    expect(resolved.tools.parallel).toMatchObject({ source: { kind: 'preset' } })
    expect(resolved.modalities.image).toMatchObject({ source: { kind: 'catalogue' } })
    expect(resolved.limits).toEqual({
      contextTokens: 64_000,
      inputTokens: 31_000,
      loadedContextTokens: 8192,
    })
    expect(resolved.sources['limits.contextTokens']).toEqual({ kind: 'capture', ref: 'capture' })
    expect(resolved.sources['limits.inputTokens']).toEqual({ kind: 'models-list', ref: 'list' })
    expect(capabilityEffortLevels(resolved)).toEqual(['low', 'high'])
  })
  it('honors explicit negative reasoning overrides across the legacy view', () => {
    const capture: CapabilityEvidence = {
      source: { kind: 'capture' },
      fields: { reasoning: { supported: yes(true), modes: yes(['adaptive']) } },
    }
    const resolved = resolveModelCapabilities(identity, [
      capture,
      { source, fields: { reasoning: { modes: { state: 'no' } } } },
    ])
    expect(capabilitiesOf({ capabilityRecord: resolved }).reasoning).toBe(false)
    const denied = resolveModelCapabilities(identity, [
      capture,
      { source, fields: { reasoning: { supported: { state: 'no' } } } },
    ])
    expect(capabilitiesOf({ capabilityRecord: denied }).reasoning).toBe(false)
  })
  it('keeps every field family and binds served version without changing configured identity', () => {
    const resolved = record({
      servedVersion: 'v2',
      tools: {
        choiceModes: yes(['auto', 'none', 'required', 'named']),
        streamingArguments: yes(true),
        historyRequiresTools: true,
      },
      reasoning: {
        modes: yes(['manual', 'adaptive', 'level', 'budget', 'off']),
        canDisable: yes(true),
        forced: { state: 'no' },
        summary: yes(true),
        budget: { min: 1024, max: 8192 },
        replay: { envelope: 'anthropic-signed', prefixEditPolicy: 'drop' },
      },
      cache: {
        mode: 'breakpoints',
        acceptsKey: false,
        retention: ['in_memory'],
        ttls: ['5m', '1h'],
        minPrefixTokens: 1024,
        maxBreakpoints: 4,
      },
      output: {
        formats: yes(['text', 'json_object', 'json_schema', 'strict_schema', 'forced_tool']),
        minTokens: 16,
        maxTokens: 8192,
        acceptsLimit: yes(true),
      },
      modalities: {
        audio: yes(true),
        image: yes({ mimes: ['image/png'], maxBytes: 4096, maxCount: 2 }),
        pdf: yes({ maxPages: 100, maxBytes: 8192 }),
      },
      logprobs: yes({
        kind: 'topk',
        maxTopK: 20,
        dialect: 'chat',
        requiresEffortNone: true,
        minOutputTokens: 16,
      }),
      sampling: { temperature: yes(true), topP: yes(true), nativeCandidates: yes(2) },
      completion: yes({ mode: 'fim' }),
      hosted: { webSearch: yes({ tool: 'web_search' }) },
    })
    expect(resolved.identity).toEqual({ ...identity, servedVersion: 'v2' })
    expect(resolved.reasoning.replay).toEqual({
      envelope: 'anthropic-signed',
      prefixEditPolicy: 'drop',
    })
    expect(resolved.cache.ttls).toEqual(['5m', '1h'])
    expect(resolved.output.formats).toMatchObject({
      value: ['text', 'json_object', 'json_schema', 'strict_schema', 'forced_tool'],
    })
    expect(resolved.modalities.pdf).toMatchObject({ value: { maxPages: 100, maxBytes: 8192 } })
    expect(resolved.logprobs).toMatchObject({ value: { kind: 'topk', maxTopK: 20 } })
    expect(resolved.sampling.nativeCandidates).toMatchObject({ value: 2 })
    expect(resolved.completion).toMatchObject({ value: { mode: 'fim' } })
    expect(resolved.hosted.webSearch).toMatchObject({ value: { tool: 'web_search' } })
    expect(resolved.sources['cache.maxBreakpoints']).toEqual(source)
  })
  it('validates user overrides through providers.json and retains them on read', async () => {
    const overrides = {
      tools: { calling: { state: 'no' } },
      modalities: {
        image: {
          state: 'yes',
          value: { mimes: ['image/webp'], maxCount: 1 },
          source: { kind: 'capture', ref: 'spoofed' },
        },
      },
    }
    const file = providersFileSchema.parse({
      v: 1,
      providers: [
        {
          id: 'custom-id',
          preset: 'custom',
          auth: 'none',
          models: ['native'],
          modelLimits: { native: { contextTokens: 8192, outputTokens: 4096 } },
          modelCapabilities: { native: overrides },
        },
      ],
    })
    const loaded = await readProvidersFile('fixture', () => Promise.resolve(JSON.stringify(file)))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error('read failed')
    const override = loaded.file.providers[0]?.modelCapabilities?.['native']
    expect(override).toBeDefined()
    expect(override?.modalities?.image).toMatchObject({ source: { kind: 'user' } })
    const resolved = record(override)
    expect(resolved.tools.calling).toEqual({ state: 'no', source })
    expect(resolved.modalities.image).toMatchObject({
      source,
      value: { maxCount: 1, mimes: ['image/webp'] },
    })
    expect(() => record({ output: { maxTokens: -1 } })).toThrow()
    expect(() => record({ reasoning: { budget: { min: 8192, max: 1024 } } })).toThrow()
  })
  it('Meta constants preserve legacy policy', () => {
    const meta = metaCapabilityRecord('muse-spark-1.3')
    expect(meta.limits.contextTokens).toBe(1_048_576)
    expect(meta.output.maxTokens).toBe(131_072)
    expect(capabilityEffortLevels(metaCapabilityRecord('muse-spark-1.3-contributor'))).toEqual(
      capabilityEffortLevels(meta),
    )
    expect(capabilityEffortLevels(metaCapabilityRecord('muse-spark-1.2'))).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(meta.modalities.image).toMatchObject({
      value: { maxBytes: 10 * 1024 * 1024, maxCount: 50 },
    })
    expect(meta.modalities.pdf).toMatchObject({ value: { maxBytes: 32_000_000, maxPages: 50 } })
    expect(capabilityEffortLevels(meta)).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })
})

describe('native metadata and reasoning encoding', () => {
  it('Anthropic capture keeps per-model manual/adaptive, efforts, formats, media and limits', () => {
    const models = parseAnthropicModelsList({
      data: samples('anthropic', '01-models-list-x-api-key.json'),
    })
    expect(models).toHaveLength(3)
    const haiku = models[2]
    const resolved = resolveModelCapabilities(
      { ...identity, nativeModel: haiku?.id ?? '', format: 'anthropic' },
      [
        nativeCapabilityEvidence('anthropic', haiku?.native, {
          kind: 'models-list',
          ref: 'capture',
        }),
      ],
    )
    expect(resolved.reasoning.modes).toMatchObject({ value: ['manual'] })
    expect(resolved.reasoning.effortLevels.state).toBe('no')
    expect(resolved.output.maxTokens).toBe(64_000)
    expect(resolved.modalities.pdf.state).toBe('yes')
    const request = encodeAnthropicRequest(body, {
      model: haiku?.id ?? '',
      maxTokens: 4096,
      effort: 'high',
      capabilityRecord: resolved,
    })
    expect(request.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(request.body).not.toHaveProperty('output_config')
    expect(
      encodeAnthropicRequest(body, { model: 'claude-sonnet-5-5', maxTokens: 4096, effort: 'high' })
        .body,
    ).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
  })
  it('Haiku manual thinking replays signed blocks without unsupported binding fields', () => {
    const model = 'claude-haiku-4-5-20251001'
    const input: CreateResponseBody['input'] = [
      ...body.input,
      {
        type: 'reasoning',
        id: 'thinking',
        encrypted_content: JSON.stringify({
          v: 1,
          provider: 'anthropic',
          kind: 'thinking',
          model,
          thinking: 'Captured-shape fixture',
          signature: 'fixture-signature',
        }),
      },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Answer' }] },
    ]
    const request = encodeAnthropicRequest(
      { ...body, input },
      { model, maxTokens: 4096, effort: 'high' },
    )
    expect(request.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(request.headers).not.toHaveProperty('anthropic-beta')
    expect(request.body.messages[1]?.content).toEqual([
      { type: 'thinking', thinking: 'Captured-shape fixture', signature: 'fixture-signature' },
      { type: 'text', text: 'Answer', cache_control: { type: 'ephemeral', ttl: '5m' } },
    ])
  })

  it('Gemini retains version, thinking and sampling; 2.5 uses budget, 3.5 uses level', () => {
    const models = parseGeminiModelsList({ models: samples('gemini') })
    const native = models[0]?.native
    expect(native).toMatchObject({ version: '001', thinking: true, topP: 0.95, maxTemperature: 2 })
    const fields = nativeCapabilityEvidence('gemini', native, { kind: 'models-list' }).fields
    expect(fields.sampling).toMatchObject({ temperature: { state: 'yes' }, topP: { state: 'yes' } })
    expect(encodeGeminiRequest(body, 'gemini-2.5-flash').body['generationConfig']).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
    })
    expect(encodeGeminiRequest(body, 'gemini-3.5-flash-lite').body['generationConfig']).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
    })
  })
  it.each([
    'openai',
    'xai',
    'openrouter',
    'groq',
    'mistral',
    'deepseek',
    'together',
    'fireworks',
    'huggingface',
    'zai',
  ])('retains %s captured native rows', (provider) => {
    const entries = samples(
      provider,
      provider === 'xai' ? '02-language-models-list.json' : '01-models-list.json',
    )
    const parsed =
      provider === 'openai' || provider === 'xai'
        ? parseResponsesModelsList({ data: entries })
        : parseChatModelsList({ data: entries })
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed).toEqual(entries)
  })
  it('xAI and OpenRouter native effort order survives normalization', () => {
    const xai = parseResponsesModelsList({ models: samples('xai', '02-language-models-list.json') })
    expect(
      nativeCapabilityEvidence('xai', xai[2], { kind: 'models-list' }).fields.reasoning
        ?.effortLevels,
    ).toMatchObject({ value: ['none', 'low', 'medium', 'high', 'xhigh'] })
    const router = parseChatModelsList({ data: samples('openrouter') })
    expect(
      nativeCapabilityEvidence('openrouter', router[2], { kind: 'models-list' }).fields.reasoning,
    ).toMatchObject({
      forced: { state: 'yes' },
      effortLevels: { value: ['max', 'xhigh', 'high', 'medium', 'low'] },
    })
  })
  it('re-parses sealed catalogue efforts and partial budget bounds', () => {
    const entries = [
      ['openai', 'gpt-5.4', ['none', 'low', 'medium', 'high', 'xhigh']],
      ['anthropic', 'claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ] as const
    for (const [provider, id, expected] of entries) {
      expect(
        nativeCapabilityEvidence(provider, catalogueModel(provider, id), { kind: 'catalogue' })
          .fields.reasoning?.effortLevels,
      ).toMatchObject({ value: expected })
    }
    const fields = nativeCapabilityEvidence(
      'anthropic',
      { reasoning_options: [{ type: 'budget_tokens', min: 1024 }], reasoning: true },
      { kind: 'catalogue' },
    ).fields
    expect(record(fields).reasoning.budget).toEqual({ min: 1024 })
    expect(
      record({ reasoning: { replay: { prefixEditPolicy: 'keep' } } }).reasoning.replay,
    ).toEqual({ envelope: 'none', prefixEditPolicy: 'keep' })
  })
  it('Ollama tags retain details without claiming uncaptured support', () => {
    const rows = [
      { name: 'local', details: { family: 'qwen' }, model_info: { context_length: 8192 } },
    ]
    expect(parseOllamaModelsList({ models: rows })).toEqual(rows)
    expect(() => parseOllamaModelsList({ models: [{ name: 1 }] })).toThrow()
  })
})

describe('record-driven media', () => {
  it('PDF support is independent of image support; bytes/pages/MIME/count enforce admission', () => {
    const pdfOnly = record({
      modalities: { image: { state: 'no' }, pdf: yes({ maxPages: 2, maxBytes: 8192 }) },
    })
    const store = new AttachmentStore(() => 'attachment')
    expect(store.add('one.pdf', pdfFixture(1), true, false, pdfOnly).ok).toBe(true)
    expect(store.add('three.pdf', pdfFixture(3), true, false, pdfOnly).ok).toBe(false)
    const image = {
      type: 'input_image' as const,
      image_url: 'data:image/png;base64,AQ==',
      detail: 'auto' as const,
    }
    const pdf = {
      type: 'input_file' as const,
      filename: 'one.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from(pdfFixture(1)).toString('base64')}`,
    }
    const budget = new MediaBudget()
    const fitted = budget.fit([{ type: 'message', role: 'user', content: [image, pdf] }], pdfOnly)
    expect(fitted[0]).toMatchObject({ content: [{ type: 'input_text' }, pdf] })
    expect(
      budget.fit(
        [{ type: 'message', role: 'user', content: [image, image] }],
        record({ modalities: { image: yes({ mimes: ['image/png'], maxBytes: 1, maxCount: 1 }) } }),
      )[0],
    ).toMatchObject({ content: [{ type: 'input_text' }, image] })
    expect(
      budget.fit([{ type: 'message', role: 'user', content: [image] }], record())[0],
    ).toMatchObject({ content: [{ type: 'input_text' }] })
    expect(
      budget.fit(
        [{ type: 'message', role: 'user', content: [image] }],
        record({ modalities: { image: yes({ mimes: ['image/jpeg'] }) } }),
      )[0],
    ).toMatchObject({ content: [{ type: 'input_text' }] })
  })
})
