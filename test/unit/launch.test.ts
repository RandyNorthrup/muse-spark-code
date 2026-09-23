import { describe, expect, it } from 'vitest'
import {
  buildChildEnvironment,
  credentialFilePath,
  type LaunchProbe,
  resolveMuseLaunch,
} from '../../src/core/backends/musecode/launch'

function windowsProbe(files: Record<string, string | true>, overrides: Partial<LaunchProbe> = {}) {
  const probe: LaunchProbe = {
    platform: 'win32',
    configuredPath: '',
    pathEntries: [String.raw`C:\Windows\System32`],
    homeDir: String.raw`C:\Users\randy`,
    localAppData: String.raw`C:\Users\randy\AppData\Local`,
    systemRoot: String.raw`C:\Windows`,
    fileExists: (filePath) => Object.hasOwn(files, filePath),
    readTextFile: (filePath) => {
      const content = files[filePath]
      return typeof content === 'string' ? content : undefined
    },
    serveArgs: ['serve'],
    ...overrides,
  }
  return probe
}

function posixProbe(existing: string[], overrides: Partial<LaunchProbe> = {}): LaunchProbe {
  return {
    platform: 'linux',
    configuredPath: '',
    pathEntries: ['/usr/bin', '/opt/tools/bin'],
    homeDir: '/home/randy',
    localAppData: undefined,
    systemRoot: undefined,
    fileExists: (filePath) => existing.includes(filePath),
    readTextFile: () => undefined,
    serveArgs: ['serve'],
    ...overrides,
  }
}

const winDir = String.raw`C:\Users\randy\AppData\Local\Programs\muse`

describe('resolveMuseLaunch on Windows', () => {
  it('targets muse-bin-<version>.exe from .muse-version in the default install dir', () => {
    const result = resolveMuseLaunch(
      windowsProbe({
        [String.raw`${winDir}\.muse-version`]: '1.3.0-R3401.1\n',
        [String.raw`${winDir}\muse-bin-1.3.0-R3401.1.exe`]: true,
      }),
    )
    expect(result).toEqual({
      ok: true,
      launch: {
        command: String.raw`${winDir}\muse-bin-1.3.0-R3401.1.exe`,
        args: ['serve'],
        serveArgs: ['serve'],
        installDir: winDir,
        cliPath: String.raw`${winDir}\muse.cmd`,
      },
    })
  })

  it('prefers a directory found through PATH (muse.cmd) over the default dir', () => {
    const pathDir = String.raw`D:\tools\muse`
    const result = resolveMuseLaunch(
      windowsProbe(
        {
          [String.raw`${pathDir}\muse.cmd`]: true,
          [String.raw`${pathDir}\.muse-version`]: '2.0.0-R1',
          [String.raw`${pathDir}\muse-bin-2.0.0-R1.exe`]: true,
          [String.raw`${winDir}\.muse-version`]: '1.3.0-R3401.1',
          [String.raw`${winDir}\muse-bin-1.3.0-R3401.1.exe`]: true,
        },
        { pathEntries: [String.raw`C:\Windows\System32`, pathDir] },
      ),
    )
    expect(result.ok && result.launch.command).toBe(String.raw`${pathDir}\muse-bin-2.0.0-R1.exe`)
  })

  it('uses a configured .exe directly', () => {
    const exe = String.raw`E:\muse\muse-bin-9.exe`
    const result = resolveMuseLaunch(windowsProbe({ [exe]: true }, { configuredPath: exe }))
    expect(result.ok && result.launch).toEqual({
      command: exe,
      args: ['serve'],
      serveArgs: ['serve'],
      installDir: String.raw`E:\muse`,
      cliPath: String.raw`E:\muse\muse.cmd`,
    })
  })

  it('treats a configured muse.cmd as its directory', () => {
    const dir = String.raw`E:\muse`
    const result = resolveMuseLaunch(
      windowsProbe(
        {
          [String.raw`${dir}\.muse-version`]: '1.0.0-R1',
          [String.raw`${dir}\muse-bin-1.0.0-R1.exe`]: true,
        },
        { configuredPath: String.raw`${dir}\muse.cmd` },
      ),
    )
    expect(result.ok && result.launch.command).toBe(String.raw`${dir}\muse-bin-1.0.0-R1.exe`)
  })

  it('falls back to the PowerShell launcher when the version file is missing', () => {
    const result = resolveMuseLaunch(
      windowsProbe({ [String.raw`${winDir}\.muse-launcher.ps1`]: true }),
    )
    expect(result.ok && result.launch).toEqual({
      command: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        String.raw`${winDir}\.muse-launcher.ps1`,
        'serve',
      ],
      serveArgs: ['serve'],
      installDir: winDir,
      cliPath: String.raw`${winDir}\muse.cmd`,
    })
  })

  it('reports every searched location when nothing is installed', () => {
    const missingExe = String.raw`E:\nowhere\muse-bin.exe`
    const result = resolveMuseLaunch(windowsProbe({}, { configuredPath: missingExe }))
    expect(result).toEqual({
      ok: false,
      searched: [missingExe, String.raw`E:\nowhere`, winDir],
      reason: 'Muse Code is not installed in any known location.',
    })
  })
})

