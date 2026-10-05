// M101 lane A: request-only goal progress, stable local date and cache diagnostics.
import { describe, expect, it } from 'vitest'
import { FORMAT_QUIRKS, presetById, quirksOf } from '../../src/core/providers/presets'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { cacheMissTokens } from '../../src/core/backends/modelapi/promptCache'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { localPromptDate } from '../../src/core/backends/modelapi/instructions'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  responseOutputsByCall,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

async function setup(changes: Partial<ModelApiHostDeps> = {}, modelId = 'muse-spark-1.3') {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io, log }),
    ...changes,
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId,
    approvalMode: 'onRequest',
  })
  if (!(session instanceof ModelApiSession)) throw new TypeError('expected Model API session')
  const watch = watchSessionTurns(session)
  return { api, log, host, session, ...watch }
}

describe('M101 stable request prefix', () => {
  it('keeps goal progress outside instructions and key and never saves the suffix', async () => {
    const t = await setup()
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":1000}',
            callId: 'goal',
          },
        ],
      },
      {
        calls: [
          {
            name: 'report_progress',
            arguments: '{"percent_complete":50,"current_work":"Tests","next_work":"Docs"}',
            callId: 'progress',
          },
        ],
      },
      { calls: [{ name: 'update_goal', arguments: '{"status":"complete"}', callId: 'complete' }] },
      { text: 'Done.' },
    )
    await t.session.sendTurn([{ type: 'text', text: 'Set a goal and finish it.' }])
    await t.turnDone()
    const bodies = t.api.responseBodies()
    expect(bodies).toHaveLength(4)
    expect(bodies[1]?.['instructions']).toBe(bodies[2]?.['instructions'])
    expect(bodies[1]?.['prompt_cache_key']).toBe(bodies[2]?.['prompt_cache_key'])
    expect(bodies[1]?.['instructions']).not.toContain('Tokens used:')
    expect(bodies[1]?.['instructions']).not.toContain('- Progress:')
    expect(JSON.stringify(bodies[2]?.['input'])).toContain('- Current work: Tests')
    expect(JSON.stringify(bodies[2]?.['input'])).toContain('- Progress: 50%')
    expect(JSON.stringify(bodies[1]?.['input'])).not.toContain('- Current work: Tests')
    expect(JSON.stringify(bodies[3]?.['input'])).not.toContain('# Session goal progress')
    expect(bodies[0]?.['instructions']).toBe(bodies[3]?.['instructions'])
    expect(JSON.stringify(t.session.snapshot().replay)).not.toContain('# Session goal progress')
    expect(t.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('media fit changed replay length'),
    )
    await t.host.close()
  })

  it('uses the local date once and keeps it across midnight, resume and fork', async () => {
    let now = new Date(2026, 9, 4, 23, 59).getTime()
    const t = await setup({ now: () => now })
    t.api.script({ text: 'First.' }, { text: 'Second.' })
    await t.session.sendTurn([{ type: 'text', text: 'Hello.' }])
    await t.turnDone()
    now = new Date(2026, 9, 5, 1).getTime()
    await t.session.sendTurn([{ type: 'text', text: 'Again.' }])
    await t.turnDone()
    const bodies = t.api.responseBodies()
    expect(bodies[0]?.['instructions']).toContain("Today's date: 2026-10-04")
    expect(bodies[1]?.['instructions']).toBe(bodies[0]?.['instructions'])
    expect(bodies[1]?.['prompt_cache_key']).toBe(bodies[0]?.['prompt_cache_key'])
    const stored = parseStoredSession(t.session.snapshot())
    if (!stored.ok) throw new Error(stored.reason)
    expect(stored.session.promptDate).toBe('2026-10-04')
    const resumed = await setup({ now: () => now })
    resumed.session.adopt(stored.session)
    resumed.api.script({ text: 'Resumed.' })
    await resumed.session.sendTurn([{ type: 'text', text: 'Continue.' }])
    await resumed.turnDone()
    expect(resumed.api.responseBodies()[0]?.['instructions']).toBe(bodies[0]?.['instructions'])
    const fork = await setup({ now: () => now })
    t.session.copyInto(fork.session, undefined)
    expect(fork.session.snapshot().promptDate).toBe('2026-10-04')
    await Promise.all([t.host.close(), resumed.host.close(), fork.host.close()])
  })

  it('reads calendar fields instead of the UTC date', () => {
    const now = new Date(2026, 9, 4, 23, 59).getTime()
    expect(localPromptDate(now)).toBe('2026-10-04')
  })
})

