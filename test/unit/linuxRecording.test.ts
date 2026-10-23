// The Linux screen driver's failure handling (D119 catch burn-down): an
// encoder probe failure reports unavailable, a failed portal setup refuses
// the run, a missing capture directory never hides the others, and an
// unverifiable latest file reports unavailable. Directory listing runs over
// the real file system; the portal, encoder probe and preview copy fail for
// real through the driver's own injected ports.
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  LINUX_RECORDING_HELPER_MAX_BYTES,
  findLatestRecording,
  linuxRecordingDriver,
  type LinuxRecordingPort,
} from '../../src/core/media/record/linux'

const HOUR_MS = 60 * 60 * 1000
/** The person's name for a test root, as the not-found sentence shows it. */
const PLACE = 'Screencasts'

function driverPort(overrides: Partial<LinuxRecordingPort>): LinuxRecordingPort {
  return {
    userInitiated: () => true,
    localScreen: () => true,
    signal: new AbortController().signal,
    findEncoder: () => Promise.resolve('/usr/bin/gst-launch-1.0'),
    openPortal: () => Promise.reject(new Error('no portal in tests')),
    createPrivateRecording: () => Promise.reject(new Error('no recording in tests')),
    launchVerified: () => Promise.reject(new Error('no encoder in tests')),
    sniff: () => Promise.reject(new Error('no sniffing in tests')),
    maxBytes: LINUX_RECORDING_HELPER_MAX_BYTES,
    ...overrides,
  }
}

const recordOptions = { maxSeconds: 10, microphone: false, systemAudio: false }

function noopCountdown(): void {
  // Countdown display is the host's.
}

