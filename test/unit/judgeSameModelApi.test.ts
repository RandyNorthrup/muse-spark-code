// Lane M98-S: the Model API host adapter (PLAN.md M98 acceptance items 1, 9,
// 10, 11). The side request is built from the host's own body with the prefix
// copied exactly; the main body is untouched; no model switch; redaction
// first; background calls settle the latch or drop late results; a "safe"
// answer changes nothing; results never touch the main session.

import { describe, expect, it, vi } from 'vitest'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  judgeAgain,
  judgeJob,
  judgeOnce,
  SpyJudgeStore,
  startJudgeEntry,
  untilJudgeSettled,
} from './helpers/judgeSameRig'
import {
  ModelApiSameJudge,
  type ModelApiJudgeDeps,
  type ModelApiJudgeSource,
  type ModelApiJudgeTransport,
  type ModelApiSideResponse,
} from '../../src/host/judge/modelApiSameJudge'
import type { JudgeEntryHandle } from '../../src/core/judge/entries'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import { redactSecrets } from '../../src/core/redact'

const MODEL = 'muse-spark-1.3-contributor'

function mainBody(): CreateResponseBody {
  return {
    model: MODEL,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Count the lines in notes.md' }],
      },
    ],
    instructions: 'Be helpful.',
    tools: [
      { type: 'function', name: 'read_file', description: 'x', parameters: {}, strict: false },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'minimal', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 8192,
    prompt_cache_key: 'muse-abc123',
    prompt_cache_retention: 'in_memory',
  }
}

interface Rig {
  readonly entries: SpyJudgeStore
  readonly cache: JudgeResultCache
  readonly errors: unknown[]
  readonly sent: CreateResponseBody[]
  readonly judge: ModelApiSameJudge
}

function setup(options: {
  readonly reply?: string | undefined
  readonly main?: CreateResponseBody | undefined
  readonly prefixTokens?: number | undefined
  readonly send?:
    ((body: CreateResponseBody, signal: AbortSignal) => Promise<ModelApiSideResponse>) | undefined
}): Rig {
  const entries = new SpyJudgeStore()
  const cache = new JudgeResultCache()
  const errors: unknown[] = []
  const sent: CreateResponseBody[] = []
  const main = options.main ?? mainBody()
  const source: ModelApiJudgeSource = {
    readMainBody: () => main,
    keyPrefix: () => 'muse-abc123',
    prefixTokens: () => options.prefixTokens ?? 4357,
  }
  const innerSend =
    options.send ??
    ((_body: CreateResponseBody, _signal: AbortSignal) =>
      Promise.resolve({
        text: options.reply ?? '{"answer":"yes","confidence":95}',
        inputTokens: 10,
        outputTokens: 5,
      }))
  const transport: ModelApiJudgeTransport = { send: innerSend }
  const sending = vi.fn(async (body: CreateResponseBody, signal: AbortSignal) => {
    sent.push(body)
    return await transport.send(body, signal)
  })
  const deps: ModelApiJudgeDeps = {
    source,
    transport: { send: sending },
    entries,
    cache,
    redact: (text) => redactSecrets(text),
    modelId: MODEL,
    timeoutMs: 2000,
    measureTokens: (text) => text.length,
    onError: (error) => {
      errors.push(error)
    },
  }
  return { entries, cache, errors, sent, judge: new ModelApiSameJudge(deps) }
}

function startKey(entries: SpyJudgeStore): JudgeEntryHandle {
  return startJudgeEntry(entries, {
    backend: 'model-api',
    turnId: 't1',
    tool: 'run_shell',
    args: { command: 'rm -rf /tmp/x' },
  })
}

const NOUL = { id: 'risk', kind: 'noul' as const, text: 'Is deleting this risky?' }

describe('ModelApiSameJudge', () => {
  it('sends the prefix exactly with the question at the tail and settles caution', async () => {
    const rig = setup({})
    const before = structuredClone(mainBody())
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'rm -rf /tmp/x', [NOUL]))).toBe(
      'caution',
    )
    expect(rig.sent).toHaveLength(1)
    const sent = rig.sent[0]
    if (sent === undefined) {
      throw new Error('no side request sent')
    }
    expect(sent.model).toBe(MODEL)
    expect(sent.input).toHaveLength(before.input.length + 1)
    expect(sent.input.slice(0, before.input.length)).toEqual(before.input)
    const { input: _dropped, ...rest } = sent
    const { input: _mainDropped, ...mainRest } = before
    expect(rest).toEqual(mainRest)
    expect(rig.cache.get(key.key)?.outcome).toBe('caution')
    expect(rig.errors).toEqual([])
  })

  it('settles none on a safe answer, changing no verdict', async () => {
    const rig = setup({ reply: '{"answer":"no","confidence":99}' })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'ls', [NOUL]))).toBe('none')
  })

  it('sends standalone when redaction changes the prefix', async () => {
    const main = mainBody()
    const secret = { ...main, instructions: 'key: LLM_abcdefghijklmnop' }
    const rig = setup({ main: secret })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('caution')
    const sent = rig.sent[0]
    if (sent === undefined) {
      throw new Error('no side request sent')
    }
    expect(sent.input).toHaveLength(1)
    expect(sent.instructions).toBe('')
    expect(sent.tools).toEqual([])
    expect(JSON.stringify(sent)).not.toContain('LLM_abcdefghijklmnop')
  })

  it('sends standalone below the cacheable minimum', async () => {
    const rig = setup({ prefixTokens: 10 })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    await untilJudgeSettled(rig.entries, key)
    expect(rig.sent[0]?.input).toHaveLength(1)
  })

  it('refuses a model switch without sending', async () => {
    const rig = setup({ main: { ...mainBody(), model: 'someone-else' } })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('failed')
    expect(rig.sent).toHaveLength(0)
    expect(rig.cache.get(key.key)).toBeUndefined()
  })

  it('drops a result that arrives after its fence', async () => {
    const gate = Promise.withResolvers<ModelApiSideResponse>()
    const release = gate.resolve
    const rig = setup({
      send: (_body, _signal) => gate.promise,
    })
    const key = startKey(rig.entries)
    await judgeAgain(rig.judge, judgeJob(key, 'x', [NOUL]))
    // The fence reads first and consumes the entry.
    expect(rig.entries.readLatch(key)).toBeUndefined()
    release({ text: '{"answer":"yes","confidence":95}', inputTokens: 1, outputTokens: 1 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rig.entries.settled).toEqual([])
    expect(rig.cache.get(key.key)).toBeUndefined()
  })

  it('settles a repeated action from the cache without sending', async () => {
    const rig = setup({})
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('caution')
    expect(rig.sent).toHaveLength(1)
    // The fence consumed the entry but the outcome stays cached.
    expect(rig.entries.readLatch(key)).toBe('caution')
    await judgeAgain(rig.judge, judgeJob(key, 'x', [NOUL]))
    expect(rig.sent).toHaveLength(1)
    expect(rig.entries.settled.filter((entry) => entry.key === key)).toHaveLength(1)
  })

  it('settles failed on an unparseable reply and caches nothing', async () => {
    const rig = setup({ reply: 'maybe, ask me again' })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('failed')
    expect(rig.cache.get(key.key)).toBeUndefined()
  })

  it('settles failed when the transport throws', async () => {
    const rig = setup({
      send: () => Promise.reject(new Error('network down')),
    })
    const key = startKey(rig.entries)
    expect(await judgeOnce(rig.judge, rig.entries, judgeJob(key, 'x', [NOUL]))).toBe('failed')
    expect(rig.errors).toHaveLength(1)
  })
})
