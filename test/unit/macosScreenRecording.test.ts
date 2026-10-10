import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type MacosScreenRecordingDeps,
  macosScreenRecordingDriver,
  openMacosRecordingPermissions,
} from '../../src/core/media/record/macos'
import type { ScreenRecordingRun } from '../../src/core/media/record/driver'
import type { HelperChild } from '../../src/core/voice/dictation'
import { UI_TEXT } from '../../src/shared/constants'
import type { MediaInfo } from '../../src/shared/media'

class Helper implements HelperChild {
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public readonly commands: string[] = []
  public kills = 0
  public exit: (description: string) => void = () => undefined
  public send(line: string): void {
    this.commands.push(line)
  }
  public onExit(listener: (description: string) => void): void {
    this.exit = listener
  }
  public kill(): void {
    this.kills += 1
  }
  public frame(frame: unknown): void {
    this.stdout.emit('data', `${JSON.stringify(frame)}\n`)
  }
}

const temp = { root: '' }
const runs: ScreenRecordingRun[] = []
beforeEach(async () => {
  temp.root = await mkdtemp(path.join(tmpdir(), 'm105-r1-test-'))
})
afterEach(async () => {
  for (const run of runs) {
    const cancel = run.cancel()
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(2000)
    await cancel
    const result = await run.result
    if (result.ok) await result.preview.dispose()
  }
  runs.length = 0
  vi.useRealTimers()
  await rm(temp.root, { recursive: true, force: true })
})

const SCREEN_BUNDLE = '/installed/native/darwin/muse-dictate-screen.app'
const SCREEN_HELPER = SCREEN_BUNDLE + '/Contents/MacOS/muse-dictate'

const DEFAULT_OPTIONS = { maxSeconds: 10, microphone: false, systemAudio: false }
const SOUND_INFO: MediaInfo = {
  kind: 'video',
  mediaType: 'video/mp4',
  sizeBytes: 13,
  durationSeconds: 2,
  hasSoundtrack: true,
}

function setup(overrides: Partial<MacosScreenRecordingDeps> = {}) {
  const helper = new Helper()
  let output = ''
  const inspect = vi.fn(async (): Promise<MediaInfo> => {
    const stat = await lstat(output)
    return {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: stat.size,
      durationSeconds: 2,
      hasSoundtrack: false,
      width: 32,
      height: 32,
    }
  })
  const checks = {
    signatureExit: 'exit code 0',
    probe: {
      type: 'available',
      responsibility: 'helper',
      screen: 'authorized',
      microphone: 'authorized',
      display: 'available',
      encoder: 'available',
    },
    probeExit: 'exit code 0',
  }
  const suspendListeners = new Set<() => void>()
  const onSuspend = vi.fn((listener: () => void) => {
    suspendListeners.add(listener)
    return () => {
      suspendListeners.delete(listener)
    }
  })
  const verifyTrustedHelper = vi.fn(
    (
      file: string,
    ): Promise<
      { path: string; signaturePath: string; designatedRequirement: string } | undefined
    > =>
      Promise.resolve({
        path: file,
        signaturePath: SCREEN_BUNDLE,
        designatedRequirement:
          'identifier "test-only" and cdhash H"0123456789012345678901234567890123456789"',
      }),
  )
  const spawn = vi.fn((_command: string, args: readonly string[], _env: NodeJS.ProcessEnv) => {
    if (_command === '/usr/bin/codesign' || args.includes('--probe')) {
      const check = new Helper()
      queueMicrotask(() => {
        if (args.includes('--probe')) check.frame(checks.probe)
        check.exit(_command === '/usr/bin/codesign' ? checks.signatureExit : checks.probeExit)
      })
      return check
    }
    output = args[args.indexOf('--output') + 1] ?? ''
    return helper
  })
  const permission = vi.fn()
  const deps: MacosScreenRecordingDeps = {
    platform: 'darwin',
    helperPath: SCREEN_HELPER,
    tempRoot: temp.root,
    environment: {
      PATH: '/usr/bin',
      META_API_KEY: 'test-only',
      OPENAI_KEY: 'test-only',
      aws_session_token: 'test-only',
      provider_api_key: 'test-only',
      MUSE_DICTATE_DISCLAIMED: '1',
    },
    fileExists: () => true,
    verifyTrustedHelper,
    onSuspend,
    spawn,
    inspect,
    startupTimeoutMs: 30_000,
    finishTimeoutMs: 30_000,
    maxProtocolChars: 4096,
    onPermissionDenied: permission,
    ...overrides,
  }
  const driver = macosScreenRecordingDriver(deps)
  const countdown = vi.fn()
  const start = async (options = DEFAULT_OPTIONS) => {
    const run = await driver.start(options, countdown)
    runs.push(run)
    return run
  }
  return {
    deps,
    helper,
    checks,
    verifyTrustedHelper,
    suspendListeners,
    onSuspend,
    suspend: () => {
      for (const listener of suspendListeners) listener()
    },
    spawn,
    inspect,
    permission,
    driver,
    countdown,
    output: () => output,
    start,
    async expectNoLaunch() {
      expect(await driver.available()).toMatchObject({ ok: false })
      const run = await start()
      expect(await run.result).toMatchObject({ ok: false })
      expect(spawn).not.toHaveBeenCalled()
    },
    async expectNoRecording() {
      const run = await start()
      expect(await run.result).toMatchObject({ ok: false })
      expect(spawn.mock.calls.some(([, args]) => args.includes('--output'))).toBe(false)
    },
    async finish() {
      await writeFile(output, 'test-only-mp4', { mode: 0o644 })
      helper.frame({ type: 'finished' })
      helper.exit('exit code 0')
    },
  }
}

