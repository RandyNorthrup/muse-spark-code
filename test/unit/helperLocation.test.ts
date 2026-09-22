import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { locateDictationHelper } from '../../src/core/voice/helperLocation'

const helperDir = path.join('ext', 'native')

describe('locateDictationHelper', () => {
  it('runs the bundled script with Windows PowerShell 5.1 on Windows (from any host)', () => {
    const location = locateDictationHelper({
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
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
      },
    })
  })

  it('explains a Windows without SystemRoot', () => {
    const location = locateDictationHelper({
      platform: 'win32',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(location).toMatchObject({ isAvailable: false })
    expect(location.isAvailable ? '' : location.reason).toContain('Windows PowerShell')
  })

  it('runs the compiled helper on macOS when the build shipped it', () => {
    const command = path.join(helperDir, 'darwin', 'muse-dictate')
    expect(
      locateDictationHelper({
        platform: 'darwin',
        systemRoot: undefined,
        helperDir,
        fileExists: (fsPath) => fsPath === command,
      }),
    ).toEqual({ isAvailable: true, invocation: { command, args: [] } })
    const missing = locateDictationHelper({
      platform: 'darwin',
      systemRoot: undefined,
      helperDir,
      fileExists: () => false,
    })
    expect(missing.isAvailable ? '' : missing.reason).toContain('native/darwin/muse-dictate')
  })

  it('says why Linux and other platforms have no microphone', () => {
    const linux = locateDictationHelper({
      platform: 'linux',
      systemRoot: undefined,
      helperDir,
      fileExists: () => true,
    })
    expect(linux.isAvailable ? '' : linux.reason).toContain('Linux')
    const other = locateDictationHelper({
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
})