describe('resolveMuseLaunch on POSIX', () => {
  it('finds the launcher in ~/.local/bin', () => {
    const result = resolveMuseLaunch(posixProbe(['/home/randy/.local/bin/muse']))
    expect(result.ok && result.launch).toEqual({
      command: '/home/randy/.local/bin/muse',
      args: ['serve'],
      serveArgs: ['serve'],
      installDir: '/home/randy/.local/bin',
      cliPath: '/home/randy/.local/bin/muse',
    })
  })

  it('prefers the configured path, then PATH, then the default dir', () => {
    const all = ['/custom/muse', '/opt/tools/bin/muse', '/home/randy/.local/bin/muse']
    expect(resolveMuseLaunch(posixProbe(all, { configuredPath: '/custom/muse' }))).toMatchObject({
      launch: { command: '/custom/muse' },
    })
    expect(resolveMuseLaunch(posixProbe(all))).toMatchObject({
      launch: { command: '/opt/tools/bin/muse' },
    })
  })

  it('carries the host posture flags through as the serve tail', () => {
    const result = resolveMuseLaunch(
      posixProbe(['/home/randy/.local/bin/muse'], { serveArgs: ['serve', '--disable-sandbox'] }),
    )
    expect(result.ok && result.launch).toMatchObject({
      args: ['serve', '--disable-sandbox'],
      serveArgs: ['serve', '--disable-sandbox'],
    })
  })

  it('never probes an empty or relative PATH entry, which would be the workspace (D24)', () => {
    const planted = ['muse', 'bin/muse', '/home/randy/.local/bin/muse']
    expect(
      resolveMuseLaunch(posixProbe(planted, { pathEntries: ['', '.', 'bin', '/usr/bin'] })),
    ).toMatchObject({ launch: { command: '/home/randy/.local/bin/muse' } })
  })

  it('refuses a relative museBinaryPath instead of resolving it against the current directory', () => {
    expect(resolveMuseLaunch(posixProbe(['muse'], { configuredPath: 'muse' }))).toEqual({
      ok: false,
      searched: ['muse'],
      reason: 'museSpark.museBinaryPath must be an absolute path.',
    })
  })

  it('reports every candidate when nothing is installed', () => {
    expect(resolveMuseLaunch(posixProbe([], { platform: 'darwin' }))).toEqual({
      ok: false,
      searched: ['/usr/bin/muse', '/opt/tools/bin/muse', '/home/randy/.local/bin/muse'],
      reason: 'Muse Code is not installed in any known location.',
    })
  })
})

describe('buildChildEnvironment', () => {
  it('resets PSModulePath on Windows and adds the extras, never a META_API_KEY of its own', () => {
    const env = buildChildEnvironment({
      platform: 'win32',
      baseEnv: { PATH: 'x', PSModulePath: 'C:/pwsh7/Modules' },
      extraVariables: [{ name: 'MUSE_HOME', value: 'D:/muse' }],
      systemRoot: String.raw`C:\Windows`,
      programFiles: String.raw`C:\Program Files`,
    })
    expect(env).toEqual({
      PATH: 'x',
      PSModulePath: String.raw`C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
      MUSE_HOME: 'D:/muse',
    })
    expect(env).not.toHaveProperty('META_API_KEY')
  })

  it('replaces an inherited variable whatever its spelling on Windows', () => {
    const env = buildChildEnvironment({
      platform: 'win32',
      baseEnv: { PSMODULEPATH: 'C:/pwsh7/Modules', muse_home: 'old' },
      extraVariables: [{ name: 'MUSE_HOME', value: 'new' }],
      systemRoot: String.raw`C:\Windows`,
      programFiles: String.raw`C:\Program Files`,
    })
    // Node would pass the first spelling in sort order; only one is left.
    expect(Object.keys(env).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'MUSE_HOME',
      'PSModulePath',
    ])
    expect(env['MUSE_HOME']).toBe('new')
  })

  it('leaves PSModulePath alone elsewhere and passes an environment key through untouched', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: { PATH: 'x', PSModulePath: 'keep', META_API_KEY: 'from-the-user-shell' },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
    })
    expect(env).toEqual({ PATH: 'x', PSModulePath: 'keep', META_API_KEY: 'from-the-user-shell' })
  })
})

describe('credentialFilePath', () => {
  it('uses ~/.config by default and honours XDG_CONFIG_HOME', () => {
    expect(
      credentialFilePath({ platform: 'linux', homeDir: '/home/randy', xdgConfigHome: undefined }),
    ).toBe('/home/randy/.config/muse/auth.json')
    expect(
      credentialFilePath({ platform: 'darwin', homeDir: '/Users/randy', xdgConfigHome: '/tmp/x' }),
    ).toBe('/tmp/x/muse/auth.json')
  })

  it(String.raw`uses %USERPROFILE%\.config on Windows`, () => {
    expect(
      credentialFilePath({
        platform: 'win32',
        homeDir: String.raw`C:\Users\randy`,
        xdgConfigHome: undefined,
      }),
    ).toBe(String.raw`C:\Users\randy\.config\muse\auth.json`)
  })
})
