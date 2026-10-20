import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINUX_DICTATION } from '../../src/shared/constants'
import {
  helperEnvironment,
  locateCaptureHelper,
  locateDictationHelper,
} from '../../src/core/voice/helperLocation'

const helperDir = path.join('ext', 'native')
const local = { remoteName: undefined, programFiles: undefined, appName: 'Visual Studio Code' }

describe('locateDictationHelper', () => {
  it('runs the bundled script with Windows PowerShell 5.1 and its own module path (from any host)', () => {
    const location = locateDictationHelper({
      ...local,
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      programFiles: String.raw`D:\Programs`,
      helperDir: String.raw`C:\ext\native`,
      fileExists: () => false,
    })
    expect(location).toEqual({
      isAvailable: true,
      invocation: {
        command: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          String.raw`C:\ext\native\windows\dictate.ps1`,
        ],
        environment: {
          PSModulePath: String.raw`D:\Programs\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
        },
      },
    })
  })

  it('derives Program Files from SystemRoot when the variable is missing (M26)', () => {
    const location = locateDictationHelper({
      ...local,
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      helperDir,
      fileExists: () => true,
    })
    expect(location.isAvailable ? location.invocation.environment : undefined).toEqual({
      PSModulePath: String.raw`C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
    })
  })

  it('explains a Windows without SystemRoot', () => {
    const location = locateDictationHelper({
      ...local,
      platform: 'win32',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(location).toMatchObject({ isAvailable: false })
    expect(location.isAvailable ? '' : location.reason).toContain('Windows PowerShell')
  })

  it('runs the compiled helper on macOS, naming the app macOS asks, when the build shipped it', () => {
    const command = path.join(
      helperDir,
      'darwin',
      'muse-dictate-screen.app',
      'Contents',
      'MacOS',
      'muse-dictate',
    )
    const location = locateDictationHelper({
      ...local,
      platform: 'darwin',
      systemRoot: undefined,
      helperDir,
      fileExists: (fsPath) => fsPath === command,
    })
    expect(location).toMatchObject({
      isAvailable: true,
      invocation: { command, args: ['--app-name', 'Visual Studio Code'] },
    })
    expect(location.isAvailable ? location.invocation.earlyExitHint : '').toMatch(
      /^macOS ended the dictation helper before it was ready\./,
    )
    const missing = locateDictationHelper({
      ...local,
      platform: 'darwin',
      systemRoot: undefined,
      helperDir,
      fileExists: () => false,
    })
    expect(missing.isAvailable ? '' : missing.reason).toContain(
      'native/darwin/muse-dictate-screen.app',
    )
  })

  it('locates the downloaded Linux helper beside the model before any download', () => {
    for (const arch of ['x64', 'arm64']) {
      const command = path.join('/storage', LINUX_DICTATION.helperBinary)
      const location = locateDictationHelper({
        ...local,
        platform: 'linux',
        systemRoot: undefined,
        helperDir,
        arch,
        linuxModelPath: '/storage/model.bin',
        // Nothing is bundled: availability never depends on files on disk.
        fileExists: () => false,
      })
      expect(location).toEqual({
        isAvailable: true,
        invocation: {
          command,
          args: ['--model', '/storage/model.bin'],
          stopGraceMs: LINUX_DICTATION.stopGraceMs,
          environment: LINUX_DICTATION.environment,
        },
      })
    }
    const probe = {
      ...local,
      platform: 'linux',
      systemRoot: undefined,
      helperDir,
      linuxModelPath: '/storage/model.bin',
    } as const
    expect(
      locateDictationHelper({ ...probe, arch: 'ia32', fileExists: () => true }).isAvailable,
    ).toBe(false)
    expect(
      locateDictationHelper({ ...probe, arch: 'x64', fileExists: () => true }).isAvailable,
    ).toBe(true)
    expect(
      locateDictationHelper({ ...probe, arch: 'x64', remoteName: 'ssh', fileExists: () => true })
        .isAvailable,
    ).toBe(false)
  })

  it('says why Linux and other platforms have no microphone', () => {
    const linux = locateDictationHelper({
      ...local,
      platform: 'linux',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(linux.isAvailable ? '' : linux.reason).toContain('Linux')
    const other = locateDictationHelper({
      ...local,
      platform: 'freebsd',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(other).toEqual({
      isAvailable: false,
      reason: 'Voice dictation is not available on this platform.',
    })
  })

  it('stays unavailable on Android/Termux, which has no bundled helper', () => {
    const location = locateDictationHelper({
      ...local,
      platform: 'android',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(location).toEqual({
      isAvailable: false,
      reason: 'Voice dictation is not available on this platform.',
    })
  })

  it('refuses in a remote window on every platform, saying the microphone is out of reach (M26)', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const location = locateDictationHelper({
        ...local,
        remoteName: 'ssh-remote',
        platform,
        systemRoot: String.raw`C:\Windows`,
        helperDir,
        fileExists: () => true,
      })
      expect(location, platform).toMatchObject({ isAvailable: false })
      expect(location.isAvailable ? '' : location.reason, platform).toMatch(
        /^Voice dictation is not available in a remote window .*cannot hear this computer’s microphone/,
      )
    }
  })
})

describe('helperEnvironment', () => {
  const invocation = {
    command: 'powershell.exe',
    args: [],
    environment: { PSModulePath: String.raw`C:\Windows\Modules` },
  }

  it('replaces every spelling of an inherited Windows variable, keeping the rest (M26)', () => {
    const env = helperEnvironment(
      { Path: 'x', PSMODULEPATH: 'C:/pwsh7/Modules', psmodulepath: 'older' },
      invocation,
      'win32',
    )
    expect(env).toEqual({ Path: 'x', PSModulePath: String.raw`C:\Windows\Modules` })
  })

  it('drops audio-server selectors from a Linux helper so capture stays local (RVCM9LNX P2)', () => {
    const base = {
      PULSE_SERVER: 'tcp:audio.example:4713',
      PULSE_SINK: 'tunnel',
      PULSE_SOURCE: 'tunnel.monitor',
      PIPEWIRE_REMOTE: 'pipewire-0',
      PIPEWIRE_CORE: 'remote',
      PULSE_COOKIE: 'local-auth',
      XDG_RUNTIME_DIR: '/run/user/1000',
      HOME: '/home/user',
      PATH: '/usr/bin',
    }
    const env = helperEnvironment(base, { command: 'muse-dictate', args: [] }, 'linux')
    for (const name of [
      'PULSE_SERVER',
      'PULSE_SINK',
      'PULSE_SOURCE',
      'PIPEWIRE_REMOTE',
      'PIPEWIRE_CORE',
    ] as const) {
      expect(env[name], name).toBeUndefined()
    }
    expect(env).toMatchObject({
      PULSE_COOKIE: 'local-auth',
      XDG_RUNTIME_DIR: '/run/user/1000',
      HOME: '/home/user',
      PATH: '/usr/bin',
    })
    expect(base.PULSE_SERVER).toBe('tcp:audio.example:4713')
  })

  it('leaves audio-server selectors alone off Linux', () => {
    const base = { PULSE_SERVER: 'tcp:audio.example:4713' }
    expect(helperEnvironment(base, { command: 'helper', args: [] }, 'darwin')).toMatchObject(base)
    expect(helperEnvironment(base, { command: 'helper', args: [] }, 'win32')).toMatchObject(base)
  })

  it('matches names exactly elsewhere, and leaves the base untouched', () => {
    const base = { PATH: 'x', PSMODULEPATH: 'keep' }
    expect(helperEnvironment(base, invocation, 'darwin')).toEqual({
      PATH: 'x',
      PSMODULEPATH: 'keep',
      PSModulePath: String.raw`C:\Windows\Modules`,
    })
    expect(base).toEqual({ PATH: 'x', PSMODULEPATH: 'keep' })
    expect(helperEnvironment(base, { command: 'helper', args: [] }, 'darwin')).toEqual(base)
  })
})

/** A file probe that finds exactly these paths. */
function onPath(present: readonly string[]): (file: string) => boolean {
  return (file) => present.includes(file)
}

describe('locateCaptureHelper (M35)', () => {
  const capture = {
    ...local,
    pathVariable: undefined,
    workspaceRoot: '/home/person/work',
    realpath: (filePath: string) => filePath,
  }

  it('runs the capture script on Windows and the Swift helper in capture mode on macOS', () => {
    const windows = locateCaptureHelper({
      ...capture,
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      helperDir: String.raw`C:\ext\native`,
      fileExists: () => false,
    })
    expect(windows).toMatchObject({
      isAvailable: true,
      kind: 'helper',
      invocation: { args: expect.arrayContaining([String.raw`C:\ext\native\windows\capture.ps1`]) },
    })
    const darwin = locateCaptureHelper({
      ...capture,
      platform: 'darwin',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(darwin).toMatchObject({
      isAvailable: true,
      kind: 'helper',
      invocation: {
        command: path.join(
          helperDir,
          'darwin',
          'muse-dictate-screen.app',
          'Contents',
          'MacOS',
          'muse-dictate',
        ),
        args: ['--capture', '--app-name', 'Visual Studio Code'],
      },
    })
  })

  it('takes arecord, else parec, from absolute PATH entries on Linux, and says when neither is there', () => {
    const linux = { ...capture, platform: 'linux', systemRoot: undefined, helperDir } as const
    expect(
      locateCaptureHelper({
        ...linux,
        pathVariable: 'bin:/usr/bin',
        fileExists: onPath(['/usr/bin/arecord', '/usr/bin/parec', 'bin/arecord']),
      }),
    ).toMatchObject({
      isAvailable: true,
      kind: 'recorder',
      name: 'arecord',
      command: '/usr/bin/arecord',
    })
    expect(
      locateCaptureHelper({
        ...linux,
        pathVariable: '/usr/bin',
        fileExists: onPath(['/usr/bin/parec']),
      }),
    ).toMatchObject({ isAvailable: true, kind: 'recorder', name: 'parec' })
    expect(
      locateCaptureHelper({ ...linux, pathVariable: '/usr/bin', fileExists: onPath([]) }),
    ).toEqual({
      isAvailable: false,
      reason:
        'Muse Voice on Linux records with arecord (ALSA) or parec (PulseAudio); neither was found on PATH.',
    })
  })

  it('records nothing in a remote window', () => {
    expect(
      locateCaptureHelper({
        ...capture,
        remoteName: 'wsl',
        platform: 'linux',
        systemRoot: undefined,
        helperDir,
        fileExists: () => true,
        pathVariable: '/usr/bin',
      }),
    ).toMatchObject({ isAvailable: false, reason: expect.stringContaining('remote window') })
  })

  it('records nothing on Android/Termux, even with a Linux recorder on PATH', () => {
    expect(
      locateCaptureHelper({
        ...capture,
        platform: 'android',
        systemRoot: undefined,
        helperDir,
        pathVariable: '/data/data/com.termux/files/usr/bin',
        fileExists: onPath(['/data/data/com.termux/files/usr/bin/arecord']),
      }),
    ).toEqual({
      isAvailable: false,
      reason: 'Voice dictation is not available on this platform.',
    })
  })
})
