import { describe, expect, it, vi } from 'vitest'
import { Dictation } from '../../src/core/voice/dictation'
import { type RecorderProcess, recorderHelper } from '../../src/core/voice/recorderHelper'
import { captureListener, SILENT_LOG } from './helpers/captureListener'

/** A recorder process under test control. */
class FakeRecorder implements RecorderProcess {
  public dataListener: ((chunk: Uint8Array) => void) | undefined
  public stderrListener: ((chunk: string) => void) | undefined
  public exitListener: ((description: string) => void) | undefined
  public errorListener: ((description: string) => void) | undefined
  public kills = 0
  /** When true, kill is refused: the recorder keeps running. */
  public refuseKill = false

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

  public onError(listener: (description: string) => void): void {
    this.errorListener = listener
  }

  public kill(): void {
    this.kills += 1
    if (!this.refuseKill) {
      this.exitListener?.('signal SIGTERM')
    }
  }

  public failLaunch(description: string): void {
    this.errorListener?.(description)
  }
}

/** Lets reap continuations run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve()
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

/** Start once and take the single spawned recorder. */
async function startedRecorder(t: ReturnType<typeof setup>): Promise<FakeRecorder> {
  t.dictation.start()
  await Promise.resolve()
  const recorder = t.recorders[0]
  if (recorder === undefined) throw new Error('no recorder')
  return recorder
}

describe('recorderHelper: the Linux recorders as a capture helper (M35)', () => {
  it('starts a recorder per recording, hands its audio on, and ends on its observed exit', async () => {
    const t = setup()
    t.dictation.start()
    await Promise.resolve()
    expect(t.recorders).toHaveLength(1)
    expect(t.statuses).toEqual(['starting', 'listening'])
    t.recorders[0]?.dataListener?.(Uint8Array.from([1, 2, 3, 4]))
    t.dictation.stop()
    // The kill lands at once, but the end waits for the observed exit.
    expect(t.recorders[0]?.kills).toBe(1)
    expect(t.audio).toEqual([[1, 2, 3, 4]])
    expect(t.stopped()).toBe(0)
    await flush()
    expect(t.stopped()).toBe(1)
    expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
    // The next recording is a new process.
    t.dictation.start()
    await flush()
    expect(t.recorders).toHaveLength(2)
    await t.dictation.dispose()
    expect(t.recorders[1]?.kills).toBe(1)
  })

  it('reports a recorder that ends on its own, with the last line it wrote', async () => {
    const t = setup()
    t.dictation.start()
    await Promise.resolve()
    const recorder = t.recorders[0]
    recorder?.stderrListener?.('arecord: main:850: audio open error: No such file or directory\n')
    recorder?.exitListener?.('exit code 1')
    await flush()
    expect(t.errors).toEqual([
      'arecord ended (exit code 1): arecord: main:850: audio open error: No such file or directory',
    ])
    expect(t.stopped()).toBe(0)
  })

  it('never reports stopped for a refused kill (RVCM352B P1-b)', async () => {
    const t = setup()
    try {
      const recorder = await startedRecorder(t)
      recorder.refuseKill = true
      t.dictation.stop()
      expect(recorder.kills).toBe(1)
      // No exit follows the refused kill: no "stopped", no idle, no silence.
      await flush()
      expect(t.stopped()).toBe(0)
      expect(t.statuses).toEqual(['starting', 'listening'])
      recorder.refuseKill = false
      recorder.exitListener?.('exit code 0')
      await flush()
      expect(t.stopped()).toBe(1)
      expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
      expect(t.errors).toEqual([])
    } finally {
      await t.dictation.dispose()
    }
  })

  it('reports a launch failure at once, with no process to wait for (RVCM352B P1-b)', async () => {
    const t = setup()
    try {
      const recorder = await startedRecorder(t)
      recorder.failLaunch('could not start: ENOENT')
      await flush()
      expect(t.errors).toEqual(['arecord ended (could not start: ENOENT)'])
      expect(t.statuses).toEqual(['starting', 'listening', 'idle'])
      expect(t.stopped()).toBe(0)
    } finally {
      await t.dictation.dispose()
    }
  })
})

it('CM352 reports a synchronous Linux start failure and can retry without fake listening', async () => {
  let shouldFail = true
  const t = setup(() => {
    if (shouldFail) throw new Error('EACCES')
  })
  try {
    t.dictation.start()
    await flush()
    expect(t.errors).toEqual(['arecord: EACCES'])
    expect(t.statuses).toEqual(['starting', 'idle'])
    expect(t.recorders).toEqual([])
    shouldFail = false
    t.dictation.start()
    await Promise.resolve()
    expect(t.statuses.at(-1)).toBe('listening')
    expect(t.recorders).toHaveLength(1)
  } finally {
    await t.dictation.dispose()
  }
})

it('CM352 spends a closed adapter: no restart, no lines, no audio after its exit', async () => {
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
  expect(start).toHaveBeenCalledTimes(1)
  recorders[0]?.exitListener?.('exit code 1')
  // The spontaneous end spends the adapter: a restart is refused, and the
  // old recorder's late data never becomes audio.
  helper.send('start')
  recorders[0]?.dataListener?.(Uint8Array.from([1, 2]))
  expect(start).toHaveBeenCalledTimes(1)
  expect(lines.some((line) => line.includes('"type":"audio"'))).toBe(false)
  const beforeClosing = lines.length
  helper.send('quit')
  recorders[0]?.dataListener?.(Uint8Array.from([1, 2]))
  expect(lines).toHaveLength(beforeClosing)
  const closedLines: string[] = []
  const closed = recorderHelper('parec', start)
  closed.stdout.on('data', (chunk) => {
    closedLines.push(chunk.toString())
  })
  closed.kill()
  closed.send('start')
  await Promise.resolve()
  expect(closedLines).toEqual([])
  expect(start).toHaveBeenCalledTimes(1)
})
