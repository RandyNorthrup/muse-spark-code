// The Windows screen recorder's failure handling (D119 catch burn-down): a
// removal that finds nothing missing resolves, a scanner's lock retries
// bounded, any other removal failure surfaces at once with its cause, and a
// malformed helper line cancels the run instead of crossing as a frame. The
// helper below is the driver's own injected process seam; every failure is a
// real rejection, a real file-system error, or a real malformed line through
// the real parser.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  windowsScreenRecorder,
  type WindowsRecorderDeps,
  type WindowsRecorderProcess,
} from '../../src/core/media/record/windows'
import type { ScreenRecordingRun } from '../../src/core/media/record/driver'
import { MEDIA_FILE_ID_MIN_BYTES, MEDIA_MAX_UPLOAD_MIB, UI_TEXT } from '../../src/shared/constants'

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

interface TestProcess extends WindowsRecorderProcess {
  readonly sent: string[]
  emitLine(line: string): void
  emitExit(code: number | null): void
}

function launchInto(processes: TestProcess[]): WindowsRecorderProcess {
  const process = testProcess()
  processes.push(process)
  return process
}

function testProcess(): TestProcess {
  const sent: string[] = []
  let lineListener: ((line: string) => void) | undefined
  let exitListener: ((code: number | null) => void) | undefined
  return {
    sent,
    onLine: (listener) => {
      lineListener = listener
    },
    onExit: (listener) => {
      exitListener = listener
    },
    send: (command) => {
      sent.push(command)
    },
    kill: () => Promise.resolve(),
    emitLine: (line) => {
      lineListener?.(line)
    },
    emitExit: (code) => {
      exitListener?.(code)
    },
  }
}

function depsWith(overrides: Partial<WindowsRecorderDeps>): {
  deps: WindowsRecorderDeps
  processes: TestProcess[]
} {
  const processes: TestProcess[] = []
  return {
    processes,
    deps: {
      isLocal: true,
      isInteractiveUserAction: () => true,
      prepareHelper: () => Promise.resolve(String.raw`C:\helpers\recorder.exe`),
      probeRecording: () => Promise.resolve(true),
      verifyHelper: () => Promise.resolve(true),
      launch: launchInto.bind(undefined, processes),
      reserveDirectory: () => mkdtemp(path.join(tmpdir(), 'muse-win-record-test-')),
      removeDirectory: (directory) => rm(directory, { recursive: true, force: true }),
      inspect: () => Promise.reject(new Error('unreachable in failure tests')),
      onShutdown: noShutdownSubscription,
      maxBytes: MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES,
      ...overrides,
    },
  }
}

function unsubscribeNone(): void {
  // No host subscription in tests.
}

function noShutdownSubscription(): () => void {
  return unsubscribeNone
}

const recordOptions = { maxSeconds: 10, microphone: false, systemAudio: false }

/** A run whose helper verification refuses, so setup reaches removal. */
function startWithUnverifiableHelper(
  removeDirectory: WindowsRecorderDeps['removeDirectory'],
): Promise<ScreenRecordingRun> {
  const { deps } = depsWith({
    verifyHelper: () => Promise.resolve(false),
    removeDirectory,
  })
  const recorder = windowsScreenRecorder(deps)
  return recorder.start(recordOptions, noopCountdown)
}

function noopCountdown(): void {
  // Countdown display is the host's.
}

/** A recorder whose helper launches are kept with their argument arrays. */
function launchRecording(): {
  deps: WindowsRecorderDeps
  launched: { args: readonly string[]; child: TestProcess }[]
} {
  const launched: { args: readonly string[]; child: TestProcess }[] = []
  const { deps } = depsWith({
    launch: (_executable, args) => {
      const child = testProcess()
      launched.push({ args, child })
      return child
    },
  })
  return { deps, launched }
}

