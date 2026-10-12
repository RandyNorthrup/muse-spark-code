import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import {
  Dictation,
  type DictationListener,
  type DictationStatus,
  type HelperChild,
  type HelperInvocation,
  LineSplitter,
  parseHelperLine,
} from '../../src/core/voice/dictation'
import { captureListener, SILENT_LOG } from './helpers/captureListener'
import { FakeHelperProcess } from './helpers/fakeHelperChild'
import { DICTATION_QUIT_GRACE_MS, DICTATION_STOP_GRACE_MS } from '../../src/shared/constants'

/** A helper process under test control: commands are recorded, output is fed. */
class FakeChild extends FakeHelperProcess implements HelperChild {
  private stopFailedListener: ((description: string) => void) | undefined
  public killCount = 0

  public onStopFailed(listener: (description: string) => void): void {
    this.stopFailedListener = listener
  }

  public kill(): void {
    this.killCount += 1
  }

  public refuseStop(description: string): void {
    this.stopFailedListener?.(description)
  }
}

/** Lets every queued microtask (reap continuations) run under fake timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve()
  }
}

const invocation: HelperInvocation = { command: 'helper', args: ['--x'] }

function setup(helper: HelperInvocation = invocation) {
  const children: FakeChild[] = []
  const statuses: DictationStatus[] = []
  const texts: string[] = []
  const errors: string[] = []
  const logged: string[] = []
  const log: CoreLogger = {
    trace: (message) => {
      logged.push(`trace ${message}`)
    },
    info: (message) => {
      logged.push(`info ${message}`)
    },
    warn: (message) => {
      logged.push(`warn ${message}`)
    },
    error: (message) => {
      logged.push(`error ${message}`)
    },
  }
  const listener: DictationListener = {
    onStatus: (status) => {
      statuses.push(status)
    },
    onText: (text) => {
      texts.push(text)
    },
    onError: (reason) => {
      errors.push(reason)
    },
  }
  const dictation = new Dictation({
    invocation: helper,
    spawn: (spawned) => {
      expect(spawned).toBe(helper)
      const child = new FakeChild()
      children.push(child)
      return child
    },
    listener,
    log,
  })
  const child = (index = 0): FakeChild => {
    const found = children[index]
    if (found === undefined) {
      throw new Error(`no child ${String(index)}`)
    }
    return found
  }
  return { dictation, children, child, statuses, texts, errors, logged }
}

/** A driver whose helper is up and listening after one start. */
function listening() {
  const t = setup()
  t.dictation.start()
  t.child().emitLine({ type: 'ready', language: 'en-US' })
  t.child().emitLine({ type: 'listening' })
  return t
}

/** The acknowledged stop's end lands only on the observed exit. */
async function exitAfterStopAck(t: ReturnType<typeof setup>): Promise<void> {
  expect(t.child().sent).toEqual(['start', 'stop', 'quit'])
  expect(t.statuses).toEqual(['starting', 'listening'])
  t.child().exit('exit code 0')
  await flush()
}

/** A new helper began the next recording once it was ready. */
function expectFreshHelperStarted(t: ReturnType<typeof setup>): void {
  expect(t.children).toHaveLength(2)
  expect(t.child(1).sent).toEqual([])
  t.child(1).emitLine({ type: 'ready', language: 'en-US' })
  expect(t.child(1).sent).toEqual(['start'])
}

/** Dispose while listening, then refuse the helper's stop. */
async function beginRefusedDispose(
  t: ReturnType<typeof listening>,
): Promise<{ readonly disposed: Promise<void> }> {
  const disposed = t.dictation.dispose()
  await flush()
  expect(t.child().sent).toEqual(['start', 'quit'])
  t.child().refuseStop('Registered resource tree could not be stopped')
  return { disposed }
}

