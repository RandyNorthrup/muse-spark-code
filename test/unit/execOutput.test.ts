import { describe, expect, it, vi } from 'vitest'
import { createExecLogger, createExecSink, redactWhole } from '../../src/runtime/exec/execOutput'
import { execEventSchema } from '../../src/runtime/exec/execProtocol'
import { UI_TEXT } from '../../src/shared/constants'
import { outputWriter, resultRecord } from './helpers/execContract'

const KEY = 'LLM|123|before%after+/.=$&'
function harness(format: 'text' | 'json' | 'jsonl' = 'jsonl') {
  const out = outputWriter()
  const summary = vi.fn()
  const onStalled = vi.fn()
  const sink = createExecSink({
    format,
    out,
    now: () => Date.UTC(2026, 9, 2),
    literals: () => [KEY],
    summary,
    onStalled,
  })
  return { out, summary, onStalled, sink }
}

describe('M80 egress (A12–A14, A17, A19, A20)', () => {
  it('B/D27 authoritative withholding cannot reuse earlier completed commentary', async () => {
    const h = harness('json')
    h.sink.message({
      itemId: 'earlier',
      kind: 'agentMessage',
      text: 'earlier commentary',
      complete: true,
    })
    const result = resultRecord()
    result.status = 'failed'
    result.exitCode = 4
    result.error = { kind: 'failed', message: 'HTTP failure' }
    result.finalMessage = UI_TEXT.execMessageWithheld
    await h.sink.finish(result)
    expect(JSON.parse(h.out.chunks[0]!)).toMatchObject({
      status: 'failed',
      finalMessage: UI_TEXT.execMessageWithheld,
    })
  })
  it('A12 emits valid increasing JSONL envelopes with one final result and a summary', async () => {
    const { out, sink, summary } = harness()
    sink.emit({ type: 'question_declined', count: 1 })
    sink.message({ itemId: 'a', kind: 'agentMessage', text: 'answer', complete: true })
    await sink.finish(resultRecord())
    const events = out.chunks.map((line) => execEventSchema.parse(JSON.parse(line)))
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(events.every((event) => event.time === '2026-10-02T00:00:00.000Z')).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { finalMessage: 'answer' } })
    expect(summary).toHaveBeenCalledOnce()
    await expect(sink.finish(resultRecord())).rejects.toThrow()
    sink.forceFinish(resultRecord())
    expect(out.chunks).toHaveLength(3)
  })
  it.each(['text', 'json'] as const)(
    'A12 keeps %s stdout in its selected format only',
    async (format) => {
      const { out, sink } = harness(format)
      sink.emit({ type: 'tool', name: 'read_file', status: 'completed', durationMs: 1 })
      await sink.finish({ ...resultRecord(), finalMessage: `answer ${KEY}` })
      expect(out.chunks).toHaveLength(1)
      if (format === 'text') expect(out.chunks[0]).toBe('answer [redacted]\n')
      else expect(JSON.parse(out.chunks[0]!)).toMatchObject({ finalMessage: 'answer [redacted]' })
    },
  )
  it('A13 redacts whole completed items, including keys assembled from character deltas', async () => {
    const { out, sink, summary } = harness()
    let message = ''
    let thought = ''
    for (const char of KEY) {
      message += char
      thought += char
    }
    sink.message({ itemId: 'm', kind: 'agentMessage', text: message, complete: true })
    sink.message({ itemId: 'r', kind: 'reasoning', text: thought, complete: true })
    const result = resultRecord()
    result.denials = [{ toolCallId: KEY, title: KEY, kind: KEY, paths: [] }]
    result.status = 'failed'
    result.exitCode = 4
    result.error = { kind: KEY, message: KEY }
    await sink.finish(result)
    const emitted = out.chunks.join('') + JSON.stringify(summary.mock.calls)
    for (const fragment of [KEY, 'before', 'after']) expect(emitted).not.toContain(fragment)
    expect(emitted).toContain('[redacted]')
  })
  it('A13 withholds a cut-short final message whole, never reuses an earlier response', async () => {
    const { out, sink } = harness()
    sink.message({ itemId: 'early', kind: 'agentMessage', text: 'earlier', complete: true })
    sink.message({
      itemId: 'final',
      kind: 'agentMessage',
      text: 'partial LLM|123|be',
      complete: false,
    })
    sink.message({ itemId: 'thought', kind: 'reasoning', text: 'secret fragment', complete: false })
    await sink.finish(resultRecord())
    expect(out.chunks.join('')).not.toContain('partial')
    expect(out.chunks.join('')).not.toContain('secret fragment')
    expect(JSON.parse(out.chunks.at(-1)!)).toMatchObject({
      result: { finalMessage: UI_TEXT.execMessageWithheld },
    })
    expect(() => {
      sink.message({ itemId: 'later', kind: 'agentMessage', text: 'later', complete: true })
    }).toThrow()
  })
  it('A17 preserves unknown non-tool updates and redacts all nested string leaves', () => {
    const { out, sink } = harness()
    sink.emit({
      type: 'update',
      update: { sessionUpdate: 'future_notice', future: { lines: [KEY, 'safe'], extra: 3 } },
    })
    expect(JSON.parse(out.chunks[0]!)).toMatchObject({
      update: {
        sessionUpdate: 'future_notice',
        future: { lines: ['[redacted]', 'safe'], extra: 3 },
      },
    })
  })
  it.each([
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: KEY } },
    { type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: KEY } },
    { type: 'update', update: { sessionUpdate: 'tool_call', content: 'x'.repeat(20_000) + KEY } },
    { type: 'update', update: { sessionUpdate: 'tool_future', content: KEY } },
    { type: 'update', update: { sessionUpdate: 'toolFuture', content: KEY } },
    { type: 'update', update: { sessionUpdate: 'future', nested: [{ rawOutput: KEY }] } },
    { type: 'tool', name: 'read_file', status: 'done', durationMs: 0, rawInput: KEY },
    { type: 'result', result: resultRecord() },
  ])('A20 rejects prohibited caller payload before writing', (event) => {
    const { out, sink } = harness()
    expect(() => {
      Reflect.apply(sink.emit, sink, [event])
    }).toThrow()
    expect(out.chunks).toEqual([])
  })
  it('rejects repeated whole items', () => {
    const { sink } = harness()
    const item = { itemId: 'same', kind: 'agentMessage', text: 'x', complete: true } as const
    sink.message(item)
    expect(() => {
      sink.message(item)
    }).toThrow()
  })
  it('redacts before JSON serialization, preserving escaped strings and wire fields', async () => {
    const { sink, out } = harness()
    sink.emit({
      type: 'update',
      update: {
        sessionUpdate: 'future',
        api_key: KEY,
        quote: 'api_key="unterminated',
        text: '{"key":"safe"}',
      },
    })
    await sink.finish(resultRecord())
    expect(() => {
      for (const line of out.chunks) execEventSchema.parse(JSON.parse(line))
    }).not.toThrow()
    expect(JSON.parse(out.chunks[0]!)).toMatchObject({ update: { api_key: '[redacted]' } })
  })
  it('A19 masks structured credential fields without corrupting JSON strings', () => {
    const { sink, out } = harness()
    sink.emit({
      type: 'update',
      update: {
        sessionUpdate: 'future',
        api_key: 'opaque-value',
        nested: { password: 'two words', refresh_token: 'opaque-refresh', title: 'password guide' },
      },
    })
    expect(JSON.parse(out.chunks[0]!)).toMatchObject({
      update: {
        api_key: '[redacted]',
        nested: { password: '[redacted]', refresh_token: '[redacted]', title: 'password guide' },
      },
    })
    expect(out.chunks.join('')).not.toContain('opaque')
    expect(out.chunks.join('')).not.toContain('two words')
  })
  it('A14 notices a closed writer and an unsuccessful flush once', async () => {
    const { sink, out, onStalled } = harness()
    vi.mocked(out.flush).mockResolvedValue(false)
    await sink.finish(resultRecord())
    expect(sink.isStalled).toBe(true)
    expect(onStalled).toHaveBeenCalledOnce()
    const second = harness()
    Object.defineProperty(second.out, 'isClosed', { value: true })
    second.sink.forceFinish(resultRecord())
    expect(second.sink.isStalled).toBe(true)
    expect(second.out.chunks).toEqual([])
    expect(second.onStalled).toHaveBeenCalledOnce()
  })
  it('A14 notices a writer above the queue limit once and emits no more bytes', () => {
    const { sink, out, onStalled } = harness()
    Object.defineProperty(out, 'queuedBytes', { value: 16_777_217 })
    expect(sink.isStalled).toBe(true)
    sink.forceFinish(resultRecord())
    expect(sink.isStalled).toBe(true)
    expect(onStalled).toHaveBeenCalledOnce()
    expect(out.chunks).toEqual([])
  })
  it('A19 redacts exact percent/punctuation keys longest first and literal-safely', () => {
    expect(redactWhole(`${KEY} ${KEY}tail`, ['', KEY, `${KEY}tail`])).toBe('[redacted] [redacted]')
    const long = `LLM_${'a'.repeat(4090)}`
    expect(redactWhole(long, [long])).toBe('[redacted]')
    expect(redactWhole('0123456789abcdef c29tZW9yZGluYXJ5dGV4dA==', [])).toBe(
      '0123456789abcdef c29tZW9yZGluYXJ5dGV4dA==',
    )
  })
  it('A19 percent key traverses the real exec → stderrLogger → createLogger chain', () => {
    const stderr = outputWriter()
    let literals: string[] = []
    const log = createExecLogger({ stderr, literals: () => literals, verbose: false })
    log.trace('hidden')
    literals = [KEY]
    for (const level of ['info', 'warn', 'error'] as const) log[level](`raw ${KEY}`)
    expect(stderr.chunks).toEqual([
      '[info] raw [redacted]\n',
      '[warn] raw [redacted]\n',
      '[error] raw [redacted]\n',
    ])
    createExecLogger({ stderr, literals: () => literals, verbose: true }).trace(KEY)
    expect(stderr.chunks.at(-1)).toBe('[trace] [redacted]\n')
  })
})
