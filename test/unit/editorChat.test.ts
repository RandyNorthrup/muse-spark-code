// Editor chat's pure core (M95c part 2): conversion, limits, rates,
// reasoning effort and grant evidence, driven without the `vscode`
// import. The models are real resolutions: a providers file plus an
// empty catalogue in a temp folder through the real configured
// registry (resolve never leaves the machine; the injected socket
// fails the suite if a request is ever sent). The wire values are
// arbitrary sentinels: the module compares them by identity only, and
// the real enums flow from the provider, covered through the
// integration suite. The long-context tier renders from the recorded
// xAI list capture (2026-10-04); the Meta thinking-off value needs the
// Meta backend and stays integration-covered.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import {
  EditorChatRefusalError,
  editorChatBody,
  editorChatConfirmationEvidence,
  editorChatLimits,
  editorChatRates,
  editorChatReasoningEffort,
  type EditorChatWireValues,
} from '../../src/core/providers/editorChat'
import type { ResolvedModel } from '../../src/core/backends/modelapi/modelPolicy'
import { listedPriceCard, type ModelPricing } from '../../src/core/providers/priceCard'
import {
  ANTHROPIC_MAX_IMAGE_BYTES,
  MODEL_API_PRICED_MODELS,
  PROVIDERS_FILE_VERSION,
  UI_TEXT,
} from '../../src/shared/constants'
import capture from '../../docs/certification/m95-captures/xai/01-models-list.json'

/** Arbitrary role and tool-mode tokens: compared by identity, never interpreted. */
const WIRE: EditorChatWireValues = {
  userRole: 101,
  assistantRole: 102,
  autoToolMode: 201,
  requiredToolMode: 202,
}

const LOCAL_REF = 'probe-custom/custom-model'
const PRICED_REF = 'probe-priced/priced-model'
const UNPRICED_REF = 'probe-keyed/keyed-model'
const OFFABLE_REF = 'probe-offable/offable-model'

function toolsOnly(model: string) {
  return { [model]: { tools: { calling: { state: 'yes', value: true } } } }
}

function writeProvidersFile(directory: string): { configFile: string; catalogFile: string } {
  const configFile = path.join(directory, 'providers.json')
  const catalogFile = path.join(directory, 'catalog.json')
  writeFileSync(
    configFile,
    JSON.stringify({
      v: PROVIDERS_FILE_VERSION,
      providers: [
        {
          id: 'probe-custom',
          preset: 'custom',
          address: 'https://8.8.8.8/v1',
          auth: 'none',
          format: 'responses',
          models: ['custom-model'],
          modelLimits: { 'custom-model': { contextTokens: 4096, outputTokens: 512 } },
          modelCapabilities: toolsOnly('custom-model'),
        },
        {
          id: 'probe-keyed',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'apiKey',
          format: 'responses',
          models: ['keyed-model'],
          modelLimits: { 'keyed-model': { contextTokens: 4096, outputTokens: 512 } },
          modelCapabilities: toolsOnly('keyed-model'),
        },
        {
          id: 'probe-priced',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'apiKey',
          format: 'responses',
          models: ['priced-model'],
          modelLimits: { 'priced-model': { contextTokens: 16_384, outputTokens: 2048 } },
          modelCapabilities: {
            'priced-model': {
              tools: { calling: { state: 'yes', value: true } },
              reasoning: {
                supported: { state: 'yes', value: true },
                effortLevels: { state: 'yes', value: ['low', 'medium', 'high'] },
                canDisable: { state: 'no' },
              },
              modalities: { image: { state: 'yes', value: { mimes: ['image/png'] } } },
            },
          },
          prices: {
            'priced-model': { input: 0.000001, output: 0.000004, request: 0.01, image: 0.05 },
          },
        },
        {
          id: 'probe-offable',
          preset: 'custom',
          address: 'https://8.8.4.4/v1',
          auth: 'none',
          format: 'responses',
          models: ['offable-model'],
          modelLimits: { 'offable-model': { contextTokens: 8192, outputTokens: 1024 } },
          modelCapabilities: {
            'offable-model': {
              tools: { calling: { state: 'yes', value: true } },
              reasoning: {
                supported: { state: 'yes', value: true },
                effortLevels: { state: 'yes', value: ['none', 'low'] },
                canDisable: { state: 'yes', value: true },
              },
            },
          },
        },
      ],
    }),
  )
  writeFileSync(catalogFile, JSON.stringify({ providers: {} }))
  return { configFile, catalogFile }
}

interface EditorChatRig {
  readonly directory: string
  readonly local: ResolvedModel
  readonly priced: ResolvedModel
  readonly unpriced: ResolvedModel
  readonly offable: ResolvedModel
}

const rig: { current?: EditorChatRig } = {}

function useRig(): EditorChatRig {
  const current = rig.current
  if (current === undefined) throw new Error('the editor-chat rig is not ready')
  return current
}

beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'editor-chat-core-'))
  const { configFile, catalogFile } = writeProvidersFile(directory)
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile,
    secrets: { get: () => Promise.resolve(undefined) },
    send: () => Promise.reject(new Error('no request may leave the machine')),
  })
  rig.current = {
    directory,
    local: await services.registry.resolve(LOCAL_REF),
    priced: await services.registry.resolve(PRICED_REF),
    unpriced: await services.registry.resolve(UNPRICED_REF),
    offable: await services.registry.resolve(OFFABLE_REF),
  }
})

afterAll(() => {
  const current = rig.current
  if (current !== undefined) rmSync(current.directory, { recursive: true, force: true })
})

/** The typed refusal with the fixed sentence, and nothing else. */
function expectRefusal(work: () => unknown): void {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(EditorChatRefusalError)
    if (error instanceof EditorChatRefusalError)
      expect(error.message).toEqual(UI_TEXT.editorChatRefused)
    return
  }
  throw new Error('expected the fixed refusal')
}

describe('editor chat limits', () => {
  it('reads the resolved windows', () => {
    expect(editorChatLimits(useRig().local)).toEqual({ input: 4096, output: 512 })
    expect(editorChatLimits(useRig().priced)).toEqual({ input: 16_384, output: 2048 })
  })

  it('refuses an unknown window and a zero bound', () => {
    expectRefusal(() => editorChatLimits({ ...useRig().local, contextTokens: undefined }))
    expectRefusal(() =>
      editorChatLimits({
        ...useRig().local,
        policy: {
          ...useRig().local.policy,
          output: { ...useRig().local.policy.output, maxTokens: 0 },
        },
      }),
    )
  })
})

describe('editor chat body', () => {
  it('converts a text turn with a tool into the request body', () => {
    expect(
      editorChatBody(
        LOCAL_REF,
        [
          { role: WIRE.userRole, content: [{ value: 'hi' }] },
          { role: WIRE.assistantRole, content: [{ value: 'hello' }] },
        ],
        {
          tools: [
            {
              name: 'read_file',
              description: 'reads a file',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            },
          ],
          toolMode: WIRE.autoToolMode,
          modelOptions: {},
        },
        512,
        'none',
        4096,
        WIRE,
      ),
    ).toEqual({
      model: LOCAL_REF,
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      ],
      instructions: '',
      tools: [
        {
          type: 'function',
          name: 'read_file',
          description: 'reads a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
          strict: false,
        },
      ],
      tool_choice: 'auto',
      reasoning: { effort: 'none' },
      stream: true,
      store: false,
      include: [],
      prompt_cache_key: '',
      prompt_cache_retention: 'in_memory',
      max_output_tokens: 512,
    })
  })

  it('carries calls and their outputs with typed items', () => {
    const body = editorChatBody(
      LOCAL_REF,
      [
        {
          role: WIRE.assistantRole,
          content: [{ callId: 'c1', name: 'read_file', input: { path: 'a' } }],
        },
        { role: WIRE.userRole, content: [{ callId: 'c1', content: [{ value: 'ok' }] }] },
      ],
      {},
      512,
      'none',
      4096,
      WIRE,
    )
    expect(body.input).toEqual([
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'ok' },
    ])
    expect(body.tools).toEqual([])
  })

  it('sends a small picture as a data URL', () => {
    // A bare id is Meta's (`meta/` never parses: the provider id is reserved).
    const body = editorChatBody(
      MODEL_API_PRICED_MODELS.standard[0],
      [
        {
          role: WIRE.userRole,
          content: [{ mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
        },
      ],
      {},
      512,
      'none',
      4096,
      WIRE,
    )
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,AQID', detail: 'auto' }],
      },
    ])
  })

  it('refuses misrouted parts, oversized pictures and malformed turns', () => {
    const userText = [{ role: WIRE.userRole, content: [{ value: 'hi' }] }]
    // A picture from the assistant, and one past Anthropic's documented bound.
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        [
          {
            role: WIRE.assistantRole,
            content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }],
          },
        ],
        {},
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    expectRefusal(() =>
      editorChatBody(
        'anthropic/claude-sonnet-4-5',
        [
          {
            role: WIRE.userRole,
            content: [
              { mimeType: 'image/png', data: new Uint8Array(ANTHROPIC_MAX_IMAGE_BYTES + 1) },
            ],
          },
        ],
        {},
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    // A call from the user, and a result from the assistant.
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        [
          {
            role: WIRE.userRole,
            content: [{ callId: 'c1', name: 'read_file', input: { path: 'a' } }],
          },
        ],
        {},
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        [
          {
            role: WIRE.assistantRole,
            content: [{ callId: 'c1', content: [{ value: 'ok' }] }],
          },
        ],
        {},
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    // A required tool mode parses and is still refused; a malformed turn,
    // an unparsable ref and mistyped model options never reach conversion.
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        userText,
        { toolMode: WIRE.requiredToolMode },
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        [{ role: WIRE.userRole, content: 'nope' }],
        {},
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    expectRefusal(() => editorChatBody('meta/', userText, {}, 512, 'none', 4096, WIRE))
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        userText,
        { modelOptions: { reasoningEffort: 42 } },
        512,
        'none',
        4096,
        WIRE,
      ),
    )
    // Tool text past its window share fails loudly instead of riding
    // unbounded into a paid call.
    expectRefusal(() =>
      editorChatBody(
        LOCAL_REF,
        [
          {
            role: WIRE.userRole,
            content: [{ callId: 'c1', content: [{ value: 'x'.repeat(100_000) }] }],
          },
        ],
        {},
        512,
        'none',
        1000,
        WIRE,
      ),
    )
  })
})

