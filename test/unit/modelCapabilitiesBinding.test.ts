import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  metaArgumentPreviewCapabilities,
  metaModelFacts,
  metaOutputMaxTokens,
} from '../../src/core/backends/modelapi/modelCapabilities'
import {
  metaResolvedModel,
  modelPolicyFor,
  type ModelPolicy,
} from '../../src/core/backends/modelapi/modelPolicy'
import {
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  M106_CAPTURED_META_MODEL,
} from '../../src/shared/constants'
import {
  restoreOptionalToolArguments,
  withStrictTools,
  type FunctionToolDefinition,
} from '../../src/core/backends/modelapi/schemas'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { FORMAT_QUIRKS } from '../../src/core/providers/presets'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  responseOutputsByCall,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'

async function harness(isStrict: boolean | undefined) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'a.txt': 'one\ntwo\n' }, '/ws')
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, workspaceRoot: '/ws', log }),
    modelFacts: () => ({
      capabilities: { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: isStrict },
      quirks: FORMAT_QUIRKS.responses,
    }),
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  return { api, host, session, ...watchSessionTurns(session) }
}

it('binds the owner-confirmed Meta capability only to the named Meta records', () => {
  expect(metaModelFacts('muse-spark-1.3')?.capabilities.supportsStrictTools).toBe(true)
  expect(metaModelFacts('muse-spark-1.3-contributor')?.capabilities.supportsStrictTools).toBe(true)
  expect(metaModelFacts('custom/muse-spark-1.3')).toBeUndefined()
  expect(metaModelFacts('future-model')).toBeUndefined()
})

it('streams argument previews only on the U9-captured contributor model', () => {
  expect(metaArgumentPreviewCapabilities(M106_CAPTURED_META_MODEL)).toEqual({
    tools: { streamingArguments: { state: 'yes', value: true } },
  })
  expect(metaArgumentPreviewCapabilities('muse-spark-1.3')).toBeUndefined()
  expect(metaArgumentPreviewCapabilities('muse-spark-1.2')).toBeUndefined()
  expect(metaArgumentPreviewCapabilities('custom/muse-spark-1.3')).toBeUndefined()
  expect(metaArgumentPreviewCapabilities('future-model')).toBeUndefined()
})

it('requests the documented Meta output cap for bare Muse Spark models only', () => {
  expect(metaOutputMaxTokens('muse-spark-1.3')).toBe(MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS)
  expect(metaOutputMaxTokens(M106_CAPTURED_META_MODEL)).toBe(
    MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  )
  expect(metaOutputMaxTokens('custom/muse-spark-1.3')).toBeUndefined()
  expect(metaOutputMaxTokens('future-model')).toBeUndefined()
})

it.each([true, false, undefined])(
  'builds tools from the selected capability before cache-key generation (%s)',
  async (enabled) => {
    const shouldUseStrict = enabled === true
    const h = await harness(enabled)
    try {
      h.api.script({ text: 'done' })
      await h.session.sendTurn([{ type: 'text', text: 'hello' }])
      await h.turnDone()
      const body = z
        .object({
          tools: z.array(z.object({ type: z.string(), strict: z.optional(z.boolean()) })),
          prompt_cache_key: z.optional(z.string()),
        })
        .parse(h.api.responseBodies()[0])
      expect(
        body.tools
          .filter((tool) => tool.type === 'function')
          .every((tool) => tool.strict === shouldUseStrict),
      ).toBe(true)
      expect(body.prompt_cache_key).toBeTruthy()
      h.api.script({ text: 'again' })
      await h.session.sendTurn([{ type: 'text', text: 'again' }])
      await h.turnDone()
      expect(h.api.responseBodies()[1]?.['prompt_cache_key']).toBe(body.prompt_cache_key)
    } finally {
      await h.host.close()
    }
  },
)

