import { describe, expect, it, vi } from 'vitest'
import {
  createExecLogger,
  createExecSink,
  redactWhole,
  validateSchemaResult,
  validateSchemaEvent,
} from '../../src/runtime/exec/execOutput'
import { compileOutputSchema, type OutputSchema } from '../../src/runtime/exec/outputSchema'
import { execEventSchema } from '../../src/runtime/exec/execProtocol'
import { UI_TEXT } from '../../src/shared/constants'
import { outputWriter, resultRecord } from './helpers/execContract'

const KEY = 'LLM|123|before%after+/.=$&'
function harness(format: 'text' | 'json' | 'jsonl' = 'jsonl', schema?: OutputSchema) {
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
    outputSchema: () => schema,
  })
  return { out, summary, onStalled, sink }
}

const answerSchema = (properties?: Record<string, unknown>) => {
  const fields = properties ?? { ok: { type: 'boolean' } }
  return compileOutputSchema(
    new TextEncoder().encode(
      JSON.stringify({
        type: 'object',
        properties: fields,
        required: Object.keys(fields),
        additionalProperties: false,
      }),
    ),
  )
}

describe('M106 structured exec egress', () => {
  it.each(['text', 'json', 'jsonl'] as const)(
    'returns validated output and exact digest in %s',
    async (format) => {
      const schema = answerSchema()
      const h = harness(format, schema)
      h.sink.message({
        itemId: 'final',
        kind: 'agentMessage',
        text: '{ "ok": true }',
        complete: true,
      })
      await h.sink.finish(resultRecord())
      expect(h.sink.resultExitCode).toBe(0)
      if (format === 'text') expect(h.out.chunks).toEqual(['{"ok":true}\n'])
      else {
        const value: unknown = JSON.parse(h.out.chunks.at(-1) ?? '')
        const result = format === 'json' ? validateSchemaResult(value) : validateSchemaEvent(value)
        expect(result).toMatchObject(
          format === 'json'
            ? {
                output: { ok: true },
                ledger: { outputSchemaSha256: schema.sha256 },
              }
            : {
                type: 'result',
                result: {
                  output: { ok: true },
                  ledger: { outputSchemaSha256: schema.sha256 },
                },
              },
        )
      }
    },
  )
  it.each(['not JSON', '{"ok":"yes"}', '{"ok":true,"extra":1}'])(
    'refuses a mismatched final answer: %s',
    async (text) => {
      const h = harness('jsonl', answerSchema())
      h.sink.message({ itemId: 'final', kind: 'agentMessage', text, complete: true })
      await h.sink.finish(resultRecord())
      expect(h.sink.resultExitCode).toBe(4)
      const event = validateSchemaEvent(JSON.parse(h.out.chunks.at(-1) ?? ''))
      expect(event).toMatchObject({
        type: 'result',
        result: {
          status: 'failed',
          exitCode: 4,
          finalMessage: UI_TEXT.execMessageWithheld,
          error: { kind: 'output_schema_mismatch' },
        },
      })
      if (event.type !== 'result') throw new Error('missing result')
      expect(Object.hasOwn(event.result, 'output')).toBe(false)
      expect(h.out.chunks.join('')).not.toContain(text)
    },
  )
  it('redacts decoded sensitive fields and validates after redaction, including escaped field names', async () => {
    const schema = answerSchema({ password: { type: 'string' }, note: { type: 'string' } })
    const h = harness('jsonl', schema)
    h.sink.message({
      itemId: 'final',
      kind: 'agentMessage',
      text: String.raw`{"pass\u0077ord":"opaque-value","note":"safe"}`,
      complete: true,
    })
    await h.sink.finish(resultRecord())
    const event = validateSchemaEvent(JSON.parse(h.out.chunks.at(-1) ?? ''))
    expect(event).toMatchObject({
      type: 'result',
      result: {
        output: { password: '[redacted]', note: 'safe' },
        finalMessage: '{"password":"[redacted]","note":"safe"}',
      },
    })
    expect(h.out.chunks.join('')).not.toContain('opaque-value')
    const constrained = harness('jsonl', answerSchema({ note: { type: 'string', enum: [KEY] } }))
    constrained.sink.message({
      itemId: 'final',
      kind: 'agentMessage',
      text: JSON.stringify({ note: KEY }),
      complete: true,
    })
    await constrained.sink.finish(resultRecord())
    expect(constrained.sink.resultExitCode).toBe(4)
    expect(constrained.out.chunks.join('')).not.toContain(KEY)
    const placeholder = harness(
      'json',
      answerSchema({ note: { type: 'string', enum: ['[redacted]'] } }),
    )
    placeholder.sink.message({
      itemId: 'final',
      kind: 'agentMessage',
      text: JSON.stringify({ note: KEY }),
      complete: true,
    })
    await placeholder.sink.finish(resultRecord())
    expect(placeholder.sink.resultExitCode).toBe(4)
  })
  it('never promotes earlier valid commentary over a withheld final response or a stop', async () => {
    const h = harness('json', answerSchema())
    h.sink.message({ itemId: 'early', kind: 'agentMessage', text: '{"ok":true}', complete: true })
    h.sink.message({ itemId: 'final', kind: 'agentMessage', text: '{"ok":', complete: false })
    const base = resultRecord()
    await h.sink.finish({
      ...base,
      status: 'incomplete',
      exitCode: 8,
      error: { kind: 'incomplete', message: 'incomplete' },
      finalMessage: UI_TEXT.execMessageWithheld,
    })
    const result = validateSchemaResult(JSON.parse(h.out.chunks[0] ?? ''))
    expect(result.status).toBe('incomplete')
    expect(Object.hasOwn(result, 'output')).toBe(false)
    expect(result.ledger?.outputSchemaSha256).toBe(answerSchema().sha256)
    expect(h.sink.resultExitCode).toBe(8)
  })
  it('rejects malformed additive fields and retains the base accounting guards', () => {
    const base = resultRecord()
    const good = {
      ...base,
      output: { ok: true },
      ledger: { ...base.ledger, outputSchemaSha256: answerSchema().sha256 },
    }
    expect(validateSchemaResult(good)).toEqual(good)
    for (const value of [
      { ...good, output: undefined },
      { ...good, output: { ok: NaN } },
      { ...good, ledger: base.ledger },
      { ...base, ledger: good.ledger },
      { ...good, ledger: { ...good.ledger, outputSchemaSha256: 'wrong' } },
      { ...good, ledger: { ...good.ledger, unexpected: true } },
      { ...good, status: 'failed', exitCode: 4, error: { kind: 'failed', message: 'failed' } },
      { ...good, usage: { ...good.usage, requests: null } },
    ])
      expect(() => validateSchemaResult(value)).toThrow()
    expect(validateSchemaResult(base)).toEqual(base)
  })
  it('keeps no-schema result bytes equal to the existing v1 contract', async () => {
    const h = harness('json')
    await h.sink.finish(resultRecord())
    expect(h.out.chunks).toEqual([`${JSON.stringify(resultRecord())}\n`])
  })
})

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
  // RVM80A P3-6: the sink takes whole items only, so this proves literal-first
  // redaction of an item assembled before emission; the split across stream
  // deltas is proved through the real engine by execRun's D15.
  it('A13 redacts a whole completed item literal-first, the key assembled before emission', async () => {
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
  it('A17 serializes a BigInt leaf of a loose update instead of throwing (RVM80A P3-4)', () => {
    const { out, sink } = harness()
    expect(() => {
      sink.emit({ type: 'update', update: { sessionUpdate: 'future_notice', big: 12n } })
    }).not.toThrow()
    expect(JSON.parse(out.chunks[0]!)).toMatchObject({ update: { big: '12' } })
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
