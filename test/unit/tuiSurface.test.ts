import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createTuiTerminal } from '../../src/runtime/tui/terminal'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiController } from '../../src/runtime/tui/controller'
import { tuiView, type InkBinding, TuiInputView } from '../../src/runtime/tui/view'
import { runTui, type TuiTerminal } from '../../src/runtime/tui/run'
import type { TuiConnect, TuiConnection, TuiEvent } from '../../src/runtime/tui/protocol'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'

const toolEvent: TuiEvent = {
  type: 'ask',
  ask: {
    kind: 'tool',
    id: 'p',
    digest: 'd',
    expiresAt: 5000,
    title: 'Run check',
    detail: 'npm run check',
  },
}

function fakeInk() {
  const props: { children?: ReactNode; color?: string }[] = []
  const unmount = vi.fn()
  const ink: InkBinding = {
    Text(p) {
      props.push(p)
      return createElement('p', {}, p.children)
    },
    Box(p) {
      return createElement('div', {}, p.children)
    },
    render: vi.fn(
      (element: ReactElement, _options: { exitOnCtrlC: false; patchConsole: false }) => {
        renderToStaticMarkup(element)
        return {
          rerender: vi.fn((next: ReactElement) => {
            renderToStaticMarkup(next)
          }),
          waitUntilRenderFlush: () => Promise.resolve(),
          unmount,
        }
      },
    ),
  }
  return {
    ink,
    unmount,
    props,
  }
}
function viewController() {
  return new TuiController({ send: vi.fn(), now: () => 0, changed: vi.fn(), line: vi.fn() })
}
function fakeTerminal(isTTY = true) {
  let reader: ((input: string) => void) | undefined
  let interrupt: (() => void) | undefined
  let close: ((isFailed: boolean) => void) | undefined
  const cleanup = vi.fn()
  const output: string[] = []
  const terminal: TuiTerminal = {
    isTTY,
    dimensions: () => ({ columns: 80, rows: 24 }),
    write(text, displayed) {
      output.push(text)
      displayed?.()
    },
    discardInput: vi.fn(),
    flush: () => Promise.resolve(),
    read(handler) {
      reader = handler
      return cleanup
    },
    onResize: () => cleanup,
    onInterrupt(handler) {
      interrupt = handler
      return cleanup
    },
    onClose(handler) {
      close = handler
      return cleanup
    },
  }
  return {
    terminal,
    output,
    cleanup,
    input(text: string) {
      reader?.(text)
    },
    interrupt() {
      interrupt?.()
    },
    close() {
      close?.(false)
    },
  }
}
function fakeConnection() {
  const { promise: closed, resolve: finish, reject: fail } = Promise.withResolvers<undefined>()
  const connection: TuiConnection = {
    closed,
    send: vi.fn(),
    close: vi.fn(() => {
      finish(undefined)
    }),
  }
  return {
    connection,
    fail() {
      fail(new Error('wire error with private account text'))
    },
  }
}
function runFakeSurface(
  t: ReturnType<typeof fakeTerminal>,
  c: ReturnType<typeof fakeConnection>,
  ink: InkBinding | undefined,
  connect: TuiConnect = () => Promise.resolve(c.connection),
) {
  return runTui({
    options: { screenReader: ink === undefined, noColor: false },
    terminal: t.terminal,
    ink,
    now: () => 0,
    connect,
  })
}
function observedSurface(
  t: ReturnType<typeof fakeTerminal>,
  c: ReturnType<typeof fakeConnection>,
  ink?: InkBinding,
) {
  let observer: ((event: TuiEvent) => void) | undefined
  const run = runFakeSurface(t, c, ink, (handler) => {
    observer = handler
    return Promise.resolve(c.connection)
  })
  return {
    run,
    receive(event: TuiEvent) {
      observer?.(event)
    },
  }
}
async function focusedChoice(t: ReturnType<typeof fakeTerminal>, choice: string): Promise<void> {
  await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
  t.input('\t')
  await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
  t.input(choice)
}
function runNative(
  input: PassThrough,
  output: Writable,
  connection: Promise<TuiConnection>,
): Promise<number> {
  return runTui({
    options: { screenReader: true, noColor: true },
    terminal: createTuiTerminal(input, output, new EventEmitter()),
    ink: undefined,
    now: () => 0,
    connect: () => connection,
  })
}
afterEach(() => {
  vi.useRealTimers()
})

