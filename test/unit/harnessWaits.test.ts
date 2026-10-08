import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const DOM_METHODS = new Set([
  'querySelector',
  'querySelectorAll',
  'click',
  'focus',
  'setValue',
  'dispatchEvent',
  'setSelectionRange',
  'selectNodeContents',
])

/** Parse callbacks and their named helpers; strings and comments are not code. */
function delayedDom(html: string): string[] {
  const failures: string[] = []
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const code = script[1]!
    const tree = ts.createSourceFile(
      'harness.js',
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    const helpers = new Map<string, ts.Node>()
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        helpers.set(node.name.text, node.initializer)
      } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
        helpers.set(node.name.text, node)
      }
      ts.forEachChild(node, collect)
    }
    collect(tree)

    const hasDomWork = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
      if (seen.has(node)) return false
      seen.add(node)
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        let name: string | undefined
        if (ts.isIdentifier(callee)) {
          name = callee.text
        } else if (ts.isPropertyAccessExpression(callee)) {
          name = callee.name.text
        } else if (
          ts.isElementAccessExpression(callee) &&
          ts.isStringLiteral(callee.argumentExpression)
        ) {
          name = callee.argumentExpression.text
        }
        if (name !== undefined && DOM_METHODS.has(name)) return true
        if (ts.isIdentifier(callee)) {
          const helper = helpers.get(callee.text)
          if (helper !== undefined && hasDomWork(helper, seen)) return true
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ['value', 'scrollTop'].includes(node.left.name.text)
      ) {
        return true
      }
      // Identifier callbacks, e.g. later(100, expand), also follow their helper.
      if (ts.isIdentifier(node)) {
        const helper = helpers.get(node.text)
        if (helper !== undefined && hasDomWork(helper, seen)) return true
      }
      return ts.forEachChild(node, (child) => hasDomWork(child, seen) || undefined) === true
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['later', 'readinessLater'].includes(node.expression.text)
      ) {
        const callback = node.arguments[1]
        const comments = code.slice(node.getFullStart(), node.getStart(tree))
        const hasReason = /\/\/ kept-timing: \S[^\n]*|\/\* kept-timing: \S[\s\S]*?\*\//.test(
          comments,
        )
        if (!hasReason) {
          const kind = callback !== undefined && hasDomWork(callback) ? 'DOM interaction' : 'Timer'
          failures.push(`${kind} without a kept-timing reason: ${node.getText(tree)}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return failures
}

// The counted primitives: `later`, `whenFound`, `whenEvent` and `track` keep a
// scene unplayed until their work settles (`readinessLater` is readiness only).
const COUNTED_HELPERS = new Set(['later', 'readinessLater', 'whenFound', 'whenEvent', 'track'])
// Registrations whose callback runs after the step that made them returned.
const ASYNC_CALLS = new Set([
  'addEventListener',
  'then',
  'catch',
  'finally',
  'fetch',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
])
const COUNTED_REASON = /\/\/ counted: \S[^\n]*/

/**
 * Asynchronous work a scene (every `steps` entry, and the fake host's
 * `postMessage` replies) starts outside the counted helpers, following the
 * named helpers it calls. Such work could still be running when the page
 * says the scene was played; a `// counted: <reason>` comment before the
 * statement records work the scene counts by hand.
 */
function uncountedAsync(html: string): string[] {
  const trees = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), (script) =>
    ts.createSourceFile('harness.js', script[1]!, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS),
  )
  const helpers = new Map<string, ts.Node>()
  const roots: ts.Node[] = []
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.name.text === 'steps') roots.push(node.initializer)
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        helpers.set(node.name.text, node.initializer)
      }
    } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      helpers.set(node.name.text, node)
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'postMessage' &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      roots.push(node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  for (const tree of trees) collect(tree)
  const failures: string[] = []
  const seen = new Set<ts.Node>()
  const isCounted = (node: ts.Node) => {
    let statement: ts.Node = node
    while (!ts.isStatement(statement) && !ts.isSourceFile(statement)) statement = statement.parent
    const tree = statement.getSourceFile()
    return COUNTED_REASON.test(tree.text.slice(statement.getFullStart(), statement.getStart(tree)))
  }
  const flag = (node: ts.Node, what: string) => {
    if (!isCounted(node)) failures.push(`${what}: ${node.getText().split('\n', 1)[0]!}`)
  }
  const calleeName = (callee: ts.Expression) => {
    if (ts.isIdentifier(callee)) return callee.text
    return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
  }
  const visit = (node: ts.Node): void => {
    if (seen.has(node)) return
    seen.add(node)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = calleeName(callee)
      // A tracked promise is counted whole, its own chain included.
      if (name === 'track' && ts.isIdentifier(callee)) return
      if (name !== undefined && ASYNC_CALLS.has(name)) flag(node, `uncounted ${name}`)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      /^on[a-z]+$/.test(node.left.name.text)
    ) {
      flag(node, `uncounted ${node.left.name.text}`)
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Promise'
    ) {
      flag(node, 'uncounted Promise')
    } else if (ts.isIdentifier(node) && !COUNTED_HELPERS.has(node.text)) {
      const helper = helpers.get(node.text)
      if (helper !== undefined) visit(helper)
    }
    ts.forEachChild(node, visit)
  }
  for (const root of roots) visit(root)
  return failures
}

