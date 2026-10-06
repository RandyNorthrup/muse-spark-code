import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createTuiTerminal } from '../../src/runtime/tui/terminal'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiController } from '../../src/runtime/tui/controller'
import { tuiView, type InkBinding, TuiInputView } from '../../src/runtime/tui/view'
import { runTui, type TuiTerminal } from '../../src/runtime/tui/run'
import type { TuiConnection, TuiEvent } from '../../src/runtime/tui/protocol'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'

function fakeInk() {
  let capturedKey: TuiController['key'] | undefined
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
    useInput(handler) {
      capturedKey = handler
    },
    render: vi.fn(
      (_element: ReactElement, _options: { exitOnCtrlC: false; patchConsole: false }) => ({
        rerender: vi.fn(),
        unmount,
      }),
    ),
  }
  return {
    ink,
    unmount,
    props,
    key(input: string) {
      capturedKey?.(input, { escape: true })
    },
  }
}
function viewController() {
  return new TuiController({ send: vi.fn(), now: () => 0, changed: vi.fn(), line: vi.fn() })
}
function fakeTerminal(isTTY = true) {
  let reader: ((input: string) => void) | undefined
  let interrupt: (() => void) | undefined
  let close: (() => void) | undefined
  const cleanup = vi.fn()
  const output: string[] = []
  const terminal: TuiTerminal = {
    isTTY,
    dimensions: () => ({ columns: 80, rows: 24 }),
    write(text) {
      output.push(text)
    },
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
      close?.()
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
  ink: InkBinding,
) {
  return runTui({
    options: { screenReader: false, noColor: false },
    terminal: t.terminal,
    ink,
    now: () => 0,
    connect: () => Promise.resolve(c.connection),
  })
}
afterEach(() => {
  vi.useRealTimers()
})

describe('M110 T surfaces', () => {
  it('renders equal numbered approval choices at 80 by 24 even with a long detail', () => {
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
    expect(lines.join('\n')).toContain('1. Allow once')
    expect(lines.join('\n')).toContain('2. Allow always in this workspace')
    expect(lines.join('\n')).toContain('3. Deny')
    expect(f.props.every((props) => props.color === undefined)).toBe(true)
    expect(lines.join('\n')).toContain('$0.04 per image')
    expect(lines.join('\n')).toContain('$1.00')
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
  it('NO_COLOR keeps +/- and removes all colour props; keyboard hook remains active', () => {
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
    f.key('')
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
    expect(t.cleanup).toHaveBeenCalledTimes(3)
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