describe('parseHelperLine', () => {
  it('accepts the five protocol lines and rejects the rest', () => {
    expect(parseHelperLine('{"type":"ready","language":"en-US","recognizer":"MS"}')).toEqual({
      type: 'ready',
      language: 'en-US',
      recognizer: 'MS',
    })
    expect(parseHelperLine('{"type":"text","text":"hi","confidence":0.5}')).toEqual({
      type: 'text',
      text: 'hi',
      confidence: 0.5,
    })
    expect(parseHelperLine('{"type":"stopped"}')).toEqual({ type: 'stopped' })
    expect(parseHelperLine('{"type":"listening"}')).toEqual({ type: 'listening' })
    expect(parseHelperLine('{"type":"error","reason":"r"}')).toEqual({
      type: 'error',
      reason: 'r',
    })
    expect(parseHelperLine('{"type":"other"}')).toBeUndefined()
    expect(parseHelperLine('not json')).toBeUndefined()
    expect(parseHelperLine('{"type":"text"}')).toBeUndefined()
  })
})

describe('LineSplitter', () => {
  it('yields complete lines across chunks and keeps the tail', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('{"a":1}\n{"b":')).toEqual(['{"a":1}'])
    expect(splitter.push(Buffer.from('2}\r\n\n'))).toEqual(['{"b":2}'])
    expect(splitter.push('')).toEqual([])
  })
})