interface ScheduledEvent {
  delay: number
  run: () => void
}

function harnessSection(start: string, end: string): string {
  const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
  const first = html.indexOf(start)
  const last = html.indexOf(end, first)
  expect(first).toBeGreaterThanOrEqual(0)
  expect(last).toBeGreaterThan(first)
  return html.slice(first, last)
}

function runNext(timers: ScheduledEvent[]): void {
  const timer = timers.shift()
  if (timer === undefined) throw new Error('No scheduled harness event')
  timer.run()
}

function scenarioClock() {
  const timers: ScheduledEvent[] = []
  const counts: number[] = []
  return {
    timers,
    counts,
    context: {
      setTimeout: (run: () => void, delay: number) => {
        timers.push({ run, delay })
      },
      observe: (count: number) => {
        counts.push(count)
      },
    },
  }
}

/** The scheduling helpers on a page whose controls `find` returns (null: not rendered). */
function playedScene(find: (selector: string) => unknown) {
  const { timers, context } = scenarioClock()
  const dataset: Record<string, string> = {}
  const page = {
    ...context,
    document: {
      querySelector: find,
      documentElement: { dataset },
    },
  }
  return {
    source: harnessSection('let pendingScenarioEvents =', 'const files = ['),
    timers,
    dataset,
    page,
  }
}

/** Runs every scheduled step, returning the failures as the page's error text. */
function drain(timers: ScheduledEvent[]): string[] {
  const errors: string[] = []
  while (timers.length > 0) {
    try {
      runNext(timers)
    } catch (error) {
      // The page's own Error, from another realm: compare its text.
      errors.push(String(error))
    }
  }
  return errors
}

function jumpSource(): string {
  const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
  const source = /jump: (\(\) => \{[\s\S]*?\n {8}\}),\n {8}\/\/ --- M16:/.exec(html)?.[1]
  if (source === undefined) throw new Error('The jump fixture is missing')
  return source
}

/** The real `jump` scene on the real helpers, claimed and started; scroll is native. */
function jumpScene() {
  const source = jumpSource()
  const main = new EventTarget()
  let top = 0
  Object.defineProperty(main, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = value
    },
  })
  let isMainRendered = true
  const scene = playedScene((selector) => {
    if (selector === 'main') return isMainRendered ? main : null
    return ['[data-entry-id="long"] .hljs-keyword', '.jump-latest'].includes(selector) ? {} : null
  })
  const messages: unknown[] = []
  Object.assign(scene.page, {
    window: {},
    setDraft: () => undefined,
    key: () => undefined,
    longReply: () => '',
    event: (message: unknown) => {
      messages.push(message)
    },
  })
  runInNewContext(`${scene.source}\n playingScenario = 'jump'; (${source})()`, scene.page)
  return {
    scene,
    main,
    messages,
    unmountMain: () => {
      isMainRendered = false
    },
  }
}

