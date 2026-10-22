// M101-REPLAY-ORIGIN (lane I): replayed call ids resolve only against the
// model that produced them. The send rides the real providers file, the
// real catalogue load, the real record resolution and the real Responses
// encoder; only the socket outcome is injected, as a failure, and no
// request leaves the machine. The address is an IP literal, so no lookup
// runs either.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { noRetryBudget } from '../../src/core/backends/modelapi/transport'
import { restoredToolText } from '../../src/core/backends/modelapi/schemas'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { PROVIDERS_FILE_VERSION } from '../../src/shared/constants'

function callInput(callId: string, id: string): CreateResponseBody['input'] {
  return [
    {
      type: 'function_call',
      id,
      call_id: callId,
      name: 'read_file',
      arguments: '{"path":"a"}',
    },
    { type: 'function_call_output', call_id: callId, output: restoredToolText('ok') },
  ]
}

function turnBody(model: string, input: CreateResponseBody['input']): CreateResponseBody {
  return {
    model,
    input,
    instructions: 'You are a coding agent.',
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'medium', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 8192,
    prompt_cache_key: 'prefix-1',
    prompt_cache_retention: 'in_memory',
  }
}

describe('M101-REPLAY-ORIGIN over a real configured Responses entry', () => {
  it('keeps same-model replay ids and strips foreign ones at the wire', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'replay-origins-'))
    const configFile = path.join(directory, 'providers.json')
    const catalogFile = path.join(directory, 'catalog.json')
    writeFileSync(
      configFile,
      JSON.stringify({
        v: PROVIDERS_FILE_VERSION,
        providers: [
          {
            id: 'origins',
            preset: 'custom',
            address: 'https://8.8.8.8/v1',
            auth: 'none',
            format: 'responses',
            models: ['model-a', 'model-b'],
            modelLimits: {
              'model-a': { contextTokens: 128_000, outputTokens: 4096 },
              'model-b': { contextTokens: 128_000, outputTokens: 4096 },
            },
            modelCapabilities: {
              'model-a': { tools: { calling: { state: 'yes', value: true } } },
              'model-b': { tools: { calling: { state: 'yes', value: true } } },
            },
          },
        ],
      }),
    )
    writeFileSync(catalogFile, JSON.stringify({ providers: {} }))
    const captured: (string | undefined)[] = []
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile,
      secrets: { get: () => Promise.resolve(undefined) },
      send: (_target, body) => {
        captured.push(body)
        return Promise.reject(new Error('the injected socket failed after dispatch'))
      },
    })
    const registry = services.registry
    if (registry.list === undefined) throw new TypeError('Expected a listing registry')
    await registry.list()
    const resolved = await registry.resolve('origins/model-a')
    const stream = resolved.client.streamResponse(
      turnBody('origins/model-a', [
        ...callInput('call_same', 'fc_same'),
        ...callInput('call_old', 'fc_old'),
      ]),
      new AbortController().signal,
      undefined,
      noRetryBudget(),
      undefined,
      undefined,
      // As the host supplies it: producing refs, before wire translation.
      { call_same: 'origins/model-a', call_old: 'origins/model-b' },
    )
    await expect(stream.next()).rejects.toThrow()
    expect(captured).toHaveLength(1)
    const parsed: unknown = JSON.parse(captured[0] ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || !('input' in parsed))
      throw new TypeError('Expected a native request body')
    const sent = JSON.stringify(parsed.input)
    expect(sent).toContain('"id":"fc_same"')
    expect(sent).toContain('"call_id":"call_same"')
    expect(sent).not.toContain('"id":"fc_old"')
    expect(sent).toContain('"call_id":"call_old"')
  })
})
