import { describe, expect, it } from 'vitest'
import { absolutePathEntries, resolveExecutable } from '../../src/core/executables'

const POSIX_INSTALLED: ReadonlySet<string> = new Set(['/usr/local/bin/git', '/usr/bin/git'])
// A git.exe planted in the workspace, a batch-file git, and the real one.
const WINDOWS_INSTALLED: ReadonlySet<string> = new Set([
  String.raw`C:\ws\git.exe`,
  String.raw`C:\Tools\git.cmd`,
  String.raw`C:\Git\cmd\git.exe`,
])

function isPosixInstalled(file: string): boolean {
  return POSIX_INSTALLED.has(file)
}

function isWindowsInstalled(file: string): boolean {
  return WINDOWS_INSTALLED.has(file)
}

describe('absolutePathEntries', () => {
  it('keeps absolute entries only: an empty or relative one means the working directory', () => {
    expect(absolutePathEntries('linux', ':/usr/bin::.:bin:/bin')).toEqual(['/usr/bin', '/bin'])
    expect(absolutePathEntries('win32', String.raw`;C:\Git\cmd;.;tools; D:\bin `)).toEqual([
      String.raw`C:\Git\cmd`,
      String.raw`D:\bin`,
    ])
    expect(absolutePathEntries('linux', undefined)).toEqual([])
  })
})

describe('resolveExecutable', () => {
  it('finds a POSIX program on the first absolute entry that has it', () => {
    expect(
      resolveExecutable('git', {
        platform: 'linux',
        pathVariable: '.:/usr/local/bin:/usr/bin',
        fileExists: isPosixInstalled,
      }),
    ).toBe('/usr/local/bin/git')
  })

  it('finds a Windows program as .exe or .com, never a batch file or one in the workspace', () => {
    // `.` is the workspace here: the planted git.exe is never considered.
    expect(
      resolveExecutable('git', {
        platform: 'win32',
        pathVariable: String.raw`.;C:\Tools;C:\Git\cmd`,
        fileExists: isWindowsInstalled,
      }),
    ).toBe(String.raw`C:\Git\cmd\git.exe`)
    expect(
      resolveExecutable('git', {
        platform: 'win32',
        pathVariable: String.raw`C:\Tools`,
        fileExists: isWindowsInstalled,
      }),
    ).toBeUndefined()
  })
})