function readinessPage(now: () => number) {
  return {
    performance: { now },
    document: { querySelector: () => null, fonts: { ready: Promise.resolve() } },
    hasPageLoaded: true,
    pendingFinds: 0,
    pendingScenarioEvents: 1,
    SCENARIO_READY: {},
    READY_TIMEOUT_MS: 10_000,
    READY_POLL_MS: 50,
    finiteAnimations: () => [],
  }
}

function longStream() {
  const timers: ScheduledEvent[] = []
  let receive: ((message: { readonly data: unknown }) => void) | undefined
  let nextBatch: (() => void) | undefined
  const delivered = vi.fn<(message: unknown) => void>()
  const window = {
    addEventListener: vi.fn((_type: string, callback: NonNullable<typeof receive>) => {
      receive = callback
    }),
    removeEventListener: vi.fn(() => {
      receive = undefined
    }),
    dispatchEvent: vi.fn((message: { readonly data: { readonly event: unknown } }) => {
      delivered(message.data.event)
      return true
    }),
  }
  const port1 = {
    set onmessage(callback: () => void) {
      nextBatch = callback
    },
    close: vi.fn(),
  }
  const port2 = {
    postMessage: vi.fn(() => {
      if (nextBatch === undefined) throw new Error('Missing next batch')
      timers.push({ delay: 0, run: nextBatch })
    }),
    close: vi.fn(),
  }
  const event = vi.fn<(message: unknown) => void>((message) => {
    timers.push({
      delay: 0,
      run: () => {
        if (receive === undefined) throw new Error('Missing stream receiver')
        delivered(message)
        receive({ data: { type: 'agentEvent', event: message } })
      },
    })
  })
  const report = vi.fn()
  const context = {
    pendingScenarioEvents: 0,
    failScene: vi.fn(),
    notePlayed: vi.fn(),
    window,
    setDraft: vi.fn(),
    key: vi.fn(),
    event,
    report,
    MessageEvent,
    MessageChannel: function () {
      return { port1, port2 }
    },
    longReply: () => 'x'.repeat(2050),
  }
  const start = () => {
    const source = harnessSection('long: () => {', 'focus: () => {')
    const batch = harnessSection('const LONG_STREAM_BATCH_DELTAS =', 'const SETTLE_MS =')
    runInNewContext(`${batch} const steps = {${source}}; steps.long();`, context)
  }
  return { timers, context, event, delivered, report, window, port1, port2, start }
}

