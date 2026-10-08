import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  ContentLengthFramer,
  framingOfFirstBytes,
  LineFramer,
  type McpChildProcess,
  McpFramingError,
  McpStdioTransport,
} from '../../src/core/backends/modelapi/mcp/stdio'
import type { McpFraming } from '../../src/shared/constants'
import { MCP_MESSAGE_MAX_BYTES } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { countLogged } from './helpers/logText'

const bytes = (text: string) => Buffer.from(text, 'utf8')

/** A child process in memory: what was written, and levers for what it says. */
function fakeChild() {
  const written: string[] = []
  const stdout = new Set<(chunk: Uint8Array) => void>()
  const stderr = new Set<(chunk: Uint8Array) => void>()
  const exits = new Set<(how: string) => void>()
  let hasEndedInput = false
  const kill = vi.fn(() => Promise.resolve())
  const child: McpChildProcess = {
    write: (chunk) => {
      written.push(Buffer.from(chunk).toString('utf8'))
    },
    endInput: () => {
      hasEndedInput = true
    },
    onStdout: (listener) => {
      stdout.add(listener)
    },
    onStderr: (listener) => {
      stderr.add(listener)
    },
    onExit: (listener) => {
      exits.add(listener)
    },
    kill,
  }
  return {
    child,
    written,
    kill,
    hasEndedInput: () => hasEndedInput,
    out: (text: string | Uint8Array) => {
      for (const listener of stdout) {
        listener(typeof text === 'string' ? bytes(text) : text)
      }
    },
    err: (text: string) => {
      for (const listener of stderr) {
        listener(bytes(text))
      }
    },
    exit: (how: string) => {
      for (const listener of exits) {
        listener(how)
      }
    },
  }
}

function transport(framing: McpFraming = 'line_delimited_json') {
  const fake = fakeChild()
  const log = new FakeLogOutputChannel()
  const stdio = new McpStdioTransport(fake.child, { name: 'fake', framing, log })
  const messages: unknown[] = []
  stdio.onMessage((message) => {
    messages.push(message)
  })
  const closed: string[] = []
  stdio.onClose((reason) => {
    closed.push(reason)
  })
  return { ...fake, log, stdio, messages, closed }
}

const PING = { jsonrpc: '2.0', id: 1, method: 'ping' } as const

describe('LineFramer (M50)', () => {
  it('reads one message a line across chunks, CRLF and blank lines included', () => {
    const framer = new LineFramer()
    expect(framer.push(bytes('{"a":1}\r\n\n{"b"'))).toEqual(['{"a":1}'])
    expect(framer.push(bytes(':2}\n'))).toEqual(['{"b":2}'])
    expect(Buffer.from(framer.encode('{}')).toString()).toBe('{}\n')
  })

  it('refuses a line over the cap', () => {
    const framer = new LineFramer()
    expect(() => framer.push(Buffer.alloc(MCP_MESSAGE_MAX_BYTES + 1, 0x61))).toThrow(
      McpFramingError,
    )
  })
})

describe('ContentLengthFramer (M50)', () => {
  it('reads headers and bodies across chunks, and writes them', () => {
    const framer = new ContentLengthFramer()
    const body = '{"é":1}'
    const length = Buffer.byteLength(body)
    expect(framer.push(bytes(`Content-Length: ${String(length)}\r\nContent-Type: x\r\n`))).toEqual(
      [],
    )
    expect(framer.push(bytes(`\r\n${body}Content-Length: 2\r\n\r\n{}`))).toEqual([body, '{}'])
    expect(Buffer.from(framer.encode(body)).toString()).toBe(
      `Content-Length: ${String(length)}\r\n\r\n${body}`,
    )
  })

  it('refuses a header without a length, a length over the cap, and endless headers', () => {
    expect(() => new ContentLengthFramer().push(bytes('X: 1\r\n\r\n{}'))).toThrow(
      'without a Content-Length',
    )
    expect(() =>
      new ContentLengthFramer().push(
        bytes(`Content-Length: ${String(MCP_MESSAGE_MAX_BYTES + 1)}\r\n\r\n`),
      ),
    ).toThrow('over 20 MiB')
    expect(() =>
      new ContentLengthFramer().push(Buffer.alloc(MCP_MESSAGE_MAX_BYTES + 1, 0x61)),
    ).toThrow('over 20 MiB')
  })
})