describe('windows screen recorder removal', () => {
  it('resolves when the directory is already gone instead of burning retries', async () => {
    const removed: string[] = []
    const run = await startWithUnverifiableHelper((directory) => {
      removed.push(directory)
      return Promise.reject(codedError(`ENOENT: ${directory}`, 'ENOENT'))
    })
    await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
    // One attempt only: an already-removed directory is done, not retried.
    expect(removed).toHaveLength(1)
  })

  it('retries a scanner lock bounded, then removes', async () => {
    const attempts: string[] = []
    const run = await startWithUnverifiableHelper((directory) => {
      attempts.push(directory)
      return attempts.length < 3
        ? Promise.reject(codedError('EPERM: locked by scanner', 'EPERM'))
        : rm(directory, { recursive: true, force: true })
    })
    await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
    expect(attempts).toHaveLength(3)
  })

  it('surfaces a failure no scanner explains at once, with its cause', async () => {
    const attempts: string[] = []
    const failure = codedError('EIO: disk fault', 'EIO')
    let surfaced: unknown
    try {
      const run = await startWithUnverifiableHelper((directory) => {
        attempts.push(directory)
        return Promise.reject(failure)
      })
      await run.result
    } catch (error: unknown) {
      surfaced = error
    }
    expect(surfaced).toBe(failure)
    expect(attempts).toHaveLength(1)
  })
})

describe('windows screen recorder runs', () => {
  it('cancels the run on a malformed helper line instead of parsing it', async () => {
    const { deps, processes } = depsWith({})
    const recorder = windowsScreenRecorder(deps)
    const run = await recorder.start(recordOptions, noopCountdown)
    expect(processes).toHaveLength(1)
    processes[0]?.emitLine('not json{{{')
    processes[0]?.emitExit(0)
    const outcome = await run.result
    expect(outcome.ok).toBe(false)
  })

  it('refuses the run when the helper will not launch, and removes the directory', async () => {
    const reserved: string[] = []
    const { deps } = depsWith({
      reserveDirectory: async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'muse-win-record-test-'))
        reserved.push(directory)
        return directory
      },
      launch: () => {
        throw new Error('helper refused to start')
      },
    })
    const recorder = windowsScreenRecorder(deps)
    const run = await recorder.start(recordOptions, noopCountdown)
    const outcome = await run.result
    expect(outcome.ok).toBe(false)
    expect(reserved).toHaveLength(1)
    await expect(rm(reserved[0] ?? '', { recursive: true, force: false })).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  // D121: the person's length reaches the helper's --record as set, with no
  // floor or ceiling of ours (the helper's own parsing is proven natively).
  it.each([5, 3600])(
    'hands the helper a set recording length of %i seconds as set',
    async (seconds) => {
      const { deps, launched } = launchRecording()
      const run = await windowsScreenRecorder(deps).start(
        { maxSeconds: seconds, microphone: false, systemAudio: false },
        noopCountdown,
      )
      expect(launched.map((call) => call.args)).toEqual([
        [
          '--record',
          expect.any(String),
          String(deps.maxBytes),
          String(process.pid),
          String(seconds),
          'false',
          'false',
          UI_TEXT.media.recordingStart,
          UI_TEXT.media.recordingStop,
        ],
      ])
      launched[0]?.child.emitExit(1)
      const outcome = await run.result
      expect(outcome.ok).toBe(false)
    },
  )

  // D121: --latest carries no age of ours, and a helper that found nothing
  // is told to the person with the two folders it searched.
  it('asks the helper for the latest recording at any age and names both folders when none is found', async () => {
    const { deps, launched } = launchRecording()
    const result = windowsScreenRecorder(deps).attachLatest()
    await expect.poll(() => launched.length).toBe(1)
    expect(launched[0]?.args).toEqual([
      '--latest',
      expect.any(String),
      String(deps.maxBytes),
      String(process.pid),
    ])
    launched[0]?.child.emitLine('{"type":"error","code":"notFound"}')
    launched[0]?.child.emitExit(1)
    await expect(result).resolves.toEqual({
      ok: false,
      reason: String.raw`No screen recording was found in Videos\Screen Recordings or Videos\Captures.`,
    })
  })

  it('reports unavailable when helper preparation fails', async () => {
    const { deps } = depsWith({
      prepareHelper: () => Promise.reject(new Error('no helper installed')),
    })
    const recorder = windowsScreenRecorder(deps)
    await expect(recorder.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })
})
