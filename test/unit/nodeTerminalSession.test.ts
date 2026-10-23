// The node terminal session (src/webview/node/terminal/session.ts): step-up,
// open, attach and the authorized stream, driving a real headless xterm.js
// emulator. Requests cross the real validated port; frames cross an
// in-memory wire pair parsed with the real schemas in both directions.
import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import {
  NODE_MAX_TERMINAL_DIMENSION,
  NODE_PROTOCOL_VERSION,
  NODE_TERMINAL_INPUT_BYTES,
} from '../../src/shared/constants'
import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodPort,
} from '../../src/shared/hostApi/nodeMethods'
import {
  nodeEventSchema,
  nodeTerminalClientFrameSchema,
  type NodeEvent,
} from '../../src/shared/node'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import {
  isNodePageError,
  NodePageError,
  validatedNodePort,
} from '../../src/webview/bridges/nodePort'
import { stepUpActionDigest, type NodePageAuthPort } from '../../src/webview/node/git/network'
import {
  attachNodeTerminal,
  openNodeTerminal,
  type NodeTerminalSocketFactory,
  type NodeTerminalWire,
} from '../../src/webview/node/terminal/session'

interface Backend {
  readonly port: NodeMethodPort
  readonly auth: NodePageAuthPort
  readonly connect: NodeTerminalSocketFactory
  readonly inputs: { method: NodeMethodName; input: unknown }[]
  readonly frames: unknown[]
  readonly connected: string[]
  emit(event: NodeEvent): void
  raw(data: string): void
  closeStream(): void
}

/** The node's terminal side over an in-memory wire pair. The factory opens
and authenticates like the real socket; client frames are parsed with the
real schema; host events are real envelopes. */
function backend(
  options: { terminalIds?: string[]; onVerify?: () => Promise<never> } = {},
): Backend {
  const ids = new Set(options.terminalIds ?? ['t1'])
  const inputs: { method: NodeMethodName; input: unknown }[] = []
  const frames: unknown[] = []
  const connected: string[] = []
  let onMessage: ((data: string) => void) | undefined
  let onClose: (() => void) | undefined
  let seq = 0
  const transport = {
    request: (method: NodeMethodName, input: unknown) => {
      inputs.push({ method, input })
      if (method === 'node/terminal/open') return Promise.resolve({ terminalId: 't1' })
      if (method === 'node/terminal/attach') {
        const terminalId = nodeMethods['node/terminal/attach'].params.parse(input).terminalId
        return ids.has(terminalId)
          ? Promise.resolve({ done: true })
          : Promise.reject(new NodePageError('notFound'))
      }
      return method === 'node/terminal/close'
        ? Promise.resolve({ done: true })
        : Promise.reject(new Error(`unexpected method ${method}`))
    },
  }
  const port = validatedNodePort(transport)
  const auth: NodePageAuthPort = {
    verify: (action, actionDigest) => {
      if (options.onVerify !== undefined) return options.onVerify()
      return Promise.resolve({
        id: 'proof',
        sessionId: 'session',
        action,
        actionDigest,
        verifiedAt: 1,
        expiresAt: 2,
      })
    },
  }
  const connect: NodeTerminalSocketFactory = (terminalId: string) => {
    connected.push(terminalId)
    if (!ids.has(terminalId)) return Promise.reject(new NodePageError('notFound'))
    const wire: NodeTerminalWire = {
      send: (frame: string) => {
        frames.push(nodeTerminalClientFrameSchema.parse(JSON.parse(frame)))
      },
      onMessage: (listener: (data: string) => void) => {
        onMessage = listener
        return () => {
          onMessage = undefined
        }
      },
      onClose: (listener: () => void) => {
        onClose = listener
        return () => {
          onClose = undefined
        }
      },
      close: () => {
        onMessage = undefined
        onClose = undefined
      },
    }
    return Promise.resolve(wire)
  }
  return {
    port,
    auth,
    connect,
    inputs,
    frames,
    connected,
    emit: (event: NodeEvent) => {
      seq += 1
      onMessage?.(JSON.stringify(nodeEventSchema.parse({ ...event, seq })))
    },
    raw: (data: string) => {
      onMessage?.(data)
    },
    closeStream: () => {
      onClose?.()
    },
  }
}

