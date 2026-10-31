// The Windows screen recorder's removal, runs and availability: a refused
// setup removes its reserved directory (an absent one is done, a scanner
// lock retries bounded, the person's cancel ends the wait), a malformed
// helper line cancels the run, a helper that will not launch refuses the
// run and still removes the directory, the person's length reaches
// --record as set, --latest is asked at any age, and a missing helper
// reads unavailable. The composition is the product's own: the driver's
// mechanical deps come from createWindowsRecorderDeps (its reserve and
// remove over the real filesystem, its trust verdict over the real
// check), and launched helpers are real node children the test owns,
// speaking through the product's own line framer. Nothing here invents a
// filesystem error: ENOENT, denied and cleared locks are the kernel's
// own, and the lock kinds that only a scanner explains are pinned
// directly on the driver's own classifier.
import { execFile } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  isRemoveRetriable,
  windowsScreenRecorder,
  type WindowsRecorderDeps,
} from '../../src/core/media/record/windows'
import type { ScreenRecordingRun } from '../../src/core/media/record/driver'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import {
  recordingLineProcess,
  startRecordingHelper,
} from '../../src/host/media/recordingHelperProcess'
import {
  createWindowsRecorderDeps,
  type WindowsRecorderMechanicalDeps,
} from '../../src/host/media/windowsRecorderDeps'
import { MEDIA_FILE_ID_MIN_BYTES, MEDIA_MAX_UPLOAD_MIB, UI_TEXT } from '../../src/shared/constants'
import { denyWrites } from './helpers/deniedAccess'
import { usingTempDir } from './helpers/temporaryFolders'

const runFile = promisify(execFile)

const recordOptions = { maxSeconds: 10, microphone: false, systemAudio: false }

function noopCountdown(): void {
  // Countdown display is the host's.
}

function unsubscribeNone(): void {
  // No host shutdown fires in these tests.
}

function noShutdownSubscription(): () => void {
  return unsubscribeNone
}

/**
The product's mechanical deps, counting every removal of the reserved
directory. `onFailedRemove` runs after a failed attempt is counted, before
its error reaches the driver, so a test can change the filesystem the
next attempt will meet.
*/
function mechanical(
  folder: string,
  onFailedRemove?: (attempts: number) => Promise<void>,
): {
  base: WindowsRecorderMechanicalDeps
  attempts: string[]
} {
  const attempts: string[] = []
  const mech = createWindowsRecorderDeps({
    extensionPath: path.join(folder, 'extension'),
    storageDir: path.join(folder, 'storage'),
    tempRoot: path.join(folder, 'temp'),
    systemRoot: '',
    l10n: { table: UI_TEXT, locale: 'en' },
  })
  return {
    attempts,
    base: {
      ...mech,
      removeDirectory: async (directory: string): Promise<void> => {
        attempts.push(directory)
        try {
          await mech.removeDirectory(directory)
        } catch (error: unknown) {
          await onFailedRemove?.(attempts.length)
          throw error
        }
      },
    },
  }
}

function depsOf(
  base: WindowsRecorderMechanicalDeps,
  overrides: Partial<WindowsRecorderDeps>,
): WindowsRecorderDeps {
  return {
    isLocal: true,
    isInteractiveUserAction: () => true,
    prepareHelper: base.prepareHelper,
    probeRecording: base.probeRecording,
    verifyHelper: base.verifyHelper,
    launch: base.launch,
    reserveDirectory: base.reserveDirectory,
    removeDirectory: base.removeDirectory,
    inspect: base.inspect,
    onShutdown: noShutdownSubscription,
    maxBytes: MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES,
    ...overrides,
  }
}

/**
A helper path the product's own trust check refuses for real. The file is
real; on Windows its folder is opened to Everyone, so the check refuses
the replaceable install, and off Windows the win32 probes cannot run, so
the same check refuses for want of proof.
*/
async function untrustedHelper(folder: string): Promise<string> {
  const bin = path.join(folder, 'bin')
  await mkdir(bin, { recursive: true })
  const helper = path.join(bin, 'untrusted-helper.exe')
  await writeFile(helper, 'not the helper')
  if (process.platform === 'win32') {
    const system32 = path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32')
    await runFile(path.join(system32, 'icacls.exe'), [bin, '/grant', '*S-1-1-0:(OI)(CI)F'])
  }
  return helper
}

/** A helper path nothing was ever installed at: launching it fails for real. */
function absentHelper(folder: string): string {
  return path.join(folder, 'missing', 'recorder.exe')
}