describe('framingOfFirstBytes (M50)', () => {
  it('tells a Content-Length header from a line, and waits while it cannot', () => {
    expect(framingOfFirstBytes(bytes('Content-Length: 3\r\n'))).toBe('content_length')
    expect(framingOfFirstBytes(bytes('  content-length:'))).toBe('content_length')
    expect(framingOfFirstBytes(bytes('{"jsonrpc"'))).toBe('lines')
    expect(framingOfFirstBytes(bytes('Content-'))).toBeUndefined()
    expect(framingOfFirstBytes(bytes('\n\n'))).toBeUndefined()
    expect(framingOfFirstBytes(Buffer.alloc(2000, 0x20))).toBe('lines')
    expect(framingOfFirstBytes(bytes('Cont!'))).toBe('lines')
  })
})

describe('McpStdioTransport (M50)', () => {
  it('writes lines and delivers what the server writes, skipping what is not JSON', async () => {
    const t = transport()
    await t.stdio.send(PING)
    expect(t.written).toEqual([`${JSON.stringify(PING)}\n`])
    t.out('Server ready on stdio\n{"jsonrpc":"2.0","id":1,"result":{}}\n')
    expect(t.messages).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
    expect(countLogged(t.log, 'not JSON to stdout; skipped: Server ready on stdio')).toBe(1)
    t.stdio.setProtocolVersion()
  })

  it('speaks Content-Length when told to', async () => {
    const t = transport('content_length')
    await t.stdio.send(PING)
    expect(t.written[0]).toMatch(/^Content-Length: \d+\r\n\r\n\{/)
    t.out('Content-Length: 2\r\n\r\n{}')
    expect(t.messages).toEqual([{}])
  })

  it('switches to Content-Length under auto when the server starts with that header', async () => {
    const t = transport('auto')
    await t.stdio.send(PING)
    expect(t.written[0]).toBe(`${JSON.stringify(PING)}\n`)
    t.out('Content-')
    expect(t.messages).toEqual([])
    t.out('Length: 2\r\n\r\n{}')
    expect(t.messages).toEqual([{}])
    await t.stdio.send(PING)
    expect(t.written[1]).toMatch(/^Content-Length: /)
    expect(countLogged(t.log, 'switching to that framing')).toBe(1)
  })

  it('stays with lines under auto when the server writes JSON lines', () => {
    const t = transport('auto')
    t.out('{"a":1}\n')
    t.out('{"b":2}\n')
    expect(t.messages).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('logs stderr line by line, and reports the last words with the exit', async () => {
    const t = transport()
    t.err('starting\n\nlistening')
    t.err(' on stdio\nfatal: no token\n')
    t.exit('it exited with code 1')
    t.exit('again')
    expect(countLogged(t.log, 'MCP server fake (stderr): starting')).toBe(1)
    expect(countLogged(t.log, 'MCP server fake (stderr): listening on stdio')).toBe(1)
    expect(t.closed).toEqual(['it exited with code 1: fatal: no token'])
    await expect(t.stdio.send(PING)).rejects.toThrow(
      'the server has stopped: it exited with code 1',
    )
    t.out('{"late":true}\n')
    expect(t.messages).toEqual([])
    await t.stdio.close()
    expect(t.hasEndedInput()).toBe(false)
    expect(t.kill).toHaveBeenCalledOnce()
  })

  it('ends a server that breaks the framing, and kills it', () => {
    const t = transport('content_length')
    t.out('Bogus: 1\r\n\r\n{}')
    expect(t.closed).toEqual(['the server sent a message header without a Content-Length'])
    expect(t.kill).toHaveBeenCalledOnce()
  })

  it('handles refused cleanup after a framing fault without an unhandled rejection', async () => {
    const t = transport('content_length')
    t.kill.mockRejectedValue(new Error('private-stop-canary'))
    t.out('Content-Length: invalid\r\n\r\n')
    await vi.waitFor(() => {
      expect(countLogged(t.log, 'unproved tree stop')).toBe(1)
    })
    expect(countLogged(t.log, 'private-stop-canary')).toBe(0)
  })

  it('closes a server that leaves when its input ends and reaps its children', async () => {
    const t = transport()
    const closing = t.stdio.close()
    expect(t.hasEndedInput()).toBe(true)
    t.exit('it exited with code 0')
    await closing
    expect(t.kill).toHaveBeenCalledOnce()
    expect(t.closed).toEqual([])
  })

  it('kills a server that stays after its input ends', async () => {
    vi.useFakeTimers()
    try {
      const t = transport()
      const closing = t.stdio.close()
      await vi.advanceTimersByTimeAsync(1500)
      await closing
      expect(t.kill).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
