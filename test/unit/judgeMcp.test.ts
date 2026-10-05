import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  incomingMessageSchema,
  callToolResultSchema,
  contentBlockSchema,
} from '../../src/core/backends/modelapi/mcp/protocol'
import { runJudgeCommand } from '../../src/runtime/judge/commands'
import { runJudgeMcp } from '../../src/runtime/judge/mcp'
import { JUDGE_MAX_BODY_BYTES } from '../../src/shared/constants'
import { answered, command, io, REQUEST, source, writer } from './judgeCliFixtures'

function frame(method: string, id: number, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
}
function call(id = 1, args: unknown = REQUEST): string {
  return frame('tools/call', id, { name: 'judge', arguments: args })
}
function messages(text: string): unknown[] {
  return text
    .trim()
    .split('\n')
    .map((line): unknown => JSON.parse(line))
}

describe('judge MCP stdio', () => {
  it('initializes and lists only the bounded read-only advisory tool without inference', async () => {
    const resolveSource = vi.fn(() => Promise.resolve(source().value))
    const streams = io(
      frame('initialize', 1, { protocolVersion: '2025-06-18' }) + frame('tools/list', 2),
    )
    expect(await runJudgeCommand(command('mcp'), streams, { resolveSource })).toBe(0)
    expect(messages(streams.output())).toMatchObject([
      {
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            {
              name: 'judge',
              annotations: { readOnlyHint: true, destructiveHint: false },
              inputSchema: { type: 'object', required: ['state', 'questions'] },
            },
          ],
        },
      },
    ])
    expect(resolveSource).not.toHaveBeenCalled()
    expect(streams.output()).not.toContain('session/')
  })
  it('validates and answers the judge tool using compatible native answers', async () => {
    const streams = io(call())
    const fake = source()
    expect(
      await runJudgeCommand(command('mcp'), streams, {
        resolveSource: () => Promise.resolve(fake.value),
      }),
    ).toBe(0)
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const reply = incomingMessageSchema.parse(messages(streams.output())[0])
    const block = contentBlockSchema.parse(callToolResultSchema.parse(reply.result).content?.[0])
    if (block.type !== 'text') throw new Error('fixture')
    expect(JSON.parse(block.text)).toEqual(good.result)
    expect(fake.judge).toHaveBeenCalledOnce()
  })
  it('refuses invalid tool arguments before source resolution', async () => {
    const resolveSource = vi.fn(() => Promise.resolve(source().value))
    const streams = io(call(1, {}) + call(2, { state: '', questions: {} }))
    expect(await runJudgeCommand(command('mcp'), streams, { resolveSource })).toBe(2)
    expect(messages(streams.output())).toMatchObject([
      { result: { isError: true } },
      { result: { isError: true } },
    ])
    expect(resolveSource).not.toHaveBeenCalled()
  })
  it('classifies contradictory model context as input error before resolving a source', async () => {
    const resolveSource = vi.fn(() => Promise.resolve(source().value))
    const streams = io(call(1, { ...REQUEST, model: 'other' }))
    expect(await runJudgeCommand(command('mcp'), streams, { resolveSource })).toBe(2)
    expect(resolveSource).not.toHaveBeenCalled()
    expect(streams.output()).toContain('"isError":true')
  })
  it('reports no-answer as a tool error and exits 4 without an empty success', async () => {
    const streams = io(call())
    expect(await runJudgeCommand(command('mcp'), streams, {})).toBe(4)
    expect(messages(streams.output())).toMatchObject([
      {
        result: {
          isError: true,
          content: [{ text: expect.stringContaining('source-unavailable') }],
        },
      },
    ])
  })
  it('refuses unknown methods and tools without echoing private names', async () => {
    for (const input of [
      frame('private-method', 1),
      frame('tools/call', 1, { name: 'private-tool', arguments: REQUEST }),
    ]) {
      const streams = io(input)
      expect(await runJudgeCommand(command('mcp'), streams, {})).toBe(2)
      expect(streams.output()).not.toMatch(/private-method|private-tool/)
    }
  })
  it('sanitizes unknown tool failures after an earlier refusal', async () => {
    const streams = io(
      call(1) + frame('tools/call', 2, { name: 'private-tool', arguments: REQUEST }),
    )
    expect(await runJudgeCommand(command('mcp'), streams, {})).toBe(2)
    expect(streams.output()).not.toContain('private-tool')
  })
  it('never forwards private provider failures as MCP tool text', async () => {
    const fake = source()
    fake.judge.mockRejectedValue(new Error('private provider text'))
    const streams = io(call())
    expect(
      await runJudgeCommand(command('mcp'), streams, {
        resolveSource: () => Promise.resolve(fake.value),
      }),
    ).toBe(4)
    expect(streams.output()).toContain('engine-failure')
    expect(streams.output()).not.toContain('private provider text')
  })
  it('validates injected MCP outcomes and bounds result bytes', async () => {
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    for (const result of [
      { ...good.result, answers: {}, muse: {} },
      { ...good.result, vendor: 'x'.repeat(JUDGE_MAX_BODY_BYTES) },
    ]) {
      const streams = io(call())
      expect(
        await runJudgeMcp(
          streams,
          () => Promise.resolve({ outcome: 'answered', result }),
          new AbortController().signal,
        ),
      ).toBe(4)
      expect(streams.output()).toContain('"isError":true')
    }
  })
  it('shares the run cap across MCP calls and never bypasses admission', async () => {
    const fake = source('paid', 1)
    const admitPaid = vi.fn(() => Promise.resolve(answered()))
    const streams = io(call(1) + call(2))
    expect(
      await runJudgeCommand(command('mcp', ['--model', 'chosen', '--budget-usd', '1']), streams, {
        resolveSource: () => Promise.resolve(fake.value),
        admitPaid,
      }),
    ).toBe(4)
    expect(admitPaid).toHaveBeenCalledOnce()
    expect(fake.judge).not.toHaveBeenCalled()
    expect(messages(streams.output())).toMatchObject([
      { result: { content: expect.any(Array) } },
      { result: { isError: true } },
    ])
    expect(streams.output()).toContain('over-budget')
  })
  it('rounds fractional-microUSD reservations up before checking the run cap', async () => {
    const fake = source('paid', 0.0000006)
    const admitPaid = vi.fn(() => Promise.resolve(answered()))
    expect(
      await runJudgeCommand(
        command('mcp', ['--model', 'chosen', '--budget-usd', '0.000001']),
        io(call(1) + call(2)),
        {
          resolveSource: () => Promise.resolve(fake.value),
          admitPaid,
        },
      ),
    ).toBe(4)
    expect(admitPaid).toHaveBeenCalledOnce()
    expect(admitPaid).toHaveBeenCalledWith(fake.value, REQUEST, 0.000001, expect.any(AbortSignal))
  })
  it('stops queued inference after an output pipe stalls', async () => {
    const fake = source('paid', 1)
    const admitPaid = vi.fn(() => Promise.resolve(answered()))
    expect(
      await runJudgeCommand(
        command('mcp', ['--model', 'chosen', '--budget-usd', '2']),
        {
          ...io(call(1) + call(2)),
          stdout: writer(false).value,
        },
        { resolveSource: () => Promise.resolve(fake.value), admitPaid },
      ),
    ).toBe(4)
    expect(admitPaid).toHaveBeenCalledOnce()
  })
  it('rejects malformed JSON-RPC and truncated or oversized byte streams', async () => {
    for (const input of [
      '{\n',
      '{}\n',
      call().trimEnd(),
      'x'.repeat(JUDGE_MAX_BODY_BYTES + 1),
      new Uint8Array([255, 10]),
    ]) {
      const streams = io(input)
      expect(await runJudgeCommand(command('mcp'), streams, {})).toBe(2)
    }
  })
  it('bounds raw frames before unknown fields are stripped and rejects invalid UTF-8 inside JSON', async () => {
    const invalidUtf = Buffer.from(call())
    invalidUtf[invalidUtf.indexOf('git status')] = 255
    const resolveSource = vi.fn(() => Promise.resolve(source().value))
    for (const input of [
      call(1, { ...REQUEST, extra: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }),
      invalidUtf,
    ]) {
      expect(await runJudgeCommand(command('mcp'), io(input), { resolveSource })).toBe(2)
    }
    expect(resolveSource).not.toHaveBeenCalled()
  })
  it('handles arbitrarily chunked UTF-8 frames and ignores notifications without inference', async () => {
    const stdin = new PassThrough()
    const resolveSource = vi.fn(() => Promise.resolve(source().value))
    const streams = { ...io(), stdin }
    const running = runJudgeCommand(command('mcp'), streams, { resolveSource })
    const bytes = Buffer.from(
      frame('ping', 1, { data: 'é' }) +
        '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"judge","arguments":{}}}\n',
    )
    for (const byte of bytes) stdin.write(Buffer.from([byte]))
    stdin.end()
    expect(await running).toBe(0)
    expect(messages(streams.output())).toMatchObject([{ id: 1, result: {} }])
    expect(resolveSource).not.toHaveBeenCalled()
  })
  it('cancels queued calls before dispatch and does not leak the cancellation reason', async () => {
    const streams = io(
      call(1) +
        '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"private reason"}}\n',
    )
    const fake = source()
    expect(
      await runJudgeCommand(command('mcp'), streams, {
        resolveSource: () => Promise.resolve(fake.value),
      }),
    ).toBe(4)
    expect(fake.judge).not.toHaveBeenCalled()
    expect(streams.output()).toContain('cancelled')
    expect(streams.output()).not.toContain('private reason')
  })
  it('interrupts an active engine that ignores its cancellation signal', async () => {
    const stdin = new PassThrough()
    const streams = { ...io(), stdin }
    const fake = source()
    fake.judge.mockImplementation(() => {
      return new Promise(() => {
        /* Deliberately ignores cancellation. */
      })
    })
    const running = runJudgeCommand(command('mcp'), streams, {
      resolveSource: () => Promise.resolve(fake.value),
    })
    stdin.write(call(1))
    await vi.waitFor(() => {
      expect(fake.judge).toHaveBeenCalledOnce()
    })
    stdin.end('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}\n')
    expect(await running).toBe(4)
    expect(streams.output()).toContain('cancelled')
  })
  it('discards a pending response after malformed input closes the transport', async () => {
    const stdin = new PassThrough()
    const streams = { ...io(), stdin }
    const fake = source()
    fake.judge.mockImplementation(
      () =>
        new Promise(() => {
          /* Deliberately pending across transport failure. */
        }),
    )
    const running = runJudgeCommand(command('mcp'), streams, {
      resolveSource: () => Promise.resolve(fake.value),
    })
    stdin.write(call())
    await vi.waitFor(() => {
      expect(fake.judge).toHaveBeenCalledOnce()
    })
    stdin.end('truncated')
    expect(await running).toBe(2)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    expect(streams.output()).toBe('')
  })
})