describe('resolved-record cap ordering (RVCM1062C P2)', () => {
  it('compacts a forked qualified model before any switch at its resolved cap', async () => {
    // The entry stash (src/host/backend/modelApiEntry.ts) starts empty
    // and fills only as the resolver runs. A fork copies history but
    // resolves nothing, so its compaction is the first request on the
    // qualified record — built before the stash fills. It must bind the
    // resolved record's maximum (65536), never the legacy 32768 it would
    // compute and cache first, and neither may any later turn.
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({ 'a.txt': 'one\ntwo\n' }, '/ws')
    const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
    const ref = 'team/small'
    const policy = modelPolicyFor(ref, {
      capabilities: { toolCalling: true },
      maxOutputTokens: 65_536,
      effortLevels: ['none', 'minimal', 'low', 'medium', 'high'],
    })
    const stashed = new Map<string, ModelPolicy>()
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, workspaceRoot: '/ws', log }),
      models: {
        resolve: (name: string) => {
          if (name !== ref) return Promise.resolve(metaResolvedModel(name, client))
          const resolved = { ...metaResolvedModel(name, client), policy }
          stashed.set(name, resolved.policy)
          return Promise.resolve(resolved)
        },
      },
      modelOutputMaxTokens: (modelId: string) =>
        stashed.get(modelId)?.output.maxTokens ?? metaOutputMaxTokens(modelId),
    })
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    if (!(session instanceof ModelApiSession)) throw new TypeError('expected a Model API session')
    const watched = watchSessionTurns(session)
    try {
      // One bare-model turn seeds history; bare ids never reach the
      // resolver, so the stash stays empty.
      api.script({ text: 'done' })
      await session.sendTurn([{ type: 'text', text: 'hello' }])
      await watched.turnDone()
      expect(stashed.size).toBe(0)
      const fork = await host.forkSession(session.sessionId, ref)
      if (!(fork.session instanceof ModelApiSession))
        throw new TypeError('expected a Model API session')
      api.script({ text: 'Fork summary' })
      await expect(fork.session.compact()).resolves.toMatchObject({ status: 'accepted' })
      expect(stashed.get(ref)?.output.maxTokens).toBe(65_536)
      // The compaction POST itself was built from the resolved record:
      // its reasoning effort is the record's, not the unresolved
      // fallback's `none`. (Its maximum is the summary budget either way.)
      const compactionBody = api.responseBodies()[1]
      expect(compactionBody?.['reasoning']).toMatchObject({ effort: 'high' })
      const forkWatched = watchSessionTurns(fork.session)
      api.script({ text: 'done' })
      await fork.session.sendTurn([{ type: 'text', text: 'hello again' }])
      await forkWatched.turnDone()
      const bodies = api.responseBodies()
      expect(bodies.length).toBeGreaterThan(0)
      expect(bodies.at(-1)?.['max_output_tokens']).toBe(65_536)
    } finally {
      await host.close()
    }
  })
})

it('executes strict nullable optional arguments through the existing tool parser', async () => {
  const h = await harness(true)
  try {
    h.api.script(
      {
        calls: [
          {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'a.txt', offset: null, limit: null }),
            callId: 'read',
          },
        ],
      },
      { text: 'done' },
    )
    await h.session.sendTurn([{ type: 'text', text: 'read a.txt' }])
    await h.turnDone()
    expect(responseOutputsByCall(h.api, 1).get('read')).toContain('1|one')
  } finally {
    await h.host.close()
  }
})

describe('optional-null restoration', () => {
  const tool: FunctionToolDefinition = {
    type: 'function',
    name: 'test',
    description: 'test',
    strict: false,
    parameters: {
      type: 'object',
      properties: {
        required: { type: 'string' },
        optional: { type: 'string' },
        nullable: { type: ['string', 'null'] },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { find: { type: 'string' }, extra: { type: 'string' } },
            required: ['find'],
          },
        },
      },
      required: ['required'],
    },
  }
  it('restores only synthesized optional nulls, including nested array objects', () => {
    expect(
      JSON.parse(
        restoreOptionalToolArguments(
          JSON.stringify({
            required: null,
            optional: null,
            nullable: null,
            edits: [{ find: 'x', extra: null }],
          }),
          tool,
        ),
      ),
    ).toEqual({ required: null, nullable: null, edits: [{ find: 'x' }] })
    expect(restoreOptionalToolArguments('malformed', tool)).toBe('malformed')
    expect(restoreOptionalToolArguments('42', tool)).toBe('42')
  })
})

describe('strict array bounds', () => {
  const tool: FunctionToolDefinition = {
    type: 'function',
    name: 'test',
    description: 'test',
    strict: false,
    parameters: {
      type: 'object',
      properties: {
        actions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
      },
    },
  }
  it('preserves array admission bounds while making optional arrays nullable', () => {
    expect(withStrictTools([tool], true)[0]).toMatchObject({
      strict: true,
      parameters: {
        properties: {
          actions: { type: ['array', 'null'], minItems: 1, maxItems: 2 },
        },
      },
    })
  })
  it.each([
    { type: 'array', maxItems: -1 },
    { type: 'array', minItems: 0.5 },
    { type: 'array', maxItems: '3' },
    { type: 'array', minItems: 2, maxItems: 1 },
    { type: 'string', maxItems: 1 },
  ])('refuses malformed array bounds (%j)', (bounds) => {
    const parameters = {
      ...tool.parameters,
      properties: { actions: { items: { type: 'string' }, ...bounds } },
    }
    expect(() => withStrictTools([{ ...tool, parameters }], true)).toThrow(
      'strict_tool_schema_unsupported',
    )
  })
})
