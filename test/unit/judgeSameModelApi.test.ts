// Lane M98-S: the Model API host adapter (PLAN.md M98 acceptance items 1, 9,
// 10, 11). The side request is built from the host's own body with the prefix
// copied exactly; the main body is untouched; no model switch; redaction
// first; background calls settle the latch or drop late results; a "safe"
// answer changes nothing; results never touch the main session.

import { describe, expect, it, vi } from 'vitest'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { JudgeEntryStore } from '../../src/core/judge/entries'
import { ModelApiSameJudge, type ModelApiJudgeDeps } from '../../src/host/judge/modelApiSameJudge'
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

class SpyStore extends JudgeEntryStore {
  public readonly settled: { key: string; outcome: string }[] = []
  public override settle(key: string, outcome: 'caution' | 'none' | 'failed'): boolean {
    const wasApplied = super.settle(key, outcome)
    if (wasApplied) {
      this.settled.push({ key, outcome })
    }
    return wasApplied
  }
}

interface Rig {
  readonly entries: SpyStore
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
    | ((
        body: CreateResponseBody,
        signal: AbortSignal,
      ) => Promise<{ text: string; inputTokens: number; outputTokens: number }>)
    | undefined
}): Rig {
  const entries = new SpyStore()
  const cache = new JudgeResultCache()
  const errors: unknown[] = []
  const sent: CreateResponseBody[] = []
  const main = options.main ?? mainBody()
  const transport =
    options.send ??
    vi.fn((_body: CreateResponseBody, _signal: AbortSignal) =>
      Promise.resolve({
        text: options.reply ?? '{"answer":"yes","confidence":95}',
        inputTokens: 10,
        outputTokens: 5,
      }),
    )
  const sending = vi.fn(async (body: CreateResponseBody, signal: AbortSignal) => {
    sent.push(body)
    return await transport(body, signal)
  })
  const deps: ModelApiJudgeDeps = {
    source: {
      readMainBody: () => main,
      keyPrefix: () => 'muse-abc123',
      prefixTokens: () => options.prefixTokens ?? 4357,
    },
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

function startKey(entries: JudgeEntryStore): string {
  return entries.start({
    backend: 'model-api',
    sessionId: 's1',
    turnId: 't1',
    tool: 'run_shell',
    args: { command: 'rm -rf /tmp/x' },
  })
}

async function untilSettled(entries: SpyStore, key: string): Promise<string> {
  const deadline = Date.now() + 5000
  for (;;) {
    const found = entries.settled.find((entry) => entry.key === key)
    if (found !== undefined) {
      return found.outcome
    }
    if (Date.now() > deadline) {
      throw new Error('the judge never settled')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const NOUL = { id: 'risk', kind: 'noul' as const, text: 'Is deleting this risky?' }

describe('ModelApiSameJudge', () => {
  it('sends the prefix exactly with the question at the tail and settles caution', async () => {
    const rig = setup({})
    const before = structuredClone(mainBody())
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'rm -rf /tmp/x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('caution')
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
    expect(rig.cache.get(key)?.outcome).toBe('caution')
    expect(rig.errors).toEqual([])
  })

  it('settles none on a safe answer, changing no verdict', async () => {
    const rig = setup({ reply: '{"answer":"no","confidence":99}' })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'ls', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('none')
  })

  it('sends standalone when redaction changes the prefix', async () => {
    const main = mainBody()
    const secret = { ...main, instructions: 'key: LLM_abcdefghijklmnop' }
    const rig = setup({ main: secret })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('caution')
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
    await untilSettled(rig.entries, key)
    expect(rig.sent[0]?.input).toHaveLength(1)
  })

  it('refuses a model switch without sending', async () => {
    const rig = setup({ main: { ...mainBody(), model: 'someone-else' } })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('failed')
    expect(rig.sent).toHaveLength(0)
    expect(rig.cache.get(key)).toBeUndefined()
  })

  it('drops a result that arrives after its fence', async () => {
    const gate = Promise.withResolvers<{
      text: string
      inputTokens: number
      outputTokens: number
    }>()
    const release = gate.resolve
    const rig = setup({
      send: (_body, _signal) => gate.promise,
    })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    // The fence reads first and consumes the entry.
    expect(rig.entries.readLatch(key)).toBeUndefined()
    release({ text: '{"answer":"yes","confidence":95}', inputTokens: 1, outputTokens: 1 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rig.entries.settled).toEqual([])
    expect(rig.cache.get(key)).toBeUndefined()
  })

  it('settles a repeated action from the cache without sending', async () => {
    const rig = setup({})
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('caution')
    expect(rig.sent).toHaveLength(1)
    // The fence consumed the entry but the outcome stays cached.
    expect(rig.entries.readLatch(key)).toBe('caution')
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rig.sent).toHaveLength(1)
    expect(rig.entries.settled.filter((entry) => entry.key === key)).toHaveLength(1)
  })

  it('settles failed on an unparseable reply and caches nothing', async () => {
    const rig = setup({ reply: 'maybe, ask me again' })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('failed')
    expect(rig.cache.get(key)).toBeUndefined()
  })

  it('settles failed when the transport throws', async () => {
    const rig = setup({
      send: () => Promise.reject(new Error('network down')),
    })
    const key = startKey(rig.entries)
    rig.judge.judge({ entryKey: key, stateText: 'x', questions: [NOUL] })
    expect(await untilSettled(rig.entries, key)).toBe('failed')
    expect(rig.errors).toHaveLength(1)
  })
})
