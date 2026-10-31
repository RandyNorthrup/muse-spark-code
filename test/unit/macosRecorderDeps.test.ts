// M105 RLF-RECORDING: the macOS recorder's host deps and driver against the
// real signed helper app, built from the shipped sources by native/darwin/
// build.sh. No recording happens: `--probe` reads authorization status and
// never asks for access, and the driver only reaches the helper's capture
// mode after the person's Start. What is proved here: the installed path
// walk and the app's own signature are read into the requirement the driver
// verifies, available() agrees with the binary's own probe, a helper whose
// bytes changed after signing is refused in words, and a missing helper is
// named.
import { realpathSync } from 'node:fs'
import { cp, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import {
  macosScreenRecordingDriver,
  MACOS_RECORDING_HELPER_MAX_BYTES,
} from '../../src/core/media/record/macos'
import { createMacosRecorderDeps } from '../../src/host/media/macosRecorderDeps'
import { runProgram } from '../../src/host/processTree'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'
import { removeFolder } from './helpers/temporaryFolders'

const MP3_FIXTURE = path.resolve('test/fixtures/voice/tone-2s.mp3')
/** build.sh signs and compiles both architectures' apps with the full Swift toolchain. */
const BUILD_TIMEOUT_MS = 240_000
const l10n = { table: UI_TEXT, locale: 'en' }
const readEnvironment = noWorkspaceChildEnvironment('darwin', {}, realpathSync)

describe.skipIf(process.platform !== 'darwin')('M105 macOS recorder host deps', () => {
  let remove: (() => Promise<void>) | undefined
  let extensionPath = ''
  let helperPath = ''
  let scratch = ''

  const depsFor = (extension: string) =>
    createMacosRecorderDeps({
      extensionPath: extension,
      tempRoot: path.join(scratch, 'recordings'),
      arch: process.arch,
      environment: process.env,
      l10n,
      maxBytes: () => MACOS_RECORDING_HELPER_MAX_BYTES,
    })

  beforeAll(async () => {
    const built = await darwinProcessHelper()
    remove = built.remove
    helperPath = built.helperPath
    // <extension>/native/darwin/<app>/Contents/MacOS/muse-dictate
    extensionPath = path.resolve(helperPath, '..', '..', '..', '..', '..', '..')
    scratch = await mkdtemp(path.join(tmpdir(), 'muse-macos-recorder-deps-'))
  }, BUILD_TIMEOUT_MS)
  afterAll(async () => {
    await remove?.()
    await removeFolder(scratch)
  })

  it('reads the app by its own signature, and available() agrees with the binary', async () => {
    const deps = depsFor(extensionPath)
    expect(deps.helperPath).toBe(helperPath)
    const verified = await deps.verifyTrustedHelper?.(deps.helperPath)
    expect(verified).toEqual({
      path: realpathSync(helperPath),
      signaturePath: realpathSync(path.resolve(helperPath, '..', '..', '..')),
      designatedRequirement: expect.stringMatching(/^cdhash H"[0-9a-f]{40}"$/u),
    })
    // The binary's own answer, the oracle available() must agree with.
    const probe: unknown = JSON.parse(
      await runProgram(helperPath, ['--record-screen', '--probe'], readEnvironment),
    )
    expect(probe).toMatchObject({ type: 'available' })
    const isCapable =
      typeof probe === 'object' &&
      probe !== null &&
      'display' in probe &&
      'encoder' in probe &&
      probe.display === 'available' &&
      probe.encoder === 'available'
    await expect(macosScreenRecordingDriver(deps).available()).resolves.toEqual(
      isCapable ? { ok: true } : { ok: false, reason: expect.any(String) },
    )
  })

  it('refuses a helper whose bytes changed after it was signed, in words', async () => {
    const copy = path.join(scratch, 'tampered')
    const app = path.resolve(helperPath, '..', '..', '..')
    await cp(app, path.join(copy, 'native', 'darwin', path.basename(app)), { recursive: true })
    const changed = path.join(copy, path.relative(extensionPath, helperPath))
    // One byte of the executable, past the Mach-O header.
    const handle = await open(changed, 'r+')
    try {
      await handle.write(Buffer.from([0xff]), 0, 1, 4096)
    } finally {
      await handle.close()
    }
    const outcome = await macosScreenRecordingDriver(depsFor(copy)).available()
    expect(outcome).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.recordingUnavailable, { reason: 'helperIntegrity' }),
    })
  })

  it('names the app the package should have shipped when it is missing', async () => {
    // Under a folder of our own ending in .app, as a sandboxed temp root
    // does: the refusal must name the helper's app, not an ancestor.
    const empty = path.join(scratch, 'host.app', 'empty-extension')
    const outcome = await macosScreenRecordingDriver(depsFor(empty)).available()
    expect(outcome).toEqual({
      ok: false,
      reason: fill(UI_TEXT.media.recordingUnavailable, {
        reason: `native/darwin/muse-dictate-screen-${process.arch}.app`,
      }),
    })
  })

  it('refuses a byte bound the helper cannot hold before it spawns anything', async () => {
    const driver = macosScreenRecordingDriver({
      ...depsFor(extensionPath),
      maxBytes: MACOS_RECORDING_HELPER_MAX_BYTES + 1,
    })
    const run = await driver.start({ maxSeconds: 1, microphone: false, systemAudio: false }, () => {
      /* No countdown: the run never starts. */
    })
    await expect(run.result).resolves.toEqual({ ok: false, reason: expect.any(String) })
  })

  it('inspects a real media file with the bounded sniffer and refuses what it cannot read', async () => {
    const deps = depsFor(extensionPath)
    await expect(deps.inspect(MP3_FIXTURE)).resolves.toMatchObject({ kind: 'audio' })
    const empty = path.join(scratch, 'empty.mp4')
    await writeFile(empty, '')
    await expect(deps.inspect(empty)).rejects.toThrow()
    await rm(empty)
  })
})
