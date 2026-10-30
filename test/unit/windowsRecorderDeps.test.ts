// M105 R2: the Windows recorder's host deps bind what the driver runs. The
// shipped C# compiles with the inbox compiler into locked storage, the
// built helper self-tests, and the driver's available() agrees with the
// binary's own --probe answer; the launch port carries a real self-test
// run's line and exit; reserve, remove and inspect work real files; and a
// missing source or an outside-namespace removal is refused. No recording:
// --self-test and --probe never capture and never ask for access.
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { noWorkspaceChildEnvironment } from '../../src/core/execGuard'
import { windowsScreenRecorder } from '../../src/core/media/record/windows'
import { createHelperLineFramer } from '../../src/host/media/recordingLineFramer'
import {
  createWindowsRecorderDeps,
  type WindowsRecorderMechanicalDeps,
} from '../../src/host/media/windowsRecorderDeps'
import { runProgram } from '../../src/host/processTree'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_MIB,
  SCREEN_RECORDING_LINE_MAX_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import { lockWindowsStorageDir, removeFolder } from './helpers/temporaryFolders'

const systemRoot = process.env['SystemRoot'] ?? ''
const MP3_FIXTURE = path.resolve('test/fixtures/voice/tone-2s.mp3')

function unsubscribeNone(): void {
  // No host subscription in tests.
}

function noShutdownSubscription(): () => void {
  return unsubscribeNone
}

describe.skipIf(process.platform !== 'win32')('M105 R2 windows recorder host deps', () => {
  let root = ''
  let executable = ''
  let isProbeSupported = false
  let deps: WindowsRecorderMechanicalDeps

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-recorder-deps-test-'))
    const storageDir = path.join(root, 'storage')
    await mkdir(storageDir)
    await lockWindowsStorageDir(storageDir, systemRoot)
    deps = createWindowsRecorderDeps({
      extensionPath: path.resolve('.'),
      storageDir,
      tempRoot: path.join(root, 'temp'),
      systemRoot,
      l10n: { table: UI_TEXT, locale: 'en' },
    })
    const built = await deps.prepareHelper()
    if (built === undefined) throw new Error('inbox recorder failed to compile or self-test')
    executable = built
    // The binary's own answer, the oracle available() must agree with.
    try {
      await runProgram(
        executable,
        ['--probe'],
        noWorkspaceChildEnvironment('win32', { SystemRoot: systemRoot }, realpathSync),
      )
      isProbeSupported = true
    } catch {
      isProbeSupported = false
    }
  })
  afterAll(() => removeFolder(root))

  it('prepares, verifies and probes the real helper, and available() agrees with the binary', async () => {
    expect(path.win32.isAbsolute(executable)).toBe(true)
    const built = await stat(executable)
    expect(built.isFile()).toBe(true)
    await expect(deps.verifyHelper(executable)).resolves.toBe(true)
    const recorder = windowsScreenRecorder({
      ...deps,
      isLocal: true,
      isInteractiveUserAction: () => true,
      onShutdown: noShutdownSubscription,
      maxBytes: MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES,
    })
    await expect(recorder.available()).resolves.toEqual(
      isProbeSupported ? { ok: true } : { ok: false, reason: expect.any(String) },
    )
  })

  it('carries a real self-test run through the launch port, buffering lines until the listener attaches', async () => {
    const port = deps.launch(executable, ['--self-test'])
    const code = await new Promise<number | null>((resolve) => {
      port.onExit(resolve)
    })
    expect(code).toBe(0)
    // Attached only after the exit: the ready line was buffered, not lost.
    const lines: string[] = []
    port.onLine((line) => {
      lines.push(line)
    })
    expect(lines).toEqual(['muse-spark-screen-record-ready'])
    expect(() => {
      port.send('stop')
    }).toThrow('the recorder has exited')
    await port.kill()
  })

  it('reserves absent private paths and removes only its own namespace', async () => {
    const first = await deps.reserveDirectory()
    const second = await deps.reserveDirectory()
    expect(first).not.toBe(second)
    for (const directory of [first, second]) {
      expect(path.win32.isAbsolute(directory)).toBe(true)
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await mkdir(first, { recursive: true })
    await writeFile(path.join(first, 'marker.txt'), 'x')
    await deps.removeDirectory(first)
    await expect(stat(first)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(deps.removeDirectory(path.join(root, 'other'))).rejects.toThrow(
      'recording namespace',
    )
  })

  it('inspects a real media file with the bounded sniffer and refuses what it cannot read', async () => {
    const info = await deps.inspect(MP3_FIXTURE)
    expect(info.kind).toBe('audio')
    await expect(deps.inspect(path.join(root, 'no-such-file.mp4'))).rejects.toThrow(/ENOENT/)
    const empty = path.join(root, 'empty.mp4')
    await writeFile(empty, '')
    await expect(deps.inspect(empty)).rejects.toThrow()
  })

  it('offers no helper when the shipped source is missing and distrusts a missing binary', async () => {
    const missing = createWindowsRecorderDeps({
      extensionPath: path.join(root, 'no-extension'),
      storageDir: path.join(root, 'storage-missing'),
      tempRoot: path.join(root, 'temp-missing'),
      systemRoot,
      l10n: { table: UI_TEXT, locale: 'en' },
    })
    await expect(missing.prepareHelper()).resolves.toBeUndefined()
    await expect(deps.verifyHelper(path.join(root, 'no-such-helper.exe'))).resolves.toBe(false)
  })
})

describe('helper line framer', () => {
  it('frames split and CRLF-terminated lines, delivering the trailing partial line at the end', () => {
    const framer = createHelperLineFramer(8)
    expect(framer.push('{"a":')).toEqual([])
    expect(framer.push('1}\r\n{"b":2}\npartial')).toEqual(['{"a":1}', '{"b":2}'])
    expect(framer.end()).toEqual(['partial'])
    expect(framer.end()).toEqual([])
  })

  it('latches silent past the bound and never delivers again', () => {
    const framer = createHelperLineFramer(8)
    expect(framer.push(' toolong \n')).toEqual([])
    expect(framer.push('{"type":"complete"}\n')).toEqual([])
    expect(framer.end()).toEqual([])
  })

  it('takes a line at the default bound and latches past it', () => {
    const atBound = createHelperLineFramer()
    const line = 'x'.repeat(SCREEN_RECORDING_LINE_MAX_BYTES)
    expect(atBound.push(`${line}\n`)).toEqual([line])
    const pastBound = createHelperLineFramer()
    expect(pastBound.push(`${line}x\n`)).toEqual([])
    expect(pastBound.end()).toEqual([])
  })
})