describe('linux screen driver availability', () => {
  it('reports unavailable when the encoder probe fails', async () => {
    const driver = linuxRecordingDriver(
      driverPort({ findEncoder: () => Promise.reject(new Error('no GStreamer in tests')) }),
    )
    await expect(driver.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })

  it('reports remote when there is no local screen', async () => {
    const driver = linuxRecordingDriver(driverPort({ localScreen: () => false }))
    await expect(driver.available()).resolves.toEqual({
      ok: false,
      reason: expect.any(String),
    })
  })
})

describe('linux screen driver start', () => {
  it('refuses the run when portal setup fails', async () => {
    const driver = linuxRecordingDriver(driverPort({}))
    const run = await driver.start(recordOptions, noopCountdown)
    const outcome = await run.result
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('runs audio through the default daemon with node ids only', async () => {
    const launched: { readonly args: readonly string[] }[] = []
    const driver = linuxRecordingDriver(
      driverPort({
        openPortal: () =>
          Promise.resolve({
            video: { fd: 5, nodeId: 42 },
            microphone: { nodeId: 7 },
            closed: new Promise<void>(() => {
              // No revocation in this run.
            }),
            close: () => Promise.resolve(),
          }),
        // A POSIX-shaped private path, as the driver's GStreamer side reads;
        // the real private directory is the host factory's tested ground.
        createPrivateRecording: () =>
          Promise.resolve({
            path: '/run/user/1000/muse-screen-test/recording.mp4',
            remove: () => Promise.resolve(),
          }),
        launchVerified: (request) => {
          launched.push({ args: request.args })
          return Promise.resolve({
            stop: () => Promise.resolve(),
            cancel: () => Promise.resolve(),
            result: Promise.resolve(true),
          })
        },
        sniff: () =>
          Promise.resolve({
            kind: 'video',
            mediaType: 'video/mp4',
            sizeBytes: 64,
            width: 64,
            height: 64,
            durationSeconds: 1,
            hasSoundtrack: true,
          }),
      }),
    )
    const run = await driver.start(
      { maxSeconds: 10, microphone: true, systemAudio: false },
      noopCountdown,
    )
    const outcome = await run.result
    expect(outcome.ok).toBe(true)
    // Only video takes the portal's descriptor; the microphone's element
    // names its node and connects to the default daemon itself.
    const args = launched[0]?.args ?? []
    expect(args.filter((arg) => arg.startsWith('fd='))).toEqual(['fd=5'])
    expect(args).toContain('path=7')
    if (outcome.ok) await outcome.preview.dispose()
  })

  it('refuses video without the portal descriptor', async () => {
    const driver = linuxRecordingDriver(
      driverPort({
        openPortal: () =>
          Promise.resolve({
            video: { nodeId: 42 },
            closed: new Promise<void>(() => {
              // No revocation in this run.
            }),
            close: () => Promise.resolve(),
          }),
        launchVerified: () => Promise.reject(new Error('no launch without a descriptor')),
      }),
    )
    const run = await driver.start(recordOptions, noopCountdown)
    const outcome = await run.result
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })
})

/** The port's listing over the real file system, with real modification times. */
async function listRecordingFiles(
  root: string,
): Promise<readonly { readonly path: string; readonly modifiedAt: number }[]> {
  const names = await readdir(root)
  const entries: { readonly path: string; readonly modifiedAt: number }[] = []
  for (const name of names) {
    const file = path.join(root, name)
    const fileStat = await stat(file)
    entries.push({ path: file, modifiedAt: fileStat.mtimeMs })
  }
  return entries
}

/** A fresh recording file with its real size, removed when the test finishes. */
async function freshMp4(
  prefix: string,
): Promise<{ readonly root: string; readonly file: string; readonly sizeBytes: number }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'fresh.mp4')
  await writeFile(file, Buffer.alloc(1024))
  // Pinned a second in the past: a write landing in the same millisecond as
  // the find call reads back a sub-millisecond mtime past truncated now, and
  // the future guard would refuse it.
  const secondAgo = (Date.now() - 1000) / 1000
  await utimes(file, secondAgo, secondAgo)
  const fileStat = await stat(file)
  return { root, file, sizeBytes: fileStat.size }
}

describe('findLatestRecording', () => {
  it('names the folder it searched when the directory is missing', async () => {
    const outcome = await findLatestRecording({
      roots: [path.join(tmpdir(), 'muse-linux-record-missing')],
      places: [PLACE],
      list: async (listed: string) => {
        const names = await readdir(listed)
        return names.map((name) => ({ path: path.join(listed, name), modifiedAt: Date.now() }))
      },
      copyForPreview: () => Promise.reject(new Error('unreachable without candidates')),
    })
    expect(outcome).toEqual({
      ok: false,
      reason: `No screen recording was found in ${PLACE}.`,
    })
  })

  // D121: no age cutoff of ours; the preview shows what is attached.
  it('takes a recording made two hours ago', async () => {
    const { root, file } = await freshMp4('muse-linux-record-old-')
    const old = Date.now() - 2 * HOUR_MS
    await utimes(file, old / 1000, old / 1000)
    const copied: string[] = []
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: (source) => {
        copied.push(source)
        return Promise.reject(new Error('the copy is not under test'))
      },
    })
    expect(copied).toEqual([file])
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('refuses a recording dated in the future', async () => {
    const { root, file } = await freshMp4('muse-linux-record-future-')
    const future = Date.now() + HOUR_MS
    await utimes(file, future / 1000, future / 1000)
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () => Promise.reject(new Error('unreachable without candidates')),
    })
    expect(outcome).toEqual({ ok: false, reason: `No screen recording was found in ${PLACE}.` })
  })

  it('reports unavailable when the preview copy fails', async () => {
    const { root } = await freshMp4('muse-linux-record-copy-')
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () => Promise.reject(new Error('copy failed')),
    })
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('previews a recent recording the copy verifies', async () => {
    const { root, file, sizeBytes } = await freshMp4('muse-linux-record-fresh-')
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () =>
        Promise.resolve({
          path: file,
          info: {
            kind: 'video',
            mediaType: 'video/mp4',
            sizeBytes,
            durationSeconds: 5,
            hasSoundtrack: false,
          },
          dispose: () => Promise.resolve(),
        }),
    })
    expect(outcome.ok).toBe(true)
  })
})
