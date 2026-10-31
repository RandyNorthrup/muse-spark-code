// M105 RLF-RECORDING: the screen recorder the product binds, per platform.
// The driver of the running platform is created over a real extension folder
// that ships no helper, as a person's computer without one would be, and
// must say in words why it cannot record; a remote window says so on every
// platform; a platform the product has no recorder for gets none. Nothing
// here starts a helper or records.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createRecordingDriver,
  type RecordingDriverHost,
} from '../../src/host/media/recordingDriver'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { removeFolder } from './helpers/temporaryFolders'

/** What this platform's driver says when it ships no helper (Linux names the first thing it misses). */
const NO_HELPER_REASONS: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  win32: ['Windows.Graphics.Capture'],
  darwin: [`native/darwin/muse-dictate-screen-${process.arch}.app`],
  linux: ['GStreamer / pipewiresrc / H.264 / AAC', 'xdg-desktop-portal ScreenCast'],
}

describe('M105 the platform screen recorder', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-recording-driver-test-'))
  })
  afterAll(() => removeFolder(root))

  const hostFor = (overrides: Partial<RecordingDriverHost>): RecordingDriverHost => ({
    platform: process.platform,
    arch: process.arch,
    extensionPath: path.join(root, 'extension'),
    storageDir: path.join(root, 'storage'),
    tempRoot: path.join(root, 'recordings'),
    // A desktop session on Linux, so the helper is what is looked for; the
    // system root Windows' recorder compiles under.
    environment: {
      DISPLAY: ':0',
      ...(process.env['SystemRoot'] !== undefined && { SystemRoot: process.env['SystemRoot'] }),
    },
    remoteName: undefined,
    l10n: { table: UI_TEXT, locale: 'en' },
    lifetime: new AbortController().signal,
    personMaxBytes: () => 0,
    ...overrides,
  })

  it('gives a platform the product has no recorder for none', () => {
    expect(createRecordingDriver(hostFor({ platform: 'freebsd' }))).toBeUndefined()
  })

  it('says a remote window has no local screen, on every platform', async () => {
    const driver = createRecordingDriver(hostFor({ remoteName: 'ssh-remote' }))
    await expect(driver?.available()).resolves.toEqual({
      ok: false,
      reason: UI_TEXT.media.recordingRemote,
    })
  })

  it.skipIf(NO_HELPER_REASONS[process.platform] === undefined)(
    'says why this computer cannot record when the package ships no helper for it',
    async () => {
      const driver = createRecordingDriver(hostFor({}))
      const outcome = await driver?.available()
      expect(outcome?.ok).toBe(false)
      const reasons = (NO_HELPER_REASONS[process.platform] ?? []).map((reason) =>
        fill(UI_TEXT.media.recordingUnavailable, { reason }),
      )
      expect(reasons).toContain(outcome?.ok === false ? outcome.reason : '')
    },
  )

  it('binds the driver of the platform it runs on, which refuses options outside the schema', async () => {
    const driver = createRecordingDriver(hostFor({}))
    expect(driver).toBeDefined()
    const run = await driver?.start(
      { maxSeconds: -1, microphone: false, systemAudio: false },
      () => {
        /* No countdown: the run never starts. */
      },
    )
    await expect(run?.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
  })
})