describe('Dictation driver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns on the first start, sends "start" once ready, and reports listening', () => {
    const t = setup()
    t.dictation.start()
    expect(t.children).toHaveLength(1)
    expect(t.statuses).toEqual(['starting'])
    expect(t.child().sent).toEqual([])
    t.child().emitLine({ type: 'ready', language: 'en-US', recognizer: 'MS-1033-80-DESK' })
    expect(t.child().sent).toEqual(['start'])
    t.child().emitLine({ type: 'listening' })
    expect(t.statuses).toEqual(['starting', 'listening'])
    expect(t.logged).toContain('info Dictation helper ready (en-US, MS-1033-80-DESK)')
  })

  it('hands recognised phrases to the listener without logging the words', () => {
    const t = listening()
    t.child().emitLine({ type: 'text', text: 'fix the bug', confidence: 0.4 })
    expect(t.texts).toEqual(['fix the bug'])
    expect(t.logged.join('\n')).not.toContain('fix the bug')
    expect(t.logged).toContain('info Dictation: 11 characters recognised')
  })

  it('stop sends "stop", and idle waits for the process to be observed gone', async () => {
    const t = listening()
    t.dictation.stop()
    expect(t.child().sent).toEqual(['start', 'stop'])
    // Idle waits for the process exit, not the press or the acknowledgement.
    expect(t.statuses).toEqual(['starting', 'listening'])
    t.child().emitLine({ type: 'text', text: 'last words' })
    t.child().emitLine({ type: 'stopped' })
    // The acknowledgement retires the recording and quits the helper, but
    // the end lands only after the exit is observed.
    await exitAfterStopAck(t)
    expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
    expect(t.texts).toEqual(['last words'])
    expect(t.errors).toEqual([])
    expect(t.child().killCount).toBe(0)
  })

  it('a start behind an unacknowledged stop begins after the old process is gone', async () => {
    const t = listening()
    t.dictation.stop()
    t.dictation.start()
    // The next recording spawns only after the old process is gone.
    expect(t.child().sent).toEqual(['start', 'stop'])
    expect(t.statuses).toEqual(['starting', 'listening', 'starting'])
    t.child().emitLine({ type: 'text', text: 'trailing' })
    t.child().emitLine({ type: 'stopped' })
    expect(t.child().sent).toEqual(['start', 'stop', 'quit'])
    await flush()
    expect(t.children).toHaveLength(1)
    t.child().exit('exit code 0')
    await flush()
    // No idle flash: the next recording begins on the observed exit, on a
    // new process once that helper is ready.
    expectFreshHelperStarted(t)
    expect(t.statuses).toEqual(['starting', 'listening', 'starting'])
    expect(t.texts).toEqual(['trailing'])
    t.child(1).emitLine({ type: 'listening' })
    expect(t.statuses).toEqual(['starting', 'listening', 'starting', 'listening'])
    // A stop behind the queued start cancels it instead.
    t.dictation.stop()
    t.dictation.start()
    t.dictation.stop()
    expect(t.child(1).sent).toEqual(['start', 'stop'])
    t.child(1).emitLine({ type: 'stopped' })
    expect(t.child(1).sent).toEqual(['start', 'stop', 'quit'])
    t.child(1).exit('exit code 0')
    await flush()
    expect(t.children).toHaveLength(2)
    expect(t.statuses.at(-1)).toBe('idle')
  })

  it('a stop that is never confirmed ends the queued start by force', async () => {
    const t = listening()
    t.dictation.stop()
    t.dictation.start()
    await vi.advanceTimersByTimeAsync(DICTATION_STOP_GRACE_MS)
    // The grace failure kills at once; the queued press dies with it, and
    // the failure is said once the process is gone.
    expect(t.child().killCount).toBe(1)
    expect(t.errors).toEqual([])
    t.child().exit('signal SIGKILL')
    await flush()
    expect(t.errors).toEqual(['The dictation helper stopped responding'])
    expect(t.statuses).toEqual(['starting', 'listening', 'starting', 'idle'])
    t.dictation.start()
    expect(t.children).toHaveLength(2)
    expect(t.child(1).sent).toEqual([])
  })

  it('a synchronous acknowledgement still quits before reporting idle', async () => {
    const t = listening()
    const send = t.child().send.bind(t.child())
    vi.spyOn(t.child(), 'send').mockImplementation((line) => {
      send(line)
      if (line === 'stop') t.child().emitLine({ type: 'stopped' })
    })
    t.dictation.stop()
    // Quit is sent, but idle still waits for the observed exit.
    await exitAfterStopAck(t)
    expect(t.statuses.at(-1)).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    await t.dictation.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never reuses a helper across presses: every end leaves no process', async () => {
    const t = listening()
    t.dictation.stop()
    t.child().emitLine({ type: 'stopped' })
    t.child().exit('exit code 0')
    await flush()
    t.dictation.start()
    expectFreshHelperStarted(t)
  })

  it('a stop before the engine is ready quits at once and waits for the exit', async () => {
    const t = setup()
    t.dictation.start()
    t.dictation.stop()
    // Nothing was recorded, but idle still waits for the process to be gone.
    expect(t.child().sent).toEqual(['quit'])
    expect(t.statuses).toEqual(['starting'])
    t.child().emitLine({ type: 'ready', language: 'en-US' })
    expect(t.child().sent).toEqual(['quit'])
    t.child().exit('exit code 0')
    await flush()
    expect(t.statuses).toEqual(['starting', 'idle'])
  })

  it('reports a helper error once its process is gone, and respawns on the next start', async () => {
    const t = setup()
    t.dictation.start()
    t.child().emitLine({ type: 'error', reason: 'No microphone is available' })
    // The kill lands at once, but the failure is said after the exit.
    expect(t.child().killCount).toBe(1)
    expect(t.errors).toEqual([])
    t.child().exit('exit code 2')
    await flush()
    expect(t.errors).toEqual(['No microphone is available'])
    expect(t.statuses).toEqual(['starting', 'idle'])
    t.dictation.start()
    expect(t.children).toHaveLength(2)
  })

  it('an unexpected exit while listening goes idle with the last stderr line', () => {
    const t = listening()
    t.child().stderr.emit('data', 'warning\nAccess denied\n')
    t.child().exit('exit code 1')
    expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
    expect(t.errors).toEqual(['exit code 1: Access denied'])
  })

  it('adds the platform hint to an exit before "ready", and only then (M26)', () => {
    const hinted: HelperInvocation = { ...invocation, earlyExitHint: 'macOS ended it.' }
    const early = setup(hinted)
    early.dictation.start()
    early.child().stderr.emit('data', 'step: asking macOS for speech recognition\n')
    early.child().exit('signal SIGKILL')
    expect(early.errors).toEqual([
      'signal SIGKILL: step: asking macOS for speech recognition. macOS ended it.',
    ])
    const late = setup(hinted)
    late.dictation.start()
    late.child().emitLine({ type: 'ready', language: 'en_US' })
    late.child().exit('exit code 1')
    expect(late.errors).toEqual(['exit code 1'])
  })

  it('an unexpected exit without stderr reports the exit alone', () => {
    const t = setup()
    t.dictation.start()
    t.child().exit('could not start: ENOENT')
    expect(t.errors).toEqual(['could not start: ENOENT'])
  })

  it('restarts a helper that never confirms a stop', async () => {
    const t = listening()
    t.dictation.stop()
    await vi.advanceTimersByTimeAsync(DICTATION_STOP_GRACE_MS)
    // The grace failure kills at once; the failure lands after the exit.
    expect(t.child().killCount).toBe(1)
    t.child().exit('signal SIGKILL')
    await flush()
    expect(t.errors).toEqual(['The dictation helper stopped responding'])
    t.dictation.start()
    expect(t.children).toHaveLength(2)
  })

  it('ignores unknown lines and lines from a helper it has dropped', async () => {
    const t = setup()
    t.dictation.start()
    t.child().stdout.emit('data', 'garbage\n')
    // Its length only: the line could hold dictated words (M39).
    expect(t.logged).toContain('warn Dictation helper wrote an unexpected line (7 characters)')
    expect(t.logged.join('\n')).not.toContain('garbage')
    const disposed = t.dictation.dispose()
    t.child().emitLine({ type: 'ready', language: 'en-US' })
    expect(t.child().sent).toEqual(['quit'])
    t.child().exit('exit code 0')
    await disposed
  })

  it('start and stop are no-ops when there is nothing to do', () => {
    const t = setup()
    t.dictation.stop()
    t.dictation.start()
    t.dictation.start()
    expect(t.children).toHaveLength(1)
    expect(t.statuses).toEqual(['starting'])
  })

  it('dispose asks the helper to quit and resolves once its exit is observed', async () => {
    const t = setup()
    t.dictation.start()
    let isDisposed = false
    const disposed = (async () => {
      await t.dictation.dispose()
      isDisposed = true
    })()
    await flush()
    // Asked, not killed: the exit is awaited, and the drain pends on it.
    expect(t.child().sent).toEqual(['quit'])
    expect(t.child().killCount).toBe(0)
    expect(isDisposed).toBe(false)
    t.child().exit('signal SIGTERM')
    await disposed
    expect(isDisposed).toBe(true)
    expect(t.errors).toEqual([])
    t.dictation.start()
    expect(t.children).toHaveLength(1)
  })

  it('dispose kills after the grace and says so (RVCM352B P1-b)', async () => {
    const t = setup()
    t.dictation.start()
    const disposed = t.dictation.dispose()
    await flush()
    expect(t.child().sent).toEqual(['quit'])
    await vi.advanceTimersByTimeAsync(DICTATION_QUIT_GRACE_MS)
    expect(t.child().killCount).toBe(1)
    expect(t.errors).toEqual([])
    await vi.advanceTimersByTimeAsync(DICTATION_QUIT_GRACE_MS)
    await disposed
    expect(t.errors).toEqual(['The dictation helper stopped responding'])
    expect(t.logged.join('\n')).toContain(
      'warn Dictation helper did not exit on dispose; killed it',
    )
  })

  it('a refused stop is said instead of read as an exit (RVCM352B P1-b)', async () => {
    const t = listening()
    const { disposed } = await beginRefusedDispose(t)
    expect(t.logged.join('\n')).toContain(
      'warn Dictation helper stop was refused: Registered resource tree could not be stopped',
    )
    // The refusal is not an exit: the drain still waits, then kills, then says so.
    await vi.advanceTimersByTimeAsync(DICTATION_QUIT_GRACE_MS)
    expect(t.child().killCount).toBe(1)
    await vi.advanceTimersByTimeAsync(DICTATION_QUIT_GRACE_MS)
    await disposed
    expect(t.errors).toEqual(['The dictation helper stopped responding'])
    expect(t.logged.join('\n')).toContain(
      'warn Dictation helper did not exit on dispose (its stop was refused); killed it',
    )
  })

  it('a refused stop that still exits ends quietly (RVCM352B P1-b)', async () => {
    const t = listening()
    const { disposed } = await beginRefusedDispose(t)
    t.child().exit('exit code 0')
    await disposed
    expect(t.errors).toEqual([])
    expect(t.child().killCount).toBe(0)
  })
})