describe('M105 R1 macOS screen recording', () => {
  it('binds all fourteen native permission translations to the UI tables and English fallback', async () => {
    const root = path.resolve(import.meta.dirname, '../..')
    const keys = {
      nativeMicrophonePurpose: 'NSMicrophoneUsageDescription',
      nativeScreenPurpose: 'NSScreenCaptureUsageDescription',
      nativeSpeechPurpose: 'NSSpeechRecognitionUsageDescription',
    }
    const languages = [
      'en',
      'cs',
      'de',
      'es',
      'fr',
      'hu',
      'it',
      'ja',
      'ko',
      'pl',
      'pt-br',
      'ru',
      'tr',
      'zh-cn',
      'zh-tw',
    ]
    for (const language of languages) {
      const nativeLanguages = new Map([
        ['pt-br', 'pt-BR'],
        ['zh-cn', 'zh-Hans'],
        ['zh-tw', 'zh-Hant'],
      ])
      const nativeLanguage = nativeLanguages.get(language) ?? language
      const text = await readFile(
        path.join(root, 'native/darwin', nativeLanguage + '.lproj/InfoPlist.strings'),
        'utf8',
      )
      const table: unknown =
        language === 'en'
          ? UI_TEXT.media
          : JSON.parse(await readFile(path.join(root, 'l10n', 'ui.' + language + '.json'), 'utf8'))
      if (typeof table !== 'object' || table === null) throw new Error('invalid locale table')
      const media: unknown = language === 'en' ? table : Reflect.get(table, 'media')
      if (typeof media !== 'object' || media === null) throw new Error('invalid locale table')
      for (const [key, nativeKey] of Object.entries(keys)) {
        const line = text
          .split('\n')
          .find((entry) => entry.startsWith(JSON.stringify(nativeKey) + ' = '))
        if (!line) throw new Error('missing native description: ' + language + '/' + nativeKey)
        expect(JSON.parse(line.slice(line.indexOf(' = ') + ' = '.length, -1))).toBe(
          Reflect.get(media, key),
        )
        if (language !== 'en')
          expect(Reflect.get(media, key)).not.toBe(Reflect.get(UI_TEXT.media, key))
      }
    }
  })

  it('refuses remote, non-macOS, missing and relative helpers before spawning', async () => {
    for (const overrides of [
      { remoteName: 'ssh-remote' },
      { platform: 'win32' as const },
      { helperPath: 'workspace/muse-dictate' },
      { fileExists: () => false },
    ]) {
      const t = setup(overrides)
      await t.expectNoLaunch()
    }
    expect(await readdir(temp.root)).toEqual([])
  })

  it('refuses a missing trusted-path port and untrusted workspace, symlink or replaced helpers', async () => {
    for (const helperPath of [
      '/tmp/untrusted-workspace/muse-dictate',
      '/installed/link/muse-dictate',
      '/installed/replaced/muse-dictate',
    ]) {
      const t = setup({ helperPath, verifyTrustedHelper: () => Promise.resolve(undefined) })
      await t.expectNoLaunch()
    }
    const absent = setup()
    Reflect.deleteProperty(absent.deps, 'verifyTrustedHelper')
    expect(await absent.driver.available()).toMatchObject({ ok: false })
    expect(absent.spawn).not.toHaveBeenCalled()
  })

  it('refuses a helper outside its signed localized bundle', async () => {
    for (const signaturePath of [
      '/installed/unrelated.app',
      SCREEN_BUNDLE.slice(0, -'.app'.length),
    ]) {
      const t = setup({
        verifyTrustedHelper: () =>
          Promise.resolve({
            path: signaturePath.endsWith('.app')
              ? SCREEN_HELPER
              : signaturePath + '/Contents/MacOS/muse-dictate',
            signaturePath,
            designatedRequirement: 'test-only',
          }),
      })
      expect(await t.driver.available()).toMatchObject({ ok: false })
      expect(t.spawn).not.toHaveBeenCalled()
    }
  })

  it('bounds a stalled signature check before launching any helper', async () => {
    vi.useFakeTimers()
    const child = new Helper()
    const t = setup({ spawn: () => child })
    const readiness = t.driver.available()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(await readiness).toMatchObject({ ok: false })
    expect(child.kills).toBe(1)
    expect(await readdir(temp.root)).toEqual([])
  })

  it('refuses oversized verification output before launching any helper', async () => {
    vi.useFakeTimers()
    const child = new Helper()
    const t = setup({ spawn: () => child })
    const readiness = t.driver.available()
    await vi.advanceTimersByTimeAsync(0)
    child.stdout.emit('data', 'x'.repeat(4097))
    expect(await readiness).toMatchObject({ ok: false })
    expect(child.kills).toBe(1)
    expect(await readdir(temp.root)).toEqual([])
  })

  it('refuses recording without a host suspend binding', async () => {
    const t = setup()
    Reflect.deleteProperty(t.deps, 'onSuspend')
    await t.expectNoRecording()
  })

  it('refuses malformed trusted bindings and a helper replaced after the probe', async () => {
    for (const binding of [
      {
        path: 'relative',
        signaturePath: '/installed/helper.app',
        designatedRequirement: 'test-only',
      },
      { path: '/installed/helper', signaturePath: 'relative', designatedRequirement: 'test-only' },
      {
        path: '/installed/helper',
        signaturePath: '/installed/helper.app',
        designatedRequirement: '',
      },
    ]) {
      const t = setup({ verifyTrustedHelper: () => Promise.resolve(binding) })
      expect(await t.driver.available()).toMatchObject({ ok: false })
      expect(t.spawn).not.toHaveBeenCalled()
    }
    const t = setup()
    t.verifyTrustedHelper.mockResolvedValueOnce({
      path: '/installed/helper.app/Contents/MacOS/muse-dictate',
      signaturePath: '/installed/helper.app',
      designatedRequirement: 'test-only',
    })
    t.verifyTrustedHelper.mockResolvedValueOnce(undefined)
    await t.expectNoRecording()
  })

  it('refuses unsigned or replaced signatures before launching the helper', async () => {
    const t = setup()
    t.checks.signatureExit = 'exit code 1'
    expect(await t.driver.available()).toMatchObject({ ok: false })
    const run = await t.start()
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.spawn.mock.calls.every(([command]) => command === '/usr/bin/codesign')).toBe(true)
    expect(t.inspect).not.toHaveBeenCalled()
  })

  it('checks the trusted canonical helper and pinned signature before every launch', async () => {
    const canonical = '/installed/canonical/muse-dictate-screen.app/Contents/MacOS/muse-dictate'
    const t = setup({
      verifyTrustedHelper: () =>
        Promise.resolve({
          path: canonical,
          signaturePath: '/installed/canonical/muse-dictate-screen.app',
          designatedRequirement: 'test-only-pinned-requirement',
        }),
    })
    await t.driver.available()
    const run = await t.start()
    expect(
      t.spawn.mock.calls.map(([command, args]) => [command, args.includes('--probe')]),
    ).toEqual([
      ['/usr/bin/codesign', false],
      [canonical, true],
      ['/usr/bin/codesign', false],
      [canonical, true],
      ['/usr/bin/codesign', false],
      [canonical, false],
    ])
    expect(t.spawn).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      [
        '--verify',
        '--strict',
        '-R',
        '=test-only-pinned-requirement',
        '/installed/canonical/muse-dictate-screen.app',
      ],
      { PATH: '/usr/bin' },
    )
    t.helper.frame({ type: 'recording' })
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true })
  })

  it.each(['screen', 'microphone', 'display', 'encoder'])(
    'reports unavailable %s honestly without recording',
    async (field) => {
      const t = setup()
      Reflect.set(
        t.checks.probe,
        field,
        new Map([
          ['screen', 'notAuthorized'],
          ['microphone', 'denied'],
          ['display', 'unavailable'],
          ['encoder', 'unavailable'],
        ]).get(field),
      )
      expect(await t.driver.available()).toMatchObject({ ok: false })
      expect(t.spawn.mock.calls.some(([, args]) => args.includes('--output'))).toBe(false)
      if (field === 'screen' || field === 'microphone')
        expect(t.permission).toHaveBeenCalledWith(field)
    },
  )

  it.each(['screen', 'microphone'])(
    'lets explicit Start request %s access and reports native denial',
    async (permission) => {
      const t = setup()
      Reflect.set(t.checks.probe, permission, permission === 'screen' ? 'notAuthorized' : 'denied')
      const run = await t.start({ ...DEFAULT_OPTIONS, microphone: permission === 'microphone' })
      expect(t.spawn.mock.calls.some(([, args]) => args.includes('--output'))).toBe(true)
      t.helper.frame({
        type: 'error',
        code: permission === 'screen' ? 'screenPermissionDenied' : 'microphonePermissionDenied',
      })
      t.helper.exit('exit code 2')
      expect(await run.result).toMatchObject({ ok: false })
      expect(t.permission).toHaveBeenCalledExactlyOnceWith(permission)
      expect(t.inspect).not.toHaveBeenCalled()
      expect(await readdir(temp.root)).toEqual([])
    },
  )

  it.each(['notDetermined', 'denied', 'restricted'])(
    'names microphone %s availability without guessing',
    async (status) => {
      const t = setup()
      t.checks.probe.microphone = status
      const readiness = await t.driver.available()
      const reasons = new Map([
        ['notDetermined', UI_TEXT.media.recordingMicrophonePermissionPending],
        ['denied', UI_TEXT.media.recordingMicrophonePermissionDenied],
        ['restricted', UI_TEXT.media.recordingMicrophonePermissionRestricted],
      ])
      expect(readiness).toMatchObject({ ok: false })
      if (readiness.ok) throw new Error('unexpected availability')
      expect(readiness.reason).toContain(reasons.get(status))
      expect(readiness.reason).not.toContain(UI_TEXT.media.recordingPermissionDenied)
    },
  )

  it('reports ungranted screen access without claiming a known denial', async () => {
    const t = setup()
    t.checks.probe.screen = 'notAuthorized'
    const readiness = await t.driver.available()
    expect(readiness).toMatchObject({ ok: false })
    if (readiness.ok) throw new Error('unexpected availability')
    expect(readiness.reason).toContain(UI_TEXT.media.recordingScreenPermissionRequired)
    expect(readiness.reason).not.toContain(UI_TEXT.media.recordingPermissionDenied)
  })

  it('reports undecided microphone permission and only requests it when selected', async () => {
    const t = setup()
    t.checks.probe.microphone = 'notDetermined'
    expect(await t.driver.available()).toMatchObject({ ok: false })
    const run = await t.start({ ...DEFAULT_OPTIONS, microphone: true })
    t.helper.frame({ type: 'recording' })
    t.inspect.mockResolvedValue(SOUND_INFO)
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true })
  })

  it('does not block silent recording on denied microphone permission', async () => {
    const t = setup()
    t.checks.probe.microphone = 'denied'
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true })
    expect(t.permission).not.toHaveBeenCalled()
  })

  it('refuses malformed and unsuccessful availability probes', async () => {
    for (const probeExit of ['exit code 0', 'exit code 2']) {
      const t = setup()
      t.checks.probeExit = probeExit
      if (probeExit === 'exit code 0') Reflect.set(t.checks.probe, 'unknown', true)
      expect(await t.driver.available()).toMatchObject({ ok: false })
      expect(t.spawn.mock.calls.some(([, args]) => args.includes('--output'))).toBe(false)
    }
  })

  it('stops once on host suspend and removes its subscription after finalization', async () => {
    const t = setup()
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    t.suspend()
    t.suspend()
    expect(t.helper.commands).toEqual(['stop'])
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true })
    expect(t.suspendListeners.size).toBe(0)
    t.suspend()
    expect(t.helper.commands).toEqual(['stop'])
  })

  it('keeps the finalize deadline when suspend arrives before recording readiness', async () => {
    vi.useFakeTimers()
    const t = setup()
    const run = await t.start()
    t.suspend()
    t.helper.frame({ type: 'recording' })
    await vi.advanceTimersByTimeAsync(32_000)
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.suspendListeners.size).toBe(0)
  })

  it('validates explicit audio selections and duration before creating files', async () => {
    const t = setup()
    for (const maxSeconds of [0, 9, 601, 10.5, NaN]) {
      const run = await t.start({ maxSeconds, microphone: false, systemAudio: false })
      expect(await run.result).toMatchObject({ ok: false })
    }
    // Delete a required property as a JS caller could; the boundary must still refuse it.
    const missing = { ...DEFAULT_OPTIONS }
    Reflect.deleteProperty(missing, 'microphone')
    const run = await t.start(missing)
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.spawn).not.toHaveBeenCalled()
    expect(await readdir(temp.root)).toEqual([])
  })

  it('passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker', async () => {
    vi.useFakeTimers()
    const t = setup()
    await t.start({ maxSeconds: 120, microphone: true, systemAudio: true })
    expect(t.spawn).toHaveBeenCalledWith(
      SCREEN_HELPER,
      [
        '--record-screen',
        '--output',
        t.output(),
        '--max-seconds',
        '120',
        '--max-bytes',
        '209715200',
        '--microphone',
        'true',
        '--system-audio',
        'true',
      ],
      { PATH: '/usr/bin' },
    )
    const stat = await lstat(path.dirname(t.output()))
    if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o700)
  })

  it('stops early and returns a private preview only after finished and a clean exit', async () => {
    const t = setup()
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    expect(t.countdown).toHaveBeenCalledWith(10)
    await run.stop()
    await run.stop()
    expect(t.helper.commands).toEqual(['stop'])
    await t.finish()
    const result = await run.result
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.preview.info).toMatchObject({ mediaType: 'video/mp4', hasSoundtrack: false })
    expect(t.inspect).toHaveBeenCalledExactlyOnceWith(t.output())
    const stat = await lstat(t.output())
    if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600)
    await result.preview.dispose()
    await result.preview.dispose()
    expect(await readdir(temp.root)).toEqual([])
  })

  it('counts down from recording readiness and sends Stop exactly at the maximum', async () => {
    vi.useFakeTimers()
    const t = setup()
    const run = await t.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.countdown).not.toHaveBeenCalled()
    t.helper.frame({ type: 'recording' })
    await vi.advanceTimersByTimeAsync(9000)
    expect(t.countdown).toHaveBeenLastCalledWith(1)
    expect(t.helper.commands).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.helper.commands).toEqual(['stop'])
    expect(t.countdown).toHaveBeenLastCalledWith(0)
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true })
  })

  it('bounds startup and a helper that ignores Stop, even if the adapter never reports exit', async () => {
    vi.useFakeTimers()
    for (const hasStarted of [false, true]) {
      const t = setup()
      const run = await t.start()
      if (hasStarted) {
        t.helper.frame({ type: 'recording' })
        await run.stop()
      }
      await vi.advanceTimersByTimeAsync(32_000)
      expect(t.helper.kills).toBe(1)
      expect(await run.result).toMatchObject({ ok: false })
      expect(await readdir(temp.root)).toEqual([])
    }
  })

  it('cancels and removes partial files, including a helper that finishes during cancellation', async () => {
    vi.useFakeTimers()
    const t = setup()
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    await writeFile(t.output(), 'partial')
    const cancelled = run.cancel()
    t.helper.frame({ type: 'finished' })
    t.helper.exit('exit code 0')
    await cancelled
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.helper.commands).toEqual(['cancel'])
    expect(await readdir(temp.root)).toEqual([])
  })

  it.each(['screenPermissionDenied', 'microphonePermissionDenied'])(
    'offers the correct recovery for %s without storing native stderr or paths',
    async (code) => {
      const t = setup()
      const run = await t.start()
      t.helper.stderr.emit('data', 'private/account/path')
      t.helper.frame({ type: 'error', code })
      t.helper.exit('exit code 2')
      const result = await run.result
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).toContain(UI_TEXT.media.recordingPermissionDenied)
      expect(JSON.stringify(result)).not.toContain('private/account/path')
      expect(t.permission).toHaveBeenCalledExactlyOnceWith(
        code === 'screenPermissionDenied' ? 'screen' : 'microphone',
      )
      expect(await readdir(temp.root)).toEqual([])
    },
  )

  it('opens only the requested permission pane through the injected editor port', async () => {
    const open = vi.fn((_uri: string) => Promise.resolve())
    await openMacosRecordingPermissions('screen', open)
    await openMacosRecordingPermissions('microphone', open)
    expect(open.mock.calls).toEqual([
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'],
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'],
    ])
  })

  it.each([
    'not json\n',
    '{"type":"finished"}\n',
    '{"type":"error","code":"arbitrary secret"}\n',
    '{"type":"recording","bytes":"canary"}\n',
    'x'.repeat(4097),
  ])(
    'refuses malformed, unsolicited, byte-bearing or oversized helper frames (%s)',
    async (frame) => {
      const t = setup()
      const run = await t.start()
      t.helper.stdout.emit('data', Buffer.from(frame))
      t.helper.exit('exit code 0')
      expect(await run.result).toMatchObject({ ok: false })
      expect(t.helper.kills).toBe(1)
      expect(t.inspect).not.toHaveBeenCalled()
      expect(await readdir(temp.root)).toEqual([])
    },
  )

  it('decodes split lines and refuses duplicate recording notifications', async () => {
    const t = setup()
    const run = await t.start()
    t.helper.stdout.emit('data', Buffer.from('{"type":"rec'))
    t.helper.stdout.emit('data', Buffer.from('ording"}\n'))
    expect(t.countdown).toHaveBeenCalledOnce()
    t.helper.frame({ type: 'recording' })
    t.helper.exit('exit code 0')
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.helper.kills).toBe(1)
  })

  it.each([
    'missing',
    'directory',
    'empty',
    'oversize',
    'symlink',
    'wrongKind',
    'wrongMime',
    'wrongSize',
    'crash',
    'noFinished',
    'partialLine',
    'partialUtf8',
  ])('refuses %s output and deletes the whole private folder', async (kind) => {
    const t = setup()
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    if (kind === 'directory') await mkdir(t.output())
    else if (kind === 'symlink') {
      const target = path.join(temp.root, 'target')
      if (process.platform === 'win32') {
        await mkdir(target)
        await symlink(target, t.output(), 'junction')
      } else {
        await writeFile(target, 'safe')
        await symlink(target, t.output())
      }
    } else if (kind !== 'missing') await writeFile(t.output(), kind === 'empty' ? '' : 'mp4')
    if (kind === 'oversize') await truncate(t.output(), 209_715_201)
    switch (kind) {
      case 'wrongKind': {
        t.inspect.mockResolvedValue({
          kind: 'audio',
          mediaType: 'audio/wav',
          sizeBytes: 3,
          durationSeconds: 1,
        })
        break
      }
      case 'wrongMime': {
        t.inspect.mockResolvedValue({
          kind: 'video',
          mediaType: 'video/quicktime',
          sizeBytes: 3,
          durationSeconds: 1,
          hasSoundtrack: false,
        })
        break
      }
      case 'wrongSize': {
        t.inspect.mockResolvedValue({
          kind: 'video',
          mediaType: 'video/mp4',
          sizeBytes: 1,
          durationSeconds: 1,
          hasSoundtrack: false,
        })
        break
      }
    }
    if (kind !== 'noFinished') t.helper.frame({ type: 'finished' })
    if (kind === 'partialLine') t.helper.stdout.emit('data', '{')
    else if (kind === 'partialUtf8') t.helper.stdout.emit('data', Buffer.from([0xc3]))
    t.helper.exit(kind === 'crash' ? 'exit code 1' : 'exit code 0')
    expect(await run.result).toMatchObject({ ok: false })
    const files = await readdir(temp.root)
    expect(files.filter((name) => name.startsWith('muse-screen-'))).toEqual([])
  })

  it('cleans up when spawn fails', async () => {
    const t = setup({
      spawn: () => {
        throw new Error('private failure')
      },
    })
    const run = await t.start()
    expect(await run.result).toMatchObject({ ok: false })
    expect(await readdir(temp.root)).toEqual([])
  })

  it('cancels while inspection is pending and deletes the completed recording', async () => {
    const t = setup()
    const gate = Promise.withResolvers<MediaInfo>()
    const entered = Promise.withResolvers<undefined>()
    t.inspect.mockImplementation(() => {
      entered.resolve(undefined)
      return gate.promise
    })
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    await t.finish()
    await entered.promise
    const cancelling = run.cancel()
    gate.resolve({
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 13,
      durationSeconds: 2,
      hasSoundtrack: false,
    })
    await cancelling
    expect(await run.result).toMatchObject({ ok: false })
    expect(await readdir(temp.root)).toEqual([])
  })

  it('keeps the finish deadline when Stop precedes recording readiness', async () => {
    vi.useFakeTimers()
    const t = setup()
    const run = await t.start()
    await run.stop()
    t.helper.frame({ type: 'recording' })
    await vi.advanceTimersByTimeAsync(32_000)
    expect(await run.result).toMatchObject({ ok: false })
    expect(t.helper.kills).toBe(1)
    expect(await readdir(temp.root)).toEqual([])
  })

  it.each([
    'unknownDuration',
    'longDuration',
    'unexpectedSound',
    'unknownSound',
    'malformedMetadata',
  ])('refuses %s from the sniffer', async (kind) => {
    const t = setup()
    const run = await t.start()
    t.helper.frame({ type: 'recording' })
    const info = {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 13,
      durationSeconds: 2,
      hasSoundtrack: false,
    }
    switch (kind) {
      case 'unknownDuration': {
        Reflect.set(info, 'durationSeconds', null)
        break
      }
      case 'longDuration': {
        info.durationSeconds = 20
        break
      }
      case 'unexpectedSound': {
        info.hasSoundtrack = true
        break
      }
      case 'unknownSound': {
        Reflect.set(info, 'hasSoundtrack', null)
        break
      }
      default: {
        Reflect.set(info, 'content', 'canary')
      }
    }
    t.inspect.mockImplementation(() =>
      Promise.resolve(
        Object.assign({ kind: 'video' as const, mediaType: 'video/mp4' as const }, info),
      ),
    )
    await t.finish()
    expect(await run.result).toMatchObject({ ok: false })
    expect(await readdir(temp.root)).toEqual([])
  })

  it('returns selected sound only when the sniffer confirms an audio track', async () => {
    const t = setup()
    const run = await t.start({ maxSeconds: 10, microphone: true, systemAudio: false })
    t.helper.frame({ type: 'recording' })
    t.inspect.mockResolvedValue(SOUND_INFO)
    await t.finish()
    expect(await run.result).toMatchObject({ ok: true, preview: { info: { hasSoundtrack: true } } })
  })
})
