// The macOS screen driver's failure handling (D119 catch burn-down): a spawn
// that will not start leaves the check inconclusive, an unverified helper
// refuses, a malformed probe refuses as probe, a dead command channel ends
// the helper, a malformed frame ends the run, and an unverifiable recording
// delivers nothing. Helpers below are the driver's own injected spawn seam
// over real event emitters; every failure is a real throw, a real file-system
// error, or a real malformed line through the real protocol parser.
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  macosScreenRecordingDriver,
  type MacosScreenRecordingDeps,
} from '../../src/core/media/record/macos'
import type { ScreenRecordingDriver, ScreenRecordingRun } from '../../src/core/media/record/driver'
import type { HelperChild } from '../../src/core/voice/dictation'

const HELPER_PATH = '/Applications/MuseDictate.app/Contents/MacOS/muse-dictate'
const SIGNATURE_PATH = '/Applications/MuseDictate.app'

const VALID_PROBE = JSON.stringify({
  type: 'available',
  responsibility: 'parent',
  screen: 'authorized',
  microphone: 'authorized',
  display: 'available',
  encoder: 'available',
})

interface TestHelper extends HelperChild {
  emitLine(line: string): void
  emitExit(description: string): void
  readonly sent: string[]
  readonly wasKilled: boolean
}

function testHelper(
  script: (helper: TestHelper) => void,
  send: (line: string) => void,
): TestHelper {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  let exitListener: ((description: string) => void) | undefined
  let wasKilled = false
  const helper: TestHelper = {
    stdout: { on: (event, listener) => stdout.on(event, listener) },
    stderr: { on: (event, listener) => stderr.on(event, listener) },
    sent: [],
    get wasKilled() {
      return wasKilled
    },
    send: (line) => {
      helper.sent.push(line)
      send(line)
    },
    onExit: (listener) => {
      exitListener = listener
    },
    kill: () => {
      wasKilled = true
    },
    emitLine: (line) => {
      stdout.emit('data', line)
    },
    emitExit: (description) => {
      exitListener?.(description)
    },
  }
  queueMicrotask(() => {
    script(helper)
  })
  return helper
}

function exitZero(helper: TestHelper): void {
  helper.emitExit('exit code 0')
}

function noUnsubscribe(): void {
  // No host suspension subscription in tests.
}

function keepSuspendSubscription(): () => void {
  return noUnsubscribe
}

function noopCountdown(): void {
  // Countdown display is the host's.
}

function depsWith(
  spawn: MacosScreenRecordingDeps['spawn'],
  overrides: Partial<MacosScreenRecordingDeps> = {},
): { deps: MacosScreenRecordingDeps; helpers: TestHelper[] } {
  const helpers: TestHelper[] = []
  return {
    helpers,
    deps: {
      platform: 'darwin',
      helperPath: HELPER_PATH,
      tempRoot: tmpdir(),
      environment: {},
      fileExists: (file) => file === HELPER_PATH,
      verifyTrustedHelper: () =>
        Promise.resolve({
          path: HELPER_PATH,
          signaturePath: SIGNATURE_PATH,
          designatedRequirement: 'identifier "com.example.muse-dictate"',
        }),
      onSuspend: keepSuspendSubscription,
      spawn: (command, args, env) => {
        const helper = spawn(command, args, env)
        helpers.push(helper as TestHelper)
        return helper
      },
      inspect: () => Promise.reject(new Error('unreachable in failure tests')),
      startupTimeoutMs: 1000,
      finishTimeoutMs: 50,
      maxProtocolChars: 65_536,
      ...overrides,
    },
  }
}

/** An isolated temp root, removed when the test finishes. */
async function macosTempRoot(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'muse-macos-record-test-'))
  onTestFinished(() => rm(tempRoot, { recursive: true, force: true }))
  return tempRoot
}

/** Answer the availability probe; true when the line was the probe call. */
function isProbeCall(helper: TestHelper, args: readonly string[]): boolean {
  if (!args.includes('--probe')) return false
  helper.emitLine(`${VALID_PROBE}\n`)
  exitZero(helper)
  return true
}

const recordOptions = { maxSeconds: 10, microphone: false, systemAudio: false }