describe('M110 T surfaces', () => {
  it('redirected input cannot approve, even with individually paced focus and number bytes', async () => {
    vi.useFakeTimers()
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const { run, receive } = observedSurface(t, c)
    await vi.advanceTimersByTimeAsync(0)
    try {
      receive(toolEvent)
      await focusedChoice(t, '1')
      t.input('\n')
      expect(c.connection.send).not.toHaveBeenCalled()
      receive({ type: 'settled', id: 'p' })
      t.input('1\n')
      expect(c.connection.send).toHaveBeenCalledExactlyOnceWith({ type: 'message', text: '1' })
    } finally {
      t.close()
      await run
    }
  })
  it('approval requires fresh focused keys, never type-ahead or pasted decisions', async () => {
    vi.useFakeTimers()
    const t = fakeTerminal()
    const c = fakeConnection()
    const { run, receive } = observedSurface(t, c)
    await vi.waitFor(() => {
      expect(t.output.length).toBe(1)
    })
    try {
      t.input('1')
      receive({
        type: 'ask',
        ask: {
          kind: 'paid',
          id: 'p',
          digest: 'd',
          expiresAt: 5000,
          title: 'Generate',
          detail: 'Draw',
          price: '$0.04 per image',
          dailyBudgetUsd: 1,
        },
      })
      t.input('\n')
      t.input('1\n')
      t.input('\u{1B}[200~1\n\u{1B}[201~')
      expect(c.connection.send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1')
      expect(c.connection.send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
      t.input('\t')
      t.input('1') // Type-ahead in the focus turn is still ignored.
      expect(c.connection.send).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1\n')
      expect(c.connection.send).not.toHaveBeenCalled()
      t.input('\u{1B}[')
      t.input('200~')
      await vi.advanceTimersByTimeAsync(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1')
      t.input('\n')
      t.input('\u{1B}[201~')
      expect(c.connection.send).not.toHaveBeenCalled()
      await focusedChoice(t, '1')
      expect(c.connection.send).toHaveBeenCalledExactlyOnceWith({
        type: 'answer',
        id: 'p',
        digest: 'd',
        expiresAt: 5000,
        choice: 'once',
      })
      t.input('/stop\n')
      expect(c.connection.send).toHaveBeenLastCalledWith({ type: 'stop', scope: 'all' })
      expect(c.connection.send).toHaveBeenCalledTimes(2)
    } finally {
      t.close()
      await run
    }
  })
  it('approval viewport shows the action and paid terms independently of chat scroll', () => {
    const f = fakeInk()
    const controller = viewController()
    for (let index = 0; index < 10; index++) controller.key('', { upArrow: true })
    controller.receive({
      type: 'ask',
      ask: {
        kind: 'paid',
        id: 'p',
        digest: 'd',
        expiresAt: 5000,
        title: 'Generate image',
        detail: 'Draw a tree',
        price: '$0.04 per image',
        dailyBudgetUsd: 1,
      },
    })
    renderToStaticMarkup(tuiView(controller, f.ink, { columns: 80, rows: 24, noColor: true }))
    const text = f.props.map((p) => (typeof p.children === 'string' ? p.children : '')).join('\n')
    expect(text).toContain('Generate image')
    expect(text).toContain('$0.04 per image')
    expect(text).toContain('$1.00')
    expect(text).toContain('1. Allow once')
  })
  it('oversized prices and small real viewports hide choices and reject focused answers', () => {
    const send = vi.fn()
    const controller = new TuiController({ send, now: () => 0, changed: vi.fn(), line: vi.fn() })
    const ask = {
      kind: 'paid' as const,
      id: 'p',
      digest: 'd',
      expiresAt: 5000,
      title: 'Generate image',
      detail: 'Draw a tree',
      price: '$0.04 '.repeat(1000),
      dailyBudgetUsd: 1,
    }
    controller.receive({ type: 'ask', ask })
    controller.presentAsk(controller.state.asks[0])
    controller.key('', { tab: true })
    for (const dimensions of [
      { columns: 80, rows: 24 },
      { columns: 10, rows: 4 },
    ]) {
      const f = fakeInk()
      renderToStaticMarkup(tuiView(controller, f.ink, { ...dimensions, noColor: true }))
      const lines = f.props.map((p) => (typeof p.children === 'string' ? p.children : ''))
      expect(lines.length).toBeLessThanOrEqual(dimensions.rows)
      expect(lines.join('')).not.toContain('1. Allow once')
      controller.key('', { tab: true })
      controller.key('1')
      expect(send).not.toHaveBeenCalled()
    }
  })
  it('graphical approval cannot focus before renderer output is flushed', async () => {
    vi.useFakeTimers()
    const t = fakeTerminal()
    const c = fakeConnection()
    const f = fakeInk()
    const flush = Promise.withResolvers<undefined>()
    f.ink.render = (element) => {
      renderToStaticMarkup(element)
      return {
        rerender: (next) => {
          renderToStaticMarkup(next)
        },
        waitUntilRenderFlush: () => flush.promise,
        unmount: f.unmount,
      }
    }
    const { run, receive } = observedSurface(t, c, f.ink)
    await vi.advanceTimersByTimeAsync(0)
    try {
      receive(toolEvent)
      await focusedChoice(t, '1')
      expect(c.connection.send).not.toHaveBeenCalled()
      flush.resolve(undefined)
      await focusedChoice(t, '1')
      expect(c.connection.send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: 'answer', id: 'p' }),
      )
    } finally {
      t.close()
      await run
    }
  })
  it('terminal sequences never Stop or leak tails, while standalone Esc stops after its deadline', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const run = runFakeSurface(t, c, fakeInk().ink)
    await vi.waitFor(() => {
      expect(t.output.length).toBe(1)
    })
    try {
      t.input('\u{1B}[A\u{1B}OH\u{1B}[3~\u{1B}]0;title\u{7}\n')
      expect(c.connection.send).not.toHaveBeenCalled()
      t.input('\u{1B}')
      await vi.waitFor(() => {
        expect(c.connection.send).toHaveBeenCalledExactlyOnceWith({ type: 'stop', scope: 'all' })
      })
    } finally {
      t.close()
      await run
    }
  })
  it('EOF during connection setup ends the surface before the late connection resolves', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const c = fakeConnection()
    const opening = Promise.withResolvers<TuiConnection>()
    let result: number | undefined
    const run = (async () => {
      result = await runNative(input, output, opening.promise)
    })()
    input.resume()
    input.end()
    try {
      await vi.waitFor(() => {
        expect(result).toBe(0)
      })
    } finally {
      opening.resolve(c.connection)
      c.connection.close()
      await run
      input.destroy()
      output.destroy()
    }
  })
  it('asynchronous terminal output errors fail with a nonzero exit', async () => {
    const input = new PassThrough()
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => {
          callback(new Error('private output error'))
        })
      },
    })
    const c = fakeConnection()
    const result = await runNative(input, output, Promise.resolve(c.connection))
    expect(result).toBe(1)
    expect(c.connection.close).toHaveBeenCalled()
    input.destroy()
    output.destroy()
  })
  it('EOF cannot report success before a pending output write fails', async () => {
    const input = new PassThrough()
    const c = fakeConnection()
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        input.end()
        setImmediate(() => {
          callback(new Error('private late write failure'))
        })
      },
    })
    const result = await runNative(input, output, Promise.resolve(c.connection))
    expect(result).toBe(1)
    expect(output.listenerCount('error')).toBe(0)
    input.destroy()
    output.destroy()
  })
  it('a stalled terminal output cannot hold EOF cleanup beyond its deadline', async () => {
    vi.useFakeTimers()
    const input = new PassThrough()
    const output = new Writable({
      write(_chunk, _encoding, _callback) {
        /* Deliberately stalled sink; cleanup must remain bounded. */
      },
    })
    const c = fakeConnection()
    let result: number | undefined
    const run = (async () => {
      result = await runNative(input, output, Promise.resolve(c.connection))
    })()
    await vi.advanceTimersByTimeAsync(0)
    input.end()
    try {
      await vi.advanceTimersByTimeAsync(TUI_LIMITS.outputMs + 1)
      expect(result).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await vi.runOnlyPendingTimersAsync()
      output.destroy()
      input.destroy()
      await run
    }
  })
  it('withholds and disables choices when the complete action or price cannot fit', () => {
    const f = fakeInk()
    const controller = viewController()
    controller.receive({
      type: 'ask',
      ask: {
        kind: 'paid',
        id: 'p',
        digest: 'd',
        expiresAt: 5000,
        title: 'Generate',
        detail: 'long detail '.repeat(1000),
        price: '$0.04 per image',
        dailyBudgetUsd: 1,
      },
    })
    renderToStaticMarkup(tuiView(controller, f.ink, { columns: 80, rows: 24, noColor: false }))
    const lines = f.props.map((props) => (typeof props.children === 'string' ? props.children : ''))
    expect(lines.length).toBeLessThanOrEqual(24)
    expect(lines.join('\n')).not.toContain('1. Allow once')
    expect(lines.join('\n')).not.toContain('2. Allow always in this workspace')
    expect(lines.join('\n')).not.toContain('3. Deny')
    expect(lines.join('\n')).toContain(UI_TEXT.tuiApprovalTooLarge.slice(0, 20))
    expect(f.props.every((props) => props.color === undefined)).toBe(true)
    expect(lines.join('\n')).toContain('Generate')
    expect(lines.every((line) => line.length <= 80)).toBe(true)
  })

  it('80 by 24 pairing view keeps the entire fingerprint and setup code alongside choices', () => {
    const f = fakeInk()
    const controller = viewController()
    const fingerprint = 'ab'.repeat(32)
    const code = 'z'.repeat(TUI_LIMITS.setupCodeChars)
    controller.receive({
      type: 'status',
      node: 'name\n'.repeat(100),
      attended: true,
      cpuPercent: 1,
      memoryBytes: 1000,
      sealed: true,
    })
    controller.receive({ type: 'pairing', fingerprint, setup: { code, expiresAt: 5000 } })
    controller.receive({
      type: 'ask',
      ask: {
        kind: 'tool',
        id: 'p',
        digest: 'd',
        expiresAt: 5000,
        title: 'Review',
        detail: 'review command',
      },
    })
    renderToStaticMarkup(tuiView(controller, f.ink, { columns: 80, rows: 24, noColor: true }))
    const lines = f.props.map((props) => (typeof props.children === 'string' ? props.children : ''))
    expect(lines.length).toBeLessThanOrEqual(24)
    expect(lines.every((line) => !line.includes('\n') && line.length <= 80)).toBe(true)
    expect(lines.join('')).toContain(fingerprint)
    expect(lines.join('')).toContain(code)
    expect(lines.join('')).toContain('1. Allow once')
    expect(lines.join('')).toContain('2. Deny')
  })
  it('NO_COLOR keeps +/- and removes all colour props; Stop remains active', () => {
    const f = fakeInk()
    const send = vi.fn()
    const controller = new TuiController({ send, now: () => 0, changed: vi.fn(), line: vi.fn() })
    controller.view = 'diff'
    controller.receive({ type: 'diff', path: 'file.ts', patch: '-old\n+new' })
    const options = { controller, ink: f.ink, columns: 80, rows: 24, noColor: true }
    const html = renderToStaticMarkup(createElement(TuiInputView, options))
    expect(html).toContain('-old')
    expect(html).toContain('+new')
    expect(f.props.every((props) => props.color === undefined)).toBe(true)
    controller.key('', { escape: true })
    expect(send).toHaveBeenCalledWith({ type: 'stop', scope: 'all' })
    f.props.length = 0
    renderToStaticMarkup(tuiView(controller, f.ink, { ...options, noColor: false }))
    expect(f.props.some((props) => props.color === 'red')).toBe(true)
    expect(f.props.some((props) => props.color === 'green')).toBe(true)
  })
  it('line mode emits one plain line per event with no renderer or refresh output', async () => {
    vi.useFakeTimers()
    const t = fakeTerminal()
    const c = fakeConnection()
    let receive: ((event: TuiEvent) => void) | undefined
    const run = runTui({
      options: { screenReader: true, noColor: true },
      terminal: t.terminal,
      ink: undefined,
      now: () => Date.now(),
      connect: (handler) => {
        receive = handler
        return Promise.resolve(c.connection)
      },
    })
    await vi.waitFor(() => {
      expect(t.output.length).toBe(1)
    })
    receive?.({ type: 'chat', id: 'm', role: 'agent', text: '\u{1B}[2Jhello\nworld', delta: true })
    expect(t.output.at(-1)).toBe('Agent: hello world\n')
    expect(
      t.output.every((line) => !line.includes('\u{1B}') && line.split('\n').length === 2),
    ).toBe(true)
    const count = t.output.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.output.length).toBe(count)
    t.input('hello\r\n')
    expect(c.connection.send).toHaveBeenCalledWith({ type: 'message', text: 'hello' })
    t.input('\u{1B}')
    t.interrupt()
    expect(c.connection.send).toHaveBeenCalledWith({ type: 'stop', scope: 'all' })
    await vi.advanceTimersByTimeAsync(TUI_LIMITS.escapeMs)
    t.input('/status\n')
    expect(t.output.at(-1)).toContain(UI_TEXT.tuiConnecting)
    t.close()
    expect(await run).toBe(0)
    expect(t.cleanup).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses linear output automatically for redirected output and suppresses input tails after overflow', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const f = fakeInk()
    const run = runFakeSurface(t, c, f.ink)
    await vi.waitFor(() => {
      expect(t.output.length).toBe(1)
    })
    t.input('x'.repeat(TUI_LIMITS.inputChars + 1) + 'tail\n')
    expect(t.output).toContain(`${UI_TEXT.tuiInputTooLong}\n`)
    expect(c.connection.send).not.toHaveBeenCalled()
    expect(f.ink.render).not.toHaveBeenCalled()
    t.close()
    expect(await run).toBe(0)
  })
  it('a disconnect fails, scrubs the error, restores terminal listeners and unmounts Ink', async () => {
    const t = fakeTerminal()
    const c = fakeConnection()
    const f = fakeInk()
    const run = runFakeSurface(t, c, f.ink)
    await vi.waitFor(() => {
      expect(f.ink.render).toHaveBeenCalled()
    })
    c.fail()
    expect(await run).toBe(1)
    expect(t.output).toEqual([`${UI_TEXT.tuiDisconnected}\n`])
    expect(t.cleanup).toHaveBeenCalledTimes(4)
    expect(f.ink.render).toHaveBeenCalledWith(expect.anything(), {
      exitOnCtrlC: false,
      patchConsole: false,
    })
    expect(f.unmount).toHaveBeenCalled()
  })
  it('a failed action write closes the surface without throwing from the input callback', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    c.connection.send = () => {
      throw new Error('private send failure')
    }
    const run = runTui({
      options: { screenReader: true, noColor: true },
      terminal: t.terminal,
      ink: undefined,
      now: () => 0,
      connect: () => Promise.resolve(c.connection),
    })
    await vi.waitFor(() => {
      expect(t.output.length).toBe(1)
    })
    let result: number
    try {
      expect(() => {
        t.input('hello\n')
      }).not.toThrow()
    } finally {
      t.close()
      result = await run
    }
    expect(result).toBe(1)
    expect(t.output.join('')).not.toContain('private send failure')
  })
  it('requires Ink for a graphical terminal before connecting', async () => {
    const t = fakeTerminal()
    const connect = vi.fn()
    await expect(
      runTui({
        options: { screenReader: false, noColor: false },
        terminal: t.terminal,
        ink: undefined,
        now: () => 0,
        connect,
      }),
    ).rejects.toThrow(UI_TEXT.tuiRendererMissing)
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('M110 T native terminal adapter', () => {
  it('one Esc needs no newline, fragmented UTF-8 survives, raw mode and listeners restore', () => {
    const input = new TestInput()
    const output = new TestOutput()
    const signals = new EventEmitter()
    input.pause()
    const terminal = createTuiTerminal(input, output, signals)
    const receive = vi.fn()
    const restore = terminal.read(receive)
    expect(input.isRaw).toBe(true)
    const bytes = Buffer.from('日本')
    input.emit('data', bytes.subarray(0, 1))
    input.emit('data', bytes.subarray(1))
    input.emit('data', Buffer.from('\u{1B}'))
    expect(
      receive.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : '')).join(''),
    ).toBe('日本\u{1B}')
    const interrupt = vi.fn()
    const removeInterrupt = terminal.onInterrupt(interrupt)
    signals.emit('SIGINT')
    expect(interrupt).toHaveBeenCalledTimes(1)
    const removeClose = terminal.onClose(vi.fn())
    const removeResize = terminal.onResize(vi.fn())
    expect(terminal.dimensions()).toEqual({ columns: 80, rows: 24 })
    restore()
    removeClose()
    removeInterrupt()
    removeResize()
    expect(input.isRaw).toBe(false)
    expect(input.isPaused()).toBe(true)
    expect(input.readableEncoding).toBeNull()
    expect(input.listenerCount('data')).toBe(0)
    expect(output.listenerCount('resize')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    input.destroy()
    output.destroy()
  })
  it('a stalled output is bounded and a closed output refuses writes', () => {
    const input = new TestInput()
    const output = new Writable({
      write(_chunk, _encoding, _callback) {
        /* Deliberately stalled test sink. */
      },
    })
    const terminal = createTuiTerminal(input, output, new EventEmitter())
    expect(terminal.isTTY).toBe(false)
    terminal.write('x'.repeat(TUI_LIMITS.frameBytes))
    expect(() => {
      terminal.write('next')
    }).toThrow(UI_TEXT.tuiDisconnected)
    output.destroy()
    expect(() => {
      terminal.write('next')
    }).toThrow(UI_TEXT.tuiDisconnected)
    input.destroy()
  })
})

class TestInput extends PassThrough {
  isTTY = true
  isRaw = false
  setRawMode(isRaw: boolean): void {
    this.isRaw = isRaw
  }
}
class TestOutput extends PassThrough {
  isTTY = true
}