async function scriptFile(folder: string, name: string, body: string): Promise<string> {
  const script = path.join(folder, name)
  await writeFile(script, body)
  return script
}

// The owned children below answer as the driver's input language requires;
// the spawn, the pipes, the framing and the exits are all real.
const EXIT_SCRIPT = 'process.exit(1)\n'
// A helper that speaks garbage, then records what the driver sends it
// back: a malformed line must cancel the run, and the cancel reaches the
// helper on stdin. The script exits on the first stdin it gets; the
// 500 ms self-end only bounds a driver that never answers.
const MALFORMED_SCRIPT = String.raw`import { dirname, join } from 'node:path';
import { appendFileSync } from 'node:fs';
const record = join(dirname(process.argv[3] ?? ''), 'helper-stdin.txt');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  appendFileSync(record, chunk);
  process.exit(0);
});
process.stdout.write('not json{{{\n}', () => {});
setTimeout(() => {
  process.exit(0)
}, 500);
`
const NOTFOUND_SCRIPT = String.raw`process.stdout.write('{"type":"error","code":"notFound"}\n', () => {
  process.exit(1)
});
`
// A helper mid-recording: it waits for the driver's stop or cancel on
// stdin, then exits clean. The 4 s self-end is harness hygiene only: on
// every correct path the driver ends it in milliseconds, and a broken
// driver must not leave the child behind on CI.
const WAIT_CANCEL_SCRIPT = `process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {
  process.exit(0)
});
setTimeout(() => {
  process.exit(3)
}, 4000);
`
// A helper that fails once its output's parent refuses writes: it probes
// the parent of the reserved directory it was given (its own argv[3]) and
// exits 1 as soon as a probe write fails. The test locks the parent when
// it is ready, so the failure synchronizes on the lock itself instead of
// on a timer.
const EXIT_LOCKED_SCRIPT = `import { dirname, join } from 'node:path';
import { unlinkSync, writeFileSync } from 'node:fs';
const probe = join(dirname(process.argv[3] ?? ''), \`probe-\${String(process.pid)}\`);
const timer = setInterval(() => {
  try {
    writeFileSync(probe, 'x');
    unlinkSync(probe);
  } catch {
    clearInterval(timer);
    process.exit(1);
  }
}, 20);
setTimeout(() => {
  process.exit(3)
}, 8000);
`

/**
The test's launch over a real child: the owned binary runs the scenario
script, and the product's own port assembly wires it, so the driver
side is proven against the real assembly.
*/
function scriptLaunch(
  script: string,
  launched: { executable: string; args: readonly string[] }[],
): WindowsRecorderDeps['launch'] {
  const node = process.execPath
  const env = noWorkspaceChildEnvironment(process.platform, process.env, realpathSync)
  return (executable, args) => {
    launched.push({ executable, args })
    return recordingLineProcess(startRecordingHelper(node, [script, ...args], env))
  }
}

/** A run whose helper verification refuses, so setup reaches removal. */
async function startUnverifiable(
  folder: string,
  base: WindowsRecorderMechanicalDeps,
): Promise<ScreenRecordingRun> {
  const helper = await untrustedHelper(folder)
  const recorder = windowsScreenRecorder(
    depsOf(base, { prepareHelper: () => Promise.resolve(helper) }),
  )
  const run = await recorder.start(recordOptions, noopCountdown)
  return run
}

interface OwnedRecorder {
  recorder: ReturnType<typeof windowsScreenRecorder>
  launched: { executable: string; args: readonly string[] }[]
  reserved: string[]
}

/**
A recorder whose helper is the test's own binary running a scenario
script: the test trusts its own child (like the tab suite's test key),
launches are recorded, and reserved directories are recorded so the test
can meet them on the filesystem.
*/
async function ownedRecorder(
  folder: string,
  base: WindowsRecorderMechanicalDeps,
  scriptName: string,
  scriptBody: string,
): Promise<OwnedRecorder> {
  const script = await scriptFile(folder, scriptName, scriptBody)
  const launched: { executable: string; args: readonly string[] }[] = []
  const reserved: string[] = []
  const recorder = windowsScreenRecorder(
    depsOf(base, {
      prepareHelper: () => Promise.resolve(process.execPath),
      verifyHelper: () => Promise.resolve(true),
      launch: scriptLaunch(script, launched),
      reserveDirectory: async () => {
        const directory = await base.reserveDirectory()
        reserved.push(directory)
        return directory
      },
    }),
  )
  return { recorder, launched, reserved }
}