/** Start a run on a temp root. */
function startDriver(
  deps: MacosScreenRecordingDeps,
  tempRoot: string,
): Promise<ScreenRecordingRun> {
  const driver = macosScreenRecordingDriver({ ...deps, tempRoot })
  return driver.start(recordOptions, noopCountdown)
}

/** A refused outcome after the helper was ended. */
function expectHelperEnded(outcome: unknown, helpers: TestHelper[]): void {
  expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  expect(helpers.some((helper) => helper.wasKilled)).toBe(true)
}

/** A run that refuses, leaving its temp root empty. */
async function refusedAndRemoved(driver: ScreenRecordingDriver, tempRoot: string): Promise<void> {
  const run = await driver.start(recordOptions, noopCountdown)
  await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
  const remaining = await readdir(tempRoot)
  expect(remaining).toEqual([])
}

describe('macos driver availability', () => {
  it('refuses without a trusted-helper verifier', async () => {
    const { deps } = depsWith(() => {
      throw new Error('spawn must not run without trust')
    })
    const { verifyTrustedHelper: _dropped, ...unverified } = deps
    const driver = macosScreenRecordingDriver(unverified)
    await expect(driver.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })

  it('leaves the check inconclusive when spawning fails', async () => {
    const { deps } = depsWith(() => {
      throw new Error('spawn refused')
    })
    const driver = macosScreenRecordingDriver(deps)
    await expect(driver.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })

  it('refuses as probe when the helper answers malformed JSON', async () => {
    const { deps } = depsWith((_command, args) =>
      testHelper(
        (helper) => {
          if (args.includes('--probe')) helper.emitLine('not json{{{')
          exitZero(helper)
        },
        () => {
          // No commands in the probe.
        },
      ),
    )
    const driver = macosScreenRecordingDriver(deps)
    await expect(driver.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })
})

describe('macos driver start', () => {
  it('refuses the run when the recorder will not spawn, and removes the directory', async () => {
    const tempRoot = await macosTempRoot()
    const { deps } = depsWith((_command, args) =>
      testHelper(
        (helper) => {
          if (!isProbeCall(helper, args)) exitZero(helper)
        },
        () => {
          // No commands before the run.
        },
      ),
    )
    const spawning: MacosScreenRecordingDeps['spawn'] = (command, args, env) => {
      if (args.includes('--record-screen') && args.includes('--output')) {
        throw new Error('recorder refused to start')
      }
      return deps.spawn(command, args, env)
    }
    const refusing = macosScreenRecordingDriver({ ...deps, tempRoot, spawn: spawning })
    await refusedAndRemoved(refusing, tempRoot)
  })

  it('ends the helper when its command channel is dead', async () => {
    const tempRoot = await macosTempRoot()
    const { deps, helpers } = depsWith((_command, args) =>
      testHelper(
        (helper) => {
          if (isProbeCall(helper, args)) return
          if (!args.includes('--record-screen')) exitZero(helper)
        },
        () => {
          throw new Error('channel closed')
        },
      ),
    )
    const run = await startDriver(deps, tempRoot)
    await run.stop()
    const outcome = await run.result
    expectHelperEnded(outcome, helpers)
  })

  it('ends the run on a malformed helper frame', async () => {
    const tempRoot = await macosTempRoot()
    const { deps, helpers } = depsWith((_command, args) =>
      testHelper(
        (helper) => {
          if (isProbeCall(helper, args)) return
          if (args.includes('--record-screen')) helper.emitLine('not json{{{\n')
          else exitZero(helper)
        },
        () => {
          // No commands matter once the protocol breaks.
        },
      ),
    )
    const run = await startDriver(deps, tempRoot)
    const outcome = await run.result
    expectHelperEnded(outcome, helpers)
  })

  it('delivers nothing when the helper writes no file', async () => {
    const tempRoot = await macosTempRoot()
    const { deps } = depsWith((_command, args) =>
      testHelper(
        (helper) => {
          if (isProbeCall(helper, args)) return
          if (args.includes('--record-screen')) {
            helper.emitLine('{"type":"recording"}\n{"type":"finished"}\n')
            exitZero(helper)
          } else exitZero(helper)
        },
        () => {
          // No commands matter once the helper finishes.
        },
      ),
    )
    const driver = macosScreenRecordingDriver({ ...deps, tempRoot })
    await refusedAndRemoved(driver, tempRoot)
  })
})
