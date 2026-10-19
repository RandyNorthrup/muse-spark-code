import { describe, expect, it } from 'vitest'
import {
  absolutePathEntries,
  isFullyQualifiedWindowsPath,
  resolveAllExecutables,
  resolveExecutable,
} from '../../src/core/executables'

const POSIX_INSTALLED: ReadonlySet<string> = new Set(['/usr/local/bin/git', '/usr/bin/git'])
// A git.exe planted in the workspace, a batch-file git, and the real one.
const WINDOWS_INSTALLED: ReadonlySet<string> = new Set([
  String.raw`C:\ws\git.exe`,
  String.raw`C:\Tools\git.cmd`,
  String.raw`C:\Git\cmd\git.exe`,
])

function throwingRealpath(filePath: string): string {
  throw Object.assign(new Error(`no such file: ${filePath}`), { code: 'ENOENT' })
}

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

  it('drops drive-relative Windows entries, which resolve on the working directory drive', () => {
    expect(
      absolutePathEntries('win32', String.raw`\Tools\bin;/Tools/bin;C:\Git\cmd;\\srv\share\bin`),
    ).toEqual([String.raw`C:\Git\cmd`, String.raw`\\srv\share\bin`])
  })

  it('treats forward-slash UNC spellings as fully qualified paths', () => {
    // Windows accepts forward slashes in a UNC path: //server/share must
    // never be rewritten onto the workspace drive as a drive-relative entry.
    expect(isFullyQualifiedWindowsPath('//localhost/C$/Users/me/repo/bin')).toBe(true)
    expect(isFullyQualifiedWindowsPath('//?/C:/Users/me/repo/bin')).toBe(true)
    expect(isFullyQualifiedWindowsPath('//server/share/bin')).toBe(true)
    expect(isFullyQualifiedWindowsPath('/Users/me/repo/bin')).toBe(false)
    expect(isFullyQualifiedWindowsPath(String.raw`\Users\me\repo\bin`)).toBe(false)
  })

  it('never probes directories inside the workspace when one is given', () => {
    expect(
      absolutePathEntries('linux', '/home/person/work/bin:/usr/bin', {
        workspaceRoot: '/home/person/work',
        realpath: throwingRealpath,
      }),
    ).toEqual(['/usr/bin'])
    expect(
      absolutePathEntries(
        'win32',
        String.raw`C:\ws\bin;//localhost/C$/ws/bin;\\?\C:\ws\bin;C:\Git\cmd`,
        { workspaceRoot: String.raw`C:\ws`, realpath: throwingRealpath },
      ),
    ).toEqual([String.raw`C:\Git\cmd`])
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

  it('lists every absolute entry that has the program, in PATH order', () => {
    // A caller that executes what it resolves tries each until one runs:
    // the first file need not work (macOS's Xcode stub).
    expect(
      resolveAllExecutables('git', {
        platform: 'linux',
        pathVariable: '.:/usr/local/bin:/usr/bin:/bin',
        fileExists: isPosixInstalled,
      }),
    ).toEqual(['/usr/local/bin/git', '/usr/bin/git'])
    expect(
      resolveAllExecutables('git', {
        platform: 'linux',
        pathVariable: '.:/bin',
        fileExists: isPosixInstalled,
      }),
    ).toEqual([])
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

  it('skips an absolute workspace entry, so a planted program there never resolves', () => {
    const files = new Set([String.raw`C:\ws\bin\git.exe`, String.raw`C:\Git\cmd\git.exe`])
    expect(
      resolveExecutable('git', {
        platform: 'win32',
        pathVariable: String.raw`C:\ws\bin;C:\Git\cmd`,
        fileExists: (file: string) => files.has(file),
        workspaceRoot: String.raw`C:\ws`,
        realpath: (filePath: string) => filePath,
      }),
    ).toBe(String.raw`C:\Git\cmd\git.exe`)
  })

  it('finds a Windows program named with its extension, as named, and still never a batch file', () => {
    // The CLI's OS adapters (usage open, share copy/browser) name rundll32.exe,
    // powershell.exe and explorer.exe; appending .exe again never resolved them.
    const system = new Set([
      String.raw`C:\Windows\System32\rundll32.exe`,
      String.raw`C:\Tools\git.cmd`,
    ])
    const probe = {
      platform: 'win32' as const,
      pathVariable: String.raw`.;C:\Tools;C:\Windows\System32`,
      fileExists: (file: string) => system.has(file),
    }
    expect(resolveExecutable('rundll32.exe', probe)).toBe(
      String.raw`C:\Windows\System32\rundll32.exe`,
    )
    expect(resolveExecutable('RUNDLL32.EXE', { ...probe, fileExists: () => true })).toBe(
      String.raw`C:\Tools\RUNDLL32.EXE`,
    )
    expect(resolveExecutable('rundll32.exe.exe', probe)).toBeUndefined()
    // A named batch file is only ever looked up with an executable extension.
    expect(resolveExecutable('git.cmd', probe)).toBeUndefined()
  })
})