const PROVIDERS = [
  'meta',
  'openai',
  'xai',
  'azure',
  'anthropic',
  'gemini',
  'openrouter',
  'ollama',
  'lmstudio',
  'custom',
] as const

function factsFor(provider: string, isToolCalling = true) {
  const preset = presetById(provider)
  if (provider !== 'meta' && preset === undefined) throw new Error(`missing preset ${provider}`)
  return {
    capabilities: { ...CONSERVATIVE_CAPABILITIES, toolCalling: isToolCalling },
    quirks: preset === undefined ? FORMAT_QUIRKS.responses : quirksOf(preset),
  }
}

describe('M101 model capability records', () => {
  it.each(PROVIDERS)(
    '%s gates recall declaration and projection on toolCalling',
    async (provider) => {
      const modelId = provider === 'meta' ? 'muse-spark-1.3' : `${provider}/fixture`
      for (const isOn of [true, false]) {
        const facts = factsFor(provider, isOn)
        const t = await setup(
          {
            observationPacking: () => true,
            modelFacts: (selected) => {
              expect(selected).toBe(modelId)
              return facts
            },
            io: memoryToolIo(
              {
                'big.txt': Array.from(
                  { length: 400 },
                  (_, index) => `line ${String(index)} ${'x'.repeat(24)}`,
                ).join('\n'),
              },
              '/ws',
            ),
          },
          modelId,
        )
        t.api.script(
          { calls: [{ name: 'read_file', arguments: '{"path":"big.txt"}', callId: 'big' }] },
          { text: 'Read.' },
          { text: 'Again.' },
          { text: 'Packed.' },
        )
        for (const text of ['read it', 'again', 'again']) {
          await t.session.sendTurn([{ type: 'text', text }])
          await t.turnDone()
        }
        const bodies = t.api.responseBodies()
        for (const body of bodies) {
          expect(JSON.stringify(body['tools']).includes('recall_output')).toBe(isOn)
        }
        expect(JSON.stringify(bodies.at(-1)?.['input']).includes('Packed output')).toBe(isOn)
        expect(new Set(bodies.map((body) => JSON.stringify(body['tools']))).size).toBe(1)
        await t.host.close()
      }
    },
  )

  it.each(PROVIDERS)(
    '%s enables cache diagnostics exactly when cachedUsageFields is non-empty',
    async (provider) => {
      const facts = factsFor(provider)
      const t = await setup(
        { modelFacts: () => facts },
        provider === 'meta' ? 'muse-spark-1.3' : `${provider}/fixture`,
      )
      t.api.script(
        { text: 'First.', usage: { input: 4096, output: 1, cached: 0 } },
        { text: 'Miss.', usage: { input: 3072, output: 1, cached: 2047 } },
        { text: 'Threshold.', usage: { input: 3072, output: 1, cached: 2048 } },
      )
      for (const text of ['first', 'second', 'third']) {
        await t.session.sendTurn([{ type: 'text', text }])
        await t.turnDone()
      }
      const isCacheUsageReported = facts.quirks.cachedUsageFields.length > 0
      expect(t.log.warn.mock.calls).toEqual(
        isCacheUsageReported ? [[fill(UI_TEXT.promptCacheMiss, { tokens: 1025 })]] : [],
      )
      expect(t.api.responseBodies()).toHaveLength(3)
      expect(JSON.stringify(t.api.responseBodies())).not.toContain(UI_TEXT.promptCacheMiss)
      expect(t.session.snapshot().usage).toEqual({
        inputTokens: 10_240,
        outputTokens: 3,
        cachedTokens: 4095,
        reasoningTokens: 3,
      })
      await t.host.close()
    },
  )

  it('refuses recall execution when the selected model cannot call tools', async () => {
    const t = await setup({
      observationPacking: () => true,
      modelFacts: () => factsFor('openai', false),
    })
    t.api.script(
      { calls: [{ name: 'recall_output', arguments: '{"id":"missing"}', callId: 'uninvited' }] },
      { text: 'Refused.' },
    )
    await t.session.sendTurn([{ type: 'text', text: 'Recall uninvited.' }])
    await t.turnDone()
    expect(responseOutputsByCall(t.api, 1).get('uninvited')).toContain('unknown tool recall_output')
    await t.host.close()
  })

  it('fails closed for missing BYO facts and leaves its bytes identical with packing off', async () => {
    const model = 'custom/unknown'
    const on = await setup({ observationPacking: () => true }, model)
    const off = await setup({}, model)
    for (const t of [on, off]) {
      t.api.script({ text: 'Same.' })
      await t.session.sendTurn([{ type: 'text', text: 'Same.' }])
      await t.turnDone()
    }
    expect(on.api.responseBodies()).toEqual(off.api.responseBodies())
    await Promise.all([on.host.close(), off.host.close()])
  })

  it('starts a new cache comparison after a model switch', async () => {
    const t = await setup({ modelFacts: () => factsFor('openai') })
    t.api.script({ text: 'First.', usage: { input: 4096, output: 1 } })
    await t.session.sendTurn([{ type: 'text', text: 'First.' }])
    await t.turnDone()
    await t.session.setModel('muse-spark-1.2')
    t.api.script({ text: 'Different.', usage: { input: 4096, output: 1 } })
    await t.session.sendTurn([{ type: 'text', text: 'Second.' }])
    await t.turnDone()
    expect(t.log.warn).not.toHaveBeenCalled()
    await t.host.close()
  })

  it('reports cache misses only in the log, with identical request bytes and usage', async () => {
    const on = await setup({ modelFacts: () => factsFor('openai') })
    const off = await setup({
      modelFacts: () => ({
        ...factsFor('openai'),
        quirks: { ...factsFor('openai').quirks, cachedUsageFields: [] },
      }),
    })
    for (const t of [on, off]) {
      t.api.script(
        { text: 'First.', usage: { input: 4096, output: 1 } },
        { text: 'Second.', usage: { input: 4096, output: 1 } },
      )
      for (const text of ['first', 'second']) {
        await t.session.sendTurn([{ type: 'text', text }])
        await t.turnDone()
      }
    }
    expect(on.api.responseBodies()).toEqual(off.api.responseBodies())
    expect(on.session.snapshot().usage).toEqual(off.session.snapshot().usage)
    expect(on.session.history()).toEqual(off.session.history())
    expect(on.log.warn).toHaveBeenCalledOnce()
    expect(off.log.warn).not.toHaveBeenCalled()
    await Promise.all([on.host.close(), off.host.close()])
  })

  it('uses the smaller context, has no first report, and uses a strict 1024-token threshold', () => {
    const fields = ['cached_tokens']
    expect(cacheMissTokens(undefined, 10_000, 0, fields)).toBeUndefined()
    expect(cacheMissTokens(10_000, 1024, 0, fields)).toBeUndefined()
    expect(cacheMissTokens(1025, 10_000, 0, fields)).toBe(1025)
    expect(cacheMissTokens(10_000, 1025, 0, fields)).toBe(1025)
    expect(cacheMissTokens(10_000, 10_000, 0, [])).toBeUndefined()
    expect(cacheMissTokens(10_000, 10_000, 10_000, fields)).toBeUndefined()
  })
})
