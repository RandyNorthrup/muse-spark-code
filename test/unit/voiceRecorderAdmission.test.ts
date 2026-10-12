import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dictation } from '../../src/core/voice/dictation'
import { recorderHelper } from '../../src/core/voice/recorderHelper'
import { startRecorder } from '../../src/host/voice/voiceProcesses'
import { captureListener, SILENT_LOG } from './helpers/captureListener'

const { admit, spawn } = vi.hoisted(() => ({
  admit: vi.fn<() => Promise<undefined>>(),
  spawn: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('../../src/core/resources/admission', () => ({
  admitResource: admit,
  resourceWindowsJob: vi.fn(),
  stopResourceTree: vi.fn(),
}))
vi.mock('../../src/host/resources/resourceAdmission', () => ({
  observeResourceProcess: vi.fn(),
}))

class RecorderChild extends EventEmitter {
  public readonly stdin = new PassThrough()
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM')
  })
}

afterEach(() => vi.resetAllMocks())

function setup() {
  const child = new RecorderChild()
  spawn.mockReturnValue(child)
  const recorded = captureListener()
  const dictation = new Dictation({
    invocation: { command: '/fake/arecord', args: [] },
    spawn: () => recorderHelper('arecord', () => startRecorder('/fake/arecord', [])),
    listener: recorded.listener,
    log: SILENT_LOG,
  })
  return { child, dictation, ...recorded }
}

async function pendingRecorder() {
  const admission = Promise.withResolvers<undefined>()
  admit.mockReturnValue(admission.promise)
  const t = setup()
  t.dictation.start()
  await Promise.resolve()
  expect(t.statuses).toEqual(['starting'])
  return { t, admission }
}

/** Lets reap continuations (exit-awaited ends) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve()
  }
}

describe('Linux recorder admission and OS spawn readiness (RVCM352 P3)', () => {
  it.each(['ENOENT', 'EACCES'])('never announces listening on asynchronous %s', async (code) => {
    admit.mockResolvedValue(undefined)
    const t = setup()
    try {
      t.dictation.start()
      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalledOnce()
      })
      expect(t.statuses).toEqual(['starting'])
      t.child.emit('error', Object.assign(new Error(code), { code }))
      // The failure is said once the (nonexistent) process end settles.
      await flush()
      expect(t.statuses).toEqual(['starting', 'idle'])
      expect(t.errors).toEqual([`arecord ended (could not start: ${code})`])
      t.child.emit('spawn')
      expect(t.statuses).not.toContain('listening')
    } finally {
      await t.dictation.dispose()
    }
  })

  it('never spawns or announces listening when asynchronous admission is refused', async () => {
    const { t, admission } = await pendingRecorder()
    try {
      expect(spawn).not.toHaveBeenCalled()
      admission.reject(new Error('resource refused'))
      await vi.waitFor(() => {
        expect(t.errors).toHaveLength(1)
      })
      expect(t.statuses).toEqual(['starting', 'idle'])
      expect(t.errors[0]).toContain('resource refused')
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await t.dictation.dispose()
    }
  })

  it('announces listening only after admitted spawn, and cancels a pending spawn on stop', async () => {
    const { t, admission } = await pendingRecorder()
    try {
      admission.resolve(undefined)
      await vi.waitFor(() => {
        expect(spawn).toHaveBeenCalledOnce()
      })
      expect(t.statuses).toEqual(['starting'])
      t.child.emit('spawn')
      expect(t.statuses).toEqual(['starting', 'listening'])
      t.dictation.stop()
      // Idle waits for the recorder's observed exit, not the stop press.
      await flush()
      expect(t.statuses.at(-1)).toBe('idle')
      expect(t.stopped()).toBe(1)
      const stoppedStatuses = [...t.statuses]
      t.child.emit('spawn')
      expect(t.statuses).toEqual(stoppedStatuses)
    } finally {
      await t.dictation.dispose()
    }
  })

  it('cancels admission before spawn without announcing listening', async () => {
    const admission = Promise.withResolvers<undefined>()
    admit.mockReturnValue(admission.promise)
    const t = setup()
    try {
      t.dictation.start()
      await Promise.resolve()
      t.dictation.stop()
      admission.resolve(undefined)
      await vi.waitFor(() => {
        expect(t.stopped()).toBe(1)
      })
      expect(spawn).not.toHaveBeenCalled()
      expect(t.statuses).toEqual(['starting', 'idle'])
      expect(t.errors).toEqual([])
    } finally {
      await t.dictation.dispose()
    }
  })
})
