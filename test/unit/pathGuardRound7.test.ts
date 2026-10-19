// PATHGUARD round 7 (Grok re-review of PR #249): the Windows team payload
// kept the raw PATH. The payload environment is a `string[]` the compiler
// could not see, so the guard name appearing in the file (on the helper
// spawn) stayed green while `CreateProcessW` received the raw block. These
// tests drive the real payload builder: a workspace planting on its PATH
// never reaches the block, and only a guarded environment serializes.
import {
  resolveWindowsTeamCommand,
  windowsTeamPayloadEnvironment,
} from '../../src/host/team/processLifetime'
import { guardedEnvironmentBlock, workspaceChildEnvironment } from '../../src/core/execGuard'
import { describe, expect, it } from 'vitest'

const WORKSPACE = String.raw`C:\work\repo`
const SYSTEM_DIR = String.raw`C:\Windows\System32`
const SYSTEM_ROOT = String.raw`C:\Windows`

function blockOf(pathValue: string | undefined, extra: NodeJS.ProcessEnv = {}): string[] {
  return windowsTeamPayloadEnvironment(
    { PATH: pathValue, SYSTEMROOT: String.raw`C:\Windows`, ...extra },
    WORKSPACE,
  )
}

function pathOf(block: string[]): string | undefined {
  return block.find((entry) => entry.toUpperCase().startsWith('PATH='))?.slice('PATH='.length)
}

describe('round-7 Windows team payload environment (real builder)', () => {
  it('drops a workspace planting, empty and relative entries from the payload PATH', () => {
    // This block is what helpers the payload starts by bare name search.
    // The executable itself never comes from this block: `RunTeam` receives
    // it as `lpApplicationName`, resolved outside the workspace below.
    const block = blockOf(
      [String.raw`C:\work\repo\bin`, SYSTEM_DIR, '', 'tools', String.raw`c:\WORK\repo\evil`].join(
        ';',
      ),
    )
    expect(pathOf(block)).toBe(SYSTEM_DIR)
  })

  it('sets NoDefaultCurrentDirectoryInExePath on the payload', () => {
    const block = blockOf(SYSTEM_DIR)
    expect(block).toContain('NoDefaultCurrentDirectoryInExePath=1')
  })

  it('keeps non-PATH variables and drops undefined ones', () => {
    const block = blockOf(SYSTEM_DIR, {
      SYSTEMROOT: String.raw`C:\Windows`,
      DROPPED: undefined,
      MUSE_SPARK_LAUNCH_ID: 'abc',
    })
    expect(block).toContain(String.raw`SYSTEMROOT=C:\Windows`)
    expect(block).toContain('MUSE_SPARK_LAUNCH_ID=abc')
    expect(block.some((entry) => entry.startsWith('DROPPED='))).toBe(false)
  })

  it('guards every PATH spelling, not just the first', () => {
    // A second raw spelling used to survive the first sanitizing empty:
    // the child reads the first spelling in block order, so the raw one
    // became the payload PATH.
    const guarded = workspaceChildEnvironment(
      'win32',
      { PATH: String.raw`C:\work\repo\bin`, Path: String.raw`C:\work\repo\tools` },
      { workspaceRoot: WORKSPACE, realpath: (filePath) => filePath },
    )
    expect(guardedEnvironmentBlock(guarded)).toEqual(['NoDefaultCurrentDirectoryInExePath=1'])
    const mixed = workspaceChildEnvironment(
      'win32',
      { PATH: String.raw`C:\work\repo\bin`, Path: SYSTEM_DIR },
      { workspaceRoot: WORKSPACE, realpath: (filePath) => filePath },
    )
    expect(guardedEnvironmentBlock(mixed)).toEqual([
      `Path=${SYSTEM_DIR}`,
      'NoDefaultCurrentDirectoryInExePath=1',
    ])
  })

  it('drops a preset current-directory-exclusion variable before setting it', () => {
    // A preset `0` would otherwise shadow the canonical `1` in block
    // order and re-enable working-directory-first resolution.
    const guarded = workspaceChildEnvironment(
      'win32',
      { PATH: SYSTEM_DIR, nodefaultcurrentdirectoryinexepath: '0' },
      { workspaceRoot: WORKSPACE, realpath: (filePath) => filePath },
    )
    expect(guardedEnvironmentBlock(guarded)).toEqual([
      `PATH=${SYSTEM_DIR}`,
      'NoDefaultCurrentDirectoryInExePath=1',
    ])
  })
})