/**
A started recording against the exit-locked scenario, met on the
filesystem so a lock can hold it.
*/
async function startLockedRun(
  folder: string,
  base: WindowsRecorderMechanicalDeps,
): Promise<ScreenRecordingRun> {
  const { recorder, reserved } = await ownedRecorder(
    folder,
    base,
    'exit-locked.mjs',
    EXIT_LOCKED_SCRIPT,
  )
  const run = await recorder.start(recordOptions, noopCountdown)
  expect(reserved).toHaveLength(1)
  await mkdir(reserved[0] ?? '', { recursive: true })
  return run
}

describe('windows screen recorder removal', () => {
  it('resolves when the directory is already gone instead of burning retries', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base, attempts } = mechanical(folder)
      const run = await startUnverifiable(folder, base)
      await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
      // One attempt only: an already-removed directory is done, not retried.
      expect(attempts).toHaveLength(1)
      expect(attempts[0]?.startsWith(path.join(folder, 'temp'))).toBe(true)
    })
  })

  it('removes once a brief scanner lock clears inside the attempts', async () => {
    await usingTempDir('win-record-', async (folder) => {
      // The reserved directory must exist for a lock to hold it: removing
      // an absent directory succeeds whatever the parent allows. The run
      // launches first, the test meets the reservation on the filesystem,
      // and only then locks the parent; the child fails on the lock
      // itself, and the first failed attempt lifts it before the wait ends.
      const lock: { restore?: () => Promise<void>; isRestored?: boolean } = {}
      const restoreOnce = async (): Promise<void> => {
        if (lock.isRestored === true || lock.restore === undefined) return
        lock.isRestored = true
        await lock.restore()
      }
      const { base, attempts } = mechanical(folder, async (count) => {
        if (count === 1) await restoreOnce()
      })
      const run = await startLockedRun(folder, base)
      lock.restore = await denyWrites(path.join(folder, 'temp'))
      try {
        await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
        expect(attempts).toHaveLength(2)
      } finally {
        await restoreOnce()
      }
    })
  })

  it('stops a never-clearing scanner lock after three attempts, keeping its kind', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base, attempts } = mechanical(folder)
      const run = await startLockedRun(folder, base)
      const restore = await denyWrites(path.join(folder, 'temp'))
      try {
        // Unbounded code would retry here past the suite's own timeout; the
        // bound surfaces the lock error after three attempts (~400 ms of
        // waits). The run is never cancelled, so all three attempts run.
        const started = Date.now()
        let surfaced: unknown
        try {
          await run.result
        } catch (error: unknown) {
          surfaced = error
        }
        expect(surfaced).toBeInstanceOf(Error)
        expect(['EACCES', 'EPERM', 'EBUSY', 'ENOTEMPTY']).toContain(
          (surfaced as NodeJS.ErrnoException).code,
        )
        expect(attempts).toHaveLength(3)
        expect(new Set(attempts).size).toBe(1)
        expect(Date.now() - started).toBeGreaterThanOrEqual(300)
      } finally {
        await restore()
      }
    })
  })

  it('stops retrying a scanner lock at the person cancel, surfacing the lock error', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base, attempts } = mechanical(folder)
      const { recorder, launched, reserved } = await ownedRecorder(
        folder,
        base,
        'wait-cancel-exit.mjs',
        WAIT_CANCEL_SCRIPT,
      )
      const run = await recorder.start(recordOptions, noopCountdown)
      expect(launched).toHaveLength(1)
      expect(reserved).toHaveLength(1)
      await mkdir(reserved[0] ?? '', { recursive: true })
      const restore = await denyWrites(path.join(folder, 'temp'))
      try {
        const cancelled = run.cancel()
        let surfaced: unknown
        try {
          await run.result
        } catch (error: unknown) {
          surfaced = error
        }
        await expect(cancelled).rejects.toBe(surfaced)
        // One attempt only: the person's cancel ends the wait, and the lock
        // error keeps its kind instead of burning attempts.
        expect(['EACCES', 'EPERM', 'EBUSY', 'ENOTEMPTY']).toContain(
          (surfaced as NodeJS.ErrnoException).code,
        )
        expect(attempts).toHaveLength(1)
      } finally {
        await restore()
      }
    })
  })

  it('retries a held lock and surfaces anything else at once', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']) {
      expect(isRemoveRetriable({ code })).toBe(true)
    }
    // A failure no scanner explains (a disk fault, a path through a file,
    // a plain failure) is not worth the bounded wait.
    for (const error of [{ code: 'EIO' }, { code: 'ENOTDIR' }, new Error('plain'), {}]) {
      expect(isRemoveRetriable(error)).toBe(false)
    }
  })
})