function output(terminalId: string, data: string): NodeEvent {
  return {
    v: NODE_PROTOCOL_VERSION,
    seq: 0,
    time: 1,
    nodeId: 'a'.repeat(64),
    type: 'terminalOutput',
    terminalId,
    data,
  }
}

function ended(terminalId: string): NodeEvent {
  return {
    v: NODE_PROTOCOL_VERSION,
    seq: 0,
    time: 1,
    nodeId: 'a'.repeat(64),
    type: 'terminalEnded',
    terminalId,
    exitCode: 0,
    reason: 'exit',
  }
}

function written(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, () => {
      resolve()
    })
  })
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected a failure')
}

describe('node terminal session', () => {
  it('binds the open digest to the exact action N verifies', async () => {
    const params = {
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      stepUpId: 'pending',
      actionDigest: '0'.repeat(64),
    }
    await expect(stepUpActionDigest('node/terminal/open', params)).resolves.toBe(
      nodeActionDigest('node/terminal/open', params),
    )
  })

  it('opens with step-up, streams output into the emulator, and closes clean', async () => {
    const test = backend()
    const signal = new AbortController().signal
    const session = await openNodeTerminal({
      port: test.port,
      auth: test.auth,
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      connect: test.connect,
      signal,
    })
    expect(session.terminalId).toBe('t1')
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    const events: string[] = []
    session.events((event) => {
      if (event.type === 'output') {
        events.push(event.data)
      }
    })
    test.emit(output('t1', 'hello\r\n'))
    await written(terminal, events.join(''))
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('hello')
    session.write('echo hi\n')
    session.resize(100, 30)
    session.close()
    // The session never sends the auth frame: the factory authenticates.
    expect(test.frames).toEqual([
      { type: 'input', data: 'echo hi\n' },
      { type: 'resize', size: { cols: 100, rows: 30 } },
      { type: 'close' },
    ])
    expect(test.inputs.map((call) => call.method)).toEqual([
      'node/terminal/open',
      'node/terminal/attach',
    ])
    const open = nodeMethods['node/terminal/open'].params.parse(test.inputs[0]?.input)
    expect(open.stepUpId).toBe('proof')
    expect(open.workspaceId).toBe('ws')
  })

  it('chunks pastes under the frame cap without splitting characters', async () => {
    const test = backend()
    const signal = new AbortController().signal
    const session = await openNodeTerminal({
      port: test.port,
      auth: test.auth,
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      connect: test.connect,
      signal,
    })
    const paste = `ab${'😀'.repeat(NODE_TERMINAL_INPUT_BYTES)}cd`
    session.write(paste)
    session.write('')
    const sent = test.frames.map((frame) => nodeTerminalClientFrameSchema.parse(frame))
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.every((frame) => frame.type === 'input')).toBe(true)
    expect(sent.map((frame) => (frame.type === 'input' ? frame.data : '')).join('')).toBe(paste)
    const encoder = new TextEncoder()
    for (const frame of sent) {
      expect(encoder.encode(frame.type === 'input' ? frame.data : '').length).toBeLessThanOrEqual(
        NODE_TERMINAL_INPUT_BYTES,
      )
    }
    session.close()
  })

  it('refuses a proof bound to another action, and stays silent on cancel', async () => {
    const mismatched = backend()
    mismatched.auth.verify = () =>
      Promise.resolve({
        id: 'proof',
        sessionId: 'session',
        action: 'git.network',
        actionDigest: '0'.repeat(64),
        verifiedAt: 1,
        expiresAt: 2,
      })
    const signal = new AbortController().signal
    const options = {
      port: mismatched.port,
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      connect: mismatched.connect,
      signal,
    }
    const failure = await failureOf(openNodeTerminal({ ...options, auth: mismatched.auth }))
    expect(isNodePageError(failure)).toBe(true)
    expect(mismatched.inputs).toEqual([])

    const cancelled = backend({
      onVerify: () => Promise.reject(new DOMException('denied', 'AbortError')),
    })
    const aborted = await failureOf(
      openNodeTerminal({
        ...options,
        port: cancelled.port,
        auth: cancelled.auth,
        connect: cancelled.connect,
      }),
    )
    expect(aborted).toBeInstanceOf(DOMException)
    expect(cancelled.inputs).toEqual([])
  })

  it('ends the shell when a cancel abandons the open', async () => {
    const test = backend()
    const controller = new AbortController()
    const connect: NodeTerminalSocketFactory = (terminalId: string) => {
      controller.abort()
      return test.connect(terminalId)
    }
    const failure = await failureOf(
      openNodeTerminal({
        port: test.port,
        auth: test.auth,
        workspaceId: 'ws',
        size: { cols: 80, rows: 24 },
        connect,
        signal: controller.signal,
      }),
    )
    expect(failure).toBeInstanceOf(DOMException)
    // Opened, attached, then ended: no shell is left without a reader.
    expect(test.inputs.map((call) => call.method)).toEqual([
      'node/terminal/open',
      'node/terminal/attach',
      'node/terminal/close',
    ])
  })

  it('fails the stream on foreign and malformed frames, and a valid end still lands', async () => {
    const test = backend()
    const signal = new AbortController().signal
    const session = await openNodeTerminal({
      port: test.port,
      auth: test.auth,
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      connect: test.connect,
      signal,
    })
    const seen: string[] = []
    const failures: unknown[] = []
    let finished = 0
    session.events((event) => {
      if (event.type === 'output') {
        seen.push(event.data)
      } else if (event.type === 'error') {
        failures.push(event.error)
      } else {
        finished += 1
      }
    })
    test.emit(output('other', 'dropped'))
    expect(seen).toEqual([])
    test.raw('not-json{{{')
    expect(failures).toHaveLength(2)
    expect(failures.every(isNodePageError)).toBe(true)
    // Each frame judges alone: a valid end still lands, and the failures
    // never repeat.
    test.emit(ended('t1'))
    expect(finished).toBe(1)
    test.closeStream()
    expect(failures).toHaveLength(2)
    session.close()
  })

  it('rejects bad sizes and use after close', async () => {
    const test = backend()
    const signal = new AbortController().signal
    const session = await openNodeTerminal({
      port: test.port,
      auth: test.auth,
      workspaceId: 'ws',
      size: { cols: 80, rows: 24 },
      connect: test.connect,
      signal,
    })
    for (const size of [
      { cols: 0, rows: 24 },
      { cols: 80, rows: 0 },
      { cols: NODE_MAX_TERMINAL_DIMENSION + 1, rows: 24 },
      { cols: 80.5, rows: 24 },
    ]) {
      let failure: unknown
      try {
        session.resize(size.cols, size.rows)
      } catch (error: unknown) {
        failure = error
      }
      expect(isNodePageError(failure)).toBe(true)
    }
    expect(test.frames).toEqual([])
    session.close()
    expect(() => {
      session.write('x')
    }).toThrow()
    expect(() => {
      session.resize(80, 24)
    }).toThrow()
  })

  it('attaches to a live terminal and refuses an unknown id', async () => {
    const test = backend()
    const signal = new AbortController().signal
    const session = await attachNodeTerminal({
      port: test.port,
      terminalId: 't1',
      connect: test.connect,
      signal,
    })
    expect(session.terminalId).toBe('t1')
    session.close()
    const missing = await failureOf(
      attachNodeTerminal({
        port: test.port,
        terminalId: 'nope',
        connect: test.connect,
        signal,
      }),
    )
    expect(isNodePageError(missing)).toBe(true)
    // The id is validated before any socket opens.
    expect(test.connected).toEqual(['t1'])
  })
})