describe('Windows team command resolution (real resolver and payload builder)', () => {
  // `CreateProcessW` with a non-null application name completes a partial
  // name from the helper's own working directory (the workspace) without a
  // PATH search and assumes no extension, so the driver must hand `RunTeam`
  // an absolute file outside the workspace. These drive the real resolver
  // (`resolveServerCommand`, PATHEXT included) and the real payload builder
  // on every platform; only the file probes are injected.
  const files = new Set([
    String.raw`C:\work\repo\git.exe`,
    String.raw`C:\Git\cmd\git.exe`,
    String.raw`C:\Tools\npm.cmd`,
    String.raw`C:\Windows\System32\cmd.exe`,
    String.raw`C:\Tools\worker.exe`,
    String.raw`C:\work\repo\bin\tool.exe`,
  ])
  function targetOf(
    command: string,
    args: readonly string[],
    pathValue: string,
    extraEnv: NodeJS.ProcessEnv = {},
  ) {
    return resolveWindowsTeamCommand(
      command,
      args,
      WORKSPACE,
      { PATH: pathValue, ...extraEnv },
      {
        systemRoot: SYSTEM_ROOT,
        isExistingFile: (file: string) => files.has(file),
        realpath: (filePath: string) => filePath,
      },
    )
  }

  it('resolves a bare name outside the workspace even when the workspace plants it', () => {
    // Before the fix the raw `git` reached `RunTeam`, which completed it to
    // `<workspace>\git.exe`.
    const target = targetOf(
      'git',
      ['status'],
      [String.raw`C:\work\repo`, String.raw`C:\Git\cmd`].join(';'),
    )
    expect(target.executable).toBe(String.raw`C:\Git\cmd\git.exe`)
    expect(target.args).toEqual(['status'])
    expect(target.isVerbatim).toBe(false)
    // The payload its helpers search stays clean in the same configuration.
    const block = windowsTeamPayloadEnvironment(
      { PATH: [String.raw`C:\work\repo`, SYSTEM_DIR].join(';'), SYSTEMROOT: SYSTEM_ROOT },
      WORKSPACE,
    )
    expect(block.find((entry) => entry.toUpperCase().startsWith('PATH='))).toBe(
      `PATH=${SYSTEM_DIR}`,
    )
  })

  it('routes a bare name without an extension through the absolute cmd.exe', () => {
    // `npm` is `npm.cmd` on Windows: `CreateProcessW` cannot start it
    // directly, and an extensionless workspace planting must not match.
    const target = targetOf('npm', ['-y', 'pkg'], String.raw`C:\work\repo;C:\Tools`)
    expect(target.executable).toBe(String.raw`C:\Windows\System32\cmd.exe`)
    expect(target.isVerbatim).toBe(true)
    expect(target.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c'])
    expect(target.args[4]).toContain(String.raw`C:\Tools\npm.cmd`)
  })

  it('fails closed when the bare name is missing outside the workspace', () => {
    expect(() => targetOf('node', [], String.raw`C:\work\repo;C:\Git\cmd`)).toThrow(
      'was not found on the absolute entries of PATH',
    )
  })

  it('fails closed when a relative path resolves inside the workspace', () => {
    expect(() => targetOf(String.raw`bin\tool.exe`, [], String.raw`C:\Git\cmd`)).toThrow(
      'TEAM_COMMAND_IN_WORKSPACE',
    )
  })

  it('fails closed when an absolute path names the workspace', () => {
    expect(() => targetOf(String.raw`C:\work\repo\git.exe`, [], String.raw`C:\Git\cmd`)).toThrow(
      'TEAM_COMMAND_IN_WORKSPACE',
    )
  })

  it('keeps an absolute path outside the workspace, which needs no search', () => {
    const target = targetOf(String.raw`C:\Tools\worker.exe`, ['--serve'], String.raw`C:\Git\cmd`)
    expect(target.executable).toBe(String.raw`C:\Tools\worker.exe`)
    expect(target.args).toEqual(['--serve'])
  })
})

describe('round-7 payload block (kept)', () => {
  it('only a guarded environment serializes to a helper block', () => {
    // The block builder takes the branded type: a raw environment cannot
    // reach a native helper payload without going through the guard. A
    // guarded environment with nothing left still serializes its other
    // variables (PATH deleted, never stored empty).
    const guarded = workspaceChildEnvironment(
      'win32',
      { PATH: String.raw`C:\work\repo\bin`, KEEP: 'yes' },
      { workspaceRoot: WORKSPACE, realpath: (filePath) => filePath },
    )
    expect(guardedEnvironmentBlock(guarded)).toEqual([
      'KEEP=yes',
      'NoDefaultCurrentDirectoryInExePath=1',
    ])
  })
})
