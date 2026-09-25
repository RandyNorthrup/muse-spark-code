import { describe, expect, it } from 'vitest'
import { Dictation } from '../../src/core/voice/dictation'
import { type RecorderProcess, recorderHelper } from '../../src/core/voice/recorderHelper'
import { captureListener, SILENT_LOG } from './helpers/captureListener'

/** A recorder process under test control. */
class FakeRecorder implements RecorderProcess {
  public dataListener: ((chunk: Uint8Array) => void) | undefined
  public stderrListener: ((chunk: string) => void) | undefined
  public exitListener: ((description: string) => void) | undefined
  public kills = 0

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

function setup() {
  const recorders: FakeRecorder[] = []
  const recorded = captureListener()
  const dictation = new Dictation({
    invocation: { command: '/usr/bin/arecord', args: ['-q'] },
    spawn: () =>
      recorderHelper('arecord', () => {
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