describe('windows screen recorder runs', () => {
  it('cancels the run on a malformed helper line instead of parsing it', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base, attempts } = mechanical(folder)
      const { recorder, launched } = await ownedRecorder(
        folder,
        base,
        'malformed.mjs',
        MALFORMED_SCRIPT,
      )
      const run = await recorder.start(recordOptions, noopCountdown)
      expect(launched).toHaveLength(1)
      const outcome = await run.result
      expect(outcome.ok).toBe(false)
      // The cancel reached the helper on its stdin; without it the run
      // would have ignored the garbage instead of cancelling.
      expect(readFileSync(path.join(folder, 'temp', 'helper-stdin.txt'), 'utf8')).toContain(
        'cancel',
      )
      expect(attempts).toHaveLength(1)
    })
  })

  it('refuses the run when the helper will not launch, and removes the directory', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base, attempts } = mechanical(folder)
      const entered: { executable: string; args: readonly string[] }[] = []
      const recorder = windowsScreenRecorder(
        depsOf(base, {
          prepareHelper: () => Promise.resolve(absentHelper(folder)),
          verifyHelper: () => Promise.resolve(true),
          launch: (executable, args) => {
            entered.push({ executable, args })
            return base.launch(executable, args)
          },
        }),
      )
      const run = await recorder.start(recordOptions, noopCountdown)
      const outcome = await run.result
      expect(outcome.ok).toBe(false)
      // The product's own launch was entered and failed for real (the
      // binary was never installed), and the reserved directory is gone:
      // removing it again fails ENOENT.
      expect(entered).toHaveLength(1)
      expect(entered[0]?.executable).toBe(absentHelper(folder))
      expect(entered[0]?.args[0]).toBe('--record')
      expect(attempts).toHaveLength(1)
      await expect(rm(attempts[0] ?? '', { recursive: true, force: false })).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })
  })

  // D121: the person's length reaches the helper's --record as set, with no
  // floor or ceiling of ours (the helper's own parsing is proven natively).
  it.each([5, 3600])(
    'hands the helper a set recording length of %i seconds as set',
    async (seconds) => {
      await usingTempDir('win-record-', async (folder) => {
        const { base, attempts } = mechanical(folder)
        const { recorder, launched } = await ownedRecorder(folder, base, 'exit.mjs', EXIT_SCRIPT)
        const run = await recorder.start(
          { maxSeconds: seconds, microphone: false, systemAudio: false },
          noopCountdown,
        )
        expect(launched.map((call) => call.args)).toEqual([
          [
            '--record',
            expect.any(String),
            String(MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES),
            String(process.pid),
            String(seconds),
            'false',
            'false',
            UI_TEXT.media.recordingStart,
            UI_TEXT.media.recordingStop,
          ],
        ])
        expect(launched[0]?.executable).toBe(process.execPath)
        const outcome = await run.result
        expect(outcome.ok).toBe(false)
        expect(attempts).toHaveLength(1)
      })
    },
  )

  // D121: --latest carries no age of ours, and a helper that found nothing
  // is told to the person with the two folders it searched.
  it('asks the helper for the latest recording at any age and names both folders when none is found', async () => {
    await usingTempDir('win-record-', async (folder) => {
      const { base } = mechanical(folder)
      const { recorder, launched } = await ownedRecorder(
        folder,
        base,
        'notfound.mjs',
        NOTFOUND_SCRIPT,
      )
      const outcome = await recorder.attachLatest()
      expect(launched.map((call) => call.args)).toEqual([
        [
          '--latest',
          expect.any(String),
          String(MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES),
          String(process.pid),
        ],
      ])
      expect(outcome).toEqual({
        ok: false,
        reason: String.raw`No screen recording was found in Videos\Screen Recordings or Videos\Captures.`,
      })
    })
  })

  it('reports unavailable when helper preparation fails', async () => {
    await usingTempDir('win-record-', async (folder) => {
      // The extension folder was never installed, so the product's own
      // preparation finds no helper source: genuinely unavailable.
      const { base } = mechanical(folder)
      const recorder = windowsScreenRecorder(depsOf(base, {}))
      await expect(recorder.available()).resolves.toEqual({
        ok: false,
        reason: expect.any(String),
      })
    })
  })
})