describe('Dictation driver: a capture helper (M35)', () => {
  describe('Dictation driver: a real helper process is gone after the end (RVCM352B P1-b)', () => {
    it('reports stopped only after the operating system reaped the process', async () => {
      const { spawn } = await import('node:child_process')
      const script = [
        String.raw`const say = (line) => process.stdout.write(JSON.stringify(line) + '\n')`,
        "say({ type: 'ready', language: 'en-US' })",
        "process.stdin.setEncoding('utf8')",
        'let tail = String()',
        "process.stdin.on('data', (chunk) => {",
        String.raw`  const lines = (tail + chunk).split('\n')`,
        '  tail = lines.pop() ?? String()',
        '  for (const line of lines) {',
        "    if (line === 'start') say({ type: 'listening' })",
        "    else if (line === 'stop') say({ type: 'stopped' })",
        "    else if (line === 'quit') process.exit(0)",
        '  }',
        '})',
        '',
      ].join('\n')
      const proc = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
      const { stdout, stderr, stdin, pid } = proc
      if (pid === undefined) {
        proc.kill()
        throw new Error('the real helper did not start')
      }
      const statuses: DictationStatus[] = []
      let stopped = 0
      const dictation = new Dictation({
        invocation,
        spawn: () => ({
          stdout,
          stderr,
          send: (line: string) => {
            stdin.write(`${line}\n`)
          },
          onExit: (listener: (description: string) => void) => {
            proc.once('exit', (code, signal) => {
              listener(
                code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`,
              )
            })
            proc.once('error', (error: Error) => {
              listener(`could not start: ${error.message}`)
            })
          },
          kill: () => {
            proc.kill()
          },
        }),
        listener: {
          onStatus: (status) => {
            statuses.push(status)
          },
          onText: () => {
            // The script never dictates text; any error fails the test below.
          },
          onError: (reason) => {
            throw new Error(`real helper errored: ${reason}`)
          },
          onStopped: () => {
            stopped += 1
          },
        },
        log: SILENT_LOG,
      })
      try {
        dictation.start()
        await vi.waitFor(() => {
          expect(statuses).toContain('listening')
        })
        dictation.stop()
        await vi.waitFor(() => {
          expect(stopped).toBe(1)
        })
        // The end was reported, so the process is reaped: the OS agrees.
        expect(proc.exitCode).toBe(0)
        expect(() => process.kill(pid, 0)).toThrow()
        expect(statuses).toEqual(['starting', 'listening', 'idle'])
      } finally {
        await dictation.dispose()
        proc.kill()
      }
    })
  })

  it('parses audio lines and hands the audio on, then says when the stop is complete', async () => {
    expect(parseHelperLine('{"type":"audio","data":"AAE="}')).toEqual({
      type: 'audio',
      data: 'AAE=',
    })
    expect(parseHelperLine('{"type":"audio"}')).toBeUndefined()
    const recorded = captureListener()
    const child = new FakeChild()
    const dictation = new Dictation({
      invocation,
      spawn: () => child,
      listener: recorded.listener,
      log: SILENT_LOG,
    })
    dictation.start()
    child.emitLine({ type: 'ready', language: 'pcm_s16le', recognizer: 'capture 16000 Hz mono' })
    child.emitLine({ type: 'listening' })
    child.emitLine({ type: 'audio', data: Buffer.from([0, 1, 2]).toString('base64') })
    child.emitLine({ type: 'audio', data: Buffer.from([3]).toString('base64') })
    dictation.stop()
    expect(recorded.stopped()).toBe(0)
    child.emitLine({ type: 'stopped' })
    // The acknowledgement quits the capture, but the end lands on the exit.
    expect(child.sent).toEqual(['start', 'stop', 'quit'])
    expect(recorded.stopped()).toBe(0)
    child.exit('exit code 0')
    await flush()
    expect(recorded.audio).toEqual([[0, 1, 2], [3]])
    expect(recorded.stopped()).toBe(1)
    await dictation.dispose()
  })
})
