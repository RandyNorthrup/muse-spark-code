import { describe, expect, it, vi } from 'vitest'
import { Dictation } from '../../src/core/voice/dictation'
import { type RecorderProcess, recorderHelper } from '../../src/core/voice/recorderHelper'
import { captureListener, SILENT_LOG } from './helpers/captureListener'

/** A recorder process under test control. */
class FakeRecorder implements RecorderProcess {
  public dataListener: ((chunk: Uint8Array) => void) | undefined
  public stderrListener: ((chunk: string) => void) | undefined
  public exitListener: ((description: string) => void) | undefined
  public kills = 0

  public onStarted(listener: () => void): void {
    listener()
  }

  public onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListener = listener
  }

  public onStderr(listener: (chunk: string) => void): void {
    this.stderrListener = listener
  }

  public onExit(listener: (description: string) => void): void {
    this.exitListener = listener
  }

  public kill(): void {
    this.kills += 1
    this.exitListener?.('signal SIGTERM')
  }
}

function setup(onStart?: () => void) {
  const recorders: FakeRecorder[] = []
  const recorded = captureListener()
  const dictation = new Dictation({
    invocation: { command: '/usr/bin/arecord', args: ['-q'] },
    spawn: () =>
      recorderHelper('arecord', () => {
        onStart?.()
        const recorder = new FakeRecorder()
        recorders.push(recorder)
        return recorder
      }),
    listener: recorded.listener,
    log: SILENT_LOG,
  })
  return {
    dictation,
    recorders,
    statuses: recorded.statuses,
    errors: recorded.errors,
    audio: recorded.audio,
    stopped: recorded.stopped,
  }
}

describe('recorderHelper: the Linux recorders as a capture helper (M35)', () => {
  it('starts a recorder per recording, hands its audio on, and stops when it has exited', async () => {
    const t = setup()
    t.dictation.start()
    await Promise.resolve()
    expect(t.recorders).toHaveLength(1)
    expect(t.statuses).toEqual(['starting', 'listening'])
    t.recorders[0]?.dataListener?.(Uint8Array.from([1, 2, 3, 4]))
    t.dictation.stop()
    expect(t.recorders[0]?.kills).toBe(1)
    expect(t.audio).toEqual([[1, 2, 3, 4]])
    expect(t.stopped()).toBe(1)
    // The next recording is a new process.
    t.dictation.start()
    expect(t.recorders).toHaveLength(2)
    t.dictation.dispose()
    expect(t.recorders[1]?.kills).toBe(1)
  })

  it('reports a recorder that ends on its own, with the last line it wrote', async () => {
    const t = setup()
    t.dictation.start()
    await Promise.resolve()
    const recorder = t.recorders[0]
    recorder?.stderrListener?.('arecord: main:850: audio open error: No such file or directory\n')
    recorder?.exitListener?.('exit code 1')
    expect(t.errors).toEqual([
      'arecord ended (exit code 1): arecord: main:850: audio open error: No such file or directory',
    ])
    expect(t.stopped()).toBe(0)
  })
})

it('CM352 reports a synchronous Linux start failure and can retry without fake listening', async () => {
  let shouldFail = true
  const t = setup(() => {
    if (shouldFail) throw new Error('EACCES')
  })
  try {
    t.dictation.start()
    await Promise.resolve()
    expect(t.errors).toEqual(['arecord: EACCES'])
    expect(t.statuses).toEqual(['starting', 'idle'])
    expect(t.recorders).toEqual([])
    shouldFail = false
    t.dictation.start()
    await Promise.resolve()
    expect(t.statuses.at(-1)).toBe('listening')
    expect(t.recorders).toHaveLength(1)
  } finally {
    t.dictation.dispose()
  }
})

it('CM352 ignores old recorder data and closed-adapter restart or readiness', async () => {
  const recorders: FakeRecorder[] = []
  const lines: string[] = []
  const start = vi.fn(() => {
    const child = new FakeRecorder()
    recorders.push(child)
    return child
  })
  const helper = recorderHelper('arecord', start)
  helper.stdout.on('data', (chunk) => {
    lines.push(chunk.toString())
  })
  await Promise.resolve()
  helper.send('start')
  recorders[0]?.exitListener?.('exit code 1')
  helper.send('start')
  recorders[0]?.dataListener?.(Uint8Array.from([1, 2]))
  expect(lines.some((line) => line.includes('"type":"audio"'))).toBe(false)
  const beforeClosing = lines.length
  helper.send('quit')
  recorders[1]?.exitListener?.('late close')
  expect(lines).toHaveLength(beforeClosing)
  recorders[1]?.dataListener?.(Uint8Array.from([1, 2]))
  helper.send('start')
  expect(start).toHaveBeenCalledTimes(2)
  expect(lines.some((line) => line.includes('"type":"audio"'))).toBe(false)
  const closedLines: string[] = []
  const closed = recorderHelper('parec', start)
  closed.stdout.on('data', (chunk) => {
    closedLines.push(chunk.toString())
  })
  closed.kill()
  closed.send('start')
  await Promise.resolve()
  expect(closedLines).toEqual([])
  expect(start).toHaveBeenCalledTimes(2)
})
