import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { helperEnvironment, locateDictationHelper } from '../../src/core/voice/helperLocation'

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
    const command = path.join(helperDir, 'darwin', 'muse-dictate')
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
    expect(missing.isAvailable ? '' : missing.reason).toContain('native/darwin/muse-dictate')
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
