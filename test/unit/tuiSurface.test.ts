import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createTuiTerminal } from '../../src/runtime/tui/terminal'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TuiController } from '../../src/runtime/tui/controller'
import { tuiView, type InkBinding, TuiInputView } from '../../src/runtime/tui/view'
import { runTui, type TuiTerminal } from '../../src/runtime/tui/run'
import type { TuiAction, TuiConnect, TuiConnection, TuiEvent } from '../../src/runtime/tui/protocol'
import { TUI_LIMITS, UI_TEXT } from '../../src/shared/constants'
import { recordCalls } from './helpers/recordCalls'

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** The surface under its real timers: poll until the assertion holds, then fail loud. */
async function waitForOutput(
  description: string,
  check: () => void,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(10)
    }
  }
}

function fakeInk() {
  const texts: { children?: ReactNode; color?: string }[] = []
  const renders: {
    element: ReactElement
    options: { exitOnCtrlC: false; patchConsole: false }
  }[] = []
  const rerenders: ReactElement[] = []
  let unmounts = 0
  const noteUnmount = () => {
    unmounts += 1
  }
  const ink: InkBinding = {
    Text(p) {
      texts.push(p)
      return createElement('p', {}, p.children)
    },
    Box(p) {
      return createElement('div', {}, p.children)
    },
    render(element, options) {
      renders.push({ element, options })
      renderToStaticMarkup(element)
      return {
        rerender(next: ReactElement) {
          rerenders.push(next)
          renderToStaticMarkup(next)
        },
        waitUntilRenderFlush: () => Promise.resolve(),
        unmount: noteUnmount,
      }
    },
  }
  return {
    ink,
    texts,
    renders,
    rerenders,
    noteUnmount,
    unmountCount: () => unmounts,
  }
}
function viewController() {
  const sent = recordCalls<[TuiAction]>()
  const changed = recordCalls<[]>()
  const lines = recordCalls<[string]>()
  const controller = new TuiController({
    send: sent.fn,
    now: () => 0,
    changed: changed.fn,
    line: lines.fn,
  })
  return { controller, sent: sent.calls }
}
function fakeTerminal(isTTY = true) {
  let reader: ((input: string) => void) | undefined
  let interrupt: (() => void) | undefined
  let close: ((isFailed: boolean) => void) | undefined
  let cleanups = 0
  const cleanup = () => {
    cleanups += 1
  }
  let discards = 0
  const output: string[] = []
  const terminal: TuiTerminal = {
    isTTY,
    dimensions: () => ({ columns: 80, rows: 24 }),
    write(text, displayed) {
      output.push(text)
      displayed?.()
    },
    discardInput() {
      discards += 1
    },
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
    cleanupCount: () => cleanups,
    discardCount: () => discards,
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
  const sent = recordCalls<[TuiAction]>()
  let closes = 0
  const connection: TuiConnection = {
    closed,
    send: sent.fn,
    close() {
      closes += 1
      finish(undefined)
    },
  }
  return {
    connection,
    sent: sent.calls,
    closeCount: () => closes,
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
async function focusedChoice(t: ReturnType<typeof fakeTerminal>): Promise<void> {
  await sleep(TUI_LIMITS.decisionQuietMs + 1)
  t.input('\t')
  await sleep(TUI_LIMITS.decisionQuietMs + 1)
  t.input('1')
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

describe('M110 T surfaces', () => {
  it('redirected input cannot approve, even with individually paced focus and number bytes', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const { run, receive } = observedSurface(t, c)
    await sleep(10)
    try {
      receive(toolEvent)
      await focusedChoice(t)
      t.input('\n')
      expect(c.sent).toEqual([])
      receive({ type: 'settled', id: 'p' })
      t.input('1\n')
      await waitForOutput('settled numeric chat', () => {
        expect(c.sent).toEqual([[{ type: 'message', text: '1' }]])
      })
    } finally {
      t.close()
      await run
    }
  })
  it('approval requires fresh focused keys, never type-ahead or pasted decisions', async () => {
    const t = fakeTerminal()
    const c = fakeConnection()
    const { run, receive } = observedSurface(t, c)
    await waitForOutput('first line', () => {
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
      expect(c.sent).toEqual([])
      await sleep(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1')
      expect(c.sent).toEqual([])
      await sleep(TUI_LIMITS.decisionQuietMs + 1)
      t.input('\t')
      t.input('1') // Type-ahead in the focus turn is still ignored.
      expect(c.sent).toEqual([])
      await sleep(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1\n')
      expect(c.sent).toEqual([])
      t.input('\u{1B}[')
      t.input('200~')
      await sleep(TUI_LIMITS.decisionQuietMs + 1)
      t.input('1')
      t.input('\n')
      t.input('\u{1B}[201~')
      expect(c.sent).toEqual([])
      await focusedChoice(t)
      await waitForOutput('focused answer', () => {
        expect(c.sent).toEqual([
          [
            {
              type: 'answer',
              id: 'p',
              digest: 'd',
              expiresAt: 5000,
              choice: 'once',
            },
          ],
        ])
      })
      t.input('/stop\n')
      await waitForOutput('stop', () => {
        expect(c.sent.at(-1)).toEqual([{ type: 'stop', scope: 'all' }])
      })
      expect(c.sent).toHaveLength(2)
    } finally {
      t.close()
      await run
    }
  })
  it('approval viewport shows the action and paid terms independently of chat scroll', () => {
    const f = fakeInk()
    const { controller } = viewController()
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
    const text = f.texts.map((p) => (typeof p.children === 'string' ? p.children : '')).join('\n')
    expect(text).toContain('Generate image')
    expect(text).toContain('$0.04 per image')
    expect(text).toContain('$1.00')
    expect(text).toContain(`1. ${UI_TEXT.allowOnce}`)
  })
  it('oversized prices and small real viewports hide choices and reject focused answers', () => {
    const sent = recordCalls<[TuiAction]>()
    const changed = recordCalls<[]>()
    const lines = recordCalls<[string]>()
    const controller = new TuiController({
      send: sent.fn,
      now: () => 0,
      changed: changed.fn,
      line: lines.fn,
    })
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
      const rendered = f.texts.map((p) => (typeof p.children === 'string' ? p.children : ''))
      expect(rendered.length).toBeLessThanOrEqual(dimensions.rows)
      expect(rendered.join('')).not.toContain(`1. ${UI_TEXT.allowOnce}`)
      controller.key('', { tab: true })
      controller.key('1')
      expect(sent.calls).toEqual([])
    }
  })
  it('graphical approval cannot focus before renderer output is flushed', async () => {
    const t = fakeTerminal()
    const c = fakeConnection()
    const f = fakeInk()
    const flush = Promise.withResolvers<undefined>()
    const customRender: InkBinding['render'] = (element) => {
      renderToStaticMarkup(element)
      return {
        rerender: (next) => {
          renderToStaticMarkup(next)
        },
        waitUntilRenderFlush: () => flush.promise,
        unmount: f.noteUnmount,
      }
    }
    f.ink.render = customRender
    const { run, receive } = observedSurface(t, c, f.ink)
    await sleep(10)
    try {
      receive(toolEvent)
      await focusedChoice(t)
      expect(c.sent).toEqual([])
      flush.resolve(undefined)
      await focusedChoice(t)
      await waitForOutput('flushed graphical answer', () => {
        expect(c.sent).toEqual([[expect.objectContaining({ type: 'answer', id: 'p' })]])
      })
    } finally {
      t.close()
      await run
    }
  })
  it('terminal sequences never Stop or leak tails, while standalone Esc stops after its deadline', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const run = runFakeSurface(t, c, fakeInk().ink)
    await waitForOutput('first line', () => {
      expect(t.output.length).toBe(1)
    })
    try {
      t.input('\u{1B}[A\u{1B}OH\u{1B}[3~\u{1B}]0;title\u{7}\n')
      expect(c.sent).toEqual([])
      t.input('\u{1B}')
      await waitForOutput('standalone Esc stops', () => {
        expect(c.sent).toEqual([[{ type: 'stop', scope: 'all' }]])
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
      await waitForOutput('early EOF resolves', () => {
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
    expect(c.closeCount()).toBeGreaterThanOrEqual(1)
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
  it('a stalled output is bounded by the flush deadline', async () => {
    // Waits out the production 5 s flush bound with real timers.
    const input = new PassThrough()
    const output = new Writable({
      write(_chunk, _encoding, _callback) {
        /* Deliberately stalled test sink. */
      },
    })
    const c = fakeConnection()
    let result: number | undefined
    const run = (async () => {
      result = await runNative(input, output, Promise.resolve(c.connection))
    })()
    await sleep(10)
    input.end()
    try {
      await waitForOutput(
        'stalled cleanup fails',
        () => {
          expect(result).toBe(1)
        },
        15_000,
      )
    } finally {
      output.destroy()
      input.destroy()
      await run
    }
  }, 20_000)
  it('withholds and disables choices when the complete action or price cannot fit', () => {
    const f = fakeInk()
    const { controller } = viewController()
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
    const rendered = f.texts.map((props) =>
      typeof props.children === 'string' ? props.children : '',
    )
    expect(rendered.length).toBeLessThanOrEqual(24)
    expect(rendered.join('\n')).not.toContain(`1. ${UI_TEXT.allowOnce}`)
    expect(rendered.join('\n')).not.toContain(`2. ${UI_TEXT.paidAllowAlways}`)
    expect(rendered.join('\n')).not.toContain(`3. ${UI_TEXT.paidDeny}`)
    expect(rendered.join('\n')).toContain(UI_TEXT.tuiApprovalTooLarge.slice(0, 20))
    expect(f.texts.every((props) => props.color === undefined)).toBe(true)
    expect(rendered.join('\n')).toContain('Generate')
    expect(rendered.every((line) => line.length <= 80)).toBe(true)
  })
  it('80 by 24 pairing view keeps the entire fingerprint and setup code alongside choices', () => {
    const f = fakeInk()
    const { controller } = viewController()
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
    const rendered = f.texts.map((props) =>
      typeof props.children === 'string' ? props.children : '',
    )
    expect(rendered.length).toBeLessThanOrEqual(24)
    expect(rendered.every((line) => !line.includes('\n') && line.length <= 80)).toBe(true)
    expect(rendered.join('')).toContain(fingerprint)
    expect(rendered.join('')).toContain(code)
    expect(rendered.join('')).toContain(`1. ${UI_TEXT.allowOnce}`)
    expect(rendered.join('')).toContain(`2. ${UI_TEXT.paidDeny}`)
  })
  it('NO_COLOR keeps +/- and removes all colour props; Stop remains active', () => {
    const f = fakeInk()
    const sent = recordCalls<[TuiAction]>()
    const changed = recordCalls<[]>()
    const lines = recordCalls<[string]>()
    const controller = new TuiController({
      send: sent.fn,
      now: () => 0,
      changed: changed.fn,
      line: lines.fn,
    })
    controller.view = 'diff'
    controller.receive({ type: 'diff', path: 'file.ts', patch: '-old\n+new' })
    const options = { controller, ink: f.ink, columns: 80, rows: 24, noColor: true }
    const html = renderToStaticMarkup(createElement(TuiInputView, options))
    expect(html).toContain('-old')
    expect(html).toContain('+new')
    expect(f.texts.every((props) => props.color === undefined)).toBe(true)
    controller.key('', { escape: true })
    expect(sent.calls).toContainEqual([{ type: 'stop', scope: 'all' }])
    f.texts.length = 0
    renderToStaticMarkup(tuiView(controller, f.ink, { ...options, noColor: false }))
    expect(f.texts.some((props) => props.color === 'red')).toBe(true)
    expect(f.texts.some((props) => props.color === 'green')).toBe(true)
  })
  it('line mode emits one plain line per event with no renderer or refresh output', async () => {
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
    await waitForOutput('first line', () => {
      expect(t.output.length).toBe(1)
    })
    receive?.({ type: 'chat', id: 'm', role: 'agent', text: '\u{1B}[2Jhello\nworld', delta: true })
    expect(t.output.at(-1)).toBe('Agent: hello world\n')
    expect(
      t.output.every((line) => !line.includes('\u{1B}') && line.split('\n').length === 2),
    ).toBe(true)
    const count = t.output.length
    await sleep(2100)
    expect(t.output.length).toBe(count)
    t.input('hello\r\n')
    await waitForOutput('chat send', () => {
      expect(c.sent).toContainEqual([{ type: 'message', text: 'hello' }])
    })
    t.input('\u{1B}')
    t.interrupt()
    await sleep(TUI_LIMITS.escapeMs + 50)
    t.input('/status\n')
    await waitForOutput('status line', () => {
      expect(t.output.at(-1)).toContain(UI_TEXT.tuiConnecting)
    })
    t.close()
    expect(await run).toBe(0)
    expect(t.cleanupCount()).toBe(4)
  })
  it('uses linear output automatically for redirected output and suppresses input tails after overflow', async () => {
    const t = fakeTerminal(false)
    const c = fakeConnection()
    const f = fakeInk()
    const run = runFakeSurface(t, c, f.ink)
    await waitForOutput('first line', () => {
      expect(t.output.length).toBe(1)
    })
    t.input(`x${'x'.repeat(TUI_LIMITS.inputChars)}tail\n`)
    expect(t.output).toContain(`${UI_TEXT.tuiInputTooLong}\n`)
    expect(c.sent).toEqual([])
    expect(f.renders).toEqual([])
    t.close()
    expect(await run).toBe(0)
  })
  it('a disconnect fails, scrubs the error, restores terminal listeners and unmounts Ink', async () => {
    const t = fakeTerminal()
    const c = fakeConnection()
    const f = fakeInk()
    const run = runFakeSurface(t, c, f.ink)
    await waitForOutput('first render', () => {
      expect(f.renders.length).toBe(1)
    })
    c.fail()
    expect(await run).toBe(1)
    expect(t.output).toEqual([`${UI_TEXT.tuiDisconnected}\n`])
    expect(t.cleanupCount()).toBe(4)
    expect(f.renders[0]?.options).toEqual({ exitOnCtrlC: false, patchConsole: false })
    expect(f.unmountCount()).toBe(1)
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
    await waitForOutput('first line', () => {
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
    let connects = 0
    const connect: TuiConnect = () => {
      connects += 1
      return Promise.reject(new Error('must not connect'))
    }
    await expect(
      runTui({
        options: { screenReader: false, noColor: false },
        terminal: t.terminal,
        ink: undefined,
        now: () => 0,
        connect,
      }),
    ).rejects.toThrow(UI_TEXT.tuiRendererMissing)
    expect(connects).toBe(0)
  })
})

describe('M110 T native terminal adapter', () => {
  it('one Esc needs no newline, fragmented UTF-8 survives, raw mode and listeners restore', () => {
    const input = new TestInput()
    const output = new TestOutput()
    const signals = new EventEmitter()
    input.pause()
    const terminal = createTuiTerminal(input, output, signals)
    const received = recordCalls<[string]>()
    const restore = terminal.read(received.fn)
    expect(input.isRaw).toBe(true)
    const bytes = Buffer.from('日本')
    input.emit('data', bytes.subarray(0, 1))
    input.emit('data', bytes.subarray(1))
    input.emit('data', Buffer.from('\u{1B}'))
    expect(received.calls.map((call) => call[0]).join('')).toBe('日本\u{1B}')
    const interrupted = recordCalls<[]>()
    const removeInterrupt = terminal.onInterrupt(interrupted.fn)
    signals.emit('SIGINT')
    expect(interrupted.calls).toHaveLength(1)
    const closed = recordCalls<[boolean]>()
    const removeClose = terminal.onClose(closed.fn)
    const resized = recordCalls<[]>()
    const removeResize = terminal.onResize(resized.fn)
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
