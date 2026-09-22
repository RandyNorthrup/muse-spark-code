import { EventEmitter } from 'node:events'
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
import {
  DICTATION_IDLE_EXIT_MS,
  DICTATION_QUIT_GRACE_MS,
  DICTATION_STOP_GRACE_MS,
} from '../../src/shared/constants'

/** A helper process under test control: commands are recorded, output is fed. */
class FakeChild implements HelperChild {
  private exitListener: ((description: string) => void) | undefined
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public readonly sent: string[] = []
  public killCount = 0

  public send(line: string): void {
    this.sent.push(line)
  }

  public onExit(listener: (description: string) => void): void {
    this.exitListener = listener
  }

  public kill(): void {
    this.killCount += 1
  }

  public emitLine(payload: unknown): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`))
  }

  public exit(description: string): void {
    this.exitListener?.(description)
  }
}

const invocation: HelperInvocation = { command: 'helper', args: ['--x'] }

function setup() {
  const children: FakeChild[] = []
  const statuses: DictationStatus[] = []
  const texts: string[] = []
  const errors: string[] = []
  const logged: string[] = []
  const log: CoreLogger = {
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
    invocation,
    spawn: (spawned) => {
      expect(spawned).toBe(invocation)
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

  it('stop sends "stop", goes idle at once, and the late phrase still arrives', () => {
    const t = listening()
    t.dictation.stop()
    expect(t.child().sent).toEqual(['start', 'stop'])
    expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
    t.child().emitLine({ type: 'text', text: 'last words' })
    t.child().emitLine({ type: 'stopped' })
    expect(t.texts).toEqual(['last words'])
    expect(t.errors).toEqual([])
  })

  it('keeps the helper warm for the next start and quits it after the idle timeout', () => {
    const t = listening()
    t.dictation.stop()
    t.child().emitLine({ type: 'stopped' })
    t.dictation.start()
    expect(t.children).toHaveLength(1)
    expect(t.child().sent).toEqual(['start', 'stop', 'start'])
    t.child().emitLine({ type: 'listening' })
    t.dictation.stop()
    t.child().emitLine({ type: 'stopped' })
    vi.advanceTimersByTime(DICTATION_IDLE_EXIT_MS)
    expect(t.child().sent.at(-1)).toBe('quit')
    vi.advanceTimersByTime(DICTATION_QUIT_GRACE_MS)
    expect(t.child().killCount).toBe(1)
    t.child().exit('exit code 0')
    expect(t.errors).toEqual([])
    // The next start spawns afresh.
    t.dictation.start()
    expect(t.children).toHaveLength(2)
  })

  it('a stop before the engine is ready cancels the queued start', () => {
    const t = setup()
    t.dictation.start()
    t.dictation.stop()
    expect(t.statuses).toEqual(['starting', 'idle'])
    t.child().emitLine({ type: 'ready', language: 'en-US' })
    expect(t.child().sent).toEqual([])
    vi.advanceTimersByTime(DICTATION_IDLE_EXIT_MS)
    expect(t.child().sent).toEqual(['quit'])
  })

  it('reports a helper error, drops the process, and respawns on the next start', () => {
    const t = setup()
    t.dictation.start()
    t.child().emitLine({ type: 'error', reason: 'No microphone is available' })
    expect(t.errors).toEqual(['No microphone is available'])
    expect(t.statuses).toEqual(['starting', 'idle'])
    expect(t.child().killCount).toBe(1)
    t.child().exit('exit code 2')
    expect(t.errors).toHaveLength(1)
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

  it('an unexpected exit without stderr reports the exit alone', () => {
    const t = setup()
    t.dictation.start()
    t.child().exit('could not start: ENOENT')
    expect(t.errors).toEqual(['could not start: ENOENT'])
  })

  it('restarts a helper that never confirms a stop', () => {
    const t = listening()
    t.dictation.stop()
    vi.advanceTimersByTime(DICTATION_STOP_GRACE_MS)
    expect(t.errors).toEqual(['The dictation helper stopped responding'])
    expect(t.child().killCount).toBe(1)
    t.dictation.start()
    expect(t.children).toHaveLength(2)
  })

  it('ignores unknown lines and lines from a helper it has dropped', () => {
    const t = setup()
    t.dictation.start()
    t.child().stdout.emit('data', 'garbage\n')
    expect(t.logged).toContain('warn Dictation helper wrote an unexpected line: garbage')
    t.dictation.dispose()
    t.child().emitLine({ type: 'ready', language: 'en-US' })
    expect(t.child().sent).toEqual([])
  })

  it('start and stop are no-ops when there is nothing to do', () => {
    const t = setup()
    t.dictation.stop()
    t.dictation.start()
    t.dictation.start()
    expect(t.children).toHaveLength(1)
    expect(t.statuses).toEqual(['starting'])
  })

  it('dispose kills the helper and refuses further starts', () => {
    const t = setup()
    t.dictation.start()
    t.dictation.dispose()
    expect(t.child().killCount).toBe(1)
    t.child().exit('signal SIGTERM')
    expect(t.errors).toEqual([])
    t.dictation.start()
    expect(t.children).toHaveLength(1)
  })
})