describe('harness scenario event readiness', () => {
  it('delivers every 100-character frame in order, yielding between bounded batches', () => {
    const fixture = longStream()
    fixture.start()
    expect(fixture.event).toHaveBeenCalledOnce()
    expect(fixture.delivered).not.toHaveBeenCalled()
    expect(fixture.context.pendingScenarioEvents).toBe(1)
    runNext(fixture.timers)
    expect(fixture.delivered).toHaveBeenCalledTimes(21)
    expect(fixture.context.pendingScenarioEvents).toBe(1)
    expect(fixture.report).not.toHaveBeenCalled()
    expect(fixture.context.notePlayed).not.toHaveBeenCalled()
    expect(fixture.port2.postMessage).toHaveBeenCalledOnce()
    runNext(fixture.timers)
    expect(fixture.delivered.mock.calls.map(([message]) => message)).toEqual([
      {
        type: 'itemStarted',
        item: { itemId: 'long', kind: 'agentMessage', status: 'inProgress', text: '' },
      },
      ...[...Array.from({ length: 20 }, () => 100), 50].map((length) => ({
        type: 'textDelta',
        itemId: 'long',
        field: 'text',
        delta: 'x'.repeat(length),
      })),
      {
        type: 'itemCompleted',
        item: { itemId: 'long', kind: 'agentMessage', status: 'completed' },
      },
    ])
    expect(fixture.context.pendingScenarioEvents).toBe(0)
    expect(fixture.report).toHaveBeenCalledWith('long: 21 deltas rendered')
    // The stream ends outside `later`, so it reports the scene played itself.
    expect(fixture.context.notePlayed).toHaveBeenCalledOnce()
    expect(fixture.context.failScene).not.toHaveBeenCalled()
    expect(fixture.window.removeEventListener).toHaveBeenCalledOnce()
    expect(fixture.port1.close).toHaveBeenCalledOnce()
    expect(fixture.port2.close).toHaveBeenCalledOnce()
    expect(fixture.timers).toHaveLength(0)
  })

  it('keeps readiness pending through dispatch of the completion frame', () => {
    const fixture = longStream()
    fixture.start()
    runNext(fixture.timers)
    fixture.window.dispatchEvent.mockImplementation((message) => {
      expect(fixture.context.pendingScenarioEvents).toBe(1)
      expect(fixture.report).not.toHaveBeenCalled()
      fixture.delivered(message.data.event)
      return true
    })
    runNext(fixture.timers)
    expect(fixture.delivered).toHaveBeenLastCalledWith({
      type: 'itemCompleted',
      item: { itemId: 'long', kind: 'agentMessage', status: 'completed' },
    })
    expect(fixture.context.pendingScenarioEvents).toBe(0)
    expect(fixture.report).toHaveBeenCalledOnce()
    expect(fixture.port1.close).toHaveBeenCalledOnce()
    expect(fixture.port2.close).toHaveBeenCalledOnce()
  })

  it('releases the pending stream and both ports when delivery fails', () => {
    const fixture = longStream()
    fixture.start()
    fixture.window.dispatchEvent.mockImplementation(() => {
      throw new Error('stream delta failed')
    })
    expect(() => {
      runNext(fixture.timers)
    }).toThrow('stream delta failed')
    expect(fixture.context.pendingScenarioEvents).toBe(0)
    expect(fixture.context.failScene).toHaveBeenCalledOnce()
    expect(fixture.context.notePlayed).not.toHaveBeenCalled()
    expect(fixture.timers).toHaveLength(0)
    expect(fixture.report).not.toHaveBeenCalled()
    expect(fixture.window.removeEventListener).toHaveBeenCalledOnce()
    expect(fixture.port1.close).toHaveBeenCalledOnce()
    expect(fixture.port2.close).toHaveBeenCalledOnce()
  })

  it('requires timing reasons for readiness timers too', () => {
    expect(delayedDom('<script>readinessLater(50, () => resolve())</script>')).toEqual([
      'Timer without a kept-timing reason: readinessLater(50, () => resolve())',
    ])
    expect(
      delayedDom(
        '<script>// kept-timing: readiness yields before checking the page again.\nreadinessLater(50, () => resolve())</script>',
      ),
    ).toEqual([])
  })

  it('waits for nested scheduled events while preserving their actual delays', () => {
    const source = harnessSection('let pendingScenarioEvents =', '// Runs fn with')
    const { timers, counts, context } = scenarioClock()
    runInNewContext(
      `${source}\n later(300, () => { observe(pendingScenarioEvents); later(50, () => {}); }); observe(pendingScenarioEvents);`,
      context,
    )
    expect(timers[0]?.delay).toBe(300)
    runNext(timers)
    runInNewContext('observe(pendingScenarioEvents)', context)
    expect(timers[0]?.delay).toBe(50)
    runNext(timers)
    runInNewContext('observe(pendingScenarioEvents)', context)
    expect(counts).toEqual([1, 1, 1, 0])
  })

  it('propagates a scheduled callback failure and releases its pending count', () => {
    const source = harnessSection('let pendingScenarioEvents =', '// Runs fn with')
    const { timers, counts, context } = scenarioClock()
    runInNewContext(
      `${source}\n later(300, () => { throw new Error('scheduled failure'); }); observe(pendingScenarioEvents);`,
      context,
    )
    expect(() => {
      runNext(timers)
    }).toThrow('scheduled failure')
    runInNewContext('observe(pendingScenarioEvents)', context)
    expect(counts).toEqual([1, 0])
  })

  it('reports a scene played only once its nested waits and events have run', () => {
    const rendered = new Set(['surface'])
    const scene = playedScene((selector) => (rendered.has(selector) ? {} : null))
    runInNewContext(
      `${scene.source}\n playingScenario = 'example'; whenFound('surface', () => { later(50, () => { whenFound('pill', () => {}) }) })`,
      scene.page,
    )
    runNext(scene.timers)
    expect(scene.dataset).toEqual({})
    runNext(scene.timers)
    expect(scene.dataset).toEqual({})
    rendered.add('pill')
    runNext(scene.timers)
    expect(scene.dataset).toEqual({ scenarioPlayed: 'example' })
    expect(scene.timers).toHaveLength(0)
  })

  it('never reports a scene played once one of its steps has failed', () => {
    const scene = playedScene(() => null)
    runInNewContext(
      `${scene.source}\n playingScenario = 'example'; whenFound('missing', () => {})`,
      scene.page,
    )
    expect(drain(scene.timers)).toEqual(['Error: never rendered: missing'])
    // Nothing is pending any more; only the failure keeps the scene unplayed.
    runInNewContext('later(10, () => {})', scene.page)
    runNext(scene.timers)
    expect(scene.dataset).toEqual({})
  })

  it('withdraws the played mark while new work runs, and for good once that work fails', () => {
    const scene = playedScene(() => ({}))
    runInNewContext(
      `${scene.source}\n playingScenario = 'example'; whenFound('surface', () => {})`,
      scene.page,
    )
    runNext(scene.timers)
    expect(scene.dataset).toEqual({ scenarioPlayed: 'example' })
    runInNewContext('later(10, () => {})', scene.page)
    expect(scene.dataset).toEqual({})
    runNext(scene.timers)
    expect(scene.dataset).toEqual({ scenarioPlayed: 'example' })
    runInNewContext("later(10, () => { throw new Error('late failure') })", scene.page)
    expect(drain(scene.timers)).toEqual(['Error: late failure'])
    expect(scene.dataset).toEqual({})
    runInNewContext('later(10, () => {})', scene.page)
    runNext(scene.timers)
    expect(scene.dataset).toEqual({})
  })

  it('keeps a scene unplayed while a tracked promise is pending, and fails it on rejection', async () => {
    const scene = playedScene(() => ({}))
    runInNewContext(`${scene.source}\n playingScenario = 'example'`, scene.page)
    const track = runInNewContext('track', scene.page) as <T>(promise: Promise<T>) => Promise<T>
    const reply = Promise.withResolvers<string>()
    const tracked = track(reply.promise)
    runInNewContext('notePlayed()', scene.page)
    expect(scene.dataset).toEqual({})
    reply.resolve('reply sent')
    await expect(tracked).resolves.toBe('reply sent')
    expect(scene.dataset).toEqual({ scenarioPlayed: 'example' })
    await expect(track(Promise.reject(new Error('reply failed')))).rejects.toThrow('reply failed')
    expect(scene.dataset).toEqual({})
    runInNewContext('later(10, () => {})', scene.page)
    runNext(scene.timers)
    expect(scene.dataset).toEqual({})
  })

  it('keeps the jump scene unplayed until its awaited scroll has run its steps', () => {
    const jump = jumpScene()
    expect(drain(jump.scene.timers)).toEqual([])
    // Every timer and wait has run; only the native scroll is outstanding.
    expect(jump.messages).toEqual([expect.objectContaining({ type: 'itemCompleted' })])
    expect(jump.scene.dataset).toEqual({})
    jump.main.dispatchEvent(new Event('scroll'))
    expect(drain(jump.scene.timers)).toEqual([])
    expect(jump.messages).toHaveLength(3)
    expect(jump.scene.dataset).toEqual({ scenarioPlayed: 'jump' })
  })

  it('never reports the jump scene played when a step after its scroll fails', () => {
    const jump = jumpScene()
    expect(drain(jump.scene.timers)).toEqual([])
    expect(jump.scene.dataset).toEqual({})
    jump.unmountMain()
    jump.main.dispatchEvent(new Event('scroll'))
    expect(drain(jump.scene.timers)).toEqual(['Error: never rendered: main'])
    expect(jump.messages).toHaveLength(1)
    expect(jump.scene.dataset).toEqual({})
  })

  it('holds readiness until scheduled events finish, then still waits for both paints', async () => {
    const source = harnessSection('const whenReady = async', '// A scan holds')
    const timers: ScheduledEvent[] = []
    const nextFrame = vi.fn(() => Promise.resolve())
    const settled = vi.fn()
    const context = {
      ...readinessPage(() => 0),
      nextFrame,
      readinessLater: (delay: number, run: () => void) => {
        timers.push({ delay, run })
      },
      settled,
    }
    runInNewContext(`${source}\n void whenReady('ordinary').then(settled);`, context)
    expect(timers[0]?.delay).toBe(50)
    expect(nextFrame).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    context.pendingScenarioEvents = 0
    runNext(timers)
    await vi.waitFor(() => {
      expect(settled).toHaveBeenCalledOnce()
    })
    expect(nextFrame).toHaveBeenCalledTimes(2)
  })

  it('keeps the existing readiness deadline when an event never finishes', async () => {
    const source = harnessSection('const whenReady = async', '// A scan holds')
    let now = 0
    const settled = vi.fn()
    const failed = vi.fn()
    runInNewContext(`${source}\n void whenReady('ordinary').then(settled, failed);`, {
      ...readinessPage(() => now),
      nextFrame: () => Promise.resolve(),
      readinessLater: (delay: number, run: () => void) => {
        now += delay
        queueMicrotask(run)
      },
      settled,
      failed,
    })
    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledOnce()
    })
    expect(settled).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'scenario ordinary never became ready within 10 s',
      }),
    )
  })
})