describe('editor chat reasoning effort', () => {
  it('runs models without reasoning support on none', () => {
    expect(editorChatReasoningEffort(useRig().local, {}, WIRE)).toEqual('none')
    expect(
      editorChatReasoningEffort(
        useRig().local,
        { modelOptions: { reasoningEffort: 'none' } },
        WIRE,
      ),
    ).toEqual('none')
    expectRefusal(() =>
      editorChatReasoningEffort(
        useRig().local,
        { modelOptions: { reasoningEffort: 'high' } },
        WIRE,
      ),
    )
  })

  it('picks the default and explicit levels of a reasoning model', () => {
    expect(editorChatReasoningEffort(useRig().priced, {}, WIRE)).toEqual('low')
    expect(
      editorChatReasoningEffort(
        useRig().priced,
        { modelOptions: { reasoningEffort: 'high' } },
        WIRE,
      ),
    ).toEqual('high')
    expectRefusal(() =>
      editorChatReasoningEffort(
        useRig().priced,
        { modelOptions: { reasoningEffort: 'ultra' } },
        WIRE,
      ),
    )
    expectRefusal(() =>
      editorChatReasoningEffort(
        useRig().priced,
        { modelOptions: { reasoningEffort: 'none' } },
        WIRE,
      ),
    )
  })

  it('runs off where the record allows it', () => {
    expect(editorChatReasoningEffort(useRig().offable, {}, WIRE)).toEqual('none')
    expect(
      editorChatReasoningEffort(
        useRig().offable,
        { modelOptions: { reasoningEffort: 'none' } },
        WIRE,
      ),
    ).toEqual('none')
    expect(
      editorChatReasoningEffort(
        useRig().offable,
        { modelOptions: { reasoningEffort: 'low' } },
        WIRE,
      ),
    ).toEqual('low')
  })
})

describe('editor chat rates', () => {
  it('names the local price in words', () => {
    expect(editorChatRates(useRig().local)).toEqual(UI_TEXT.modelLocal)
  })

  it('refuses an unpriced model', () => {
    expectRefusal(() => editorChatRates(useRig().unpriced))
  })

  it('renders the priced card per million with fees', () => {
    expect(editorChatRates(useRig().priced)).toEqual(
      [
        '$1.00 input / $4.00 output (including reasoning) per million tokens; $1.00 cache read / $1.00 cache write / $1.00 1-hour cache write per million tokens',
        '$0.01 per request / $0.05 per image',
      ].join('\n'),
    )
  })

  it('renders the captured long-context tier', () => {
    const samples: unknown = capture.response.bodySummary.sample
    if (!Array.isArray(samples) || samples.length === 0)
      throw new Error('the xai capture lost its models sample')
    const first: unknown = samples[0]
    if (typeof first !== 'object' || first === null)
      throw new Error('the xai capture lost its first sample')
    const native: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(first)) native[key] = value
    const card = listedPriceCard('xai', native)
    if (card?.longContextTier === undefined) throw new Error('the xai sample lost its tier')
    const pricing: ModelPricing = { kind: 'priced', card }
    const tiered: ResolvedModel = {
      ...useRig().priced,
      policy: { ...useRig().priced.policy, pricing },
    }
    expect(editorChatRates(tiered)).toEqual(
      [
        '$1.25 input / $2.50 output (including reasoning) per million tokens; $0.20 cache read / $1.25 cache write / $1.25 1-hour cache write per million tokens',
        '$0.00 per request / $0.00 per image',
        'From 200,000 input tokens: $2.50 input / $5.00 output (including reasoning) per million tokens; $0.40 cache read / $2.50 cache write / $2.50 1-hour cache write per million tokens',
      ].join('\n'),
    )
  })
})

describe('editor chat evidence', () => {
  it('binds the grant to model, origin and pricing', () => {
    expect(JSON.parse(editorChatConfirmationEvidence(useRig().priced))).toEqual({
      model: PRICED_REF,
      origin: 'https://8.8.4.4',
      pricing: useRig().priced.policy.pricing,
    })
  })
})