describe('harness scenes wait for the controls they touch', () => {
  it.each(
    [
      { harnessBundle: 'main', surface: '.composer textarea, .todo-surface' },
      { harnessBundle: 'models', surface: '.models-panel section' },
    ].flatMap((bundle) => [false, true].map((readyBeforeLoad) => ({ ...bundle, readyBeforeLoad }))),
  )(
    'starts $harnessBundle after loading and ready ($readyBeforeLoad), exactly once',
    ({ harnessBundle, surface, readyBeforeLoad }) => {
      const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
      const start = html.indexOf('let hasPlayedScenario =')
      const end = html.indexOf('// `?theme=', start)
      expect(start).toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      const window = new EventTarget()
      const selectors: string[] = []
      const context = {
        window,
        harnessBundle,
        hasWebviewReady: readyBeforeLoad,
        playingScenario: undefined as string | undefined,
        scenario: 'example',
        steps: {
          example: () => {
            selectors.push('played')
          },
        },
        whenFound: (selector: string, run: () => void) => {
          selectors.push(selector)
          run()
        },
      }
      runInNewContext(`${html.slice(start, end)}; playScenario()`, context)
      expect(selectors).toEqual([])
      window.dispatchEvent(new Event('DOMContentLoaded'))
      if (!readyBeforeLoad) {
        expect(selectors).toEqual([])
        expect(context.playingScenario).toBeUndefined()
        context.hasWebviewReady = true
        runInNewContext('playScenario()', context)
      }
      expect(selectors).toEqual([surface, 'played'])
      // Claimed for its played signal (data-scenario-played) as it starts.
      expect(context.playingScenario).toBe('example')
      window.dispatchEvent(new Event('DOMContentLoaded'))
      runInNewContext('playScenario()', context)
      expect(selectors).toHaveLength(2)
    },
  )

  it.each([
    { initialTop: 0, isRepinned: false },
    { initialTop: 100, isRepinned: false },
    { initialTop: 0, isRepinned: true },
  ])(
    'waits for a native scroll before new content ($initialTop, repin $isRepinned)',
    ({ initialTop, isRepinned }) => {
      const source = jumpSource()
      const main = new EventTarget()
      let top = initialTop
      let hasQueuedScroll = false
      Object.defineProperty(main, 'scrollTop', {
        get: () => top,
        set: (value: number) => {
          hasQueuedScroll ||= value !== top
          top = value
        },
      })
      const messages: unknown[] = []
      const paints: (() => void)[] = []
      const paintControls = () => {
        while (paints.length > 0) paints.shift()?.()
      }
      if (isRepinned) {
        main.addEventListener(
          'scroll',
          () => {
            top = 100
          },
          { once: true },
        )
      }
      runInNewContext(`(${source})()`, {
        window: {},
        Event,
        setDraft: () => undefined,
        key: () => undefined,
        longReply: () => '',
        event: (message: unknown) => {
          messages.push(message)
        },
        whenFound: (_selector: string, run: (element: EventTarget) => void) => {
          paints.push(() => {
            run(main)
          })
        },
        whenEvent: (target: EventTarget, type: string, run: () => void) => {
          target.addEventListener(type, run, { once: true })
        },
      })
      paintControls()
      expect(messages).toEqual([expect.objectContaining({ type: 'itemCompleted' })])
      expect(hasQueuedScroll).toBe(true)
      expect(top).toBe(0)
      // A native scroll may arrive after arbitrarily many timer callbacks.
      main.dispatchEvent(new Event('scroll'))
      paintControls()
      if (isRepinned) {
        expect(messages).toHaveLength(1)
        expect(top).toBe(0)
        main.dispatchEvent(new Event('scroll'))
        paintControls()
      }
      expect(messages).toEqual([
        expect.objectContaining({ type: 'itemCompleted' }),
        expect.objectContaining({
          type: 'itemStarted',
          item: expect.objectContaining({ itemId: 'more' }),
        }),
        expect.objectContaining({ type: 'textDelta', itemId: 'more' }),
      ])
      main.dispatchEvent(new Event('scroll'))
      paintControls()
      expect(messages).toHaveLength(3)
    },
  )

  it('keeps every timer explained and DOM interactions behind whenFound', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    expect(delayedDom(html)).toEqual([])
  })

  it('counts every native event and promise a scene or the fake host awaits', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    expect(uncountedAsync(html)).toEqual([])
  })

  it.each([
    ['a native listener', 'main.addEventListener("scroll", () => send(1))', 'addEventListener'],
    ['a promise chain', 'fetch("x").then(() => send(1))', 'fetch'],
    ['a port callback', 'port.onmessage = () => send(1)', 'onmessage'],
    ['a frame callback', 'requestAnimationFrame(() => send(1))', 'requestAnimationFrame'],
    ['work in a helper', 'scrollUp()', 'addEventListener'],
  ])('catches %s a scene starts outside the counted helpers', (_kind, code, name) => {
    const html = `<script>const scrollUp = () => window.addEventListener("scroll", () => {})
      const steps = { scene: () => { ${code} } }</script>`
    expect(uncountedAsync(html)).toContainEqual(expect.stringContaining(`uncounted ${name}:`))
  })

  it('accepts counted helpers, a tracked promise and a recorded reason', () => {
    expect(
      uncountedAsync(`<script>const postMessage = 0
        const host = { postMessage: () => { void track(fetch("x").then(() => send(1))) } }
        const steps = { scene: () => {
          whenEvent(main, "scroll", () => send(1))
          // counted: the stream holds one pending event until it completes.
          port.onmessage = () => send(1)
        } }</script>`),
    ).toEqual([])
  })

  it.each([...DOM_METHODS])('catches a delayed %s call', (method) => {
    expect(delayedDom(`<script>later(100, () => element.${method}())</script>`)).toEqual([
      expect.stringContaining('DOM interaction'),
    ])
  })

  it.each([
    'const click = () => document.querySelector("button").click(); later(100, () => click())',
    'const box = () => document.querySelector("textarea"); const key = () => box().dispatchEvent(event); later(100, key)',
    'const setDraft = () => element.value = "draft"; later(100, () => setDraft())',
    'later(100, () => whenFound("button", (element) => element.click()))',
    'later(100, () => element["click"]())',
  ])('catches indirect DOM work: %s', (source) => {
    expect(delayedDom(`<script>${source}</script>`)).toEqual([
      expect.stringContaining('DOM interaction'),
    ])
  })

  it('allows explained timing and ignores DOM words in strings', () => {
    expect(
      delayedDom(`<script>
      // kept-timing: a streaming event arrives after the first delta.
      later(100, () => send({ text: "querySelector click focus" }))
      // kept-timing: bounded readiness polling retries until the control renders.
      later(50, () => document.querySelector("button"))
      whenFound("button", (element) => element.click())
    </script>`),
    ).toEqual([])
  })

  it('does not accept an unrelated or empty timing comment', () => {
    expect(
      delayedDom(`<script>
      // This used to be fast enough.
      later(100, () => element.click())
      // kept-timing:
      later(100, () => element.focus())
    </script>`),
    ).toHaveLength(2)
  })
})
